import { sql, requireAuth, readJson } from '../_db.js';

// /api/sales/vendor-daily?date=2026-05-08
//   GET                    → 그날 모든 vendor 행 (없는 vendor는 자동 0행)
//   POST {vendor_id, work_date, db_count, deleted_count, received_count, remaining_count, completed_count, note}
//                          → upsert (admin/manager only)
// 또한 day_meta(재컨택 완료) 같은 엔드포인트에서 같이 처리:
//   POST_meta: ?meta=1 {work_date, recontact_completed, note}
export default requireAuth(async function handler(req, res) {
  const me = req.user;
  const isPriv = me.role === 'admin' || me.role === 'manager';

  if (req.method === 'GET') {
    const d = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    if (!d) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
    const vendors = await sql`
      SELECT id, code, label, parent_label, color, sort_order
      FROM db_vendors WHERE active = TRUE
      ORDER BY sort_order ASC, id ASC
    `;
    const rows = await sql`
      SELECT * FROM sales_vendor_daily WHERE work_date = ${d}
    `;
    const meta = (await sql`SELECT * FROM sales_day_meta WHERE work_date = ${d} LIMIT 1`)[0]
      || { work_date: d, recontact_completed: 0, note: null };
    // vendor_id 인덱스로 매핑
    const map = {}; rows.forEach(r => map[r.vendor_id] = r);
    const merged = vendors.map(v => ({
      vendor_id: v.id,
      code: v.code, label: v.label, parent_label: v.parent_label, color: v.color,
      db_count: map[v.id]?.db_count || 0,
      deleted_count: map[v.id]?.deleted_count || 0,
      received_count: map[v.id]?.received_count || 0,
      remaining_count: map[v.id]?.remaining_count || 0,
      completed_count: map[v.id]?.completed_count || 0,
      note: map[v.id]?.note || null,
      _exists: !!map[v.id],
    }));
    return res.status(200).json({ date: d, vendors: merged, meta });
  }

  if (!isPriv) return res.status(403).json({ error: '관리자 전용' });

  if (req.method === 'POST') {
    if (req.query.meta) {
      const b = await readJson(req);
      if (!b.work_date) return res.status(400).json({ error: 'work_date required' });
      const rows = await sql`
        INSERT INTO sales_day_meta (work_date, recontact_completed, note, updated_at)
        VALUES (${b.work_date}, ${Number(b.recontact_completed || 0)}, ${b.note || null}, NOW())
        ON CONFLICT (work_date) DO UPDATE SET
          recontact_completed = EXCLUDED.recontact_completed,
          note = EXCLUDED.note,
          updated_at = NOW()
        RETURNING *
      `;
      return res.status(200).json({ ok: true, meta: rows[0] });
    }
    const b = await readJson(req);
    if (!b.vendor_id || !b.work_date) return res.status(400).json({ error: 'vendor_id/work_date required' });
    const rows = await sql`
      INSERT INTO sales_vendor_daily
        (vendor_id, work_date, db_count, deleted_count, received_count, remaining_count, completed_count, note, updated_at)
      VALUES
        (${Number(b.vendor_id)}, ${b.work_date},
         ${Number(b.db_count || 0)}, ${Number(b.deleted_count || 0)},
         ${Number(b.received_count || 0)}, ${Number(b.remaining_count || 0)},
         ${Number(b.completed_count || 0)}, ${b.note || null}, NOW())
      ON CONFLICT (vendor_id, work_date) DO UPDATE SET
        db_count = EXCLUDED.db_count,
        deleted_count = EXCLUDED.deleted_count,
        received_count = EXCLUDED.received_count,
        remaining_count = EXCLUDED.remaining_count,
        completed_count = EXCLUDED.completed_count,
        note = EXCLUDED.note,
        updated_at = NOW()
      RETURNING *
    `;
    return res.status(200).json({ ok: true, row: rows[0] });
  }

  res.setHeader('Allow', 'GET,POST');
  return res.status(405).json({ error: 'method not allowed' });
});

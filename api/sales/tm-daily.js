import { sql, requireAuth, readJson } from '../_db.js';

// /api/sales/tm-daily
//   POST {user_id, work_date, db_count, is_off, note}
//        → upsert (admin/manager 또는 본인)
//   GET  ?ym=2026-05  → 월별 입력 행 (인라인 편집 데이터 로드용)
export default requireAuth(async function handler(req, res) {
  const me = req.user;
  const isPriv = me.role === 'admin' || me.role === 'manager';

  if (req.method === 'GET') {
    const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
    if (!ym) return res.status(400).json({ error: 'ym required' });
    const start = `${ym}-01`;
    const [y,m] = ym.split('-').map(Number);
    const ny = m === 12 ? y+1 : y;
    const nm = m === 12 ? 1 : m+1;
    const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
    const rows = isPriv
      ? await sql`
          SELECT * FROM sales_tm_daily
          WHERE work_date >= ${start} AND work_date < ${end}
          ORDER BY work_date ASC, user_id ASC
        `
      : await sql`
          SELECT * FROM sales_tm_daily
          WHERE work_date >= ${start} AND work_date < ${end}
            AND user_id = ${me.id}
          ORDER BY work_date ASC
        `;
    return res.status(200).json({ rows });
  }

  if (req.method === 'POST') {
    const b = await readJson(req);
    const userId = Number(b.user_id || me.id);
    if (!isPriv && userId !== me.id) return res.status(403).json({ error: '본인 행만' });
    if (!b.work_date) return res.status(400).json({ error: 'work_date required' });
    const rows = await sql`
      INSERT INTO sales_tm_daily (user_id, work_date, db_count, is_off, note, updated_at)
      VALUES (${userId}, ${b.work_date}, ${Number(b.db_count || 0)}, ${!!b.is_off}, ${b.note || null}, NOW())
      ON CONFLICT (user_id, work_date) DO UPDATE SET
        db_count = EXCLUDED.db_count,
        is_off = EXCLUDED.is_off,
        note = EXCLUDED.note,
        updated_at = NOW()
      RETURNING *
    `;
    return res.status(200).json({ ok: true, row: rows[0] });
  }

  res.setHeader('Allow', 'GET,POST');
  return res.status(405).json({ error: 'method not allowed' });
});

import { sql, requireAuth, readJson } from '../_db.js';

// /api/sales/vendors
//   GET                 → 활성 vendor 리스트
//   POST {id?, code, label, parent_label, color, sort_order, active}
//                       → upsert (admin/manager only)
//   DELETE ?id=N        → soft delete (active=false)
export default requireAuth(async function handler(req, res) {
  const me = req.user;
  const isPriv = me.role === 'admin' || me.role === 'manager';

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, code, label, parent_label, color, sort_order, active, note
      FROM db_vendors
      ORDER BY active DESC, sort_order ASC, id ASC
    `;
    return res.status(200).json({ vendors: rows });
  }

  if (!isPriv) return res.status(403).json({ error: '관리자 전용' });

  if (req.method === 'POST') {
    const b = await readJson(req);
    if (!b.code || !b.label) return res.status(400).json({ error: 'code/label 필수' });
    if (b.id) {
      const rows = await sql`
        UPDATE db_vendors SET
          code = ${b.code},
          label = ${b.label},
          parent_label = ${b.parent_label || null},
          color = ${b.color || '#9b9a97'},
          sort_order = ${Number(b.sort_order || 0)},
          active = ${b.active !== false},
          note = ${b.note || null}
        WHERE id = ${b.id}
        RETURNING *
      `;
      return res.status(200).json({ ok: true, vendor: rows[0] });
    }
    const rows = await sql`
      INSERT INTO db_vendors (code, label, parent_label, color, sort_order, note)
      VALUES (${b.code}, ${b.label}, ${b.parent_label || null}, ${b.color || '#9b9a97'},
              ${Number(b.sort_order || 0)}, ${b.note || null})
      RETURNING *
    `;
    return res.status(200).json({ ok: true, vendor: rows[0] });
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'id required' });
    await sql`UPDATE db_vendors SET active = FALSE WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET,POST,DELETE');
  return res.status(405).json({ error: 'method not allowed' });
});

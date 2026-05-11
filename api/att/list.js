import { sql, requireAuth } from '../_db.js';

// GET /api/att/list?ym=2026-05
// 응답: { ym, users:[{id,name,role,registered}], records:[{id,user_id,work_date,type,status,note,approved_by,approved_at,reject_reason,requested_at}] }
export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
    if (!ym) return res.status(400).json({ error: 'ym required (YYYY-MM)' });

    const start = `${ym}-01`;
    const [y, m] = ym.split('-').map(Number);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const me = req.user;
    const isPriv = me.role === 'admin' || me.role === 'manager';

    let users, records;
    if (isPriv) {
      [users, records] = await Promise.all([
        sql`
          SELECT id, name, role, registered
          FROM users
          WHERE role <> 'admin'
          ORDER BY sort_order ASC, id ASC
        `,
        sql`
          SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
                 a.approved_by, a.approved_at, a.reject_reason, a.requested_at,
                 u.name AS approver_name
          FROM attendance_records a
          LEFT JOIN users u ON u.id = a.approved_by
          WHERE a.work_date >= ${start} AND a.work_date < ${end}
          ORDER BY a.work_date ASC, a.user_id ASC
        `,
      ]);
    } else {
      users = [{ id: me.id, name: me.name, role: me.role, registered: true }];
      records = await sql`
        SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
               a.approved_by, a.approved_at, a.reject_reason, a.requested_at,
               u.name AS approver_name
        FROM attendance_records a
        LEFT JOIN users u ON u.id = a.approved_by
        WHERE a.work_date >= ${start} AND a.work_date < ${end}
          AND a.user_id = ${me.id}
        ORDER BY a.work_date ASC
      `;
    }

    return res.status(200).json({ ym, users, records, isPriv });
  } catch (e) {
    console.error('att/list error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
});

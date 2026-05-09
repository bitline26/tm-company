import { sql, requireAuth, readJson } from '../_db.js';

// POST /api/att/cancel  body: { id }
// 본인 REQUESTED 건만 취소(삭제) 가능. admin/manager는 모든 건 삭제 가능.
export default requireAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const me = req.user;
    const { id } = await readJson(req);
    if (!id) return res.status(400).json({ error: 'id required' });

    const rows = await sql`SELECT id, user_id, status FROM attendance_records WHERE id = ${id} LIMIT 1`;
    const rec = rows[0];
    if (!rec) return res.status(404).json({ error: 'not found' });

    const isPriv = me.role === 'admin' || me.role === 'manager';
    if (!isPriv) {
      if (rec.user_id !== me.id) return res.status(403).json({ error: '권한 없음' });
      if (rec.status !== 'REQUESTED') return res.status(400).json({ error: '승인/반려된 건은 취소 불가' });
    }
    await sql`DELETE FROM attendance_records WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('att/cancel error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
});

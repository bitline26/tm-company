// 승인 대기 (REQUESTED) 전체 목록 — 모든 월·모든 직원 (admin/manager 전용)
// State.records 캐시 의존 없이 항상 fresh 가져오게 별도 엔드포인트로 분리 (대표 지시)
import { sql, requireAuth } from '../_db.js';

export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const me = req.user;
  if (me.role !== 'admin' && me.role !== 'manager') {
    return res.status(403).json({ error: '권한 없음' });
  }
  try {
    const records = await sql`
      SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
             a.requested_at, u.name AS user_name
      FROM attendance_records a
      JOIN users u ON u.id = a.user_id
      WHERE a.status = 'REQUESTED'
      ORDER BY a.work_date ASC, a.user_id ASC
    `;
    return res.status(200).json({ records, count: records.length });
  } catch (e) {
    console.error('att/pending error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
});

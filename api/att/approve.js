import { sql, requireAuth, readJson } from '../_db.js';
import { buildSingleOffMessage, sendAdminFriendtalk } from '../_notify.js';

// POST /api/att/approve
// body: { id, action: 'approve' | 'reject', reject_reason? }
// admin/manager 전용
export default requireAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const me = req.user;
    if (me.role !== 'admin' && me.role !== 'manager') {
      return res.status(403).json({ error: '승인 권한이 없습니다' });
    }
    const { id, action, reject_reason } = await readJson(req);
    if (!id) return res.status(400).json({ error: 'id required' });
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }

    if (action === 'approve') {
      const rows = await sql`
        UPDATE attendance_records
        SET status = 'APPROVED', approved_by = ${me.id}, approved_at = NOW(), reject_reason = NULL
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      notifyAdmin(rows[0], 'APPROVED');
      return res.status(200).json({ ok: true, record: rows[0] });
    } else {
      const rows = await sql`
        UPDATE attendance_records
        SET status = 'REJECTED', approved_by = ${me.id}, approved_at = NOW(),
            reject_reason = ${reject_reason || null}
        WHERE id = ${id}
        RETURNING *
      `;
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      notifyAdmin(rows[0], 'REJECTED');
      return res.status(200).json({ ok: true, record: rows[0] });
    }
  } catch (e) {
    console.error('att/approve error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
});

// 즉시 알림톡 — WORK 제외. 실패해도 응답에 영향 없음 (백그라운드)
function notifyAdmin(record, kind) {
  if (!record || record.type === 'WORK') return;
  (async () => {
    const u = await sql`SELECT name FROM users WHERE id = ${record.user_id}`;
    const empName = u[0]?.name || `#${record.user_id}`;
    const date = String(record.work_date).slice(0, 10);
    const message = buildSingleOffMessage({
      name: empName, date, type: record.type, kind,
    });
    return sendAdminFriendtalk({
      message,
      subject: kind === 'APPROVED' ? '휴무 승인' : '휴무 반려',
    });
  })().catch(e => console.error('notify(approve) failed:', e.message));
}

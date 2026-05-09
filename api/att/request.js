import { sql, requireAuth, readJson } from '../_db.js';

const VALID_TYPES = new Set(['WORK','OFF','HALF_AM','HALF_PM','MONTHLY','ANNUAL','SICK','HOLIDAY']);

// POST /api/att/request
// body: { user_id?, work_date, type, note? }
// 직원: 본인만 / 관리자(admin/manager): 다른 직원도 등록 가능 + 즉시 APPROVED
export default requireAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const me = req.user;
    const { user_id, work_date, type, note } = await readJson(req);
    const targetId = Number(user_id || me.id);
    const date = String(work_date || '');

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'work_date YYYY-MM-DD' });
    if (!VALID_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });

    const isPriv = me.role === 'admin' || me.role === 'manager';
    if (targetId !== me.id && !isPriv) {
      return res.status(403).json({ error: '본인 일정만 등록할 수 있습니다' });
    }

    // 관리자/실장이 직접 등록한 건 즉시 승인 처리
    const status = isPriv ? 'APPROVED' : 'REQUESTED';
    const approvedBy = isPriv ? me.id : null;
    const approvedAt = isPriv ? new Date().toISOString() : null;

    const rows = await sql`
      INSERT INTO attendance_records (user_id, work_date, type, status, note, approved_by, approved_at)
      VALUES (${targetId}, ${date}, ${type}, ${status}, ${note || null}, ${approvedBy}, ${approvedAt})
      ON CONFLICT (user_id, work_date) DO UPDATE
        SET type = EXCLUDED.type,
            status = EXCLUDED.status,
            note = EXCLUDED.note,
            approved_by = EXCLUDED.approved_by,
            approved_at = EXCLUDED.approved_at,
            reject_reason = NULL,
            requested_at = NOW()
      RETURNING *
    `;
    return res.status(200).json({ ok: true, record: rows[0] });
  } catch (e) {
    console.error('att/request error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
});

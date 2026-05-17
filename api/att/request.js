// 통합 endpoint — Vercel Hobby 함수 12개 제한 회피
// rewrites 로 다음 경로가 모두 이 파일로 들어옴:
//   POST /api/att/request               (기본 — 휴무 등록)
//   POST /api/att/cancel  (?__op=cancel)
//   GET  /api/att/pending (?__op=pending)
import { sql, requireAuth, readJson } from '../_db.js';
import { buildSingleOffMessage, sendAdminFriendtalk } from '../_notify.js';

const VALID_TYPES = new Set(['WORK','OFF','HALF_AM','HALF_PM','MONTHLY','ANNUAL','SICK','HOLIDAY','UNAUTHORIZED']);
const TIER1_REQUESTABLE = new Set(['OFF','UNAUTHORIZED']);
const TIER2_REQUESTABLE = new Set(['HALF_AM','HALF_PM','UNAUTHORIZED','OFF','MONTHLY']);

export default requireAuth(async function handler(req, res) {
  const op = String(req.query.__op || '');

  // ── /api/att/pending (GET) — 승인 대기 전체 목록 (admin/manager 전용) ──
  if (op === 'pending') {
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
  }

  // ── /api/att/cancel (POST) — 본인 REQUESTED 취소, admin/manager 는 모든 건 삭제 ──
  if (op === 'cancel') {
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
  }

  // ── /api/att/request (POST) — 기본 휴무 등록 ──
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
    if (!isPriv && targetId === me.id) {
      const tier = Number(me.tier) || 2;
      const allowed = tier === 1 ? TIER1_REQUESTABLE : TIER2_REQUESTABLE;
      if (!allowed.has(type)) {
        return res.status(403).json({ error: `${tier}차직원이 신청할 수 없는 종류입니다` });
      }
    }

    const status = 'REQUESTED';
    const approvedBy = null;
    const approvedAt = null;

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

    if (type !== 'WORK') {
      const tgt = await sql`SELECT name FROM users WHERE id = ${targetId}`;
      const empName = tgt[0]?.name || `#${targetId}`;
      const message = buildSingleOffMessage({
        name: empName, date, type,
        kind: status === 'APPROVED' ? 'APPROVED' : 'REGISTERED',
      });
      sendAdminFriendtalk({
        message,
        subject: status === 'APPROVED' ? '휴무 등록(즉시 승인)' : '휴무 신청 접수',
      }).catch(e => console.error('notify(request) failed:', e.message));
    }

    return res.status(200).json({ ok: true, record: rows[0] });
  } catch (e) {
    console.error('att/request error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
});

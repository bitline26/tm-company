import { sql, requireAuth, readJson } from '../_db.js';
import { buildSingleOffMessage, sendAdminFriendtalk } from '../_notify.js';

const VALID_TYPES = new Set(['WORK','OFF','HALF_AM','HALF_PM','MONTHLY','ANNUAL','SICK','HOLIDAY','UNAUTHORIZED']);
// 분류별 신청 가능 종류 — 서버 측 강제 (관리자 외)
// 1차직원: 휴무 + 무단결근
// 2차직원: 오전반차 / 오후반차 / 무단결근 / 휴무(병가=OFF) / 월차 (연차·병가 단독 폐기)
const TIER1_REQUESTABLE = new Set(['OFF','UNAUTHORIZED']);
const TIER2_REQUESTABLE = new Set(['HALF_AM','HALF_PM','UNAUTHORIZED','OFF','MONTHLY']);

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
    // 직급별 신청 가능 종류 강제 — 본인 신청 시에만 (관리자가 직접 입력 시는 자유)
    if (!isPriv && targetId === me.id) {
      const tier = Number(me.tier) || 2;
      const allowed = tier === 1 ? TIER1_REQUESTABLE : TIER2_REQUESTABLE;
      if (!allowed.has(type)) {
        return res.status(403).json({ error: `${tier}차직원이 신청할 수 없는 종류입니다` });
      }
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

    // 즉시 알림톡 발송 — WORK(정상근무) 제외, 휴무 계열만
    // 직원 self 신청은 REQUESTED → "등록" / 관리자 입력은 APPROVED → "승인"
    // 실패해도 응답에 영향 주지 않음 (백그라운드)
    if (type !== 'WORK') {
      const tgt = await sql`SELECT name FROM users WHERE id = ${targetId}`;
      const empName = tgt[0]?.name || `#${targetId}`;
      const message = buildSingleOffMessage({
        name: empName,
        date,
        type,
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

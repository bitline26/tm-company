// Edge Runtime — 콜드 스타트 500-1500ms (Node) → 30-80ms (Edge)
import {
  sql, verifyPasswordEdge, signSessionEdge, sessionCookie, ymToRange, json,
} from './_edge.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, { status: 405, headers: { 'allow': 'POST' } });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const { name, password, ym } = body;
    if (!name || !password) return json({ error: '이름과 비밀번호를 입력하세요' }, { status: 400 });

    const ymOk = String(ym || '').match(/^\d{4}-\d{2}$/)?.[0]
      || new Date().toISOString().slice(0, 7);
    const { start, end } = ymToRange(ymOk);

    // user 인증 쿼리 + 전체 bootstrap 쿼리(att/sales) 동시 발사 → 1 RTT로 마무리
    const userP = sql`
      SELECT id, name, role, registered, tier, status, allowed_ips,
             password_hash, password_salt
      FROM users WHERE name = ${name} LIMIT 1`;
    const usersP = sql`
      SELECT id, name, role, registered, tier, status, allowed_ips
      FROM users WHERE role <> 'admin' AND registered = TRUE
      ORDER BY sort_order ASC, id ASC`;
    const recordsP = sql`
      SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
             a.approved_by, a.approved_at, a.reject_reason, a.requested_at,
             uu.name AS approver_name
      FROM attendance_records a
      LEFT JOIN users uu ON uu.id = a.approved_by
      WHERE a.work_date >= ${start} AND a.work_date < ${end}
      ORDER BY a.work_date ASC, a.user_id ASC`;
    const vendorsP = sql`
      SELECT id, code, label, parent_label, color, sort_order, active, note
      FROM db_vendors ORDER BY active DESC, sort_order ASC, id ASC`;
    const ordersP = sql`
      SELECT o.*, uu.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label,
             v.parent_label, v.color AS vendor_color
      FROM sales_orders o
      LEFT JOIN users uu ON uu.id = o.tm_user_id
      LEFT JOIN db_vendors v ON v.id = o.vendor_id
      WHERE o.consult_date >= ${start} AND o.consult_date < ${end}
      ORDER BY (o.payment_date IS NULL), o.payment_date ASC, o.consult_date ASC, o.id ASC`;
    [usersP, recordsP, vendorsP, ordersP].forEach(p => p.catch(() => {}));

    const userRows = await userP;
    const u = userRows[0];
    if (!u) return json({ error: '이름 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
    if (!u.password_hash) return json({ error: '아직 가입되지 않은 이름입니다 (회원가입 필요)' }, { status: 401 });
    if (!u.registered) return json({ error: '관리자 승인 대기 중입니다' }, { status: 403 });
    // 계정 상태 차단 (admin은 예외 — 대표는 항상 로그인 가능해야 함)
    if (u.role !== 'admin') {
      if (u.status === 'suspended') return json({ error: '계정이 정지되었습니다. 대표에게 문의하세요.' }, { status: 403 });
      if (u.status === 'resigned')  return json({ error: '퇴사 처리된 계정입니다.' }, { status: 403 });
      // 허용 IP 화이트리스트 (비어있으면 제한 없음)
      if (Array.isArray(u.allowed_ips) && u.allowed_ips.length > 0) {
        const xf = req.headers.get('x-forwarded-for') || '';
        const clientIp = xf.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
        if (!u.allowed_ips.includes(clientIp)) {
          return json({ error: `허용되지 않은 위치에서의 접속입니다 (IP: ${clientIp || '알 수 없음'})` }, { status: 403 });
        }
      }
    }
    if (!(await verifyPasswordEdge(String(password), u.password_hash, u.password_salt))) {
      return json({ error: '이름 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
    }

    const isPriv = u.role === 'admin' || u.role === 'manager';
    const token = await signSessionEdge({ uid: u.id, name: u.name, role: u.role, tier: u.tier });

    // 최근 로그인 IP/시각 기록 — admin도 기록 (대시보드 확인용)
    {
      const xf = req.headers.get('x-forwarded-for') || '';
      const clientIp = xf.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
      if (clientIp) {
        sql`UPDATE users SET last_login_ip = ${clientIp}, last_login_at = NOW() WHERE id = ${u.id}`
          .catch(() => {});
      }
    }

    let users, records, salesVendors, salesOrders;
    if (isPriv) {
      [users, records, salesVendors, salesOrders] = await Promise.all([usersP, recordsP, vendorsP, ordersP]);
    } else {
      users = [{ id: u.id, name: u.name, role: u.role, tier: u.tier, registered: true }];
      const [allRecords, vendors] = await Promise.all([recordsP, vendorsP]);
      records = allRecords.filter(r => r.user_id === u.id);
      salesVendors = vendors;
      salesOrders = null;
    }

    return json({
      ok: true,
      user: { id: u.id, name: u.name, role: u.role, tier: u.tier },
      bootstrap: { ym: ymOk, users, records, isPriv, salesVendors, salesOrders },
    }, { headers: { 'set-cookie': sessionCookie(token) } });
  } catch (e) {
    return json({ error: 'server error', detail: String(e?.message || e) }, { status: 500 });
  }
}

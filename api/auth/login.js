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
      SELECT id, name, role, registered, password_hash, password_salt
      FROM users WHERE name = ${name} LIMIT 1`;
    const usersP = sql`
      SELECT id, name, role, registered
      FROM users WHERE role <> 'admin'
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
      ORDER BY o.consult_date DESC, o.id DESC`;
    [usersP, recordsP, vendorsP, ordersP].forEach(p => p.catch(() => {}));

    const userRows = await userP;
    const u = userRows[0];
    if (!u) return json({ error: '이름 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
    if (!u.registered) return json({ error: '아직 가입되지 않은 직원입니다 (회원가입 필요)' }, { status: 401 });
    if (!(await verifyPasswordEdge(String(password), u.password_hash, u.password_salt))) {
      return json({ error: '이름 또는 비밀번호가 올바르지 않습니다' }, { status: 401 });
    }

    const isPriv = u.role === 'admin' || u.role === 'manager';
    const token = await signSessionEdge({ uid: u.id, name: u.name, role: u.role });

    let users, records, salesVendors, salesOrders;
    if (isPriv) {
      [users, records, salesVendors, salesOrders] = await Promise.all([usersP, recordsP, vendorsP, ordersP]);
    } else {
      users = [{ id: u.id, name: u.name, role: u.role, registered: true }];
      const [allRecords, vendors] = await Promise.all([recordsP, vendorsP]);
      records = allRecords.filter(r => r.user_id === u.id);
      salesVendors = vendors;
      salesOrders = null;
    }

    return json({
      ok: true,
      user: { id: u.id, name: u.name, role: u.role },
      bootstrap: { ym: ymOk, users, records, isPriv, salesVendors, salesOrders },
    }, { headers: { 'set-cookie': sessionCookie(token) } });
  } catch (e) {
    return json({ error: 'server error', detail: String(e?.message || e) }, { status: 500 });
  }
}

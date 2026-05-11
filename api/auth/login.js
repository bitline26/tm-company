import {
  sql, ensureSchema, verifyPassword, signSession,
  setSessionCookie, readJson,
} from '../_db.js';

function ymToRange(ym) {
  const start = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    // ensureSchema는 백그라운드 — 마커 SELECT가 user 쿼리와 병렬로 실행
    ensureSchema().catch(() => {});

    const { name, password, ym } = await readJson(req);
    if (!name || !password) return res.status(400).json({ error: '이름과 비밀번호를 입력하세요' });

    const ymOk = String(ym || '').match(/^\d{4}-\d{2}$/)?.[0]
      || new Date().toISOString().slice(0, 7);
    const { start, end } = ymToRange(ymOk);

    // 핵심: user 인증 쿼리 + bootstrap 데이터 5개 쿼리를 한 번에 발사
    // → Neon RTT 한 번에 모두 처리. 직렬화 제거.
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
    // unhandled rejection 방지 (인증 실패 시 폐기)
    [usersP, recordsP, vendorsP, ordersP].forEach(p => p.catch(() => {}));

    const userRows = await userP;
    const u = userRows[0];
    if (!u) return res.status(401).json({ error: '이름 또는 비밀번호가 올바르지 않습니다' });
    if (!u.registered) return res.status(401).json({ error: '아직 가입되지 않은 직원입니다 (회원가입 필요)' });
    if (!verifyPassword(String(password), u.password_hash, u.password_salt)) {
      return res.status(401).json({ error: '이름 또는 비밀번호가 올바르지 않습니다' });
    }

    const isPriv = u.role === 'admin' || u.role === 'manager';
    const token = signSession({ uid: u.id, name: u.name, role: u.role });
    setSessionCookie(res, token);

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

    return res.status(200).json({
      ok: true,
      user: { id: u.id, name: u.name, role: u.role },
      bootstrap: { ym: ymOk, users, records, isPriv, salesVendors, salesOrders },
    });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

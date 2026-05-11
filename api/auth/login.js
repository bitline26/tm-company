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
    await ensureSchema();
    const { name, password, ym } = await readJson(req);
    if (!name || !password) return res.status(400).json({ error: '이름과 비밀번호를 입력하세요' });

    const rows = await sql`
      SELECT id, name, role, registered, password_hash, password_salt
      FROM users WHERE name = ${name} LIMIT 1
    `;
    const u = rows[0];
    if (!u) return res.status(401).json({ error: '이름 또는 비밀번호가 올바르지 않습니다' });
    if (!u.registered) return res.status(401).json({ error: '아직 가입되지 않은 직원입니다 (회원가입 필요)' });
    if (!verifyPassword(String(password), u.password_hash, u.password_salt)) {
      return res.status(401).json({ error: '이름 또는 비밀번호가 올바르지 않습니다' });
    }

    const token = signSession({ uid: u.id, name: u.name, role: u.role });
    setSessionCookie(res, token);

    // 부트스트랩: 첫 화면 데이터(att/list 동등)까지 같이 반환 → 라운드트립 절감
    const ymOk = String(ym || '').match(/^\d{4}-\d{2}$/)?.[0]
      || new Date().toISOString().slice(0, 7);
    const { start, end } = ymToRange(ymOk);
    const isPriv = u.role === 'admin' || u.role === 'manager';

    let users, records;
    if (isPriv) {
      [users, records] = await Promise.all([
        sql`
          SELECT id, name, role, registered
          FROM users WHERE role <> 'admin'
          ORDER BY sort_order ASC, id ASC
        `,
        sql`
          SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
                 a.approved_by, a.approved_at, a.reject_reason, a.requested_at,
                 uu.name AS approver_name
          FROM attendance_records a
          LEFT JOIN users uu ON uu.id = a.approved_by
          WHERE a.work_date >= ${start} AND a.work_date < ${end}
          ORDER BY a.work_date ASC, a.user_id ASC
        `,
      ]);
    } else {
      users = [{ id: u.id, name: u.name, role: u.role, registered: true }];
      records = await sql`
        SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
               a.approved_by, a.approved_at, a.reject_reason, a.requested_at,
               uu.name AS approver_name
        FROM attendance_records a
        LEFT JOIN users uu ON uu.id = a.approved_by
        WHERE a.work_date >= ${start} AND a.work_date < ${end}
          AND a.user_id = ${u.id}
        ORDER BY a.work_date ASC
      `;
    }

    return res.status(200).json({
      ok: true,
      user: { id: u.id, name: u.name, role: u.role },
      bootstrap: { ym: ymOk, users, records, isPriv },
    });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

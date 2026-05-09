import {
  sql, ensureSchema, verifyPassword, signSession,
  setSessionCookie, readJson,
} from '../_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    await ensureSchema();
    const { name, password } = await readJson(req);
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
    return res.status(200).json({ ok: true, user: { id: u.id, name: u.name, role: u.role } });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

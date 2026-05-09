import {
  sql, ensureSchema, hashPassword, signSession,
  setSessionCookie, readJson, PRESET_NAMES,
} from '../_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    await ensureSchema();
    const { name, password } = await readJson(req);

    if (!name || !PRESET_NAMES.includes(name)) {
      return res.status(400).json({ error: '등록된 직원명만 가입 가능합니다' });
    }
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: '비밀번호는 4자 이상' });
    }

    const found = await sql`SELECT id, registered FROM users WHERE name = ${name} LIMIT 1`;
    if (!found[0]) return res.status(400).json({ error: '존재하지 않는 직원' });
    if (found[0].registered) return res.status(409).json({ error: '이미 가입된 직원입니다' });

    const { hash, salt } = hashPassword(String(password));
    const updated = await sql`
      UPDATE users
      SET password_hash = ${hash}, password_salt = ${salt}, registered = TRUE
      WHERE id = ${found[0].id}
      RETURNING id, name, role
    `;
    const u = updated[0];
    const token = signSession({ uid: u.id, name: u.name, role: u.role });
    setSessionCookie(res, token);
    return res.status(200).json({ ok: true, user: { id: u.id, name: u.name, role: u.role } });
  } catch (e) {
    console.error('signup error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

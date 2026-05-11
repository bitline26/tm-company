import { sql, requireAuth, readJson } from '../_db.js';

// 가입 승인 관리 — admin 전용
// GET     /api/auth/pending           → 승인 대기 목록
// POST    /api/auth/pending           → { id, action: 'approve' | 'reject' }
export default requireAuth(async function handler(req, res) {
  const me = req.user;
  if (me.role !== 'admin') return res.status(403).json({ error: '대표만 사용 가능합니다' });

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, name, role, tier, created_at
      FROM users
      WHERE registered = FALSE
        AND password_hash IS NOT NULL
      ORDER BY created_at ASC, id ASC`;
    return res.status(200).json({ pending: rows });
  }

  if (req.method === 'POST') {
    const { id, action } = await readJson(req);
    const uid = Number(id);
    if (!uid) return res.status(400).json({ error: 'id required' });
    const found = (await sql`SELECT id, registered, password_hash FROM users WHERE id = ${uid} LIMIT 1`)[0];
    if (!found) return res.status(404).json({ error: 'not found' });
    if (found.registered) return res.status(409).json({ error: '이미 승인된 사용자입니다' });
    if (!found.password_hash) return res.status(400).json({ error: '가입 신청 안 한 사용자입니다' });

    if (action === 'approve') {
      await sql`UPDATE users SET registered = TRUE WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'reject') {
      // 거부 = 신청 정보(비번/직급) 초기화 — row 자체는 유지(이름 재신청 가능하도록)
      await sql`
        UPDATE users
        SET password_hash = NULL, password_salt = NULL, tier = NULL
        WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'invalid action' });
  }

  res.setHeader('Allow', 'GET,POST');
  return res.status(405).json({ error: 'method not allowed' });
});

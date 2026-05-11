import {
  sql, ensureSchema, hashPassword, readJson, getCurrentUser,
} from '../_db.js';

// 회원가입 = 대표(admin) 가 직접 직원 계정 생성. 자기 신청 플로우 폐기.
// 호출 권한: 로그인된 admin 만. 생성 즉시 registered=TRUE.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    await ensureSchema();
    const me = await getCurrentUser(req);
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: '대표만 회원가입을 진행할 수 있습니다' });
    }
    const { name, password, tier, role } = await readJson(req);
    const nm = String(name || '').trim();
    if (!nm) return res.status(400).json({ error: '이름을 입력하세요' });
    if (nm.length > 32) return res.status(400).json({ error: '이름이 너무 깁니다 (32자 이내)' });
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: '비밀번호는 4자 이상' });
    }
    const tierN = Number(tier);
    if (![1, 2].includes(tierN)) {
      return res.status(400).json({ error: '1차직원 / 2차직원 분류를 선택하세요' });
    }
    const roleVal = role === 'manager' ? 'manager' : 'employee';

    const found = await sql`SELECT id, registered FROM users WHERE name = ${nm} LIMIT 1`;
    const { hash, salt } = hashPassword(String(password));

    if (found[0]) {
      if (found[0].registered) {
        return res.status(409).json({ error: '이미 등록된 이름입니다' });
      }
      await sql`
        UPDATE users
        SET password_hash = ${hash}, password_salt = ${salt}, tier = ${tierN},
            role = ${roleVal}, registered = TRUE, status = 'active'
        WHERE id = ${found[0].id}
      `;
    } else {
      await sql`
        INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
        VALUES (${nm}, ${hash}, ${salt}, ${roleVal}, TRUE, ${tierN}, 100, 'active')
      `;
    }
    return res.status(200).json({ ok: true, message: `${nm} 계정 생성 완료 — 즉시 로그인 가능` });
  } catch (e) {
    console.error('signup error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

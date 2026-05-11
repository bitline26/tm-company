import {
  sql, ensureSchema, hashPassword,
  readJson,
} from '../_db.js';

// 회원가입 = 신청만. 즉시 로그인 불가. 대표(관리자) 승인 후 등록 완료.
// 상태:
//   password_hash IS NULL,        registered = FALSE → 미가입(이름만 시드된 상태)
//   password_hash IS NOT NULL,    registered = FALSE → 승인 대기
//   password_hash IS NOT NULL,    registered = TRUE  → 활성
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    await ensureSchema();
    const { name, password, tier } = await readJson(req);

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

    const found = await sql`SELECT id, registered, password_hash FROM users WHERE name = ${nm} LIMIT 1`;
    const { hash, salt } = hashPassword(String(password));

    if (found[0]) {
      if (found[0].registered) {
        return res.status(409).json({ error: '이미 가입된 이름입니다' });
      }
      // 기존 row(시드 혹은 이전 미승인) → 비번/직급 갱신, 승인 대기 상태로 유지
      await sql`
        UPDATE users
        SET password_hash = ${hash}, password_salt = ${salt}, tier = ${tierN}
        WHERE id = ${found[0].id}
      `;
    } else {
      // 신규 이름 → INSERT, 승인 대기
      await sql`
        INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order)
        VALUES (${nm}, ${hash}, ${salt}, 'employee', FALSE, ${tierN}, 100)
      `;
    }

    // 세션 발급 안 함 — 승인 후 로그인 필요
    return res.status(200).json({ ok: true, pending: true,
      message: '가입 신청 완료. 관리자 승인 후 로그인할 수 있습니다.' });
  } catch (e) {
    console.error('signup error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

import { ensureSchema, getCurrentUser, sql, PRESET_NAMES } from '../_db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const user = await getCurrentUser(req);
    if (!user) {
      // 미로그인이어도 가입 가능한 직원 명단은 반환 (회원가입 화면에서 사용)
      const available = await sql`
        SELECT name FROM users WHERE registered = FALSE AND role <> 'admin' ORDER BY sort_order ASC
      `;
      return res.status(200).json({
        user: null,
        availableNames: available.map(r => r.name),
        presetNames: PRESET_NAMES,
      });
    }
    return res.status(200).json({ user });
  } catch (e) {
    console.error('me error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

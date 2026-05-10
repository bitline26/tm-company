import { getCurrentUser, ensureSchema, PRESET_NAMES } from '../_db.js';

// 핫패스 — 가능한 가볍게. 미로그인 호출(부트스트랩)이면 DB 접근 없이 즉시 응답.
export default async function handler(req, res) {
  try {
    const cookieHeader = req.headers?.cookie || '';
    if (!cookieHeader.includes('tm_session=')) {
      return res.status(200).json({
        user: null,
        availableNames: PRESET_NAMES,
        presetNames: PRESET_NAMES,
      });
    }
    await ensureSchema();
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(200).json({
        user: null,
        availableNames: PRESET_NAMES,
        presetNames: PRESET_NAMES,
      });
    }
    return res.status(200).json({ user });
  } catch (e) {
    console.error('me error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

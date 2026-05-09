import { clearSessionCookie } from '../_db.js';

export default async function handler(req, res) {
  clearSessionCookie(res);
  // 브라우저 GET 호출 시 로그인 화면으로 자동 이동 (쿠키 삭제 + 리다이렉트)
  if (req.method === 'GET') {
    res.setHeader('Location', '/both_admin/');
    return res.status(302).end();
  }
  return res.status(200).json({ ok: true });
}

import { clearSessionCookie } from '../_db.js';

export default async function handler(req, res) {
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}

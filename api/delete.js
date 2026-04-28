import { sql, ensureSchema } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { id, all } = body;

    if (all === true) {
      await sql`TRUNCATE applications RESTART IDENTITY`;
      return res.status(200).json({ ok: true, mode: 'all' });
    }
    const numId = Number(id);
    if (!numId || !Number.isInteger(numId)) return res.status(400).json({ error: 'invalid id' });
    await sql`DELETE FROM applications WHERE id = ${numId}`;
    return res.status(200).json({ ok: true, id: numId });
  } catch (e) {
    console.error('delete error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

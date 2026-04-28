import { sql, ensureSchema } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, source, name, phone, carrier, model, created_at
      FROM applications
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: rows });
  } catch (e) {
    console.error('list error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

import { sql, ensureSchema } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { source, name, phone, carrier, model } = body;

    if (!source || (source !== 'A' && source !== 'B')) return res.status(400).json({ error: 'invalid source' });
    if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'invalid name' });
    if (!phone || String(phone).length < 9) return res.status(400).json({ error: 'invalid phone' });

    const rows = await sql`
      INSERT INTO applications (source, name, phone, carrier, model)
      VALUES (${source}, ${String(name).trim()}, ${String(phone).trim()}, ${carrier || null}, ${model || null})
      RETURNING id, created_at
    `;
    return res.status(200).json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
  } catch (e) {
    console.error('submit error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

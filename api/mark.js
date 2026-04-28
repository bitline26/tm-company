import { sql, ensureSchema } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { ids, downloaded } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const numIds = ids.map(Number).filter(function(n){ return Number.isInteger(n) && n > 0; });
    if (numIds.length === 0) return res.status(400).json({ error: 'no valid ids' });

    if (downloaded === false) {
      await sql`UPDATE applications SET downloaded_at = NULL WHERE id = ANY(${numIds})`;
      return res.status(200).json({ ok: true, count: numIds.length, mode: 'unmark' });
    } else {
      await sql`UPDATE applications SET downloaded_at = NOW() WHERE id = ANY(${numIds}) AND downloaded_at IS NULL`;
      return res.status(200).json({ ok: true, count: numIds.length, mode: 'mark' });
    }
  } catch (e) {
    console.error('mark error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

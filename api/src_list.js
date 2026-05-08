import { sql, ensureSchema } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT
        s.id, s.code, s.label, s.vendor, s.color, s.active, s.sort_order,
        (SELECT COUNT(*)::int FROM db_pool p WHERE p.source_id = s.id) AS pool_count
      FROM db_sources s
      ORDER BY s.sort_order, s.id
    `;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: rows });
  } catch (e) {
    console.error('src_list error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

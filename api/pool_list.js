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
        p.id, p.name, p.phone, p.carrier, p.model,
        p.upload_batch, p.inflow_at, p.assigned_to, p.assigned_at, p.status,
        s.code AS source_code, s.label AS source_label, s.color AS source_color,
        e.name AS assigned_name
      FROM db_pool p
      JOIN db_sources s ON s.id = p.source_id
      LEFT JOIN employees e ON e.id = p.assigned_to
      WHERE p.status != 'DELETED'
      ORDER BY p.inflow_at DESC
      LIMIT 5000
    `;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: rows });
  } catch (e) {
    console.error('pool_list error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

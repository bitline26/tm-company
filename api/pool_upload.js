import { sql, ensureSchema } from './_db.js';

// 엑셀에서 파싱된 행 배열을 풀에 적재
// body: { source_id, batch_label, rows: [{name, phone, carrier, model, ...}] }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const { source_id, batch_label, rows } = req.body || {};
    if (!source_id) return res.status(400).json({ error: 'source_id required' });
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows required (non-empty array)' });
    }

    const src = await sql`SELECT id, label FROM db_sources WHERE id = ${source_id} LIMIT 1`;
    if (!src[0]) return res.status(404).json({ error: 'source not found' });

    const batch = batch_label || ('UPLOAD_' + new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-'));

    let inserted = 0;
    let skipped = 0;
    for (const r of rows) {
      const name = String(r.name || '').trim();
      const phone = String(r.phone || '').trim();
      if (!name || !phone) { skipped++; continue; }
      const carrier = r.carrier ? String(r.carrier).trim() : null;
      const model = r.model ? String(r.model).trim() : null;
      const extra = r.extra ? r.extra : null;
      await sql`
        INSERT INTO db_pool (source_id, upload_batch, name, phone, carrier, model, extra_json)
        VALUES (${source_id}, ${batch}, ${name}, ${phone}, ${carrier}, ${model}, ${extra ? JSON.stringify(extra) : null})
      `;
      inserted++;
    }

    return res.status(200).json({ ok: true, batch, inserted, skipped, source: src[0].label });
  } catch (e) {
    console.error('pool_upload error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

import { sql, ensureSchema } from './_db.js';

// 엑셀에서 파싱된 행 배열을 풀에 적재 — 단일 SQL UNNEST batch insert (1번 round-trip)
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

    // 정규화 + 빈 행 필터
    const valid = [];
    let skipped = 0;
    for (const r of rows) {
      const name = String(r.name || '').trim();
      const phone = String(r.phone || '').trim();
      if (!name || !phone) { skipped++; continue; }
      valid.push({
        name,
        phone,
        carrier: r.carrier ? String(r.carrier).trim() : null,
        model: r.model ? String(r.model).trim() : null,
      });
    }

    if (valid.length === 0) {
      return res.status(200).json({ ok: true, batch, inserted: 0, skipped, source: src[0].label });
    }

    // 단일 INSERT — UNNEST로 N행을 한 번에 (round-trip 1회)
    const names = valid.map(v => v.name);
    const phones = valid.map(v => v.phone);
    const carriers = valid.map(v => v.carrier);
    const models = valid.map(v => v.model);

    await sql`
      INSERT INTO db_pool (source_id, upload_batch, name, phone, carrier, model)
      SELECT ${source_id}, ${batch}, n, p, c, m
      FROM unnest(${names}::text[], ${phones}::text[], ${carriers}::text[], ${models}::text[]) AS t(n, p, c, m)
    `;

    return res.status(200).json({
      ok: true, batch,
      inserted: valid.length, skipped,
      source: src[0].label
    });
  } catch (e) {
    console.error('pool_upload error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

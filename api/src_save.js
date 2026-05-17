import { sql, ensureSchema } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const { id, code, label, vendor, color, active } = req.body || {};

    if (id) {
      // 수정
      await sql`
        UPDATE db_sources
        SET label = ${label || ''},
            vendor = ${vendor || null},
            color = ${color || '#888'},
            active = ${active === false ? false : true}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, id });
    }

    // 신규
    if (!code || !label) {
      return res.status(400).json({ error: 'code, label required' });
    }
    const max = await sql`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM db_sources`;
    const next = max[0]?.next || 0;
    const ins = await sql`
      INSERT INTO db_sources (code, label, vendor, color, sort_order)
      VALUES (${code}, ${label}, ${vendor || null}, ${color || '#888'}, ${next})
      RETURNING id
    `;
    return res.status(200).json({ ok: true, id: ins[0]?.id });
  } catch (e) {
    console.error('src_save error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

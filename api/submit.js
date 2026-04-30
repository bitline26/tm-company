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

    if (process.env.RESEND_API_KEY) {
      const campaign = source === 'A' ? 'KPI' : 'Demand';
      const safeName = String(name).trim();
      const safePhone = String(phone).trim();
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'GalaxySale <onboarding@resend.dev>',
          to: ['ami981001@gmail.com'],
          subject: `[신규 신청] ${campaign} - ${safeName}`,
          html: `<h2>신규 신청 들어왔습니다 (미다운로드)</h2>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:6px 12px;background:#f3f4f6"><b>캠페인</b></td><td style="padding:6px 12px">${campaign} (source=${source})</td></tr>
<tr><td style="padding:6px 12px;background:#f3f4f6"><b>이름</b></td><td style="padding:6px 12px">${safeName}</td></tr>
<tr><td style="padding:6px 12px;background:#f3f4f6"><b>연락처</b></td><td style="padding:6px 12px">${safePhone}</td></tr>
<tr><td style="padding:6px 12px;background:#f3f4f6"><b>통신사</b></td><td style="padding:6px 12px">${carrier || '-'}</td></tr>
<tr><td style="padding:6px 12px;background:#f3f4f6"><b>기종</b></td><td style="padding:6px 12px">${model || '-'}</td></tr>
<tr><td style="padding:6px 12px;background:#f3f4f6"><b>ID</b></td><td style="padding:6px 12px">${rows[0].id}</td></tr>
<tr><td style="padding:6px 12px;background:#f3f4f6"><b>시각</b></td><td style="padding:6px 12px">${rows[0].created_at}</td></tr>
</table>
<p style="margin-top:16px"><a href="https://galaxysale.co.kr/both_admin/" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">어드민 열기</a></p>`,
        }),
      }).catch(err => console.error('resend error:', err));
    }

    return res.status(200).json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
  } catch (e) {
    console.error('submit error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

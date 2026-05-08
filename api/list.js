import { sql, ensureSchema } from './_db.js';

// 통합 리스트: 자체광고(applications) + 업체 업로드(db_pool) 모두 반환
// 각 항목은 같은 형태로 정규화: id, source(A/B), source_code, source_label, source_color,
//                                name, phone, carrier, model, created_at(=유입일시), downloaded_at
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();

    // 1. 자체광고 (KPI/Demand) — 기존 applications 테이블
    const apps = await sql`
      SELECT id, source, name, phone, carrier, model, created_at, downloaded_at
      FROM applications
      ORDER BY created_at DESC
      LIMIT 5000
    `;

    // 2. 업체 업로드 + 자체광고 통합 풀 — db_pool 테이블 (KEY: inflow_at = 유입/업로드 일시)
    const pool = await sql`
      SELECT
        p.id,
        p.name, p.phone, p.carrier, p.model,
        p.upload_batch, p.inflow_at, p.assigned_to, p.assigned_at, p.status,
        s.code AS source_code, s.label AS source_label, s.color AS source_color
      FROM db_pool p
      JOIN db_sources s ON s.id = p.source_id
      WHERE p.status != 'DELETED'
      ORDER BY p.inflow_at DESC
      LIMIT 5000
    `;

    // 정규화: 둘 다 동일 형태로
    const normalizedApps = apps.map(a => ({
      id: 'A' + a.id,
      origin: 'application',
      source: a.source,                                // 'A' or 'B' (legacy)
      source_code: a.source === 'A' ? 'SELF_KPI' : 'SELF_DEMAND',
      source_label: a.source === 'A' ? 'KPI(자체)' : 'Demand(자체)',
      source_color: a.source === 'A' ? '#7c3aed' : '#0ea5e9',
      name: a.name,
      phone: a.phone,
      carrier: a.carrier,
      model: a.model,
      created_at: a.created_at,         // 유입 일시
      downloaded_at: a.downloaded_at,
      assigned_name: null,
      status: a.downloaded_at ? 'DONE' : 'NEW'
    }));

    const normalizedPool = pool.map(p => ({
      id: 'P' + p.id,
      origin: 'pool',
      source: p.source_code === 'SELF' ? 'A' : 'X',     // legacy mapping
      source_code: p.source_code,
      source_label: p.source_label,
      source_color: p.source_color,
      name: p.name,
      phone: p.phone,
      carrier: p.carrier,
      model: p.model,
      created_at: p.inflow_at,          // 유입 일시 = 업로드 일시
      downloaded_at: p.assigned_at,     // 분배 = 다운/처리됨 으로 매핑
      assigned_name: null,
      status: p.status,
      upload_batch: p.upload_batch
    }));

    // 합쳐서 시간역순
    const merged = [...normalizedApps, ...normalizedPool]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5000);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: merged });
  } catch (e) {
    console.error('list error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

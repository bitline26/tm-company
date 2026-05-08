import { sql, ensureSchema } from './_db.js';

// POST /api/distribute_save
// body: { date: "2026-05-08", allocations: [{employee_id, count}, ...] }
// 효과: 그날 NEW 디비를 employee_id별 count 만큼 차례로 배정
//       db_pool.assigned_to=emp, assigned_at=NOW(), status='ASSIGNED'
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { date, allocations } = body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date YYYY-MM-DD required' });
    }
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ error: 'allocations required' });
    }

    // 그날 NEW 풀 ID 가져오기 (id 오름차순)
    const totalNeeded = allocations.reduce((s, a) => s + Number(a.count || 0), 0);
    if (totalNeeded <= 0) {
      return res.status(400).json({ error: 'allocations sum must be > 0' });
    }
    const pool = await sql`
      SELECT id FROM db_pool
      WHERE status = 'NEW' AND inflow_at::date = ${date}::date
      ORDER BY id
      LIMIT ${totalNeeded}
    `;
    if (pool.length === 0) {
      return res.status(400).json({ error: 'no NEW pool items for this date' });
    }

    // employee_id별 풀 ID 묶어서 단일 UPDATE (UNNEST 활용)
    const poolIds = [];
    const empIds = [];
    let pIdx = 0;
    for (const alloc of allocations) {
      const cnt = Math.min(Number(alloc.count || 0), pool.length - pIdx);
      for (let i = 0; i < cnt; i++) {
        poolIds.push(pool[pIdx].id);
        empIds.push(alloc.employee_id);
        pIdx++;
      }
      if (pIdx >= pool.length) break;
    }

    if (poolIds.length === 0) {
      return res.status(400).json({ error: 'nothing to assign' });
    }

    // 단일 UPDATE — UNNEST + JOIN으로 ID별 다른 값 적용
    await sql`
      UPDATE db_pool p
      SET assigned_to = u.emp_id,
          assigned_at = NOW(),
          status = 'ASSIGNED'
      FROM unnest(${poolIds}::int[], ${empIds}::int[]) AS u(pid, emp_id)
      WHERE p.id = u.pid AND p.status = 'NEW'
    `;

    return res.status(200).json({
      ok: true, date,
      assigned: poolIds.length,
      requested: totalNeeded,
      remaining_in_pool: pool.length - poolIds.length
    });
  } catch (e) {
    console.error('distribute_save error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

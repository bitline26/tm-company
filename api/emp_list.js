import { sql, ensureSchema, DEPT_ORDER } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, name, dept, sort_order, active
      FROM employees
      WHERE active = TRUE
      ORDER BY sort_order, id
    `;
    // 부서 순서 적용
    const deptIndex = (d) => {
      const i = DEPT_ORDER.indexOf(d);
      return i === -1 ? 99 : i;
    };
    rows.sort((a, b) => deptIndex(a.dept) - deptIndex(b.dept) || a.sort_order - b.sort_order);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: rows, dept_order: DEPT_ORDER });
  } catch (e) {
    console.error('emp_list error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

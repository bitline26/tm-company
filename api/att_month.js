import { sql, ensureSchema, DEPT_ORDER } from './_db.js';

// 월 단위 근태 조회
// GET /api/att_month?ym=2026-05
// 반환: { year, month, days, employees: [...], cells: { "emp_id|YYYY-MM-DD": {status, ratio, note} } }
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const ym = String(req.query.ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!ym) return res.status(400).json({ error: 'ym query required, format YYYY-MM' });
    const year = Number(ym[1]);
    const month = Number(ym[2]);
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(year, month, 0).getDate(); // 해당 월의 마지막 날
    const lastDate = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;

    const employees = await sql`
      SELECT id, name, dept, sort_order
      FROM employees
      WHERE active = TRUE
      ORDER BY sort_order, id
    `;
    // 부서순 재정렬
    const deptIdx = (d) => {
      const i = DEPT_ORDER.indexOf(d);
      return i === -1 ? 99 : i;
    };
    employees.sort((a, b) => deptIdx(a.dept) - deptIdx(b.dept) || a.sort_order - b.sort_order);

    const rows = await sql`
      SELECT employee_id, work_date, status, ratio, note
      FROM attendance
      WHERE work_date >= ${first} AND work_date <= ${lastDate}
    `;
    const cells = {};
    for (const r of rows) {
      const d = (r.work_date instanceof Date) ? r.work_date : new Date(r.work_date);
      const ds = d.toISOString().slice(0, 10);
      cells[`${r.employee_id}|${ds}`] = { status: r.status, ratio: r.ratio, note: r.note || '' };
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true, year, month, days: last,
      employees, cells, dept_order: DEPT_ORDER
    });
  } catch (e) {
    console.error('att_month error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

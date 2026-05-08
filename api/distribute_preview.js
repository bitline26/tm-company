import { sql, ensureSchema, statusToRatio } from './_db.js';

// GET /api/distribute_preview?date=2026-05-08&group=영업
// 반환: {
//   date, weekday(0=일~6=토), is_weekend, is_holiday,
//   pool: [{source_id, code, label, color, cnt}], total_pool,
//   employees: [{id, name, dept, status, ratio}], total_weight
// }
const KOREAN_HOLIDAYS = {
  '2026-01-01': true, '2026-02-16': true, '2026-02-17': true, '2026-02-18': true,
  '2026-03-01': true, '2026-05-05': true, '2026-05-25': true,
  '2026-06-06': true, '2026-08-15': true, '2026-09-25': true, '2026-09-26': true, '2026-09-27': true,
  '2026-10-03': true, '2026-10-09': true, '2026-12-25': true
};

// 영업(1차)만 TM으로 잡음. 필요 시 query param group으로 바꿀 수 있음.
const TM_DEPTS_DEFAULT = ['1차'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : null;
    if (!date) return res.status(400).json({ error: 'date YYYY-MM-DD required' });
    const groupQ = req.query.group;
    const tmDepts = groupQ ? String(groupQ).split(',') : TM_DEPTS_DEFAULT;

    const dateObj = new Date(date + 'T00:00:00');
    const weekday = dateObj.getDay();
    const isWeekend = (weekday === 0 || weekday === 6);
    const isHoliday = !!KOREAN_HOLIDAYS[date];

    // 1. TM 직원 (대상 부서)
    const allEmps = await sql`
      SELECT id, name, dept, sort_order
      FROM employees
      WHERE active = TRUE
      ORDER BY sort_order, id
    `;
    const empsTM = allEmps.filter(e => tmDepts.includes(e.dept));

    // 2. 그날 attendance 조회
    const attRows = await sql`
      SELECT employee_id, status, ratio
      FROM attendance
      WHERE work_date = ${date}
    `;
    const attMap = {};
    attRows.forEach(a => { attMap[a.employee_id] = a; });

    // 3. 직원별 ratio 결정: attendance 있으면 그것, 없으면 기본 WORK(주말/공휴일 0)
    const employees = empsTM.map(e => {
      const a = attMap[e.id];
      let status, ratio;
      if (a) {
        status = a.status;
        ratio = a.ratio;
      } else if (isWeekend) {
        status = 'WEEKEND'; ratio = 0;
      } else if (isHoliday) {
        status = 'HOLIDAY'; ratio = 0;
      } else {
        status = 'WORK'; ratio = 1.0;
      }
      return { id: e.id, name: e.name, dept: e.dept, status, ratio };
    });

    const totalWeight = employees.reduce((s, e) => s + (e.ratio || 0), 0);

    // 4. 그날 들어온 NEW 디비 (소스별)
    const pool = await sql`
      SELECT s.id AS source_id, s.code, s.label, s.color, COUNT(*)::int AS cnt
      FROM db_pool p
      JOIN db_sources s ON s.id = p.source_id
      WHERE p.status = 'NEW' AND p.inflow_at::date = ${date}::date
      GROUP BY s.id, s.code, s.label, s.color, s.sort_order
      ORDER BY s.sort_order, s.id
    `;
    const totalPool = pool.reduce((sum, r) => sum + Number(r.cnt), 0);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true, date, weekday, is_weekend: isWeekend, is_holiday: isHoliday,
      pool, total_pool: totalPool,
      employees, total_weight: totalWeight
    });
  } catch (e) {
    console.error('distribute_preview error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

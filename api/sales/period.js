import { sql, requireAuth, readJson } from '../_db.js';

// /api/sales/period?ym=2026-05
//   GET  → 월 기간/단가/총근무일 (없으면 자동 생성: 평일=총근무일, 단가=0)
//   POST {ym, start_date, end_date, total_workdays, unit_price, off_dates[]}
//        → upsert (admin/manager only)
function weekdaysInMonth(y, m) {
  const dim = new Date(y, m, 0).getDate();
  let cnt = 0;
  for (let d = 1; d <= dim; d++) {
    const dow = new Date(y, m-1, d).getDay();
    if (dow !== 0 && dow !== 6) cnt++;
  }
  return cnt;
}

export default requireAuth(async function handler(req, res) {
  const me = req.user;
  const isPriv = me.role === 'admin' || me.role === 'manager';

  if (req.method === 'GET') {
    const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
    if (!ym) return res.status(400).json({ error: 'ym required' });
    let rows = await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`;
    if (!rows[0]) {
      // 자동 생성
      const [y,m] = ym.split('-').map(Number);
      const dim = new Date(y, m, 0).getDate();
      const startDate = `${ym}-01`;
      const endDate = `${ym}-${String(dim).padStart(2,'0')}`;
      const wd = weekdaysInMonth(y, m);
      rows = await sql`
        INSERT INTO sales_period (year_month, start_date, end_date, total_workdays, unit_price)
        VALUES (${ym}, ${startDate}, ${endDate}, ${wd}, 0)
        ON CONFLICT (year_month) DO NOTHING
        RETURNING *
      `;
      if (!rows[0]) {
        rows = await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`;
      }
    }
    return res.status(200).json({ period: rows[0] });
  }

  if (!isPriv) return res.status(403).json({ error: '관리자 전용' });

  if (req.method === 'POST') {
    const b = await readJson(req);
    const ym = String(b.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
    if (!ym) return res.status(400).json({ error: 'ym required' });
    const offDates = Array.isArray(b.off_dates) ? b.off_dates : [];
    const rows = await sql`
      INSERT INTO sales_period (year_month, start_date, end_date, total_workdays, unit_price, off_dates, note, updated_at)
      VALUES (${ym}, ${b.start_date || null}, ${b.end_date || null},
              ${Number(b.total_workdays || 0)}, ${BigInt(Math.round(Number(b.unit_price || 0)))},
              ${offDates}, ${b.note || null}, NOW())
      ON CONFLICT (year_month) DO UPDATE SET
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        total_workdays = EXCLUDED.total_workdays,
        unit_price = EXCLUDED.unit_price,
        off_dates = EXCLUDED.off_dates,
        note = EXCLUDED.note,
        updated_at = NOW()
      RETURNING *
    `;
    return res.status(200).json({ ok: true, period: rows[0] });
  }

  res.setHeader('Allow', 'GET,POST');
  return res.status(405).json({ error: 'method not allowed' });
});

import { sql, requireAuth } from '../_db.js';

// /api/sales/tm-summary?ym=2026-05&cutoff=2026-05-08
//   요청 2 — TM × 월 누적 자동 집계
//   응답: { period, users, rows: [{user_id, name, off_days, total_count, total_db, ...}], totals }
//   - total_count = sales_orders 에서 PAID/PARTIAL/IN_PROGRESS 합 (취소 제외)
//   - total_db    = sales_tm_daily.db_count 누적
//   - off_days    = sales_tm_daily.is_off OR attendance_records 휴무 union (negative)
//   - 일평균 / 디비평균 / 효율 / 마감예상 / 매출 — 클라이언트에서 계산 (수식 투명성)
export default requireAuth(async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const me = req.user;
  const isPriv = me.role === 'admin' || me.role === 'manager';

  const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
  if (!ym) return res.status(400).json({ error: 'ym required' });

  const start = `${ym}-01`;
  const [y,m] = ym.split('-').map(Number);
  const ny = m === 12 ? y+1 : y;
  const nm = m === 12 ? 1 : m+1;
  const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
  const cutoff = String(req.query.cutoff || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
    || new Date().toISOString().slice(0,10);

  // 1) Period
  let period = (await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`)[0];
  if (!period) {
    // 자동 생성 (weekdays default)
    const dim = new Date(y, m, 0).getDate();
    let wd = 0;
    for (let d = 1; d <= dim; d++) {
      const dow = new Date(y, m-1, d).getDay();
      if (dow !== 0 && dow !== 6) wd++;
    }
    const ins = await sql`
      INSERT INTO sales_period (year_month, start_date, end_date, total_workdays, unit_price)
      VALUES (${ym}, ${start}, ${`${ym}-${String(dim).padStart(2,'0')}`}, ${wd}, 0)
      ON CONFLICT (year_month) DO NOTHING
      RETURNING *
    `;
    period = ins[0] || (await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`)[0];
  }

  // 2) Users (요청 시 본인만 / admin·manager는 전체)
  const users = isPriv
    ? await sql`SELECT id, name, role FROM users WHERE role <> 'admin' ORDER BY sort_order ASC, id ASC`
    : [{ id: me.id, name: me.name, role: me.role }];
  const userIds = users.map(u=>u.id);

  // 3) Orders 합 (취소 제외, cutoff까지) — 수금 안 된 건도 마감으로 카운트할지는 정책: 여기선 status != CANCELLED
  const orderAgg = userIds.length ? await sql`
    SELECT tm_user_id AS user_id,
           COUNT(*)::int AS cnt,
           COALESCE(SUM(amount),0)::bigint AS amount_sum
    FROM sales_orders
    WHERE consult_date >= ${start} AND consult_date <= ${cutoff}
      AND status <> 'CANCELLED'
      AND tm_user_id = ANY(${userIds})
    GROUP BY tm_user_id
  ` : [];

  // 4) sales_tm_daily 합 (db_count, is_off)
  const tmAgg = userIds.length ? await sql`
    SELECT user_id,
           COALESCE(SUM(db_count),0)::int AS db_sum,
           COALESCE(SUM(CASE WHEN is_off THEN 1 ELSE 0 END),0)::int AS off_days
    FROM sales_tm_daily
    WHERE work_date >= ${start} AND work_date <= ${cutoff}
      AND user_id = ANY(${userIds})
    GROUP BY user_id
  ` : [];

  // 5) attendance_records 휴무 (요청 1과 연계 — APPROVED 휴무성 type)
  const attAgg = userIds.length ? await sql`
    SELECT user_id,
           COALESCE(SUM(CASE
             WHEN type IN ('OFF','MONTHLY','ANNUAL','SICK','HOLIDAY') THEN 1
             WHEN type IN ('HALF_AM','HALF_PM') THEN 0   -- 반차는 별도(0.5는 클라이언트에서)
             ELSE 0 END),0)::int AS att_off,
           COALESCE(SUM(CASE WHEN type IN ('HALF_AM','HALF_PM') THEN 1 ELSE 0 END),0)::int AS att_half
    FROM attendance_records
    WHERE work_date >= ${start} AND work_date <= ${cutoff}
      AND status = 'APPROVED'
      AND user_id = ANY(${userIds})
    GROUP BY user_id
  ` : [];

  // 인덱스 빌드
  const orderMap = {}; orderAgg.forEach(r => orderMap[r.user_id] = r);
  const tmMap = {};    tmAgg.forEach(r => tmMap[r.user_id] = r);
  const attMap = {};   attAgg.forEach(r => attMap[r.user_id] = r);

  // 6) 응답 행
  const rows = users.map(u => {
    const o = orderMap[u.id] || { cnt: 0, amount_sum: 0 };
    const t = tmMap[u.id] || { db_sum: 0, off_days: 0 };
    const a = attMap[u.id] || { att_off: 0, att_half: 0 };
    return {
      user_id: u.id,
      name: u.name,
      role: u.role,
      total_count: o.cnt,                                 // 마감 건수
      amount_sum: Number(o.amount_sum),                   // 매출 합 (orders 기준)
      total_db: t.db_sum,                                 // 총 디비 (sales_tm_daily 입력)
      // 휴무 = sales_tm_daily.is_off + 근태 휴무(승인). 반차는 0.5 (클라이언트에서 처리)
      off_days: t.off_days + a.att_off,
      half_days: a.att_half,
    };
  });

  // 7) 실근무일 = period.start_date~cutoff 사이의 평일 - off_dates 교집합
  let elapsedWorkdays = 0;
  const offDates = new Set((period?.off_dates || []).map(d => String(d).slice(0,10)));
  const startDt = new Date(start + 'T00:00:00');
  const cutDt = new Date(cutoff + 'T00:00:00');
  for (let d = new Date(startDt); d <= cutDt; d.setDate(d.getDate()+1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const ymd = d.toISOString().slice(0,10);
    if (offDates.has(ymd)) continue;
    elapsedWorkdays++;
  }
  const totalWorkdays = period?.total_workdays || 0;
  const remainingWorkdays = Math.max(0, totalWorkdays - elapsedWorkdays);

  return res.status(200).json({
    ym, cutoff,
    period,
    elapsedWorkdays,
    remainingWorkdays,
    totalWorkdays,
    rows,
  });
});

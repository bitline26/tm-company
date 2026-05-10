// 영업 모듈 통합 디스패처 (Vercel 함수 수 절감 — 1 function)
// /api/sales/orders, /api/sales/vendors, /api/sales/period,
// /api/sales/tm-summary, /api/sales/tm-daily, /api/sales/vendor-daily
import { sql, requireAuth, readJson } from '../_db.js';

const ORDER_STATUS = new Set(['PAID','IN_PROGRESS','UNPAID','PARTIAL','CANCELLED']);

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
  const op = String(req.query.op || '').toLowerCase();
  const me = req.user;
  const isPriv = me.role === 'admin' || me.role === 'manager';

  // ───────── orders ─────────
  if (op === 'orders') {
    if (req.method === 'GET') {
      const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
      let rows;
      if (ym) {
        const start = `${ym}-01`;
        const [y,m] = ym.split('-').map(Number);
        const ny = m === 12 ? y+1 : y;
        const nm = m === 12 ? 1 : m+1;
        const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
        rows = isPriv
          ? await sql`
              SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label,
                     v.parent_label, v.color AS vendor_color
              FROM sales_orders o
              LEFT JOIN users u ON u.id = o.tm_user_id
              LEFT JOIN db_vendors v ON v.id = o.vendor_id
              WHERE o.consult_date >= ${start} AND o.consult_date < ${end}
              ORDER BY o.consult_date DESC, o.id DESC`
          : await sql`
              SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label,
                     v.parent_label, v.color AS vendor_color
              FROM sales_orders o
              LEFT JOIN users u ON u.id = o.tm_user_id
              LEFT JOIN db_vendors v ON v.id = o.vendor_id
              WHERE o.consult_date >= ${start} AND o.consult_date < ${end}
                AND o.tm_user_id = ${me.id}
              ORDER BY o.consult_date DESC, o.id DESC`;
      } else {
        rows = isPriv
          ? await sql`
              SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label,
                     v.parent_label, v.color AS vendor_color
              FROM sales_orders o
              LEFT JOIN users u ON u.id = o.tm_user_id
              LEFT JOIN db_vendors v ON v.id = o.vendor_id
              ORDER BY o.consult_date DESC, o.id DESC LIMIT 500`
          : await sql`
              SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label,
                     v.parent_label, v.color AS vendor_color
              FROM sales_orders o
              LEFT JOIN users u ON u.id = o.tm_user_id
              LEFT JOIN db_vendors v ON v.id = o.vendor_id
              WHERE o.tm_user_id = ${me.id}
              ORDER BY o.consult_date DESC, o.id DESC LIMIT 500`;
      }
      return res.status(200).json({ orders: rows });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const status = b.status && ORDER_STATUS.has(b.status) ? b.status : 'UNPAID';
      const tmId = b.tm_user_id || (isPriv ? null : me.id);
      if (!isPriv && tmId !== me.id) return res.status(403).json({ error: '본인 행만 입력 가능' });
      if (b.id) {
        const own = await sql`SELECT tm_user_id FROM sales_orders WHERE id = ${b.id} LIMIT 1`;
        if (!own[0]) return res.status(404).json({ error: 'not found' });
        if (!isPriv && own[0].tm_user_id !== me.id) return res.status(403).json({ error: '권한 없음' });
        const rows = await sql`
          UPDATE sales_orders SET
            tm_user_id = ${tmId}, vendor_id = ${b.vendor_id || null},
            customer_name = ${b.customer_name || null}, customer_phone = ${b.customer_phone || null},
            carrier = ${b.carrier || null}, consult_date = ${b.consult_date || null},
            payment_bank = ${b.payment_bank || null}, payment_account = ${b.payment_account || null},
            amount = ${Number(b.amount || 0)}, payment_date = ${b.payment_date || null},
            status = ${status}, note = ${b.note || null}, updated_at = NOW()
          WHERE id = ${b.id} RETURNING *`;
        return res.status(200).json({ ok: true, order: rows[0] });
      }
      const rows = await sql`
        INSERT INTO sales_orders
          (tm_user_id, vendor_id, customer_name, customer_phone, carrier, consult_date,
           payment_bank, payment_account, amount, payment_date, status, note)
        VALUES
          (${tmId}, ${b.vendor_id || null}, ${b.customer_name || null}, ${b.customer_phone || null},
           ${b.carrier || null}, ${b.consult_date || null}, ${b.payment_bank || null},
           ${b.payment_account || null}, ${Number(b.amount || 0)}, ${b.payment_date || null},
           ${status}, ${b.note || null})
        RETURNING *`;
      const enriched = await sql`
        SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label,
               v.parent_label, v.color AS vendor_color
        FROM sales_orders o
        LEFT JOIN users u ON u.id = o.tm_user_id
        LEFT JOIN db_vendors v ON v.id = o.vendor_id
        WHERE o.id = ${rows[0].id} LIMIT 1`;
      return res.status(200).json({ ok: true, order: enriched[0] });
    }
    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const own = await sql`SELECT tm_user_id FROM sales_orders WHERE id = ${id} LIMIT 1`;
      if (!own[0]) return res.status(404).json({ error: 'not found' });
      if (!isPriv && own[0].tm_user_id !== me.id) return res.status(403).json({ error: '권한 없음' });
      await sql`DELETE FROM sales_orders WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET,POST,DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  }

  // ───────── vendors ─────────
  if (op === 'vendors') {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, code, label, parent_label, color, sort_order, active, note
        FROM db_vendors ORDER BY active DESC, sort_order ASC, id ASC`;
      return res.status(200).json({ vendors: rows });
    }
    if (!isPriv) return res.status(403).json({ error: '관리자 전용' });
    if (req.method === 'POST') {
      const b = await readJson(req);
      if (!b.code || !b.label) return res.status(400).json({ error: 'code/label 필수' });
      if (b.id) {
        const rows = await sql`
          UPDATE db_vendors SET code=${b.code}, label=${b.label}, parent_label=${b.parent_label||null},
            color=${b.color||'#9b9a97'}, sort_order=${Number(b.sort_order||0)}, active=${b.active!==false},
            note=${b.note||null}
          WHERE id = ${b.id} RETURNING *`;
        return res.status(200).json({ ok: true, vendor: rows[0] });
      }
      const rows = await sql`
        INSERT INTO db_vendors (code, label, parent_label, color, sort_order, note)
        VALUES (${b.code}, ${b.label}, ${b.parent_label||null}, ${b.color||'#9b9a97'},
                ${Number(b.sort_order||0)}, ${b.note||null}) RETURNING *`;
      return res.status(200).json({ ok: true, vendor: rows[0] });
    }
    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`UPDATE db_vendors SET active = FALSE WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET,POST,DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  }

  // ───────── period ─────────
  if (op === 'period') {
    if (req.method === 'GET') {
      const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
      if (!ym) return res.status(400).json({ error: 'ym required' });
      let rows = await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`;
      if (!rows[0]) {
        const [y,m] = ym.split('-').map(Number);
        const dim = new Date(y, m, 0).getDate();
        rows = await sql`
          INSERT INTO sales_period (year_month, start_date, end_date, total_workdays, unit_price)
          VALUES (${ym}, ${`${ym}-01`}, ${`${ym}-${String(dim).padStart(2,'0')}`}, ${weekdaysInMonth(y,m)}, 0)
          ON CONFLICT (year_month) DO NOTHING RETURNING *`;
        if (!rows[0]) rows = await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`;
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
        VALUES (${ym}, ${b.start_date||null}, ${b.end_date||null},
                ${Number(b.total_workdays||0)}, ${BigInt(Math.round(Number(b.unit_price||0)))},
                ${offDates}, ${b.note||null}, NOW())
        ON CONFLICT (year_month) DO UPDATE SET
          start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
          total_workdays = EXCLUDED.total_workdays, unit_price = EXCLUDED.unit_price,
          off_dates = EXCLUDED.off_dates, note = EXCLUDED.note, updated_at = NOW()
        RETURNING *`;
      return res.status(200).json({ ok: true, period: rows[0] });
    }
    res.setHeader('Allow', 'GET,POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  // ───────── tm-summary ─────────
  if (op === 'tm-summary') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
    if (!ym) return res.status(400).json({ error: 'ym required' });
    const start = `${ym}-01`;
    const [y,m] = ym.split('-').map(Number);
    const ny = m === 12 ? y+1 : y;
    const nm = m === 12 ? 1 : m+1;
    const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
    const cutoff = String(req.query.cutoff || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
      || new Date().toISOString().slice(0,10);

    let period = (await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`)[0];
    if (!period) {
      const dim = new Date(y, m, 0).getDate();
      const ins = await sql`
        INSERT INTO sales_period (year_month, start_date, end_date, total_workdays, unit_price)
        VALUES (${ym}, ${start}, ${`${ym}-${String(dim).padStart(2,'0')}`}, ${weekdaysInMonth(y,m)}, 0)
        ON CONFLICT (year_month) DO NOTHING RETURNING *`;
      period = ins[0] || (await sql`SELECT * FROM sales_period WHERE year_month = ${ym} LIMIT 1`)[0];
    }

    const users = isPriv
      ? await sql`SELECT id, name, role FROM users WHERE role <> 'admin' ORDER BY sort_order ASC, id ASC`
      : [{ id: me.id, name: me.name, role: me.role }];
    const userIds = users.map(u=>u.id);

    const orderAgg = userIds.length ? await sql`
      SELECT tm_user_id AS user_id, COUNT(*)::int AS cnt, COALESCE(SUM(amount),0)::bigint AS amount_sum
      FROM sales_orders
      WHERE consult_date >= ${start} AND consult_date <= ${cutoff}
        AND status <> 'CANCELLED' AND tm_user_id = ANY(${userIds})
      GROUP BY tm_user_id` : [];
    const tmAgg = userIds.length ? await sql`
      SELECT user_id, COALESCE(SUM(db_count),0)::int AS db_sum,
             COALESCE(SUM(CASE WHEN is_off THEN 1 ELSE 0 END),0)::int AS off_days
      FROM sales_tm_daily
      WHERE work_date >= ${start} AND work_date <= ${cutoff} AND user_id = ANY(${userIds})
      GROUP BY user_id` : [];
    const attAgg = userIds.length ? await sql`
      SELECT user_id,
             COALESCE(SUM(CASE WHEN type IN ('OFF','MONTHLY','ANNUAL','SICK','HOLIDAY') THEN 1 ELSE 0 END),0)::int AS att_off,
             COALESCE(SUM(CASE WHEN type IN ('HALF_AM','HALF_PM') THEN 1 ELSE 0 END),0)::int AS att_half
      FROM attendance_records
      WHERE work_date >= ${start} AND work_date <= ${cutoff}
        AND status = 'APPROVED' AND user_id = ANY(${userIds})
      GROUP BY user_id` : [];

    const orderMap = {}; orderAgg.forEach(r => orderMap[r.user_id] = r);
    const tmMap = {};    tmAgg.forEach(r => tmMap[r.user_id] = r);
    const attMap = {};   attAgg.forEach(r => attMap[r.user_id] = r);

    const rows = users.map(u => {
      const o = orderMap[u.id] || { cnt: 0, amount_sum: 0 };
      const t = tmMap[u.id] || { db_sum: 0, off_days: 0 };
      const a = attMap[u.id] || { att_off: 0, att_half: 0 };
      return {
        user_id: u.id, name: u.name, role: u.role,
        total_count: o.cnt, amount_sum: Number(o.amount_sum),
        total_db: t.db_sum,
        off_days: t.off_days + a.att_off,
        half_days: a.att_half,
      };
    });

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
    return res.status(200).json({ ym, cutoff, period, elapsedWorkdays, remainingWorkdays, totalWorkdays, rows });
  }

  // ───────── tm-daily ─────────
  if (op === 'tm-daily') {
    if (req.method === 'GET') {
      const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0];
      if (!ym) return res.status(400).json({ error: 'ym required' });
      const start = `${ym}-01`;
      const [y,m] = ym.split('-').map(Number);
      const ny = m === 12 ? y+1 : y;
      const nm = m === 12 ? 1 : m+1;
      const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
      const rows = isPriv
        ? await sql`SELECT * FROM sales_tm_daily WHERE work_date >= ${start} AND work_date < ${end} ORDER BY work_date ASC, user_id ASC`
        : await sql`SELECT * FROM sales_tm_daily WHERE work_date >= ${start} AND work_date < ${end} AND user_id = ${me.id} ORDER BY work_date ASC`;
      return res.status(200).json({ rows });
    }
    if (req.method === 'POST') {
      const b = await readJson(req);
      const userId = Number(b.user_id || me.id);
      if (!isPriv && userId !== me.id) return res.status(403).json({ error: '본인 행만' });
      if (!b.work_date) return res.status(400).json({ error: 'work_date required' });
      const rows = await sql`
        INSERT INTO sales_tm_daily (user_id, work_date, db_count, is_off, note, updated_at)
        VALUES (${userId}, ${b.work_date}, ${Number(b.db_count||0)}, ${!!b.is_off}, ${b.note||null}, NOW())
        ON CONFLICT (user_id, work_date) DO UPDATE SET
          db_count = EXCLUDED.db_count, is_off = EXCLUDED.is_off, note = EXCLUDED.note, updated_at = NOW()
        RETURNING *`;
      return res.status(200).json({ ok: true, row: rows[0] });
    }
    res.setHeader('Allow', 'GET,POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  // ───────── vendor-daily ─────────
  // 작성 권한: admin/manager 만. 직원은 read-only (결과 조회만 가능)
  if (op === 'vendor-daily') {
    if (req.method === 'GET') {
      const d = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
      if (!d) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
      const vendors = await sql`
        SELECT id, code, label, parent_label, color, sort_order
        FROM db_vendors WHERE active = TRUE
        ORDER BY sort_order ASC, id ASC`;
      const rows = await sql`SELECT * FROM sales_vendor_daily WHERE work_date = ${d}`;
      const meta = (await sql`SELECT * FROM sales_day_meta WHERE work_date = ${d} LIMIT 1`)[0]
        || { work_date: d, recontact_completed: 0, note: null };
      const map = {}; rows.forEach(r => map[r.vendor_id] = r);
      const merged = vendors.map(v => ({
        vendor_id: v.id, code: v.code, label: v.label, parent_label: v.parent_label, color: v.color,
        db_count: map[v.id]?.db_count || 0,
        deleted_count: map[v.id]?.deleted_count || 0,
        received_count: map[v.id]?.received_count || 0,
        remaining_count: map[v.id]?.remaining_count || 0,
        completed_count: map[v.id]?.completed_count || 0,
        note: map[v.id]?.note || null,
        _exists: !!map[v.id],
      }));
      return res.status(200).json({ date: d, vendors: merged, meta });
    }
    if (!isPriv) return res.status(403).json({ error: '관리자 전용' });
    if (req.method === 'POST') {
      if (req.query.meta) {
        const b = await readJson(req);
        if (!b.work_date) return res.status(400).json({ error: 'work_date required' });
        const rows = await sql`
          INSERT INTO sales_day_meta (work_date, recontact_completed, note, updated_at)
          VALUES (${b.work_date}, ${Number(b.recontact_completed||0)}, ${b.note||null}, NOW())
          ON CONFLICT (work_date) DO UPDATE SET
            recontact_completed = EXCLUDED.recontact_completed, note = EXCLUDED.note, updated_at = NOW()
          RETURNING *`;
        return res.status(200).json({ ok: true, meta: rows[0] });
      }
      const b = await readJson(req);
      if (!b.vendor_id || !b.work_date) return res.status(400).json({ error: 'vendor_id/work_date required' });
      const rows = await sql`
        INSERT INTO sales_vendor_daily
          (vendor_id, work_date, db_count, deleted_count, received_count, remaining_count, completed_count, note, updated_at)
        VALUES
          (${Number(b.vendor_id)}, ${b.work_date},
           ${Number(b.db_count||0)}, ${Number(b.deleted_count||0)}, ${Number(b.received_count||0)},
           ${Number(b.remaining_count||0)}, ${Number(b.completed_count||0)}, ${b.note||null}, NOW())
        ON CONFLICT (vendor_id, work_date) DO UPDATE SET
          db_count = EXCLUDED.db_count, deleted_count = EXCLUDED.deleted_count,
          received_count = EXCLUDED.received_count, remaining_count = EXCLUDED.remaining_count,
          completed_count = EXCLUDED.completed_count, note = EXCLUDED.note, updated_at = NOW()
        RETURNING *`;
      return res.status(200).json({ ok: true, row: rows[0] });
    }
    res.setHeader('Allow', 'GET,POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  return res.status(404).json({ error: `unknown op: ${op}` });
});

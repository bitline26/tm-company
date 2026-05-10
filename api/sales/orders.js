import { sql, requireAuth, readJson } from '../_db.js';

// /api/sales/orders
//   GET  ?ym=2026-05  → 월별 거래 리스트 (직원=본인 것, admin/manager=전체)
//   POST {id?, tm_user_id, vendor_id, customer_name, customer_phone, carrier, consult_date,
//         payment_bank, payment_account, amount, payment_date, status, note}
//        → upsert (id 있으면 update)
//   DELETE ?id=N

const ALLOWED_STATUS = new Set(['PAID','IN_PROGRESS','UNPAID','PARTIAL','CANCELLED']);

export default requireAuth(async function handler(req, res) {
  const me = req.user;
  const isPriv = me.role === 'admin' || me.role === 'manager';

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
            SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label, v.parent_label, v.color AS vendor_color
            FROM sales_orders o
            LEFT JOIN users u ON u.id = o.tm_user_id
            LEFT JOIN db_vendors v ON v.id = o.vendor_id
            WHERE o.consult_date >= ${start} AND o.consult_date < ${end}
            ORDER BY o.consult_date DESC, o.id DESC
          `
        : await sql`
            SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label, v.parent_label, v.color AS vendor_color
            FROM sales_orders o
            LEFT JOIN users u ON u.id = o.tm_user_id
            LEFT JOIN db_vendors v ON v.id = o.vendor_id
            WHERE o.consult_date >= ${start} AND o.consult_date < ${end}
              AND o.tm_user_id = ${me.id}
            ORDER BY o.consult_date DESC, o.id DESC
          `;
    } else {
      rows = isPriv
        ? await sql`
            SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label, v.parent_label, v.color AS vendor_color
            FROM sales_orders o
            LEFT JOIN users u ON u.id = o.tm_user_id
            LEFT JOIN db_vendors v ON v.id = o.vendor_id
            ORDER BY o.consult_date DESC, o.id DESC LIMIT 500
          `
        : await sql`
            SELECT o.*, u.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label, v.parent_label, v.color AS vendor_color
            FROM sales_orders o
            LEFT JOIN users u ON u.id = o.tm_user_id
            LEFT JOIN db_vendors v ON v.id = o.vendor_id
            WHERE o.tm_user_id = ${me.id}
            ORDER BY o.consult_date DESC, o.id DESC LIMIT 500
          `;
    }
    return res.status(200).json({ orders: rows });
  }

  if (req.method === 'POST') {
    const b = await readJson(req);
    const status = b.status && ALLOWED_STATUS.has(b.status) ? b.status : 'UNPAID';
    const tmId = b.tm_user_id || (isPriv ? null : me.id);
    if (!isPriv && tmId !== me.id) return res.status(403).json({ error: '본인 행만 입력 가능' });

    if (b.id) {
      // 권한 체크
      const own = await sql`SELECT tm_user_id FROM sales_orders WHERE id = ${b.id} LIMIT 1`;
      if (!own[0]) return res.status(404).json({ error: 'not found' });
      if (!isPriv && own[0].tm_user_id !== me.id) return res.status(403).json({ error: '권한 없음' });
      const rows = await sql`
        UPDATE sales_orders SET
          tm_user_id = ${tmId},
          vendor_id = ${b.vendor_id || null},
          customer_name = ${b.customer_name || null},
          customer_phone = ${b.customer_phone || null},
          carrier = ${b.carrier || null},
          consult_date = ${b.consult_date || null},
          payment_bank = ${b.payment_bank || null},
          payment_account = ${b.payment_account || null},
          amount = ${Number(b.amount || 0)},
          payment_date = ${b.payment_date || null},
          status = ${status},
          note = ${b.note || null},
          updated_at = NOW()
        WHERE id = ${b.id}
        RETURNING *
      `;
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
      RETURNING *
    `;
    return res.status(200).json({ ok: true, order: rows[0] });
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
});

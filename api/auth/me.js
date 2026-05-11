import { sql, getCurrentUser, ensureSchema, PRESET_NAMES } from '../_db.js';

function ymToRange(ym) {
  const start = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end };
}

// 핫패스 — 가능한 가볍게. 미로그인 호출이면 DB 접근 없이 즉시 응답.
// ?bootstrap=1&ym=YYYY-MM 이면 첫 화면 데이터(att/list)까지 한 번에 반환 → 라운드트립 절감
export default async function handler(req, res) {
  try {
    const cookieHeader = req.headers?.cookie || '';
    if (!cookieHeader.includes('tm_session=')) {
      // 로그인 페이지 진입 시 — DB/스키마/Neon TLS 세션을 백그라운드로 워밍
      // → 이후 로그인 클릭 시 첫 SQL 호출이 콜드가 아니라 즉시
      ensureSchema().catch(() => {});
      sql`SELECT 1`.catch(() => {});
      return res.status(200).json({
        user: null,
        availableNames: PRESET_NAMES,
        presetNames: PRESET_NAMES,
      });
    }
    ensureSchema().catch(() => {});
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(200).json({
        user: null,
        availableNames: PRESET_NAMES,
        presetNames: PRESET_NAMES,
      });
    }

    if (!req.query?.bootstrap) {
      return res.status(200).json({ user });
    }

    const ym = String(req.query.ym || '').match(/^\d{4}-\d{2}$/)?.[0]
      || new Date().toISOString().slice(0, 7);
    const { start, end } = ymToRange(ym);
    const isPriv = user.role === 'admin' || user.role === 'manager';

    let users, records, salesVendors = [], salesOrders = null;
    if (isPriv) {
      [users, records, salesVendors, salesOrders] = await Promise.all([
        sql`
          SELECT id, name, role, registered
          FROM users WHERE role <> 'admin'
          ORDER BY sort_order ASC, id ASC`,
        sql`
          SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
                 a.approved_by, a.approved_at, a.reject_reason, a.requested_at,
                 uu.name AS approver_name
          FROM attendance_records a
          LEFT JOIN users uu ON uu.id = a.approved_by
          WHERE a.work_date >= ${start} AND a.work_date < ${end}
          ORDER BY a.work_date ASC, a.user_id ASC`,
        sql`
          SELECT id, code, label, parent_label, color, sort_order, active, note
          FROM db_vendors ORDER BY active DESC, sort_order ASC, id ASC`,
        sql`
          SELECT o.*, uu.name AS tm_name, v.code AS vendor_code, v.label AS vendor_label,
                 v.parent_label, v.color AS vendor_color
          FROM sales_orders o
          LEFT JOIN users uu ON uu.id = o.tm_user_id
          LEFT JOIN db_vendors v ON v.id = o.vendor_id
          WHERE o.consult_date >= ${start} AND o.consult_date < ${end}
          ORDER BY o.consult_date DESC, o.id DESC`,
      ]);
    } else {
      users = [{ id: user.id, name: user.name, role: user.role, registered: true }];
      [records, salesVendors] = await Promise.all([
        sql`
          SELECT a.id, a.user_id, a.work_date, a.type, a.status, a.note,
                 a.approved_by, a.approved_at, a.reject_reason, a.requested_at,
                 uu.name AS approver_name
          FROM attendance_records a
          LEFT JOIN users uu ON uu.id = a.approved_by
          WHERE a.work_date >= ${start} AND a.work_date < ${end}
            AND a.user_id = ${user.id}
          ORDER BY a.work_date ASC`,
        sql`
          SELECT id, code, label, parent_label, color, sort_order, active, note
          FROM db_vendors ORDER BY active DESC, sort_order ASC, id ASC`,
      ]);
    }

    return res.status(200).json({
      user,
      bootstrap: { ym, users, records, isPriv, salesVendors, salesOrders },
    });
  } catch (e) {
    console.error('me error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

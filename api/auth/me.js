// Edge Runtime — 콜드 스타트 500-1500ms (Node) → 30-80ms (Edge)
import {
  sql, verifySessionEdge, parseCookieHeader, PRESET_NAMES, ymToRange, json,
} from './_edge.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const cookies = parseCookieHeader(req.headers.get('cookie'));
    const url = new URL(req.url);

    if (!cookies.tm_session) {
      // Neon TLS 워밍 — 다음 로그인 시 첫 SQL이 콜드 핸드셰이크 없이 즉시
      sql`SELECT 1`.catch(() => {});
      return json({
        user: null,
        availableNames: PRESET_NAMES,
        presetNames: PRESET_NAMES,
      });
    }

    const session = await verifySessionEdge(cookies.tm_session);
    if (!session?.uid) {
      return json({
        user: null,
        availableNames: PRESET_NAMES,
        presetNames: PRESET_NAMES,
      });
    }

    // 🔒 DB 재검증 — 쿠키만 신뢰하면 안 됨 (거부/정지/퇴사된 계정도 쿠키 유효기간 동안 통과되는 버그)
    const dbRows = await sql`
      SELECT id, name, role, tier, registered, status, password_hash
      FROM users WHERE id = ${session.uid} LIMIT 1`;
    const dbUser = dbRows[0];

    // 차단 조건: 계정 없음 / 가입 거부 후 password_hash null / 미승인 (registered=false) / 정지·퇴사
    const blocked =
      !dbUser ||
      !dbUser.password_hash ||
      !dbUser.registered ||
      (dbUser.role !== 'admin' && (dbUser.status === 'suspended' || dbUser.status === 'resigned'));

    if (blocked) {
      // 쿠키 무효화 + 미로그인 응답
      return new Response(JSON.stringify({
        user: null,
        availableNames: PRESET_NAMES,
        presetNames: PRESET_NAMES,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': 'tm_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        },
      });
    }

    // DB 기준 최신 정보 사용 (role/tier 변경된 경우 반영)
    const user = { id: dbUser.id, name: dbUser.name, role: dbUser.role, tier: dbUser.tier, registered: true };

    if (!url.searchParams.get('bootstrap')) {
      return json({ user });
    }

    const ym = String(url.searchParams.get('ym') || '').match(/^\d{4}-\d{2}$/)?.[0]
      || new Date().toISOString().slice(0, 7);
    const { start, end } = ymToRange(ym);
    const isPriv = user.role === 'admin' || user.role === 'manager';

    let users, records, salesVendors = [], salesOrders = null;
    if (isPriv) {
      [users, records, salesVendors, salesOrders] = await Promise.all([
        sql`
          SELECT id, name, role, registered, tier, status, allowed_ips
          FROM users WHERE role <> 'admin' AND registered = TRUE
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
      users = [{ id: user.id, name: user.name, role: user.role, tier: user.tier, registered: true }];
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

    return json({
      user,
      bootstrap: { ym, users, records, isPriv, salesVendors, salesOrders },
    });
  } catch (e) {
    return json({ error: 'server error', detail: String(e?.message || e) }, { status: 500 });
  }
}

import { sql, requireAuth, readJson } from '../_db.js';

// 대표 전용 — 회원가입 승인 + 직원 관리(정지/퇴사/IP)
// GET  /api/auth/pending                       → 승인 대기 목록
// GET  /api/auth/pending?scope=employees       → 등록된 전체 직원 (관리 대상)
// POST /api/auth/pending  { id, action, ips? }  → 액션 실행
//   action: 'approve' | 'reject' | 'suspend' | 'unsuspend' | 'resign' | 'unresign' | 'set_ips'
export default requireAuth(async function handler(req, res) {
  const me = req.user;
  if (me.role !== 'admin') return res.status(403).json({ error: '대표만 사용 가능합니다' });

  if (req.method === 'GET') {
    const scope = String(req.query.scope || '');
    if (scope === 'employees') {
      const rows = await sql`
        SELECT id, name, role, tier, status, allowed_ips, ip_mode, ip_group_ids,
               last_login_ip, last_login_at, created_at
        FROM users
        WHERE registered = TRUE AND role <> 'admin'
        ORDER BY sort_order ASC, id ASC`;
      return res.status(200).json({ employees: rows });
    }
    const rows = await sql`
      SELECT id, name, role, tier, created_at
      FROM users
      WHERE registered = FALSE AND password_hash IS NOT NULL
      ORDER BY created_at ASC, id ASC`;
    return res.status(200).json({ pending: rows });
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const uid = Number(body.id);
    const action = String(body.action || '');
    if (!uid) return res.status(400).json({ error: 'id required' });
    const found = (await sql`SELECT id, role, registered, password_hash FROM users WHERE id = ${uid} LIMIT 1`)[0];
    if (!found) return res.status(404).json({ error: 'not found' });
    if (found.role === 'admin') return res.status(403).json({ error: '대표 계정은 변경할 수 없습니다' });

    if (action === 'approve') {
      if (found.registered) return res.status(409).json({ error: '이미 승인된 사용자' });
      if (!found.password_hash) return res.status(400).json({ error: '가입 신청 안 한 사용자' });
      await sql`UPDATE users SET registered = TRUE WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'reject') {
      if (found.registered) return res.status(409).json({ error: '이미 승인된 사용자' });
      await sql`
        UPDATE users SET password_hash = NULL, password_salt = NULL, tier = NULL
        WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'suspend') {
      await sql`UPDATE users SET status = 'suspended' WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'unsuspend') {
      await sql`UPDATE users SET status = 'active' WHERE id = ${uid} AND status = 'suspended'`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'resign') {
      await sql`UPDATE users SET status = 'resigned' WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'unresign') {
      await sql`UPDATE users SET status = 'active' WHERE id = ${uid} AND status = 'resigned'`;
      return res.status(200).json({ ok: true });
    }
    // 삭제 — 계정 + 관련 데이터 영구 제거 (ON DELETE CASCADE 로 attendance/tm-daily/monthly 자동 삭제)
    if (action === 'delete') {
      await sql`DELETE FROM users WHERE id = ${uid} AND role <> 'admin'`;
      return res.status(200).json({ ok: true });
    }
    // 이름 수정 — 삭제 후 재가입하면 PB/근태/마감 데이터 다 날아가니 이름만 바꿔주는 안전 경로
    if (action === 'rename') {
      const newName = String(body.name||'').trim();
      if (!newName) return res.status(400).json({ error: '새 이름을 입력하세요' });
      if (newName.length > 32) return res.status(400).json({ error: '이름이 너무 깁니다 (32자 이내)' });
      if (newName === '1' || newName === '2' || newName === '3') {
        return res.status(400).json({ error: '예약된 이름은 사용할 수 없습니다' });
      }
      // 중복 체크
      const dup = await sql`SELECT id FROM users WHERE name = ${newName} AND id <> ${uid} LIMIT 1`;
      if (dup[0]) return res.status(409).json({ error: '같은 이름의 직원이 이미 있습니다' });
      const rows = await sql`UPDATE users SET name = ${newName} WHERE id = ${uid} AND role <> 'admin' RETURNING id, name`;
      if (!rows[0]) return res.status(404).json({ error: '대상 직원이 없습니다' });
      return res.status(200).json({ ok: true, name: rows[0].name });
    }
    if (action === 'set_ips') {
      // ips: 배열 — 빈 배열이면 제한 해제 (레거시 호환)
      const rawIps = Array.isArray(body.ips) ? body.ips : [];
      const ips = rawIps
        .map(s => String(s || '').trim())
        .filter(s => s.length > 0 && /^[0-9a-fA-F:.]+$/.test(s))
        .slice(0, 20);
      await sql`UPDATE users SET allowed_ips = ${ips} WHERE id = ${uid}`;
      return res.status(200).json({ ok: true, allowed_ips: ips });
    }
    // 새 IP 그룹 시스템 — mode: 'all'(전체) | 'restricted'(선택 그룹만), group_ids: int[]
    if (action === 'set_ip_mode') {
      const mode = body.mode === 'restricted' ? 'restricted' : 'all';
      const rawGids = Array.isArray(body.group_ids) ? body.group_ids : [];
      const groupIds = rawGids.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0).slice(0, 200);
      await sql`UPDATE users SET ip_mode = ${mode}, ip_group_ids = ${groupIds} WHERE id = ${uid}`;
      return res.status(200).json({ ok: true, ip_mode: mode, ip_group_ids: groupIds });
    }
    return res.status(400).json({ error: 'invalid action' });
  }

  res.setHeader('Allow', 'GET,POST');
  return res.status(405).json({ error: 'method not allowed' });
});

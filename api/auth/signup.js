// 통합 endpoint — Vercel Hobby 함수 12개 제한 회피
// rewrites 로 다음 경로가 모두 이 파일로 들어옴:
//   POST   /api/auth/signup                     (기본 — 회원가입)
//   GET    /api/auth/pending     (?__op=pending)    — 승인 대기/직원 목록
//   POST   /api/auth/pending     (?__op=pending)    — 액션 처리
//   GET    /api/auth/ip-groups   (?__op=ip-groups)
//   POST   /api/auth/ip-groups   (?__op=ip-groups)
//   DELETE /api/auth/ip-groups   (?__op=ip-groups)
import {
  sql, ensureSchema, hashPassword, readJson, getCurrentUser, requireAuth,
} from '../_db.js';

// ── pending handler ──
const pendingHandler = requireAuth(async function (req, res) {
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
      await sql`UPDATE users SET password_hash = NULL, password_salt = NULL, tier = NULL WHERE id = ${uid}`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'suspend')   { await sql`UPDATE users SET status = 'suspended' WHERE id = ${uid}`; return res.status(200).json({ ok: true }); }
    if (action === 'unsuspend') { await sql`UPDATE users SET status = 'active' WHERE id = ${uid} AND status = 'suspended'`; return res.status(200).json({ ok: true }); }
    if (action === 'resign')    { await sql`UPDATE users SET status = 'resigned' WHERE id = ${uid}`; return res.status(200).json({ ok: true }); }
    if (action === 'unresign')  { await sql`UPDATE users SET status = 'active' WHERE id = ${uid} AND status = 'resigned'`; return res.status(200).json({ ok: true }); }
    if (action === 'delete')    { await sql`DELETE FROM users WHERE id = ${uid} AND role <> 'admin'`; return res.status(200).json({ ok: true }); }
    if (action === 'rename') {
      const newName = String(body.name||'').trim();
      if (!newName) return res.status(400).json({ error: '새 이름을 입력하세요' });
      if (newName.length > 32) return res.status(400).json({ error: '이름이 너무 깁니다 (32자 이내)' });
      if (newName === '1' || newName === '2' || newName === '3') return res.status(400).json({ error: '예약된 이름은 사용할 수 없습니다' });
      const dup = await sql`SELECT id FROM users WHERE name = ${newName} AND id <> ${uid} LIMIT 1`;
      if (dup[0]) return res.status(409).json({ error: '같은 이름의 직원이 이미 있습니다' });
      const rows = await sql`UPDATE users SET name = ${newName} WHERE id = ${uid} AND role <> 'admin' RETURNING id, name`;
      if (!rows[0]) return res.status(404).json({ error: '대상 직원이 없습니다' });
      return res.status(200).json({ ok: true, name: rows[0].name });
    }
    if (action === 'set_password') {
      const newPw = String(body.password || '').trim();
      if (!newPw) return res.status(400).json({ error: '새 비밀번호를 입력하세요' });
      if (newPw.length < 1 || newPw.length > 64) return res.status(400).json({ error: '비밀번호 길이가 잘못됐습니다 (1~64자)' });
      const { hash, salt } = hashPassword(newPw);
      await sql`UPDATE users SET password_hash = ${hash}, password_salt = ${salt} WHERE id = ${uid} AND role <> 'admin'`;
      return res.status(200).json({ ok: true });
    }
    if (action === 'set_ips') {
      const rawIps = Array.isArray(body.ips) ? body.ips : [];
      const ips = rawIps.map(s => String(s || '').trim()).filter(s => s.length > 0 && /^[0-9a-fA-F:.]+$/.test(s)).slice(0, 20);
      await sql`UPDATE users SET allowed_ips = ${ips} WHERE id = ${uid}`;
      return res.status(200).json({ ok: true, allowed_ips: ips });
    }
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

// ── ip-groups handler ──
const MAX_GROUPS = 200;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_LOOSE = /^[0-9a-fA-F:]+$/;
function normalizeIp(s){
  const t = String(s||'').trim();
  if(!t) return null;
  if(IPV4.test(t) || IPV6_LOOSE.test(t)) return t;
  return null;
}
function clientIp(req){
  const xf = String(req.headers['x-forwarded-for']||'');
  return xf.split(',')[0].trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}
const ipGroupsHandler = requireAuth(async function (req, res) {
  const me = req.user;
  if (me.role !== 'admin') return res.status(403).json({ error: '대표만 사용 가능합니다' });

  if (req.method === 'GET') {
    const groups = await sql`
      SELECT id, label, ips, active, sort_order, note, created_at, updated_at
      FROM ip_groups ORDER BY sort_order ASC, id ASC`;
    return res.status(200).json({ groups, currentIp: clientIp(req), max: MAX_GROUPS });
  }
  if (req.method === 'POST') {
    const b = await readJson(req);
    const label = String(b.label||'').trim();
    if(!label) return res.status(400).json({ error: '제목을 입력하세요' });
    if(label.length > 32) return res.status(400).json({ error: '제목 32자 이내' });
    const rawIps = Array.isArray(b.ips) ? b.ips : String(b.ips||'').split(/[\s,\/;]+/);
    const ips = rawIps.map(normalizeIp).filter(Boolean).slice(0, 200);
    const active = b.active !== false;
    const sortOrder = Number(b.sort_order || 0);
    const note = b.note ? String(b.note).slice(0,200) : null;
    if (b.id) {
      const rows = await sql`
        UPDATE ip_groups SET label=${label}, ips=${ips}, active=${active},
          sort_order=${sortOrder}, note=${note}, updated_at=NOW()
        WHERE id=${Number(b.id)} RETURNING *`;
      if(!rows[0]) return res.status(404).json({ error: 'not found' });
      return res.status(200).json({ ok:true, group: rows[0] });
    }
    const cnt = (await sql`SELECT COUNT(*)::int AS n FROM ip_groups`)[0]?.n || 0;
    if (cnt >= MAX_GROUPS) return res.status(400).json({ error: `최대 등록 가능 갯수 초과 (${MAX_GROUPS}건)` });
    try {
      const rows = await sql`
        INSERT INTO ip_groups (label, ips, active, sort_order, note)
        VALUES (${label}, ${ips}, ${active}, ${sortOrder}, ${note}) RETURNING *`;
      return res.status(200).json({ ok:true, group: rows[0] });
    } catch (e) {
      if (String(e.message||'').includes('duplicate')) return res.status(409).json({ error: '이미 같은 제목이 있습니다' });
      throw e;
    }
  }
  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if(!id) return res.status(400).json({ error: 'id required' });
    await sql`DELETE FROM ip_groups WHERE id=${id}`;
    await sql`UPDATE users SET ip_group_ids = array_remove(ip_group_ids, ${id})`;
    return res.status(200).json({ ok:true });
  }
  res.setHeader('Allow', 'GET,POST,DELETE');
  return res.status(405).json({ error: 'method not allowed' });
});

// ── signup handler (기본) ──
async function signupHandler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    await ensureSchema();
    const me = await getCurrentUser(req);
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: '대표만 회원가입을 진행할 수 있습니다' });
    }
    const { name, password, tier, role } = await readJson(req);
    const nm = String(name || '').trim();
    if (!nm) return res.status(400).json({ error: '이름을 입력하세요' });
    if (nm.length > 32) return res.status(400).json({ error: '이름이 너무 깁니다 (32자 이내)' });
    if (nm === '2' || nm === '3') return res.status(400).json({ error: '예약된 이름입니다' });
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: '비밀번호는 4자 이상' });
    }
    const tierN = Number(tier);
    if (![1, 2].includes(tierN)) {
      return res.status(400).json({ error: '1차직원 / 2차직원 분류를 선택하세요' });
    }
    const roleVal = role === 'manager' ? 'manager' : 'employee';

    const found = await sql`SELECT id, registered FROM users WHERE name = ${nm} LIMIT 1`;
    const { hash, salt } = hashPassword(String(password));

    if (found[0]) {
      if (found[0].registered) {
        return res.status(409).json({ error: '이미 등록된 이름입니다' });
      }
      await sql`
        UPDATE users
        SET password_hash = ${hash}, password_salt = ${salt}, tier = ${tierN},
            role = ${roleVal}, registered = TRUE, status = 'active'
        WHERE id = ${found[0].id}
      `;
    } else {
      await sql`
        INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
        VALUES (${nm}, ${hash}, ${salt}, ${roleVal}, TRUE, 100, 'active')
      `;
    }
    return res.status(200).json({ ok: true, message: `${nm} 계정 생성 완료 — 즉시 로그인 가능` });
  } catch (e) {
    console.error('signup error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

// ── dispatcher ──
export default async function handler(req, res) {
  const op = String(req.query.__op || '');
  if (op === 'pending')   return pendingHandler(req, res);
  if (op === 'ip-groups') return ipGroupsHandler(req, res);
  return signupHandler(req, res);
}

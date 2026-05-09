import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

// 환경 분리: production은 운영 DB, 그 외(preview/development)는 테스트 DB(test2_*)
const isProd = process.env.VERCEL_ENV === 'production';

const url = isProd
  ? (process.env.DATABASE_URL || process.env.POSTGRES_URL)
  : (process.env.test2_DATABASE_URL
     || process.env.test2_POSTGRES_URL
     || process.env.DATABASE_URL
     || process.env.POSTGRES_URL);

if (!url) throw new Error('DATABASE_URL not set');

export const sql = neon(url);

// 직원 12명 (이미지 근무표 기준) — 회원가입 시 이 이름들 중에서만 선택 가능
// 문실장 = 차장권한(manager, 월차 승인 가능)
export const PRESET_NAMES = [
  '문실장','김상현','이경민','임세인','양정연','장영인',
  '안다혜','지성훈','이기성','고윤호','박철우','최은정',
];
const MANAGER_NAMES = new Set(['문실장']);

// 대표 시드 계정
const ADMIN_NAME = '대표';
const ADMIN_DEFAULT_PW = 'tm0509!'; // 첫 로그인 후 변경 권장

let initialized = false;
export async function ensureSchema() {
  if (initialized) return;

  // applications (광고 랜딩 신청자) — 유지: api/submit.js가 사용
  await sql`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('A','B')),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      carrier TEXT,
      model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_apps_created ON applications (created_at DESC)`;

  // users — 직원/관리자 계정
  // role: 'admin'(대표) / 'manager'(차장) / 'employee'(직원)
  // registered: 회원가입 여부 (preset 12명은 시드 시 false, 가입 후 true)
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      password_salt TEXT,
      role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','manager','employee')),
      registered BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_name ON users (name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`;

  // attendance_records — 근태 요청/승인 기록
  // type: WORK(정상)/OFF(휴무)/HALF_AM(오전반차)/HALF_PM(오후반차)/MONTHLY(월차)/ANNUAL(연차)/SICK(병가)/HOLIDAY(공휴일)
  // status: REQUESTED(요청) / APPROVED(승인) / REJECTED(반려)
  await sql`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('WORK','OFF','HALF_AM','HALF_PM','MONTHLY','ANNUAL','SICK','HOLIDAY')),
      status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED')),
      note TEXT,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_by INT REFERENCES users(id),
      approved_at TIMESTAMPTZ,
      reject_reason TEXT,
      UNIQUE(user_id, work_date)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_records (work_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance_records (user_id, work_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_att_status ON attendance_records (status)`;

  // 시드 — 대표(admin) 계정
  const adminCnt = await sql`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`;
  if ((adminCnt[0]?.n || 0) === 0) {
    const { hash, salt } = hashPassword(ADMIN_DEFAULT_PW);
    await sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, sort_order)
      VALUES (${ADMIN_NAME}, ${hash}, ${salt}, 'admin', TRUE, -1)
      ON CONFLICT (name) DO NOTHING
    `;
  }

  // 시드 — 12명 preset (registered=false, 회원가입 시 비밀번호 설정)
  for (let i = 0; i < PRESET_NAMES.length; i++) {
    const name = PRESET_NAMES[i];
    const role = MANAGER_NAMES.has(name) ? 'manager' : 'employee';
    await sql`
      INSERT INTO users (name, role, registered, sort_order)
      VALUES (${name}, ${role}, FALSE, ${i})
      ON CONFLICT (name) DO NOTHING
    `;
  }

  initialized = true;
}

// ─────────────── 비밀번호 해시 (pbkdf2) ───────────────
export function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return { hash, salt };
}
export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const cmp = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(cmp, 'hex'), Buffer.from(hash, 'hex'));
}

// ─────────────── 세션 쿠키 (HMAC 서명) ───────────────
const SESSION_SECRET = process.env.SESSION_SECRET
  || 'tm-company-default-session-secret-please-set-SESSION_SECRET-env';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14일

export function signSession(payload) {
  const exp = Date.now() + SESSION_TTL_MS;
  const json = JSON.stringify({ ...payload, exp });
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}
export function verifySession(token) {
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'));
  } catch { return null; }
  if (!ok) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

export function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  header.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx === -1) return;
    const k = c.slice(0, idx).trim();
    const v = c.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie',
    `tm_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'tm_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

export async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies.tm_session);
  if (!session?.uid) return null;
  const rows = await sql`
    SELECT id, name, role, registered
    FROM users WHERE id = ${session.uid} LIMIT 1
  `;
  return rows[0] || null;
}

export function requireAuth(handler) {
  return async (req, res) => {
    await ensureSchema();
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = user;
    return handler(req, res);
  };
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

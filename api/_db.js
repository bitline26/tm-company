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

// 대표(관리자) 시드 계정 — 매 ensureSchema 마다 upsert (비번 변경 시 즉시 반영)
const ADMIN_NAME = '1';
const ADMIN_DEFAULT_PW = '1';

let initialized = false;
let initPromise = null;
export async function ensureSchema() {
  if (initialized) return;
  if (initPromise) return initPromise;        // 동시 호출 시 1회만 실행
  initPromise = (async () => {
    // 1단계: 테이블 생성 (병렬 — 서로 의존 없음 except attendance→users)
    await Promise.all([
      sql`
        CREATE TABLE IF NOT EXISTS applications (
          id SERIAL PRIMARY KEY,
          source TEXT NOT NULL CHECK (source IN ('A','B')),
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          carrier TEXT,
          model TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      sql`
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
      `,
    ]);

    // 2단계: attendance_records (users에 FK)
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

    // 3단계: ALTER + 인덱스 (병렬)
    await Promise.all([
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ NULL`,
      sql`CREATE INDEX IF NOT EXISTS idx_apps_created ON applications (created_at DESC)`,
      sql`CREATE INDEX IF NOT EXISTS idx_users_name ON users (name)`,
      sql`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`,
      sql`CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_records (work_date)`,
      sql`CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance_records (user_id, work_date)`,
      sql`CREATE INDEX IF NOT EXISTS idx_att_status ON attendance_records (status)`,
    ]);

    // 4단계: 시드 (병렬)
    const { hash, salt } = hashPassword(ADMIN_DEFAULT_PW);
    const adminUpsert = sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, sort_order)
      VALUES (${ADMIN_NAME}, ${hash}, ${salt}, 'admin', TRUE, -1)
      ON CONFLICT (name) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            password_salt = EXCLUDED.password_salt,
            role = 'admin',
            registered = TRUE,
            sort_order = -1
    `;
    const adminCleanup = sql`DELETE FROM users WHERE role = 'admin' AND name <> ${ADMIN_NAME}`;
    const presetInserts = PRESET_NAMES.map((name, i) => {
      const role = MANAGER_NAMES.has(name) ? 'manager' : 'employee';
      return sql`
        INSERT INTO users (name, role, registered, sort_order)
        VALUES (${name}, ${role}, FALSE, ${i})
        ON CONFLICT (name) DO NOTHING
      `;
    });
    await Promise.all([adminUpsert, adminCleanup, ...presetInserts]);

    initialized = true;
  })();
  return initPromise;
}

// ─────────────── 비밀번호 해시 (pbkdf2) ───────────────
// 내부 어드민용 — 12명 규모, 로그인 빈도 낮음. iter 1만으로 충분 (≈10ms)
const PBKDF2_ITER = 10000;
export function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, 32, 'sha256').toString('hex');
  return { hash, salt };
}
export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const cmp = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, 32, 'sha256').toString('hex');
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

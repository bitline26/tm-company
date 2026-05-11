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
// 직원 테스트 계정 (개발용 빠른 로그인)
// 2/2 = 1차직원, 3/3 = 2차직원
const EMP_T1_NAME = '2';
const EMP_T1_PW = '2';
const EMP_T2_NAME = '3';
const EMP_T2_PW = '3';

// 스키마 마커 — 이 버전이 DB에 기록되어 있으면 ensureSchema 풀실행 스킵
const SCHEMA_VERSION = 8;

let initialized = false;
let initPromise = null;
export async function ensureSchema() {
  if (initialized) return;
  if (initPromise) return initPromise;        // 동시 호출 시 1회만 실행
  initPromise = (async () => {
    // ─── 빠른 경로: 마커 테이블에 현재 버전 기록되어 있으면 풀 DDL 스킵
    try {
      const m = await sql`SELECT MAX(version) AS version FROM _schema_init`;
      if (m[0]?.version >= SCHEMA_VERSION) {
        initialized = true;
        return;
      }
    } catch (_) {
      // _schema_init 테이블 없음 — 첫 콜드 스타트, 전체 DDL 실행
    }
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

    // ───────── 영업 모듈 (요청 2,3,4) ─────────
    // sales_period — 월 단위 기간/단가/총근무일 설정
    await sql`
      CREATE TABLE IF NOT EXISTS sales_period (
        id SERIAL PRIMARY KEY,
        year_month TEXT UNIQUE NOT NULL,           -- 'YYYY-MM'
        start_date DATE,
        end_date DATE,
        total_workdays INT NOT NULL DEFAULT 0,
        unit_price BIGINT NOT NULL DEFAULT 0,      -- 건당 평균 단가(₩)
        off_dates DATE[] DEFAULT '{}',             -- 공휴일/지정 휴무
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // db_vendors — 디비 공급 업체(대행사) 마스터
    await sql`
      CREATE TABLE IF NOT EXISTS db_vendors (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,                 -- 'A-A', 'B-B' 등
        label TEXT NOT NULL,
        parent_label TEXT,                         -- '타미통신디비', '날짜디비B' 등 그룹
        color TEXT DEFAULT '#9b9a97',
        sort_order INT NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // sales_orders — 거래 1건 1행 (요청 4: raw 로그)
    // status: PAID(입금완료) / IN_PROGRESS(입금중) / UNPAID(미입금) / PARTIAL(일부납부) / CANCELLED(취소)
    await sql`
      CREATE TABLE IF NOT EXISTS sales_orders (
        id SERIAL PRIMARY KEY,
        tm_user_id INT REFERENCES users(id) ON DELETE SET NULL,
        vendor_id INT REFERENCES db_vendors(id) ON DELETE SET NULL,
        customer_name TEXT,
        customer_phone TEXT,
        carrier TEXT,                              -- SK / KT / LGU
        consult_date DATE,                         -- 상담일자
        payment_bank TEXT,
        payment_account TEXT,
        amount BIGINT NOT NULL DEFAULT 0,
        payment_date DATE,                         -- 입금완료일자
        status TEXT NOT NULL DEFAULT 'UNPAID'
          CHECK (status IN ('PAID','IN_PROGRESS','UNPAID','PARTIAL','CANCELLED')),
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // sales_tm_daily — 일별 직원 입력 (요청 2 일일보고)
    // 직원이 매일 그날 받은 디비(db_count)와 그날 마감 건수(count) 입력
    // 월 누적 = SUM(이번 달 시작~오늘) → admin TM 마감 결과표
    await sql`
      CREATE TABLE IF NOT EXISTS sales_tm_daily (
        id SERIAL PRIMARY KEY,
        period_id INT REFERENCES sales_period(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        work_date DATE NOT NULL,
        db_count INT NOT NULL DEFAULT 0,
        count INT NOT NULL DEFAULT 0,             -- 그날 마감 건수
        is_off BOOLEAN NOT NULL DEFAULT FALSE,
        note TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, work_date)
      )
    `;
    // 기존 테이블에 count 컬럼 없으면 추가
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS count INT NOT NULL DEFAULT 0`;

    // sales_tm_monthly — 월간 누적 입력 (요청 2 핵심)
    // 직원이 본인 행의 total_count(총갯수=마감), total_db(총디비), off_days(휴무) 직접 입력
    // 자동 계산: 일평균/마감예상/디비평균/디비효율 (서버는 raw만 저장, 클라이언트가 계산)
    await sql`
      CREATE TABLE IF NOT EXISTS sales_tm_monthly (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        year_month TEXT NOT NULL,                  -- 'YYYY-MM'
        total_count INT NOT NULL DEFAULT 0,        -- 총갯수 (누적 마감 건수)
        total_db INT NOT NULL DEFAULT 0,           -- 총디비 (누적 받은 디비)
        off_days INT NOT NULL DEFAULT 0,           -- 휴무 일수 (양수 저장, 표시는 -N)
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, year_month)
      )
    `;

    // sales_vendor_daily — vendor × 일자 (요청 3)
    await sql`
      CREATE TABLE IF NOT EXISTS sales_vendor_daily (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES db_vendors(id) ON DELETE CASCADE,
        work_date DATE NOT NULL,
        db_count INT NOT NULL DEFAULT 0,
        deleted_count INT NOT NULL DEFAULT 0,
        received_count INT NOT NULL DEFAULT 0,
        remaining_count INT NOT NULL DEFAULT 0,
        completed_count INT NOT NULL DEFAULT 0,
        note TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(vendor_id, work_date)
      )
    `;

    // sales_day_meta — 일별 메타 (재컨택 완료 등)
    await sql`
      CREATE TABLE IF NOT EXISTS sales_day_meta (
        work_date DATE PRIMARY KEY,
        recontact_completed INT NOT NULL DEFAULT 0,
        note TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // 3단계: ALTER + 인덱스
    // attendance_records type CHECK 갱신은 DROP → ADD 순차 (병렬 시 race로 충돌)
    await sql`ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_type_check`;
    await sql`ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_type_check
        CHECK (type IN ('WORK','OFF','HALF_AM','HALF_PM','MONTHLY','ANNUAL','SICK','HOLIDAY','UNAUTHORIZED'))`;
    await Promise.all([
      sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ NULL`,
      // 직원 분류 구분 (1차직원 / 2차직원) — 가입 시 선택, NULL = 미선택 = 레거시(2차 기본)
      sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tier INT`,
      sql`CREATE INDEX IF NOT EXISTS idx_apps_created ON applications (created_at DESC)`,
      sql`CREATE INDEX IF NOT EXISTS idx_users_name ON users (name)`,
      sql`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`,
      sql`CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_records (work_date)`,
      sql`CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance_records (user_id, work_date)`,
      sql`CREATE INDEX IF NOT EXISTS idx_att_status ON attendance_records (status)`,
      sql`CREATE INDEX IF NOT EXISTS idx_orders_tm ON sales_orders (tm_user_id, consult_date DESC)`,
      sql`CREATE INDEX IF NOT EXISTS idx_orders_vendor ON sales_orders (vendor_id, consult_date DESC)`,
      sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON sales_orders (status)`,
      sql`CREATE INDEX IF NOT EXISTS idx_orders_consult ON sales_orders (consult_date DESC)`,
      sql`CREATE INDEX IF NOT EXISTS idx_tmd_date ON sales_tm_daily (work_date)`,
      sql`CREATE INDEX IF NOT EXISTS idx_tmm_ym ON sales_tm_monthly (year_month)`,
      sql`CREATE INDEX IF NOT EXISTS idx_tmm_user ON sales_tm_monthly (user_id, year_month)`,
      sql`CREATE INDEX IF NOT EXISTS idx_vd_date ON sales_vendor_daily (work_date)`,
      sql`CREATE INDEX IF NOT EXISTS idx_vendors_active ON db_vendors (active, sort_order)`,
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
    // 직원 테스트 계정 (UPSERT — 항상 동기화)
    // 2/2 = 1차직원 (tier=1), 3/3 = 2차직원 (tier=2)
    const empT1Pw = hashPassword(EMP_T1_PW);
    const empT1Upsert = sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order)
      VALUES (${EMP_T1_NAME}, ${empT1Pw.hash}, ${empT1Pw.salt}, 'employee', TRUE, 1, 998)
      ON CONFLICT (name) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            password_salt = EXCLUDED.password_salt,
            role = 'employee',
            registered = TRUE,
            tier = 1
    `;
    const empT2Pw = hashPassword(EMP_T2_PW);
    const empT2Upsert = sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order)
      VALUES (${EMP_T2_NAME}, ${empT2Pw.hash}, ${empT2Pw.salt}, 'employee', TRUE, 2, 999)
      ON CONFLICT (name) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            password_salt = EXCLUDED.password_salt,
            role = 'employee',
            registered = TRUE,
            tier = 2
    `;
    const presetInserts = PRESET_NAMES.map((name, i) => {
      const role = MANAGER_NAMES.has(name) ? 'manager' : 'employee';
      return sql`
        INSERT INTO users (name, role, registered, sort_order)
        VALUES (${name}, ${role}, FALSE, ${i})
        ON CONFLICT (name) DO NOTHING
      `;
    });
    // 디비 vendor 시드 (이미지 5월8일 기준)
    const VENDOR_SEEDS = [
      ['A-A',  'A-A',  '타미통신디비', '#7c3aed'],
      ['A-B',  'A-B',  '타미통신디비', '#a78bfa'],
      ['B-B',  'B-B',  '날짜디비B',    '#0f7b6c'],
      ['B-C',  'B-C',  '날짜디비B',    '#0ea5e9'],
      ['C-B',  'C-B',  null,           '#3271b6'],
      ['TM-A', 'TM-A', '자체광고',     '#06b6d4'],
    ];
    const vendorInserts = VENDOR_SEEDS.map(([code,label,parent,color], i) =>
      sql`
        INSERT INTO db_vendors (code, label, parent_label, color, sort_order)
        VALUES (${code}, ${label}, ${parent}, ${color}, ${i})
        ON CONFLICT (code) DO NOTHING
      `
    );
    await Promise.all([adminUpsert, adminCleanup, empT1Upsert, empT2Upsert, ...presetInserts, ...vendorInserts]);

    // 5단계: 마커 기록 (이후 콜드 스타트는 풀 DDL 스킵)
    await sql`
      CREATE TABLE IF NOT EXISTS _schema_init (
        version INT PRIMARY KEY,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO _schema_init (version, updated_at)
      VALUES (${SCHEMA_VERSION}, NOW())
      ON CONFLICT (version) DO UPDATE SET updated_at = NOW()
    `;

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

// 세션 쿠키 자체가 HMAC 서명된 {uid,name,role,exp}를 들고 있으므로
// 매 요청마다 users 테이블 조회할 필요 없음 → 인증 API 라운드트립 -1
export async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies.tm_session);
  if (!session?.uid) return null;
  return { id: session.uid, name: session.name, role: session.role, registered: true };
}

export function requireAuth(handler) {
  return async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = user;
    // 스키마는 백그라운드 — 마커가 있으면 즉시, 없으면 me/signup에서 처리됨
    ensureSchema().catch(() => {});
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

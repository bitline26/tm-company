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
// 문실장 = 직원(employee) — 차장 권한 해제됨
export const PRESET_NAMES = [
  '문실장','김상현','이경민','임세인','양정연','장영인',
  '안다혜','지성훈','이기성','고윤호','박철우','최은정',
];
const MANAGER_NAMES = new Set(); // 차장 권한자 없음

// 대표(관리자) 시드 계정 — 매 ensureSchema 마다 upsert (비번 변경 시 즉시 반영)
const ADMIN_NAME = '1';
const ADMIN_DEFAULT_PW = '1';
// 테스트 계정 '2','3' 은 폐기 — DB 에 있으면 마이그레이션이 제거 (직원 목록·PB TM 드롭다운에서도 자동 사라짐)

// 스키마 마커 — 이 버전이 DB에 기록되어 있으면 ensureSchema 풀실행 스킵
const SCHEMA_VERSION = 18;
// 1회용 시드 마커 — 이 버전이 _schema_init 에 기록된 적 있으면 bulk seed 건너뜀 (이후 SCHEMA_VERSION 더 올려도 재시드 안 됨)
// v18 = 직원 일부 누락 발견 → 강제 재시드 (1차 12 + 2차 16 = 28명 전부 복구)
const BULK_SEED_MARKER = 18;

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
    // 일 TM 마감 상세 컬럼 (접수/취소/대기/예약/신불/부재/가망/재컨택)
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS received     INT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS cancelled    INT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS waiting      INT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS reserved     INT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS newpay_fail  INT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS absent       INT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS prospect     INT NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE sales_tm_daily ADD COLUMN IF NOT EXISTS recontact    INT NOT NULL DEFAULT 0`;

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
    // 정리: 미가입 + 비밀번호 없는 시드 직원(PRESET_NAMES) 일괄 삭제
    // → 디렉토리에서 '미가입' 카드 제거. 가입 신청 후 대기 중인 사용자(비밀번호 있음)는 유지.
    await sql`DELETE FROM users WHERE registered = FALSE AND password_hash IS NULL`;
    // 계정 상태 + 허용 IP (대표가 직원 관리 페이지에서 컨트롤)
    // status: active(활성) / suspended(정지) / resigned(퇴사) — 로그인 차단
    // allowed_ips: 비어있으면 제한 없음, 1개 이상이면 그 IP에서만 로그인 가능
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_ips TEXT[] DEFAULT '{}'`;
    await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check`;
    await sql`ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','suspended','resigned'))`;
    // 로그인 추적 — 대표가 직원 관리 페이지에서 최근 접속 IP 확인 + '현재 IP로 잠그기'에 사용
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`;
    // IP 그룹 마스터 (대표가 미리 등록, 최대 200) + 직원별 모드/그룹 선택
    // ip_mode: 'all' = 모든 IP 허용 / 'restricted' = 선택된 그룹의 IP만 허용
    await sql`
      CREATE TABLE IF NOT EXISTS ip_groups (
        id SERIAL PRIMARY KEY,
        label TEXT UNIQUE NOT NULL,
        ips TEXT[] NOT NULL DEFAULT '{}',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_mode TEXT NOT NULL DEFAULT 'all'`;
    await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ip_mode_check`;
    await sql`ALTER TABLE users ADD CONSTRAINT users_ip_mode_check CHECK (ip_mode IN ('all','restricted'))`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_group_ids INT[] NOT NULL DEFAULT '{}'`;
    // PB 내역 상태 — 'UNPAID_PROOF'(미입금:입금증필요) 추가
    await sql`ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check`;
    await sql`ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
        CHECK (status IN ('PAID','IN_PROGRESS','UNPAID','UNPAID_PROOF','PARTIAL','CANCELLED'))`;
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
    // 1회용 — 1차/2차 명단 일괄 시드. 이미 BULK_SEED_MARKER 가 기록되어 있으면 스킵.
    let runBulkSeed = false;
    try {
      const r = await sql`SELECT 1 AS x FROM _schema_init WHERE version = ${BULK_SEED_MARKER} LIMIT 1`;
      runBulkSeed = !r[0];
    } catch (_) { runBulkSeed = true; }
    if (runBulkSeed) {
      // 1차 12 + 2차 16 upsert (DELETE 안 함 — 기존 PB/근태 등 데이터 보존)
      // ON CONFLICT (name) DO UPDATE 로 누락된 직원만 INSERT 되고, 있으면 정보만 갱신
      const TIER1_SEED = [
        ['문정자','tami13'],['이경민','tami14'],['임세인','tami9612'],
        ['양정연','tami1102'],['장영인','tami0425'],['고윤호','tami0308'],
        ['안다혜','tami0404'],['김상현','tami44'],['박철우','tami0910'],
        ['이기성','tami1125'],['지성훈','tami02260'],['최은정','tami0426'],
      ];
      const TIER2_SEED = [
        ['공용 강보람','tami0226'],['공용 고윤호','tami308'],['공용 국나래','tami1217'],
        ['공용 권용훈','tami000'],['공용 김민정','tami1114'],['공용 김선화','tami09240'],
        ['공용 남성영','tami03010'],['공용 이준헌','tami09150'],['공용 이지윤','tami1004'],
        ['공용 전은하','tami10220'],['공용 정민지','tami0721'],
        ['공용 김대헌','tami0214'],['공용 심재범','tami03080'],['공용 이예진','tami03310'],
        ['공용 이주필','tami03230'],['공용 한재상','tami0423'],
      ];
      let so = 100;
      for (const [nm, pw] of TIER1_SEED) {
        const h = hashPassword(pw);
        await sql`
          INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
          VALUES (${nm}, ${h.hash}, ${h.salt}, 'employee', TRUE, 1, ${so}, 'active')
          ON CONFLICT (name) DO UPDATE SET
            password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt,
            role='employee', registered=TRUE, tier=1, status='active', sort_order=EXCLUDED.sort_order`;
        so++;
      }
      so = 200;
      for (const [nm, pw] of TIER2_SEED) {
        const h = hashPassword(pw);
        await sql`
          INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
          VALUES (${nm}, ${h.hash}, ${h.salt}, 'employee', TRUE, 2, ${so}, 'active')
          ON CONFLICT (name) DO UPDATE SET
            password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt,
            role='employee', registered=TRUE, tier=2, status='active', sort_order=EXCLUDED.sort_order`;
        so++;
      }
    }

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
    // 테스트 계정 '2','3' 폐기 — 매번 idempotent 삭제 (DB 에 있어도 사라지고, 없으면 no-op)
    const testCleanup = sql`DELETE FROM users WHERE name IN ('2','3') AND role <> 'admin'`;
    // PRESET_NAMES 시드 비활성화 — 신규 직원은 회원가입 페이지에서 직접 신청
    const presetInserts = [];
    // 문실장 차장 → 직원 강등 (대표 지시 — schema v17)
    const demoteMoon = sql`UPDATE users SET role='employee' WHERE name='문실장' AND role='manager'`;
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
    await Promise.all([adminUpsert, adminCleanup, testCleanup, demoteMoon, ...presetInserts, ...vendorInserts]);

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

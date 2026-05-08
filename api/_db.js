import { neon } from '@neondatabase/serverless';

// 환경 분리: production은 운영 DB(neon-cobalt-kettle), 그 외(preview/development)는 테스트 DB(tm-2)
// VERCEL_ENV 값: 'production' | 'preview' | 'development' | undefined(로컬)
const isProd = process.env.VERCEL_ENV === 'production';

const url = isProd
  ? (process.env.DATABASE_URL || process.env.POSTGRES_URL)
  : (process.env.test2_DATABASE_URL
     || process.env.test2_POSTGRES_URL
     || process.env.DATABASE_URL
     || process.env.POSTGRES_URL);

if (!url) throw new Error('DATABASE_URL not set');

export const sql = neon(url);

// 디비 소스 시드 (업체) — 테스트 DB 비었을 때 1회 주입
const SEED_SOURCES = [
  // code, label, vendor, color
  ['SELF',   '자체광고',  'INTERNAL', '#1428A0'],
  ['VENDOR_A', 'A업체',   'A업체',    '#7c3aed'],
  ['VENDOR_B', 'B업체',   'B업체',    '#0ea5e9'],
  ['VENDOR_C', 'C업체',   'C업체',    '#10b981'],
];

// 가짜 DB 10개 (업로드 화면 미리보기용 — 테스트 DB 비었을 때 1회 주입)
const SEED_POOL = [
  // source_code, name, phone, carrier, model
  ['VENDOR_A', '김민수', '010-1234-5678', 'SKT', '갤럭시 S26'],
  ['VENDOR_A', '이지은', '010-2345-6789', 'KT',  '갤럭시 S26 Ultra'],
  ['VENDOR_A', '박철수', '010-3456-7890', 'LGU', '갤럭시 Z Flip7'],
  ['VENDOR_B', '최영희', '010-4567-8901', 'SKT', '갤럭시 Z Fold7'],
  ['VENDOR_B', '정민호', '010-5678-9012', 'KT',  '갤럭시 S26+'],
  ['VENDOR_B', '강수정', '010-6789-0123', 'SKT', '갤럭시 S26 FE'],
  ['VENDOR_C', '윤서연', '010-7890-1234', 'LGU', '갤럭시 S26 Ultra'],
  ['VENDOR_C', '조현우', '010-8901-2345', 'KT',  '갤럭시 S26'],
  ['SELF',     '한지민', '010-9012-3456', 'SKT', '갤럭시 S26 Ultra'],
  ['SELF',     '오태식', '010-0123-4567', 'KT',  '갤럭시 Z Flip7'],
];

// 이미지3 근무표 기준 부서별 직원 시드 (테스트 DB가 비었을 때만 1회 자동 주입)
const SEED_EMPLOYEES = [
  ['배송',   '권용훈'], ['배송',   '김민정'], ['배송',   '정민지'],
  ['개통',   '국나래'], ['개통',   '강보람'], ['개통',   '이지윤'],
  ['해피콜', '전은용'], ['해피콜', '이준형'],
  ['민원',   '김대현'], ['민원',   '심영규'], ['민원',   '이예진'],
  ['민원',   '김선화'], ['민원',   '심재범'], ['민원',   '이주필'],
  ['1차',    '문경자'], ['1차',    '김상현'], ['1차',    '이경민'],
  ['1차',    '임세인'], ['1차',    '양정연'], ['1차',    '장영인'],
  ['1차',    '안다혜'], ['1차',    '지성훈'], ['1차',    '이기성'],
  ['1차',    '고윤호'], ['1차',    '박철우'], ['1차',    '남선영'],
  ['1차',    '최은정'],
];

let initialized = false;
export async function ensureSchema() {
  if (initialized) return;

  // 1. 신청자 (기존)
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
  await sql`CREATE INDEX IF NOT EXISTS idx_apps_source ON applications (source)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_apps_downloaded ON applications (downloaded_at)`;

  // 2. 직원 마스터
  await sql`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      dept TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_emp_dept ON employees (dept, sort_order)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_emp_active ON employees (active)`;

  // 3. 근태
  // status: WORK(정상)/HALF_AM/HALF_PM(반차)/MONTHLY_OFF(월차)/ANNUAL(연차)/SICK(병가)/OFF(휴무)/HOLIDAY(공휴일)/WEEKEND(주말)
  // ratio: 분배 가중치 (정상 1.0, 반차 0.5, 그 외 0.0)
  await sql`
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'WORK',
      ratio REAL NOT NULL DEFAULT 1.0,
      note TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(employee_id, work_date)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_att_date ON attendance (work_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_att_emp_date ON attendance (employee_id, work_date)`;

  // 4. 디비 소스 (업체)
  await sql`
    CREATE TABLE IF NOT EXISTS db_sources (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      vendor TEXT,
      color TEXT DEFAULT '#888',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_src_active ON db_sources (active, sort_order)`;

  // 5. 디비 풀 (자체광고 + 외부업체 통합)
  // status: NEW(신규) / ASSIGNED(분배완료) / CALLING(통화중) / DONE(완료) / DELETED(삭제)
  await sql`
    CREATE TABLE IF NOT EXISTS db_pool (
      id SERIAL PRIMARY KEY,
      source_id INT NOT NULL REFERENCES db_sources(id),
      upload_batch TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      carrier TEXT,
      model TEXT,
      extra_json JSONB,
      inflow_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      assigned_to INT REFERENCES employees(id),
      assigned_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'NEW',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_pool_source ON db_pool (source_id, inflow_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pool_status ON db_pool (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pool_assigned ON db_pool (assigned_to, assigned_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pool_batch ON db_pool (upload_batch)`;

  // 6. 시드 — 직원
  const empCnt = await sql`SELECT COUNT(*)::int AS n FROM employees`;
  if ((empCnt[0]?.n || 0) === 0) {
    for (let i = 0; i < SEED_EMPLOYEES.length; i++) {
      const [dept, name] = SEED_EMPLOYEES[i];
      await sql`INSERT INTO employees (name, dept, sort_order) VALUES (${name}, ${dept}, ${i})`;
    }
  }

  // 7. 시드 — 디비 소스 (업체)
  const srcCnt = await sql`SELECT COUNT(*)::int AS n FROM db_sources`;
  if ((srcCnt[0]?.n || 0) === 0) {
    for (let i = 0; i < SEED_SOURCES.length; i++) {
      const [code, label, vendor, color] = SEED_SOURCES[i];
      await sql`INSERT INTO db_sources (code, label, vendor, color, sort_order) VALUES (${code}, ${label}, ${vendor}, ${color}, ${i})`;
    }
  }

  // 8. 시드 — 가짜 DB 10개 (테스트 DB 풀이 비었을 때만)
  const poolCnt = await sql`SELECT COUNT(*)::int AS n FROM db_pool`;
  if ((poolCnt[0]?.n || 0) === 0 && !isProd) {
    for (let i = 0; i < SEED_POOL.length; i++) {
      const [code, name, phone, carrier, model] = SEED_POOL[i];
      const src = await sql`SELECT id FROM db_sources WHERE code = ${code} LIMIT 1`;
      const sourceId = src[0]?.id;
      if (sourceId) {
        await sql`
          INSERT INTO db_pool (source_id, upload_batch, name, phone, carrier, model)
          VALUES (${sourceId}, 'SEED', ${name}, ${phone}, ${carrier}, ${model})
        `;
      }
    }
  }

  initialized = true;
}

// 부서 정렬 순서 (UI 그룹핑용)
export const DEPT_ORDER = ['배송', '개통', '해피콜', '민원', '1차'];

// 근태 상태 → 분배 가중치
export function statusToRatio(status) {
  switch (status) {
    case 'WORK': return 1.0;
    case 'HALF_AM':
    case 'HALF_PM': return 0.5;
    default: return 0.0; // MONTHLY_OFF / ANNUAL / SICK / OFF / HOLIDAY / WEEKEND
  }
}

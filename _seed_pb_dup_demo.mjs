// PB 중복 의심 데모 시드 — 동일 전화번호로 PAID + UNPAID 공존 케이스
// 사용: node _seed_pb_dup_demo.mjs
import { readFileSync } from 'node:fs';
const envText = readFileSync('.env.preview', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
delete process.env.VERCEL_ENV; // preview DB(test2_*) 사용
const { sql, ensureSchema } = await import('./api/_db.js');
await ensureSchema();

const tms = await sql`
  SELECT id, name FROM users
  WHERE role='employee' AND tier=1 AND name NOT IN ('2','3')
  ORDER BY sort_order ASC LIMIT 3`;
if (!tms.length) { console.error('1차 직원 없음'); process.exit(1); }

// 기존 중복 데모 행 제거 (전화번호 마커로 식별)
await sql`DELETE FROM sales_orders WHERE customer_phone IN ('010-7777-1001','010-7777-1002','010-7777-1003')`;

const today = new Date();
const ymd = (off=0)=>{const d=new Date(today);d.setDate(today.getDate()-off);return d.toISOString().slice(0,10)};

// 케이스 A: 김중복 010-7777-1001 — 5일전 PAID 5만원, 오늘 UNPAID 5만원 (재요청)
await sql`
  INSERT INTO sales_orders
    (tm_user_id, customer_name, customer_phone, carrier, consult_date,
     payment_bank, payment_account, amount, payment_date, status, note)
  VALUES
    (${tms[0].id}, '김중복', '010-7777-1001', 'SK', ${ymd(5)},
     'KB국민', '110-7777-100001', 50000, ${ymd(5)}, 'PAID',  '⚠ 중복 데모 — 이미 입금됨'),
    (${tms[0].id}, '김중복', '010-7777-1001', 'SK', ${ymd(0)},
     'KB국민', '110-7777-100001', 50000, NULL,      'UNPAID','⚠ 중복 데모 — 미입금 재요청 (차단되어야 함)')`;

// 케이스 B: 박이중 010-7777-1002 — 3일전 PAID 30만원, 1일전 PAID 30만원 (둘 다 입금완료된 중복)
await sql`
  INSERT INTO sales_orders
    (tm_user_id, customer_name, customer_phone, carrier, consult_date,
     payment_bank, payment_account, amount, payment_date, status, note)
  VALUES
    (${tms[1].id}, '박이중', '010-7777-1002', 'KT', ${ymd(3)},
     '신한', '110-7777-200001', 300000, ${ymd(3)}, 'PAID', '⚠ 중복 데모 — 1차 입금'),
    (${tms[1].id}, '박이중', '010-7777-1002', 'KT', ${ymd(1)},
     '신한', '110-7777-200002', 300000, ${ymd(1)}, 'PAID', '⚠ 중복 데모 — 2차 입금(이중)')`;

// 케이스 C: 정세번 010-7777-1003 — 미입금 2건 (단순 전화 중복 — 노랑 배너만)
await sql`
  INSERT INTO sales_orders
    (tm_user_id, customer_name, customer_phone, carrier, consult_date,
     payment_bank, payment_account, amount, payment_date, status, note)
  VALUES
    (${tms[2% tms.length].id}, '정세번', '010-7777-1003', 'LGU', ${ymd(2)},
     '우리', '110-7777-300001', 100000, NULL, 'UNPAID', '⚠ 중복 데모 — 미입금(전화 중복만)'),
    (${tms[2% tms.length].id}, '정세번', '010-7777-1003', 'LGU', ${ymd(0)},
     '우리', '110-7777-300002', 100000, NULL, 'UNPAID', '⚠ 중복 데모 — 미입금(전화 중복만)')`;

console.log('PB 중복 데모 시드 완료:');
console.log('  · 김중복(010-7777-1001) — PAID 1 + UNPAID 1 → 미입금→입금완료 변경 시 차단');
console.log('  · 박이중(010-7777-1002) — PAID 2 (이미 이중 입금)');
console.log('  · 정세번(010-7777-1003) — UNPAID 2 (전화 중복만 · 노랑 배너)');

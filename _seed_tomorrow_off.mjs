// 내일 휴무자 3명 시드 — 알리고 친구톡 발송 테스트용
// 사용: node _seed_tomorrow_off.mjs (개발/preview DB) 또는 VERCEL_ENV=production node ... (운영)
import { readFileSync } from 'node:fs';
const envText = readFileSync('.env.preview', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
// 운영 DB에 시드하려면 VERCEL_ENV=production 으로 호출. 기본은 preview(test2_*) DB.
if (process.argv.includes('--prod')) process.env.VERCEL_ENV = 'production';
const { sql, ensureSchema } = await import('./api/_db.js');
await ensureSchema();

// 내일 KST
const now = new Date();
const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
kst.setUTCDate(kst.getUTCDate() + 1);
const tomorrow = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth()+1).padStart(2,'0')}-${String(kst.getUTCDate()).padStart(2,'0')}`;

const users = await sql`
  SELECT id, name, tier FROM users
  WHERE role='employee' AND name NOT IN ('2','3')
  ORDER BY tier ASC, sort_order ASC, id ASC
  LIMIT 3
`;
if (users.length < 3) { console.error('직원 3명 미만'); process.exit(1); }

const seeds = [
  { user: users[0], type: 'ANNUAL',  note: '연차' },
  { user: users[1], type: 'OFF',     note: '휴무' },
  { user: users[2], type: 'HALF_AM', note: '오전반차' },
];

// 기존 내일 행 제거 후 재시드 (중복 방지)
const ids = users.map(u=>u.id);
await sql`DELETE FROM attendance_records WHERE work_date = ${tomorrow} AND user_id = ANY(${ids})`;

for (const s of seeds) {
  await sql`
    INSERT INTO attendance_records (user_id, work_date, type, status, note, approved_at)
    VALUES (${s.user.id}, ${tomorrow}, ${s.type}, 'APPROVED', ${'테스트 시드 - '+s.note}, NOW())
  `;
}

console.log(`내일(${tomorrow}) 휴무자 3명 시드 완료:`);
seeds.forEach(s => console.log(`  · ${s.user.name} (tier${s.user.tier}) — ${s.note}`));
console.log(`\nDB: ${process.env.VERCEL_ENV==='production'?'운영':'preview(test2)'}`);

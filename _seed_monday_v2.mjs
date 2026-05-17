// 월요일(5/18) 휴무자 임의 추가 — 이번엔 양정연/박철우 (대표 지시)
import { readFileSync } from 'node:fs';
const envText = readFileSync('.env.preview', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
process.env.VERCEL_ENV = 'production';
const { sql } = await import('./api/_db.js');
const { buildSingleOffMessage, sendAdminFriendtalk } = await import('./api/_notify.js');

const monday = '2026-05-18';
const targets = ['양정연','박철우'];
const types = ['OFF','ANNUAL'];

await sql`DELETE FROM attendance_records WHERE work_date=${monday} AND note='임의시드'`;

for (let i=0;i<targets.length;i++){
  const u = await sql`SELECT id FROM users WHERE name=${targets[i]} LIMIT 1`;
  if (!u[0]) { console.log(`skip ${targets[i]} — not found`); continue; }
  await sql`
    INSERT INTO attendance_records (user_id, work_date, type, status, note)
    VALUES (${u[0].id}, ${monday}, ${types[i]}, 'APPROVED', '임의시드')
    ON CONFLICT (user_id, work_date) DO UPDATE
      SET type=EXCLUDED.type, status='APPROVED', note='임의시드',
          approved_by=NULL, approved_at=NOW(), reject_reason=NULL
  `;
  console.log(`+ ${targets[i]} 5/18 ${types[i]} APPROVED`);

  // 즉시 SMS 발송 — 010-4300-8739 한 번호로만 (대표 지시)
  const msg = buildSingleOffMessage({ name: targets[i], date: monday, type: types[i], kind: 'APPROVED' });
  try {
    const r = await sendAdminFriendtalk({
      message: msg,
      subject: '휴무 등록(시드)',
      overrideReceivers: ['01043008739'],
    });
    console.log(`  → SMS ${r.ok?'OK':'FAIL'} ${JSON.stringify(r.sent?.[0]?.body||{})}`);
  } catch(e) {
    console.log(`  → SMS 예외: ${e.message}`);
  }
}
console.log('운영 DB + SMS 발송 완료');

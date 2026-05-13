// 1회용 — 1차 TM 12명 시드 (이름 + tami코드 비밀번호)
// 사용:  node _seed_tm12.mjs
// 이미 존재하면 비밀번호/직급/활성만 갱신 (이름 충돌 시 UPDATE)
import { readFileSync } from 'node:fs';

// .env.local 수동 로드 — _db.js import 전에 해야 함
const envText = readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { sql, ensureSchema, hashPassword } = await import('./api/_db.js');
await ensureSchema();

const TMS = [
  ['문경자', 'tami13'],
  ['이경민', 'tami34'],
  ['임세인', 'tami9612'],
  ['양정연', 'tami1102'],
  ['장영인', 'tami0425'],
  ['고윤호', 'tami0308'],
  ['안다혜', 'tami0404'],
  ['김상형', 'tami44'],
  ['박철우', 'tami0910'],
  ['이기성', 'tami1125'],
  ['지성훈', 'tami02260'],
  ['최은정', 'tami0426'],
];

for (let i = 0; i < TMS.length; i++) {
  const [name, pw] = TMS[i];
  const { hash, salt } = hashPassword(pw);
  const sortOrder = 100 + i;
  const found = await sql`SELECT id FROM users WHERE name = ${name} LIMIT 1`;
  if (found[0]) {
    await sql`
      UPDATE users
      SET password_hash=${hash}, password_salt=${salt},
          tier=1, role='employee', registered=TRUE, status='active',
          sort_order=${sortOrder}
      WHERE id=${found[0].id}
    `;
    console.log(`UPDATE ${name} (id=${found[0].id})  pw=${pw}`);
  } else {
    const r = await sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
      VALUES (${name}, ${hash}, ${salt}, 'employee', TRUE, 1, ${sortOrder}, 'active')
      RETURNING id
    `;
    console.log(`INSERT ${name} (id=${r[0].id})  pw=${pw}`);
  }
}

console.log('\n--- 현재 users 테이블 (admin 제외) ---');
const all = await sql`
  SELECT id, name, role, tier, status, registered, sort_order
  FROM users WHERE role <> 'admin'
  ORDER BY sort_order ASC, id ASC`;
all.forEach(u => console.log(
  `id=${u.id}  ${u.name.padEnd(8,' ')}  tier=${u.tier}  ${u.role}  ${u.status}  reg=${u.registered}  sort=${u.sort_order}`
));

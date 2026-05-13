// 12명 시드 이름 정정 — PRESET_NAMES 기준
// 문경자→문실장(manager), 김상형→김상현(employee)
import { readFileSync } from 'node:fs';
const envText = readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { sql, ensureSchema } = await import('./api/_db.js');
await ensureSchema();

// 문경자 → 문실장 (manager)
await sql`UPDATE users SET name='문실장', role='manager' WHERE name='문경자'`;
console.log('rename: 문경자 → 문실장 (manager)');

// 김상형 → 김상현
await sql`UPDATE users SET name='김상현' WHERE name='김상형'`;
console.log('rename: 김상형 → 김상현');

console.log('\n--- 현재 users 테이블 (admin 제외) ---');
const all = await sql`
  SELECT id, name, role, tier, status, registered, sort_order
  FROM users WHERE role <> 'admin'
  ORDER BY sort_order ASC, id ASC`;
all.forEach(u => console.log(
  `id=${u.id}  ${u.name.padEnd(8,' ')}  tier=${u.tier}  ${u.role.padEnd(8,' ')}  ${u.status}  reg=${u.registered}  sort=${u.sort_order}`
));

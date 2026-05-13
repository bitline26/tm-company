import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
const url = env.match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1];
if (!url) throw new Error('DATABASE_URL not found in .env.local');
const sql = neon(url);

const before = await sql`SELECT COUNT(*)::int AS n FROM applications`;
console.log('총 row 수 (정리 전):', before[0].n);

const dups = await sql`
  SELECT phone, COUNT(*)::int AS cnt, MIN(id) AS keep_id, ARRAY_AGG(id ORDER BY id) AS ids
  FROM applications
  GROUP BY phone
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
`;
console.log(`중복 phone 그룹 ${dups.length}개:`);
for (const d of dups) {
  console.log(`  phone=${d.phone}  cnt=${d.cnt}  keep=${d.keep_id}  ids=${d.ids.join(',')}`);
}

const deleted = await sql`
  DELETE FROM applications
  WHERE id NOT IN (
    SELECT MIN(id) FROM applications GROUP BY phone
  )
  RETURNING id, phone
`;
console.log(`삭제된 row ${deleted.length}개:`, deleted.map(r => r.id).join(','));

const after = await sql`SELECT COUNT(*)::int AS n FROM applications`;
console.log('총 row 수 (정리 후):', after[0].n);

// 관전용 계정 '2'(1차), '3'(2차) 강제 생성/갱신 — admin 권한 필요. ensureSchema 마이그레이션이 막혀도 동작.
import { sql, ensureSchema, hashPassword, getCurrentUser } from '../_db.js';

export default async function handler(req, res){
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try{
    await ensureSchema().catch(()=>{}); // 스키마 못 깔려도 진행
    const me = await getCurrentUser(req);
    if (!me || me.role !== 'admin') {
      return res.status(403).json({ error: '대표 전용' });
    }
    const v2 = hashPassword('2');
    const v3 = hashPassword('3');
    const r2 = await sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
      VALUES ('2', ${v2.hash}, ${v2.salt}, 'employee', TRUE, 1, -2, 'active')
      ON CONFLICT (name) DO UPDATE SET
        password_hash=EXCLUDED.password_hash, password_salt=EXCLUDED.password_salt,
        role='employee', tier=1, registered=TRUE, status='active', sort_order=-2
      RETURNING id, name, tier`;
    const r3 = await sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
      VALUES ('3', ${v3.hash}, ${v3.salt}, 'employee', TRUE, 2, -3, 'active')
      ON CONFLICT (name) DO UPDATE SET
        password_hash=EXCLUDED.password_hash, password_salt=EXCLUDED.password_salt,
        role='employee', tier=2, registered=TRUE, status='active', sort_order=-3
      RETURNING id, name, tier`;
    return res.status(200).json({ ok: true, viewers: [r2[0], r3[0]] });
  }catch(e){
    console.error('init-viewers:', e);
    return res.status(500).json({ error: String(e.message||e) });
  }
}

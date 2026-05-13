// 직원 일괄 등록 — 대표(admin) 가 한 번만 호출 (이후 일반 신규는 회원가입 페이지로)
// 정책:
//  - admin('1'), 테스트 계정('2','3') 은 보존
//  - 그 외 직원은 전부 삭제(CASCADE: 근태/PB/마감 등 함께 삭제)
//  - 아래 TIER1 / TIER2 명단을 새로 생성. 비밀번호는 평문 → 해시 저장.
//  - 같은 이름이 들어오면 password/tier 갱신 (ON CONFLICT DO UPDATE)
import { sql, ensureSchema, hashPassword, getCurrentUser, readJson } from '../_db.js';

// 1차직원 (12명) — 이미지 명단 그대로
const TIER1 = [
  ['문정자',  'tami13'],
  ['이경민',  'tami14'],
  ['임세인',  'tami9612'],
  ['양정연',  'tami1102'],
  ['장영인',  'tami0425'],
  ['고윤호',  'tami0308'],
  ['안다혜',  'tami0404'],
  ['김상현',  'tami44'],
  ['박철우',  'tami0910'],
  ['이기성',  'tami1125'],
  ['지성훈',  'tami02260'],
  ['최은정',  'tami0426'],
];

// 2차직원 16명 — 1차의 '고윤호' 와 이름 충돌하므로 2차 고윤호만 " (2차)" suffix
const TIER2 = [
  ['강보람', 'tami0226'],
  ['고윤호 (2차)', 'tami308'],
  ['국나래', 'tami1217'],
  ['권용훈', 'tami000'],
  ['김민정', 'tami1114'],
  ['김선화', 'tami09240'],
  ['남성영', 'tami03010'],
  ['이준헌', 'tami09150'],
  ['이지윤', 'tami1004'],
  ['전은하', 'tami10220'],
  ['정민지', 'tami0721'],
  ['김대헌', 'tami0214'],
  ['심재범', 'tami03080'],
  ['이예진', 'tami03310'],
  ['이주필', 'tami03230'],
  ['한재상', 'tami0423'],
];

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    await ensureSchema();
    const me = await getCurrentUser(req);
    if(!me || me.role !== 'admin'){
      return res.status(403).json({ error: '대표만 사용 가능합니다' });
    }

    const body = await readJson(req).catch(()=>({}));
    const purge = body.purge !== false;  // 기본 = 기존 직원 정리

    let removed = 0;
    if (purge){
      // admin('1') 제외 전부 삭제 (FK ON DELETE CASCADE)
      const del = await sql`
        DELETE FROM users
        WHERE role <> 'admin'
        RETURNING id`;
      removed = del.length;
    }

    let created = 0;
    let sortBase = 100;
    for (const [name, pw] of TIER1){
      const { hash, salt } = hashPassword(pw);
      await sql`
        INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
        VALUES (${name}, ${hash}, ${salt}, 'employee', TRUE, 1, ${sortBase}, 'active')
        ON CONFLICT (name) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          password_salt = EXCLUDED.password_salt,
          role = 'employee',
          registered = TRUE,
          tier = 1,
          status = 'active',
          sort_order = EXCLUDED.sort_order`;
      created++; sortBase++;
    }
    sortBase = 200;
    for (const [name, pw] of TIER2){
      const { hash, salt } = hashPassword(pw);
      await sql`
        INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
        VALUES (${name}, ${hash}, ${salt}, 'employee', TRUE, 2, ${sortBase}, 'active')
        ON CONFLICT (name) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          password_salt = EXCLUDED.password_salt,
          role = 'employee',
          registered = TRUE,
          tier = 2,
          status = 'active',
          sort_order = EXCLUDED.sort_order`;
      created++; sortBase++;
    }

    // 관전용 viewer 계정 '2'(1차), '3'(2차) 강제 생성/갱신
    const v2 = hashPassword('2');
    await sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
      VALUES ('2', ${v2.hash}, ${v2.salt}, 'employee', TRUE, 1, -2, 'active')
      ON CONFLICT (name) DO UPDATE SET
        password_hash=EXCLUDED.password_hash, password_salt=EXCLUDED.password_salt,
        role='employee', tier=1, registered=TRUE, status='active', sort_order=-2`;
    const v3 = hashPassword('3');
    await sql`
      INSERT INTO users (name, password_hash, password_salt, role, registered, tier, sort_order, status)
      VALUES ('3', ${v3.hash}, ${v3.salt}, 'employee', TRUE, 2, -3, 'active')
      ON CONFLICT (name) DO UPDATE SET
        password_hash=EXCLUDED.password_hash, password_salt=EXCLUDED.password_salt,
        role='employee', tier=2, registered=TRUE, status='active', sort_order=-3`;
    return res.status(200).json({
      ok: true,
      removed,
      created,
      tier1: TIER1.length,
      tier2: TIER2.length,
      viewers: ['2','3'],
      message: `${created}명 + 관전 2명 등록 완료 (1차 ${TIER1.length} / 2차 ${TIER2.length}) — 기존 ${removed}명 정리`,
    });
  } catch (e) {
    console.error('bulk-seed error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

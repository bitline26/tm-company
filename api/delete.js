import { sql, ensureSchema } from './_db.js';

// 통합 삭제: applications + db_pool 둘 다 처리
// body 형태:
//   { id: 123 }                 → applications 단건 삭제 (legacy)
//   { id: 'A123' }              → applications 단건 삭제
//   { id: 'P5' }                → db_pool 단건 삭제 (status='DELETED' 소프트)
//   { all: true }               → applications + db_pool 모두 비우기
//   { origin: 'pool', id: 5 }   → db_pool 명시 삭제
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureSchema();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { id, all, origin } = body;

    if (all === true) {
      await sql`TRUNCATE applications RESTART IDENTITY`;
      await sql`UPDATE db_pool SET status = 'DELETED' WHERE status != 'DELETED'`;
      return res.status(200).json({ ok: true, mode: 'all' });
    }

    // ID prefix로 origin 자동 감지: "A123" → application, "P5" → pool
    let target = origin;
    let numId;
    if (typeof id === 'string') {
      if (id[0] === 'A') { target = 'application'; numId = Number(id.slice(1)); }
      else if (id[0] === 'P') { target = 'pool'; numId = Number(id.slice(1)); }
      else { numId = Number(id); }
    } else {
      numId = Number(id);
    }

    if (!numId || !Number.isInteger(numId)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    if (target === 'pool') {
      // 풀은 상태만 DELETED로 (FK 안전 + 복구 가능)
      await sql`UPDATE db_pool SET status = 'DELETED' WHERE id = ${numId}`;
      return res.status(200).json({ ok: true, id: numId, origin: 'pool' });
    }

    // 기본: applications
    await sql`DELETE FROM applications WHERE id = ${numId}`;
    return res.status(200).json({ ok: true, id: numId, origin: 'application' });
  } catch (e) {
    console.error('delete error:', e);
    return res.status(500).json({ error: 'server error', detail: String(e.message || e) });
  }
}

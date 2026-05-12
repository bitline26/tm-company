// /api/holidays?year=YYYY
// 한국 공휴일 (date.nager.at — 정부 공식 데이터, 무료/무인증)
// 폴백: 네이버 캘린더 기준 정적 매핑
// 응답: { year, source, holidays: { 'YYYY-MM-DD': '휴일명', ... } }

const FALLBACK = {
  // 2025 (네이버 캘린더 기준)
  '2025-01-01':'신정',
  '2025-01-28':'설날 연휴','2025-01-29':'설날','2025-01-30':'설날 연휴',
  '2025-03-01':'삼일절','2025-03-03':'삼일절 대체',
  '2025-05-01':'근로자의 날','2025-05-05':'어린이날','2025-05-06':'부처님오신날',
  '2025-06-06':'현충일',
  '2025-08-15':'광복절',
  '2025-10-03':'개천절','2025-10-06':'추석 연휴','2025-10-07':'추석','2025-10-08':'추석 연휴','2025-10-09':'한글날',
  '2025-12-25':'성탄절',
  // 2026
  '2026-01-01':'신정',
  '2026-02-16':'설날 연휴','2026-02-17':'설날','2026-02-18':'설날 연휴',
  '2026-03-01':'삼일절','2026-03-02':'삼일절 대체',
  '2026-05-01':'근로자의 날','2026-05-05':'어린이날',
  '2026-05-24':'부처님오신날','2026-05-25':'부처님오신날 대체',
  '2026-06-06':'현충일',
  '2026-08-15':'광복절',
  '2026-09-24':'추석 연휴','2026-09-25':'추석','2026-09-26':'추석 연휴',
  '2026-10-03':'개천절','2026-10-09':'한글날',
  '2026-12-25':'성탄절',
};

// 영문 → 한글 매핑 (date.nager.at 응답을 한국어로)
const NAME_KO = {
  "New Year's Day": '신정',
  'Korean New Year': '설날',
  'Korean New Year Holiday': '설날 연휴',
  'Independence Movement Day': '삼일절',
  "Children's Day": '어린이날',
  "Buddha's Birthday": '부처님오신날',
  'Memorial Day': '현충일',
  'Liberation Day': '광복절',
  'Korean Thanksgiving Day': '추석',
  'Korean Thanksgiving': '추석',
  'Chuseok': '추석',
  'Chuseok Holiday': '추석 연휴',
  'National Foundation Day': '개천절',
  'Hangul Day': '한글날',
  'Christmas Day': '성탄절',
  'Labour Day': '근로자의 날',
  "Labor Day": '근로자의 날',
  'Substitute Holiday': '대체공휴일',
};

// 메모리 캐시 (Vercel Lambda 콜드스타트 단위지만 효과 있음)
const CACHE = new Map(); // year → { ts, data }
const TTL = 1000 * 60 * 60 * 12; // 12h

async function fetchNager(year){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 4000);
  try {
    const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, { signal: ctrl.signal });
    if (!r.ok) throw new Error('nager '+r.status);
    const arr = await r.json();
    const out = {};
    for (const h of arr) {
      const ko = NAME_KO[h.localName] || NAME_KO[h.name] || h.localName || h.name || '공휴일';
      out[h.date] = ko;
    }
    // 근로자의 날 — date.nager.at 누락 가능 → 보강
    if (!out[`${year}-05-01`]) out[`${year}-05-01`] = '근로자의 날';
    return out;
  } finally { clearTimeout(t); }
}

export default async function handler(req, res){
  const year = String(req.query.year || new Date().getFullYear()).match(/^\d{4}$/)?.[0];
  if (!year) return res.status(400).json({ error: 'year required (YYYY)' });

  const cached = CACHE.get(year);
  if (cached && Date.now() - cached.ts < TTL) {
    res.setHeader('Cache-Control','public, max-age=3600');
    return res.status(200).json({ year, source:'cache', holidays: cached.data });
  }

  let holidays = null, source = 'api';
  try { holidays = await fetchNager(year); }
  catch (e) {
    // 폴백 — 정적 매핑에서 그 해 데이터만 추출
    holidays = Object.fromEntries(Object.entries(FALLBACK).filter(([d])=>d.startsWith(year+'-')));
    source = 'fallback:'+(e.message||'err');
  }

  CACHE.set(year, { ts: Date.now(), data: holidays });
  res.setHeader('Cache-Control','public, max-age=3600');
  return res.status(200).json({ year, source, holidays });
}

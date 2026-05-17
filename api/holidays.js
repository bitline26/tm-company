// /api/holidays?year=YYYY
// 한국 공휴일 + 기념일 + 24절기 + 음력 명절 (네이버 달력 스타일)
// 응답: {
//   year, source,
//   holidays: { 'YYYY-MM-DD': '휴일명', ... },  // 공휴일만 (legacy)
//   events:   [ { date, name, off, kind }, ... ] // 공휴일(off:true) + 기념일/절기(off:false) 통합
// }
// 데이터 출처: 한국천문연구원 + 네이버 달력 (정적 임베드 — 외부 API 의존 없음)

// 공휴일 (네이버 달력 빨강) — 법정 공휴일·임시공휴일·대체공휴일
const HOLIDAYS = {
  // 2025
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
  '2026-06-03':'제9회 전국동시지방선거',
  '2026-06-06':'현충일',
  '2026-08-15':'광복절','2026-08-17':'광복절 대체',
  '2026-09-24':'추석 연휴','2026-09-25':'추석','2026-09-26':'추석 연휴','2026-09-28':'추석 대체',
  '2026-10-03':'개천절','2026-10-05':'개천절 대체','2026-10-09':'한글날',
  '2026-12-25':'성탄절',
  // 2027
  '2027-01-01':'신정',
  '2027-02-06':'설날 연휴','2027-02-07':'설날','2027-02-08':'설날 연휴','2027-02-09':'설날 대체',
  '2027-03-01':'삼일절',
  '2027-05-01':'근로자의 날','2027-05-05':'어린이날','2027-05-13':'부처님오신날',
  '2027-06-06':'현충일','2027-06-07':'현충일 대체',
  '2027-08-15':'광복절','2027-08-16':'광복절 대체',
  '2027-09-14':'추석 연휴','2027-09-15':'추석','2027-09-16':'추석 연휴',
  '2027-10-03':'개천절','2027-10-04':'개천절 대체','2027-10-09':'한글날','2027-10-11':'한글날 대체',
  '2027-12-25':'성탄절',
};

// 기념일·24절기·음력 명절 (네이버 달력 파랑) — 휴일 아니지만 달력에 표시되는 한국 기념일
// 한국천문연구원 기념일정보 + 정부 지정 기념일 + 24절기 + 음력 행사일
const ANNIVERSARIES = {
  // ── 2026 ──
  // 1월
  '2026-01-15':'다이어리데이',
  '2026-01-20':'대한',
  // 2월
  '2026-02-04':'입춘',
  '2026-02-14':'발렌타인데이',
  '2026-02-19':'우수',
  // 3월
  '2026-03-03':'납세자의 날',
  '2026-03-05':'경칩',
  '2026-03-08':'세계 여성의 날',
  '2026-03-14':'화이트데이',
  '2026-03-20':'춘분',
  '2026-03-22':'세계 물의 날',
  '2026-03-24':'세계 결핵의 날',
  '2026-03-26':'안중근 의사 순국일',
  // 4월
  '2026-04-03':'4·3 희생자 추념일',
  '2026-04-05':'식목일·청명',
  '2026-04-07':'보건의 날',
  '2026-04-19':'4·19 혁명 기념일',
  '2026-04-20':'곡우·장애인의 날',
  '2026-04-22':'정보통신의 날',
  '2026-04-25':'법의 날',
  '2026-04-28':'충무공 탄신일',
  // 5월
  '2026-05-06':'입하',
  '2026-05-08':'어버이날',
  '2026-05-11':'입양의 날',
  '2026-05-14':'식품안전의 날',
  '2026-05-15':'스승의 날',
  '2026-05-18':'5·18 민주화운동 기념일',
  '2026-05-19':'발명의 날',
  '2026-05-20':'세계인의 날·성년의 날',
  '2026-05-21':'부부의 날·소만',
  '2026-05-25':'방재의 날',
  '2026-05-31':'바다의 날',
  // 6월
  '2026-06-01':'의병의 날',
  '2026-06-05':'환경의 날',
  '2026-06-06':'망종',
  '2026-06-09':'구강보건의 날',
  '2026-06-10':'6·10 민주항쟁 기념일',
  '2026-06-14':'세계 헌혈의 날',
  '2026-06-15':'노인학대 예방의 날',
  '2026-06-19':'단오',
  '2026-06-21':'하지',
  '2026-06-25':'6·25 전쟁일',
  '2026-06-26':'마약 퇴치의 날',
  '2026-06-28':'철도의 날',
  // 7월
  '2026-07-01':'사회적기업의 날',
  '2026-07-07':'소서',
  '2026-07-11':'세계 인구의 날',
  '2026-07-17':'제헌절',
  '2026-07-18':'정보보호의 날',
  '2026-07-23':'대서',
  // 8월
  '2026-08-08':'입추',
  '2026-08-19':'칠석',
  '2026-08-23':'처서',
  '2026-08-26':'향토예비군의 날',
  // 9월
  '2026-09-04':'태권도의 날',
  '2026-09-07':'사회복지의 날·백로',
  '2026-09-10':'자살예방의 날',
  '2026-09-21':'치매극복의 날',
  '2026-09-22':'국제 평화의 날',
  '2026-09-23':'추분',
  // 10월
  '2026-10-02':'노인의 날',
  '2026-10-08':'한로',
  '2026-10-15':'체육의 날',
  '2026-10-16':'부마민주항쟁 기념일',
  '2026-10-17':'문화의 날',
  '2026-10-21':'경찰의 날',
  '2026-10-23':'상강',
  '2026-10-24':'국제연합일',
  '2026-10-25':'독도의 날',
  '2026-10-28':'교정의 날',
  // 11월
  '2026-11-03':'학생독립운동 기념일',
  '2026-11-07':'입동',
  '2026-11-09':'소방의 날',
  '2026-11-11':'농업인의 날·빼빼로데이',
  '2026-11-17':'순국선열의 날',
  '2026-11-22':'소설',
  // 12월
  '2026-12-01':'세계 에이즈의 날',
  '2026-12-03':'세계 장애인의 날',
  '2026-12-07':'대설',
  '2026-12-10':'세계 인권의 날',
  '2026-12-22':'동지',
};

// 영문 → 한글 매핑 (date.nager.at 응답을 한국어로 — fallback용)
const NAME_KO = {
  "New Year's Day": '신정',
  'Korean New Year': '설날',
  'Lunar New Year': '설날',
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
  'Labor Day': '근로자의 날',
  'Substitute Holiday': '대체공휴일',
};

const CACHE = new Map();
const TTL = 1000 * 60 * 60 * 12;

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
    return out;
  } finally { clearTimeout(t); }
}

// 그 해 휴일 매핑 — 정적 HOLIDAYS 를 baseline 으로 + nager API 응답 보강
async function buildYearHolidays(year){
  const baseline = Object.fromEntries(Object.entries(HOLIDAYS).filter(([d])=>d.startsWith(year+'-')));
  let api = {};
  try { api = await fetchNager(year); } catch(_) { /* baseline 만 사용 */ }
  // 우선순위: 정적 HOLIDAYS(한국 법령 기준 — 임시공휴일·대체공휴일 포함) > nager API
  return Object.assign({}, api, baseline);
}

export default async function handler(req, res){
  const year = String(req.query.year || new Date().getFullYear()).match(/^\d{4}$/)?.[0];
  if (!year) return res.status(400).json({ error: 'year required (YYYY)' });

  const cached = CACHE.get(year);
  if (cached && Date.now() - cached.ts < TTL) {
    res.setHeader('Cache-Control','public, max-age=3600');
    return res.status(200).json({ year, source:'cache', ...cached.data });
  }

  const holidays = await buildYearHolidays(year);
  const anniversaries = Object.fromEntries(
    Object.entries(ANNIVERSARIES).filter(([d])=>d.startsWith(year+'-'))
  );

  // events 통합 배열 — 같은 날에 휴일+기념일 둘 다 있으면 둘 다 포함
  const events = [];
  for (const [d, name] of Object.entries(holidays))      events.push({ date:d, name, off:true,  kind:'holiday' });
  for (const [d, name] of Object.entries(anniversaries)) events.push({ date:d, name, off:false, kind:'memorial' });
  events.sort((a,b)=> a.date<b.date ? -1 : a.date>b.date ? 1 : 0);

  const data = { holidays, anniversaries, events };
  CACHE.set(year, { ts: Date.now(), data });
  res.setHeader('Cache-Control','public, max-age=3600');
  return res.status(200).json({ year, source:'static+nager', ...data });
}

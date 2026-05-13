import puppeteer from 'puppeteer';

const TARGETS = [
  { name: 'KPI',    url: 'https://galaxysale.co.kr/apply_google_kpi/',    cls: 'kpi-cta-btn',    campaign: 'kpi'    },
  { name: 'Demand', url: 'https://galaxysale.co.kr/apply_google_demand/', cls: 'demand-cta-btn', campaign: 'demand' },
];
const N = 60;
const REAL_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
});

for (const t of TARGETS) {
  console.log(`\n=== ${t.name} ===`);
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en'] });
    window.chrome = { runtime: {} };
  });
  await page.setUserAgent(REAL_UA);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' });

  let beacons = 0;
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/g/collect') || u.includes('google-analytics.com') || u.includes('analytics.google.com')) beacons++;
  });

  await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => typeof window.gtag === 'function', { timeout: 15000 }).catch(() => {});

  // 50회 + 여유 = N회 GA4 이벤트 강제 발사
  await page.evaluate(async (campaign, cls, N) => {
    for (let i = 1; i <= N; i++) {
      window.gtag('event', 'cta_click_test', {
        campaign_label: campaign,
        click_class: cls,
        click_index: i,
      });
      await new Promise(r => setTimeout(r, 80));
    }
  }, t.campaign, t.cls, N);

  console.log(`  fired ${N} gtag events`);
  // 비콘 flush 대기
  await new Promise(r => setTimeout(r, 10000));
  console.log(`  GA4 beacons captured: ${beacons}`);
  try { await page.close(); } catch {}
}

try { await browser.close(); } catch {}
console.log('\nALL DONE.');

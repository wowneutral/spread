import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => { if (!r.url().includes('fonts.g')) errors.push('REQFAIL: ' + r.url()); });
try {
  await page.goto('https://wowneutral.github.io/spread/', { waitUntil: 'networkidle', timeout: 45000 });
} catch (e) { console.log('NAV FAIL:', e.message.slice(0,120)); process.exit(1); }
await page.waitForTimeout(1500);
console.log('TITLE:', await page.title());
console.log('TOUR OPEN:', await page.locator('.tour-pop').count());
console.log('WORDMARK:', await page.locator('.wordmark').innerText());
// run tour forward through the live demos
for (let i=0;i<5;i++){ await page.locator('.tour-arrow.next').click(); await page.waitForTimeout(500); }
console.log('TAG:', await page.locator('.cs-h4').count(), 'CITE:', await page.locator('.m-cite').count(),
  'UNDERLINE:', await page.locator('.m-ustyle').count(), 'HL:', await page.locator('.m-hl').count(),
  'SHRINK:', await page.locator('.m-size').count());
await page.keyboard.press('Escape');
// palette on production
await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
console.log('PALETTE:', await page.locator('.palette').count());
await page.keyboard.press('Escape');
// service worker registered?
const sw = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.length ? 'registered' : 'none';
});
console.log('SERVICE WORKER:', sw);
// manifest reachable?
const mf = await page.evaluate(async () => (await fetch('manifest.webmanifest')).status);
console.log('MANIFEST:', mf);
console.log('STATUS BAR:', (await page.locator('.status').innerText()).replace(/\n/g,' | ').slice(0,90));
await page.screenshot({ path: '/tmp/live-1.png' });
console.log('ERRORS:', errors.length ? errors.join(' ; ').slice(0,300) : 'none');
await browser.close(); process.exit(0);

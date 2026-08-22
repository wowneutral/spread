import { chromium } from '@playwright/test';
import { createServer } from 'vite';
const server = await createServer({ root: '/home/claude/cardstock', server: { port: 5196 } });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5196/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
console.log('TOUR OPEN:', await page.locator('.tour-pop').count());
console.log('STEP:', await page.locator('.tour-count').innerText());
await page.screenshot({ path: '/tmp/tour-1.png' });
// advance to the tag step (auto-performs F7)
await page.locator('.tour-arrow.next').click();
await page.waitForTimeout(600);
console.log('STEP2:', await page.locator('.tour-count').innerText(), 'H4:', await page.locator('.cs-h4').count());
await page.screenshot({ path: '/tmp/tour-2.png' });
// cite step
await page.locator('.tour-arrow.next').click(); await page.waitForTimeout(500);
console.log('STEP3 cite marks:', await page.locator('.m-cite').count());
// underline
await page.locator('.tour-arrow.next').click(); await page.waitForTimeout(500);
console.log('STEP4 underline:', await page.locator('.m-ustyle').count());
// highlight
await page.locator('.tour-arrow.next').click(); await page.waitForTimeout(500);
console.log('STEP5 highlight:', await page.locator('.m-hl').count());
await page.screenshot({ path: '/tmp/tour-5.png' });
// shrink
await page.locator('.tour-arrow.next').click(); await page.waitForTimeout(500);
console.log('STEP6 shrunk:', await page.locator('.m-size').count());
// status
await page.locator('.tour-arrow.next').click(); await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/tour-7.png' });
// back arrow works?
await page.locator('.tour-arrow:not(.next)').click(); await page.waitForTimeout(400);
console.log('BACK TO:', await page.locator('.tour-count').innerText());
// finish via keyboard
for (let i=0;i<6;i++){ await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); }
console.log('TOUR CLOSED:', (await page.locator('.tour').count()) === 0);
console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close(); await server.close(); process.exit(0);

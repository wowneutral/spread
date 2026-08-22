import { chromium } from '@playwright/test';
import { createServer } from 'vite';
const server = await createServer({ root: '/home/claude/cardstock', server: { port: 5198 } });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await page.goto('http://localhost:5198/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `/tmp/v2-${theme}-tutorial.png` });
  // build a small doc for the editing shot
  await page.locator('.wordmark').click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/v2-${theme}-home.png` });
  await page.locator('.hcard.primary').click(); await page.waitForTimeout(300);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('1AC — Compute Governance'); await page.keyboard.press('F4');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('ADV 1 — Miscalculation'); await page.keyboard.press('F5');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('Compute export controls are collapsing now'); await page.keyboard.press('F7');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('Vasquez 26 — senior fellow, Center for Emerging Technology Governance, 3-14-2026');
  await page.keyboard.press('Home');
  for (let i=0;i<2;i++) await page.keyboard.press('Shift+Control+ArrowRight');
  await page.keyboard.press('F8');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('Advanced accelerators continue to reach restricted buyers through transshipment hubs that licensing officers concede they cannot audit, and the volume has tripled since the October rules took effect.');
  await page.keyboard.press('Home');
  for (let i=0;i<8;i++) await page.keyboard.press('Shift+Control+ArrowRight');
  await page.keyboard.press('F9');
  await page.keyboard.press('Home');
  for (let i=0;i<2;i++) await page.keyboard.press('Control+ArrowRight');
  for (let i=0;i<4;i++) await page.keyboard.press('Shift+Control+ArrowRight');
  await page.keyboard.press('F11');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/v2-${theme}-editing.png` });
  await page.close();
}
await browser.close(); await server.close(); process.exit(0);

/** Smoke test: file-driven document styles, full ribbon with menus and state
 * lighting, analytics, dropzone, find/replace, read mode, new home layout. */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = join(DIST, p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(4177, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:4177/', { waitUntil: 'load' });
await page.waitForTimeout(800);
if (await page.locator('.tour-skip').count()) await page.locator('.tour-skip').click();
await page.waitForTimeout(300);

console.log('TITLE:', await page.title());
console.log('RIBBON:', await page.locator('.ribbon').count(), 'CTXBAR:', await page.locator('#ctxbar').count());
console.log('DOCWRAP:', await page.evaluate(() => document.getElementById('docwrap').className),
  'BG:', await page.evaluate(() => getComputedStyle(document.getElementById('docwrap')).backgroundColor));

// file-driven stylesheet injected?
const dsc = await page.evaluate(() => document.getElementById('docstyles')?.textContent ?? '');
console.log('DOCSTYLES: h4-13pt:', dsc.includes('.cs-h4') && /cs-h4\{[^}]*font-size:13pt/.test(dsc),
  'calibri:', dsc.includes('Calibri'), 'h1-boxed:', /cs-h1\{[^}]*border:1pt/.test(dsc));

// ribbon state lighting: cursor into the tag line (tour ran? we skipped — use body)
await page.locator('.cs-p').first().click();
console.log('LIT(before tag):', await page.locator('.rb.on[data-k]').count());
await page.locator('.rb[data-k="h4"]').click();
await page.waitForTimeout(150);
console.log('TAG LIT:', await page.locator('.rb.on[data-k="h4"]').count());
await page.locator('.rb[data-k="h4"]').click(); // toggle back
await page.waitForTimeout(100);

// analytic toggle
await page.locator('.cs-p').first().click();
await page.locator('.rb[data-k="analytic"]').click();
await page.waitForTimeout(150);
console.log('ANALYTIC:', await page.locator('.cs-analytic').count(),
  'LIT:', await page.locator('.rb.on[data-k="analytic"]').count());
await page.locator('.rb[data-k="analytic"]').click();
await page.waitForTimeout(100);

// font size menu on a selection
await page.evaluate(() => {
  const el = document.querySelector('.cs-p');
  const t = el.firstChild;
  const sel = window.getSelection(); const r = document.createRange();
  r.setStart(t, 0); r.setEnd(t, Math.min(8, t.textContent.length));
  sel.removeAllRanges(); sel.addRange(r);
});
await page.locator('.rb.fsz').click();
await page.waitForTimeout(150);
console.log('SIZE MENU:', await page.locator('.rpick.rmenu').count());
await page.getByRole('button', { name: '8 pt', exact: true }).click();
await page.waitForTimeout(150);
console.log('SIZE MARKS:', await page.locator('.m-size').count());

// Doc menu
await page.locator('.rb:has-text("Doc ▾")').click();
await page.waitForTimeout(150);
console.log('DOC MENU ITEMS:', await page.locator('.rpick.rmenu button').count());
await page.keyboard.press('Escape');

// Card menu → park in dropzone
await page.locator('.cs-p').first().click();
await page.locator('.rb:has-text("Card ▾")').click();
await page.waitForTimeout(150);
await page.locator('.rpick button:has-text("Park in dropzone")').click();
await page.waitForTimeout(200);
console.log('DROPZONE ITEMS:', await page.locator('.dz-item').count());

// find + replace
await page.keyboard.press('Control+h');
await page.waitForTimeout(200);
console.log('FIND ROWS:', await page.locator('#findbar .frow').count());
await page.keyboard.press('Escape');

// read mode
await page.locator('.rb[data-k="read"]').click();
await page.waitForTimeout(150);
console.log('READMODE:', await page.evaluate(() => document.getElementById('docwrap').className.includes('readmode')),
  'EDITABLE:', await page.locator('.ProseMirror').getAttribute('contenteditable'));
await page.locator('.rb[data-k="read"]').click();

// settings: five tabs
await page.locator('.rb[title="Settings"]').click();
await page.waitForTimeout(200);
console.log('SETTINGS TABS:', await page.locator('.set-tabs button').count());
await page.locator('.set-tabs button:has-text("Appearance")').click();
await page.waitForTimeout(150);
console.log('SIZE GRID CELLS:', await page.locator('.szcell').count(),
  'FONT OPTS:', await page.locator('.set-body .row button:has-text("Times New Roman")').count());
await page.keyboard.press('Escape');

// home redesign
await page.locator('.wordmark').click();
await page.waitForTimeout(300);
console.log('HOME2:', await page.locator('.home2').count(),
  'ACTIONS:', await page.locator('.h2-action').count(),
  'RECENTS PANEL:', await page.locator('.h2-right').count());
await page.screenshot({ path: '/tmp/v2-home-dark.png' });

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
server.close();

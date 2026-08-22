/** Smoke test for the parity batch: full toolbar default, paper-white doc in
 * dark mode, dynamic tab title, read mode, find, condense, case, shd. Runs
 * against a local preview of dist/. */
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:4177/', { waitUntil: 'load' });
await page.waitForTimeout(800);

// first visit auto-opens the tour on the practice file — skip it
if (await page.locator('.tour-skip').count()) await page.locator('.tour-skip').click();
await page.waitForTimeout(300);

console.log('TITLE(practice):', await page.title());
console.log('RIBBON(default):', await page.locator('.ribbon').count());
console.log('CTXBAR HIDDEN:', await page.locator('#ctxbar[hidden]').count());

// paper-white doc in dark mode
const paper = await page.evaluate(() => {
  const w = document.getElementById('docwrap');
  return { cls: w.className, bg: getComputedStyle(w).backgroundColor };
});
console.log('DOCWRAP:', JSON.stringify(paper));

// spellcheck off by default
console.log('SPELLCHECK:', await page.locator('.ProseMirror').getAttribute('spellcheck'));

// body text is 11pt full ink (not faked small)
const p = await page.evaluate(() => {
  const el = document.querySelector('.cs-p');
  const cs = getComputedStyle(el);
  return { size: cs.fontSize, color: cs.color };
});
console.log('BODY:', JSON.stringify(p)); // 11pt ≈ 14.67px

// find bar
await page.keyboard.press('Control+f');
await page.waitForTimeout(200);
console.log('FINDBAR:', await page.locator('#findbar').count());
await page.locator('#findbar input').fill('grid');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
console.log('FIND COUNT:', await page.locator('#findbar .fcount').innerText());
await page.keyboard.press('Escape');

// condense via the ribbon button: cursor in card body, merge paragraphs
const before = await page.locator('.cs-p').count();
await page.locator('.cs-p').first().click();
await page.locator('.rb[title^="Condense"]').click();
await page.waitForTimeout(200);
const after = await page.locator('.cs-p').count();
console.log('CONDENSE:', before, '->', after);

// toggle case via ribbon on a selection in the body
const selectInBody = () => page.evaluate(() => {
  const el = document.querySelector('.cs-p');
  const t = el.firstChild.nodeType === 3 ? el.firstChild : el.querySelector('*').firstChild;
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(t, 0); range.setEnd(t, Math.min(10, t.textContent.length));
  sel.removeAllRanges(); sel.addRange(range);
});
await selectInBody();
await page.locator('.rb[title^="Cycle case"]').click();
await page.waitForTimeout(150);
console.log('CASE:', (await page.locator('.cs-p').first().innerText()).slice(0, 12));

// background shade via ribbon on same selection
await selectInBody();
await page.locator('.rb[title^="Background color"]').click();
await page.waitForTimeout(150);
console.log('SHD SPANS:', await page.locator('.m-shd').count());

// read mode via ribbon eye
await page.locator('.rb[title*="Read mode"]').click();
await page.waitForTimeout(200);
console.log('READMODE CLASS:', await page.evaluate(() => document.getElementById('docwrap').className));
console.log('EDITABLE:', await page.locator('.ProseMirror').getAttribute('contenteditable'));
await page.locator('.rb[title*="Read mode"]').click();

// tab title follows doc, resets on home
await page.locator('.wordmark').click();
await page.waitForTimeout(200);
console.log('TITLE(home):', await page.title());
console.log('HOME FOOT LINKS:', await page.locator('.home-foot a').count());

await page.screenshot({ path: '/tmp/parity-dark.png', fullPage: false });
console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
server.close();

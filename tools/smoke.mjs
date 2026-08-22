import { chromium } from '@playwright/test';
import { createServer } from 'vite';
const server = await createServer({ root: '/home/claude/cardstock', server: { port: 5199 } });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
// Tutorial should open on first run
await page.screenshot({ path: '/tmp/shot-1-tutorial.png' });
// Interact: click into the editor, select a word, check ctx toolbar
const title = await page.title();
console.log('TITLE:', title);
console.log('HAS EDITOR:', await page.locator('.ProseMirror').count());
// Test F7 tag on tutorial step-1 line
await page.locator('.ProseMirror').click();
// Go home
await page.locator('.wordmark').click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/shot-2-home.png' });
console.log('HOME CARDS:', await page.locator('.hcard').count());
// New document
await page.locator('.hcard.primary').click();
await page.waitForTimeout(400);
await page.locator('.ProseMirror').click();
await page.keyboard.type('1AC — Test Aff');
await page.keyboard.press('F4');
await page.waitForTimeout(200);
console.log('POCKET APPLIED:', await page.locator('.cs-h1').count());
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('Warming causes extinction');
await page.keyboard.press('F7');
await page.waitForTimeout(200);
console.log('TAG APPLIED:', await page.locator('.cs-h4').count());
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.type('The evidence is overwhelming and the impacts are irreversible');
// select some words and underline + highlight
await page.keyboard.press('Home');
for (let i=0;i<3;i++) await page.keyboard.press('Shift+Control+ArrowRight');
await page.keyboard.press('F9');
await page.waitForTimeout(150);
console.log('UNDERLINE MARKS:', await page.locator('.m-ustyle').count());
await page.keyboard.press('F11');
await page.waitForTimeout(150);
console.log('HIGHLIGHT MARKS:', await page.locator('.m-hl').count());
console.log('CTX TOOLBAR VISIBLE:', await page.locator('.ctxbar:not([hidden])').count());
await page.screenshot({ path: '/tmp/shot-3-editing.png' });
// outline populated?
console.log('OUTLINE ITEMS:', await page.locator('.tree button').count());
// palette
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
console.log('PALETTE OPEN:', await page.locator('.palette').count());
await page.screenshot({ path: '/tmp/shot-4-palette.png' });
await page.keyboard.press('Escape');
// status bar
console.log('STATUS:', (await page.locator('.status').innerText()).replace(/\n/g,' | '));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
await server.close();
process.exit(0);

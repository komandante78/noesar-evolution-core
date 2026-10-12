// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The look, page by page, in a real headless browser: every theme, the pages that matter, Advanced, a phone, and a few crops of the
// parts that stay small in a whole-page shot. It is how a UI surface is SEEN rendered when the window of the real browser is covered
// or there is no display, and the project's own rule is that a surface is not done until it has been seen (see page-screenshot.mjs).
//
// Runs INSIDE the digest-pinned Puppeteer container, against a DISPOSABLE probe, signed in as a throwaway Owner, through the
// browser acceptance harness's own apparatus:
//
//   NOESAR_E2E_DRIVER=tools/capture-screens.mjs bash tools/run-browser-e2e.sh > screens.log
//   node tools/split-screenshots.mjs screens.log ./screens
//
// Each capture is delimited in the log, as page-screenshot.mjs does, so nothing is mounted into the runner:
//   ===SCREENSHOT <name>===
//   <base64 PNG>
//   ===END===
//
// The app scrolls INSIDE a 100vh shell, so a "full page" capture sees only the first screen. A page that is longer is shot with a
// tall viewport instead (TALL below). Edit THEMES / PER_THEME / EXTRA below for the next use: the runner forwards no other variable.
//
// It counts a page that throws (pageerror) or a view that does not become active as a failure, and prints the same BROWSER_E2E_*
// counters the runner's retention policy reads. Console messages are reported but are not failures: a probe on plain http always
// says that a Cross-Origin-Opener-Policy header was ignored.
import puppeteer from 'puppeteer';
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const BASE = process.env.NOESAR_E2E_BASE_URL;
const SETUP_TOKEN = process.env.NOESAR_E2E_SETUP_TOKEN;
const PASSWORD = 'screens throwaway passphrase for a disposable probe';
const USERNAME = 'screensowner';
if (!BASE || !SETUP_TOKEN) { console.error('NOESAR_E2E_BASE_URL and NOESAR_E2E_SETUP_TOKEN are required.'); process.exit(2); }

const THEMES = ['midnight', 'slate', 'graphite', 'indigo', 'teal', 'amber', 'violet', 'daylight', 'contrast'];
const PER_THEME = ['#/chat', '#/settings/appearance'];
const EXTRA_THEMES = ['midnight', 'amber', 'daylight'];
const EXTRA = ['#/coden', '#/models', '#/projects', '#/tasks', '#/documents', '#/settings/health', '#/settings/about', '#/settings/storage', '#/settings/privacy', '#/settings/security'];
const FOCUS_THEMES = ['amber', 'midnight'];
const TALL = 2600;

let total = 0;
let failures = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorsFor = new Map();

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
let current = 'start';
const note = (line) => { const list = errorsFor.get(current) ?? []; list.push(line.slice(0, 160)); errorsFor.set(current, list); };
page.on('pageerror', (error) => note(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') note(`console: ${message.text()}`); });

function emit(name, png) {
  total += 1;
  console.log(`===SCREENSHOT ${name}===`);
  console.log(png);
  console.log('===END===');
}
async function shoot(name, { tall = false } = {}) {
  const original = page.viewport();
  if (tall) { await page.setViewport({ ...original, height: TALL, deviceScaleFactor: 1 }); await sleep(500); }
  const png = await page.screenshot({ encoding: 'base64', fullPage: false });
  if (tall) await page.setViewport(original);
  emit(name, png);
}
async function crop(name, selector, closest) {
  const handle = await page.$(selector);
  if (!handle) { total += 1; failures += 1; console.log(`FAIL no element: ${selector}`); return; }
  const target = closest ? (await handle.evaluateHandle((node, parent) => node.closest(parent), closest)).asElement() : handle;
  emit(name, await target.screenshot({ encoding: 'base64' }));
}
async function visit(route) {
  const view = route.replace(/^#\//, '').split('/')[0];
  await page.evaluate((hash) => { location.hash = hash; }, route);
  await page.waitForFunction((id) => document.querySelector(`#view-${id}`)?.classList.contains('active') === true, { timeout: 15000 }, view)
    .catch(() => { failures += 1; console.log(`FAIL view not active: ${route}`); });
  await sleep(900);
}
async function themed(theme, level = 'base') {
  await page.evaluate((id, lvl) => { try { localStorage.setItem('noesar.theme.chosen', id); localStorage.setItem('noesar.ui.level', lvl); } catch { /* none */ } }, theme, level);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#authGate.hidden', { timeout: 20000 });
  await sleep(500);
}
const slug = (route) => route.replace(/^#\//, '').replace(/\//g, '-');

let exitCode = 0;
try {
  // the sign-in box, with the mark, before anyone is signed in
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#setupForm:not(.hidden)', { timeout: 20000 });
  current = 'sign-in';
  await shoot('00-sign-in');
  await page.type('#setupToken', SETUP_TOKEN);
  await page.$eval('#setupUsername', (node) => { node.value = ''; });
  await page.type('#setupUsername', USERNAME);
  await page.$eval('#setupDisplayName', (node) => { node.value = ''; });
  await page.type('#setupDisplayName', 'Screens Owner');
  await page.type('#setupPassword', PASSWORD);
  await page.click('#setupForm button[type="submit"]');
  await page.waitForSelector('#setupMfaForm:not(.hidden)', { timeout: 20000 });
  const totpSecret = await page.$eval('#setupTotpSecret', (node) => node.textContent.trim());
  await page.type('#setupTotpCode', totpCode(totpSecret, Date.now()));
  await page.click('#setupMfaForm button[type="submit"]');
  await page.waitForSelector('#authGate.hidden', { timeout: 25000 });

  for (const theme of THEMES) {
    await themed(theme);
    for (const route of PER_THEME) {
      current = `${theme}${route}`;
      await visit(route);
      await shoot(`${theme}__${slug(route)}`, { tall: route !== '#/chat' });
    }
  }
  for (const theme of EXTRA_THEMES) {
    await themed(theme);
    for (const route of EXTRA) { current = `${theme}${route}`; await visit(route); await shoot(`${theme}__${slug(route)}`, { tall: true }); }
  }
  for (const theme of FOCUS_THEMES) {
    await themed(theme);
    current = `${theme}-crops-appearance`;
    await visit('#/settings/appearance');
    await crop(`${theme}__crop-themes`, '#themeGrid', '.panel');
    await crop(`${theme}__crop-colour`, '#accentPicker', '.panel');
    current = `${theme}-crops-health`;
    await visit('#/settings/health');
    await sleep(1200);
    await page.evaluate(() => { document.querySelector('#logLimit').value = '8'; document.querySelector('#logSearch').click(); });
    await sleep(1500);
    await crop(`${theme}__crop-logs`, '#logResults', '.panel');
    await crop(`${theme}__crop-watchdog`, '#watchdogReport', '.panel');
  }
  await themed('amber', 'advanced');
  for (const route of ['#/chat', '#/coden', '#/settings/health']) { current = `amber-advanced${route}`; await visit(route); await shoot(`amber-advanced__${slug(route)}`, { tall: route !== '#/chat' }); }
  await themed('amber', 'base');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#authGate.hidden', { timeout: 20000 });
  for (const route of ['#/chat', '#/settings/appearance', '#/settings/health']) { current = `phone${route}`; await visit(route); await shoot(`amber-phone__${slug(route)}`, { tall: route !== '#/chat' }); }
} catch (error) {
  console.log(`FAIL driver: ${error.message}`);
  failures += 1;
  exitCode = 1;
} finally {
  await browser.close();
}

for (const [where, list] of errorsFor) {
  const thrown = list.filter((line) => line.startsWith('pageerror'));
  console.log(`MESSAGES ${where}: ${list.length} (pageerror ${thrown.length}) ${[...new Set(list)].slice(0, 3).join(' | ')}`);
  failures += thrown.length;
}
console.log('');
console.log(`BROWSER_E2E_TOTAL=${total}`);
console.log(`BROWSER_E2E_PASS=${Math.max(0, total - failures)}`);
console.log(`BROWSER_E2E_FAIL=${failures}`);
console.log('BROWSER_E2E_FAIL_DECLARED=0');
console.log(`BROWSER_E2E_FAIL_UNDECLARED=${failures}`);
process.exit(exitCode || (failures === 0 ? 0 : 1));

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every address of the interface, measured in a real headless browser, in the widths a person really uses: a phone (390), a tablet (768)
// and a desktop (1440), at both levels and in the themes that matter. The Chrome extension cannot do this on the real installation: the
// window it drives is the person's own, it is not resized for a test, and a covered window is not drawn at all. The audit in
// accessibility-audit.mjs measures contrast, names and focus on one desktop width; this one asks what a narrow screen does to the same pages.
//
// Per address it measures what the browser resolved, and nothing it has to guess: an uncaught error, a request that failed, the page
// scrolling sideways, a visible part that leaves the screen, a control with no name, a control smaller than 24 px (WCAG 2.5.8), text under
// 4.5 : 1 (3 : 1 when large; the worst stop of a gradient, as the audit does), text cut without dots, and text that is broken
// ("[object Object]", "undefined"). Lines kept for screen readers only (clipped to nothing) are not drawn and are not measured.
//
//   NOESAR_E2E_DRIVER=tools/sweep-pages.mjs bash tools/run-browser-e2e.sh > sweep.log
//
// Edit CONFIGS below for the next use: the runner forwards no other variable. Runs against a DISPOSABLE probe, as a throwaway Owner.
import puppeteer from 'puppeteer';
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const BASE = process.env.NOESAR_E2E_BASE_URL;
const SETUP_TOKEN = process.env.NOESAR_E2E_SETUP_TOKEN;
const PASSWORD = 'sweep throwaway passphrase for a disposable probe';
const USERNAME = 'sweepowner';
if (!BASE || !SETUP_TOKEN) { console.error('NOESAR_E2E_BASE_URL and NOESAR_E2E_SETUP_TOKEN are required.'); process.exit(2); }

const THEMES = ['midnight', 'slate', 'graphite', 'indigo', 'teal', 'amber', 'violet', 'daylight', 'contrast'];
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const CONFIGS = [
  { name: 'phone-base', viewport: PHONE, level: 'base', themes: THEMES },
  { name: 'phone-advanced', viewport: PHONE, level: 'advanced', themes: ['midnight', 'daylight', 'amber'] },
  { name: 'tablet-base', viewport: { width: 768, height: 1024 }, level: 'base', themes: ['midnight', 'daylight'] },
  { name: 'desktop-base', viewport: { width: 1440, height: 900 }, level: 'base', themes: ['midnight'] },
];
const ROUTES = ['chat', 'tasks', 'coden', 'coden-tui', 'projects', 'documents', 'knowledge', 'memory', 'research', 'agents', 'workflows', 'models',
  ...['sessions', 'appearance', 'language', 'about', 'privacy', 'people', 'security', 'skills', 'models-hardware', 'storage', 'audit', 'health', 'updates', 'modules', 'remote-targets', 'sessions/archived', 'sessions/bin'].map((s) => `settings/${s}`),
  'coden/bench/shadow', 'coden/bench/editor', 'coden/bench/diff', 'coden/bench/tests', 'coden/bench/logs', 'coden/bench/terminal', 'coden/bench/preview', 'coden/bench/map', 'coden/bench/documentation', 'coden/bench/problems', 'coden/bench/closure',
  'coden/agent/conversation', 'coden/agent/plan', 'coden/agent/activity', 'coden/agent/authority', 'coden/agent/invariants'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let total = 0;
let failures = 0;
const messages = [];

// Runs in the page. Returns the findings for the view that is showing, as short strings.
function measure() {
  const num = (s) => { const m = (s.match(/[\d.]+/g) || [0, 0, 0, 0]).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, base) => [0, 1, 2].map((k) => top[k] * top[3] + base[k] * (1 - top[3]));
  const label = (e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`;
  const clipped = (e) => { for (let a = e.parentElement, i = 0; a && i < 6; a = a.parentElement, i += 1) { const s = getComputedStyle(a); if (s.overflow === 'hidden' && s.position === 'absolute') { const r = a.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2 || /rect\(0px, 0px, 0px, 0px\)/.test(s.clip)) return true; } } return false; };
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2 && !e.closest('[aria-hidden="true"],[hidden],.hidden') && !clipped(e); };
  const scrolls = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { if (/auto|scroll|hidden/.test(getComputedStyle(a).overflowX)) return true; } return false; };
  const backgrounds = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage.includes('gradient')) { const stops = [...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => num(m[0])); if (stops.length) { layers.push(stops); if (stops.every((x) => x[3] >= 0.99)) break; } }
      const c = num(s.backgroundColor);
      if (c[3] > 0) { layers.push([c]); if (c[3] >= 0.99) break; }
    }
    let combos = [[8, 12, 20]];
    for (let i = layers.length - 1; i >= 0; i -= 1) combos = combos.flatMap((base) => layers[i].slice(0, 4).map((t) => over(t, base))).slice(0, 16);
    return combos;
  };
  const named = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent) || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest('label')?.textContent || e.textContent || e.value || e.getAttribute('placeholder') || e.querySelector('img[alt]')?.alt || '').trim();

  const view = [...document.querySelectorAll('section[id^="view-"]')].find(vis);
  if (!view) return ['NO VIEW IS SHOWING'];
  const found = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) found.push(`scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
  const bleed = [...view.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2 && vis(e) && !e.closest('pre,code,table,.xterm') && !scrolls(e)).slice(0, 3).map(label);
  if (bleed.length) found.push(`leaves the screen: ${bleed.join(', ')}`);
  const controls = [...view.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch]')].filter(vis);
  const nameless = controls.filter((e) => !named(e)).slice(0, 3).map(label);
  if (nameless.length) found.push(`control with no name: ${nameless.join(', ')}`);
  const tiny = controls.filter((e) => e.matches('button,input,select,textarea,[role=button],[role=tab],[role=switch]') && !e.closest('.xterm') && (e.getBoundingClientRect().width < 24 || e.getBoundingClientRect().height < 24)).slice(0, 3).map((e) => `${label(e)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
  if (tiny.length) found.push(`target under 24 px: ${tiny.join(', ')}`);
  const texts = [...view.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1) && vis(e)).slice(0, 800);
  const low = []; const cut = [];
  for (const e of texts) {
    const s = getComputedStyle(e);
    if (s.opacity === '0') continue;
    const px = parseFloat(s.fontSize);
    const large = px >= 24 || (px >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
    const fg = num(s.color);
    const worst = Math.min(...backgrounds(e).map((bg) => ratio(over(fg, bg), bg)));
    if (worst < (large ? 3 : 4.5) && low.length < 3) low.push(`${worst.toFixed(1)}:1 ${label(e)} "${e.textContent.trim().slice(0, 18)}"`);
    if (e.scrollWidth > e.clientWidth + 2 && /hidden|clip/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && e.clientWidth > 0 && !/^(pre|code)$/i.test(e.tagName) && cut.length < 3) cut.push(`${label(e)} "${e.textContent.trim().slice(0, 18)}"`);
  }
  if (low.length) found.push(`contrast: ${low.join(' | ')}`);
  if (cut.length) found.push(`text cut without dots: ${cut.join(' | ')}`);
  const text = view.innerText;
  const broken = [...text.matchAll(/\[object Object\]|\bundefined\b|\bNaN\b|\{\{|\}\}|%s\b/g)].map((m) => text.slice(Math.max(0, m.index - 16), m.index + 20).replace(/\s+/g, ' ')).filter((x) => !/instead of NaN/.test(x));
  if (broken.length) found.push(`broken text: ${broken.slice(0, 2).join(' | ')}`);
  const images = [...document.images].filter((i) => vis(i) && i.complete && i.naturalWidth === 0).length;
  if (images) found.push(`${images} image(s) did not load`);
  return found;
}

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
let where = 'start';
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`.slice(0, 160)));
page.on('requestfailed', (request) => { if (!/ERR_ABORTED/.test(request.failure()?.errorText ?? '')) errors.push(`request failed: ${request.url().split('?')[0].replace(BASE, '')}`); });
page.on('response', (response) => { if (response.status() >= 400 && !/\/livez|favicon/.test(response.url())) errors.push(`${response.status()} ${response.url().split('?')[0].replace(BASE, '')}`); });

let exitCode = 0;
try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#setupForm:not(.hidden)', { timeout: 20000 });
  await page.type('#setupToken', SETUP_TOKEN);
  await page.$eval('#setupUsername', (node) => { node.value = ''; });
  await page.type('#setupUsername', USERNAME);
  await page.$eval('#setupDisplayName', (node) => { node.value = ''; });
  await page.type('#setupDisplayName', 'Sweep Owner');
  await page.type('#setupPassword', PASSWORD);
  await page.click('#setupForm button[type="submit"]');
  await page.waitForSelector('#setupMfaForm:not(.hidden)', { timeout: 20000 });
  const secret = await page.$eval('#setupTotpSecret', (node) => node.textContent.trim());
  await page.type('#setupTotpCode', totpCode(secret, Date.now()));
  await page.click('#setupMfaForm button[type="submit"]');
  await page.waitForSelector('#authGate.hidden', { timeout: 25000 });

  for (const config of CONFIGS) {
    await page.setViewport(config.viewport);
    for (const theme of config.themes) {
      await page.evaluate((id, lvl) => { try { localStorage.setItem('noesar.theme.chosen', id); localStorage.setItem('noesar.ui.level', lvl); } catch { /* none */ } }, theme, config.level);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('#authGate.hidden', { timeout: 20000 });
      let clean = 0;
      for (const route of ROUTES) {
        where = `${config.name}/${theme}/${route}`;
        errors.length = 0;
        await page.evaluate((hash) => { location.hash = hash; }, `#/${route}`);
        const view = route.split('/')[0];
        const shown = await page.waitForFunction((id) => document.querySelector(`#view-${id}`)?.classList.contains('active') === true, { timeout: 8000 }, view).then(() => true, () => false);
        await sleep(350);
        const found = shown ? await page.evaluate(measure) : ['view did not become active'];
        for (const line of [...new Set(errors)].slice(0, 3)) found.push(line);
        total += 1;
        if (found.length) { failures += 1; messages.push(`FAIL ${where}: ${found.join(' || ')}`); } else clean += 1;
      }
      console.log(`${config.name.padEnd(15)} ${theme.padEnd(9)} ${clean}/${ROUTES.length} clean`);
    }
  }
} catch (error) {
  console.log(`FAIL driver at ${where}: ${error.message}`);
  failures += 1;
  exitCode = 1;
} finally {
  await browser.close();
}

for (const line of messages) console.log(line);
console.log('');
console.log(`BROWSER_E2E_TOTAL=${total}`);
console.log(`BROWSER_E2E_PASS=${Math.max(0, total - failures)}`);
console.log(`BROWSER_E2E_FAIL=${failures}`);
console.log('BROWSER_E2E_FAIL_DECLARED=0');
console.log(`BROWSER_E2E_FAIL_UNDECLARED=${failures}`);
process.exit(exitCode || (failures === 0 ? 0 : 1));

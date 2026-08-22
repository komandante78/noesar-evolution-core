// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Screenshot one or more routes of a DISPOSABLE probe, signed in as a throwaway Owner,
// and print each PNG as base64 to stdout — so a session with no display can still
// satisfy "a UI surface is declared done only after it has been seen rendered, not
// inferred from markup or CSS" without touching a real installation or the operator's
// own browser (CLAUDE10.md rule 83 reserves that for an explicit, separately confirmed
// use of claude-in-chrome).
//
// Runs INSIDE the digest-pinned Puppeteer container via tools/run-browser-e2e.sh's
// existing disposable-probe apparatus:
//
//   NOESAR_E2E_DRIVER=tools/page-screenshot.mjs bash tools/run-browser-e2e.sh
//
// The runner only forwards NOESAR_E2E_BASE_URL/SETUP_TOKEN to the container (see
// run-browser-e2e.sh's `docker run -e`), so which routes to capture is not an env
// var — edit the VIEWS array below directly for the next use.
//
// Each screenshot is delimited so the caller can split stdout without a parser:
//   ===SCREENSHOT <route>===
//   <base64 PNG>
//   ===END===
import puppeteer from 'puppeteer';
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const BASE = process.env.NOESAR_E2E_BASE_URL;
const SETUP_TOKEN = process.env.NOESAR_E2E_SETUP_TOKEN;
// Not plumbed through an env var: tools/run-browser-e2e.sh only forwards
// NOESAR_E2E_BASE_URL/SETUP_TOKEN to the runner container, and adding a third
// pass-through to a shared script for a one-off list is exactly the coupling
// CLAUDE10.md's no-overengineering guidance warns against. Edit this array directly.
const VIEWS = ['#/knowledge', '#/memory'];
const PASSWORD = 'e2e throwaway passphrase for a disposable probe';
const USERNAME = 'e2eowner';

if (!BASE || !SETUP_TOKEN) {
  console.error('NOESAR_E2E_BASE_URL and NOESAR_E2E_SETUP_TOKEN are required.');
  process.exit(2);
}

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let exitCode = 0;
try {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#setupForm:not(.hidden)', { timeout: 20000 });
  await page.type('#setupToken', SETUP_TOKEN);
  await page.$eval('#setupUsername', (node) => { node.value = ''; });
  await page.type('#setupUsername', USERNAME);
  await page.$eval('#setupDisplayName', (node) => { node.value = ''; });
  await page.type('#setupDisplayName', 'Screenshot Owner');
  await page.type('#setupPassword', PASSWORD);
  await page.click('#setupForm button[type="submit"]');
  await page.waitForSelector('#setupMfaForm:not(.hidden)', { timeout: 20000 });
  const totpSecret = await page.$eval('#setupTotpSecret', (node) => node.textContent.trim());
  await page.type('#setupTotpCode', totpCode(totpSecret, Date.now()));
  await page.click('#setupMfaForm button[type="submit"]');
  await page.waitForSelector('#authGate.hidden', { timeout: 25000 });

  for (const route of VIEWS) {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle2' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const png = await page.screenshot({ encoding: 'base64', fullPage: true });
    console.log(`===SCREENSHOT ${route}===`);
    console.log(png);
    console.log('===END===');
  }
} catch (error) {
  console.error(`SCREENSHOT_ERROR=${error.message}`);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);

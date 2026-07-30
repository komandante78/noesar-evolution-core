// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A colour snapshot of the whole interface, taken from a real browser.
//
// This exists for one job: to prove that introducing the token layer changed NOTHING that
// is painted. Replacing 102 colour literals with named custom properties is a refactor, and
// a refactor that silently shifts a colour is worse than no refactor — the contrast figures
// this project measures would move underneath a green audit.
//
// Reading the diff is not evidence. A value can be right in the stylesheet and wrong on
// screen: it can be overridden later in the cascade, lost to a typo in a var() name (which
// fails silently and falls back to the inherited value), or shadowed by specificity. The
// only honest measurement is what the browser computed.
//
// ## Why the key is the class signature and not the element
//
// A per-element snapshot would compare two different runs of a live application: lists come
// from a database, one run has an approval waiting and the next does not, so the element
// count differs and every position shifts. That diff would be noise, and noise is how a
// check learns to be ignored.
//
// The key is therefore tag + class attribute, and the value is the computed colour tuple.
// Rows of the same list collapse onto one entry, so data variability cancels out. The
// property under test survives intact and is stated exactly:
//
//   NO key present in both snapshots may carry a DIFFERENT colour tuple.
//
// Keys that appear in only one snapshot are reported separately, for triage, and are not
// silently treated as either a pass or a failure.
//
// Runs through tools/run-browser-e2e.sh via NOESAR_E2E_DRIVER, against a disposable probe.
import puppeteer from 'puppeteer';
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const BASE = process.env.NOESAR_E2E_BASE_URL;
const SETUP_TOKEN = process.env.NOESAR_E2E_SETUP_TOKEN;
if (!BASE || !SETUP_TOKEN) {
  console.error('NOESAR_E2E_BASE_URL and NOESAR_E2E_SETUP_TOKEN are required');
  process.exit(2);
}
const PASSWORD = 'snapshot-owner-passphrase-not-a-real-secret-42';

const DESTINATIONS = [
  'home', 'chat', 'coden', 'coden-tui', 'projects', 'documents', 'knowledge', 'memory',
  'agents', 'workflows', 'models', 'research', 'settings',
];
const SETTINGS_SECTIONS = [
  'sessions', 'appearance', 'language', 'about', 'licence', 'privacy', 'people',
  'security', 'models-hardware', 'storage', 'audit', 'health', 'updates',
];
const SURFACES = [
  ...DESTINATIONS.map((name) => ({ name, hash: `#/${name}`, ready: `#view-${name}.active` })),
  ...SETTINGS_SECTIONS.map((name) => ({
    name: `settings/${name}`,
    hash: `#/settings/${name}`,
    ready: `.settings-section[data-section="${name}"].active`,
  })),
];

// Every property that can put a colour on the screen. box-shadow and background-image are
// included because this interface paints most of its surfaces with gradients and glows —
// leaving them out would exempt the majority of what is actually seen.
const COLOUR_PROPERTIES = [
  'color', 'background-color', 'background-image', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'fill', 'stroke',
  'caret-color', 'text-decoration-color', 'column-rule-color', 'accent-color',
];

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  const begun = await page.evaluate(async ({ token, password }) => {
    const response = await fetch('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-noesar-setup-token': token },
      body: JSON.stringify({ username: 'owner', displayName: 'Owner', password }),
    });
    return { status: response.status, body: await response.json() };
  }, { token: SETUP_TOKEN, password: PASSWORD });
  if (begun.status !== 201) throw new Error(`setup failed: ${begun.status}`);
  const code = totpCode(begun.body.totpSecret, Date.now() - 30_000);
  const confirmed = await page.evaluate(async ({ challenge, totp }) => {
    const response = await fetch('/api/v1/auth/setup/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge, totpCode: totp }),
    });
    return { status: response.status };
  }, { challenge: begun.body.challenge, totp: code });
  if (confirmed.status !== 201) throw new Error(`confirm failed: ${confirmed.status}`);

  // The session was established by fetch; a hash-only navigation never re-runs the boot
  // path, so the application would stay on the authentication gate. Reload, do not assume.
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#view-home.active', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const snapshot = new Map();
  let elementsMeasured = 0;

  for (const surface of SURFACES) {
    await page.goto(`${BASE}/${surface.hash}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(surface.ready, { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const entries = await page.evaluate((properties) => {
      const out = [];
      for (const element of document.querySelectorAll('.app-shell *, .app-shell')) {
        // Hidden elements still resolve colours, and a hidden section is exactly where a
        // silent change would hide, so they are measured too.
        const style = getComputedStyle(element);
        const key = `${element.tagName.toLowerCase()}[${element.className || ''}]`;
        const value = properties.map((property) => `${property}=${style.getPropertyValue(property)}`).join(';');
        out.push([key, value]);
      }
      return out;
    }, COLOUR_PROPERTIES);
    elementsMeasured += entries.length;
    for (const [key, value] of entries) {
      // The first value seen for a key wins, and a later disagreement is recorded rather
      // than overwritten: one class signature resolving to two different colour tuples in
      // the same run is itself worth seeing.
      // The alternate key is derived from the VALUE, never from a counter. It used to be
      // suffixed with snapshot.size, which made every alternate key depend on insertion
      // order: adding one new section renumbered thousands of them, and the diff reported
      // 473 changes that were entirely its own bookkeeping. A key that moves when unrelated
      // content is added cannot be compared across runs, which is the one thing it is for.
      let digest = 0;
      for (let index = 0; index < value.length; index += 1) digest = (digest * 31 + value.charCodeAt(index)) | 0;
      if (!snapshot.has(key)) snapshot.set(key, value);
      else if (snapshot.get(key) !== value) snapshot.set(`${key}#alt${(digest >>> 0).toString(36)}`, value);
    }
  }

  const lines = [...snapshot.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  console.log(`SNAPSHOT_SURFACES=${SURFACES.length}`);
  console.log(`SNAPSHOT_ELEMENTS=${elementsMeasured}`);
  console.log(`SNAPSHOT_KEYS=${lines.length}`);
  console.log('SNAPSHOT_BEGIN');
  for (const [key, value] of lines) console.log(`${key}\t${value}`);
  console.log('SNAPSHOT_END');
  await browser.close();
  process.exit(0);
} catch (error) {
  console.error(`SNAPSHOT_FAILED ${error.message}`);
  await browser.close();
  process.exit(1);
}

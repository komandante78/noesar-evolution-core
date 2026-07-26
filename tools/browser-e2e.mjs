// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browser acceptance over every real route, driven through the shipped interface in a
// real headless browser.
//
// Why this exists as executed code rather than a checklist: every defect this product's
// WebUI has produced was invisible to reading and to `node --check`. The CSRF failure
// looked like a working app until you pressed F5. Streaming chat had never worked
// because a loop variable was named twice. A panel that never finishes loading is
// indistinguishable, from the outside, from a panel that is simply empty. All of those
// are found by driving the thing and watching what it does.
//
// Runs INSIDE the digest-pinned Puppeteer container, against a DISPOSABLE probe. It
// bootstraps its own throwaway Owner from the probe's own setup token. It must never be
// pointed at a real installation: it creates an account and changes settings.
import puppeteer from 'puppeteer';
// Resolved relative to this file, so the harness does not depend on where the
// repository happens to be mounted inside the runner container.
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const BASE = process.env.NOESAR_E2E_BASE_URL;
const SETUP_TOKEN = process.env.NOESAR_E2E_SETUP_TOKEN;
const PASSWORD = 'e2e throwaway passphrase for a disposable probe';
const USERNAME = 'e2eowner';

if (!BASE || !SETUP_TOKEN) {
  console.error('NOESAR_E2E_BASE_URL and NOESAR_E2E_SETUP_TOKEN are required.');
  process.exit(2);
}

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/**
 * Click, and if the element cannot be clicked say why.
 *
 * Puppeteer's own failure is "Node is either not clickable or not an Element", which
 * does not distinguish a missing element from one collapsed to zero size by a CSS
 * conflict — and a zero-size button is precisely the "clicking does nothing" defect
 * this suite exists to catch. The geometry is reported so the next failure names its
 * own cause. (This is not hypothetical: a form carrying both `form-stack` (grid) and
 * `inline-form` (flex) produced exactly that, and the bare message did not say so.)
 */
async function clickOrExplain(page, selector) {
  const geometry = await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return { found: false };
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      found: true, width: box.width, height: box.height,
      display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents,
      disabled: Boolean(node.disabled),
    };
  }, selector);
  if (!geometry.found) throw new Error(`${selector}: no such element`);
  if (geometry.width === 0 || geometry.height === 0) {
    throw new Error(`${selector}: collapsed to ${geometry.width}x${geometry.height} (display=${geometry.display}, visibility=${geometry.visibility})`);
  }
  if (geometry.disabled) throw new Error(`${selector}: element is disabled`);
  await page.click(selector);
  return geometry;
}

/** Wait for a fresh TOTP step so a code cannot be rejected as already used. */
async function freshCode(secret, avoid = new Set()) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = totpCode(secret, Date.now());
    if (!avoid.has(code)) return code;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('no fresh TOTP step became available');
}

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
// A real desktop viewport, not Puppeteer's 800x600 default.
//
// Two reasons, both learned here. The layout has a `@media(max-width:1250px)` branch
// that hides the right-hand column entirely, so the default size was exercising a
// different interface from the one an operator sees. And Puppeteer clicks at
// coordinates without hit-testing: on a short viewport it scrolls a control into view
// and can land the click on the sticky top bar instead, which presents as a button that
// silently does nothing — indistinguishable from the defect this suite hunts.
await page.setViewport({ width: 1440, height: 900 });

// Everything the page complains about is collected. A console error or a failed request
// is a finding even when the visible outcome looked correct.
const consoleErrors = [];
const failedRequests = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('requestfailed', (request) => {
  failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
});
page.on('response', (response) => {
  const status = response.status();
  // favicon is served by nothing and is not part of the product surface.
  if (status >= 400 && !response.url().endsWith('/favicon.ico')) {
    failedRequests.push(`${status} ${response.request().method()} ${response.url()}`);
  }
});

function resetObservations() {
  consoleErrors.length = 0;
  failedRequests.length = 0;
}

// Which block is running. A bare "Waiting failed: 15000ms exceeded" names neither the
// step nor the state it was in, which is a diagnostic dead end — the same reason the
// product now reports a correlation ID instead of a stack trace.
let step = 'start';
function at(name) { step = name; }

try {
  at('bootstrap');
  // --- bootstrap the throwaway Owner through the real forms ----------------
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#setupForm:not(.hidden)', { timeout: 20000 });
  await page.type('#setupToken', SETUP_TOKEN);
  await page.$eval('#setupUsername', (node) => { node.value = ''; });
  await page.type('#setupUsername', USERNAME);
  await page.$eval('#setupDisplayName', (node) => { node.value = ''; });
  await page.type('#setupDisplayName', 'E2E Owner');
  await page.type('#setupPassword', PASSWORD);
  await page.click('#setupForm button[type="submit"]');
  await page.waitForSelector('#setupMfaForm:not(.hidden)', { timeout: 20000 });

  const totpSecret = await page.$eval('#setupTotpSecret', (node) => node.textContent.trim());
  check('setup exposes an enrolment secret', Boolean(totpSecret) && totpSecret.length > 10);

  const used = new Set();
  const firstCode = await freshCode(totpSecret, used);
  used.add(firstCode);
  await page.type('#setupTotpCode', firstCode);
  await page.click('#setupMfaForm button[type="submit"]');
  await page.waitForSelector('#authGate.hidden', { timeout: 25000 });
  check('owner bootstrap signs the browser in', true);

  at('csrf');
  // --- the CSRF regression, which is the reason any of this is here --------
  // A write immediately after login always worked. The defect only appeared after a
  // reload, because the token lived in a module variable that a reload reset while the
  // session cookie survived. This asserts the fixed behaviour in the order that used
  // to break it.
  resetObservations();
  await page.goto(`${BASE}/#/projects`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#projectForm', { timeout: 15000 });
  await page.type('#projectName', 'before reload');
  await clickOrExplain(page, '#projectForm button.primary');
  await page.waitForFunction(
    () => document.querySelectorAll('#projectList .entity-card').length >= 1,
    { timeout: 15000 },
  );
  check('a write succeeds immediately after sign-in', true);

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#projectForm', { timeout: 15000 });
  await page.type('#projectName', 'after reload');
  await clickOrExplain(page, '#projectForm button.primary');
  await page.waitForFunction(
    () => document.querySelectorAll('#projectList .entity-card').length >= 2,
    { timeout: 15000 },
  );
  const csrfRejections = failedRequests.filter((entry) => entry.startsWith('403'));
  check('a write still succeeds after a page reload (F4W-001)', csrfRejections.length === 0,
    csrfRejections.join('; '));

  at('routes');
  // --- every route renders real content -----------------------------------
  // The bar is deliberately not "the page appeared". It is that nothing is still
  // saying "Loading…" and nothing reported an error, because a nav entry whose panel
  // never resolves is the exact defect being removed.
  const ROUTES = [
    'home', 'chat', 'projects', 'tasks', 'documents', 'agents', 'tools', 'knowledge',
    'memory', 'providers', 'models', 'coden', 'hardware', 'settings', 'security',
    'users', 'health', 'updates', 'logs', 'backups', 'about',
  ];
  for (const route of ROUTES) {
    resetObservations();
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(`#view-${route}.active`, { timeout: 15000 });
    // Give the loader a chance to replace its placeholders.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const state = await page.evaluate((name) => {
      const view = document.querySelector(`#view-${name}`);
      const text = view ? view.textContent : '';
      // Measured, not inferred. An earlier version of this check tested
      // `classList.contains('active')` and the length of `innerText`, and passed on
      // pages that were never on screen: an unclosed <section> had nested nine views
      // inside #view-tasks, so an ancestor was display:none while the view itself
      // carried .active — and innerText falls back to textContent for an element that
      // is not rendered, so the text was there to measure. A real box is the only
      // honest evidence that a user can see the page.
      const box = view ? view.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        active: Boolean(view && view.classList.contains('active')),
        rendered: Boolean(view && view.offsetParent !== null && box.width > 0 && box.height > 0),
        width: Math.round(box.width), height: Math.round(box.height),
        stillLoading: /Loading…/.test(text),
        couldNotLoad: /Could not load/.test(text),
        length: text.trim().length,
        title: document.title,
      };
    }, route);

    check(`route ${route}: panel is active and populated`,
      state.active && state.length > 40, `active=${state.active} length=${state.length}`);
    check(`route ${route}: panel is actually on screen`,
      state.rendered, `rendered=${state.rendered} box=${state.width}x${state.height}`);
    check(`route ${route}: nothing is still loading`, !state.stillLoading);
    check(`route ${route}: no loader reported a failure`, !state.couldNotLoad);
    check(`route ${route}: no console errors`, consoleErrors.length === 0, consoleErrors.join(' | '));
    check(`route ${route}: no failed requests`, failedRequests.length === 0, failedRequests.join(' | '));
    check(`route ${route}: document title reflects the page`,
      state.title !== '' && state.title.includes('NOESAR'), state.title);
  }

  at('invariants');
  // --- SEC-003: the invariant panel states what the code enforces ----------
  // This panel used to be five hardcoded <li> elements. They matched neither the seven
  // invariants the planner declares nor the enforcement that actually exists, and being
  // static they could not drift back into agreement — the interface was simply making a
  // separate claim. It is now rendered from the server's own declaration, so the check
  // is that the rendered rows came from the API and each one says where it is enforced.
  resetObservations();
  await page.goto(`${BASE}/#/coden`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#invariantList li', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const invariants = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#invariantList li')];
    return {
      count: items.length,
      stillLoading: items.some((item) => /Loading…/.test(item.textContent)),
      withStatus: items.filter((item) => item.querySelector('.invariant-status')).length,
      enforcedHere: items.filter((item) => item.querySelector('.invariant-status.on')).length,
      elsewhere: items.filter((item) => item.querySelector('.invariant-status.off')).length,
      allNameALayer: items.every((item) => (item.getAttribute('title') ?? '').length > 10),
    };
  });
  check('the invariant panel is populated from the server, not hardcoded',
    invariants.count === 7 && !invariants.stillLoading, JSON.stringify(invariants));
  check('every rendered invariant carries an enforcement status',
    invariants.withStatus === invariants.count, JSON.stringify(invariants));
  check('the panel distinguishes what this layer enforces from what it does not',
    invariants.enforcedHere === 4 && invariants.elsewhere === 3, JSON.stringify(invariants));
  check('every rendered invariant names where it is enforced',
    invariants.allNameALayer, JSON.stringify(invariants));

  at('deep-link');
  // --- deep link and reload on a gated page --------------------------------
  // The router runs before the role is known. A cold load of an owner-only route used
  // to resolve to access-denied even for the Owner, because `may()` was evaluated
  // while currentUser was still null.
  resetObservations();
  await page.goto(`${BASE}/#/logs`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const deepLink = await page.evaluate(() => ({
    logs: document.querySelector('#view-logs')?.classList.contains('active') ?? false,
    denied: document.querySelector('#view-access-denied')?.classList.contains('active') ?? false,
    hash: location.hash,
  }));
  check('a cold deep link to an owner-only route resolves for the owner',
    deepLink.logs && !deepLink.denied, JSON.stringify(deepLink));

  at('mfa-replacement');
  // --- the MFA replacement flow, end to end --------------------------------
  // This is the flow the Owner needs in order to retire the enrolment secret that was
  // shown once at bootstrap. It is driven here rather than asserted.
  resetObservations();
  await page.goto(`${BASE}/#/security`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#securityOverview .metric', { timeout: 15000 });
  check('security overview renders account metrics', true);

  const stepUp = await freshCode(totpSecret, used);
  used.add(stepUp);
  await page.type('#mfaPassword', PASSWORD);
  await page.type('#mfaTotp', stepUp);
  await clickOrExplain(page, '#mfaReplaceForm button.primary');
  await page.waitForSelector('#mfaEnrolBox:not(.hidden)', { timeout: 20000 });

  const enrolment = await page.evaluate(() => ({
    key: document.querySelector('#mfaManualKey')?.textContent?.trim() ?? '',
    svg: document.querySelectorAll('#mfaQr svg').length,
    modules: document.querySelectorAll('#mfaQr svg rect, #mfaQr svg path').length,
  }));
  check('replacement offers a manual key', enrolment.key.length > 10);
  check('the QR code is rendered on screen (F4W-004)', enrolment.svg === 1 && enrolment.modules > 0,
    JSON.stringify(enrolment));

  // Two CONSECUTIVE codes from the new secret, which is the point of the flow: it
  // proves the new authenticator is actually in the user's hands before the old one
  // stops working.
  const newSecret = enrolment.key;
  const codeOne = totpCode(newSecret, Date.now());
  await page.type('#mfaFirstCode', codeOne);
  let codeTwo = codeOne;
  for (let attempt = 0; attempt < 40 && codeTwo === codeOne; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    codeTwo = totpCode(newSecret, Date.now());
  }
  await page.type('#mfaSecondCode', codeTwo);
  await clickOrExplain(page, '#mfaConfirmForm button.primary');
  await page.waitForFunction(
    () => document.querySelector('#mfaEnrolBox')?.classList.contains('hidden') === true,
    { timeout: 30000 },
  );
  const afterReplace = await page.evaluate(() => ({
    codes: document.querySelectorAll('#recoveryCodesBox .recovery-codes code').length,
    badge: document.querySelector('#mfaReplaceState')?.textContent ?? '',
  }));
  check('authenticator replacement completes and issues recovery codes',
    afterReplace.codes > 0, JSON.stringify(afterReplace));

  // The old secret must now be refused. Proving the swap happened matters more than
  // the happy path: a replacement that leaves the old authenticator working is not a
  // rotation at all.
  // Deliberately issued from Node, NOT from inside the page.
  //
  // The first version ran these two requests through page.evaluate with
  // credentials:'same-origin'. Beginning a fresh login replaced the browser's session
  // cookie, so this check passed and then silently signed the harness out — every
  // subsequent step timed out waiting for a page that had gone back to the login gate.
  // A probe that breaks the checks after it is a defect in the harness, not in the
  // product; Node's fetch carries no browser cookies, so the isolation is structural
  // rather than a matter of running this last.
  const oldCode = await freshCode(totpSecret, used);
  const begun = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  }).then((response) => response.json());
  const attempt = await fetch(`${BASE}/api/v1/auth/login/mfa`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: begun.challenge, totpCode: oldCode }),
  });
  check('the superseded authenticator no longer authenticates', attempt.status >= 400,
    `status ${attempt.status}`);

  // The browser session must be untouched by the check above.
  const stillSignedIn = await page.evaluate(() =>
    document.querySelector('#authGate')?.classList.contains('hidden') === true);
  check('the rejection check did not disturb the browser session', stillSignedIn);

  at('settings');
  // --- settings actually persists ------------------------------------------
  resetObservations();
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#settingsTimezone option', { timeout: 15000 });
  await page.select('#settingsTimezone', 'Asia/Tokyo');
  await clickOrExplain(page, '#settingsTimezoneSave');
  await page.waitForFunction(
    () => /Asia\/Tokyo/.test(document.querySelector('#settingsTimezoneSummary')?.textContent ?? ''),
    { timeout: 15000 },
  );
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const persisted = await page.$eval('#settingsTimezoneSummary', (node) => node.textContent);
  check('a settings change survives a reload', /Asia\/Tokyo/.test(persisted));

  at('invitation');
  // --- an invitation can be issued -----------------------------------------
  resetObservations();
  await page.goto(`${BASE}/#/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#usersList .entity-card', { timeout: 15000 });
  await page.type('#inviteUsername', 'e2einvitee');
  await page.type('#inviteDisplayName', 'E2E Invitee');
  await clickOrExplain(page, '#invitationForm button.primary');
  await page.waitForSelector('#invitationTokenBox .token-reveal code', { timeout: 15000 });
  // The token box is rendered before the directory refresh that follows it finishes, so
  // sampling the list here read it mid-flight and saw zero. Waiting for the list is not
  // a workaround: if the invitation genuinely never appears, this still fails.
  await page.waitForFunction(
    () => document.querySelectorAll('#invitationList .entity-card').length >= 1,
    { timeout: 15000 },
  );
  const invitation = await page.evaluate(() => ({
    token: document.querySelector('#invitationTokenBox .token-reveal code')?.textContent?.trim() ?? '',
    listed: document.querySelectorAll('#invitationList .entity-card').length,
  }));
  check('an invitation is created and its token shown once',
    invitation.token.length > 10 && invitation.listed >= 1, `listed=${invitation.listed}`);

  at('sign-out');
  // --- sign out ------------------------------------------------------------
  await page.click('#logoutButton');
  await page.waitForSelector('#authGate:not(.hidden)', { timeout: 15000 });
  check('sign out returns to the authentication gate', true);

  at('restricted-role');
  // --- the DENIED path, exercised rather than assumed ----------------------
  //
  // This project has twice shipped a defect because only one side of a branch was ever
  // executed — most recently an account that could not log in at all, because every
  // fixture bootstrapped an owner and the *success* path of the other case was never
  // run. Role gating has the same shape: as the Owner, `may()` returns true for
  // everything, so an error in it is invisible. So a second account is created here
  // with a role that holds neither user.manage nor data.manage, and signed in for real.
  const invited = 'e2erestricted';
  const invitedPassword = 'second throwaway passphrase for the denied path';
  const unauthenticatedRead = await fetch(`${BASE}/api/v1/admin/invitations`, { method: 'GET' });
  check('the admin directory refuses an unauthenticated read', unauthenticatedRead.status === 401,
    `status ${unauthenticatedRead.status}`);

  // Issued through the interface, as an administrator would.
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginForm:not(.hidden)', { timeout: 15000 });
  await page.type('#loginUsername', USERNAME);
  await page.type('#loginPassword', PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector('#loginMfaForm:not(.hidden)', { timeout: 15000 });
  // A fresh step, not just a fresh call. The two codes consumed by the confirmation are
  // single-use (the F4-002 replay fix), so reusing one inside the same 30-second window
  // is correctly refused — the harness has to wait, not the product has to relent.
  const reLogin = await freshCode(newSecret, new Set([codeOne, codeTwo]));
  await page.type('#loginTotpCode', reLogin);
  await page.click('#loginMfaForm button[type="submit"]');
  await page.waitForSelector('#authGate.hidden', { timeout: 25000 });
  check('the replacement authenticator signs the owner back in', true);

  await page.goto(`${BASE}/#/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#inviteRole option', { timeout: 15000 });
  await page.type('#inviteUsername', invited);
  await page.type('#inviteDisplayName', 'E2E Restricted');
  await page.select('#inviteRole', 'user');
  await clickOrExplain(page, '#invitationForm button.primary');
  await page.waitForFunction(
    () => (document.querySelector('#invitationTokenBox .token-reveal code')?.textContent ?? '').length > 10,
    { timeout: 15000 },
  );
  const invitedToken = await page.$eval('#invitationTokenBox .token-reveal code',
    (node) => node.textContent.trim());

  // Acceptance is a first-run flow with no session, so it is completed over HTTP.
  const accepted = await fetch(`${BASE}/api/v1/auth/invitation/accept`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: invitedToken, password: invitedPassword }),
  }).then((response) => response.json());
  check('an invited account enrols MFA before it exists', accepted.mfaRequired === true);
  const enrolCode = totpCode(accepted.totpSecret, Date.now());
  const confirmed = await fetch(`${BASE}/api/v1/auth/invitation/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: accepted.challenge, totpCode: enrolCode }),
  });
  check('the invited account is created', confirmed.status === 201, `status ${confirmed.status}`);

  // Sign in as that account in the browser and look at what it is offered.
  await page.evaluate(() => { document.querySelector('#logoutButton')?.click(); });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#loginForm:not(.hidden)', { timeout: 20000 });
  await page.type('#loginUsername', invited);
  await page.type('#loginPassword', invitedPassword);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector('#loginMfaForm:not(.hidden)', { timeout: 15000 });
  let invitedCode = totpCode(accepted.totpSecret, Date.now());
  for (let attempt = 0; attempt < 40 && invitedCode === enrolCode; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    invitedCode = totpCode(accepted.totpSecret, Date.now());
  }
  await page.type('#loginTotpCode', invitedCode);
  await page.click('#loginMfaForm button[type="submit"]');
  await page.waitForSelector('#authGate.hidden', { timeout: 25000 });
  check('the invited account can sign in', true);

  const offered = await page.evaluate(() => {
    const entry = (view) => document.querySelector(`.nav[data-view="${view}"]`);
    const hidden = (view) => { const node = entry(view); return node ? node.hidden : null; };
    return {
      users: hidden('users'), backups: hidden('backups'), health: hidden('health'),
      updates: hidden('updates'), logs: hidden('logs'),
      settings: hidden('settings'), security: hidden('security'), about: hidden('about'),
    };
  });
  check('nav hides every section this role cannot open',
    offered.users === true && offered.backups === true && offered.health === true
    && offered.updates === true && offered.logs === true, JSON.stringify(offered));
  check('nav still offers the sections this role can open',
    offered.settings === false && offered.security === false && offered.about === false,
    JSON.stringify(offered));

  resetObservations();
  await page.goto(`${BASE}/#/logs`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const denied = await page.evaluate(() => ({
    deniedShown: document.querySelector('#view-access-denied')?.classList.contains('active') ?? false,
    logsShown: document.querySelector('#view-logs')?.classList.contains('active') ?? false,
    rendered: (document.querySelector('#view-access-denied')?.getBoundingClientRect().height ?? 0) > 0,
    detail: document.querySelector('#accessDeniedDetail')?.textContent ?? '',
    hash: location.hash,
  }));
  check('a forbidden route shows access-denied instead of an empty panel',
    denied.deniedShown && !denied.logsShown, JSON.stringify(denied));
  check('the access-denied page is actually on screen', denied.rendered);
  check('access-denied explains what is required', /owner/.test(denied.detail), denied.detail);
  // The address must keep naming what was asked for: rewriting it to #/access-denied
  // would make a reload turn the 403 into a 404.
  check('the address still names the requested route', denied.hash === '#/logs', denied.hash);
  check('no request was even attempted for the forbidden page', failedRequests.length === 0,
    failedRequests.join(' | '));

  // A page it IS allowed to open must still work for this role.
  await page.goto(`${BASE}/#/security`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#securityOverview .metric', { timeout: 15000 });
  const restrictedSecurity = await page.evaluate(() => ({
    rendered: (document.querySelector('#view-security')?.getBoundingClientRect().height ?? 0) > 0,
    role: [...document.querySelectorAll('#securityOverview .metric')]
      .map((node) => node.textContent).join(' '),
  }));
  check('an allowed page still works for a restricted role',
    restrictedSecurity.rendered && /user/.test(restrictedSecurity.role));
} catch (error) {
  let context = '';
  try {
    context = JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      signedIn: document.querySelector('#authGate')?.classList.contains('hidden') === true,
      activeView: document.querySelector('.view.active')?.id ?? null,
      status: document.querySelector('#statusMessage')?.textContent ?? null,
      toasts: [...document.querySelectorAll('.toast')].map((node) => node.textContent.trim()).slice(0, 4),
      timezoneOptions: document.querySelectorAll('#settingsTimezone option').length,
      timezoneSummary: (document.querySelector('#settingsTimezoneSummary')?.textContent ?? '').slice(0, 160),
    })));
  } catch { context = '(page state unavailable)'; }
  check(`harness completed without throwing [step: ${step}]`, false, `${error.message} :: ${context}`);
} finally {
  await browser.close();
}

console.log('');
console.log(`BROWSER_E2E_TOTAL=${results.length}`);
console.log(`BROWSER_E2E_PASS=${results.length - failures}`);
console.log(`BROWSER_E2E_FAIL=${failures}`);
process.exit(failures === 0 ? 0 : 1);

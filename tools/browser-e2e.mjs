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
    'home', 'chat', 'projects', 'tasks', 'documents', 'agents', 'workflows', 'approvals',
    'tools', 'knowledge', 'memory', 'providers', 'models', 'coden', 'hardware', 'settings',
    'security', 'users', 'health', 'updates', 'logs', 'backups', 'about',
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

  at('workflows');
  // --- WP-2: a workflow, its approval gate, the strip, and the decision ----
  // Driven the way an operator drives it: define a workflow in the form, start it, watch
  // the run suspend at its gate, see the bottom approval strip say so, decide it on the
  // Approvals page and watch the run finish. Nothing here reads the API to decide whether
  // the interface worked — the assertions are on what is on screen, because a check on
  // `classList` has already passed on a page no user could see (F4W-010).
  resetObservations();
  await page.goto(`${BASE}/#/workflows`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#workflowForm', { timeout: 15000 });

  // The step vocabulary must come from the server, and must say which types this build
  // cannot execute. A hardcoded copy in the page is the defect the invariant panel had.
  await page.waitForFunction(
    () => !/Loading the step vocabulary/.test(document.querySelector('#workflowStepTypes')?.textContent ?? ''),
    { timeout: 15000 });
  const vocabulary = await page.evaluate(() => document.querySelector('#workflowStepTypes')?.textContent ?? '');
  check('the workflow step vocabulary is rendered from the server',
    /transform/.test(vocabulary) && /human_approval/.test(vocabulary), vocabulary.slice(0, 200));
  check('the interface states which step types this build cannot execute',
    /not executable in this build/.test(vocabulary), vocabulary.slice(0, 200));

  await page.type('#workflowName', 'Browser acceptance workflow');
  await page.type('#workflowSteps', JSON.stringify([
    { key: 'gate', type: 'human_approval', title: 'Confirm before proceeding' },
    { key: 'finish', type: 'transform', operation: 'constant', config: { value: 'done' } },
  ]));
  await clickOrExplain(page, '#workflowForm button.primary');
  await page.waitForSelector('[data-workflow-run]', { timeout: 15000 });
  const defined = await page.evaluate(() => ({
    cards: document.querySelectorAll('#workflowList article').length,
    count: document.querySelector('#workflowCount')?.textContent ?? '',
    rendered: (document.querySelector('#view-workflows')?.getBoundingClientRect().height ?? 0) > 0,
  }));
  check('a workflow defined in the browser appears in the list',
    defined.cards >= 1 && defined.count === '1' && defined.rendered, JSON.stringify(defined));

  await clickOrExplain(page, '[data-workflow-run]');
  // The run must suspend at its gate, and the run card must say so on screen.
  await page.waitForFunction(
    () => /awaiting_approval/.test(document.querySelector('#workflowRunList')?.textContent ?? ''),
    { timeout: 15000 });
  const suspended = await page.evaluate(() => ({
    runText: (document.querySelector('#workflowRunList')?.textContent ?? '').slice(0, 240),
    hasCancel: Boolean(document.querySelector('[data-workflow-cancel]')),
  }));
  check('a started run suspends at its approval gate and says so',
    /awaiting_approval/.test(suspended.runText), suspended.runText);
  check('a suspended run offers cancellation', suspended.hasCancel);

  // The bottom approval strip. 01_PRODUCT/11 names it as binding; this is the check that
  // it is a real, visible box carrying a real count, not markup that exists in the DOM.
  const strip = await page.evaluate(() => {
    const node = document.querySelector('#approvalStrip');
    const box = node ? node.getBoundingClientRect() : { width: 0, height: 0 };
    const state = document.querySelector('#approvalStripState');
    return {
      onScreen: Boolean(node && node.offsetParent !== null && box.width > 0 && box.height > 0),
      width: Math.round(box.width), height: Math.round(box.height),
      state: state?.textContent ?? '',
      warned: Boolean(state?.classList.contains('status-warn')),
      detail: document.querySelector('#approvalStripDetail')?.textContent ?? '',
      navCount: document.querySelector('#navApprovalCount')?.textContent ?? '',
      navCountVisible: (document.querySelector('#navApprovalCount')?.getBoundingClientRect().height ?? 0) > 0,
    };
  });
  check('the bottom approval strip is a real box on screen',
    strip.onScreen, `box=${strip.width}x${strip.height}`);
  check('the strip reports the pending count', /Approvals: 1/.test(strip.state), strip.state);
  check('the strip changes tone when something is waiting', strip.warned, strip.state);
  check('the strip names what is waiting', strip.detail.length > 3, strip.detail);
  check('the nav badge shows the pending count and is visible',
    strip.navCount === '1' && strip.navCountVisible, JSON.stringify(strip));

  // --- the local-first privacy indicator, 01_PRODUCT/12 --------------------
  //
  // Driven through the real provider controls rather than the API, because the defect
  // being guarded against lived in the browser: the footer used to print "● Local-only
  // verified" straight from the provider dropdown, whatever the server thought.
  at('privacy indicator');
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#privacyBanner', { timeout: 15000 });
  const privacyLocal = await page.evaluate(() => ({
    verified: document.querySelector('#privacyBanner .verified')?.textContent?.trim() ?? '',
    external: document.querySelector('#privacyBanner')?.classList.contains('external') ?? null,
    footer: document.querySelector('#footerPrivacy')?.textContent?.trim() ?? '',
    disclosuresHidden: document.querySelector('#privacyDisclosures')?.classList.contains('hidden') ?? null,
  }));
  // The seeded catalogue registers three external providers in every workspace. A first
  // implementation of derivePrivacy counted those as pending, so a fresh installation
  // could never once report local-only. That regression is checked here in a real browser.
  check('a fresh installation reports LOCAL ONLY VERIFIED despite the seeded external catalogue',
    privacyLocal.verified === 'LOCAL ONLY VERIFIED' && privacyLocal.external === false,
    JSON.stringify(privacyLocal));
  check('the footer chip agrees with the banner instead of being written by the dropdown',
    /local only verified/i.test(privacyLocal.footer), privacyLocal.footer);
  check('nothing is disclosed while the state is local-only',
    privacyLocal.disclosuresHidden === true, JSON.stringify(privacyLocal));

  // Consent to, and enable, an external provider through the real controls.
  await page.goto(`${BASE}/#/providers`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-provider-consent]', { timeout: 15000 });
  const externalProviderId = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#providerList .provider-card')]
      .find((node) => /External/.test(node.querySelector('small')?.textContent ?? ''));
    return card?.querySelector('[data-provider-consent]')?.dataset.providerConsent ?? null;
  });
  check('the provider list offers an external provider to consent to', Boolean(externalProviderId));
  // Granting consent and then enabling is two clicks with an asynchronous round trip and a
  // full re-render of #providerList between them, and getting the barrier wrong produced
  // two different failures before this settled:
  //   - waiting on `checkbox.checked` — true the instant it is clicked, while the PUT was
  //     still in flight — clicked Enable against a stale client copy, and the UI correctly
  //     refused with "Grant explicit external consent first";
  //   - waiting only on the server's answer raced the client's own re-render, so the node
  //     selected for the second click was detached before it landed.
  // Marking the node BEFORE acting makes the barrier deterministic: the mark can only
  // disappear when renderAll() has replaced that node with one built from fresh state.
  await page.evaluate((id) => {
    document.querySelector(`[data-provider-consent="${id}"]`).dataset.e2eStale = '1';
  }, externalProviderId);
  await clickOrExplain(page, `[data-provider-consent="${externalProviderId}"]`);
  await page.waitForFunction(
    (id) => document.querySelector(`[data-provider-consent="${id}"]`)?.dataset.e2eStale === undefined,
    { timeout: 15000 }, externalProviderId);
  await clickOrExplain(page, `[data-toggle-provider="${externalProviderId}"]`);
  await page.waitForFunction(
    (id) => /Enabled/.test([...document.querySelectorAll('#providerList .provider-card')]
      .find((node) => node.querySelector(`[data-provider-consent="${id}"]`))
      ?.querySelector('small')?.textContent ?? ''),
    { timeout: 15000 }, externalProviderId);

  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.querySelector('#privacyBanner .verified')?.textContent?.trim() === 'REMOTE MODEL ACTIVE',
    { timeout: 15000 });
  const privacyExternal = await page.evaluate(() => {
    const panel = document.querySelector('#privacyDisclosures');
    const box = panel ? panel.getBoundingClientRect() : { width: 0, height: 0 };
    const card = document.querySelector('#privacyDisclosureList .privacy-disclosure');
    return {
      onScreen: Boolean(panel && panel.offsetParent !== null && box.width > 0 && box.height > 0),
      external: document.querySelector('#privacyBanner')?.classList.contains('external') ?? null,
      footer: document.querySelector('#footerPrivacy')?.textContent?.trim() ?? '',
      runtime: document.querySelector('#runtimeState')?.textContent?.trim() ?? '',
      labels: [...(card?.querySelectorAll('p strong') ?? [])].map((node) => node.textContent.replace(':', '').trim()),
      text: card?.textContent ?? '',
      telemetry: document.querySelector('#privacyTelemetry')?.textContent ?? '',
      revokeEnabled: document.querySelector('#privacyRevoke')?.disabled === false,
    };
  });
  check('enabling a consented external provider moves the indicator to REMOTE MODEL ACTIVE',
    privacyExternal.external === true, JSON.stringify({ footer: privacyExternal.footer }));
  check('the disclosure panel is a real box on screen, not markup in the DOM',
    privacyExternal.onScreen, JSON.stringify(privacyExternal.labels));
  // The eight elements 01_PRODUCT/12 names, asserted as rendered text rather than as an
  // API field — the specification says the external state SHOWS them.
  for (const label of ['Destination', 'Service identity', 'Data categories', 'Purpose',
    'Duration', 'Retention', 'Consent scope', 'Revoke']) {
    check(`the disclosure shows "${label}"`, privacyExternal.labels.includes(label),
      privacyExternal.labels.join(', '));
  }
  check('the disclosure names the real destination host',
    /api\.openai\.com|api\.anthropic\.com|api\.moonshot\.cn/.test(privacyExternal.text));
  check('retention at the destination is shown as unknowable rather than invented',
    /UNKNOWN_AT_DESTINATION/.test(privacyExternal.text));
  check('the footer and runtime chips follow the server, not the dropdown',
    /remote model active/i.test(privacyExternal.footer) && /External by consent/.test(privacyExternal.runtime),
    `${privacyExternal.footer} | ${privacyExternal.runtime}`);
  check('the telemetry posture is stated rather than assumed',
    /Telemetry: off/i.test(privacyExternal.telemetry), privacyExternal.telemetry);
  check('the owner is offered the revoke control', privacyExternal.revokeEnabled);

  // The revoke control must actually revoke. A button describing an effect it does not
  // have is the defect this whole indicator exists to remove.
  await clickOrExplain(page, '#privacyRevoke');
  await page.waitForFunction(
    () => document.querySelector('#privacyBanner .verified')?.textContent?.trim() === 'LOCAL ONLY VERIFIED',
    { timeout: 20000 });
  const privacyRevoked = await page.evaluate(() => ({
    verified: document.querySelector('#privacyBanner .verified')?.textContent?.trim() ?? '',
    hidden: document.querySelector('#privacyDisclosures')?.classList.contains('hidden') ?? null,
  }));
  check('the revoke control returns the installation to local-only',
    privacyRevoked.verified === 'LOCAL ONLY VERIFIED' && privacyRevoked.hidden === true,
    JSON.stringify(privacyRevoked));

  // The queue must show the workflow gate, and the decision must resume the run.
  resetObservations();
  await page.goto(`${BASE}/#/approvals`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-approve]', { timeout: 15000 });
  const queued = await page.evaluate(() => {
    const card = document.querySelector('#approvalList article');
    return {
      cards: document.querySelectorAll('#approvalList article').length,
      text: card ? card.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) : '',
      badge: document.querySelector('#approvalCount')?.textContent ?? '',
      rendered: (document.querySelector('#view-approvals')?.getBoundingClientRect().height ?? 0) > 0,
    };
  });
  check('the approval queue shows the waiting workflow step',
    queued.cards === 1 && /workflow-step/.test(queued.text) && queued.rendered, JSON.stringify(queued));
  check('the queued item states the permission that decides it',
    /agent\.manage/.test(queued.text), queued.text);
  check('the queue badge agrees with the list', queued.badge === '1', queued.badge);

  await clickOrExplain(page, '[data-approve]');
  await page.waitForFunction(
    () => /Nothing is waiting/.test(document.querySelector('#approvalList')?.textContent ?? ''),
    { timeout: 15000 });
  const afterDecision = await page.evaluate(() => ({
    list: (document.querySelector('#approvalList')?.textContent ?? '').trim().slice(0, 120),
    state: document.querySelector('#approvalStripState')?.textContent ?? '',
    good: Boolean(document.querySelector('#approvalStripState')?.classList.contains('status-good')),
    navHidden: document.querySelector('#navApprovalCount')?.classList.contains('hidden') === true,
  }));
  check('approving empties the queue', /Nothing is waiting/.test(afterDecision.list), afterDecision.list);
  check('the strip returns to zero and says so',
    /Approvals: 0/.test(afterDecision.state) && afterDecision.good, JSON.stringify(afterDecision));
  check('the nav badge is hidden when nothing is waiting', afterDecision.navHidden);

  // And the run itself must have resumed to completion — the approval is only meaningful
  // if the work it was gating actually proceeded.
  await page.goto(`${BASE}/#/workflows`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => /completed/.test(document.querySelector('#workflowRunList')?.textContent ?? ''),
    { timeout: 15000 });
  const finished = await page.evaluate(() => ({
    runText: (document.querySelector('#workflowRunList')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
    hasReplay: Boolean(document.querySelector('[data-workflow-replay]')),
  }));
  check('the approved run resumes and completes', /completed/.test(finished.runText), finished.runText);
  check('every step of the completed run is recorded',
    /gate — completed/.test(finished.runText) && /finish — completed/.test(finished.runText), finished.runText);
  check('a finished run offers replay', finished.hasReplay);
  check('the workflow pages produced no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('the workflow pages produced no failed requests', failedRequests.length === 0, failedRequests.join(' | '));

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

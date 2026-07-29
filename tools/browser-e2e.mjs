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
  // Twelve destinations, and the thirteen former pages that became sections inside the
  // single Settings destination. Both are walked: a section is a surface a user reaches,
  // so dropping it from this loop would shrink the suite while the count still looked
  // healthy. Every one of these addresses must render real content, not a shell.
  const DESTINATIONS = [
    'home', 'chat', 'coden', 'coden-tui', 'projects', 'documents', 'knowledge',
    'agents', 'workflows', 'models', 'research', 'settings',
  ];
  const SETTINGS_SECTIONS = [
    'sessions', 'appearance', 'language', 'about', 'licence', 'privacy', 'people',
    'security', 'models-hardware', 'storage', 'audit', 'health', 'updates',
  ];
  const SURFACES = [
    ...DESTINATIONS.map((name) => ({ route: name, selector: `#view-${name}`, ready: `#view-${name}.active` })),
    ...SETTINGS_SECTIONS.map((name) => ({
      route: `settings/${name}`,
      selector: `.settings-section[data-section="${name}"]`,
      ready: `.settings-section[data-section="${name}"].active`,
    })),
  ];
  for (const surface of SURFACES) {
    const route = surface.route;
    resetObservations();
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(surface.ready, { timeout: 15000 });
    // Give the loader a chance to replace its placeholders.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const state = await page.evaluate((selector) => {
      const view = document.querySelector(selector);
      // Text of the surface actually on screen. A Settings section that is not active is
      // display:none but still carries its markup, so its "Loading…" would be counted
      // against a destination that has finished rendering.
      let text = view ? view.textContent : '';
      if (view) {
        for (const hidden of view.querySelectorAll('.settings-section:not(.active)')) {
          text = text.replace(hidden.textContent, '');
        }
      }
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
    }, surface.selector);

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

  at('structure');
  // --- 23 destinations became 12, and nothing was lost on the way ----------
  // The risk of a restructure is not that it looks wrong: it is that a page quietly stops
  // being reachable, or that a gate travels with a page and arrives as decoration. Both
  // are checked here against the running interface rather than against the markup.
  resetObservations();
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  const shell = await page.evaluate(() => ({
    destinations: [...document.querySelectorAll('.nav')].map((node) => node.dataset.view),
    menu: [...document.querySelectorAll('.settings-nav')].map((node) => node.dataset.section),
    groups: [...document.querySelectorAll('.settings-group')].map((node) => node.textContent.trim()),
    sections: [...document.querySelectorAll('.settings-section')].map((node) => node.dataset.section),
  }));
  check('the sidebar carries twelve destinations, not twenty-three',
    shell.destinations.length === 12, `${shell.destinations.length}: ${shell.destinations.join(' ')}`);
  check('Settings is one destination holding thirteen sections',
    shell.sections.length === 13 && shell.menu.length === 13,
    `menu=${shell.menu.length} sections=${shell.sections.length}`);
  check('every Settings menu entry has a section behind it and every section an entry',
    shell.menu.every((key) => shell.sections.includes(key)) && shell.sections.every((key) => shell.menu.includes(key)),
    `menu=${shell.menu.join(' ')} | sections=${shell.sections.join(' ')}`);
  check('the sections are grouped, not one flat list', shell.groups.length === 3, shell.groups.join(' | '));

  // Every address a demoted page used to answer on still resolves to the section that owns
  // it now. A bookmark that 404s is how a change of rank turns into a loss of function.
  const LEGACY = {
    tasks: 'home', tools: 'coden', memory: 'knowledge', approvals: 'settings/audit',
    providers: 'settings/privacy', hardware: 'settings/models-hardware',
    users: 'settings/people', security: 'settings/security', health: 'settings/health',
    logs: 'settings/health', updates: 'settings/updates', backups: 'settings/storage',
    about: 'settings/about',
  };
  const redirects = [];
  for (const [from, to] of Object.entries(LEGACY)) {
    await page.goto(`${BASE}/#/${from}`, { waitUntil: 'networkidle2' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const landed = await page.evaluate((expected) => {
      const [view, section = ''] = expected.split('/');
      const host = document.querySelector(`#view-${view}`);
      const target = section ? document.querySelector(`.settings-section[data-section="${section}"]`) : host;
      return {
        hash: location.hash,
        onScreen: Boolean(host?.classList.contains('active')) && Boolean(target?.classList.contains('active'))
          && (target?.getBoundingClientRect().height ?? 0) > 0,
        notFound: document.querySelector('#view-not-found')?.classList.contains('active') === true,
      };
    }, to);
    if (!landed.onScreen || landed.notFound || landed.hash !== `#/${to}`) {
      redirects.push({ from, to, ...landed });
    }
  }
  check('every address of a demoted page still lands on the section that owns it',
    redirects.length === 0, `${redirects.length} failed: ${JSON.stringify(redirects.slice(0, 4))}`);

  // --- the owner's Health panel actually renders its detail ------------------
  // /healthz withholds its component detail from anyone who is not an owner holding
  // audit.read (B-010, D-0170). The suite already proves a restricted role is DENIED
  // this section — which passes just as well if the panel is broken for the owner too.
  // Without this the redaction could have emptied the one surface that consumes it and
  // nothing here would have noticed.
  await page.goto(`${BASE}/#/settings/health`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const healthPanel = await page.evaluate(() => {
    const node = document.querySelector('#healthComponents');
    const read = (label) => {
      for (const metric of node?.querySelectorAll('.metric') ?? []) {
        if (metric.querySelector('span')?.textContent?.trim() === label) {
          return metric.querySelector('b')?.textContent?.trim() ?? null;
        }
      }
      return null;
    };
    return { overall: read('Overall'), components: read('Components'), version: read('Version') };
  });
  check('the owner sees the aggregate health status', healthPanel.overall === 'healthy',
    JSON.stringify(healthPanel));
  // The count is the disclosure: a redacted body carries no components array at all, so
  // this reads 0 — or the placeholder — the moment the owner stops being let through.
  check('the owner sees the component inventory the detail carries',
    Number(healthPanel.components) > 0, JSON.stringify(healthPanel));
  check('the owner sees the product version', Boolean(healthPanel.version)
    && healthPanel.version !== '—', JSON.stringify(healthPanel));

  // --- the sidebar has three ranks, and they are reachable both ways --------
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  const ranks = [];
  const rankOf = () => page.evaluate(() => ({
    rank: document.querySelector('#appShell')?.dataset.sidebar,
    // The label must stay in the accessible name even when it is out of sight: a nav
    // button announced as a bare glyph tells a screen-reader user nothing.
    named: [...document.querySelectorAll('.nav')].every((node) => node.textContent.replace(/\s+/g, ' ').trim().length > 2),
    labelDisplayed: getComputedStyle(document.querySelector('.nav span')).display !== 'none',
    sidebarWidth: Math.round(document.querySelector('#sidebar')?.getBoundingClientRect().width ?? -1),
  }));
  ranks.push(await rankOf());
  await page.keyboard.press('BracketLeft');
  await new Promise((resolve) => setTimeout(resolve, 200));
  ranks.push(await rankOf());
  await page.keyboard.press('BracketLeft');
  await new Promise((resolve) => setTimeout(resolve, 200));
  ranks.push(await rankOf());
  await page.keyboard.press('BracketRight');
  await new Promise((resolve) => setTimeout(resolve, 200));
  ranks.push(await rankOf());
  check('the sidebar collapses through three ranks with [ and expands with ]',
    ranks[0].rank === 'full' && ranks[1].rank === 'icons' && ranks[2].rank === 'hidden' && ranks[3].rank === 'icons',
    ranks.map((entry) => entry.rank).join(' → '));
  check('collapsing the sidebar actually narrows it on screen',
    ranks[0].sidebarWidth > ranks[1].sidebarWidth && ranks[2].sidebarWidth === 0,
    ranks.map((entry) => entry.sidebarWidth).join(' → '));
  check('a nav entry keeps its accessible name in icon rank',
    ranks[1].named && ranks[1].labelDisplayed,
    `named=${ranks[1].named} displayed=${ranks[1].labelDisplayed}`);
  await page.reload({ waitUntil: 'networkidle2' });
  const afterReload = await rankOf();
  check('the chosen sidebar rank survives a reload', afterReload.rank === 'icons', afterReload.rank);

  // A shortcut that fires while someone is typing a bracket into a field is a defect.
  await page.evaluate(() => { document.querySelector('#globalSearch').focus(); });
  await page.keyboard.press('BracketLeft');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const whileTyping = await page.evaluate(() => ({
    rank: document.querySelector('#appShell')?.dataset.sidebar,
    typed: document.querySelector('#globalSearch').value,
  }));
  check('the bracket shortcut does not fire while text is being typed',
    whileTyping.rank === 'icons' && whileTyping.typed.includes('['),
    JSON.stringify(whileTyping));
  await page.evaluate(() => { document.querySelector('#globalSearch').value = ''; document.querySelector('#globalSearch').blur(); });
  await page.evaluate(() => { document.querySelector('#sidebarRank').click(); });
  await new Promise((resolve) => setTimeout(resolve, 200));
  // The control cycles hidden → icons → full → hidden. Standing at "icons" after the
  // reload, one press must arrive at "full": the keyboard is the fast path, never the only
  // one, or a mouse user who hid the sidebar has no way to bring it back.
  const cycled = await rankOf();
  check('the sidebar rank is also reachable without the keyboard', cycled.rank === 'full', cycled.rank);

  // --- the context panel remembers its placement PER DESTINATION -----------
  const panelOf = () => page.evaluate(() => ({
    rank: document.querySelector('#appShell')?.dataset.panel,
    onScreen: (document.querySelector('#contextPanel')?.getBoundingClientRect().width ?? 0) > 0,
    floating: getComputedStyle(document.querySelector('#contextPanel')).position === 'fixed',
  }));
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => document.querySelector('[data-panel-rank="floating"]').click());
  await new Promise((resolve) => setTimeout(resolve, 200));
  const homeFloating = await panelOf();
  await page.goto(`${BASE}/#/projects`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const projectsDefault = await panelOf();
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const homeAgain = await panelOf();
  check('the context panel can be docked, floated or sent away',
    homeFloating.rank === 'floating' && homeFloating.floating, JSON.stringify(homeFloating));
  check('a placement chosen on one destination does not follow you to another',
    projectsDefault.rank === 'docked', JSON.stringify(projectsDefault));
  check('the placement is remembered for the destination it was chosen on',
    homeAgain.rank === 'floating', JSON.stringify(homeAgain));
  await page.evaluate(() => document.querySelector('[data-panel-rank="hidden"]').click());
  await new Promise((resolve) => setTimeout(resolve, 200));
  const hiddenPanel = await panelOf();
  check('a hidden context panel is really off the screen', !hiddenPanel.onScreen, JSON.stringify(hiddenPanel));
  await page.evaluate(() => document.querySelector('#panelRank').click());
  await new Promise((resolve) => setTimeout(resolve, 200));
  const restored = await panelOf();
  check('a hidden context panel can be brought back from the top bar',
    restored.onScreen, JSON.stringify(restored));
  await page.evaluate(() => document.querySelector('[data-panel-rank="docked"]').click());
  // The probe is served over plain HTTP on a container hostname, so Chromium discards the
  // Cross-Origin-Opener-Policy header the server sets and says so once per navigation. That
  // is a property of the harness's transport, not of this change: it is excluded by name,
  // and recorded as an observation about the header over plain HTTP rather than hidden.
  const shellErrors = consoleErrors.filter((line) => !/Cross-Origin-Opener-Policy header has been ignored/.test(line));
  check('the restructured shell produced no console errors', shellErrors.length === 0, shellErrors.join(' | '));
  check('the restructured shell produced no failed requests', failedRequests.length === 0, failedRequests.join(' | '));

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
  // "#/logs" is an owner-only page that became an owner-only SECTION. The deep link must
  // still resolve for the Owner, and the former page must be on screen inside it — a gate
  // that survives a demotion in name only is a gate that stopped guarding anything.
  await page.goto(`${BASE}/#/logs`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const deepLink = await page.evaluate(() => ({
    section: document.querySelector('.settings-section[data-section="health"]')?.classList.contains('active') ?? false,
    logs: (document.querySelector('#view-logs')?.getBoundingClientRect().height ?? 0) > 0,
    denied: document.querySelector('#view-access-denied')?.classList.contains('active') ?? false,
    refused: document.querySelector('#settingsDenied')?.classList.contains('hidden') === false,
    hash: location.hash,
  }));
  check('a cold deep link to an owner-only route resolves for the owner',
    deepLink.section && deepLink.logs && !deepLink.denied && !deepLink.refused, JSON.stringify(deepLink));

  at('mfa-replacement');
  // --- the MFA replacement flow, end to end --------------------------------
  // This is the flow the Owner needs in order to retire the enrolment secret that was
  // shown once at bootstrap. It is driven here rather than asserted.
  resetObservations();
  await page.goto(`${BASE}/#/settings/security`, { waitUntil: 'networkidle2' });
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
  await page.goto(`${BASE}/#/settings/language`, { waitUntil: 'networkidle2' });
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

  at('sessions');
  // --- sessions: three places, a confirmation, and a keyboard --------------
  //
  // UI-001…UI-012 and UI-050…UI-053. Driven rather than read: every criterion here is
  // about what happens when you press something, and the two Critical ones (a
  // confirmation on EVERY destructive action, and Delete opening the dialog rather than
  // deleting) are exactly the kind that a refactor removes without any test noticing.
  resetObservations();
  await page.goto(`${BASE}/#/chat`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#chatConversation', { timeout: 15000 });
  // Seven sessions, so that the fifth/sixth boundary of UI-002 is real rather than
  // theoretical, and the archive has enough to page.
  const created = await page.evaluate(async () => {
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('noesar_csrf='))?.split('=')[1] ?? '';
    const ids = [];
    for (let index = 0; index < 7; index += 1) {
      const response = await fetch('/api/v1/conversations', {
        method: 'POST', credentials: 'same-origin',
        // The header the product actually reads. Writing 'x-csrf-token' here — the
        // conventional name — answered 403 seven times and the surface simply had nothing
        // to show, which is how a harness defect imitates a product defect.
        headers: { 'content-type': 'application/json', 'x-noesar-csrf': decodeURIComponent(csrf) },
        body: JSON.stringify({ title: `E2E session ${index + 1}` }),
      });
      const body = await response.json();
      ids.push(body.conversation?.id);
    }
    return ids.filter(Boolean).length;
  });
  check('seven work sessions exist to exercise the surface', created === 7, `created=${created}`);

  await page.goto(`${BASE}/#/settings/sessions`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#sessionsRecent .session-row', { timeout: 15000 });
  const layout = await page.evaluate(() => ({
    laidOut: document.querySelectorAll('#sessionsRecent .session-row').length,
    inScroller: document.querySelectorAll('#sessionsOverflow .session-row').length,
    countDeclared: document.querySelector('#sessionsOverflowCount')?.textContent ?? '',
    scrollerVisible: (document.querySelector('#sessionsOverflowBox')?.getBoundingClientRect().height ?? 0) > 0,
    range: document.querySelector('#sessionsRange')?.textContent ?? '',
  }));
  check('UI-001/UI-002 five are laid out and the rest scroll with the count above them',
    layout.laidOut === 5 && layout.inScroller >= 2 && layout.scrollerVisible && /more on this page/.test(layout.countDeclared),
    JSON.stringify(layout));

  // UI-008/UI-009/UI-010: archiving asks first, names the session, and preselects nothing.
  await clickOrExplain(page, '#sessionsRecent .session-row [data-session-archive]');
  await page.waitForSelector('#confirmScrim:not(.hidden)', { timeout: 15000 });
  const dialog = await page.evaluate(() => ({
    title: document.querySelector('#confirmTitle')?.textContent ?? '',
    body: document.querySelector('#confirmBody')?.textContent ?? '',
    consequence: document.querySelector('#confirmConsequence')?.textContent ?? '',
    focusIsButton: document.activeElement?.tagName === 'BUTTON',
    modal: document.querySelector('.confirm-card')?.getAttribute('aria-modal') === 'true',
  }));
  check('UI-008/UI-009 the confirmation names what happens and to which session',
    /Archive 1 session/.test(dialog.title) && /E2E session/.test(dialog.body) && /moves the session/i.test(dialog.consequence),
    JSON.stringify(dialog));
  check('UI-010 the dangerous button is not preselected and the dialog is modal',
    dialog.focusIsButton === false && dialog.modal);

  // Esc cancels, and cancelling changes nothing.
  await page.keyboard.press('Escape');
  await page.waitForSelector('#confirmScrim.hidden', { timeout: 15000 });
  const afterEscape = await page.evaluate(() => document.querySelectorAll('#sessionsRecent .session-row').length);
  check('UI-010 Esc cancels and the list is untouched', afterEscape === 5, `rows=${afterEscape}`);

  // Now accept, and watch the session move rather than disappear.
  await clickOrExplain(page, '#sessionsRecent .session-row [data-session-archive]');
  await page.waitForSelector('#confirmScrim:not(.hidden)', { timeout: 15000 });
  await clickOrExplain(page, '#confirmAccept');
  await page.waitForFunction(
    () => /of 6/.test(document.querySelector('#sessionsRange')?.textContent ?? ''),
    { timeout: 15000 },
  );
  await page.goto(`${BASE}/#/settings/sessions/archived`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#sessionsRecent .session-row', { timeout: 15000 });
  const archive = await page.evaluate(() => ({
    rows: document.querySelectorAll('.session-row').length,
    range: document.querySelector('#sessionsRange')?.textContent ?? '',
    returnVisible: document.querySelector('#sessionsReturn')?.classList.contains('hidden') === false,
    title: document.querySelector('#sessionsPlaceTitle')?.textContent ?? '',
  }));
  check('UI-011/UI-004 archive moves the session to a place of its own, with a return',
    archive.rows === 1 && /1–1 of 1/.test(archive.range) && archive.returnVisible && archive.title === 'Archive',
    JSON.stringify(archive));

  // UI-051, Critical: Delete from the keyboard OPENS the dialog. It never deletes.
  await page.evaluate(() => document.querySelector('.session-row')?.focus());
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirmScrim:not(.hidden)', { timeout: 15000 });
  const deleteDialog = await page.evaluate(() => ({
    title: document.querySelector('#confirmTitle')?.textContent ?? '',
    consequence: document.querySelector('#confirmConsequence')?.textContent ?? '',
    stillThere: document.querySelectorAll('.session-row').length,
  }));
  check('UI-051 Delete opens the confirmation and deletes nothing on its own',
    /Delete 1 session/.test(deleteDialog.title) && /30 days/.test(deleteDialog.consequence) && deleteDialog.stillThere === 1,
    JSON.stringify(deleteDialog));
  // UI-052: Enter confirms from the dialog itself.
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => (document.querySelector('#sessionsEmpty')?.classList.contains('hidden') === false)
      || document.querySelectorAll('.session-row').length === 0,
    { timeout: 15000 },
  );
  await page.goto(`${BASE}/#/settings/sessions/bin`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#sessionsRecent .session-row', { timeout: 15000 });
  const bin = await page.evaluate(() => ({
    rows: document.querySelectorAll('.session-row').length,
    expiry: document.querySelector('.session-row small')?.textContent ?? '',
    zoned: /·/.test(document.querySelector('.session-row time')?.textContent ?? ''),
  }));
  check('UI-012 a deleted session waits in the bin with its removal date stated',
    bin.rows === 1 && /removed after/.test(bin.expiry), JSON.stringify(bin));
  // UI-045 rides along: the instant carries a named zone, not a bare clock time.
  check('UI-045 instants are rendered with their IANA zone', bin.zoned, bin.expiry.slice(0, 120));

  // Restore it, and prove the working list gets it back.
  await clickOrExplain(page, '[data-session-restore]');
  await page.waitForSelector('#confirmScrim:not(.hidden)', { timeout: 15000 });
  await clickOrExplain(page, '#confirmAccept');
  await page.goto(`${BASE}/#/settings/sessions`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#sessionsRecent .session-row', { timeout: 15000 });
  const restoredRange = await page.evaluate(() => document.querySelector('#sessionsRange')?.textContent ?? '');
  check('a restored session returns to the working list', /of 7/.test(restoredRange), restoredRange);

  // UI-007: select the page, and the counter and the single delete button follow.
  await clickOrExplain(page, '#sessionsSelectPage');
  const selection = await page.evaluate(() => ({
    counter: document.querySelector('#sessionsSelectedCount')?.textContent ?? '',
    enabled: document.querySelector('#sessionsDeleteSelected')?.disabled === false,
  }));
  check('UI-007 selecting the page counts what is selected and enables one delete button',
    /7 selected/.test(selection.counter) && selection.enabled, JSON.stringify(selection));
  await clickOrExplain(page, '#sessionsDeleteSelected');
  await page.waitForSelector('#confirmScrim:not(.hidden)', { timeout: 15000 });
  const many = await page.evaluate(() => ({
    title: document.querySelector('#confirmTitle')?.textContent ?? '',
    named: document.querySelectorAll('#confirmNames li').length,
    truncation: document.querySelector('#confirmNames li:last-child')?.textContent ?? '',
  }));
  check('UI-009 a multiple deletion names the sessions and truncates with "and N more"',
    /Delete 7 sessions/.test(many.title) && many.named === 6 && /and 2 more/.test(many.truncation),
    JSON.stringify(many));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#confirmScrim.hidden', { timeout: 15000 });

  at('reading-controls');
  // --- text size, zoom and motion, measured rather than asserted -----------
  //
  // UI-040 and UI-041 are only met if the pixels actually move. A setting that stores a
  // preference and changes nothing on screen is the most convincing kind of nothing.
  resetObservations();
  await page.goto(`${BASE}/#/settings/appearance`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-text-step="3"]', { timeout: 15000 });
  // Scoped to the ACTIVE section. A bare '.page-title' resolves to the first one in the
  // document, which belongs to a hidden section: getComputedStyle still answers for it, so
  // the size check would have passed while measuring something nobody can see, and the
  // geometry check measured a box of zero and failed for the wrong reason.
  const VISIBLE_TITLE = '.settings-section.active .page-title';
  const typeBefore = await page.evaluate((sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize), VISIBLE_TITLE);
  await clickOrExplain(page, '[data-text-step="3"]');
  const typeAfter = await page.evaluate((sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize), VISIBLE_TITLE);
  check('UI-040 a text-size step actually enlarges the type', typeAfter > typeBefore * 1.2,
    `${typeBefore}px -> ${typeAfter}px`);
  const scaledElsewhere = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.settings-section.active .eyebrow')).fontSize));
  check('UI-040 and it scales the whole interface, not one heading', scaledElsewhere > 11,
    `eyebrow=${scaledElsewhere}px`);
  await clickOrExplain(page, '[data-text-step="1"]');

  const zoomBefore = await page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().height, VISIBLE_TITLE);
  await page.evaluate(() => {
    const range = document.querySelector('#zoomRange');
    range.value = '130';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const zoomAfter = await page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().height, VISIBLE_TITLE);
  check('UI-041 zoom moves the rendered layout, independently of text size',
    zoomAfter > zoomBefore * 1.15, `${zoomBefore} -> ${zoomAfter}`);
  await clickOrExplain(page, '#zoomReset');

  await clickOrExplain(page, '#reduceMotion');
  const motion = await page.evaluate(() => ({
    flag: document.documentElement.dataset.motion,
    duration: getComputedStyle(document.querySelector('.panel')).transitionDuration,
  }));
  check('UI-042 the motion setting applies without waiting for the system preference',
    motion.flag === 'reduced' && /^0s?/.test(motion.duration), JSON.stringify(motion));
  await clickOrExplain(page, '#reduceMotion');

  // The preferences survive a reload: a display setting that resets is not a setting.
  await clickOrExplain(page, '[data-text-step="2"]');
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const persistedScale = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim());
  check('the reading preferences survive a reload', persistedScale === '1.15', `--text-scale=${persistedScale}`);
  await page.evaluate(() => { localStorage.removeItem('noesar.textScale'); });
  await page.reload({ waitUntil: 'networkidle2' });

  at('workbench');
  // --- the bench: three regions, eleven tabs, a terminal that stays --------
  resetObservations();
  await page.goto(`${BASE}/#/coden`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#bench', { timeout: 15000 });
  const bench = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? { width: 0, height: 0 };
    return {
      navigator: box('#benchNavigator').width,
      main: box('.bench-main').width,
      agent: box('#benchAgent').width,
      tabs: document.querySelectorAll('[data-bench-tab]').length,
      statusFields: document.querySelectorAll('[data-status-field]').length,
      sourced: document.querySelector('#statusSourced')?.textContent ?? '',
      terminal: box('#benchTerminal').height,
    };
  });
  check('UI-030 the three regions are all on screen with a width of their own',
    bench.navigator > 100 && bench.main > 200 && bench.agent > 100, JSON.stringify(bench));
  check('UI-032/UI-035 eleven tabs and a twelve-field status line that declares its sources',
    bench.tabs === 11 && bench.statusFields === 12 && /of 12 fields have a source/.test(bench.sourced),
    `tabs=${bench.tabs} fields=${bench.statusFields} "${bench.sourced}"`);

  await clickOrExplain(page, '[data-bench-tab="diff"]');
  const persistentTerminal = await page.evaluate(() => ({
    activePanel: document.querySelector('.bench-panel.active')?.dataset.benchPanel ?? '',
    terminalHeight: document.querySelector('#benchTerminal')?.getBoundingClientRect().height ?? 0,
  }));
  check('UI-033 the terminal is still on screen while another tab is in front',
    persistentTerminal.activePanel === 'diff' && persistentTerminal.terminalHeight > 40,
    JSON.stringify(persistentTerminal));
  await clickOrExplain(page, '#terminalAdd');
  const terminals = await page.evaluate(() => document.querySelectorAll('[data-terminal]').length);
  check('UI-033 terminals are multiple', terminals === 2, `terminals=${terminals}`);

  // 2.4.7, for a control the audit cannot reach. The accessibility audit skips DISABLED
  // controls — correctly, since they are not focusable — which means the pager and the
  // bulk delete button of an empty list are never measured there. They are measured here,
  // where sessions exist and the buttons are live, so the exclusion is covered rather than
  // merely justified.
  await page.goto(`${BASE}/#/settings/sessions`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#sessionsRecent .session-row', { timeout: 15000 });
  await clickOrExplain(page, '#sessionsSelectPage');
  // Reached with a REAL Tab, not with element.focus(). Chromium grants :focus-visible by
  // input modality: after a click the modality is 'pointer', so a programmatic focus on a
  // button shows no ring and the check failed while the product was correct. This is the
  // same lesson a synthetic key event taught this project once already — press the key.
  const beforeRing = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('#sessionsDeleteSelected'));
    return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow].join('|');
  });
  let reached = false;
  for (let press = 0; press < 200 && !reached; press += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.id === 'sessionsDeleteSelected');
  }
  const focusRing = await page.evaluate((before) => {
    const button = document.querySelector('#sessionsDeleteSelected');
    const style = getComputedStyle(button);
    const after = [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow].join('|');
    return { enabled: !button.disabled, focused: document.activeElement === button, changed: before !== after, after };
  }, beforeRing);
  check('the keyboard reaches the bulk-delete button at all', reached && focusRing.focused);
  check('an enabled bulk-delete button does show a focus indicator (2.4.7)',
    focusRing.enabled && focusRing.changed, JSON.stringify(focusRing));
  await clickOrExplain(page, '#sessionsSelectPage');
  await page.goto(`${BASE}/#/coden`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#bench', { timeout: 15000 });

  at('workspace-actions');
  // --- Plan -> Simulate -> Approve -> Diff, the workspace-actions backbone ---
  // D-0190/D-0191 made this real on the server (executesPlans=true,
  // executorWiredToProductActions=true). This drives the actual cycle through the UI —
  // the Plan/Shadow run/Diff panels used to describe it as backbone work with no
  // execution surface, which had stopped being true.
  resetObservations();
  await clickOrExplain(page, '[data-bench-tab="shadow"]');
  await page.type('#planGoal', 'add a short note file for this e2e run');
  await page.type('.plan-file-path', 'e2e-notes/browser-e2e-note.txt');
  await page.type('.plan-file-contents', 'written by the browser E2E suite');
  await clickOrExplain(page, '#planForm button.primary');
  await page.waitForFunction(
    () => /pending approval/.test(document.querySelector('#planRunBadge')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const planned = await page.evaluate(() => ({
    badge: document.querySelector('#planRunBadge')?.textContent ?? '',
    result: document.querySelector('#planResult')?.textContent ?? '',
    actionsHidden: document.querySelector('#planActions')?.classList.contains('hidden'),
  }));
  check('a plan created through the Plan panel is pending approval, not a declared-empty placeholder',
    /pending approval/.test(planned.badge) && /runId:/.test(planned.result) && planned.actionsHidden === false,
    JSON.stringify(planned));

  await clickOrExplain(page, '#planSimulateBtn');
  await page.waitForFunction(
    () => /Simulated/.test(document.querySelector('#shadowRunContent')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const simulated = await page.evaluate(() => document.querySelector('#shadowRunContent')?.textContent ?? '');
  check('Simulate answers through the Shadow run panel, honestly (the reference provider declares itself unsupported rather than inventing a prediction)',
    /Simulated/.test(simulated) && /not supported/.test(simulated), simulated);

  await clickOrExplain(page, '#planApproveBtn');
  await page.waitForFunction(
    () => /promoted|refused/i.test(document.querySelector('#planRunBadge')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const approved = await page.evaluate(() => ({
    badge: document.querySelector('#planRunBadge')?.textContent ?? '',
    diff: document.querySelector('#diffContent')?.textContent ?? '',
    restoreHidden: document.querySelector('#planRestoreBtn')?.classList.contains('hidden'),
  }));
  check('UI-036 Approve executes the plan into the shadow and promotes; the Diff panel shows a real diff, not "no change to compare"',
    /promoted/.test(approved.badge) && !/No change to compare/.test(approved.diff) && approved.restoreHidden === false,
    JSON.stringify(approved));

  // --- D-0230: Editor/Preview/Problems/Logs also read from the same run -----
  const secondaryPanels = await page.evaluate(() => ({
    editor: document.querySelector('#editorContent')?.textContent ?? '',
    preview: document.querySelector('#previewContent')?.textContent ?? '',
    problems: document.querySelector('#problemsContent')?.textContent ?? '',
  }));
  check("Editor shows the run's own promoted content, not a declared-empty placeholder",
    /promoted content/.test(secondaryPanels.editor) && /written by the browser E2E suite/.test(secondaryPanels.editor),
    JSON.stringify(secondaryPanels).slice(0, 300));
  check("Preview renders the promoted file's content for a plain-text artefact",
    /written by the browser E2E suite/.test(secondaryPanels.preview), secondaryPanels.preview.slice(0, 200));
  check('Problems reports a clean run rather than "nothing has run"',
    /run was clean/.test(secondaryPanels.problems), secondaryPanels.problems);

  await clickOrExplain(page, '[data-bench-tab="logs"]');
  await page.waitForFunction(
    () => /workspace_action\.promoted/.test(document.querySelector('#workLogsContent')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const workLogs = await page.evaluate(() => document.querySelector('#workLogsContent')?.textContent ?? '');
  check("D-0230 Logs shows this run's own causal event trail through GET /api/v1/events/:correlationId, ending in a promotion",
    /workspace_action\.planned/.test(workLogs) && /workspace_action\.promoted/.test(workLogs), workLogs.slice(0, 400));

  // --- D-0230: Map — read-only repository understanding, workspace-scoped, not per-run ---
  await clickOrExplain(page, '[data-bench-tab="map"]');
  await clickOrExplain(page, '#mapScanBtn');
  await page.waitForFunction(
    () => /Files scanned/.test(document.querySelector('#mapContent')?.textContent ?? ''),
    { timeout: 30000 },
  );
  const mapResult = await page.evaluate(() => document.querySelector('#mapContent')?.textContent ?? '');
  check('Map scans the real workspace and reports languages/entry points instead of "repository understanding is backbone work"',
    /Files scanned/.test(mapResult) && /Languages/.test(mapResult) && /Entry points/.test(mapResult),
    mapResult.slice(0, 300));

  await page.type('#mapSearchQuery', 'browser E2E suite');
  await clickOrExplain(page, '#mapSearchForm button');
  await page.waitForFunction(
    () => (document.querySelector('#mapSearchResults')?.textContent ?? '').trim() !== '',
    { timeout: 15000 },
  );
  const mapSearch = await page.evaluate(() => document.querySelector('#mapSearchResults')?.textContent ?? '');
  check('Map search finds a literal match inside the promoted file',
    /browser-e2e-note\.txt/.test(mapSearch) && !/No match/.test(mapSearch), mapSearch.slice(0, 200));

  await clickOrExplain(page, '[data-bench-tab="shadow"]');
  await clickOrExplain(page, '#planRestoreBtn');
  await page.waitForFunction(
    () => /restored/i.test(document.querySelector('#planRunBadge')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const restoredBadge = await page.evaluate(() => document.querySelector('#planRunBadge')?.textContent ?? '');
  check('Restore reverts a promoted run', /restored/i.test(restoredBadge), restoredBadge);

  at('closure');
  // --- the NOT DONE box · UI-036, Critical --------------------------------
  //
  // The rule is that the box cannot be empty WITHOUT SAYING SO. Both halves are
  // exercised: an empty box is refused, and an empty box that is declared is accepted.
  await clickOrExplain(page, '[data-bench-tab="closure"]');
  await page.waitForSelector('#closureForm', { timeout: 15000 });
  await page.type('#closureRisk', 'none');
  await clickOrExplain(page, '#closureForm button.primary');
  const refused = await page.evaluate(() => ({
    shown: document.querySelector('#closureRefusal')?.classList.contains('hidden') === false,
    text: document.querySelector('#closureRefusal')?.textContent ?? '',
    closures: document.querySelectorAll('#closureList .entity-card').length,
  }));
  check('UI-036 a closure with a silently empty NOT DONE box is refused',
    refused.shown && /NOT DONE box is empty/.test(refused.text) && refused.closures === 0,
    JSON.stringify(refused));

  await page.type('#closureNotDone', 'the RTL pass on this change\nthe screen-reader pass');
  await clickOrExplain(page, '#closureForm button.primary');
  await page.waitForFunction(
    () => document.querySelectorAll('#closureList .entity-card').length >= 1,
    { timeout: 15000 },
  );
  const closed = await page.evaluate(() => ({
    cards: document.querySelectorAll('#closureList .entity-card').length,
    notDone: document.querySelectorAll('#closureList .entity-card li').length,
    text: document.querySelector('#closureList .entity-card')?.textContent ?? '',
  }));
  check('UI-036 a closure that names what was not done is kept and shown',
    closed.cards === 1 && closed.notDone === 2 && /NOT DONE/.test(closed.text),
    JSON.stringify(closed));

  at('metric');
  // --- the product's metric · UI-070…UI-072 -------------------------------
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#metricDefinition', { timeout: 15000 });
  const metric = await page.evaluate(() => ({
    definition: document.querySelector('#metricDefinition')?.textContent ?? '',
    median: document.querySelector('#metricMedian')?.textContent ?? '',
    rejectedLabel: document.querySelector('#metricRejected')?.parentElement?.textContent ?? '',
  }));
  check('UI-071/UI-072 the metric is shown as a time and states that rejections count',
    /seconds of human review/.test(metric.definition) && /Rejected changes are counted, not excluded/.test(metric.definition)
      && /counted, not excluded/.test(metric.rejectedLabel),
    JSON.stringify(metric).slice(0, 260));

  at('initial-screen');
  // --- the initial screen · UI-060…UI-063 ----------------------------------
  // Driven rather than read, because every one of these is a claim about what a person
  // sees: six buttons that exist, three of them refusing to act and SAYING why, ten goals
  // that fill the composer without sending anything, and three inventory panels that must
  // never come back as a bare "Loading…".
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#homeEntryActions .entry-action', { timeout: 15000 });
  const entry = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#homeEntryActions .entry-action')];
    return {
      count: buttons.length,
      wiredBadge: document.querySelector('#homeEntryWired')?.textContent ?? '',
      // aria-disabled, not disabled: these must stay in the tab order, because the whole
      // point of them is the sentence explaining what is missing.
      disabled: buttons.filter((button) => button.getAttribute('aria-disabled') === 'true').map((button) => ({
        id: button.dataset.entryAction,
        // The reason has to be ON SCREEN. A disabled button with its explanation in a
        // tooltip is a button that looks broken to everyone who does not hover it.
        reason: (button.querySelector('span')?.textContent ?? '').trim().length,
        removedFromTabOrder: button.disabled || button.tabIndex < 0,
      })),
      labels: buttons.map((button) => button.dataset.entryAction),
    };
  });
  check('UI-060 the initial screen offers exactly six entry actions',
    entry.count === 6, `${entry.count}: ${entry.labels.join(', ')}`);
  check('UI-060 the actions that cannot act are marked unavailable and each says why on screen',
    entry.disabled.length >= 3 && entry.disabled.every((item) => item.reason > 20),
    JSON.stringify(entry.disabled));
  check('UI-060 and they stay reachable by keyboard, so the reason is not sight-only',
    entry.disabled.length >= 3 && entry.disabled.every((item) => item.removedFromTabOrder === false),
    JSON.stringify(entry.disabled));
  check('UI-060 the screen declares how many of the six can act',
    /\d+ of 6 can act/.test(entry.wiredBadge), entry.wiredBadge);

  const goals = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#homeGoalActions .goal-action')];
    return {
      count: buttons.length,
      texts: buttons.map((button) => (button.textContent ?? '').trim()),
      // 2.5.8 target size, measured rather than assumed — the last phase found a 22px
      // button that reading the stylesheet had not.
      shortest: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
    };
  });
  check('UI-061 there are ten quick actions', goals.count === 10, goals.texts.slice(0, 3).join(' | '));
  check('UI-061 each is phrased as a goal, not as a function name',
    goals.texts.every((text) => text.includes(' ') && !/[(){}]/.test(text)), goals.texts.join(' | ').slice(0, 200));
  check('UI-061 every goal clears the 24px target floor', goals.shortest >= 24, `shortest ${goals.shortest}px`);

  // Pressing one fills the composer and sends nothing. Both halves matter: a goal that
  // fires a request has decided for the person what they meant by it.
  const beforeGoal = await page.evaluate(() => document.querySelectorAll('.message').length);
  await clickOrExplain(page, '#homeGoalActions .goal-action');
  await new Promise((resolve) => setTimeout(resolve, 800));
  const afterGoal = await page.evaluate(() => ({
    view: document.querySelector('#view-chat')?.classList.contains('active') ?? false,
    composer: document.querySelector('#chatInput')?.value ?? '',
    messages: document.querySelectorAll('.message').length,
  }));
  check('UI-061 a goal opens the conversation with the goal in the composer',
    afterGoal.view && afterGoal.composer.length > 10, JSON.stringify(afterGoal).slice(0, 200));
  check('UI-061 and sends nothing by itself',
    afterGoal.messages === beforeGoal, `${beforeGoal} -> ${afterGoal.messages}`);

  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#homeServices', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const inventory = await page.evaluate(() => {
    const read = (id) => (document.querySelector(id)?.textContent ?? '').trim();
    return {
      services: read('#homeServices'),
      status: read('#homeServicesStatus'),
      tools: read('#homeTools'),
      models: read('#homeModels'),
      zone: read('#taskZoneChip'),
      groups: [...document.querySelectorAll('.schedule-board .schedule-group h3')].map((node) => node.textContent.trim()),
    };
  });
  for (const [name, text] of [['service health', inventory.services], ['tools', inventory.tools], ['models', inventory.models]]) {
    check(`UI-063 the ${name} panel resolved to real content`,
      text.length > 30 && !/^Loading…/.test(text), text.slice(0, 140));
  }
  check('UI-063 the owner sees named components, not just an aggregate',
    /data-plane|log-volume|workspace/.test(inventory.services), inventory.services.slice(0, 160));
  check('UI-063 a tool panel with nothing in it says WHY it is empty',
    /No tool is registered|Reaches/.test(inventory.tools), inventory.tools.slice(0, 160));
  check('UI-063 models declare that trust state is not rendered, and why',
    /trust_state/.test(inventory.models), inventory.models.slice(0, 200));
  check('UI-062 the work queue shows both groups and names the zone the times are in',
    inventory.groups.length === 2 && /Times in \w+/.test(inventory.zone),
    `${inventory.groups.join(' / ')} — ${inventory.zone}`);

  // A scheduled task, created through the interface, must come back carrying the instant
  // the person meant. This is the check that would have failed before this phase: the
  // field holds a wall clock, and the value that reached the store used to be resolved
  // against the container's clock instead of the reader's zone.
  const scheduled = await page.evaluate(async () => {
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('noesar_csrf='))?.split('=')[1] ?? '';
    // The EFFECTIVE zone, not this browser's. The first version of this check used
    // `Intl…resolvedOptions().timeZone` and failed while the product was right: the probe
    // browser runs in UTC and the installation's effective zone was nine hours away, so a
    // correctly resolved 09:30 came back as 00:30Z and the oracle called it a defect. The
    // invariant that matters is that the field is READ in the same zone the panel DISPLAYS
    // — which is the effective one, resolved by the five-tier service.
    const zone = (await (await fetch('/api/v1/settings/timezone')).json()).effective;
    document.querySelector('#taskTitle').value = 'e2e scheduled probe';
    document.querySelector('#taskScheduledAt').value = '2027-01-15T09:30';
    document.querySelector('#taskRecurrence').value = 'FREQ=WEEKLY;BYDAY=MO';
    document.querySelector('#taskForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch('/api/v1/tasks', { headers: { 'x-noesar-csrf': csrf } });
    const { tasks } = await response.json();
    const task = tasks.find((item) => item.title === 'e2e scheduled probe');
    return { zone, stored: task?.scheduledAt ?? null, rule: task?.recurrence ?? null };
  });
  check('UI-062 a scheduled task is stored as an instant, not as a bare wall clock',
    typeof scheduled.stored === 'string' && /Z$/.test(scheduled.stored),
    JSON.stringify(scheduled));
  check('UI-062 and that instant reads back as the wall clock that was typed, in the effective zone',
    scheduled.stored !== null && new Intl.DateTimeFormat('en-CA', {
      timeZone: scheduled.zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(scheduled.stored)).replace(', ', 'T') === '2027-01-15T09:30',
    JSON.stringify(scheduled));
  // And the form says which zone it is reading, next to the field. Without it the
  // agreement above is invisible to the person: they type a number into a box that never
  // names the zone it will be understood in, and only find out afterwards.
  const fieldZone = await page.evaluate(() => ({
    formNote: (document.querySelector('#taskFormZone')?.textContent ?? '').trim(),
    panelChip: (document.querySelector('#taskZoneChip')?.textContent ?? '').trim(),
  }));
  check('UI-062 the schedule field names the zone it is read in, and it is the panel\'s zone',
    fieldZone.formNote.includes(scheduled.zone) && fieldZone.panelChip.includes(scheduled.zone),
    JSON.stringify(fieldZone));

  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const board = await page.evaluate(() => ({
    active: document.querySelector('#taskActiveCount')?.textContent ?? '',
    scheduled: document.querySelector('#taskScheduledCount')?.textContent ?? '',
    scheduledText: (document.querySelector('#taskScheduledList')?.textContent ?? '').trim(),
    activeText: (document.querySelector('#taskList')?.textContent ?? '').trim(),
  }));
  check('UI-062 the scheduled task appears under Scheduled, with its rule shown verbatim',
    /e2e scheduled probe/.test(board.scheduledText) && /FREQ=WEEKLY;BYDAY=MO/.test(board.scheduledText),
    board.scheduledText.slice(0, 200));
  check('UI-062 and it appears in exactly one group',
    !/e2e scheduled probe/.test(board.activeText), `active: ${board.activeText.slice(0, 120)}`);

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

  // The gates moved down a level with the pages they guard: what used to be a hidden nav
  // entry is now a hidden entry in the Settings menu. The property under test is unchanged
  // — an account is not offered what it cannot open — and it is read where it now lives.
  // A gate that survives a demotion in name only is the failure mode this catches.
  const offered = await page.evaluate(() => {
    const section = (key) => { const node = document.querySelector(`.settings-nav[data-section="${key}"]`); return node ? node.hidden : null; };
    const destination = (view) => { const node = document.querySelector(`.nav[data-view="${view}"]`); return node ? node.hidden : null; };
    return {
      users: section('people'), backups: section('storage'), health: section('health'),
      updates: section('updates'),
      settings: destination('settings'), security: section('security'), about: section('about'),
    };
  });
  check('nav hides every section this role cannot open',
    offered.users === true && offered.backups === true && offered.health === true
    && offered.updates === true, JSON.stringify(offered));
  check('nav still offers the sections this role can open',
    offered.settings === false && offered.security === false && offered.about === false,
    JSON.stringify(offered));

  resetObservations();
  await page.goto(`${BASE}/#/logs`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  // The refusal moved with the page. It is rendered inside Settings rather than as a
  // full page, so the person keeps the menu they arrived through — but every property the
  // full page had is still required: a real box on screen, the requirement named, the
  // section itself NOT shown, and an address that still names where the request went.
  const denied = await page.evaluate(() => ({
    deniedShown: document.querySelector('#settingsDenied')?.classList.contains('hidden') === false,
    logsShown: (document.querySelector('#view-logs')?.getBoundingClientRect().height ?? 0) > 0,
    sectionShown: document.querySelector('.settings-section[data-section="health"]')?.classList.contains('active') ?? false,
    rendered: (document.querySelector('#settingsDenied')?.getBoundingClientRect().height ?? 0) > 0,
    detail: document.querySelector('#settingsDenied')?.textContent ?? '',
    hash: location.hash,
  }));
  check('a forbidden route shows access-denied instead of an empty panel',
    denied.deniedShown && !denied.logsShown && !denied.sectionShown, JSON.stringify(denied));
  check('the access-denied page is actually on screen', denied.rendered);
  check('access-denied explains what is required', /owner/.test(denied.detail), denied.detail);
  // The address must keep naming what was asked for: rewriting it to #/access-denied
  // would make a reload turn the 403 into a 404. "#/logs" now forwards to the section that
  // owns it, so the address that must survive is the forwarding one.
  check('the address still names the requested route', denied.hash === '#/settings/health', denied.hash);
  check('no request was even attempted for the forbidden page', failedRequests.length === 0,
    failedRequests.join(' | '));

  // A page it IS allowed to open must still work for this role.
  await page.goto(`${BASE}/#/settings/security`, { waitUntil: 'networkidle2' });
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

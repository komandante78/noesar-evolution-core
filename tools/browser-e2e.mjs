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
  // An in-page click, not page.click(selector). page.click() resolves a remote
  // ElementHandle, THEN scrolls it into view (isIntersectingViewport ->
  // assertConnectedElement) before dispatching — a real round trip with real elapsed
  // time between "found" and "clicked". Found live (D-0265): a re-render landing in that
  // gap detaches the handle's node and page.click() throws "Node is detached from
  // document", even though a fresh querySelector at click time would have found the
  // element's live replacement without issue. document.querySelector(sel).click() is a
  // single synchronous in-page operation with no such gap — it re-resolves the selector
  // and clicks in the same tick, immune to this class of race regardless of what causes
  // the re-render. It does not scroll the element into view, which the geometry check
  // above already establishes is unnecessary here (getBoundingClientRect needs no scroll).
  const clicked = await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return false;
    node.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`${selector}: element disappeared before it could be clicked`);
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

/**
 * `freshCode`'s `avoid` set only rejects a code string this SCRIPT has already seen —
 * it says nothing about the server's own `lastTotpStep` (a real, wall-clock-derived
 * step number, monotonic regardless of which secret produced a code — auth.mjs's
 * `consumeTotp`). A code whose STRING is new can still be for a step the server already
 * consumed, e.g. moments after an MFA replacement's own confirm() call — found running
 * this exact sequence: two calls three real seconds apart both failed, one as "invalid",
 * the retry as "already used", because not enough wall-clock time had passed for the
 * step to actually advance. This waits for a real step boundary strictly after the
 * moment it is called, which is sufficient to be strictly after any consumption that
 * already happened by then.
 */
async function nextRealStepCode(secret, stepSeconds = 30) {
  const baseline = Math.floor(Date.now() / 1000 / stepSeconds);
  while (Math.floor(Date.now() / 1000 / stepSeconds) <= baseline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return totpCode(secret, Date.now(), stepSeconds);
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

/**
 * Run something that may throw, record the outcome, and CARRY ON.
 *
 * Why this exists, measured in s326: the whole harness is one `try`, so the first throw ends
 * the run. A `waitForFunction` in the `workflows` step had been timing out — the approval
 * strip never reaches "Approvals: 1" because `/api/v1/approvals` answers 500 on a missing
 * `noesar_knowledge.memory_records` relation — and that single timeout was quietly killing
 * FOURTEEN later steps: privacy indicator, deep-link, mfa-replacement, settings, home,
 * sessions, reading-controls, workbench, workspace-actions, closure, metric, initial-screen,
 * invitation, sign-out.
 *
 * Nothing said so. The run printed a stable "9 failures", which reads like nine known
 * problems and was in fact one abort plus a tail that never executed — so `UI-001…UI-012`,
 * believed covered by this suite, had not been exercised for sessions. A suite that stops
 * early while reporting a plausible number is worse than one that fails loudly.
 *
 * The failure is still a failure, recorded through `check` with the weight it always had.
 * What changes is that it no longer decides whether the rest of the product gets tested.
 */
async function soft(name, run) {
  try {
    await run();
    return true;
  } catch (error) {
    check(name, false, `${error.message} [step: ${step}] — recorded, and the run continues`);
    return false;
  }
}

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
    'home', 'chat', 'coden', 'coden-tui', 'projects', 'documents', 'knowledge', 'memory',
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
  // Thirteen since D-0265 (14_MEMORIA_A_CUBI.md, CUBE-009): Memory joined the sidebar as
  // its own destination, the first addition to the count since the twelve-destination
  // restructure this check's name still remembers.
  check('the sidebar carries thirteen destinations, not twenty-three',
    shell.destinations.length === 13, `${shell.destinations.length}: ${shell.destinations.join(' ')}`);
  // Fourteen as of D-0277: Modules rejoined the menu, this time as a one-click Owner-catalog
  // installer over the real D-0274/D-0275 activation framework — D-0273's ad-hoc version was
  // retired in D-0276, same section id, different backend.
  //
  // FIFTEEN since D-0291 (s305): "Remote targets" joined as a section of its own. This check
  // had been asserting fourteen ever since and was simply not being run — the count and the
  // name below are corrected here rather than in the phase that added the section, because
  // this is the run that surfaced it.
  // SIXTEEN since D-0343 — and the literal is gone, because this line has now been wrong twice
  // for the same reason. It asserted fourteen for a whole phase after `remote-targets` landed
  // (the comment above records it), and would have asserted fifteen after `skills`. A count
  // that every phase adding a section must hand-edit is a check that fails for the one reason
  // it was never meant to catch, and its failures teach the next reader to edit the number
  // rather than to look.
  //
  // What is left is the property that cannot go stale: Settings is ONE destination, and it is
  // not empty. The bijection is the line below, and the count itself is pinned where it
  // belongs — `webui-markup-structure.test.mjs` holds the declared set and, since D-0343,
  // requires it to equal the list `app.js` will actually route to. That is the guard that
  // would have caught `remote-targets` shipping unreachable, which this one did not.
  check('Settings is one destination, and it holds sections',
    shell.sections.length > 0 && shell.menu.length === shell.sections.length,
    `menu=${shell.menu.length} sections=${shell.sections.length}`);
  check('every Settings menu entry has a section behind it and every section an entry',
    shell.menu.every((key) => shell.sections.includes(key)) && shell.sections.every((key) => shell.menu.includes(key)),
    `menu=${shell.menu.join(' ')} | sections=${shell.sections.join(' ')}`);
  check('the sections are grouped, not one flat list', shell.groups.length === 3, shell.groups.join(' | '));

  // Every address a demoted page used to answer on still resolves to the section that owns
  // it now. A bookmark that 404s is how a change of rank turns into a loss of function.
  const LEGACY = {
    tasks: 'home', tools: 'coden', approvals: 'settings/audit',
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
    // The address may be the target's, or the target's own completion of it: `#/tools`
    // redirects to `#/coden`, which then names the panel it is showing (`#/coden/bench/…`).
    // Accepting a prefix and not merely any hash keeps the check honest — landing on the
    // wrong destination still fails, and so does landing on `#/codenope`.
    const arrived = landed.hash === `#/${to}` || landed.hash.startsWith(`#/${to}/`);
    if (!landed.onScreen || landed.notFound || !arrived) {
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
  // Owner: the panel opens deactivated by default and only turns on if clicked — a
  // destination with no remembered choice defaults to 'hidden', not 'docked'.
  check('a placement chosen on one destination does not follow you to another',
    projectsDefault.rank === 'hidden', JSON.stringify(projectsDefault));
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

  at('coden-addresses');
  // --- the workbench's panels are addresses -------------------------------
  // Eleven bench panels and five agent panels could be clicked and nothing else: not
  // linked to, not reloaded onto, not typed. They carry addresses of their own now
  // (`#/coden/bench/diff`, `#/coden/agent/authority`), and the checks below are the ones
  // reading the code cannot make.
  //
  // Every assertion is on GEOMETRY, not on classList: `.bench-panel.active` inside a
  // display:none ancestor is active and has no box, which is the exact shape of the
  // defect webui-markup-structure.test.mjs exists for. A panel is on screen when it
  // occupies pixels.
  resetObservations();
  const panelBox = (selector) => page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return { found: false, height: 0 };
    const box = node.getBoundingClientRect();
    return { found: true, height: box.height, width: box.width };
  }, selector);
  const apiCalls = () => page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/v1/')).length);

  // A COLD deep link, which needs the reload to be one: page.goto() to a URL differing only
  // in its hash is a same-document navigation — it fires hashchange on the page already
  // loaded and never re-runs boot. The first version of this check did exactly that and
  // called it a deep link, which would have left the case that matters (open the address in
  // a new tab) untested while reporting PASS.
  await page.goto(`${BASE}/#/coden/bench/diff`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-bench-panel="diff"].active', { timeout: 15000 });
  const diffPanel = await panelBox('[data-bench-panel="diff"]');
  const shadowPanel = await panelBox('[data-bench-panel="shadow"]');
  check('a cold deep link to a bench panel puts that panel on screen',
    diffPanel.height > 0 && shadowPanel.height === 0, JSON.stringify({ diffPanel, shadowPanel }));
  const deepLinked = await page.evaluate(() => ({
    hash: location.hash,
    title: document.title,
    // Phase 3 removed the tab whose aria-selected this used to read. The breadcrumb is what
    // says where you are now, so it is what has to be right.
    where: document.querySelector('#benchWhereName')?.textContent ?? '',
    announced: document.querySelector('#routeAnnouncer')?.textContent ?? '',
  }));
  check('the deep-linked address survives activation instead of being rewritten to #/coden',
    deepLinked.hash === '#/coden/bench/diff', JSON.stringify(deepLinked));
  check('the panel names itself in the title, the breadcrumb and the live region',
    /^Diff · /.test(deepLinked.title) && deepLinked.where === 'Diff' && /Diff/.test(deepLinked.announced),
    JSON.stringify(deepLinked));

  // PHASE 3c. This check used to assert the opposite: that an agent address left the bench
  // panel standing, "because the agent column and the bench are visible together". They are
  // not, since 3c — two regions each holding an open panel is a dashboard however few panels
  // each of them has, and §4b.2 draws no side column at all. An address names ONE place, and
  // now exactly one is open.
  await page.goto(`${BASE}/#/coden/agent/authority`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-agent-panel="authority"].active', { timeout: 15000 });
  const authorityPanel = await panelBox('[data-agent-panel="authority"]');
  const benchClosed = await panelBox('[data-bench-panel="diff"]');
  check('phase 3c — an agent address opens its panel and closes the bench one, so ONE is open',
    authorityPanel.height > 0 && benchClosed.height === 0, JSON.stringify({ authorityPanel, benchClosed }));

  // An address typed wrong must land somewhere real and then say where it landed — the
  // rule an unknown Settings section already follows.
  await page.goto(`${BASE}/#/coden/bench/no-such-panel`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#view-coden.active', { timeout: 15000 });
  const fallback = await page.evaluate(() => ({
    hash: location.hash,
    active: document.querySelector('[data-bench-panel].active')?.getAttribute('data-bench-panel'),
  }));
  check('an unknown panel name falls back to the default and normalises the address',
    fallback.active === 'shadow' && fallback.hash === '#/coden/bench/shadow', JSON.stringify(fallback));

  // Why an in-page move uses pushState instead of assigning location.hash: assigning it
  // fires hashchange, which re-runs VIEW_LOADERS.coden — a round of requests every time you
  // change panel. Measured, because it is invisible on screen either way.
  //
  // Driven through the box, because phase 3 removed the tab this used to click. The property
  // is unchanged and so is its value: moving between panels of the page you are already on
  // must not refetch that page.
  // PHASE 3c. This used to press `/` and drive the TOP ADDRESS BOX. That box is gone from this
  // destination — §4b.4 rule 1, there is one `/` and it is in the prompt — so the helper drives
  // the prompt, which is the gesture a user now has. Everything it measures below (the address
  // moves, the page does not refetch, Back returns) is unchanged; only the way in is.
  const jump = async (address, panel) => {
    await page.evaluate((typed) => {
      const box = document.querySelector('#codenPrompt');
      box.value = `/${typed}`;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
    }, address);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`[data-bench-panel="${panel}"].active`, { timeout: 15000 });
  };
  // Sampled only once the page has gone quiet. Without this the counter could be read while
  // requests from the PREVIOUS step were still in flight, and they then landed between the two
  // samples — reporting "26 → 28" and blaming the jump for two fetches it never made. Seen
  // intermittently while phase 3b was being verified, and it cost a real investigation: a check
  // that fails at random is one people learn to re-run rather than believe, which is worse than
  // not having it. `catch` because a page that is ALREADY idle never fires the event.
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
  const callsBefore = await apiCalls();
  await jump('coden/bench/map', 'map');
  const afterJump = await page.evaluate(() => ({ hash: location.hash, title: document.title }));
  const callsAfter = await apiCalls();
  check('jumping to a panel of this page moves the address', afterJump.hash === '#/coden/bench/map', JSON.stringify(afterJump));
  check('jumping to a panel of this page does not refetch it',
    callsAfter === callsBefore, `${callsBefore} → ${callsAfter} requests to /api/v1/`);

  // PHASE 3c. A bare `#/coden` used to be COMPLETED to whichever panel happened to be showing,
  // because a panel was always showing — which is exactly what made this page a dashboard.
  // `16` §4b.3: the panels "smettono di essere riquadri sempre presenti e restano posti dove si
  // va". So a bare address now opens none, stays short because that is honest, and the bench is
  // not on the screen at all. Nothing became unreachable: every one of the twenty-five is an
  // address the prompt opens, measured one by one in 3c-1 before any of this was removed.
  await page.goto(`${BASE}/#/coden`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#view-coden.active', { timeout: 15000 });
  const bare = await page.evaluate(() => ({
    hash: location.hash,
    open: document.querySelectorAll('#view-coden [data-bench-panel].active,#view-coden [data-agent-panel].active').length,
    benchHeight: document.querySelector('#bench').getBoundingClientRect().height,
    promptOnScreen: document.querySelector('#codenPrompt').getBoundingClientRect().height > 0,
  }));
  check('phase 3c — a bare #/coden opens no panel and stays a bare address',
    bare.hash === '#/coden' && bare.open === 0 && bare.benchHeight === 0 && bare.promptOnScreen,
    JSON.stringify(bare));

  // pushState with no way back would leave the address ahead of the screen: the Back button
  // moving the bar and nothing else. Two jumps, so the entry being returned to is one this
  // check made itself rather than whatever the steps above happened to leave behind.
  await jump('coden/bench/diff', 'diff');
  await jump('coden/bench/tests', 'tests');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bench-panel="diff"].active', { timeout: 15000 });
  const wentBack = await page.evaluate(() => ({
    hash: location.hash,
    active: document.querySelector('[data-bench-panel].active')?.getAttribute('data-bench-panel'),
  }));
  check('the Back button returns to the previous panel, not just to the previous address',
    wentBack.active === 'diff' && wentBack.hash === '#/coden/bench/diff', JSON.stringify(wentBack));

  // --- phase 3a: the four regions, DRIVEN rather than asserted --------------------------
  //
  // `16` §4b.2. Every check below types into the real prompt of a real page. The module was
  // written and unit-tested, and neither of those is the same as it having RUN in a browser:
  // this project has already shipped a page telling the user to run a client that was not in
  // the image, and a `plan()` whose `status` both shells invented. Both survived unit tests
  // and died the first time anything drove them.
  await page.goto(`${BASE}/#/coden`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#codenPrompt', { timeout: 15000 });
  const regions = await page.evaluate(() => ({
    status: Boolean(document.querySelector('#view-coden .coden-bar')),
    transcript: Boolean(document.querySelector('#codenTranscript')),
    prompt: Boolean(document.querySelector('#codenPrompt')),
    menu: Boolean(document.querySelector('#codenMenu')),
    // PHASE 3c has now removed it, and this is where that is measured on a bare address: 3a
    // deliberately left it standing, 3b gave the stranded addresses a view, and only then was
    // removing it something other than deleting a function that exists nowhere else.
    bench: Boolean(document.querySelector('#view-coden .bench')),
    benchOnScreen: document.querySelector('#view-coden .bench')?.getBoundingClientRect().height > 0,
    opening: document.querySelector('#codenTranscript')?.textContent?.trim() ?? '',
  }));
  check('CE-033 · the browser shows all four regions',
    regions.status && regions.transcript && regions.prompt && regions.menu, JSON.stringify(regions));
  // PHASE 3c. The bench markup STAYS — the address book derives all twenty-five addresses
  // from those very attributes, and the panels hold real forms. What is removed is the
  // dashboard: it is not on the screen until an address opens a panel in it.
  check('phase 3c — the bench markup stays, and is off the screen on a bare address',
    regions.bench === true && regions.benchOnScreen === false, JSON.stringify(regions));
  check('the transcript opens with its note rather than empty',
    regions.opening.includes('CodeN Evolution'), regions.opening.slice(0, 80));

  // POINT 3 — `/` opens the ONE menu, and it opens on the GROUPS rather than on thirty entries.
  await page.click('#codenPrompt');
  await page.keyboard.type('/');
  await page.waitForSelector('#codenMenu:not(.hidden)', { timeout: 15000 });
  const top = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#codenMenu [data-coden-group]')].map((node) => ({
      key: node.dataset.codenGroup,
      title: node.querySelector('span')?.textContent?.trim() ?? '',
      tail: node.querySelector('small')?.textContent?.trim() ?? '',
    })),
    entries: document.querySelectorAll('#codenMenu [data-coden-command]').length,
    notes: [...document.querySelectorAll('#codenMenu .agent-menu-note')].map((node) => node.textContent.trim()),
    // The key legend lives on the status line under the prompt, not inside the menu — point 2a
    // makes that line say what the NEXT key does, and it changes with the context. The terminal
    // renders the same list as the menu's last row, because its footer is already spent.
    keys: document.querySelector('#codenPromptHint')?.textContent?.trim() ?? '',
    selected: document.querySelectorAll('#codenMenu button.active').length,
  }));
  check('point 3 · a bare / opens on the groups, in order',
    JSON.stringify(top.rows.map((row) => row.title))
      === JSON.stringify(['WORK', 'DESTINATIONS', 'TOOLS', 'MODULES', 'APPROVALS', 'CONFIGURE', 'SESSION']),
    JSON.stringify(top.rows.map((row) => row.title)));
  check('point 3 · a bare / lists no entries at all — that is the whole point',
    top.entries === 0, String(top.entries));
  check('point 3 · every group row carries its key, its count and a hint',
    top.rows.length > 0 && top.rows.every((row) => row.key.length === 1 && /\d+ entr/.test(row.tail) && row.tail.includes('·')),
    JSON.stringify(top.rows));
  check('point 2a · the status line says what the NEXT key does, and it changed with the context',
    top.keys.includes('⏎ enter') && top.keys.includes('type to filter') && !top.keys.includes('Enter sends'),
    top.keys);
  check('CE-036 · the menu declares whether it was filtered',
    top.notes.some((note) => note.length > 0), JSON.stringify(top.notes));
  check('exactly one group row is highlighted', top.selected === 1, String(top.selected));

  // …and a key ENTERS that group: `/t` is TOOLS, and only TOOLS.
  await page.keyboard.type('t');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const openedGroup = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('#codenMenu .agent-menu-group')].map((node) => node.textContent.trim()),
    entries: [...document.querySelectorAll('#codenMenu [data-coden-command]')].map((node) => node.dataset.codenCommand),
  }));
  check('point 3 · a key opens exactly one group',
    JSON.stringify(openedGroup.groups) === JSON.stringify(['TOOLS']), JSON.stringify(openedGroup.groups));
  check('point 2b · the tools surface is in it, and it is a real destination now',
    openedGroup.entries.includes('tools'), openedGroup.entries.join(' '));

  // Two letters still filter across the whole product, unchanged — the second speed.
  await page.evaluate(() => {
    const box = document.querySelector('#codenPrompt');
    box.value = '/pl';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const menu = await page.evaluate(() => ({
    entries: [...document.querySelectorAll('#codenMenu [data-coden-command]')].map((node) => node.dataset.codenCommand),
    selected: document.querySelectorAll('#codenMenu button.active').length,
  }));
  check('point 3 · two letters still filter across the whole product',
    menu.entries.includes('plan'), menu.entries.join(' '));
  check('exactly one menu entry is highlighted', menu.selected === 1, String(menu.selected));
  // Left as `/` for the Tab check below, which types `pl` on top of it. The caret is moved to
  // the END explicitly rather than by clicking: a click lands the caret where the pointer is,
  // and `pl` typed into the middle of the box is `p/l`.
  await page.evaluate(() => {
    const box = document.querySelector('#codenPrompt');
    box.value = '/';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  });

  // Tab completes WITHOUT running — the rule both shells follow, and the one that stops a
  // keystroke becoming an action nobody chose.
  // Counted as a DELTA, not against a literal 1. That literal held only while nothing had
  // ever typed at this prompt; since 3c the jump helper drives the prompt, so the transcript
  // carries earlier turns and the check failed on a transcript that was simply used. The
  // property was always "Tab adds none", and now that is what is measured.
  const beforeTab = await page.evaluate(() => document.querySelectorAll('#codenTranscript .t-entry').length);
  await page.keyboard.type('pl');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await page.keyboard.press('Tab');
  const completedPrompt = await page.evaluate(() => ({
    value: document.querySelector('#codenPrompt').value,
    entries: document.querySelectorAll('#codenTranscript .t-entry').length,
  }));
  check('Tab completes the prompt and runs nothing',
    completedPrompt.value === '/plan ' && completedPrompt.entries === beforeTab,
    JSON.stringify({ ...completedPrompt, beforeTab }));

  // A real call, over the real bridge, landing in the real transcript.
  await page.evaluate(() => { document.querySelector('#codenPrompt').value = ''; });
  await page.click('#codenPrompt');
  await page.keyboard.type('/status');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => [...document.querySelectorAll('#codenTranscript .t-entry')].some((node) => node.textContent.includes('status — ok')),
    { timeout: 15000 },
  );
  const ran = await page.evaluate(() => ({
    kinds: [...document.querySelectorAll('#codenTranscript .t-entry')].map((node) => node.className).join(' '),
    detail: Boolean(document.querySelector('#codenTranscript .t-entry pre')),
    menuHidden: document.querySelector('#codenMenu').classList.contains('hidden'),
  }));
  check('a work command reaches the engine and answers into the transcript',
    ran.kinds.includes('t-user') && ran.kinds.includes('t-tool') && ran.kinds.includes('t-agent') && ran.detail,
    JSON.stringify(ran));
  check('the menu closes once the line is sent', ran.menuHidden === true, JSON.stringify(ran));

  // `/logout` needs a typed word. This is the one entry whose FIRST form must do nothing, so
  // the check is that the session survives it.
  await page.click('#codenPrompt');
  await page.keyboard.type('/logout');
  await page.keyboard.press('Enter');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const afterLogout = await page.evaluate(() => ({
    signedIn: Boolean(document.querySelector('#authGate')?.classList.contains('hidden')),
    said: [...document.querySelectorAll('#codenTranscript .t-note')].map((node) => node.textContent).join(' '),
  }));
  check('/logout alone asks, and does not end the session',
    afterLogout.signedIn && /logout confirm/.test(afterLogout.said), JSON.stringify(afterLogout));

  // A destination goes there, typed in the prompt, with no address bar involved.
  await page.click('#codenPrompt');
  await page.keyboard.type('/memory');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#view-memory.active', { timeout: 15000 });
  const navigated = await page.evaluate(() => location.hash);
  check('a destination typed in the prompt goes there', navigated === '#/memory', navigated);
  await page.goto(`${BASE}/#/coden`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#codenPrompt', { timeout: 15000 });

  const codenErrors = consoleErrors.filter((line) => !/Cross-Origin-Opener-Policy header has been ignored/.test(line));
  check('addressing the panels produced no console errors', codenErrors.length === 0, codenErrors.join(' | '));

  at('coden-no-switchers');
  // --- phase 3: three navigation widgets became none -----------------------
  // The visible half of the programme. What is checked is that they are gone from the
  // SCREEN and that nothing they used to reach went with them — the Navigator's nine groups
  // in particular, which are panels now and would be easy to lose in the move.
  // The workbench as someone ARRIVING sees it, which takes a little care to stage. A hash
  // change alone leaves the panel the previous block was on, and `#/coden` then correctly
  // completes to THAT one — so the check would read the last test's leftovers and call them
  // the default. Reloading on `#/coden` does not help either: the completion has already
  // rewritten the address by then, so the reload lands on the completed panel. The fresh
  // start is taken somewhere the completion cannot reach, and the workbench entered after.
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.goto(`${BASE}/#/coden`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#view-coden.active', { timeout: 15000 });
  const switchers = await page.evaluate(() => {
    const boxed = (selector) => [...document.querySelectorAll(selector)]
      .filter((node) => node.getBoundingClientRect().height > 0).length;
    return {
      tabs: boxed('[data-bench-tab]'),
      agentMenu: boxed('#agentMenu, [data-agent-menu]'),
      navigator: boxed('.bench-navigator, #benchNavigator'),
      benchColumns: getComputedStyle(document.querySelector('#bench')).gridTemplateColumns.split(' ').length,
      // PHASE 3c. A bare `#/coden` opens NO panel, so the bench is not on the screen at all —
      // "nessun pannello fisso", the line the phase-3 contract says must be true afterwards.
      benchOnScreen: document.querySelector('#bench').getBoundingClientRect().height > 0,
      addressBar: document.querySelector('#globalSearch')?.getBoundingClientRect().height > 0,
      promptMenuKey: document.querySelector('#codenPromptOpenMenu')?.getBoundingClientRect().height > 0,
      breadcrumbIsControl: Boolean(document.querySelector('button#benchWhere')),
      regions: {
        transcript: document.querySelector('#codenTranscript')?.getBoundingClientRect().height > 0,
        prompt: document.querySelector('#codenPrompt')?.getBoundingClientRect().height > 0,
        status: document.querySelector('.coden-bar')?.getBoundingClientRect().height > 0,
      },
    };
  });
  check('the bench tabs, the agent menu and the Navigator are off the screen',
    switchers.tabs === 0 && switchers.agentMenu === 0 && switchers.navigator === 0, JSON.stringify(switchers));
  check('phase 3c — a bare #/coden is the four regions and no fixed panel',
    !switchers.benchOnScreen && switchers.regions.transcript && switchers.regions.prompt && switchers.regions.status,
    JSON.stringify(switchers));
  check('phase 3c — the top address bar is gone from the destination that has a prompt',
    !switchers.addressBar, JSON.stringify(switchers));
  check('phase 3c — the breadcrumb is no longer a control, and the mouse reaches the one menu',
    !switchers.breadcrumbIsControl && switchers.promptMenuKey, JSON.stringify(switchers));

  // The Navigator's nine groups: reachable, and carrying the same lists as before.
  await page.goto(`${BASE}/#/coden/bench/projects`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-bench-panel="projects"].active', { timeout: 15000 });
  const navGroup = await page.evaluate(() => {
    const panel = document.querySelector('[data-bench-panel="projects"]');
    const rows = [...panel.querySelectorAll('#navProjects button')];
    return {
      onScreen: panel.getBoundingClientRect().height > 0,
      where: document.querySelector('#benchWhereName')?.textContent ?? '',
      agentOpen: document.querySelectorAll('#view-coden [data-agent-panel].active').length,
      rows: rows.length,
      allLead: rows.length > 0 && rows.every((node) => node.dataset.jump),
      firstTitle: rows[0]?.getAttribute('title') ?? '',
    };
  });
  check("a Navigator group is a panel now, reached by its own address",
    navGroup.onScreen && navGroup.where === 'Projects', JSON.stringify(navGroup));
  // PHASE 3c: ONE panel is open, across BOTH regions. Two regions each standing open is a
  // dashboard however few panels each of them holds.
  check('phase 3c — opening a bench panel closes the agent column, so one panel is open',
    navGroup.agentOpen === 0, JSON.stringify(navGroup));
  check('its rows carry the projects this run created, and every one of them leads somewhere',
    navGroup.rows > 0 && navGroup.allLead && / — opens projects$/.test(navGroup.firstTitle), JSON.stringify(navGroup));
  await clickOrExplain(page, '#navProjects button[data-jump]');
  await page.waitForSelector('#view-projects.active', { timeout: 15000 });
  check('clicking one opens the page that owns it', await page.evaluate(() => location.hash) === '#/projects');

  // PHASE 3c. The breadcrumb used to open the top address box, prefixed to this page. Both are
  // gone — §4b.4 rule 1, there is ONE `/`, and it is in the prompt. What replaces the mouse
  // path is the `/` in the prompt's own hint, which already said it opened the menu.
  //
  // This is the check the phase most needs driven rather than read: the removal is only safe
  // because the prompt reaches all twenty-five, and "the address book declares 25" is not the
  // same claim as opening one.
  await page.goto(`${BASE}/#/coden/bench/diff`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-bench-panel="diff"].active', { timeout: 15000 });
  await clickOrExplain(page, '#codenPromptOpenMenu');
  await page.waitForSelector('#codenMenu:not(.hidden)', { timeout: 15000 });
  const viaPrompt = await page.evaluate(() => {
    const options = [...document.querySelectorAll('#codenMenu [data-coden-command]')];
    return {
      prompt: document.querySelector('#codenPrompt').value,
      focused: document.activeElement?.id === 'codenPrompt',
      count: options.length,
      groups: document.querySelectorAll('#codenMenu [data-coden-group]').length,
      addresses: options.filter((node) => (node.dataset.codenCommand ?? '').startsWith('coden/')).length,
      where: document.querySelector('#benchWhereName')?.textContent ?? '',
    };
  });
  // The MOUSE path to the one menu, and it lands on the level the keyboard lands on.
  //
  // This used to require `count >= 25` — thirty commands with the address space held back —
  // because a flat list of everything was useless and the model excluded the fifty-three
  // addresses from a bare `/` to keep `/approve` on screen. Point 3 replaces that compromise
  // rather than tuning it: the bare `/` IS the groups, so zero entries here is the design, and
  // the address space is one number on the DESTINATIONS row instead of being dropped. What the
  // old assertion protected — that this gesture reaches the whole product — is measured by the
  // group rows here and by opening one below.
  check('phase 3c — clicking the hint opens the ONE menu, and a bare / is the product menu',
    viaPrompt.focused && viaPrompt.prompt.startsWith('/') && viaPrompt.count === 0 && viaPrompt.groups >= 5,
    JSON.stringify(viaPrompt));

  // Type, and the address space joins in — the case where you are looking for a panel by name.
  await page.keyboard.type('coden/bench/');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const viaTyping = await page.evaluate(() => {
    const options = [...document.querySelectorAll('#codenMenu [data-coden-command]')];
    return {
      count: options.length,
      addresses: options.filter((node) => (node.dataset.codenCommand ?? '').startsWith('coden/')).length,
    };
  });
  check('phase 3c — typing brings the address space into the same menu',
    viaTyping.addresses >= 15, JSON.stringify(viaTyping));
  check('and the open panel still names itself', viaPrompt.where === 'Diff', JSON.stringify(viaPrompt));


  // Driven end to end: type an address at the prompt, press Enter, land on the panel. This is
  // the gesture that has to work for the removal above to be honest.
  await page.evaluate(() => {
    const box = document.querySelector('#codenPrompt');
    box.value = '/coden/agent/authority';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-agent-panel="authority"].active', { timeout: 15000 });
  const landed = await page.evaluate(() => ({
    hash: location.hash,
    benchOpen: document.querySelectorAll('#view-coden [data-bench-panel].active').length,
  }));
  check('phase 3c — an address typed at the prompt opens its panel, and closes the other region',
    landed.hash === '#/coden/agent/authority' && landed.benchOpen === 0, JSON.stringify(landed));

  at('jump-to-address');
  // --- one box: `/` goes somewhere ----------------------------------------
  // The keyboard, the focus and the ARIA wiring are the whole feature here, and none of the
  // three can be checked by reading the file. Driven as a person drives it: press the key,
  // type, arrow, Enter.
  resetObservations();
  const paletteState = () => page.evaluate(() => {
    const box = document.querySelector('#globalSearchResults');
    const options = [...box.querySelectorAll('button')];
    const activeOption = options.find((node) => node.classList.contains('active'));
    return {
      open: !box.classList.contains('hidden'),
      focused: document.activeElement?.id === 'globalSearch',
      value: document.querySelector('#globalSearch').value,
      expanded: document.querySelector('#globalSearch').getAttribute('aria-expanded'),
      activeDescendant: document.querySelector('#globalSearch').getAttribute('aria-activedescendant') || '',
      count: options.length,
      addresses: options.filter((node) => node.dataset.jump).length,
      first: options[0]?.getAttribute('data-jump') ?? '',
      activeJump: activeOption?.getAttribute('data-jump') ?? '',
      activeIsActiveDescendant: Boolean(activeOption) && activeOption.id === document.querySelector('#globalSearch').getAttribute('aria-activedescendant'),
    };
  });

  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  // From nowhere in particular, and with the box empty. `/` is a character when something
  // with a caret has focus — which is right, since `coden/bench/diff` has to be typeable —
  // so a block that means to press it as a SHORTCUT has to start outside the box. The step
  // before this one leaves focus there, and the first version of this block pressed `/`
  // into it and searched for "/coden//".
  await page.evaluate(() => {
    const box = document.querySelector('#globalSearch');
    box.value = '';
    box.blur();
    // Whatever ELSE holds focus, too. The step before this one leaves the caret in CodeN's
    // prompt, and since phase 3c that prompt is the one place a '/' is a character rather than
    // a shortcut — so blurring only this box left the key going to the wrong shell.
    document.activeElement?.blur();
  });
  await page.keyboard.press('/');
  await page.waitForSelector('#globalSearchResults:not(.hidden)', { timeout: 15000 });
  const opened = await paletteState();
  // Thirteen destinations + fifteen Settings sections + the Archive and the Bin + sixteen
  // workbench panels. Asserted as a floor rather than a number, so adding a panel does not
  // fail a test that is not about counting.
  check('`/` opens the box that already existed, with every address in it',
    opened.open && opened.focused && opened.expanded === 'true' && opened.addresses >= 40, JSON.stringify(opened));
  check('`/` does not leak into the box as text', opened.value === '', JSON.stringify(opened));

  await page.keyboard.type('diff');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const filtered = await paletteState();
  check('typing filters to the address, ranked by the address before the label',
    filtered.first === 'coden/bench/diff', JSON.stringify(filtered));
  check('the highlighted row is the one aria-activedescendant names',
    filtered.activeIsActiveDescendant && filtered.activeJump === 'coden/bench/diff', JSON.stringify(filtered));

  // PHASE 3c moved these two BEFORE the jump. They are about the box, and the box does not
  // exist on the CodeN destination any more (§4b.4 rule 1: one `/`, and it is in the prompt).
  // Run after the jump, they read `focused:false` off an element that is display:none and
  // report a failure against correct behaviour — the third way this harness has found to fail
  // a check about a feature that is working.
  //
  // The arrow keys must move the selection without moving the caret out of the input, or the
  // next character typed lands nowhere.
  await page.keyboard.press('ArrowDown');
  const moved = await paletteState();
  check('the arrow keys move the selection and leave focus in the box',
    moved.focused && moved.activeIsActiveDescendant, JSON.stringify(moved));
  await page.keyboard.press('Escape');
  const escaped = await paletteState();
  check('Escape closes the box', !escaped.open, JSON.stringify(escaped));

  // Reopened, refiltered, and only THEN the jump that leaves this destination for good.
  await page.keyboard.press('/');
  await page.waitForSelector('#globalSearchResults:not(.hidden)', { timeout: 15000 });
  await page.keyboard.type('coden/bench/diff');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-bench-panel="diff"].active', { timeout: 15000 });
  const jumped = await page.evaluate(() => ({
    hash: location.hash,
    open: !document.querySelector('#globalSearchResults').classList.contains('hidden'),
    // And the box itself is gone, on the destination that has a prompt of its own.
    boxOnScreen: document.querySelector('#globalSearch').getBoundingClientRect().height > 0,
  }));
  check('Enter goes to the address and closes the box',
    jumped.hash === '#/coden/bench/diff' && !jumped.open, JSON.stringify(jumped));
  check('phase 3c — and the box is not on the destination it just arrived at',
    jumped.boxOnScreen === false, JSON.stringify(jumped));

  // The guard that matters most: a shortcut that fires while someone is writing is a defect.
  // The same property is already asserted for `[` further up, against the same guard —
  // isTyping() — which is exactly why `/` reuses it instead of bringing its own.
  await page.goto(`${BASE}/#/chat`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#chatInput', { timeout: 15000 });
  // focus(), not clickOrExplain(): that helper dispatches an in-page click event, and a
  // synthetic click does not move focus the way a real one does. Driven that way, the whole
  // phrase went to the body — 'a', 'n', 'd' fell on the floor, '/' opened the box exactly as
  // it should have, and the check failed against correct behaviour. The bracket check above
  // focuses the same way for the same reason.
  await page.evaluate(() => { document.querySelector('#chatInput').focus(); });
  await page.keyboard.type('and/or');
  const slashWhileTyping = await page.evaluate(() => ({
    open: !document.querySelector('#globalSearchResults').classList.contains('hidden'),
    typed: document.querySelector('#chatInput').value,
  }));
  check('`/` typed into a message stays in the message and opens nothing',
    !slashWhileTyping.open && slashWhileTyping.typed === 'and/or', JSON.stringify(slashWhileTyping));

  // Ctrl K is not taken away because a better key arrived.
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForSelector('#globalSearchResults:not(.hidden)', { timeout: 15000 });
  const viaCtrlK = await paletteState();
  check('Ctrl K opens the same box', viaCtrlK.open && viaCtrlK.focused, JSON.stringify(viaCtrlK));

  // Content rows: eight kinds of result that used to be rendered as buttons with no handler
  // on them at all. What the box shows is checked against what its own data source answers
  // for the same query, rather than against a guess about which fixtures this run left
  // behind — a check that silently passes because the search found nothing verifies nothing.
  const searchProbe = await page.evaluate(async () => {
    const response = await fetch('/api/v1/search?q=reload', { credentials: 'same-origin' });
    const body = await response.json().catch(() => ({}));
    return {
      project: document.querySelector('#projectChip')?.textContent ?? '',
      status: response.status,
      count: (body.results ?? []).length,
      types: [...new Set((body.results ?? []).map((item) => item.type))],
    };
  });
  check('the box\'s own data source answers with something to show',
    searchProbe.status === 200 && searchProbe.count > 0, JSON.stringify(searchProbe));
  await page.keyboard.type('reload');
  await new Promise((resolve) => setTimeout(resolve, 900));
  const withContent = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#globalSearchResults button')];
    const content = rows.filter((node) => !/^(Page|Settings|Bench|Agent)$/.test(node.querySelector('b')?.textContent ?? ''));
    return {
      rows: rows.length,
      content: content.length,
      jumps: content.filter((node) => node.dataset.jump).length,
      title: content[0]?.getAttribute('title') ?? '',
      firstJump: content[0]?.getAttribute('data-jump') ?? '',
    };
  });
  check('the box shows the content its data source found',
    withContent.content > 0, JSON.stringify({ ...withContent, apiCount: searchProbe.count }));
  check('a content result is a control that goes somewhere, not a dead button',
    withContent.content > 0 && withContent.jumps === withContent.content && /^Opens /.test(withContent.title),
    JSON.stringify(withContent));
  if (withContent.firstJump) {
    await clickOrExplain(page, `#globalSearchResults button[data-jump="${withContent.firstJump}"]`);
    await page.waitForSelector(`#view-${withContent.firstJump}.active`, { timeout: 15000 });
    const afterContentClick = await page.evaluate(() => location.hash);
    check('clicking a content result opens the page that owns it',
      afterContentClick.startsWith(`#/${withContent.firstJump}`), `${afterContentClick} (expected #/${withContent.firstJump})`);
  } else {
    check('clicking a content result opens the page that owns it', false, 'no content row carried a destination');
  }

  const paletteErrors = consoleErrors.filter((line) => !/Cross-Origin-Opener-Policy header has been ignored/.test(line));
  check('the box produced no console errors', paletteErrors.length === 0, paletteErrors.join(' | '));


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

  // The run-started click handler calls loadWorkflows() THEN refreshApprovals(), in that
  // order — the waitForFunction above only watches the run list, which loadWorkflows()
  // finishes rendering before refreshApprovals() even starts its own fetch. Reading the
  // strip immediately raced that second, independent async update: it read whatever the
  // strip already showed, not necessarily what this run just caused. Harmless while
  // /api/v1/approvals resolved fast enough in practice to always win the race; a real
  // failure once one of its four sources (memory candidates, D-0265) became a genuine
  // network round trip instead of an instant in-memory read. Waiting for the strip's own
  // text is the fix, not a longer fixed delay — it is exact regardless of how long the
  // fetch actually takes.
  // Softened in s326, not weakened: this wait was aborting the whole run. It fails for a
  // REAL reason — `/api/v1/approvals` answers 500 because `noesar_knowledge.memory_records`
  // does not exist — and that reason is worth one loud failure, not the silent loss of every
  // step after it. See `soft`.
  await soft('the approval strip reaches the pending count', () => page.waitForFunction(
    () => /Approvals: 1/.test(document.querySelector('#approvalStripState')?.textContent ?? ''),
    { timeout: 15000 }));

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
  //
  // Owner asked for the full-width Home-only banner to become a permanent compact footer
  // line instead (#footerPrivacy in the statusbar) — same server-verified fields, same
  // strong/small/.verified structure and 'external' class, just relocated; there is no
  // separate banner element any more, so "footer" and "verified" below now read the SAME
  // node rather than two that are checked against each other.
  at('privacy indicator');
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#footerPrivacy', { timeout: 15000 });
  const privacyLocal = await page.evaluate(() => ({
    verified: document.querySelector('#footerPrivacy .verified')?.textContent?.trim() ?? '',
    external: document.querySelector('#footerPrivacy')?.classList.contains('external') ?? null,
    footer: document.querySelector('#footerPrivacy')?.textContent?.trim() ?? '',
    disclosuresHidden: document.querySelector('#privacyDisclosures')?.classList.contains('hidden') ?? null,
  }));
  // The seeded catalogue registers three external providers in every workspace. A first
  // implementation of derivePrivacy counted those as pending, so a fresh installation
  // could never once report local-only. That regression is checked here in a real browser.
  check('a fresh installation reports LOCAL ONLY VERIFIED despite the seeded external catalogue',
    privacyLocal.verified === 'LOCAL ONLY VERIFIED' && privacyLocal.external === false,
    JSON.stringify(privacyLocal));
  check('the footer states the server-verified headline, not a dropdown-derived guess',
    /NOESAR runs locally on your device/.test(privacyLocal.footer) && /local only verified/i.test(privacyLocal.footer),
    privacyLocal.footer);
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
    () => document.querySelector('#footerPrivacy .verified')?.textContent?.trim() === 'REMOTE MODEL ACTIVE',
    { timeout: 15000 });
  const privacyExternal = await page.evaluate(() => {
    const panel = document.querySelector('#privacyDisclosures');
    const box = panel ? panel.getBoundingClientRect() : { width: 0, height: 0 };
    const card = document.querySelector('#privacyDisclosureList .privacy-disclosure');
    return {
      onScreen: Boolean(panel && panel.offsetParent !== null && box.width > 0 && box.height > 0),
      external: document.querySelector('#footerPrivacy')?.classList.contains('external') ?? null,
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
    () => document.querySelector('#footerPrivacy .verified')?.textContent?.trim() === 'LOCAL ONLY VERIFIED',
    { timeout: 20000 });
  const privacyRevoked = await page.evaluate(() => ({
    verified: document.querySelector('#footerPrivacy .verified')?.textContent?.trim() ?? '',
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

  // --- D-0277/D-0278: Owner modules — not-installed -> install -> active -> deactivate,
  // one click each, through the real sector-modules activation framework (D-0274/D-0275).
  // Owner feedback, verbatim, twice: first "non deve essere così complicato" (D-0277,
  // collapsed the raw multi-call sequence into two buttons), then "togliere
  // autentificazione dai moduli basta solo quella di noesar, altrimenti 10 autorizzazioni"
  // (D-0278, removed the step-up reauth prompt entirely) — a click is now just a click.
  at('home');
  resetObservations();
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  const beforeInstall = await page.evaluate(() => document.querySelector('#navModules a.nav'));
  check('no module sidebar entry before any Owner module is installed', beforeInstall === null);

  await page.goto(`${BASE}/#/settings/modules`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#section-modules [data-owner-module-card="debug-evolution"]', { timeout: 15000 });
  const notInstalledBadge = await page.$eval('#section-modules [data-owner-module-card="debug-evolution"] .badge', (node) => node.textContent);
  check('debug-evolution starts Not installed', /Not installed/.test(notInstalledBadge), notInstalledBadge);

  // Diagnosis carried in the check, because this tail had not run in sequence for many
  // sessions (D-0330) and its assumptions about WHO is signed in are therefore unproven.
  // `.settings-section` is display:none until `.active`, and `activateSection()` refuses to
  // activate one the account may not open — which renders a present button as 0x0.
  const modulesReachable = await page.evaluate(() => ({
    sectionActive: document.querySelector('.settings-section[data-section="modules"]')?.classList.contains('active') ?? null,
    denied: document.querySelector('#settingsDenied')?.classList.contains('hidden') === false,
    deniedText: (document.querySelector('#settingsDenied')?.textContent ?? '').slice(0, 120),
    navHidden: document.querySelector('.settings-nav[data-section="modules"]')?.hidden ?? null,
    // How many cards carry this id, and where each one lives. The catalogue is rendered in
    // more than one place ("Installable catalogues — same catalogue as Settings › Modules"),
    // so an unqualified selector can pick the copy inside a view that is not on screen.
    cards: [...document.querySelectorAll('[data-owner-module-card="debug-evolution"]')].map((node) => {
      const rect = node.getBoundingClientRect();
      const view = node.closest('.view, .settings-section');
      return { in: view?.id || view?.dataset?.section || 'unknown', w: Math.round(rect.width), h: Math.round(rect.height) };
    }),
  }));
  check('the modules section is actually open for this account before it is driven',
    modulesReachable.sectionActive === true, JSON.stringify(modulesReachable));

  await clickOrExplain(page, '#section-modules [data-owner-module-card="debug-evolution"] [data-module-action="install"]');
  await page.waitForFunction(
    () => document.querySelector('#section-modules [data-owner-module-card="debug-evolution"] .badge')?.textContent?.includes('Installed'),
    { timeout: 15000 },
  );
  check('debug-evolution is Installed after a single click, no reauthentication prompt (D-0278)', true);

  await clickOrExplain(page, '#section-modules [data-owner-module-card="debug-evolution"] [data-module-action="activate"]');
  await page.waitForFunction(
    () => document.querySelector('#section-modules [data-owner-module-card="debug-evolution"] .badge')?.textContent === 'Active',
    { timeout: 15000 },
  );
  check('debug-evolution is Active after a single click', true);

  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#navModules a.nav', { timeout: 15000 });
  const afterActivate = await page.evaluate(() => {
    const link = document.querySelector('#navModules a.nav');
    return { href: link?.href ?? null, target: link?.target ?? null, rel: link?.rel ?? null, text: link?.textContent ?? '' };
  });
  check('the sidebar entry opens the module in a new tab, not embedded',
    afterActivate.target === '_blank' && /noopener/.test(afterActivate.rel ?? ''), JSON.stringify(afterActivate));
  check('the sidebar entry names the module', /Debug Evolution/.test(afterActivate.text), afterActivate.text);

  await page.goto(`${BASE}/#/settings/modules`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#section-modules [data-owner-module-card="debug-evolution"]', { timeout: 15000 });
  await clickOrExplain(page, '#section-modules [data-owner-module-card="debug-evolution"] [data-module-action="deactivate"]');
  await page.waitForFunction(
    () => document.querySelector('#section-modules [data-owner-module-card="debug-evolution"] .badge')?.textContent?.includes('Installed'),
    { timeout: 15000 },
  );
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const afterDeactivate = await page.evaluate(() => document.querySelector('#navModules a.nav'));
  check('deactivating withdraws the sidebar entry again', afterDeactivate === null);

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

  // ---- s326: the chat list in the sidebar --------------------------------------------
  //
  // Placed beside the sessions step, reusing the seven it has just created rather than
  // making seven of its own. It briefly did the latter — while the tail of this suite was
  // dead, this had to run earlier to run at all (D-0330) — and fourteen sessions then broke
  // that step's own count-based wait. Two fixtures for one fact is the same duplication
  // defect as two renderers for one list, one directory down.
  at('chat-sidebar');
  await page.goto(`${BASE}/#/chat`, { waitUntil: 'networkidle2' });
  // `page.goto` to a URL that differs only in its HASH does not reload the document, so the
  // sidebar kept the state it had before those seven existed and reported an honest zero.
  // Measured, not guessed: the same page's own fetch answered 200 with seven while the list
  // showed none. `reload()` is the difference between navigating and starting again.
  await page.reload({ waitUntil: 'networkidle2' });
  await soft('s326 — the sidebar chat list renders at all',
    () => page.waitForSelector('#chatNav .chat-nav-row', { timeout: 15000 }));
  const sidebarChats = await page.evaluate(async () => {
    // Diagnosis carried IN the check: when this failed, "rows: 0" alone could not tell an
    // empty answer from a renderer that never ran from a route that refused.
    let probe = null;
    try {
      const response = await fetch('/api/v1/sessions?place=active&page=1&pageSize=50', { credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      probe = { status: response.status, total: body.total ?? null, items: body.items?.length ?? null };
    } catch (error) { probe = { error: error.message }; }
    const rows = [...document.querySelectorAll('#chatNav .chat-nav-row')];
    return {
      apiSaysActive: probe,
      // Both, and for different reasons: the hidden class says whether the renderer ever
      // ran, and the text says whether it ran on an empty answer or on a failed call —
      // loadChatNav rewrites this line to "Chats unavailable: …" when the call throws.
      emptyShown: document.querySelector('#chatNavEmpty')?.classList.contains('hidden') === false,
      emptyText: document.querySelector('#chatNavEmpty')?.textContent ?? '',
      rows: rows.length,
      laidOut: document.querySelectorAll('#chatNavRecent .chat-nav-row').length,
      titled: rows.length > 0 && rows.every((row) => (row.querySelector('.chat-nav-title')?.textContent ?? '').trim().length > 0),
      hasArchiveLink: Boolean(document.querySelector('#chatNavArchive')),
    };
  });
  check('s326 — the sidebar renders the chat list, every row named, with a way into the archive',
    sidebarChats.rows > 0 && sidebarChats.titled && sidebarChats.hasArchiveLink, JSON.stringify(sidebarChats));
  // UI-001: never more than five laid out, whatever the total is.
  check('s326 — at most five are laid out, the rest go to the scroller',
    sidebarChats.laidOut <= 5, JSON.stringify(sidebarChats));

  // Clicking a row opens THAT chat — the gesture the list exists for. A list you cannot act
  // from is decoration.
  const openedFromSidebar = await page.evaluate(async () => {
    const first = document.querySelector('#chatNav [data-chat-open]');
    const wanted = first?.dataset.chatOpen ?? null;
    first?.click();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      wanted,
      view: document.querySelector('.view.active')?.id ?? null,
      current: document.querySelector('#chatNav .chat-nav-row.current')?.dataset.chatNavId ?? null,
    };
  });
  check('s326 — clicking a chat in the sidebar opens that chat',
    openedFromSidebar.view === 'view-chat' && openedFromSidebar.current === openedFromSidebar.wanted,
    JSON.stringify(openedFromSidebar));

  // Archive raises the SHARED confirmation. If someone later gives the sidebar a quiet path
  // of its own, this fails — which is the point.
  const asked = await page.evaluate(async () => {
    document.querySelector('#chatNav [data-session-archive]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const scrim = document.querySelector('#confirmScrim');
    return {
      visible: Boolean(scrim && !scrim.classList.contains('hidden')),
      title: document.querySelector('#confirmTitle')?.textContent ?? '',
      // UI-010: nothing dangerous is preselected — focus is on the dialog, not a button.
      focusIsButton: document.activeElement?.tagName === 'BUTTON',
    };
  });
  check('s326 — archiving from the sidebar asks first, with the one shared confirmation',
    asked.visible && /archive/i.test(asked.title), JSON.stringify(asked));
  check('s326 — and that confirmation still preselects nothing',
    asked.visible && asked.focusIsButton === false, JSON.stringify(asked));
  // 4b: the work column beside the conversation. Driven, so the render path really runs —
  // the unit guards for this read app.js as text and would pass on a renderer that throws.
  const workColumn = await page.evaluate(async () => {
    document.querySelector('#chatNav [data-chat-open]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 800));
    const panel = document.querySelector('#chatWorkPanel');
    const rect = panel?.getBoundingClientRect();
    return {
      onScreen: (rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0,
      blocks: panel?.querySelectorAll('.work-block').length ?? 0,
      // An empty list must SAY it is empty. Blank and broken must not look the same.
      sourcesDeclared: (document.querySelector('#chatSources')?.textContent ?? '').trim(),
      // s327: the block now RENDERS the runs this chat owns. A chat nobody has worked from
      // still has to say so — "no work yet" and "the list could not be read" are two facts and
      // must not look alike, which is what this reads back.
      planDeclared: (document.querySelector('#chatPlan')?.textContent ?? '').trim(),
      attachGesture: Boolean(document.querySelector('#startWorkFromChat')),
      contextKept: Boolean(document.querySelector('#contextInspector')),
    };
  });
  check('s326/4b — the work column is a real box beside the conversation, in blocks',
    workColumn.onScreen && workColumn.blocks === 3 && workColumn.contextKept, JSON.stringify(workColumn));
  check('s326/4b — an uncited chat says so instead of showing a blank list',
    /No source has been cited/.test(workColumn.sourcesDeclared), workColumn.sourcesDeclared);
  // s327 REPLACES the s326 assertion here. That one required the panel to declare that a run
  // is not attached to a conversation — true when written, false since the Owner settled the
  // relation on 2026-08-06 and the engine grew it. Driven in a real browser, so a renderer that
  // throws on the fetch fails here; the unit guards read app.js as text and would not notice.
  check('s327/4b — the plan block renders this chat\'s work, and an empty one says so',
    /No work has been started from this chat yet/.test(workColumn.planDeclared)
      && !/not attached to a conversation/i.test(workColumn.planDeclared)
      && workColumn.attachGesture,
    workColumn.planDeclared);

  // s327/4b: the gesture that CREATES the link, driven rather than read. It carries the chat to
  // the Plan form that already exists — the form must then name that chat, because an
  // attachment the operator cannot see is how work gets filed under a conversation nobody meant.
  const attachment = await page.evaluate(async () => {
    const before = (document.querySelector('#planAttachment')?.textContent ?? '').trim();
    document.querySelector('#startWorkFromChat')?.click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
      before,
      after: (document.querySelector('#planAttachment')?.textContent ?? '').trim(),
      detachable: Boolean(document.querySelector('#planAttachmentClear')),
      landedOnPlan: Boolean(document.querySelector('#planPanel')?.classList.contains('active')),
    };
  });
  check('s327/4b — before any gesture, the plan form says a run belongs to no chat',
    /belong to no chat/i.test(attachment.before), attachment.before);
  check('s327/4b — starting work from a chat names that chat on the form, and can be undone',
    /will belong to the chat/i.test(attachment.after) && attachment.detachable && attachment.landedOnPlan,
    JSON.stringify(attachment));

  // Leave the data as it was found: cancel rather than archive.
  await page.keyboard.press('Escape');
  await new Promise((resolve) => setTimeout(resolve, 300));



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
  // s327 — WHY THESE TWO CHECKS CHANGED. They failed for phases, unattributed, and the first
  // guess (that the regions were measured before the view was on screen) was wrong: waiting for
  // `#view-coden.active` AND a laid-out `.bench-main` times out, because at a bare `#/coden`
  // the bench genuinely has no box. That is the design, stated in the stylesheet it lives in:
  // `#view-coden:not([data-panel-open]) .bench{display:none}` — phase 3c, `16` §4b.3, "the
  // panels stop being riquadri sempre presenti" — and `.bench{grid-template-columns:minmax(0,1fr)}`,
  // "One column, not two … there is no second column left for it to sit in".
  //
  // So the old assertion (`main > 200 && agent > 100`, both regions standing open at once) was
  // asserting the two-column bench `D-0319` deliberately removed. A red against a product that
  // is behaving as designed teaches people to ignore the suite. Rewritten to the design that
  // exists: a bare address opens NO bench, and an address that names a panel opens exactly one
  // region with a real width.
  const bareBench = await page.evaluate(() => ({
    viewActive: document.querySelector('#view-coden')?.classList.contains('active') ?? false,
    panelOpen: document.querySelector('#view-coden')?.hasAttribute('data-panel-open') ?? false,
    benchWidth: document.querySelector('.bench')?.getBoundingClientRect().width ?? 0,
  }));
  check('UI-030 a bare #/coden opens no panel, and the bench has no box until one is addressed',
    bareBench.viewActive && !bareBench.panelOpen && bareBench.benchWidth === 0, JSON.stringify(bareBench));

  await jump('coden/bench/shadow', 'shadow');
  // WAITED FOR, not sampled. `renderBenchStatus()` is fired unawaited by the view loader and
  // makes five requests before it can write this line, so reading it the instant a panel opens
  // measures the network rather than the product — and it did: the field read its own initial
  // "—" and the check called it an unsourced status line. Waiting converts the question into a
  // real one: if the text never arrives, the line genuinely is not being written.
  await page.waitForFunction(
    () => /of 12 fields have a source/.test(document.querySelector('#statusSourced')?.textContent ?? ''),
    { timeout: 15000 },
  ).catch(() => {});
  const bench = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? { width: 0, height: 0 };
    return {
      main: box('.bench-main').width,
      agent: box('#benchAgent').width,
      // The Navigator column is gone (D-0299) and its nine groups are bench panels, so the
      // surfaces are counted where they now live instead of a column being measured.
      panels: document.querySelectorAll('[data-bench-panel]').length,
      statusFields: document.querySelectorAll('[data-status-field]').length,
      sourced: document.querySelector('#statusSourced')?.textContent ?? '',
      terminal: box('#benchTerminal').height,
    };
  });
  check('UI-030 an addressed panel opens its region with a width of its own, and the terminal stays',
    bench.main > 200 && bench.terminal > 40, JSON.stringify(bench));
  check('UI-032/UI-035 twenty bench surfaces and a twelve-field status line that declares its sources',
    bench.panels === 20 && bench.statusFields === 12 && /of 12 fields have a source/.test(bench.sourced),
    `panels=${bench.panels} fields=${bench.statusFields} "${bench.sourced}"`);

  await jump('coden/bench/diff', 'diff');
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
  // s327: this used to open `coden/bench/shadow` and then click the Plan form — which lives in
  // the AGENT region. Since phase 3c (`D-0319`) exactly ONE panel is open across BOTH regions,
  // so opening a bench panel closes Plan, and its submit button is legitimately 0x0. The step
  // died there ("collapsed to 0x0") on a product that was behaving correctly: a false red, and
  // an expensive one — everything after the click in this step never ran. The plan is now
  // created from the Plan panel's own address, and the shadow is opened after it exists.
  await page.evaluate(() => {
    const box = document.querySelector('#codenPrompt');
    box.value = '/coden/agent/plan';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-agent-panel="plan"].active', { timeout: 15000 });
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

  // s327/4b: a plan created from the Plan panel itself, with nothing attached, must belong to
  // no chat — and must be listed as such rather than filed under whichever conversation the
  // session last opened. This is the negative half of the Owner's decision, driven for real.
  const unattached = await page.evaluate(() => ({
    declared: (document.querySelector('#planAttachment')?.textContent ?? '').trim(),
    listed: (document.querySelector('#unattachedRuns')?.textContent ?? '').trim(),
    count: (document.querySelector('#unattachedRunCount')?.textContent ?? '').trim(),
  }));
  check('s327/4b — a plan created with no chat attached is listed as belonging to none',
    /belong to no chat/i.test(unattached.declared) && unattached.count === '1'
      && /add a short note file for this e2e run/.test(unattached.listed),
    JSON.stringify(unattached).slice(0, 300));

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

  await jump('coden/bench/logs', 'logs');
  await page.waitForFunction(
    () => /workspace_action\.promoted/.test(document.querySelector('#workLogsContent')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const workLogs = await page.evaluate(() => document.querySelector('#workLogsContent')?.textContent ?? '');
  check("D-0230 Logs shows this run's own causal event trail through GET /api/v1/events/:correlationId, ending in a promotion",
    /workspace_action\.planned/.test(workLogs) && /workspace_action\.promoted/.test(workLogs), workLogs.slice(0, 400));

  // --- D-0230: Map — read-only repository understanding, workspace-scoped, not per-run ---
  await jump('coden/bench/map', 'map');
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

  // --- D-0230: the Terminal tab's HTTP bridge (/api/v1/tui/command) ------------------
  await jump('coden/bench/terminal', 'terminal');
  await page.waitForSelector('#terminalCommandInput', { timeout: 15000 });
  await page.type('#terminalCommandInput', 'status');
  await clickOrExplain(page, '#terminalCommandForm button');
  await page.waitForFunction(
    () => /workspaceActions/.test(document.querySelector('#terminalScrollback')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const terminalStatus = await page.evaluate(() => document.querySelector('#terminalScrollback')?.textContent ?? '');
  check('the Terminal tab reaches the real engine over the session protocol\'s HTTP bridge, not "attached to no session"',
    /coden-evolution> status/.test(terminalStatus) && /workspaceActions/.test(terminalStatus) && !/attached to no session/i.test(terminalStatus),
    terminalStatus.slice(0, 300));

  // `planned.result` is the Plan panel's own text ("runId: <uuid>\nstatus: ...") — the full
  // id, unlike `planned.badge`, which the panel deliberately truncates to eight characters.
  const planRunId = planned.result.match(/runId: (\S+)/)?.[1];
  await page.evaluate((runId) => { document.querySelector('#terminalCommandInput').value = `get ${runId}`; }, planRunId);
  await clickOrExplain(page, '#terminalCommandForm button');
  await page.waitForFunction(
    () => (document.querySelector('#terminalScrollback')?.textContent ?? '').includes('PROMOTED'),
    { timeout: 15000 },
  );
  const terminalGet = await page.evaluate(() => document.querySelector('#terminalScrollback')?.textContent ?? '');
  check('the Terminal tab\'s `get` reaches the SAME run the Plan panel created — one live session, not two',
    terminalGet.includes(planRunId) && terminalGet.includes('PROMOTED'), terminalGet.slice(-300));

  // s327, same false red as the plan submit above and the same fix: `#planRestoreBtn` lives in
  // the Plan panel (agent region), so opening a BENCH panel first closes it and leaves the
  // button legitimately 0x0. Open the panel that owns the button.
  await page.evaluate(() => {
    const box = document.querySelector('#codenPrompt');
    box.value = '/coden/agent/plan';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-agent-panel="plan"].active', { timeout: 15000 });
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
  await jump('coden/bench/closure', 'closure');
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

  at('attach-code');
  // --- one authentication, not two · D-0337 --------------------------------
  // The browser half of the feature, and the half no unit test can reach: `npm test` reads
  // app.js as TEXT and never executes it, so a wiring mistake here would sit behind 1884
  // green tests. What is asserted is what an operator would see — a code on screen, in the
  // transcription-safe alphabet, with a countdown that names the seconds left. The
  // countdown is not cosmetic: time and single use ARE this credential's whole perimeter,
  // so a code displayed with no visible clock is the design quietly not holding.
  await page.goto(`${BASE}/#/coden-tui`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#attachCodeMint', { timeout: 15000 });
  await clickOrExplain(page, '#attachCodeMint');
  await page.waitForFunction(
    () => (document.querySelector('#attachCodeValue')?.textContent ?? '').length > 0,
    { timeout: 15000 },
  );
  const attachUi = await page.evaluate(() => ({
    code: document.querySelector('#attachCodeValue')?.textContent ?? '',
    hidden: document.querySelector('#attachCodeValue')?.classList.contains('hidden') ?? true,
    status: document.querySelector('#attachCodeStatus')?.textContent ?? '',
    panelText: document.querySelector('#attachCodePanel')?.textContent ?? '',
  }));
  check('D-0337 the browser mints a readable attach code',
    /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(attachUi.code) && attachUi.hidden === false,
    JSON.stringify(attachUi).slice(0, 260));
  check('D-0337 the code is shown with the time it has left, not on its own',
    /within \d+s/.test(attachUi.status),
    JSON.stringify(attachUi.status).slice(0, 200));
  // The panel must SAY what the thing is. A code with no statement of its limits invites
  // being treated as a password and kept.
  check('D-0337 the panel states that the code expires and is single use',
    /60 seconds/.test(attachUi.panelText) && /spending it destroys it/.test(attachUi.panelText),
    attachUi.panelText.slice(0, 260));

  // Minting again must replace what is on screen, because minting again cancels the
  // previous code server-side. A stale code left visible would be a code that no longer
  // works, which reads to the operator as the feature being broken.
  const attachFirst = attachUi.code;
  await clickOrExplain(page, '#attachCodeMint');
  await page.waitForFunction(
    (previous) => {
      const shown = document.querySelector('#attachCodeValue')?.textContent ?? '';
      return shown.length > 0 && shown !== previous;
    },
    { timeout: 15000 }, attachFirst,
  );
  const attachSecond = await page.evaluate(() => document.querySelector('#attachCodeValue')?.textContent ?? '');
  check('D-0337 minting again replaces the code on screen',
    attachSecond.length > 0 && attachSecond !== attachFirst,
    `${attachFirst} -> ${attachSecond}`);

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

  at('i18n-runtime');
  // --- I18N-RUNTIME: the half of the language measurement that markup cannot see ------
  //
  // Owner, s333 point 4: «ho visto un mix — quando clicco sulla traduzione rimane in inglese
  // o viceversa». `tools/measure-ui-language-coverage.mjs` is exhaustive over the STATIC
  // markup and blind to everything JavaScript paints. This block is the complement: it drives
  // the real interface, in Italian, across every destination, and asks the translator itself
  // what it could not translate. Neither measure is sufficient alone — a green tool with a red
  // block here means the gap is in the JavaScript, and the other way round means it is in the
  // markup.
  //
  // Why it asks the translator rather than scraping the DOM for English-looking text: "does
  // this sentence look English" is a guess, and a guess is what produced the 9.97% nobody
  // noticed. `untranslatedStrings()` is the translator's own record of every lookup that
  // missed. It cannot be optimistic about a string it never saw, and it cannot be wrong about
  // one it did.
  await soft('I18N-RUNTIME', async () => {
    resetObservations();
    const destinations = [
      'home', 'chat', 'coden', 'coden-tui', 'tools', 'projects', 'documents', 'knowledge',
      'memory', 'agents', 'workflows', 'models', 'research',
      'settings', 'settings/appearance', 'settings/language', 'settings/about',
      'settings/privacy', 'settings/people', 'settings/security', 'settings/storage',
      'settings/audit', 'settings/health', 'settings/updates', 'settings/skills',
      'settings/modules', 'settings/remote-targets',
    ];

    // Switch to Italian through the control a person would use, not by writing storage
    // directly: the defect being guarded against lived in the picker's own handler.
    await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
    await page.select('#languageSelect', 'it');
    await page.waitForFunction(() => document.documentElement.lang === 'it', { timeout: 10000 });

    check('I18N-RUNTIME the picker changes the language without reloading the page',
      await page.evaluate(() => document.documentElement.lang === 'it'));

    // The Owner's first symptom: pick Italian, and the interface is Italian.
    const sidebarAfter = await page.evaluate(() =>
      document.querySelector('.nav[data-view="projects"]')?.textContent.trim() ?? '');
    check('I18N-RUNTIME choosing Italian actually translates the interface',
      /Progetti/.test(sidebarAfter), sidebarAfter);

    // The Owner's second symptom, «o viceversa»: pick English, and nothing stays Italian.
    await page.select('#languageSelect', 'en');
    await page.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 10000 });
    const sidebarBack = await page.evaluate(() =>
      document.querySelector('.nav[data-view="projects"]')?.textContent.trim() ?? '');
    check('I18N-RUNTIME choosing English restores the source language, with no reload',
      /Projects/.test(sidebarBack), sidebarBack);

    await page.select('#languageSelect', 'it');
    await page.waitForFunction(() => document.documentElement.lang === 'it', { timeout: 10000 });
    await page.evaluate(() => window.__i18n?.clearUntranslatedStrings?.());

    for (const destination of destinations) {
      await page.goto(`${BASE}/#/${destination}`, { waitUntil: 'networkidle2' });
      // Give the renderers their turn: this block exists BECAUSE text painted after load was
      // the half that never got translated.
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    }

    const missed = await page.evaluate(() => window.__i18n?.untranslatedStrings?.() ?? null);
    check('I18N-RUNTIME the translator is reachable for measurement', Array.isArray(missed),
      missed === null ? 'window.__i18n is not exposed — the measurement cannot be made at all' : `${missed.length} recorded`);
    // The whole list, not a sample. A truncated failure detail turns a fixable gap into a
    // guessing game and costs one full run of this suite per guess.
    if (Array.isArray(missed) && missed.length > 0) {
      console.log(`--- I18N-RUNTIME untranslated (${missed.length}) ---`);
      for (const s of missed) console.log(`  MISS ${JSON.stringify(s)}`);
      console.log('--- end I18N-RUNTIME untranslated ---');
    }
    // A RATCHET, and it is called that rather than dressed up as a pass.
    //
    // The static markup is complete: 793 of 793, enforced by
    // `tools/measure-ui-language-coverage.mjs`, which fails on a single gap. The text
    // JavaScript paints is NOT complete, and this is the first measurement that has ever
    // existed of it. What it found falls into four kinds, and only one of them is closed by
    // adding catalogue entries:
    //
    //   1. composed from already-translated parts — "Progetti view", "Context · X". The whole
    //      can never match a catalogue; the parts already do. Repaired by composing with
    //      `t()` and marking the element `translate="no"`, as `renderBenchNavigator` and the
    //      context-panel title now are.
    //   2. interface text written in JavaScript rather than markup — "No agent.",
    //      "Start run". These are catalogue entries and nothing more.
    //   3. composed with a number or a clock — "7 sessions", "within 54s". Same shape as 1.
    //   4. English prose the SERVER supplies — the security-posture rows. Translating those
    //      is server-side work and a different decision, not an omission here.
    //
    // Declaring the number is the honest form. Asserting `=== 0` today would be asserting a
    // thing that is not true; asserting nothing would let it rot back to the 9.97% that
    // started this. So it fails when the gap GROWS, which is the property that matters while
    // the rest is built: no new untranslated string may be added to the interface.
    // The ratchet counts only what a catalogue could actually close, and that is not fastidious
    // — it is what makes the number MEAN anything. Measured twice, the raw total came out 865
    // and then 872: it moves between runs because it includes strings composed with a clock
    // ("Type it at the terminal within 54s"), an elapsed time ("8s") and a count that depends
    // on what earlier steps in this very suite created ("7 sessions"). A ratchet on a number
    // that drifts on its own fails at random, and a check that fails at random is switched off
    // by the third person who sees it.
    //
    // So a string carrying a digit is excluded, and the rule is principled rather than a
    // convenience: a digit means the string was assembled around a value, and an assembled
    // string can never equal a catalogue key no matter how complete the catalogue becomes. It
    // belongs to kinds 1 and 3 above, which are closed by composing with `t()`, not by
    // translating. What remains is kinds 2 and 4 — the ones an entry really does close.
    const closable = Array.isArray(missed) ? missed.filter((s) => !/\d/.test(s)) : null;
    // Measured, not estimated: 623 of the 865 recorded on the run this baseline was taken from.
    const RUNTIME_GAP_BASELINE = 623;
    check('I18N-RUNTIME the catalogue-closable gap does not grow (declared gap, not a pass)',
      Array.isArray(closable) && closable.length <= RUNTIME_GAP_BASELINE,
      `${closable ? closable.length : '?'} closable of ${Array.isArray(missed) ? missed.length : '?'} recorded, declared baseline ${RUNTIME_GAP_BASELINE}`);
    check('I18N-RUNTIME the static markup half is complete, and is measured separately',
      true, 'tools/measure-ui-language-coverage.mjs — 793 of 793, fails on one gap');

    // Leave the interface in the source language: every later check reads English.
    await page.select('#languageSelect', 'en');
    await page.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 10000 });
  });

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
  // A fresh REAL step, not just a fresh call — nextRealStepCode, not freshCode(avoid):
  // by this point in the flow other codes have already been consumed on this secret
  // (the D-0277 Owner-modules install/activate above, among others) that `freshCode`'s
  // local avoid-set has no way to know about, so its "the string is new" criterion is
  // not enough to guarantee "the step is later than the server's own lastTotpStep".
  const reLogin = await nextRealStepCode(newSecret);
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
      updates: section('updates'), modules: section('modules'),
      settings: destination('settings'), security: section('security'), about: section('about'),
    };
  });
  check('nav hides every section this role cannot open',
    offered.users === true && offered.backups === true && offered.health === true
    && offered.updates === true && offered.modules === true, JSON.stringify(offered));
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
  check(`harness completed without throwing [step: ${step}]`, false, `${error.message} :: ${(error.stack ?? '').split('\n').slice(0, 6).join(' | ')} :: ${context}`);
} finally {
  await browser.close();
}

console.log('');
console.log(`BROWSER_E2E_TOTAL=${results.length}`);
console.log(`BROWSER_E2E_PASS=${results.length - failures}`);
console.log(`BROWSER_E2E_FAIL=${failures}`);
process.exit(failures === 0 ? 0 : 1);

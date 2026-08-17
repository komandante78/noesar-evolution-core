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
let declaredFailures = 0;
/**
 * One check, and — where it applies — the finding that already owns its failure.
 *
 * `options.declaredGap` names a finding id for a check that is KNOWN red and tracked, the
 * `F-I18N-002` catalogue ratchet being the only one today. It changes nothing about the
 * verdict: the line still prints FAIL, the check still counts as a failure, and the process
 * still exits non-zero. What it adds is the distinction between the two questions this file
 * used to answer with one boolean — "should the suite go red?" (yes, both cases) and "is
 * there anything here worth diagnosing?" (no, for a gap whose state is already written down).
 *
 * `F-E2EDISK-001` is what the missing distinction cost: the runner deletes a run's workspace
 * when the run passed and keeps it when it failed, and a permanently-declared gap held the
 * exit code at 1 forever — so the keep branch fired on every run and the delete branch never
 * fired at all. 151 directories, 7.3 GB. The counter below is what the runner now reads.
 *
 * Marked at the CALL SITE, deliberately, never matched against a list of names kept in a
 * second file: a list like that goes stale in silence the first time a check is renamed.
 */
function check(name, ok, detail = '', options = {}) {
  const declaredGap = options.declaredGap ?? null;
  results.push({ name, ok, detail, declaredGap });
  if (!ok) {
    failures += 1;
    if (declaredGap) declaredFailures += 1;
  }
  const gapNote = declaredGap && !ok ? `  [declared gap ${declaredGap}]` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${gapNote}${detail ? `  — ${detail}` : ''}`);
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

/**
 * Drive `#codenPrompt` to an address and submit it — set the value, wait for the box to
 * actually have a rendered size, then focus and press Enter.
 *
 * F-COMMAND-001 / F-PANEL-001 (2026-08-14, D-0449) — ROOT CAUSE FOUND, 2026-08-15, and it is
 * neither finding's original guess. Not a matching bug (the address was always present in
 * `#codenMenu`'s own DOM). Not a synthetic-event-vs-CDP gap (Puppeteer's own `page.focus()`
 * made no difference, and a 3s poll for a nonzero rect never recovered — ruling out a
 * transient render race, D-0448's class of fix, before it was blamed).
 *
 * The real cause, read off a full ancestor-chain dump the first four attempts did not
 * capture: `section#codenShell.agent-shell.hidden{display:none}`. `#codenShell` is the
 * LEGACY prompt/transcript/menu stack — `codenTerminalState()` (app.js, ~line 5943) hides it
 * the moment the modern xterm.js terminal reaches `state==='live'`, on explicit Owner
 * instruction (2026-08-13): "`#/coden` shows ONE chat... not stacked". That handshake is
 * async and unrelated to anything this test does; it can complete at any point after the
 * terminal iframe attaches, including mid-phase-3c, after this exact composer was already
 * used successfully earlier in the SAME test run (the click and the real typing above both
 * happened before the terminal went live).
 *
 * Repaired at the source, not worked around here: `codenTerminalState()` (app.js) used to
 * hide `#codenShell` unconditionally the instant the terminal went live, mid-keystroke if
 * that is when the handshake landed — real for a person too, not just this driver; typed
 * words vanishing under a surface change nobody asked for. It now defers the hide while the
 * box is focused or holds unsent text (`legacyPromptBusy`), and retries once the person is
 * done (submit, empty the box, or blur). Measured: before the app.js fix, the phase-3c
 * occurrence failed 5/5 runs; after, 1/1 clean, and the workspace-actions step's FIRST
 * occurrence (plan creation) also went clean.
 *
 * One occurrence remains, and a retry does not reach it: the workspace-actions step's SECOND
 * occurrence (plan-restore) fails even after 3 attempts spanning 3s, because by then the
 * terminal is not mid-handshake — it has been live and STEADY for many prior steps (the check
 * immediately before this one drives the terminal's own `#terminalCommandInput`). That is
 * `codenTerminalState()` doing exactly what `D-0413` asked: once the modern terminal is
 * genuinely, lastingly live, the legacy composer stays retired, by design. A retry cannot fix
 * a steady state, only a race — this is the test still reaching for a surface the product has
 * moved past. The real fix is this test learning to drive the address through whichever
 * surface (`#codenPrompt` or the live terminal's own `/` menu, same shared vocabulary) is
 * actually current, left for the Owner as the test-strategy decision named in D-0456.
 */
async function submitCodenAddress(page, address, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.evaluate((value) => {
      const box = document.querySelector('#codenPrompt');
      box.value = value;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }, address);
    const settled = await page.evaluate(() => new Promise((resolve) => {
      const box = document.querySelector('#codenPrompt');
      const deadline = Date.now() + 1000;
      const poll = () => {
        if (box.getBoundingClientRect().height > 0) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        requestAnimationFrame(poll);
      };
      poll();
    }));
    if (settled) {
      await page.focus('#codenPrompt');
      await page.keyboard.press('Enter');
      return;
    }
    if (attempt === attempts) {
      // Walk the ancestor chain so a genuine regression (not just a slow retry) names its
      // own cause instead of an opaque downstream timeout.
      const chain = await page.evaluate(() => {
        const trail = [];
        let node = document.querySelector('#codenPrompt');
        while (node && node !== document.documentElement) {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          trail.push(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${[...node.classList].map((c) => `.${c}`).join('')}: ${rect.width}x${rect.height} display=${style.display} visibility=${style.visibility}`);
          node = node.parentElement;
        }
        return trail;
      });
      throw new Error(`#codenPrompt: still collapsed to 0 height after ${attempts} attempts :: ancestor chain: ${chain.join(' | ')}`);
    }
  }
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
/** The one known, open, MEASURED defect that would otherwise show up as a failure in every
 *  generic "no console errors" row on every route that mounts the terminal — `D-0418`: xterm.js
 *  styles itself with inline styles and injected <style> elements, and `style-src 'self'`
 *  refuses them. It is not filtered away: the `coden-terminal` step asserts it directly, and
 *  that row is RED until the Owner decides how the emulator is allowed to paint. What the
 *  separation buys is that one defect reads as one failure instead of four, so the day a
 *  SECOND console error appears on those routes it is still visible. Removed the moment
 *  `D-0418` closes — a filter that outlives its finding is how a suite stops looking. */
const CSP_INLINE_STYLE = /Applying inline style violates/;
const cspStyleRefusals = [];
const failedRequests = [];
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if (CSP_INLINE_STYLE.test(message.text())) { cspStyleRefusals.push(message.text()); return; }
  consoleErrors.push(message.text());
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

// Every request the page makes, not only the ones that failed. A defect can be an ABSENCE:
// the voice failure repaired in s340 was a request the product stopped making after sign-in,
// and a recorder that only keeps failures cannot see a call that was never attempted.
const requestLog = [];
page.on('request', (request) => { requestLog.push(`${request.method()} ${request.url()}`); });
function requestWasMade(pathFragment) {
  return requestLog.some((entry) => entry.includes(pathFragment));
}

/**
 * Leave CodeN, and wait for the embedded terminal document to be GONE, before any step that
 * navigates with `waitUntil: 'networkidle2'`.
 *
 * This is a harness obligation, not a product defect, and the distinction is worth writing down
 * so nobody "fixes" the product for it: an attached terminal holds a WebSocket open, a hash
 * navigation does not reload the document, and Puppeteer's idle wait then sits behind a
 * connection that is never going to close. A person navigating with a terminal open notices
 * nothing — there is nothing to notice. Measured in run 6, where one such wait timed out inside
 * the harness's single `try` and cost 205 later checks.
 */
/**
 * Navigate and wait for the network to settle — with the embedded terminal detached FIRST.
 *
 * Every idle-waiting navigation in this file goes through here, because the hazard is not
 * specific to any one step: the terminal WebSocket is opened by a document inside an iframe,
 * and when that iframe is torn down by a navigation the request never reports finished. The
 * idle counter then never returns to its threshold and the wait times out. Measured across
 * runs 5-8: it killed 226 checks, then 205, then two whole steps, each time somewhere else —
 * `#/tools` redirects to `#/coden`, which is how a loop over six unrelated destinations ended
 * up attached to a terminal.
 *
 * The product is not at fault and must not be changed for this: a person navigating away from
 * an open terminal sees a socket close, not a hung page. What is repaired is the harness
 * assumption that network idle is always reachable.
 */
async function gotoIdle(url) {
  await leaveCodenTerminal();
  return page.goto(url, { waitUntil: 'networkidle2' });
}

async function leaveCodenTerminal() {
  if (!(await page.$('#codenTerminalHost iframe'))) return;
  await page.evaluate(() => { window.location.hash = '#/home'; });
  await page.waitForFunction(
    () => document.querySelectorAll('#codenTerminalHost iframe').length === 0,
    { timeout: 15000 },
  );
}

function resetObservations() {
  consoleErrors.length = 0;
  failedRequests.length = 0;
  requestLog.length = 0;
}

// Which block is running. A bare "Waiting failed: 15000ms exceeded" names neither the
// step nor the state it was in, which is a diagnostic dead end — the same reason the
// product now reports a correlation ID instead of a stack trace.
let step = 'start';
function at(name) { step = name; }

/**
 * The browser session's Owner-elevation state, read from the product's own endpoint.
 *
 * `GET /api/v1/auth/me` returns `elevatedUntil` (`server.mjs:1519`); a fresh session carries
 * `0` (`auth.mjs:567`, and elevation is deliberately never inherited across login, invitation
 * or recovery — three separate comments in that file say so), and `reauthenticate()` sets
 * `Date.now() + 5 * 60_000` (`auth.mjs:913`). The predicate below is `Number(x ?? 0) > now` —
 * copied from `auth.mjs:1060`, where the product answers this same question for its own session
 * listing, rather than invented here. A third answer to a question the product already answers
 * is the exact class of drift `CE-033` names.
 *
 * Read through the PAGE, not Node's `fetch`: the elevation being asserted belongs to the
 * browser's cookie-bearing session, and a Node fetch carries no cookies — it would report a
 * different session's state and always look unelevated, which is a check that can never fail.
 */
async function sessionElevation() {
  return page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/me', { headers: { accept: 'application/json' } });
    if (!response.ok) return { readable: false, status: response.status, elevatedUntil: null, elevated: false };
    const payload = await response.json();
    const elevatedUntil = Number(payload.elevatedUntil ?? 0);
    return { readable: true, status: response.status, elevatedUntil, elevated: elevatedUntil > Date.now() };
  });
}

/**
 * Guard a block whose assertions are only meaningful on an UNELEVATED session.
 *
 * Two blocks in this file prove a security gate by watching it REFUSE first — `updates`
 * (`#applyUpdate`) and `authority-form` (`#authorizePlan`), both gated on
 * `session.elevatedUntil < Date.now()` (`server.mjs:4209` and the `coden/authorize` route).
 * Their determinism rests entirely on running BEFORE `authority-form` calls
 * `/api/v1/auth/reauth`, which elevates the session for five minutes.
 *
 * That was a silent ordering dependency between two blocks ~700 lines apart, held together by a
 * comment at each site and nothing else: reorder them and the refusals stop happening, the
 * `waitForFunction` calls time out, and the failure names a timeout rather than its cause.
 * `D-0498`'s improvement proposal, authorised by the Owner — this turns the assumption into an
 * assertion that fails locally, first, and says exactly what went wrong.
 *
 * `readable` is asserted too, not just `!elevated`: an endpoint that answered 401 would return
 * `elevated:false` and quietly satisfy a naive guard, which is the "clean scan proves the
 * scanner found nothing" failure mode written into this project's own rules.
 */
async function checkSessionNotElevated(blockName) {
  const elevation = await sessionElevation();
  check(`ordering guard: the session is not elevated when \`${blockName}\` begins`,
    elevation.readable && !elevation.elevated,
    JSON.stringify(elevation));
}

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
/**
 * How many `check(...)` call sites are written inside a block's own source.
 *
 * DERIVED from the function's text, never a number kept by hand next to the block: a
 * hand-kept count is the `PANEL_NAMES` failure this project has already paid for twice — a
 * list compared only with itself always agrees. `Function.prototype.toString()` gives the
 * real source, so the count cannot drift from the code it describes.
 *
 * Comments are stripped first, because this file's blocks carry long explanatory comments and
 * several of them mention `check()` in prose — counting those would inflate the number and
 * make the accounting below lie in the safe direction, which is still a lie. The stripping is
 * lexical and deliberately simple (no parser): the `[^:]` guard keeps `https://` from being
 * read as a line comment.
 *
 * `\bcheck\s*\(` does not match `checkSessionNotElevated(` — the `(` must follow `check`
 * immediately — so the guard helper added in `D-0499` is correctly not counted as a call site
 * of its own, even though it calls `check` internally (which IS counted, at its own site).
 */
function checkCallSites(run) {
  const source = String(run)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return (source.match(/\bcheck\s*\(/g) ?? []).length;
}

async function soft(name, run) {
  // Measured against `results`, the same array `check` appends to — so "reached" is what the
  // block actually asserted, not what it was expected to.
  const before = results.length;
  const callSites = checkCallSites(run);
  try {
    await run();
    return true;
  } catch (error) {
    // WHY this accounting exists (`D-0499`'s improvement proposal, authorised by the Owner):
    // this function swallows a throw so the rest of the product still gets tested — but every
    // assertion after the throw then silently never runs, and the suite TOTAL shrinks without
    // saying so. That is not hypothetical: five real `POINT-2B` assertions stayed invisible
    // across at least two runs for exactly this reason, and when a later change happened to get
    // execution past the throw, their sudden appearance read as a regression in the raw counts
    // when it was the opposite — an already-open defect becoming visible.
    //
    // A suite whose total silently depends on where an exception landed is the same class of
    // problem this function was built to fix in the first place: "a suite that stops early while
    // reporting a plausible number is worse than one that fails loudly."
    //
    // Stated as CALL SITES, not as assertions, and the distinction is load-bearing: a call site
    // inside a loop runs many times, one behind a conditional may legitimately never run. So
    // `reached` can exceed `callSites`, which is why the difference is clamped at zero and never
    // reported as a negative or as a precise count of "missing tests".
    const reached = results.length - before;
    const unreached = Math.max(0, callSites - reached);
    const accounting = callSites === 0 ? ''
      : ` — ${reached}/${callSites} \`check\` call sites in this block ran${unreached ? `, ${unreached} never reached` : ''}`;
    check(name, false, `${error.message} [step: ${step}]${accounting} — recorded, and the run continues`);
    return false;
  }
}

// --- driving the embedded terminal ------------------------------------------------------
//
// At FILE scope since `D-0501`, and the reason is `F-SLASH-001`: these four were block-scoped
// inside the `coden-terminal` step, which is why the `coden-slash-feedback` step ~2,600 lines
// below could only ever drive the LEGACY composer — and that composer is retired by design the
// moment the terminal reaches `live` (`D-0413`), so the step was reaching for a surface a person
// never sees on a fresh `#/coden` load. The finding's own record named this hoist as the
// prerequisite for repairing it. Moved verbatim; no behaviour was changed in the move.

const terminalFrame = () => page.frames().find((frame) => frame.url().includes('coden-terminal.html')) ?? null;

/** `textContent`, not `innerText`: `innerText` returns only what is visibly laid out, and
 *  xterm's rows are painted into a subtree whose layout the harness has no reason to trust
 *  when the question is "did the shared renderer produce this frame". */
const screenText = async () => {
  const frame = terminalFrame();
  if (!frame) return '';
  // `.xterm-rows` and NOT the whole host: the host's `textContent` also carries xterm's
  // injected <style> element and its screen-reader live region, and the stylesheet alone is
  // hundreds of characters that pushed the actual screen out of every truncated diagnostic
  // — the first version of this helper reported CSS where it meant to report the frame.
  return frame.evaluate(() => {
    const rows = document.querySelector('#terminalHost .xterm-rows');
    const live = document.querySelector('#terminalHost .live-region');
    return `${rows?.textContent ?? ''}\n${live?.textContent ?? ''}`;
  });
};

/** What the prompt row currently holds — the only honest way to ask "did that keystroke
 *  arrive". The renderer draws the prompt as `> <text>▍` inside the box, so a keystroke that
 *  reached `onData` is visible there and one that did not is not. */
const promptRow = async () => {
  const text = await screenText();
  const match = text.match(/>\s*([^│\n]*)▍/);
  return (match ? match[1] : '').trim();
};

/** Type, and REPORT WHICH INPUT PATH the emulator actually accepted.
 *
 * Typing into an emulator that lives in a SUBFRAME needs the browser's focus to be in that
 * frame, not merely on an element inside it: `element.focus()` from `frame.evaluate` moves the
 * frame's own active element and leaves the top document holding the keyboard, so the keystrokes
 * land on the page instead. Measured — runs 3, 4 and 5 all typed into nothing. Clicking the
 * frame is what actually hands the keyboard over, and it is also what a person does.
 *
 * Three paths are tried in order of realism, and the one that worked is carried in
 * `lastInputPath` so the checks below can say so rather than quietly passing on whichever
 * one happened to land:
 *
 *   1. `keyboard.sendCharacter` — CDP `Input.insertText`, the path a real keypress and an
 *      IME both end on, and the one xterm.js reads for printable characters;
 *   2. `keyboard.type` — synthesised keydown/keypress/keyup;
 *   3. a real `InputEvent` dispatched on xterm's own helper textarea, inside the frame.
 *
 * Path 3 is NOT a pass. It proves the emulator's wiring is intact while saying that nothing
 * the browser's own input pipeline produced ever got there — which is a finding about the
 * harness or about the surface, and either way is reported, never hidden. Runs 5-11 all
 * failed at paths 1 and 2 with the frame focused and the caret in the textarea, and this is
 * what distinguishes "the product ignores typing" from "the driver cannot type into it".
 */
let lastInputPath = 'none';
const typeIntoTerminal = async (text) => {
  const frame = terminalFrame();
  if (!frame) throw new Error('the terminal document is not embedded');
  const before = await promptRow();
  const changed = async () => (await promptRow()) !== before;

  await page.click('#codenTerminalHost iframe.coden-terminal-embed');
  await frame.focus('#terminalHost .xterm-helper-textarea');
  for (const character of text) await page.keyboard.sendCharacter(character);
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (await changed()) { lastInputPath = 'insertText'; return; }

  await page.keyboard.type(text);
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (await changed()) { lastInputPath = 'keydown'; return; }

  await frame.evaluate((typed) => {
    const textarea = document.querySelector('#terminalHost .xterm-helper-textarea');
    if (!textarea) return;
    textarea.value = typed;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: typed, inputType: 'insertText' }));
  }, text);
  await new Promise((resolve) => setTimeout(resolve, 250));
  lastInputPath = (await changed()) ? 'synthetic-input-event' : 'nothing-reached-the-emulator';
};

/**
 * Submit the line currently on the prompt and wait for the prompt to be consumed.
 *
 * Polled, never a fixed sleep, for the reason `D-0448` already measured on the `/help`
 * submission: `submit()` clears `view.prompt` synchronously before its async call
 * (`coden-terminal.js:357-358`), but the frame is drawn on its own schedule, so a fixed delay
 * occasionally reads the screen between the keystroke landing and the next paint.
 */
const submitTerminalLine = async () => {
  await page.keyboard.press('Enter');
  let row = await promptRow();
  for (let waited = 0; row !== '' && waited < 3000; waited += 200) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    row = await promptRow();
  }
  return row;
};

/** Bring the terminal up at `#/coden` and wait for it to be genuinely `live` — the state the
 *  parent region publishes once the bridge has attached, not merely "the iframe exists". */
const openLiveTerminal = async () => {
  await gotoIdle(`${BASE}/#/coden`);
  await page.waitForFunction(
    () => document.querySelector('#codenTerminalHost')?.dataset.terminalState === 'live',
    { timeout: 30000 },
  );
  await page.waitForFunction(
    () => Boolean(document.querySelector('#codenTerminalHost iframe.coden-terminal-embed')),
    { timeout: 15000 },
  );
};

try {
  at('bootstrap');
  // --- bootstrap the throwaway Owner through the real forms ----------------
  await gotoIdle(BASE);
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
  // From here on, only what the product does BECAUSE somebody signed in. Everything the page
  // did while the gate was up is deliberately discarded, because the defect below is precisely
  // a question asked once at boot — signed out — and never asked again.
  resetObservations();
  await page.click('#setupMfaForm button[type="submit"]');
  await page.waitForSelector('#authGate.hidden', { timeout: 25000 });
  check('owner bootstrap signs the browser in', true);

  at('voice-after-sign-in');
  // --- what this installation can hear and say is asked AFTER sign-in ------
  //
  // s340, reported by the Owner as «per la voce non funziona nulla»: `initChatVoice()` ran at
  // module boot, two statements before `initializeAuth()` — an order, not a race — so
  // `/api/v1/voice/state` was answered 401 every cold load. The catch turned that into
  // `{canHear:false,canSpeak:false}`, which disables the microphone and the read-aloud button
  // and makes `speakReply` return before it asks for anything. Nothing refetched it, so voice
  // was dead from sign-in until a manual reload — and a reload made it work, which is why it
  // never looked reproducible.
  //
  // The assertion is on the REQUEST, not on the buttons. Asserting `#chatReadAloud.disabled`
  // agrees with `canSpeak` would pass vacuously on any installation with no speech model
  // bound: false === false, defect intact. That an installation was ASKED is not vacuous.
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {});
  check('signing in asks what this installation can hear and say',
    requestWasMade('/api/v1/voice/state'),
    `requests after sign-in: ${requestLog.length}`);
  // The complementary direction: it must not be asked while nobody is signed in, which is what
  // produced a 401 on every load. Together these pin WHEN the question is asked, from both sides.
  const voiceWhileSignedOut = failedRequests.filter((entry) => entry.includes('/api/v1/voice/state'));
  check('the voice state is never requested from a signed-out page',
    voiceWhileSignedOut.length === 0, voiceWhileSignedOut.join(' | '));
  // And the answer must reach the controls: asked-and-ignored is the other way to be dead.
  const voiceControls = await page.evaluate(async () => {
    const state = await fetch('/api/v1/voice/state', { credentials: 'same-origin' }).then((r) => r.json());
    return {
      canSpeak: state.canSpeak === true,
      aloudDisabled: document.querySelector('#chatReadAloud')?.disabled ?? null,
    };
  });
  check('the read-aloud control agrees with what the installation says it can do',
    voiceControls.aloudDisabled === !voiceControls.canSpeak, JSON.stringify(voiceControls));

  at('voice-window');
  // --- the voice window: present, closed, movable, remembered (D-0372) ----
  //
  // Owner: «meglio creare un popup … con la finestrina che possiamo spostare e mettere dove
  // vogliamo». What this probe CAN exercise is the window itself; what it cannot is the
  // microphone, because there is no audio device here and no speech model bound. That half is
  // stated rather than faked — a check driving a synthetic stream would assert this harness's
  // idea of a microphone, not a microphone.
  const windowBefore = await page.evaluate(() => {
    const face = document.querySelector('#voiceFace');
    return {
      exists: Boolean(face),
      hidden: face?.classList.contains('hidden') ?? null,
      hasHandle: Boolean(document.querySelector('#voiceFaceHandle')),
      bars: document.querySelectorAll('.voice-face-bar').length,
    };
  });
  check('the voice window exists and stays closed until the microphone is used',
    windowBefore.exists && windowBefore.hidden === true
    && windowBefore.hasHandle && windowBefore.bars > 0, JSON.stringify(windowBefore));

  // Dragged through real pointer events on the real handle, not by assigning style.left: the
  // thing being checked is the drag wiring, and setting the position directly would pass with
  // no wiring at all.
  const dragged = await page.evaluate(async () => {
    const face = document.querySelector('#voiceFace');
    const handle = document.querySelector('#voiceFaceHandle');
    face.classList.remove('hidden');
    const start = face.getBoundingClientRect();
    const send = (type, x, y) => handle.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, clientX: x, clientY: y, bubbles: true,
    }));
    send('pointerdown', start.left + 10, start.top + 6);
    send('pointermove', start.left + 10 - 120, start.top + 6 - 90);
    send('pointerup', start.left + 10 - 120, start.top + 6 - 90);
    const moved = face.getBoundingClientRect();
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('noesar.voiceFace.position') ?? 'null'); } catch { /* none */ }
    face.classList.add('hidden');
    return { movedX: Math.round(start.left - moved.left), movedY: Math.round(start.top - moved.top), stored };
  });
  check('the voice window can be dragged where the person wants it',
    dragged.movedX > 60 && dragged.movedY > 40, JSON.stringify(dragged));
  check('where it was put is remembered, not reset on the next use',
    Boolean(dragged.stored) && Number.isFinite(dragged.stored.left)
    && Number.isFinite(dragged.stored.top), JSON.stringify(dragged.stored));

  at('csrf');
  // --- the CSRF regression, which is the reason any of this is here --------
  // A write immediately after login always worked. The defect only appeared after a
  // reload, because the token lived in a module variable that a reload reset while the
  // session cookie survived. This asserts the fixed behaviour in the order that used
  // to break it.
  resetObservations();
  await gotoIdle(`${BASE}/#/projects`);
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
    await gotoIdle(`${BASE}/#/${route}`);
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
  await gotoIdle(`${BASE}/#/home`);
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
    await gotoIdle(`${BASE}/#/${from}`);
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
  await gotoIdle(`${BASE}/#/settings/health`);
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
  await gotoIdle(`${BASE}/#/home`);
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
  await gotoIdle(`${BASE}/#/home`);
  await page.evaluate(() => document.querySelector('[data-panel-rank="floating"]').click());
  await new Promise((resolve) => setTimeout(resolve, 200));
  const homeFloating = await panelOf();
  await gotoIdle(`${BASE}/#/projects`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const projectsDefault = await panelOf();
  await gotoIdle(`${BASE}/#/home`);
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
  await gotoIdle(`${BASE}/#/coden`);
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
  // A COLD deep link, which needs the reload to be one: page.goto() to a URL differing only
  // in its hash is a same-document navigation — it fires hashchange on the page already
  // loaded and never re-runs boot. The first version of this check did exactly that and
  // called it a deep link, which would have left the case that matters (open the address in
  // a new tab) untested while reporting PASS.
  await gotoIdle(`${BASE}/#/coden/bench/diff`);
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
  await gotoIdle(`${BASE}/#/coden/agent/authority`);
  await page.waitForSelector('[data-agent-panel="authority"].active', { timeout: 15000 });
  const authorityPanel = await panelBox('[data-agent-panel="authority"]');
  const benchClosed = await panelBox('[data-bench-panel="diff"]');
  check('phase 3c — an agent address opens its panel and closes the bench one, so ONE is open',
    authorityPanel.height > 0 && benchClosed.height === 0, JSON.stringify({ authorityPanel, benchClosed }));

  // An address typed wrong must land somewhere real and then say where it landed — the
  // rule an unknown Settings section already follows.
  await gotoIdle(`${BASE}/#/coden/bench/no-such-panel`);
  await page.waitForSelector('#view-coden.active', { timeout: 15000 });
  const fallback = await page.evaluate(() => ({
    hash: location.hash,
    active: document.querySelector('[data-bench-panel].active')?.getAttribute('data-bench-panel'),
  }));
  check('an unknown panel name falls back to the default and normalises the address',
    fallback.active === 'shadow' && fallback.hash === '#/coden/bench/shadow', JSON.stringify(fallback));

  // Owner instruction, 2026-08-13: `#/coden` shows ONE chat, the emulated TUI. `#codenPrompt`
  // (the legacy prompt/transcript/menu this jump used to drive) is now hidden whenever the
  // terminal is live — `app.js`'s `codenTerminalState()`. It still exists in the DOM as the
  // fallback for a browser that cannot attach the emulator (rule 12: nothing here is deleted),
  // but it is not the gesture a signed-in owner has anymore, and driving a hidden textarea
  // through `page.type`/`page.click` is not proof of anything a real session can do.
  //
  // What DOES still work, unconditionally, is the ordinary hash route (`activate()` in
  // `app.js`) — a bench address has always also been a real, bookmarkable URL. That path was
  // deliberately NOT the one this check used to drive, because assigning `location.hash` fires
  // `hashchange` and re-runs `VIEW_LOADERS.coden` — a round of requests the prompt-driven,
  // pushState-based jump avoided. Hiding the prompt removes that specific efficiency, honestly,
  // not just this check's old assertion of it: a bench-panel move is a page hashchange now,
  // same as any other in-page link. `D-0435` records the loss; it is not hidden here.
  const jump = async (address, panel, kind = 'bench') => {
    await page.evaluate((h) => { location.hash = h; }, `#/coden/${address}`);
    await page.waitForSelector(`[data-${kind}-panel="${panel}"].active`, { timeout: 15000 });
  };
  await jump('bench/map', 'map');
  const afterJump = await page.evaluate(() => ({ hash: location.hash, title: document.title }));
  check('jumping to a panel of this page moves the address', afterJump.hash === '#/coden/bench/map', JSON.stringify(afterJump));

  // PHASE 3c. A bare `#/coden` used to be COMPLETED to whichever panel happened to be showing,
  // because a panel was always showing — which is exactly what made this page a dashboard.
  // `16` §4b.3: the panels "smettono di essere riquadri sempre presenti e restano posti dove si
  // va". So a bare address now opens none, stays short because that is honest, and the bench is
  // not on the screen at all. Nothing became unreachable: every one of the twenty-five is an
  // address the prompt opens, measured one by one in 3c-1 before any of this was removed.
  await gotoIdle(`${BASE}/#/coden`);
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
  await jump('bench/diff', 'diff');
  await jump('bench/tests', 'tests');
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
  await gotoIdle(`${BASE}/#/coden`);
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

  // POINT 3 — the `/` menu, its properties now driven through the terminal (`D-0448`, `D-0435`
  // fix, 2026-08-14). This block used to drive `#codenPrompt` directly. Two things broke it:
  // `D-0435` hid the element whenever the terminal is live (`page.click` on a hidden node
  // throws "Node is either not clickable" — the crash this fix removes), and `D-0437`, the
  // SAME day, flattened the two-level group menu this block also asserted (`top.rows` as
  // groups, pressing `t` opening exactly `TOOLS`) into one ranked list. The second defect was
  // invisible because the first one already made the block unreachable — both are `D-0448`.
  //
  // Every property this block proved is still proved, not dropped: rank/filter, Tab
  // completion, a real command reaching the engine, `/logout`'s confirm-without-ending and an
  // address rendering inline are driven through the terminal in the `coden-terminal` step
  // below, with the `typeIntoTerminal`/`screenText`/`promptRow` helpers already proven there.
  // Two properties are NOT reproduced because neither is true of the current design: the exact
  // group ORDER, and "a bare / lists no entries" — `menuFrame` (`coden-view-model.js:399-403`)
  // returns a flat, ranked list with no group level, by the Owner's own instruction on `D-0437`.
  await gotoIdle(`${BASE}/#/coden`);
  await page.waitForSelector('#codenPrompt', { timeout: 15000 });

  at('coden-terminal');
  // --- D-0404 slice 3 · the terminal, DRIVEN rather than merely present -------
  //
  // `D-0415(a)` closed here. Slice 3 shipped `coden-terminal.js` with 18 unit tests over its
  // three PURE decisions and nothing else: everything socket-, DOM- and timer-shaped had never
  // executed in a browser. The first run of THIS suite against that tree failed at `bootstrap`
  // — the module threw `Cannot access 'codenTerminal' before initialization` and killed the
  // whole WebUI at boot (`D-0416`). 2514 unit tests were green against exactly that code.
  //
  // So what is checked below is the socket, the frames and the keystrokes: the emulator
  // mounted, the bridge attached, a typed `/` drew the menu the shared renderer produces, a
  // submitted line came back through `planTurn`, and leaving and returning re-attaches instead
  // of stacking a second emulator on the first.
  const terminalMounted = await soft('the terminal mounts and reaches `live` over the bridge', async () => {
    await page.waitForFunction(
      () => document.querySelector('#codenTerminalHost')?.dataset.terminalState === 'live',
      { timeout: 30000 },
    );
  });
  if (terminalMounted) {
    // The emulator lives in its OWN document since `D-0418`, so everything below is checked on
    // the side that owns it. The PARENT owns the region, its role, its accessible name and the
    // visible status line; the CHILD owns the emulator, the socket and the keystrokes. Both are
    // asserted, because the split is exactly where a surface like this silently comes apart:
    // a frame that attaches while the parent's status line still says "Not connected" is two
    // surfaces disagreeing about one fact.
    // `terminalFrame`, `screenText`, `promptRow` and `typeIntoTerminal` used to be defined
    // HERE, block-scoped to this step. They were hoisted to file scope in `D-0501` because
    // `F-SLASH-001`'s repair needs to drive the terminal from a second step far below, and its
    // own record named this hoist as the prerequisite. Nothing about them changed in the move.
    const embedded = await page.evaluate(() => {
      const host = document.querySelector('#codenTerminalHost');
      const frames = host?.querySelectorAll('iframe.coden-terminal-embed') ?? [];
      const frame = frames[0] ?? null;
      return {
        frames: frames.length,
        src: frame?.getAttribute('src') ?? '',
        sandbox: frame?.getAttribute('sandbox') ?? '',
        titled: frame?.getAttribute('title') ?? '',
        onScreen: frame?.getBoundingClientRect().height > 0,
        state: host?.dataset.terminalState ?? '',
        status: document.querySelector('#codenTerminalStatus')?.textContent?.trim() ?? '',
        statusState: document.querySelector('#codenTerminalStatus')?.dataset.state ?? '',
        role: host?.getAttribute('role') ?? '',
        labelled: host?.getAttribute('aria-labelledby') ?? '',
        emulatorsInParent: document.querySelectorAll('#codenTerminalHost .xterm').length,
      };
    });
    check('D-0418 · exactly one embedded terminal document, on screen and named',
      embedded.frames === 1 && embedded.onScreen && embedded.titled.length > 0
        && embedded.src.includes('coden-terminal.html'), JSON.stringify(embedded));
    check('D-0418 · it is sandboxed to scripts and same-origin, and nothing else',
      embedded.sandbox === 'allow-scripts allow-same-origin', embedded.sandbox);
    check('D-0418 · the emulator is NOT in the main document any more',
      embedded.emulatorsInParent === 0, String(embedded.emulatorsInParent));
    check('the parent region still carries the state, the role and the name',
      embedded.state === 'live' && embedded.statusState === 'live' && embedded.status.length > 0
        && embedded.role === 'application' && embedded.labelled === 'codenTerminalTitle',
      JSON.stringify(embedded));

    const inFrame = await (terminalFrame()?.evaluate(() => ({
      emulators: document.querySelectorAll('#terminalHost .xterm').length,
      state: document.querySelector('#terminalHost')?.dataset.terminalState ?? '',
    })) ?? Promise.resolve({ emulators: 0, state: 'no frame' }));
    check('inside that document, exactly one emulator is attached',
      inFrame.emulators === 1 && inFrame.state === 'live', JSON.stringify(inFrame));

    // The opening frame is the shared renderer's, not a placeholder: the attachment note names
    // the account the bridge welcomed. Waited for — it arrives over the socket.
    const drewOpening = await soft('the first frame is drawn and names the attachment', async () => {
      const frame = terminalFrame();
      await frame.waitForFunction(
        () => /Attached as/.test(document.querySelector('#terminalHost')?.textContent ?? ''),
        { timeout: 15000 },
      );
    });
    if (drewOpening) {
      const opening = await screenText();
      check("the opening frame is the shared renderer's, not a placeholder",
        /CodeN Evolution/.test(opening) && /Attached as/.test(opening),
        opening.replace(/\s+/g, ' ').slice(0, 140));
    }

    // D-0418 · the palette comes from the PRODUCT's tokens, not from xterm's built-in defaults.
    // The audit measured what the defaults cost: `span.xterm-dim` at ratio 1.31 on the light
    // theme, because a dark terminal palette was being drawn on a light surface. Checked by
    // comparing what the emulator resolved against what the parent's stylesheet declares.
    const palette = await (terminalFrame()?.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const screen = document.querySelector('#terminalHost .xterm-screen') ?? document.querySelector('#terminalHost .xterm');
      const rows = document.querySelector('#terminalHost .xterm-rows');
      return {
        token: style.getPropertyValue('--surface-code').trim(),
        theme: document.documentElement.dataset.theme ?? '',
        background: screen ? getComputedStyle(screen).backgroundColor : '',
        foreground: rows ? getComputedStyle(rows).color : '',
      };
    }) ?? Promise.resolve(null));
    check('D-0418 · the emulator takes its palette from the product theme',
      Boolean(palette) && palette.theme.length > 0 && palette.foreground.length > 0
        && palette.foreground !== 'rgba(0, 0, 0, 0)', JSON.stringify(palette));

    // A typed `/` must draw the ONE menu — the same groups the DOM prompt shows, produced by
    // the same `agent-commands.js` both shells import.
    await typeIntoTerminal('/');
    // Where the keyboard actually IS, printed with the result. Three runs failed this check with
    // "waiting failed" and nothing else, which says the menu did not appear and not one word
    // about why — and the two candidate causes (the keystroke never arrived / it arrived and the
    // renderer did not redraw) need opposite repairs. A check that cannot distinguish them costs
    // a full run per guess.
    const focusReport = await page.evaluate(() => ({
      topActive: document.activeElement?.tagName?.toLowerCase() ?? '',
      topActiveClass: typeof document.activeElement?.className === 'string' ? document.activeElement.className : '',
    })).catch(() => ({}));
    const frameFocus = await (terminalFrame()?.evaluate(() => ({
      active: document.activeElement?.tagName?.toLowerCase() ?? '',
      activeClass: typeof document.activeElement?.className === 'string' ? document.activeElement.className : '',
      hasFocus: document.hasFocus(),
      textarea: Boolean(document.querySelector('#terminalHost .xterm-helper-textarea')),
      screen: document.querySelectorAll('#terminalHost .xterm-rows > div').length,
    })) ?? Promise.resolve({}));
    // What the screen says AFTER the keystroke. Focus alone cannot tell the two failure modes
    // apart: if the frame redrew with a `/` on the prompt line the key arrived and the menu is
    // the problem; if the screen is unchanged the key never reached `onData` at all.
    // The TAIL of the screen, not its head: the prompt row and the menu are the last things the
    // renderer draws, so the head shows the transcript — which is identical whether the keystroke
    // arrived or not, and told four runs in a row nothing at all.
    const afterTyping = (await screenText()).replace(/\s+/g, ' ').trim().slice(-320);
    check('the keystroke reached the emulator through the browser\'s own input pipeline',
      lastInputPath === 'insertText' || lastInputPath === 'keydown',
      `input path: ${lastInputPath} — focus ${JSON.stringify({ ...focusReport, ...frameFocus })}`);
    // Corrected `D-0448`, 2026-08-14: waited for `DESTINATIONS`, a GROUP label from the
    // two-level menu `D-0437` flattened away the same day this check was written against it —
    // the wait always timed out, silently, because it sits inside `soft()`. `menuFrame`
    // (`coden-view-model.js:399-403`) now returns a flat, ranked list with `plan` first
    // (`agent-commands.js:129`, `matchCommands('')` preserves array order) and `selected`
    // starting at `0` — `/plan` is on screen the instant the menu draws, at any window size.
    const menuDrawn = await soft(`a typed / draws the menu inside the terminal — path ${lastInputPath}, screen "${afterTyping}"`, async () => {
      const frame = terminalFrame();
      await frame.waitForFunction(
        () => /\/plan/.test(document.querySelector('#terminalHost')?.textContent ?? ''),
        { timeout: 10000 },
      );
    });
    if (menuDrawn) {
      const drawn = await screenText();
      check('the terminal menu shows the flat, ranked command list',
        /\/plan/.test(drawn) && !/error|refused/i.test(drawn),
        drawn.replace(/\s+/g, ' ').slice(0, 160));
    }

    // `D-0415(b)` closed: the arrows now move the highlight through the group list, the same
    // `▸` marker `tui-fullscreen.mjs` moves over `ssh` — proven here by the marker's own
    // position in the rendered screen shifting after the keystroke, not merely by a note saying
    // it does not move yet. `indexOf` rather than a row split: `.xterm-rows`' concatenated
    // `textContent` carries no line separator between row `<div>`s, so the marker's surrounding
    // slice is the row it is on regardless of where in the buffer that row landed.
    const markerContext = (text) => {
      const at = text.indexOf('▸');
      return at === -1 ? '' : text.slice(at, at + 24);
    };
    const beforeArrow = await screenText();
    await page.keyboard.press('ArrowDown');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterArrow = await screenText();
    check('D-0415(b) · the arrow keys move the menu highlight, not just decode it',
      markerContext(beforeArrow) !== '' && markerContext(afterArrow) !== ''
        && markerContext(beforeArrow) !== markerContext(afterArrow),
      `before "${markerContext(beforeArrow)}" after "${markerContext(afterArrow)}"`);

    // Escape abandons a `/` prompt, then a real line goes through the SHARED `planTurn` and
    // comes back into the transcript.
    // `F-TERM-001`. The chain from keystroke to answer is measured at each of its three joints,
    // because "nothing appeared" was true for four runs and named none of them. Ctrl-U rather
    // than Escape to empty the prompt: `decodeInput` maps `\x15` to `kill-line`, which clears
    // unconditionally, while `escape` clears only a prompt that starts with `/` — and a prompt
    // left holding `/` turns the next line into `//help`, an unknown command whose error nobody
    // was looking for.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const promptEmptied = await promptRow();
    check('F-TERM-001 · the prompt can be emptied before a line is typed',
      promptEmptied === '', `prompt row after Ctrl-U: "${promptEmptied}"`);

    await typeIntoTerminal('/help');
    const promptComposed = await promptRow();
    check('F-TERM-001 · the typed line is composed on the prompt, exactly as typed',
      promptComposed === '/help', `prompt row after typing: "${promptComposed}" (path ${lastInputPath})`);

    await page.keyboard.press('Enter');
    // Polled, not a fixed sleep (`D-0448`, 2026-08-14): `submit()` clears `view.prompt`
    // synchronously before its async call (`coden-terminal.js:357-358`), but the frame this
    // reads from is drawn on its own schedule — a fixed 500ms occasionally read the frame
    // between the keystroke landing and the next paint. `answered` below already proves the
    // eventual listing arrives; this only needed a poll instead of a guess at how long a paint
    // takes.
    let promptSubmitted = await promptRow();
    for (let waited = 0; promptSubmitted !== '' && waited < 3000; waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      promptSubmitted = await promptRow();
    }
    // F-TERM-002 diagnostic (2026-08-15): `promptRow()`'s regex takes the FIRST `>...▍` match
    // in the whole buffer. If the prompt-shaped pattern appears more than once — a stale row
    // left over from before the help listing scrolled the screen, not the current one — the
    // check would be reading the wrong occurrence. Every match is reported on failure so this
    // is PROVEN rather than guessed at.
    let allPromptMatches = 'n/a (check passed)';
    if (promptSubmitted !== '') {
      const finalScreen = await screenText();
      const matches = [...finalScreen.matchAll(/>\s*([^│\n]*)▍/g)].map((m) => JSON.stringify(m[1]));
      allPromptMatches = `${matches.length} match(es): ${matches.join(', ')}`;
    }
    check('F-TERM-001 · Enter consumes the line — the prompt is empty again',
      promptSubmitted === '', `prompt row after Enter: "${promptSubmitted}" — all >...▍ occurrences: ${allPromptMatches}`);
    // Waited for on `/logout`, not on `Commands:` — and the difference is a property of the
    // renderer, not a detail. The transcript region draws the TAIL of the transcript, and the
    // help listing is thirty-odd lines, so its heading scrolls off the top the moment it is
    // printed. Waiting for the heading is waiting for something the screen is correct not to
    // show. The last group in the listing is SESSION and its last entry is `/logout`.
    const answered = await soft('a submitted line is answered in the transcript', async () => {
      const frame = terminalFrame();
      await frame.waitForFunction(
        () => /\/logout/.test(document.querySelector('#terminalHost')?.textContent ?? ''),
        { timeout: 15000 },
      );
    });
    // Checked whether or not the wait succeeded, and the SCREEN TAIL travels with the result.
    // A bare "waiting failed" says only that something did not appear; the tail says whether the
    // prompt still holds the line (the keystroke never submitted), whether an error was recorded
    // (the line was refused), or whether the listing is there and the wait looked for the wrong
    // string. Three different repairs, and four runs were spent not knowing which.
    {
      const transcript = await screenText();
      void answered;
      // The listing itself, not its heading — see the note above on why the heading is off the
      // screen by the time the last line is drawn. Three entries from three different groups,
      // so a listing that lost a group fails here rather than passing on one lucky match.
      // Every marker the three possible answers would leave, reported together: the listing
      // (success), an 'unknown command' line (the line was refused), or an error line (submit
      // threw). A check that only looks for success cannot say which of the other two happened.
      const markers = {
        listing: ['/logout', '/plan', 'SESSION'].filter((f) => transcript.includes(f)).join('+') || 'none',
        heading: transcript.includes('Commands:'),
        unknown: /unknown|not a command|non riconosciut/i.test(transcript),
        error: /error|failed|is not a function/i.test(transcript),
        length: transcript.replace(/\s+/g, ' ').trim().length,
      };
      check('the answer came from the shared command registry',
        ['/logout', '/plan', 'SESSION'].every((fragment) => transcript.includes(fragment)),
        JSON.stringify(markers));
    }

    // --- POINT 3, redriven here (`D-0448`, 2026-08-14) — see the note left at the old site ---
    //
    // Rank/filter: `matchCommands` ranks name-starts-with above name-contains above
    // summary-contains (`agent-commands.js:319-333`). Typing `pl` after clearing the prompt
    // must rank `/plan` (starts-with) onto the visible, windowed screen.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await typeIntoTerminal('/pl');
    const filtered = (await screenText()).replace(/\s+/g, ' ');
    check('point 3 · two letters still filter and rank across the whole product',
      filtered.includes('/plan'), filtered.slice(-200));

    // Tab completes the highlighted hit into the prompt WITHOUT sending
    // (`coden-terminal.js:347-354`: `view.prompt = '/${chosen.name}${chosen.argument?' ':''}'`).
    // Counted as a DELTA of the `›` (user-turn) glyph (`tui-screen.mjs:174`), not a literal,
    // because a prior check in this same step already left turns in the transcript. `.trim()`
    // inside `promptRow()` strips the trailing space `/plan`'s truthy argument adds, so the
    // completed word is what is asserted, not the space — the space is real but this helper
    // cannot see it.
    const glyphCount = (text) => (text.match(/›/g) ?? []).length;
    const beforeTab = glyphCount(await screenText());
    await page.keyboard.press('Tab');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const completedPrompt = await promptRow();
    const afterTab = glyphCount(await screenText());
    check('Tab completes the prompt and runs nothing',
      completedPrompt === '/plan' && afterTab === beforeTab,
      `prompt "${completedPrompt}" before ${beforeTab} after ${afterTab}`);

    // A real call, over the real bridge, into the real transcript — `/status` this time rather
    // than `/help`, so this proves a DIFFERENT command than the one already driven above, one
    // whose `kind` is `call` (`coden-terminal.js:427-440`: the result is JSON-stringified and
    // recorded as an `agent` entry, not a fixed string — there is no literal to wait for).
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const beforeStatus = await screenText();
    await typeIntoTerminal('/status');
    await page.keyboard.press('Enter');
    const statusRan = await soft('a work command reaches the engine and answers into the terminal', async () => {
      await terminalFrame().waitForFunction(
        (before) => {
          const rows = document.querySelector('#terminalHost .xterm-rows')?.textContent ?? '';
          return rows !== before && !/error|refused/i.test(rows);
        },
        { timeout: 15000 },
        beforeStatus,
      );
    });
    if (statusRan) {
      const afterStatus = (await screenText()).replace(/\s+/g, ' ');
      check('the /status answer carries no error marker',
        !/error|refused|is not a function/i.test(afterStatus), afterStatus.slice(-200));
    }

    // Owner, 2026-08-15: `/model` with no id used to be a dead end — "needs an id", naming
    // none. `agent-commands.js` made the argument optional and `model.activate` now lists
    // what is loadable when none is given, the same catalogue `#/models` reads. Driven here
    // because this is exactly the gesture the Owner reported broken: type it, see choices.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const beforeModel = await screenText();
    await typeIntoTerminal('/model');
    await page.keyboard.press('Enter');
    const modelRan = await soft('/model with no id answers into the terminal instead of hanging', async () => {
      await terminalFrame().waitForFunction(
        (before) => {
          const rows = document.querySelector('#terminalHost .xterm-rows')?.textContent ?? '';
          return rows !== before;
        },
        { timeout: 15000 },
        beforeModel,
      );
    });
    if (modelRan) {
      const afterModel = (await screenText()).replace(/\s+/g, ' ');
      check('/model with no id lists what is loadable, not a "needs an id" dead end',
        !/needs.*id.*Nothing was run/i.test(afterModel) && /models?/i.test(afterModel),
        afterModel.slice(-300));
    }

    // `/logout` needs a typed word — this is the one entry whose FIRST form must do nothing,
    // so the check is that the session survives it. The session state lives in the PARENT
    // document (`#authGate`), not inside this frame.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await typeIntoTerminal('/logout');
    await page.keyboard.press('Enter');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterLogout = await page.evaluate(() => Boolean(document.querySelector('#authGate')?.classList.contains('hidden')));
    const logoutScreen = (await screenText()).replace(/\s+/g, ' ');
    check('/logout alone asks, and does not end the session',
      afterLogout && /logout confirm/i.test(logoutScreen), `signedIn=${afterLogout} ${logoutScreen.slice(-160)}`);

    // An address renders INLINE, into the transcript — it does not navigate the page. This is
    // not the old property re-driven, it is the CURRENT one: `coden-terminal.js:410-425`
    // (`turn.kind === 'navigate'`) calls the same `showAddress` the `ssh` shell prints with and
    // records the lines as one `agent` entry. `data-view="memory"` in `index.html:169` is the
    // address used — confirmed present, not assumed.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await typeIntoTerminal('/memory');
    await page.keyboard.press('Enter');
    const addressRan = await soft('an address renders inline in the terminal', async () => {
      await terminalFrame().waitForFunction(
        () => /Memory/.test(document.querySelector('#terminalHost .xterm-rows')?.textContent ?? ''),
        { timeout: 15000 },
      );
    });
    if (addressRan) {
      const afterAddress = (await screenText()).replace(/\s+/g, ' ');
      const hashUnchanged = await page.evaluate(() => location.hash);
      check('an address goes into the transcript, and the page does not navigate',
        /Memory/.test(afterAddress) && !/error|refused/i.test(afterAddress) && hashUnchanged === '#/coden',
        `hash=${hashUnchanged} ${afterAddress.slice(-200)}`);
    }

    // Leaving the destination destroys the document, and with it the socket, the observer and
    // the reconnect timer. Returning builds a new one — not a second one beside the first.
    await gotoIdle(`${BASE}/#/home`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const detached = await page.evaluate(() => ({
      frames: document.querySelectorAll('#codenTerminalHost iframe').length,
      state: document.querySelector('#codenTerminalHost')?.dataset.terminalState ?? '',
    }));
    check('leaving CodeN destroys the embedded document and says so',
      detached.frames === 0 && detached.state === 'idle', JSON.stringify(detached));
    check('and no orphan terminal document is left running',
      terminalFrame() === null, String(page.frames().length));

    await gotoIdle(`${BASE}/#/coden`);
    const reattached = await soft('returning to CodeN attaches again', async () => {
      await page.waitForFunction(
        () => document.querySelector('#codenTerminalHost')?.dataset.terminalState === 'live'
          && document.querySelectorAll('#codenTerminalHost iframe.coden-terminal-embed').length === 1,
        { timeout: 30000 },
      );
    });
    if (reattached) {
      const again = await page.evaluate(() => ({
        frames: document.querySelectorAll('#codenTerminalHost iframe.coden-terminal-embed').length,
        state: document.querySelector('#codenTerminalHost')?.dataset.terminalState ?? '',
      }));
      check('the second attachment is one document, not two stacked',
        again.frames === 1 && again.state === 'live', JSON.stringify(again));
    }

    // `D-0418` · and now the point of the whole boundary: NOTHING is refused any more. The
    // emulator paints inside a document whose policy allows it, and the main document — where
    // every form, session and piece of operator data lives — never granted anything.
    check('D-0418 · the emulator paints with no policy refusal anywhere',
      cspStyleRefusals.length === 0,
      `${cspStyleRefusals.length} inline-style refusals: ${cspStyleRefusals.slice(0, 2).join(' | ').slice(0, 300)}`);

    // Leave the destination before handing the page to the next step, and WAIT for the document
    // to be gone. Not tidiness: an attached terminal holds a WebSocket, a hash navigation does
    // not reload the page, and the next block's `waitUntil: 'networkidle2'` therefore never
    // settles — measured in run 5, where it timed out and cost 226 later checks. The product is
    // not at fault (a person is not waiting for network idle); the harness has to stop leaving
    // an open socket behind it.
    await leaveCodenTerminal();

    const terminalErrors = consoleErrors.filter((line) => !/Cross-Origin-Opener-Policy header has been ignored/.test(line));
    check('driving the terminal produced no OTHER console errors',
      terminalErrors.length === 0, terminalErrors.join(' | '));
  }

  await leaveCodenTerminal();
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
  await gotoIdle(`${BASE}/#/home`);
  await page.reload({ waitUntil: 'networkidle2' });
  await gotoIdle(`${BASE}/#/coden`);
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
  await gotoIdle(`${BASE}/#/coden/bench/projects`);
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
  await gotoIdle(`${BASE}/#/coden/bench/diff`);
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
  // Corrected `D-0448`, 2026-08-14: this asserted the GROUPED design (`count===0`, `groups>=5`)
  // `D-0437` flattened away the same day. `menuFrame` on a bare `/` now returns every command,
  // unfiltered (`agent-commands.js:319-333`, `matchCommands('')`) — 17 per `D-0445` — with no
  // group level at all. What the old assertion protected — that this gesture reaches the whole
  // product — is now that the full, unfiltered command count is on screen.
  check('phase 3c — clicking the hint opens the ONE menu, and a bare / is the flat command list',
    viaPrompt.focused && viaPrompt.prompt.startsWith('/') && viaPrompt.count === 17 && viaPrompt.groups === 0,
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
  //
  // F-COMMAND-001 (D-0449, investigated 2026-08-15): `submitCodenAddress` above carries the
  // full account of what was found and what was not — the short version is that `Enter` was
  // never the problem, `#codenPrompt` collapsing to 0 height right before it was pressed was.
  const submitError = await submitCodenAddress(page, '/coden/agent/authority').then(() => null, (error) => error.message);
  const landedOrNot = await soft('phase 3c — an address typed at the prompt opens its panel', async () => {
    if (submitError) throw new Error(submitError);
    await page.waitForSelector('[data-agent-panel="authority"].active', { timeout: 15000 });
  });
  if (landedOrNot) {
    const landed = await page.evaluate(() => ({
      hash: location.hash,
      benchOpen: document.querySelectorAll('#view-coden [data-bench-panel].active').length,
    }));
    check('phase 3c — an address typed at the prompt opens its panel, and closes the other region',
      landed.hash === '#/coden/agent/authority' && landed.benchOpen === 0, JSON.stringify(landed));
  } else {
    // Diagnostic only, so a failure here names its cause instead of only its symptom next time.
    const diag = await page.evaluate(() => ({
      hash: location.hash,
      promptValue: document.querySelector('#codenPrompt')?.value ?? '(gone)',
      lastEntries: [...document.querySelectorAll('#codenTranscript .t-entry')].slice(-3)
        .map((node) => `${node.className}: ${node.textContent.trim().slice(0, 120)}`),
      addressBookHasIt: [...document.querySelectorAll('#codenMenu [data-coden-command]')]
        .some((node) => node.dataset.codenCommand === 'coden/agent/authority'),
      focusedNow: document.activeElement?.id ?? '(none)',
    }));
    check('phase 3c — an address typed at the prompt opens its panel (diagnostic)', false,
      JSON.stringify({ submitError, ...diag }));
  }

  await leaveCodenTerminal();
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

  await gotoIdle(`${BASE}/#/home`);
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
  // `D-0406` · the bare `/` no longer opens this box, and Ctrl-K is now the only gesture that
  // does. `16` §4b.4 decided «nel prompt comanda: c'e una / sola» on 2026-08-05 and nothing
  // enforced it until slice 3: two gestures were bound to the same key — navigation here, the
  // agent's command menu inside CodeN — and the terminal that now lives on that destination
  // needs `/` to be a CHARACTER. Both halves are checked, because a decision only one half
  // measures is a decision that half-reverts unnoticed.
  await page.keyboard.press('/');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const afterSlash = await paletteState();
  check('D-0406 · a bare / no longer opens the jump box',
    afterSlash.open === false, JSON.stringify(afterSlash));

  const openPalette = async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await page.waitForSelector('#globalSearchResults:not(.hidden)', { timeout: 15000 });
  };

  await openPalette();
  const opened = await paletteState();
  // Thirteen destinations + fifteen Settings sections + the Archive and the Bin + sixteen
  // workbench panels. Asserted as a floor rather than a number, so adding a panel does not
  // fail a test that is not about counting.
  check('Ctrl-K opens the box that already existed, with every address in it',
    opened.open && opened.focused && opened.expanded === 'true' && opened.addresses >= 40, JSON.stringify(opened));
  check('the shortcut does not leak into the box as text', opened.value === '', JSON.stringify(opened));

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
  await openPalette();
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
  await gotoIdle(`${BASE}/#/chat`);
  await page.waitForSelector('#chatInput', { timeout: 15000 });
  // focus(), not clickOrExplain(): that helper dispatches an in-page click event, and a
  // synthetic click does not move focus the way a real one does. Driven that way, the whole
  // phrase went to the body — 'a', 'n', 'd' fell on the floor, '/' opened the box exactly as
  // it should have, and the check failed against correct behaviour. The bracket check above
  // focuses the same way for the same reason.
  // The precondition, made explicit rather than inherited. This row asks whether `/` OPENS the
  // box while someone is writing; it cannot answer that starting from a box that is already
  // open. It was inheriting one — the jump box still held `coden/bench/diff` from the step
  // above — and reported `open:true` against behaviour that was correct. Closed and asserted
  // closed first, so a failure below means what the row says it means.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const box = document.querySelector('#globalSearchResults');
    if (box) box.classList.add('hidden');
    const field = document.querySelector('#globalSearch');
    if (field) field.value = '';
  });
  await page.evaluate(() => { document.querySelector('#chatInput').focus(); });
  await page.keyboard.type('and/or');
  const slashWhileTyping = await page.evaluate(() => ({
    open: !document.querySelector('#globalSearchResults').classList.contains('hidden'),
    typed: document.querySelector('#chatInput').value,
    // Added when this row failed with `open:true` and no way to tell WHICH box was open or what
    // put it there. `/` no longer opens anything (D-0406), so an open box here is either state
    // left behind by an earlier step or a second opener nobody has named.
    searchValue: document.querySelector('#globalSearch')?.value ?? '',
    active: document.activeElement?.id ?? '',
    rows: document.querySelectorAll('#globalSearchResults button').length,
  }));
  check('`/` typed into a message stays in the message and opens nothing',
    !slashWhileTyping.open && slashWhileTyping.typed === 'and/or', JSON.stringify(slashWhileTyping));

  // ——— VOICE, s336 stage 3 ————————————————————————————————————————————————————————————
  //
  // What is checked here is HONESTY, and it can only be checked in a browser. This installation
  // has no transcription or speech model configured — stage 4 is the stage that changes that —
  // so the only correct behaviour for the two controls is to be present, refuse, and say which
  // piece is missing. A control that looked available and then did nothing would be the s316
  // complaint again: a feature indistinguishable from a broken one.
  //
  // It also catches what `npm test` structurally cannot. That suite reads `app.js` as TEXT and
  // never executes it, so a bad import — or a leftover reference to the chip just deleted from
  // the top bar — would pass every unit test and blank the page. If `#chatDictate` carries a
  // title at all, `app.js` ran all the way through its wiring.
  const voiceFace = await page.evaluate(async () => {
    const dictate = document.querySelector('#chatDictate');
    const aloud = document.querySelector('#chatReadAloud');
    const state = await fetch('/api/v1/voice/state', { credentials: 'same-origin' })
      .then((response) => response.json()).catch(() => null);
    return {
      dictatePresent: Boolean(dictate),
      aloudPresent: Boolean(aloud),
      dictateDisabled: dictate?.disabled ?? null,
      aloudDisabled: aloud?.disabled ?? null,
      // The reason is read off the note line, not off `title`: `title` is translated from a
      // cached source, so a reason written there is overwritten by the markup's own the next
      // time anything changes. Found here, by this check, against the first build of it.
      note: document.querySelector('#voiceNote')?.textContent ?? '',
      noteHidden: document.querySelector('#voiceNote')?.classList.contains('hidden') ?? null,
      towerGone: !document.querySelector('#voiceToggle') && !document.querySelector('#voicePopover'),
      canHear: state?.canHear ?? null,
      canSpeak: state?.canSpeak ?? null,
    };
  });
  check('the microphone and the read-aloud control are beside the composer',
    voiceFace.dictatePresent && voiceFace.aloudPresent, JSON.stringify(voiceFace));
  check('the five-word control tower is gone from the top bar (point 6a)',
    voiceFace.towerGone, JSON.stringify(voiceFace));
  check('the server, not the browser, decides whether this installation can hear',
    voiceFace.canHear === false && voiceFace.canSpeak === false, JSON.stringify(voiceFace));
  check('with no model configured the controls refuse, and say which piece is missing',
    voiceFace.dictateDisabled === true && voiceFace.aloudDisabled === true
      && voiceFace.noteHidden === false && /cannot hear|transcription/i.test(voiceFace.note),
    JSON.stringify(voiceFace));

  // The resolver is the same module the unit suite drives — but this asserts it is the one the
  // PAGE loaded. A build that shipped a stale copy of it would pass every test in that suite.
  const voiceHeard = await page.evaluate(async () => {
    const intent = await import('/voice-intent.js');
    const commands = await import('/shared/coden/agent-commands.js');
    // F-INTENT-001: `[...commands.AGENT_COMMANDS]` alone is not what the page hands the
    // resolver — `heardResult()` (app.js) passes `codenOffered()`, commands PLUS the served
    // address book. 'memory' lives only in the address book, so the AGENT_COMMANDS-only list
    // could never match it: not a resolver defect, a reconstructed-input defect in this check.
    const entries = window.__noesarCodenOffered();
    const groupTitles = Object.fromEntries(commands.MENU_GROUPS.map((group) => [group.id, group.title]));
    const say = (text) => intent.resolveUtterance(text, { entries, groupTitles });
    return {
      navigate: say('memory'),
      run: say('plan fix the login'),
      prose: say('spiegami come funziona il login'),
    };
  });
  check('in the page, a destination navigates and a capability only waits to be sent',
    voiceHeard.navigate.disposition === 'navigate' && voiceHeard.run.disposition === 'run'
      && voiceHeard.run.line === '/plan fix the login',
    JSON.stringify(voiceHeard));
  check('in the page, prose that names nothing stays prose — that is the dictation path',
    voiceHeard.prose.kind === 'nothing', JSON.stringify(voiceHeard.prose));

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
  await gotoIdle(`${BASE}/#/workflows`);
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
  await gotoIdle(`${BASE}/#/home`);
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
  await gotoIdle(`${BASE}/#/providers`);
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

  await gotoIdle(`${BASE}/#/home`);
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
  await gotoIdle(`${BASE}/#/approvals`);
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
  await gotoIdle(`${BASE}/#/workflows`);
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
  await gotoIdle(`${BASE}/#/logs`);
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
  await gotoIdle(`${BASE}/#/settings/security`);
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

  at('password-change');
  // --- D-0481: #/settings/security's password-change form driven end to end ---------------
  // 3rd of the review's "backend proven, not e2e-driven" occurrences (after #/research,
  // D-0478, and the theme/accent picker, D-0479): `auth.changePassword` is unit-tested, but
  // nothing had proven `#securityPasswordForm`'s submit button actually reaches it.
  //
  // Round-tripped deliberately — change to a temporary password, prove the old one is
  // refused, then change back to `PASSWORD` — because this is the SAME browser session the
  // rest of this suite reuses (the restricted-role re-login and the invitation flow further
  // down both sign in again with the `PASSWORD` constant). An unreverted rotation here would
  // not be a clean test, it would be a real credential change bleeding into every later step.
  resetObservations();
  const tempPassword = 'e2e throwaway passphrase, temporarily rotated for the change-password check';
  const changeCode1 = await nextRealStepCode(newSecret);
  await page.type('#secCurrentPassword', PASSWORD);
  await page.type('#secTotpCode', changeCode1);
  await page.type('#secNewPassword', tempPassword);
  await clickOrExplain(page, '#securityPasswordForm button.primary');
  await page.waitForFunction(
    () => /Password changed/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const passwordChanged = await page.evaluate(() => ({
    message: document.querySelector('#statusMessage')?.textContent ?? '',
    isError: document.querySelector('#statusMessage')?.classList.contains('error') ?? false,
  }));
  check('Change password reaches the real endpoint and rotates the credential, not a decorative form',
    requestWasMade('/api/v1/auth/password') && /Password changed/i.test(passwordChanged.message) && !passwordChanged.isError,
    JSON.stringify(passwordChanged));

  // The rotation is real, not cosmetic: the superseded password must now be refused, checked
  // from Node (not the page) for the same isolation reason the MFA-replacement flow above
  // uses — a browser-side fetch would carry the live session cookie regardless of password.
  const oldPasswordRefused = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  check('the superseded password no longer authenticates',
    oldPasswordRefused.status >= 400, `status ${oldPasswordRefused.status}`);

  // Change back to `PASSWORD` — this session must leave the account exactly as it found it.
  const changeCode2 = await nextRealStepCode(newSecret);
  await page.type('#secCurrentPassword', tempPassword);
  await page.type('#secTotpCode', changeCode2);
  await page.type('#secNewPassword', PASSWORD);
  await clickOrExplain(page, '#securityPasswordForm button.primary');
  await page.waitForFunction(
    () => /Password changed/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const restoredPassword = await page.evaluate(() => document.querySelector('#statusMessage')?.textContent ?? '');
  check('the password is restored to the constant this suite relies on for every later login',
    /Password changed/i.test(restoredPassword), restoredPassword);

  at('updates');
  // --- D-0483: #/settings/updates' five buttons driven end to end -------------------------
  // 6th of the review's "backend proven, not e2e-driven" occurrences: `update-manager.test.mjs`
  // and `updates-channel-key-http.test.mjs` prove the pipeline, but nothing had proven that
  // Check/Change channel/Approve/Apply/Roll back actually reach it from the page.
  //
  // Placed BEFORE `authority-form` below (not after) on purpose: `#applyUpdate` requires the
  // same recent-strong-reauthentication gate `#authorizePlan` does (`server.mjs`), and session
  // elevation is re-earned per session, never inherited (the same fact `authority-form`'s own
  // comment relies on). Running here keeps the pre-reauth 403 deterministic — this suite has
  // not called `/api/v1/auth/reauth` yet at this point.
  //
  // A signed update package was NOT fabricated to drive a real `apply` success — out of this
  // suite's scope, the same posture `password-change` above took for passkeys/WebAuthn: doing
  // so would need a private signing key this suite has no business holding. What IS proven is
  // that every button reaches its real endpoint and reports the real, honest outcome for a
  // fresh installation with no channel key pinned and nothing staged — read directly from
  // `update-manager.mjs` before asserting, not guessed: `check` returns real inbox contents
  // (empty here), `approve`/`apply` throw `NOTHING_STAGED`/`NOT_APPROVED`-shaped errors the
  // page surfaces verbatim, and `rollback` never throws — with no `previous/` snapshot yet, it
  // reports success at the version already running, which is the true state, not an error.
  //
  // Guarded BEFORE `resetObservations()` so the guard's own `/api/v1/auth/me` request is not
  // left in this block's observation window — the `requestWasMade` assertions below should see
  // exactly the requests the five buttons make, and nothing this harness added.
  await checkSessionNotElevated('updates');
  resetObservations();
  await gotoIdle(`${BASE}/#/settings/updates`);
  await page.waitForFunction(
    () => !/Loading/.test(document.querySelector('#updatesStatus')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const initialStatus = await page.evaluate(() => document.querySelector('#updatesStatus')?.textContent ?? '');
  check('the updates panel loads real status, not a placeholder',
    requestWasMade('/api/v1/updates/status') && /Channel/.test(initialStatus) && /Pinned channel keys/.test(initialStatus),
    initialStatus.slice(0, 200));

  await clickOrExplain(page, '#checkUpdates');
  await page.waitForFunction(
    () => /Update check completed/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const afterCheck = await page.evaluate(() => ({
    message: document.querySelector('#statusMessage')?.textContent ?? '',
    isError: document.querySelector('#statusMessage')?.classList.contains('error') ?? false,
  }));
  check('Check for updates reaches the real endpoint, not a decorative form',
    requestWasMade('/api/v1/updates/check') && !afterCheck.isError, JSON.stringify(afterCheck));

  const originalChannel = await page.$eval('#updateChannel', (node) => node.value);
  const otherChannel = await page.$eval('#updateChannel',
    (node, current) => [...node.options].map((o) => o.value).find((v) => v !== current),
    originalChannel);
  await page.select('#updateChannel', otherChannel);
  await clickOrExplain(page, '#applyChannel');
  await page.waitForFunction(
    () => /Channel change completed/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const afterChannelChange = await page.evaluate(() => document.querySelector('#updatesStatus')?.textContent ?? '');
  check('Change channel reaches the real endpoint and the status panel reflects the new channel',
    requestWasMade('/api/v1/updates/channel') && afterChannelChange.includes(otherChannel),
    afterChannelChange.slice(0, 200));
  // Round-tripped: this suite must leave the probe's declared state as it found it, the same
  // discipline the password-change round-trip above applies to the credential.
  await page.select('#updateChannel', originalChannel);
  await clickOrExplain(page, '#applyChannel');
  await page.waitForFunction(
    () => /Channel change completed/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );

  await clickOrExplain(page, '#approveUpdate');
  await page.waitForFunction(
    () => document.querySelector('#statusMessage')?.classList.contains('error') === true,
    { timeout: 15000 },
  );
  const afterApprove = await page.evaluate(() => document.querySelector('#statusMessage')?.textContent ?? '');
  check('Approve staged is refused with the real reason — nothing is staged, not a silent no-op',
    requestWasMade('/api/v1/updates/approve') && /no update is staged/i.test(afterApprove),
    afterApprove);

  resetObservations();
  await clickOrExplain(page, '#applyUpdate');
  await page.waitForFunction(
    () => /Recent strong reauthentication/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const afterApply = await page.evaluate(() => document.querySelector('#statusMessage')?.textContent ?? '');
  check('Apply staged is gated by the same strong-reauthentication check as Authorize — not decorative',
    requestWasMade('/api/v1/updates/apply') && /Recent strong reauthentication/i.test(afterApply),
    afterApply);

  await clickOrExplain(page, '#rollbackUpdate');
  await page.waitForFunction(
    () => /Rollback completed/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const afterRollback = await page.evaluate(() => ({
    message: document.querySelector('#statusMessage')?.textContent ?? '',
    isError: document.querySelector('#statusMessage')?.classList.contains('error') ?? false,
  }));
  check('Roll back reaches the real endpoint and reports the true state, not an error, when there is nothing to revert from',
    requestWasMade('/api/v1/updates/rollback') && !afterRollback.isError, JSON.stringify(afterRollback));

  at('settings');
  // --- settings actually persists ------------------------------------------
  resetObservations();
  await gotoIdle(`${BASE}/#/settings/language`);
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
  await gotoIdle(`${BASE}/#/home`);
  const beforeInstall = await page.evaluate(() => document.querySelector('#navModules a.nav'));
  check('no module sidebar entry before any Owner module is installed', beforeInstall === null);

  await gotoIdle(`${BASE}/#/settings/modules`);
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

  await gotoIdle(`${BASE}/#/home`);
  await page.waitForSelector('#navModules a.nav', { timeout: 15000 });
  const afterActivate = await page.evaluate(() => {
    const link = document.querySelector('#navModules a.nav');
    return { href: link?.href ?? null, target: link?.target ?? null, rel: link?.rel ?? null, text: link?.textContent ?? '' };
  });
  check('the sidebar entry opens the module in a new tab, not embedded',
    afterActivate.target === '_blank' && /noopener/.test(afterActivate.rel ?? ''), JSON.stringify(afterActivate));
  check('the sidebar entry names the module', /Debug Evolution/.test(afterActivate.text), afterActivate.text);

  await gotoIdle(`${BASE}/#/settings/modules`);
  await page.waitForSelector('#section-modules [data-owner-module-card="debug-evolution"]', { timeout: 15000 });
  await clickOrExplain(page, '#section-modules [data-owner-module-card="debug-evolution"] [data-module-action="deactivate"]');
  await page.waitForFunction(
    () => document.querySelector('#section-modules [data-owner-module-card="debug-evolution"] .badge')?.textContent?.includes('Installed'),
    { timeout: 15000 },
  );
  await gotoIdle(`${BASE}/#/home`);
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
  await gotoIdle(`${BASE}/#/chat`);
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
  await gotoIdle(`${BASE}/#/chat`);
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



  await gotoIdle(`${BASE}/#/settings/sessions`);
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
  await gotoIdle(`${BASE}/#/settings/sessions/archived`);
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
  await gotoIdle(`${BASE}/#/settings/sessions/bin`);
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
  await gotoIdle(`${BASE}/#/settings/sessions`);
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
  await gotoIdle(`${BASE}/#/settings/appearance`);
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
  await gotoIdle(`${BASE}/#/coden`);
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

  await jump('bench/shadow', 'shadow');
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

  await jump('bench/diff', 'diff');
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
  await gotoIdle(`${BASE}/#/settings/sessions`);
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
  await gotoIdle(`${BASE}/#/coden`);
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
  //
  // F-PANEL-001 (D-0449) — same root cause as F-COMMAND-001, see `submitCodenAddress` above.
  await submitCodenAddress(page, '/coden/agent/plan');
  await page.waitForSelector('[data-agent-panel="plan"].active', { timeout: 15000 });
  // The baseline the control below measures against: opening the Plan panel renders the
  // unattached list once (app.js:305), and with no chatless run yet it is the declared-empty
  // text. Waited for explicitly so the delay installed next lands on the POST-submit refresh
  // and not on a panel-open fetch still in flight.
  let unattachedBaseline = true;
  try {
    await page.waitForFunction(
      () => /Every run in this session belongs to a chat/
        .test(document.querySelector('#unattachedRuns')?.textContent ?? ''),
      { timeout: 15000 },
    );
  } catch { unattachedBaseline = false; }
  // F-E2E-001 — the delay that makes the race deterministic instead of hoped for.
  //
  // The next response to `?scope=unattached` is held for 2.5s, once. Nothing about the
  // product changes: `api()` calls the bare global `fetch` (app.js:220), so the shim is the
  // slow link a real installation can have at any moment, applied on purpose at the one
  // instant this check depends on it. It restores itself the moment it fires.
  await page.evaluate(() => {
    const realFetch = window.fetch;
    window.__noesarUnattachedRealFetch = realFetch;
    window.__noesarUnattachedDelayFired = false;
    window.fetch = function delayUnattachedOnce(input, init) {
      const url = String(typeof input === 'string' ? input : (input?.url ?? ''));
      if (!window.__noesarUnattachedDelayFired && url.includes('scope=unattached')) {
        window.__noesarUnattachedDelayFired = true;
        window.fetch = realFetch;
        return realFetch.call(window, input, init)
          .then((response) => new Promise((resolve) => { setTimeout(() => resolve(response), 2500); }));
      }
      return realFetch.call(window, input, init);
    };
  });
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
  //
  // F-E2E-001, closed here (D-0503). This block used to read the three fields immediately
  // after the badge said "pending approval". Those facts are written by TWO different awaits
  // inside submitPlanForm(): renderWorkspaceRun() sets the badge (app.js:3044), and the
  // unattached list is only refreshed four lines later, after a second round trip
  // (app.js:3058). Waiting on the badge is waiting on a signal written BEFORE the evidence —
  // green whenever that fetch happened to be quick, red when it was not. Two independent
  // observations, four days apart (2026-08-13 and 2026-08-17), both with the same symptom:
  // declared text correct, listed text the all-attached empty state, count empty. The product
  // was never at fault and must not be changed for this: it does refresh the list.
  //
  // The control is permanent, in the shape D-0499 established: a wait nobody can see fail is
  // indistinguishable from no wait at all, so the delay above guarantees the stale window and
  // this check asserts the OLD read really does land inside it. If a future change makes the
  // list refresh before the badge, this control fails and says so — it is not decoration.
  const stale = await page.evaluate(() => ({
    fired: window.__noesarUnattachedDelayFired === true,
    listed: (document.querySelector('#unattachedRuns')?.textContent ?? '').trim(),
    count: (document.querySelector('#unattachedRunCount')?.textContent ?? '').trim(),
  }));
  check('F-E2E-001 control — the badge alone does not prove the unattached list was refreshed',
    unattachedBaseline && stale.fired && stale.count === ''
      && /Every run in this session belongs to a chat/.test(stale.listed),
    JSON.stringify({ unattachedBaseline, ...stale }).slice(0, 300));
  let unattachedWaited = true;
  try {
    await page.waitForFunction(
      () => (document.querySelector('#unattachedRunCount')?.textContent ?? '').trim() === '1'
        && /add a short note file for this e2e run/
          .test(document.querySelector('#unattachedRuns')?.textContent ?? ''),
      { timeout: 20000 },
    );
  } catch {
    // Reported through the check below with the state actually observed, never thrown: a
    // timeout escaping this step would take every later check in it with it — the failure
    // mode gotoIdle()'s own comment block was written for, measured at 205 lost checks.
    unattachedWaited = false;
  }
  const unattached = await page.evaluate(() => ({
    declared: (document.querySelector('#planAttachment')?.textContent ?? '').trim(),
    listed: (document.querySelector('#unattachedRuns')?.textContent ?? '').trim(),
    count: (document.querySelector('#unattachedRunCount')?.textContent ?? '').trim(),
  }));
  check('s327/4b — a plan created with no chat attached is listed as belonging to none',
    /belong to no chat/i.test(unattached.declared) && unattached.count === '1'
      && /add a short note file for this e2e run/.test(unattached.listed),
    JSON.stringify({ unattachedWaited, ...unattached }).slice(0, 300));
  // Whatever this block installed, this block removes — including when the shim never fired.
  await page.evaluate(() => {
    if (window.__noesarUnattachedRealFetch) window.fetch = window.__noesarUnattachedRealFetch;
  });

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

  await jump('bench/logs', 'logs');
  await page.waitForFunction(
    () => /workspace_action\.promoted/.test(document.querySelector('#workLogsContent')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const workLogs = await page.evaluate(() => document.querySelector('#workLogsContent')?.textContent ?? '');
  check("D-0230 Logs shows this run's own causal event trail through GET /api/v1/events/:correlationId, ending in a promotion",
    /workspace_action\.planned/.test(workLogs) && /workspace_action\.promoted/.test(workLogs), workLogs.slice(0, 400));

  // --- D-0230: Map — read-only repository understanding, workspace-scoped, not per-run ---
  await jump('bench/map', 'map');
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
  await jump('bench/terminal', 'terminal');
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
  //
  // F-PANEL-001, resolved (D-0461, test-strategy decision named in D-0456): this occurrence is
  // not a race like the other two — by this point the modern terminal has been live and STEADY
  // for many prior steps, so `#codenShell` staying hidden is `codenTerminalState()` doing
  // exactly what `D-0413` asked, on purpose. A retry cannot fix a steady state, and this step
  // does not need to re-prove the composer gesture (that is `submitCodenAddress`'s job above,
  // at the authority and plan-creation sites) — it only needs to REACH the panel to test
  // Restore. `jump()`, already proven for every bench panel above, does exactly that: the same
  // `location.hash` assignment `app.js`'s own composer and terminal paths both resolve to
  // (`jumpTo()`), without depending on which composer surface happens to be visible.
  await jump('agent/plan', 'plan', 'agent');
  await clickOrExplain(page, '#planRestoreBtn');
  await page.waitForFunction(
    () => /restored/i.test(document.querySelector('#planRunBadge')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const restoredBadge = await page.evaluate(() => document.querySelector('#planRunBadge')?.textContent ?? '');
  check('Restore reverts a promoted run', /restored/i.test(restoredBadge), restoredBadge);

  at('authority-form');
  // --- D-0491: #/coden/agent/authority driven end to end, not merely reached ---------------
  // The 55-page review named this the single highest-priority e2e gap of the whole pass: the
  // capability-token security core (path-plan -> authorize, gated by Owner reauth) has 8
  // backend suites plus a dedicated route suite, but nothing had ever proven that the button
  // the Owner actually clicks reaches that backend. The earlier check in this file (~line 833)
  // only proves the panel occupies pixels at its address — geometry, not the form.
  //
  // Owner Bypass mode is selected deliberately: `/api/v1/coden/authorize` only demands recent
  // strong reauthentication when `plan.mode === 'OWNER_BYPASS'` (server.mjs). Session elevation
  // is re-earned every session and never inherited (auth.mjs, verified by reading `login`/
  // `reauthenticate`), so the pre-reauth refusal below is deterministic regardless of whatever
  // this suite's earlier MFA-replacement section already did to `elevatedUntil`.
  //
  // That reasoning is now CHECKED rather than reasoned about (`D-0498`'s improvement, authorised
  // by the Owner): if a future edit moves this block above something that elevates the session,
  // the guard fails here and names the cause, instead of the pre-reauth refusal below silently
  // never arriving and surfacing as an opaque 15s timeout.
  await checkSessionNotElevated('authority-form');
  resetObservations();
  await jump('agent/authority', 'authority', 'agent');
  await clickOrExplain(page, '[data-mode="OWNER_BYPASS"]');
  await page.waitForSelector('#ownerReauth:not(.hidden)', { timeout: 15000 });

  const authorityPath = 'e2e-notes/authority-e2e-check.txt';
  await page.$eval('#pathInput', (node) => { node.value = ''; });
  await page.type('#pathInput', authorityPath);
  await page.select('#operation', 'write');
  await clickOrExplain(page, '#analyzePath');
  await page.waitForFunction(
    () => document.querySelector('#approvalControls')?.classList.contains('hidden') === false,
    { timeout: 15000 },
  );
  const analyzed = await page.evaluate(() => document.querySelector('#pathResult')?.textContent ?? '');
  check('Analyze reaches the real path-plan endpoint and returns a plan, not a placeholder',
    requestWasMade('/api/v1/coden/path-plan') && /canonicalPath/.test(analyzed) && /consentOptions/.test(analyzed)
      && !/"blocked": ?true/.test(analyzed),
    analyzed.slice(0, 300));

  // The gate itself, exercised negatively first: proving Authorize is refused NOW is what
  // makes the pass below mean something, rather than the session having been elevated all
  // along from an earlier step.
  await page.select('#consentScope', 'ONE_OPERATION');
  await clickOrExplain(page, '#authorizePlan');
  await page.waitForFunction(
    () => /Recent strong reauthentication/i.test(document.querySelector('#statusMessage')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const preReauthRefusal = await page.evaluate(() => ({
    message: document.querySelector('#statusMessage')?.textContent ?? '',
    isError: document.querySelector('#statusMessage')?.classList.contains('error') ?? false,
  }));
  check('Authorize is refused before reauth — the security gate is real, not decorative',
    /Recent strong reauthentication/i.test(preReauthRefusal.message) && preReauthRefusal.isError,
    JSON.stringify(preReauthRefusal));

  // `newSecret` (not the original `totpSecret`) is the account's active authenticator from the
  // MFA-replacement flow above; `nextRealStepCode`, not `freshCode`, because many steps on this
  // secret have already been consumed by other checks between here and there — same reasoning
  // as the re-login step this file already uses that secret for.
  const reauthCode = await nextRealStepCode(newSecret);
  await page.type('#reauthPassword', PASSWORD);
  await page.type('#reauthTotp', reauthCode);
  await clickOrExplain(page, '#reauthButton');
  await page.waitForFunction(
    () => /unlocked/i.test(document.querySelector('#pathResult')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const unlocked = await page.evaluate(() => document.querySelector('#pathResult')?.textContent ?? '');
  check('Owner reauth with a live TOTP code unlocks Owner scope through the real endpoint',
    requestWasMade('/api/v1/auth/reauth') && /unlocked/i.test(unlocked), unlocked.slice(0, 200));

  // POSITIVE CONTROL for the two `checkSessionNotElevated` guards above — this is the only
  // moment in the whole suite when the session is KNOWN to be elevated, so it is the only place
  // the guard's detector can be shown to discriminate rather than merely to pass.
  //
  // Without this, both guards could report "not elevated" for a reason that has nothing to do
  // with elevation — a renamed field, a 401, a shape change in `/api/v1/auth/me` — and would
  // still show green forever. That is the "a clean scan proves the scanner found nothing, never
  // that the code is correct" rule, applied to this harness's own instrument. It is a permanent
  // assertion rather than a temporary experiment deleted after one run, because the detector has
  // to keep discriminating, not merely have discriminated once.
  const elevatedNow = await sessionElevation();
  check('the elevation detector reports ELEVATED right after a real reauth — the guards above discriminate, they do not merely pass',
    elevatedNow.readable && elevatedNow.elevated && elevatedNow.elevatedUntil > 0,
    JSON.stringify(elevatedNow));

  await clickOrExplain(page, '#authorizePlan');
  await page.waitForFunction(
    () => /"consentScope"/.test(document.querySelector('#pathResult')?.textContent ?? ''),
    { timeout: 15000 },
  );
  const authorized = await page.evaluate(() => document.querySelector('#pathResult')?.textContent ?? '');
  check('Authorize succeeds once reauth is live and returns a real grant, not a decorative echo',
    requestWasMade('/api/v1/coden/authorize') && /"consentScope": ?"ONE_OPERATION"/.test(authorized)
      && /"expiresAt"/.test(authorized) && !/"error"/i.test(authorized),
    authorized.slice(0, 300));

  // The status line's live-authority list is populated once, on entering the `coden` region
  // (`renderBenchStatus`, app.js) — re-entering fires it again, which is the only way the UI
  // itself learns the grant just minted through the form is live, rather than asserting the
  // grant exists straight off the API response above.
  await jump('bench/logs', 'logs');
  await jump('agent/authority', 'authority', 'agent');
  await page.waitForFunction(
    () => !(document.querySelector('#liveAuthorityList')?.textContent ?? '').includes('Nothing is granted'),
    { timeout: 15000 },
  );
  const live = await page.evaluate(() => ({
    count: document.querySelector('#liveAuthorityCount')?.textContent ?? '',
    list: document.querySelector('#liveAuthorityList')?.textContent ?? '',
  }));
  check('the status line reflects the grant just authorized through the form, not a stale placeholder',
    Number(live.count) >= 1 && live.list.includes('authority-e2e-check.txt'), JSON.stringify(live).slice(0, 300));

  at('closure');
  // --- the NOT DONE box · UI-036, Critical --------------------------------
  //
  // The rule is that the box cannot be empty WITHOUT SAYING SO. Both halves are
  // exercised: an empty box is refused, and an empty box that is declared is accepted.
  await jump('bench/closure', 'closure');
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
  await gotoIdle(`${BASE}/#/home`);
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
  await gotoIdle(`${BASE}/#/coden-tui`);
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
  await gotoIdle(`${BASE}/#/home`);
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

  await gotoIdle(`${BASE}/#/home`);
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

  await gotoIdle(`${BASE}/#/home`);
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

  await leaveCodenTerminal();
  at('page-help');
  // --- POINT 3c: the information buttons, on the real page ------------------------------
  //
  // Owner: «vanno messi i tasti `i` di informazione che cliccando danno suggerimenti». The unit
  // test proves every page HAS an entry; only the browser proves the button is placed, opens,
  // says something, and closes. A help button that renders behind the header or never opens is
  // perfectly correct to a source reader.
  await soft('POINT-3C', async () => {
    const destinations = ['home', 'models', 'projects', 'settings/security', 'not-found'];
    for (const destination of destinations) {
      await gotoIdle(`${BASE}/#/${destination}`);
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      const seen = await page.evaluate(() => {
        // The INNERMOST active thing, not the first match in document order. On a settings
        // section both the Settings shell and the section itself are active and both carry a
        // button — reading the shell's while claiming to read the section's would be a check
        // that passes while measuring something else.
        const active = document.querySelector('.settings-section.active') ?? document.querySelector('.view.active');
        const button = active?.querySelector(':scope > .section-header > .help-button, :scope > .hero > .help-button');
        if (!button) return { present: false, text: '', opened: false, expanded: false, visible: false, installError: document.body.dataset.helpError ?? null };
        button.click();
        const panel = document.querySelector('#pageHelp');
        return {
          present: true,
          installError: document.body.dataset.helpError ?? null,
          visible: (button.getBoundingClientRect().height ?? 0) > 0,
          opened: panel && !panel.classList.contains('hidden'),
          text: (panel?.textContent ?? '').trim(),
          expanded: button.getAttribute('aria-expanded') === 'true',
        };
      });
      check(`POINT-3C #/${destination} has an information button, on screen`,
        seen.present && seen.visible, JSON.stringify(seen).slice(0, 120));
      check(`POINT-3C clicking it says both what the page is and what to do here`,
        seen.opened && /What this is/i.test(seen.text) && /worth doing/i.test(seen.text) && seen.text.length > 150,
        `${destination}: ${seen.text.slice(0, 120)}`);
      check(`POINT-3C and it reports its state to assistive technology`, seen.expanded === true);
      // Escape closes it: a panel that can only be dismissed with the mouse is a trap for
      // anyone driving this from the keyboard.
      await page.keyboard.press('Escape');
      const closed = await page.evaluate(() => document.querySelector('#pageHelp')?.classList.contains('hidden'));
      check(`POINT-3C Escape closes it`, closed === true);
    }
  });

  await leaveCodenTerminal();
  at('page-liveness');
  // --- POINT 3b: opening a page actually goes and asks --------------------------------
  //
  // Owner: «mi sembrano tutte pagine statiche». `tools/measure-page-liveness.mjs` proves the
  // WIRING from source and is exhaustive over pages; this proves the BEHAVIOUR on the running
  // product. Both are needed: a loader that is registered and throws on its first line is live
  // to a source reader and dead to a person.
  await soft('POINT-3B', async () => {
    // Counted PER NAVIGATION and reset each time. "Some requests happened" is satisfied by any
    // other page's traffic, which is how a check like this passes while measuring nothing.
    const seen = [];
    const listener = (request) => { if (/\/api\/v1\//.test(request.url())) seen.push(request.url()); };
    page.on('request', listener);
    try {
      for (const destination of ['projects', 'documents', 'knowledge', 'agents', 'tools', 'chat']) {
        await gotoIdle(`${BASE}/#/home`);
        seen.length = 0;
        await gotoIdle(`${BASE}/#/${destination}`);
        await new Promise((resolve) => { setTimeout(resolve, 400); });
        check(`POINT-3B opening #/${destination} asks the server for fresh data`,
          seen.length > 0,
          'no /api/v1/ request was made — this page paints whatever was fetched at sign-in');
      }
    } finally {
      page.off('request', listener);
    }
  });

  await leaveCodenTerminal();
  at('agents-lifecycle');
  // D-0397/D-0401. The Agents screen was only ever measured EMPTY: the route sweep opens
  // #/agents against a workspace with no agent, so the card, its two controls and the archive
  // path were invisible to every suite in this repository. The Owner found that gap by looking
  // at the running product — the expensive way. A control nothing exercises is a control nobody
  // can prove exists (rule 5 of `17`).
  await soft('AGENTS-1', async () => {
    const name = `Suite agent ${Date.now()}`;
    await gotoIdle(`${BASE}/#/agents`);
    await page.type('#agentName', name);
    await page.click('#agentForm button.primary');
    await page.waitForFunction(() => document.querySelectorAll('#agentList .entity-card').length > 0, { timeout: 10_000 });

    const card = await page.evaluate(() => {
      const article = document.querySelector('#agentList .entity-card');
      return {
        title: article?.querySelector('h3')?.textContent ?? null,
        test: article?.querySelector('[data-test-agent]')?.textContent ?? null,
        archive: article?.querySelector('[data-archive-agent]')?.textContent ?? null,
        goalField: Boolean(article?.querySelector('[data-agent-goal]')),
      };
    });
    check('AGENTS-1 a created agent appears as a card, not only as an option in two selectors',
      card.title === name, `card title was ${JSON.stringify(card.title)}`);
    check('AGENTS-1 the card carries both controls and the field the test needs',
      Boolean(card.test) && Boolean(card.archive) && card.goalField, JSON.stringify(card));

    // The archive path end to end, through the confirmation the operator really sees. Accepting
    // the dialog is the point: a control that opens a confirm nobody answers proves nothing.
    const accept = (dialog) => dialog.accept();
    page.on('dialog', accept);
    try {
      await page.click('[data-archive-agent]');
      await page.waitForFunction(() => document.querySelectorAll('#agentList .entity-card').length === 0, { timeout: 10_000 });
    } finally {
      page.off('dialog', accept);
    }
    const after = await page.evaluate(() => ({
      cards: document.querySelectorAll('#agentList .entity-card').length,
      options: [...document.querySelectorAll('#runAgent option')].map((option) => option.textContent),
    }));
    check('AGENTS-1 archiving removes the agent from the list AND from the Plan run selector',
      after.cards === 0 && !after.options.includes(name), JSON.stringify(after));
  });

  await leaveCodenTerminal();
  at('model-catalogue');
  // --- POINT 5: the model catalogue, on the real page -----------------------------------
  //
  // Owner, s318 and again s333: «su #/models deve esserci un menu con i modelli e i modelli
  // scaricati e installati devono sempre visualizzarsi per primi». Designed in s320 with
  // "nothing here is implemented" at the top of the design, which stayed true for thirteen
  // sessions. `npm test` reads app.js as TEXT and never runs it, so a catalogue that renders
  // only in a unit test is a catalogue nobody has ever seen.
  await soft('POINT-5', async () => {
    resetObservations();
    await gotoIdle(`${BASE}/#/models`);
    await page.waitForSelector('#modelForegroundLanes', { timeout: 15000 });
    await page.waitForFunction(
      () => !/Loading/.test(document.querySelector('#modelForegroundLanes')?.textContent ?? 'Loading'),
      { timeout: 15000 });

    const view = await page.evaluate(() => ({
      foreground: (document.querySelector('#modelForegroundLanes')?.textContent ?? '').trim(),
      foregroundCount: document.querySelector('#modelForegroundCount')?.textContent ?? '',
      available: (document.querySelector('#modelAvailableList')?.textContent ?? '').trim(),
      badge: document.querySelector('#modelAcquireState')?.textContent ?? '',
      reason: document.querySelector('#modelAcquireReason')?.textContent ?? '',
      pager: document.querySelector('#modelPageLabel')?.textContent ?? '',
      // The order on the page IS the requirement: what you have must come before what you could get.
      foregroundBeforeAvailable:
        (document.querySelector('#modelForeground')?.getBoundingClientRect().top ?? 0)
        < (document.querySelector('#modelAvailableList')?.getBoundingClientRect().top ?? 0),
      filtersDrawn: document.querySelectorAll('#modelFilterType option').length,
    }));

    check('POINT-5 the catalogue renders instead of staying on Loading',
      view.foreground.length > 0 && !/Loading/.test(view.foreground), view.foreground.slice(0, 160));
    check('POINT-5 what you have is drawn ABOVE what you could get — the Owner\'s «sempre per primi»',
      view.foregroundBeforeAvailable, JSON.stringify({ order: view.foregroundBeforeAvailable }));
    check('POINT-5 the pager belongs to the available lane only', /Page \d+ of \d+/.test(view.pager), view.pager);
    // MC-006 on the live page: the runtime is disabled on this installation, so the gesture
    // must be present, off, and carrying the sentence that says where it turns on.
    check('POINT-5 MC-006 a disabled runtime is declared rather than hidden',
      /unavailable/i.test(view.badge) && /switched off/i.test(view.reason), `${view.badge} :: ${view.reason}`);
    check('POINT-5 an empty lane says it is empty rather than showing nothing',
      view.foreground.length > 0 && view.available.length > 0,
      `${view.foreground.slice(0, 80)} | ${view.available.slice(0, 80)}`);
    check('POINT-5 the declared groupings are offered as filters, built from the live catalogue',
      view.filtersDrawn >= 1, `${view.filtersDrawn} type options`);
    check('POINT-5 the page made no failed request', failedRequests.length === 0, failedRequests.join(' | '));

    // The route refuses what it should refuse, on the real server: acquiring is egress plus a
    // write plus an execution, and this installation consents to none of them.
    const refusal = await page.evaluate(async () => {
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('noesar_csrf='))?.split('=')[1] ?? '';
      const response = await fetch('/api/v1/models/acquire', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) },
        body: JSON.stringify({ id: 'anything-at-all' }),
      });
      return { status: response.status, body: await response.text() };
    });
    check('POINT-5 MC-001 acquiring an unknown descriptor is refused, not attempted',
      [403, 404].includes(refusal.status), `${refusal.status} ${refusal.body.slice(0, 140)}`);
  });

  at('coden-slash-feedback');
  // --- POINT 2b: what a person actually SEES when a `/` command lands ------------------
  //
  // Owner, s333 point 2: «i comandi / non so se funzionano, non vedo cambiamenti e non si
  // capisce». s328's precedent forbids assuming this is styling: a menu entry was found with
  // no address at all. So the question is asked in the order that can distinguish them —
  // first "did it route", then "was anything visible about it" — and both answers are
  // recorded even when the first is yes.
  await soft('POINT-2B-MEASURE', async () => {
    // Historical note kept because it is the evidence for the design below, not decoration.
    // `F-SLASH-001` (2026-08-15, `D-0463`) — CLOSED by `D-0501` with the Owner's design A.
    //
    // A one-shot pre-click check (composer height/display/terminal state, evaluated once right
    // before the click) never fired before a retry existed — the composer was still visible
    // at that single check — which first looked like a race narrower than one check could
    // catch. It is not: driven over a SECOND run, wrapping the click in the same 5-attempt
    // retry `submitCodenAddress` above uses for its own race, the composer state came back
    // IDENTICAL across all 5 attempts spanning a full second — `height:0` while
    // `terminalState:'live'`, unchanged. That is steady state, the same class as `F-PANEL-001`
    // (D-0461): on a fresh `gotoIdle` page load, the modern terminal has already reached
    // `live` and retired `#codenPrompt` by design (`D-0413`) before this check ever gets a
    // turn — not a timing gap a retry can close.
    //
    // A `jump()`-style bypass was rejected as the answer here, unlike at `F-PANEL-001`'s fix
    // site: this step exists to test a GESTURE and its visible feedback, and setting
    // `location.hash` directly would assert that the address resolves while proving nothing
    // about what a person typing sees. So the gesture moved to the surface that actually
    // receives it.
    // ---------------------------------------------------------------------------------
    // DESIGN A, chosen by the Owner 2026-08-17, closing `F-SLASH-001` (`D-0463`/`D-0501`).
    //
    // What this step used to do, and why it could not work: it drove `#codenPrompt`, the LEGACY
    // composer. On a fresh `#/coden` load the modern terminal reaches `live` and retires that
    // composer BY DESIGN (`D-0413`) — measured as steady state, `height:0` unchanged across a
    // full second of retries, not a race a retry could close. So the step was reaching for a
    // surface a person does not have, and its assertions about `[data-bench-panel].active`
    // described a path the visible surface never takes.
    //
    // The Owner's original complaint is the reason design A was chosen over design B: «i comandi
    // / non so se funzionano, non vedo cambiamenti e non si capisce». The terminal IS the surface
    // a person is looking at, so that complaint has to be answered there or it is not answered.
    //
    // What the terminal really does with these commands — read out of the product before writing
    // a single assertion, never guessed:
    //   bare `/diff`   -> `planTurn` returns `kind:'navigate'` (a panel owns it), and the
    //                     terminal records `→ /diff`, then the `because` sentence
    //                     ("`/diff` needs <run> to run, so this is the panel that shows it"),
    //                     then renders the address inline via `showAddress()` — which for the
    //                     three run-scoped addresses with no run emits a `Usage:` line
    //                     (`coden-address-views.mjs:145,177`). It never touches
    //                     `[data-bench-panel].active`, which is exactly why the old assertions
    //                     could not pass here.
    //   `/diff <run>`  -> `kind:'call'`, `workspace.get({runId})`
    //                     (`coden-view-model.js:51`), recorded as `diff — ok` plus
    //                     `detailLines(result)` (`coden-terminal.js:454`; `command` is the bare
    //                     name, `coden-view-model.js:602`).
    //   bare `/approve`-> `kind:'needs-argument'` — NO panel owns it, so it says what is missing
    //                     and runs nothing. A different branch of the same decision, asserted
    //                     too, so a repair to one branch cannot look like both.
    //
    // Panel routing itself is NOT left unproven by moving off the composer: `jump()` covers
    // every bench panel and, since `F-PANEL-001`'s repair (`D-0461`), agent panels as well.
    await openLiveTerminal();
    const screenBefore = (await screenText()).replace(/\s+/g, ' ').trim();

    // 1 · bare `/diff` — composed, submitted, and answered on the surface a person sees.
    await page.click('#codenTerminalHost iframe.coden-terminal-embed');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await typeIntoTerminal('/diff');
    const composed = await promptRow();
    check('POINT-2B the command is composed on the terminal prompt, exactly as typed',
      composed === '/diff', `prompt row: "${composed}" (input path ${lastInputPath})`);

    await submitTerminalLine();
    await soft('POINT-2B the terminal answers the bare command', async () => {
      await terminalFrame().waitForFunction(
        () => /needs/.test(document.querySelector('#terminalHost')?.textContent ?? ''),
        { timeout: 15000 },
      );
    });
    const bare = (await screenText()).replace(/\s+/g, ' ').trim();
    const bareMarkers = {
      arrow: /→\s*\/diff/.test(bare),
      why: /needs\s+<run>/.test(bare),
      // Informational only, deliberately NOT asserted: the `Usage:` line `showAddress()` emits
      // for a run-scoped address with no run is real, but whether it is still on the visible
      // rows depends on how far the transcript has scrolled — measured true in one run and
      // false in the next, on identical code. Asserting it would buy a flake, not coverage.
      usage: /Usage:/.test(bare),
      refused: /refused/i.test(bare),
      error: /is not a function|undefined/i.test(bare),
      // Anchored on the marker rather than a blind tail, for the reason spelled out at the
      // `/approve` check below: a `slice(-260)` of this screen showed the wrong entry.
      around: (bare.match(/.{0,70}needs <run>.{0,70}/) ?? ['(marker not on screen)'])[0],
    };

    // The literal complaint, asserted literally: something on the visible surface changed.
    check('POINT-2B «non vedo cambiamenti» — the visible surface DID change when the command landed',
      bare !== screenBefore && bare.length > screenBefore.length,
      `before ${screenBefore.length} chars, after ${bare.length}`);
    check('POINT-2B the command is acknowledged where a person is looking — in the terminal transcript',
      bareMarkers.arrow, JSON.stringify(bareMarkers));
    // «non si capisce», answered: a move for an unstated reason is the same defect seen from the
    // other side, so the REASON must be on screen, not merely the movement.
    check('POINT-2B it states WHY it showed the panel instead of running, and fires no doomed call',
      bareMarkers.why && !bareMarkers.refused && !bareMarkers.error, JSON.stringify(bareMarkers));

    // 2 · the same command WITH a real run — the half no surface had ever exercised. `planRunId`
    // comes from the `workspace-actions` step's own plan, so this is a run this suite really
    // created, not a fabricated id.
    if (!planRunId) {
      check('POINT-2B `/diff <run>` could not be driven — no run id came from the workspace-actions step',
        false, 'planRunId is undefined; the earlier step must have failed — declared, not skipped silently');
    } else {
      await page.click('#codenTerminalHost iframe.coden-terminal-embed');
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyU');
      await page.keyboard.up('Control');
      await typeIntoTerminal(`/diff ${planRunId}`);
      await submitTerminalLine();
      // Waited on the ANSWER's own marker, never on the run id.
      //
      // Measured, first attempt: waiting for the id to appear was satisfied INSTANTLY by the
      // terminal's echo of the submitted line — `record('user', typed)` runs before the call
      // (`coden-terminal.js:442`) — so the wait returned before any answer existed and the
      // assertion read a screen that only held its own input back. A wait a check can satisfy
      // by itself proves nothing, and it is the same lesson the `/help` submission above already
      // records for `Commands:` versus `/logout`: pick a marker only the real outcome produces.
      //
      // Both outcomes are waited for, not just the good one, so a genuine refusal is measured
      // rather than timing out into a bare "waiting failed".
      await soft('POINT-2B the terminal answers `/diff <run>` (not merely echoes it)', async () => {
        await terminalFrame().waitForFunction(
          () => /—\s*ok|NOT_FOUND|refused|no run/i.test(document.querySelector('#terminalHost')?.textContent ?? ''),
          { timeout: 15000 },
        );
      });
      const withRun = (await screenText()).replace(/\s+/g, ' ').trim();
      const runMarkers = {
        ok: /diff\s+—\s+ok/.test(withRun),
        echoedTheId: withRun.includes(planRunId),
        carriesRunFields: /"status"|"runId"|"files"/.test(withRun),
        notFound: /NOT_FOUND|no run/i.test(withRun),
        refused: /refused/i.test(withRun),
        // The box-drawing frame dominates a raw tail and pushed the actual answer out of the
        // first version of this diagnostic. Stripped, so the excerpt shows the transcript.
        excerpt: withRun.replace(/[─│╭╮╰╯]/g, '').replace(/\s+/g, ' ').trim().slice(-320),
      };
      check('POINT-2B `/diff <run>` runs the real call and shows that run\'s own content, not a placeholder',
        runMarkers.ok && !runMarkers.notFound && !runMarkers.refused,
        JSON.stringify({ ...runMarkers, runId: planRunId }));
    }

    // 3 · a command NO panel owns — the other branch of the same decision. It must name what is
    // missing and run nothing, never surface a server refusal for a call nobody asked to make.
    await page.click('#codenTerminalHost iframe.coden-terminal-embed');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Control');
    await typeIntoTerminal('/approve');
    await submitTerminalLine();
    await soft('POINT-2B the terminal answers a command no panel owns', async () => {
      await terminalFrame().waitForFunction(
        () => /Nothing was run/.test(document.querySelector('#terminalHost')?.textContent ?? ''),
        { timeout: 15000 },
      );
    });
    const noPanel = (await screenText()).replace(/\s+/g, ' ').trim();
    // Reported as PRESENCE, not as a tail slice. A blind `slice(-260)` of this screen is an
    // unreliable window on what just happened — measured: it showed the middle of the PREVIOUS
    // command's JSON while the marker this check asserts on was present and confirmed by two
    // independent reads. A diagnostic that shows the wrong entry is worse than a short one,
    // because the next session reads it as evidence.
    const noPanelMarkers = {
      saysNothingRan: /Nothing was run/.test(noPanel),
      saysWhatItNeeds: /needs/.test(noPanel),
      refused: /refused/i.test(noPanel),
      around: (noPanel.match(/.{0,60}Nothing was run.{0,60}/) ?? ['(marker not on screen)'])[0],
    };
    check('POINT-2B a command no panel owns says what it needs and runs nothing',
      noPanelMarkers.saysNothingRan && noPanelMarkers.saysWhatItNeeds && !noPanelMarkers.refused,
      JSON.stringify(noPanelMarkers));
  });

  await leaveCodenTerminal();
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
    await gotoIdle(`${BASE}/#/home`);
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
      await gotoIdle(`${BASE}/#/${destination}`);
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
    // Measured, not estimated, and TIGHTENED every time it falls — that is what makes it a
    // ratchet rather than a floor. 623 -> 598 -> 607.
    //
    // The middle step was a repair: the route announcer composed an already-translated heading
    // with the word "view", and fixing that one composed string closed twenty-five at once
    // across every page.
    //
    // The last step went UP, and the honest reading matters more than the number. Nothing
    // regressed: point 3b made six destinations re-fetch when opened, so their list renderers
    // now paint DURING the measured window instead of only at sign-in, before this check
    // clears its record. Forty-two strings that had always been untranslated became visible
    // for the first time; thirty-three were then translated, and the rest carry digits.
    //
    // Which exposes the one thing a ratchet cannot do, written down rather than discovered:
    // it cannot tell "the product got worse" from "the measurement got wider". When this
    // number rises, the diff of the untranslated set is what says which happened — and the
    // baseline may only be re-taken after that diff has been read.
    const RUNTIME_GAP_BASELINE = 607;
    check('I18N-RUNTIME the catalogue-closable gap does not grow (declared gap, not a pass)',
      Array.isArray(closable) && closable.length <= RUNTIME_GAP_BASELINE,
      // On a rise, the SAMPLE is printed, not only the count. The paragraph above says the
      // baseline may be re-taken only after the diff has been read — and until this run the
      // check printed nothing to read it FROM, so reading it meant editing the harness and
      // paying for a second full run. Twenty strings are enough to tell "the product got worse"
      // from "the measurement got wider", which is the only question the number cannot answer.
      `${closable ? closable.length : '?'} closable of ${Array.isArray(missed) ? missed.length : '?'} recorded, declared baseline ${RUNTIME_GAP_BASELINE}`
      + (Array.isArray(closable) && closable.length > RUNTIME_GAP_BASELINE
        ? ` — sample of the untranslated set: ${JSON.stringify(closable.slice(0, 20))}` : ''),
      // The one declared gap in this suite (F-I18N-002). Its red is tracked, not news — which
      // is why the run that produces it has nothing to diagnose and may delete its workspace.
      // It stays a FAIL and still exits non-zero: this exempts the DISK, never the verdict.
      { declaredGap: 'F-I18N-002' });
    check('I18N-RUNTIME the static markup half is complete, and is measured separately',
      true, 'tools/measure-ui-language-coverage.mjs — 793 of 793, fails on one gap');

    // Leave the interface in the source language: every later check reads English.
    await page.select('#languageSelect', 'en');
    await page.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 10000 });
  });

  at('invitation');
  // --- an invitation can be issued -----------------------------------------
  resetObservations();
  await gotoIdle(`${BASE}/#/users`);
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
  await gotoIdle(BASE);
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

  await gotoIdle(`${BASE}/#/users`);
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
  await gotoIdle(BASE);
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
  await gotoIdle(`${BASE}/#/logs`);
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
  await gotoIdle(`${BASE}/#/settings/security`);
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
    // What the BROWSER said. Without this a module that fails to load looks identical to a
    // selector that was never going to match, and the two need opposite repairs.
    context += ` :: console: ${consoleErrors.slice(0, 5).join(' | ').slice(0, 600)}`;
  } catch { context = '(page state unavailable)'; }
  check(`harness completed without throwing [step: ${step}]`, false, `${error.message} :: ${(error.stack ?? '').split('\n').slice(0, 6).join(' | ')} :: ${context}`);
} finally {
  await browser.close();
}

console.log('');
console.log(`BROWSER_E2E_TOTAL=${results.length}`);
console.log(`BROWSER_E2E_PASS=${results.length - failures}`);
console.log(`BROWSER_E2E_FAIL=${failures}`);
// The split the runner's retention policy reads (F-E2EDISK-001). DECLARED failures are the
// tracked, already-written-down gaps; UNDECLARED is everything else — the only number that
// means "something here is worth keeping the workspace for".
console.log(`BROWSER_E2E_FAIL_DECLARED=${declaredFailures}`);
console.log(`BROWSER_E2E_FAIL_UNDECLARED=${failures - declaredFailures}`);
// A declared gap that PASSES is news, not silence: it means the gap closed and the exemption
// is now covering a check that no longer needs it. Printed so the next session sees it without
// having to go looking — an exemption nobody re-reads is how a ratchet stops ratcheting.
for (const closed of results.filter((entry) => entry.ok && entry.declaredGap)) {
  console.log(`BROWSER_E2E_DECLARED_GAP_CLOSED=${closed.declaredGap}  — ${closed.name}`);
}
// Unchanged, deliberately: a red check keeps this process non-zero whatever kind it is. The
// declared/undeclared split governs what is kept on DISK, never whether the suite passed.
process.exit(failures === 0 ? 0 : 1);

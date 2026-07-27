// SPDX-License-Identifier: AGPL-3.0-or-later
//
// WCAG 2.2 AA audit — WP-2. `01_PRODUCT/15` targets "keyboard operation, screen readers,
// visible focus, scaling, reduced motion, high contrast, RTL-ready layout, accessible charts
// and recovery instructions". Until this file existed there was no evidence either way.
//
// ## Only sound checks
//
// Every check here is computed from what the browser actually resolved, and anything that
// cannot be computed honestly is reported as UNRESOLVED rather than counted as a pass. This
// project has twice written a static analyser for a real defect class and REJECTED it as
// unsound rather than ship noise, and the rule stands: a checker whose output has to be
// ignored is worse than no checker.
//
// Two consequences worth stating plainly:
//
//   * **Contrast against a gradient.** A single ratio does not exist. Rather than skip those
//     elements (which would silently exempt most of this interface, since every panel is a
//     gradient) the audit parses the gradient's colour stops and takes the WORST ratio across
//     them. That is conservative in the correct direction: it can report a failure that a
//     particular pixel does not have, never the reverse.
//   * **Screen readers are NOT tested.** No screen reader runs here. What is tested is the
//     accessibility tree Chromium exposes — accessible names, roles, landmarks. That is a
//     necessary condition, not a sufficient one, and it is reported under its own name.
//
// ## What this audit does not cover
//
// Printed at the end, every run, so a clean result is never mistaken for full conformance.
import puppeteer from 'puppeteer';

const BASE = process.env.NOESAR_E2E_BASE_URL;
const SETUP_TOKEN = process.env.NOESAR_E2E_SETUP_TOKEN;
if (!BASE || !SETUP_TOKEN) {
  console.error('NOESAR_E2E_BASE_URL and NOESAR_E2E_SETUP_TOKEN are required');
  process.exit(1);
}

const PASSWORD = 'audit-owner-passphrase-not-a-real-secret-42';
const results = [];
let failures = 0;
let step = 'start';

function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function note(name, detail) {
  console.log(`NOTE  ${name}  — ${detail}`);
}
function at(name) { step = name; }

// TOTP, so the audit can sign itself in without a real credential.
import { createHmac } from 'node:crypto';
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpCode(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

// ---------------------------------------------------------------------------------
// The in-page toolkit. Injected once per page load and used by several checks.
// ---------------------------------------------------------------------------------
const TOOLKIT = `
window.__a11y = (() => {
  const INTERACTIVE = 'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function parseColor(value) {
    if (!value) return null;
    const match = /rgba?\\(([^)]+)\\)/.exec(value);
    if (!match) return null;
    const parts = match[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  // Every rgb()/rgba() colour stop inside a gradient, in source order.
  function gradientStops(image) {
    const found = [];
    const pattern = /rgba?\\([^)]+\\)/g;
    let match;
    while ((match = pattern.exec(image)) !== null) {
      const colour = parseColor(match[0]);
      if (colour) found.push(colour);
    }
    return found;
  }
  function blend(top, bottom) {
    const alpha = top.a;
    return {
      r: top.r * alpha + bottom.r * (1 - alpha),
      g: top.g * alpha + bottom.g * (1 - alpha),
      b: top.b * alpha + bottom.b * (1 - alpha),
      a: 1,
    };
  }
  function luminance({ r, g, b }) {
    const channel = (value) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }
  function ratio(a, b) {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  }

  // Candidate backdrops behind an element: every non-transparent ancestor background,
  // including each gradient stop. Returns null when a raster image is involved, because
  // no colour can be derived from it without sampling pixels.
  function backdrops(element) {
    const layers = [];
    let node = element;
    while (node && node !== document.documentElement.parentNode) {
      const style = getComputedStyle(node);
      const image = style.backgroundImage;
      if (image && image !== 'none') {
        if (/url\\(/.test(image)) return { unresolved: 'background-image' };
        const stops = gradientStops(image);
        // A stop with alpha 0 paints NOTHING. It was being counted as a backdrop and then
        // blended against the page base below, which invented a candidate that never
        // appears on screen. \`transparent\` in a gradient computes to rgba(0,0,0,0), so the
        // page's own radial gradient was contributing a phantom black layer behind every
        // element on it.
        if (stops.length) layers.push(...stops.filter((stop) => stop.a > 0));
        // An OPAQUE gradient covers what is behind it exactly as an opaque colour does, and
        // the walk already stops at an opaque background-color. It did not stop at an opaque
        // gradient, so every ancestor surface stayed in the candidate list and the worst of
        // them won — reporting white text on a primary button as 1.03:1 against the page it
        // is sitting on top of, rather than against the button. Invisible while the page was
        // dark and the text was white; a wall of false failures the moment a light theme
        // existed.
        if (stops.length > 0 && stops.every((stop) => stop.a === 1)) break;
      }
      const colour = parseColor(style.backgroundColor);
      if (colour && colour.a > 0) layers.push(colour);
      if (colour && colour.a === 1 && layers.length) break;
      node = node.parentElement;
    }
    // The page's own background, resolved rather than assumed. This used to be the literal
    // #060a12, which was correct only because that happened to be the colour of the one
    // theme that existed. The moment a light theme arrived, every partially transparent
    // layer was being blended against a black page that was not there — text measured at
    // 1.2:1 against a backdrop nobody could see. A measuring instrument that carries a
    // constant from the thing it measures will be wrong the first time that thing changes.
    const pageStyle = getComputedStyle(document.documentElement);
    const base = parseColor(pageStyle.backgroundColor)?.a === 1
      ? parseColor(pageStyle.backgroundColor)
      : (gradientStops(pageStyle.backgroundImage ?? '').filter((stop) => stop.a === 1).pop()
        ?? parseColor(getComputedStyle(document.body).backgroundColor)
        ?? { r: 255, g: 255, b: 255, a: 1 });
    if (!layers.length) layers.push(base);
    // Resolve partial alpha against the page base so every candidate is opaque.
    return { layers: layers.map((layer) => (layer.a < 1 ? blend(layer, base) : layer)) };
  }

  function isLargeText(style) {
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400);
    return size >= 24 || (size >= 18.66 && weight >= 700);
  }
  function visible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    return element.offsetParent !== null || style.position === 'fixed';
  }
  // Text this element owns, not text inherited from descendants.
  function ownText(element) {
    return [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent.trim())
      .join(' ')
      .trim();
  }

  return {
    INTERACTIVE,
    ratio,
    contrastFailures(rootSelector) {
      const root = document.querySelector(rootSelector) ?? document.body;
      const failing = [];
      let unresolved = 0;
      let measured = 0;
      for (const element of root.querySelectorAll('*')) {
        const text = ownText(element);
        if (!text || !visible(element)) continue;
        const style = getComputedStyle(element);
        const foreground = parseColor(style.color);
        if (!foreground) continue;
        const backdrop = backdrops(element);
        if (backdrop.unresolved) { unresolved += 1; continue; }
        const resolvedForeground = foreground.a < 1 ? blend(foreground, backdrop.layers[0]) : foreground;
        const required = isLargeText(style) ? 3 : 4.5;
        // Worst case across every candidate backdrop: conservative by construction.
        const worst = Math.min(...backdrop.layers.map((layer) => ratio(resolvedForeground, layer)));
        measured += 1;
        if (worst < required) {
          failing.push({
            selector: element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + (element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
            text: text.slice(0, 40),
            ratio: Math.round(worst * 100) / 100,
            required,
            color: style.color,
            fontSize: style.fontSize,
          });
        }
      }
      return { failing, unresolved, measured };
    },
    // A DISABLED control is not interactive: it is not in the tab order, cannot receive
    // focus and cannot be activated, so 2.4.7 and 2.5.8 do not apply to it. Counting it
    // produced a failure that no keyboard user could ever encounter — the pager and the
    // delete button of an empty session list, which are disabled precisely because there
    // is nothing to page through or delete.
    //
    // This is an exclusion, so it is declared rather than silent: disabledSkipped()
    // reports how many were skipped, and the browser suite separately proves that the
    // same buttons DO show a focus indicator once they are enabled. An exclusion nobody
    // counts is how a green audit starts meaning less than it says.
    interactiveElements(rootSelector) {
      const root = document.querySelector(rootSelector) ?? document.body;
      return [...root.querySelectorAll(INTERACTIVE)]
        .filter(visible)
        .filter((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true');
    },
    disabledSkipped(rootSelector) {
      const root = document.querySelector(rootSelector) ?? document.body;
      return [...root.querySelectorAll(INTERACTIVE)]
        .filter(visible)
        .filter((element) => element.disabled || element.getAttribute('aria-disabled') === 'true').length;
    },
    // Target size 2.5.8 (new in WCAG 2.2): 24x24 CSS px minimum, with the standard
    // exception for links inline in a sentence.
    smallTargets(rootSelector) {
      return this.interactiveElements(rootSelector).map((element) => {
        const rect = element.getBoundingClientRect();
        const inlineLink = element.tagName === 'A' && getComputedStyle(element).display === 'inline';
        return {
          selector: element.tagName.toLowerCase() + (element.id ? '#' + element.id : ''),
          label: (element.textContent || element.value || element.getAttribute('aria-label') || '').trim().slice(0, 24),
          width: Math.round(rect.width), height: Math.round(rect.height),
          inlineLink,
        };
      }).filter((entry) => !entry.inlineLink && (entry.width < 24 || entry.height < 24));
    },
    focusSignature(element) {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow,
        style.borderColor, style.borderWidth, style.backgroundColor, style.color].join('|');
    },
    horizontalOverflow() {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflowing: doc.scrollWidth > doc.clientWidth + 1,
      };
    },
    // Elements whose own text is clipped by an ancestor that cannot scroll.
    clippedText() {
      const clipped = [];
      for (const element of document.querySelectorAll('*')) {
        if (!ownText(element) || !visible(element)) continue;
        if (element.scrollWidth > element.clientWidth + 1) {
          const style = getComputedStyle(element);
          const scrollable = /auto|scroll/.test(style.overflowX) || /auto|scroll/.test(style.overflow);
          if (!scrollable && style.textOverflow !== 'ellipsis' && style.whiteSpace !== 'nowrap') {
            clipped.push({
              selector: element.tagName.toLowerCase() + (element.id ? '#' + element.id : ''),
              scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            });
          }
        }
      }
      return clipped;
    },
    animatedElements() {
      const animated = [];
      for (const element of document.querySelectorAll('*')) {
        if (!visible(element)) continue;
        const style = getComputedStyle(element);
        const transition = style.transitionDuration.split(',').map((value) => parseFloat(value) || 0);
        const animation = style.animationDuration.split(',').map((value) => parseFloat(value) || 0);
        const maxTransition = Math.max(0, ...transition);
        const maxAnimation = Math.max(0, ...animation);
        if (maxTransition > 0 || maxAnimation > 0) {
          animated.push({
            selector: element.tagName.toLowerCase() + (element.id ? '#' + element.id : ''),
            transition: maxTransition, animation: maxAnimation,
            animationName: style.animationName,
          });
        }
      }
      return animated;
    },
    // SVG animations do not appear in animationDuration; SMIL elements are their own thing.
    smilAnimations() {
      return document.querySelectorAll('animate, animateTransform, animateMotion, set').length;
    },
    forcedColourOverrides() {
      // Declarations that survive forced-colors mode because they are !important are the
      // way a high-contrast user loses the information colour was carrying.
      const overrides = [];
      for (const sheet of document.styleSheets) {
        let rules = null;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules ?? []) {
          if (!rule.style) continue;
          for (const property of ['color', 'background-color', 'background', 'border-color']) {
            if (rule.style.getPropertyPriority(property) === 'important') {
                    overrides.push({ selector: rule.selectorText, selectorText: rule.selectorText, property, value: rule.style.getPropertyValue(property) });
            }
          }
        }
      }
      return overrides;
    },
    labelledControls() {
      const unlabelled = [];
      for (const element of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
        if (!visible(element)) continue;
        const id = element.id;
        const hasLabelFor = id && document.querySelector('label[for="' + id + '"]');
        const wrappingLabel = element.closest('label');
        const aria = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby');
        const title = element.getAttribute('title');
        if (!hasLabelFor && !wrappingLabel && !aria && !title) {
          unlabelled.push({
            selector: element.tagName.toLowerCase() + (id ? '#' + id : ''),
            type: element.getAttribute('type') || element.tagName.toLowerCase(),
            placeholder: element.getAttribute('placeholder') || null,
          });
        }
      }
      return unlabelled;
    },
    namelessControls() {
      const nameless = [];
      for (const element of this.interactiveElements('body')) {
        // Form fields are excluded here and checked by labelledControls() instead. A field
        // wrapped in a <label> has an accessible name that this element's own textContent
        // does not show, so counting it here produced a false positive on the setup form —
        // and a false finding "repaired" is a real regression introduced for nothing.
        if (/^(input|select|textarea)$/.test(element.tagName.toLowerCase())) continue;
        const name = (element.getAttribute('aria-label')
          || element.getAttribute('title')
          || element.textContent
          || element.value
          || '').replace(/\\s+/g, ' ').trim();
        if (!name) {
          nameless.push({
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            className: typeof element.className === 'string' ? element.className.slice(0, 40) : null,
          });
        }
      }
      return nameless;
    },
    graphics() {
      const list = [];
      for (const element of document.querySelectorAll('svg, canvas')) {
        if (!visible(element)) continue;
        const described = Boolean(
          element.getAttribute('role')
          || element.getAttribute('aria-label')
          || element.getAttribute('aria-labelledby')
          || element.querySelector?.('title, desc')
          || element.getAttribute('aria-hidden') === 'true');
        list.push({
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          described,
          hidden: element.getAttribute('aria-hidden') === 'true',
        });
      }
      return list;
    },
    autocompleteOnIdentityFields() {
      const fields = [];
      for (const element of document.querySelectorAll('input[type=password], input[type=text], input[type=email]')) {
        const id = (element.id || '').toLowerCase();
        if (!/user|name|pass|email|token|code|totp/.test(id)) continue;
        fields.push({ id: element.id, type: element.type, autocomplete: element.getAttribute('autocomplete') });
      }
      return fields;
    },
    landmarks() {
      return {
        main: document.querySelectorAll('main').length,
        nav: document.querySelectorAll('nav').length,
        header: document.querySelectorAll('header').length,
        footer: document.querySelectorAll('footer').length,
        h1InActiveView: document.querySelectorAll('.view.active h1').length,
        skipLink: Boolean(document.querySelector('a[href^="#"].skip-link, .skip-link')),
        htmlLang: document.documentElement.getAttribute('lang'),
      };
    },
  };
})();
`;

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(TOOLKIT);

// Surfaces are audited individually: this is a single-page application, so a check that
// only looked at the landing view would exempt every other one.
//
// A surface is no longer the same thing as a destination. The sidebar carries twelve
// destinations, and thirteen former pages now live as sections inside Settings — reachable
// only at #/settings/<section>. Auditing destinations alone would silently drop those
// thirteen surfaces from focus, target-size and contrast coverage, which is how a
// restructure turns a green audit into a smaller one.
const DESTINATIONS = [
  'home', 'chat', 'coden', 'coden-tui', 'projects', 'documents', 'knowledge',
  'agents', 'workflows', 'models', 'research', 'settings',
];
const SETTINGS_SECTIONS = [
  'sessions', 'appearance', 'language', 'about', 'licence', 'privacy', 'people',
  'security', 'models-hardware', 'storage', 'audit', 'health', 'updates',
];
const SURFACES = [
  ...DESTINATIONS.map((name) => ({ name, hash: `#/${name}`, selector: `#view-${name}`, ready: `#view-${name}.active` })),
  ...SETTINGS_SECTIONS.map((name) => ({
    name: `settings/${name}`,
    hash: `#/settings/${name}`,
    selector: `.settings-section[data-section="${name}"]`,
    ready: `.settings-section[data-section="${name}"].active`,
  })),
  // The Archive and the Bin are addresses of their own and render different controls from
  // the working list — different buttons, a return control, an expiry line. Auditing only
  // the working list would leave two surfaces unmeasured while the count still looked
  // complete: the same way a restructure shrinks an audit without turning it red.
  ...['archived', 'bin'].map((place) => ({
    name: `settings/sessions/${place}`,
    hash: `#/settings/sessions/${place}`,
    selector: '.settings-section[data-section="sessions"]',
    ready: '.settings-section[data-section="sessions"].active',
  })),
];
async function openSurface(surface) {
  await page.goto(`${BASE}/${surface.hash}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector(surface.ready, { timeout: 15000 });
}

try {
  at('sign-in');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  const begun = await page.evaluate(async ({ token, password }) => {
    const response = await fetch('/api/v1/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-noesar-setup-token': token },
      body: JSON.stringify({ username: 'owner', displayName: 'Owner', password }),
    });
    return { status: response.status, body: await response.json() };
  }, { token: SETUP_TOKEN, password: PASSWORD });
  if (begun.status !== 201) throw new Error(`setup failed: ${begun.status} ${JSON.stringify(begun.body).slice(0, 200)}`);

  const code = totpCode(begun.body.totpSecret, Date.now() - 30_000);
  const confirmed = await page.evaluate(async ({ challenge, totp }) => {
    const response = await fetch('/api/v1/auth/setup/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge, totpCode: totp }),
    });
    return { status: response.status, body: await response.json() };
  }, { challenge: begun.body.challenge, totp: code });
  if (confirmed.status !== 201) throw new Error(`confirm failed: ${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 200)}`);

  // A reload is required, not optional. The session was established by fetch, and
  // navigating to a URL that differs only by its hash is a same-document navigation — the
  // application's boot path never re-runs, so it stays on the authentication gate and every
  // gated route resolves to access-denied. Reloading makes it read the session it now has.
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#view-home.active', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  check('the audit signed itself in', await page.evaluate(() => document.querySelector('#authGate')?.classList.contains('hidden') === true));

  // --- structure and landmarks ---------------------------------------------
  at('structure');
  const landmarks = await page.evaluate(() => window.__a11y.landmarks());
  check('the document declares its language (3.1.1)', landmarks.htmlLang === 'en', `lang=${landmarks.htmlLang}`);
  check('there is exactly one main landmark (1.3.1)', landmarks.main === 1, `main=${landmarks.main}`);
  check('navigation is a landmark (1.3.1)', landmarks.nav >= 1, `nav=${landmarks.nav}`);
  check('a skip link precedes the navigation (2.4.1 Bypass Blocks)',
    landmarks.skipLink, 'a keyboard user must be able to jump past the sidebar and the rank control to reach the content');

  // --- accessible names (the necessary condition for a screen reader) ------
  at('names');
  const nameless = await page.evaluate(() => window.__a11y.namelessControls());
  check('every interactive control has an accessible name (4.1.2)',
    nameless.length === 0, `${nameless.length} nameless: ${JSON.stringify(nameless.slice(0, 4))}`);
  const unlabelled = await page.evaluate(() => window.__a11y.labelledControls());
  check('every form field has a programmatic label (3.3.2)',
    unlabelled.length === 0, `${unlabelled.length} unlabelled: ${JSON.stringify(unlabelled.slice(0, 4))}`);

  const tree = await page.accessibility.snapshot();
  const treeNodes = (function count(node) {
    if (!node) return 0;
    return 1 + (node.children ?? []).reduce((total, child) => total + count(child), 0);
  })(tree);
  check('the accessibility tree exposes the interface', treeNodes > 30, `${treeNodes} nodes`);
  note('screen readers', 'NOT tested — no screen reader runs here. The accessibility tree is a necessary condition, not a sufficient one.');

  // --- input purpose and authentication ------------------------------------
  at('input-purpose');
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  const identityFields = await page.evaluate(() => window.__a11y.autocompleteOnIdentityFields());
  const missingAutocomplete = identityFields.filter((field) => !field.autocomplete);
  check('identity fields declare their input purpose (1.3.5)',
    missingAutocomplete.length === 0,
    `${missingAutocomplete.length} of ${identityFields.length} without autocomplete: ${JSON.stringify(missingAutocomplete.slice(0, 6))}`);

  // --- visible focus, per route --------------------------------------------
  at('focus');
  let focusFailures = [];
  let focusChecked = 0;
  let focusSkipped = 0;
  for (const surface of SURFACES) {
    await openSurface(surface);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const outcome = await page.evaluate(({ name, selector }) => {
      const scope = ['body > .app-shell > .topbar', selector, '.sidebar'];
      const failing = [];
      let checked = 0;
      let skipped = 0;
      for (const selector of scope) {
        skipped += window.__a11y.disabledSkipped(selector);
        for (const element of window.__a11y.interactiveElements(selector)) {
          const before = window.__a11y.focusSignature(element);
          element.focus();
          const after = window.__a11y.focusSignature(element);
          element.blur();
          checked += 1;
          if (before === after) {
            failing.push({
              route: name,
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              className: typeof element.className === 'string' ? element.className.slice(0, 30) : null,
            });
          }
        }
      }
      return { failing, checked, skipped };
    }, surface);
    focusChecked += outcome.checked;
    focusSkipped += outcome.skipped;
    focusFailures.push(...outcome.failing);
  }
  check('every interactive control shows a visible focus indicator (2.4.7)',
    focusFailures.length === 0,
    `${focusFailures.length} of ${focusChecked} controls change nothing when focused (${focusSkipped} disabled controls skipped — not focusable, proven separately in the browser suite): ${JSON.stringify(focusFailures.slice(0, 5))}`);

  // --- target size, per route ----------------------------------------------
  at('target-size');
  const smallTargets = [];
  for (const surface of SURFACES) {
    await openSurface(surface);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const found = await page.evaluate(({ name, selector }) => window.__a11y.smallTargets(selector).map((entry) => ({ ...entry, route: name })), surface);
    smallTargets.push(...found);
  }
  // The Settings menu needs no loop of its own: it sits inside #view-settings, so the
  // "settings" surface above already measures all thirteen of its controls.
  const chromeTargets = await page.evaluate(() => [
    ...window.__a11y.smallTargets('.topbar'),
    ...window.__a11y.smallTargets('.sidebar'),
    ...window.__a11y.smallTargets('footer'),
  ]);
  check('every target is at least 24x24 CSS pixels (2.5.8, new in WCAG 2.2)',
    smallTargets.length === 0 && chromeTargets.length === 0,
    `${smallTargets.length} in views, ${chromeTargets.length} in chrome: ${JSON.stringify([...smallTargets, ...chromeTargets].slice(0, 5))}`);

  // --- contrast, per route -------------------------------------------------
  at('contrast');
  const contrastFailures = [];
  let contrastMeasured = 0;
  let contrastUnresolved = 0;
  for (const surface of SURFACES) {
    await openSurface(surface);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const outcome = await page.evaluate(({ name, selector }) => {
      const view = window.__a11y.contrastFailures(selector);
      return { ...view, failing: view.failing.map((entry) => ({ ...entry, route: name })) };
    }, surface);
    contrastMeasured += outcome.measured;
    contrastUnresolved += outcome.unresolved;
    // One representative per distinct selector+colour, or the list is unreadable.
    for (const failure of outcome.failing) {
      const key = `${failure.selector}|${failure.color}|${failure.fontSize}`;
      if (!contrastFailures.some((existing) => existing.key === key)) contrastFailures.push({ ...failure, key });
    }
  }
  const chromeContrast = await page.evaluate(() => window.__a11y.contrastFailures('.app-shell > .topbar'));
  const sidebarContrast = await page.evaluate(() => window.__a11y.contrastFailures('.sidebar'));
  const footerContrast = await page.evaluate(() => window.__a11y.contrastFailures('footer'));
  const shellFailures = [...chromeContrast.failing, ...sidebarContrast.failing, ...footerContrast.failing];
  check('text meets the AA contrast minimum (1.4.3)',
    contrastFailures.length === 0 && shellFailures.length === 0,
    `${contrastFailures.length} distinct in views + ${shellFailures.length} in chrome, over ${contrastMeasured} measured: ${JSON.stringify([...contrastFailures, ...shellFailures].slice(0, 6).map(({ key, ...rest }) => rest))}`);
  note('contrast method', `worst-case across every gradient colour stop; ${contrastUnresolved} elements unresolved (raster background-image) and NOT counted as passing`);

  // --- contrast in EVERY theme ---------------------------------------------
  // A theme that is offered and cannot be read is a false feature, and it is the failure a
  // theme layer invites: the default is checked, the other eight are looked at. Every theme
  // is measured here, including the light one and the high-contrast one, which are exactly
  // the two most likely to have been generated wrong.
  //
  // Sampling is declared rather than hidden: five surfaces, chosen because between them
  // they carry the component inventory — hero and cards, badges and metric grids, code
  // panels, lists and buttons, and the appearance controls themselves. The default theme
  // is still measured across all twenty-five above. Themes are switched in place instead of
  // renavigating, so this costs five page loads rather than forty-five.
  at('themes');
  const THEME_IDS = ['midnight', 'slate', 'graphite', 'indigo', 'teal', 'amber', 'violet', 'daylight', 'contrast'];
  const THEME_SURFACES = ['home', 'coden', 'workflows', 'settings/security', 'settings/appearance'];
  const themeFailures = [];
  let themeMeasured = 0;
  for (const name of THEME_SURFACES) {
    const surface = SURFACES.find((entry) => entry.name === name);
    await openSurface(surface);
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const theme of THEME_IDS) {
      const outcome = await page.evaluate(({ selector, id }) => {
        document.documentElement.dataset.theme = id;
        return window.__a11y.contrastFailures(selector);
      }, { selector: surface.selector, id: theme });
      const chrome = await page.evaluate(() => ({
        top: window.__a11y.contrastFailures('.topbar'),
        side: window.__a11y.contrastFailures('.sidebar'),
        foot: window.__a11y.contrastFailures('footer'),
      }));
      themeMeasured += outcome.measured + chrome.top.measured + chrome.side.measured + chrome.foot.measured;
      for (const failure of [...outcome.failing, ...chrome.top.failing, ...chrome.side.failing, ...chrome.foot.failing]) {
        themeFailures.push({ theme, surface: name, selector: failure.selector, ratio: failure.ratio, color: failure.color });
      }
    }
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'midnight'; });
  const themesAffected = [...new Set(themeFailures.map((entry) => entry.theme))];
  check('every theme meets the AA contrast minimum (1.4.3, UI-020/UI-021)',
    themeFailures.length === 0,
    `${themeFailures.length} failures over ${themeMeasured} measurements in ${THEME_IDS.length} themes${themesAffected.length ? ` — themes affected: ${themesAffected.join(', ')}` : ''}: ${JSON.stringify(themeFailures.slice(0, 6))}`);
  // Distinct (theme, selector) pairs rather than every instance: one wrong token shows up on
  // hundreds of elements, and a list of hundreds hides how many DISTINCT problems there are —
  // which is the number that says whether the fix is one change or twenty.
  const themeDistinct = [...new Map(themeFailures.map((entry) => [`${entry.theme}|${entry.selector}`, entry])).values()];
  note('theme failures, distinct', themeDistinct.length === 0 ? 'none'
    : JSON.stringify(themeDistinct.slice(0, 24).map((entry) => ({ t: entry.theme, s: entry.selector, r: entry.ratio }))));
  note('theme coverage', `${THEME_IDS.length} themes x ${THEME_SURFACES.length} sampled surfaces (${THEME_SURFACES.join(', ')}) plus the shell; the default theme is additionally measured on all ${SURFACES.length} surfaces above`);

  // --- reduced motion ------------------------------------------------------
  at('reduced-motion');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const reduced = await page.evaluate(() => ({
    animated: window.__a11y.animatedElements(),
    smil: window.__a11y.smilAnimations(),
  }));
  check('motion is suppressed when the user asks for reduced motion (2.3.3)',
    reduced.animated.length === 0 && reduced.smil === 0,
    `${reduced.animated.length} still animate, ${reduced.smil} SMIL elements: ${JSON.stringify(reduced.animated.slice(0, 4))}`);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  // --- forced colours / high contrast --------------------------------------
  at('forced-colors');
  const forced = await page.evaluate(() => {
    const overrides = window.__a11y.forcedColourOverrides();
    // Which selectors a forced-colors block re-declares, so the check can ask the real
    // question: not "does any !important colour exist" — several legitimately do, carrying
    // good/warning/critical meaning — but "is each one neutralised when the user supplies
    // their own palette". An !important colour with no forced-colors override is what
    // actually defeats high-contrast mode.
    const neutralised = new Set();
    for (const sheet of document.styleSheets) {
      let rules = null;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules ?? []) {
        if (!rule.conditionText || !/forced-colors/.test(rule.conditionText)) continue;
        for (const inner of rule.cssRules ?? []) {
          for (const selector of (inner.selectorText ?? '').split(',')) {
            const trimmed = selector.trim();
            if (trimmed) neutralised.add(trimmed);
          }
        }
      }
    }
    const unneutralised = overrides.filter((entry) => !(entry.selectorText ?? entry.selector ?? '')
      .split(',')
      .map((part) => part.trim())
      .every((part) => neutralised.has(part)));
    return {
      respondsToForcedColors: neutralised.size > 0,
      overrideCount: overrides.length,
      unneutralised: unneutralised.map((entry) => ({ selector: entry.selector, property: entry.property })),
    };
  });
  check('the stylesheet responds to forced-colors mode (1.4.3 / high contrast)',
    forced.respondsToForcedColors, `forced-colors block present: ${forced.respondsToForcedColors}`);
  check('every !important colour is neutralised in forced-colors mode',
    forced.unneutralised.length === 0,
    `${forced.unneutralised.length} of ${forced.overrideCount} !important colour declarations survive high-contrast mode: ${JSON.stringify(forced.unneutralised.slice(0, 6))}`);
  // Emulating the media feature itself is not supported by every Chromium build. When it is
  // unavailable the audit says so rather than throwing away every check that follows — and
  // never reports it as passed.
  try {
    await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }]);
    await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const probeColour = await page.evaluate(() => {
      const probe = document.querySelector('.status-good') ?? document.querySelector('#footerPrivacy');
      return probe ? getComputedStyle(probe).color : null;
    });
    note('forced-colors rendering', `emulated; .status-good resolved to ${probeColour}`);
    await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'none' }]);
  } catch (error) {
    note('forced-colors rendering', `NOT TESTED — this Chromium refuses the emulation (${error.message.slice(0, 60)}). The stylesheet checks above are static and still hold.`);
  }

  // --- scaling and reflow --------------------------------------------------
  at('scaling');
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const scaled = await page.evaluate(() => ({
    overflow: window.__a11y.horizontalOverflow(),
    clipped: window.__a11y.clippedText(),
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
  }));
  check('doubling the root font size does not clip content (1.4.4)',
    !scaled.overflow.overflowing && scaled.clipped.length === 0,
    `overflow=${scaled.overflow.scrollWidth}>${scaled.overflow.clientWidth}, clipped=${scaled.clipped.length} ${JSON.stringify(scaled.clipped.slice(0, 3))}`);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

  await page.setViewport({ width: 320, height: 640 });
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const reflow = await page.evaluate(() => window.__a11y.horizontalOverflow());
  check('content reflows at 320px without two-dimensional scrolling (1.4.10)',
    !reflow.overflowing, `scrollWidth=${reflow.scrollWidth} clientWidth=${reflow.clientWidth}`);

  // The approval strip is load-bearing: 01_PRODUCT/11 makes it binding, and the previous
  // phase deliberately kept it visible below 850px. Verify that on a real narrow viewport.
  const stripNarrow = await page.evaluate(() => {
    const node = document.querySelector('#approvalStrip');
    const box = node ? node.getBoundingClientRect() : { width: 0, height: 0 };
    return { onScreen: Boolean(node && node.offsetParent !== null && box.height > 0), height: Math.round(box.height) };
  });
  check('the approval strip survives a 320px viewport', stripNarrow.onScreen, JSON.stringify(stripNarrow));
  await page.setViewport({ width: 1440, height: 900 });

  // --- RTL -----------------------------------------------------------------
  at('rtl');
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { document.documentElement.setAttribute('dir', 'rtl'); });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const rtl = await page.evaluate(() => {
    const overflow = window.__a11y.horizontalOverflow();
    // Name the elements that extend past the viewport. A failure reporting only
    // "overflow=true" cannot be acted on without guessing, and guessing is how a fix lands
    // on the wrong rule.
    const culprits = [];
    for (const element of document.querySelectorAll('body *')) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.right > overflow.clientWidth + 1 || rect.left < -1) {
        culprits.push({
          selector: element.tagName.toLowerCase() + (element.id ? '#' + element.id : '')
            + (typeof element.className === 'string' && element.className ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
          left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width),
        });
      }
    }
    // Only the outermost offenders: a child inherits its parent's overflow and listing
    // every descendant buries the one rule that needs changing.
    const outermost = culprits.filter((entry, index) => !culprits.some((other, otherIndex) =>
      otherIndex !== index && other.left <= entry.left && other.right >= entry.right && other.width > entry.width));
    return { overflow, culprits: outermost.slice(0, 8), total: culprits.length };
  });
  check('the layout is RTL-ready (1.3.2 / spec: RTL-ready layout)',
    !rtl.overflow.overflowing,
    `scrollWidth=${rtl.overflow.scrollWidth} clientWidth=${rtl.overflow.clientWidth}, ${rtl.total} elements past the edge, outermost: ${JSON.stringify(rtl.culprits)}`);
  await page.evaluate(() => { document.documentElement.removeAttribute('dir'); });

  // --- graphics ------------------------------------------------------------
  at('graphics');
  // Security is a Settings section now, not a destination. Its address changed with its
  // rank, and the audit follows the surface rather than a name that no longer routes.
  await page.goto(`${BASE}/#/settings/security`, { waitUntil: 'networkidle2' });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const graphics = await page.evaluate(() => window.__a11y.graphics());
  const undescribed = graphics.filter((item) => !item.described);
  check('every graphic is described or explicitly hidden (1.1.1)',
    undescribed.length === 0,
    `${undescribed.length} of ${graphics.length} undescribed: ${JSON.stringify(undescribed.slice(0, 4))}`);
  note('accessible charts', `${graphics.length} graphics found on the audited surfaces; this build renders data as text and tables rather than charts, so there is no chart to make accessible yet`);

  // --- keyboard operation --------------------------------------------------
  at('keyboard');
  await page.goto(`${BASE}/#/workflows`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#view-workflows.active', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.evaluate(() => { document.body.focus(); });
  const visited = [];
  for (let index = 0; index < 90; index += 1) {
    await page.keyboard.press('Tab');
    const current = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        text: (element.textContent || element.value || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      };
    });
    visited.push(current);
  }
  const reached = visited.filter(Boolean);
  const distinct = new Set(reached.map((entry) => `${entry.tag}#${entry.id}|${entry.text}`));
  check('the keyboard reaches the interface (2.1.1)', distinct.size > 15, `${distinct.size} distinct controls in 90 tabs`);
  // A trap is when the same element holds focus across many consecutive presses.
  let longestRun = 1;
  let run = 1;
  for (let index = 1; index < visited.length; index += 1) {
    const same = JSON.stringify(visited[index]) === JSON.stringify(visited[index - 1]) && visited[index] !== null;
    run = same ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  check('the keyboard is not trapped (2.1.2)', longestRun < 5, `longest run on one element: ${longestRun}`);

  // Every nav destination must be operable from the keyboard alone.
  // Activation is driven by a REAL key press through the browser's input pipeline. An
  // earlier version dispatched a synthetic KeyboardEvent, which no browser translates into
  // an activation — so the check would have passed on a button that the keyboard cannot
  // actually operate. ESLint objecting to the undeclared global is what surfaced it.
  const focusedNav = await page.evaluate(() => {
    const target = [...document.querySelectorAll('.nav')].find((node) => node.dataset.view === 'projects' && !node.hidden);
    if (!target) return { found: false };
    target.focus();
    return { found: true, focused: document.activeElement === target };
  });
  await page.keyboard.press('Enter');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const keyboardNav = await page.evaluate(() => ({
    activated: document.querySelector('#view-projects')?.classList.contains('active') === true,
    rendered: (document.querySelector('#view-projects')?.getBoundingClientRect().height ?? 0) > 0,
    hash: location.hash,
  }));
  check('a nav destination can be reached and activated by a real key press (2.1.1)',
    focusedNav.found && focusedNav.focused && keyboardNav.activated && keyboardNav.rendered,
    JSON.stringify({ ...focusedNav, ...keyboardNav }));

  // --- errors carry text, not only colour ----------------------------------
  at('recovery');
  await page.goto(`${BASE}/#/workflows`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#workflowForm', { timeout: 15000 });
  await page.type('#workflowName', 'Accessibility probe');
  await page.type('#workflowSteps', 'this is not valid json');
  await page.click('#workflowForm button.primary');
  await new Promise((resolve) => setTimeout(resolve, 900));
  const recovery = await page.evaluate(() => {
    const toasts = [...document.querySelectorAll('.toast')];
    return {
      count: toasts.length,
      text: toasts.map((node) => node.textContent.replace(/\s+/g, ' ').trim()).join(' | ').slice(0, 200),
      announced: toasts.some((node) => node.getAttribute('role') === 'alert' || node.closest('[aria-live]')),
      saysWhatToDo: toasts.some((node) => /json/i.test(node.textContent)),
    };
  });
  check('an input error is reported in text, not by colour alone (1.4.1, 3.3.1)',
    recovery.count > 0 && recovery.text.length > 10, recovery.text);
  check('an error is announced to assistive technology (4.1.3)',
    recovery.announced, `role=alert or aria-live present: ${recovery.announced}`);
  check('the error says how to recover (3.3.3 / spec: recovery instructions)',
    recovery.saysWhatToDo, recovery.text);
} catch (error) {
  let context = '';
  try {
    context = JSON.stringify(await page.evaluate(() => ({
      url: location.href,
      activeView: document.querySelector('.view.active')?.id ?? null,
      signedIn: document.querySelector('#authGate')?.classList.contains('hidden') === true,
    })));
  } catch { context = '(page state unavailable)'; }
  check(`audit completed without throwing [step: ${step}]`, false, `${error.message} :: ${context}`);
} finally {
  await browser.close();
}

console.log('');
console.log('--- NOT COVERED BY THIS AUDIT, stated so a clean result is not mistaken for conformance ---');
for (const line of [
  'a real screen reader (NVDA / JAWS / VoiceOver) — only the accessibility tree was inspected',
  'human judgement of link purpose, heading meaning and reading order',
  'cognitive-load criteria and plain-language review',
  '1.4.12 text spacing, 1.4.13 content on hover/focus',
  '2.5.7 dragging movements (no drag interaction exists in this build to test)',
  '3.2.6 consistent help and 3.3.7 redundant entry across multi-step flows',
  'video, audio and time-based media criteria — this build ships none',
  'the authentication gate itself beyond input purpose, since the audit signs in to reach the application',
]) console.log(`  NOT_TESTED  ${line}`);

console.log('');
console.log(`A11Y_TOTAL=${results.length}`);
console.log(`A11Y_PASS=${results.length - failures}`);
console.log(`A11Y_FAIL=${failures}`);
process.exit(failures === 0 ? 0 : 1);

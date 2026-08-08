// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Interface language.
//
// Owner, s333 point 4: «ho visto un mix — quando clicco sulla traduzione rimane in inglese o
// viceversa». Three separate defects produced that one symptom, and they are repaired here in
// the order they bite:
//
// 1. **Coverage was 10%.** 72 of 722 visible strings had an entry. The rest rendered in English
//    with no signal of any kind. That is the "mix", and it is not fixed by code — it is fixed by
//    `i18n-catalog.js` being complete and by two checks that fail when it is not.
//
// 2. **48 of the 58 render functions were never translated.** `applyTranslations()` was called
//    from exactly one place, `renderAll()`, which covers ten renderers. Everything the other
//    forty-eight painted stayed in the source language forever, on a page that had already been
//    translated around it — a mix that appears only after you interact with something. The
//    repair is deliberately NOT "call it from the other forty-eight": that is fifty-eight copies
//    of a rule, and this project has twice paid for exactly that shape (`D-0300` the TUI keeping
//    its own address list, `D-0302` each transport checking its own permissions). Translation is
//    made a property OF THE DOCUMENT with a MutationObserver, so a renderer written tomorrow by
//    someone who never reads this file is translated anyway.
//
// 3. **The picker showed the preference, never the language in effect.** With the default `auto`
//    and an Italian browser the interface came up Italian while the control read "Auto". Choosing
//    "Italiano" then changed nothing observable — «non vedo cambiamenti», precisely. The control
//    now reports what is actually rendering.
//
// # Why the source string is preserved instead of reloaded
//
// The previous version overwrote `nodeValue` in place, which destroys the English. The only way
// back was `location.reload()`, which is why changing language reloaded the page. Holding the
// source in a WeakMap keyed by the text node makes translation idempotent AND reversible: the
// same node can be re-translated any number of times, and switching to `en` restores rather than
// re-fetches. The map is weak, so a node dropped by a re-render takes its entry with it.

import { CATALOGS, SOURCE_LANGUAGE, UNTRANSLATED_TAGS, LANGUAGE_NAMES } from './i18n-catalog.js';

export { SOURCE_LANGUAGE, LANGUAGE_NAMES };

const STORAGE_KEY = 'noesar-language';
const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
const SKIP_TAGS = new Set(UNTRANSLATED_TAGS.map((t) => t.toUpperCase()));

/** Source text per node. Weak: a node discarded by a re-render releases its entry. */
const sources = new WeakMap();
/** Source text per element+attribute, same reason. */
const attributeSources = new WeakMap();

let current = SOURCE_LANGUAGE;
let observer = null;
/**
 * Every string this build asked to translate and could not. It is a Set and not a counter
 * because a number tells you a gap exists and not where — and the whole failure being repaired
 * here is a gap that could not be pointed at. `I18N-RUNTIME` reads this after visiting every
 * destination; that is the half of the measurement `measure-ui-language-coverage.mjs` cannot
 * make, because it reads markup and this sees what actually rendered.
 */
const misses = new Set();

/** Pure: which language is actually in effect. `auto` is a preference, never a language. */
export function resolveLanguage(stored, navigatorLanguage = '') {
  const preference = stored || 'auto';
  if (preference !== 'auto' && Object.hasOwn(CATALOGS, preference)) return preference;
  if (preference !== 'auto') return SOURCE_LANGUAGE; // a stored language we no longer ship
  const tag = String(navigatorLanguage).toLowerCase();
  const match = Object.keys(CATALOGS).find((code) => tag.startsWith(code));
  return match ?? SOURCE_LANGUAGE;
}

/**
 * Pure: the rendering of `text` in `language`, and whether the catalogue could supply it.
 *
 * Leading and trailing whitespace belongs to the layout, not to the sentence, so it is peeled
 * off before the lookup and put back after. A string with no letter in it — a separator, a
 * counter, an arrow — carries no language and is never reported as a gap.
 */
export function translateString(text, language) {
  const dictionary = CATALOGS[language] ?? {};
  const trimmed = text.trim();
  if (!trimmed || !/\p{L}/u.test(trimmed)) return { text, translated: true };
  if (language === SOURCE_LANGUAGE) return { text, translated: true };
  const replacement = dictionary[trimmed];
  if (replacement === undefined) return { text, translated: false, missing: trimmed };
  return { text: text.replace(trimmed, replacement), translated: true };
}

/**
 * Translate one text node in place, always FROM ITS STORED SOURCE.
 *
 * Exported because this is where idempotence actually lives, and a property that matters has to
 * be reachable by a test. Reading the source rather than the current value is what makes a
 * second pass a no-op — which the MutationObserver makes routine, not exceptional.
 */
export function applyToTextNode(node, language) {
  const source = sources.get(node) ?? node.nodeValue;
  if (!sources.has(node)) sources.set(node, source);
  const result = translateString(source, language);
  if (result.missing) misses.add(result.missing);
  if (node.nodeValue !== result.text) node.nodeValue = result.text;
}

function applyToAttributes(element, language) {
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    const live = element.getAttribute?.(attribute);
    if (live === null || live === undefined) continue;
    let perElement = attributeSources.get(element);
    if (!perElement) { perElement = new Map(); attributeSources.set(element, perElement); }
    const source = perElement.has(attribute) ? perElement.get(attribute) : live;
    if (!perElement.has(attribute)) perElement.set(attribute, source);
    const result = translateString(source, language);
    if (result.missing) misses.add(result.missing);
    if (live !== result.text) element.setAttribute(attribute, result.text);
  }
}

/**
 * Whether a subtree holds content the product must never translate.
 *
 * `translate="no"` is the HTML standard attribute for exactly this, so it is what is honoured —
 * a private attribute would have meant teaching browsers, extensions and screen readers a
 * second convention for a question that already has an answer.
 *
 * This is not a convenience. A person's project is called what they called it; a chat message
 * says what they typed. Running either through a dictionary is wrong even when the dictionary
 * happens to have no entry, and — worse for the measurement — an untranslated project name is
 * reported as a coverage gap, which buries the real gaps under names nobody could ever
 * translate. The first run of `I18N-RUNTIME` recorded 891 misses, and the top of the list was
 * session names created by the test itself.
 */
function isUntranslatableSubtree(element) {
  const declared = element.getAttribute?.('translate');
  return declared === 'no';
}

function walk(node, language) {
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) { applyToTextNode(node, language); return; }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (SKIP_TAGS.has(node.tagName)) return;
  if (isUntranslatableSubtree(node)) return;
  applyToAttributes(node, language);
  for (const child of node.childNodes) walk(child, language);
}

/**
 * Does this node sit inside a `translate="no"` subtree?
 *
 * `walk` stops at the boundary on the way down, but the MutationObserver delivers a changed
 * text node DIRECTLY — it never descends through the ancestor that declared the exemption. So
 * the boundary has to be checkable from the inside too, or user content would be exempt on a
 * full pass and translated the moment it changed.
 */
function insideUntranslatable(node) {
  let cursor = node?.parentNode;
  while (cursor && cursor.nodeType === Node.ELEMENT_NODE) {
    if (isUntranslatableSubtree(cursor)) return true;
    cursor = cursor.parentNode;
  }
  return false;
}

/**
 * Translate a subtree. Safe to call at any time and any number of times: every node is
 * translated from its stored source, never from what it currently shows.
 */
export function applyTranslations(root = document.body, language = current) {
  current = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  // The observer must not see our own writes: setting `nodeValue` raises a characterData
  // record even when the value is unchanged, and translating in response to that record
  // would translate in response to that record. Disconnecting drops the records made while
  // we work, which is exactly right — we are walking the whole subtree anyway.
  const wasObserving = observer !== null;
  if (wasObserving) observer.disconnect();
  try {
    walk(root, language);
  } finally {
    if (wasObserving) observe();
  }
  syncPicker();
}

function syncPicker() {
  if (typeof document === 'undefined') return;
  const select = document.querySelector('#languageSelect');
  if (!select) return;
  const stored = localStorage.getItem(STORAGE_KEY) || 'auto';
  select.value = stored;
  // What `auto` resolved to, on the control itself. Without this the interface can render in
  // Italian while the only visible statement about language reads "Auto", and the person who
  // then picks Italian sees nothing happen and concludes the feature is broken.
  const auto = select.querySelector('option[value="auto"]');
  if (auto) {
    const name = LANGUAGE_NAMES[current] ?? current;
    auto.textContent = stored === 'auto' ? `Auto — ${name}` : 'Auto';
  }
}

function observe() {
  if (typeof MutationObserver === 'undefined') return;
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATED_ATTRIBUTES,
  });
}

/**
 * Translate one interface string from code, in the language currently in effect.
 *
 * For text that is COMPOSED rather than written — `${t('Context')} · ${projectName}`. The
 * composed result must never be looked up as a whole: half of it is a person's project name,
 * so the whole would miss forever and be reported as a coverage gap that no catalogue could
 * ever close. Compose from translated parts instead, and mark the element `translate="no"` so
 * the walker leaves the finished string alone.
 */
export function t(text) {
  const result = translateString(text, current);
  // Recorded exactly as a walked node is. A string translated from code is still a string the
  // interface showed, and a `t()` with no catalogue entry would otherwise be the one gap the
  // measurement could not see — which is the whole failure this work exists to end.
  if (result.missing) misses.add(result.missing);
  return result.text;
}

/** Strings this session rendered without a translation. Read by `I18N-RUNTIME`. */
export function untranslatedStrings() { return [...misses]; }
export function clearUntranslatedStrings() { misses.clear(); }
export function currentLanguage() { return current; }

export function setLanguage(preference) {
  localStorage.setItem(STORAGE_KEY, preference);
  // No reload: sources are held, so this repaints from them. The previous version had to
  // reload because it had already destroyed the English it would need to go back to.
  applyTranslations(document.body, resolveLanguage(preference, navigator.language));
}

export function initI18n() {
  current = resolveLanguage(localStorage.getItem(STORAGE_KEY), navigator.language);
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((records) => {
      const language = current;
      observer.disconnect();
      try {
        for (const record of records) {
          // A record arrives pointing straight at the changed node, so the `translate="no"`
          // boundary must be re-checked from below: `walk` only sees it coming down.
          if (record.type === 'characterData') {
            if (!insideUntranslatable(record.target)) applyToTextNode(record.target, language);
          } else if (record.type === 'attributes') {
            if (!isUntranslatableSubtree(record.target) && !insideUntranslatable(record.target)) {
              applyToAttributes(record.target, language);
            }
          } else {
            for (const added of record.addedNodes) {
              if (!insideUntranslatable(added)) walk(added, language);
            }
          }
        }
      } finally {
        observe();
      }
    });
  }
  applyTranslations(document.body, current);
  if (observer) observe();
  document.querySelector('#languageSelect')?.addEventListener('change', (event) => {
    setLanguage(event.target.value);
  });
  // The measurement point for `I18N-RUNTIME`. It exposes the translator's own record of what it
  // could not translate, and the current language — nothing else, and nothing that writes. It
  // is here rather than in a test-only build because a check that runs against something other
  // than the shipped bundle measures something other than the product; the whole reason this
  // work exists is that `npm test` reads `app.js` as text and never executes it.
  window.__i18n = { untranslatedStrings, clearUntranslatedStrings, currentLanguage };
  return current;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The simple interface: what a person sees who has never used an AI before.
//
// Owner, 2026-10-06: a program for everyone, a chat that does the work from A to Z, one button
// that opens the menu and everything else clean. Measured the same day on a clean installation:
// twelve destinations in the sidebar, about twenty controls in the chat, a mode to pick by hand
// out of three, a chat that would not take a word until a conversation had been created and
// titled, and header chips (zone, project, model, coverage) answering questions nobody had asked.
//
// This module holds only what can be decided WITHOUT a browser — the preference, the mode a
// message implies, the title a first message earns, the setup token in a link — so that it can
// be tested the way `schedule.js` is. The rest is markup in `index.html` and a block of CSS keyed
// on `body[data-ui]`.
//
// What simple mode never hides: the approval strip. A person who has never used an AI is the one
// who most needs to see that something is waiting for their decision. A test asserts it.

export const SIMPLE_KEY = 'noesar.ui.simple';

/** The destinations the simple sidebar keeps. Everything else is one click away in the full interface. */
export const SIMPLE_VIEWS = Object.freeze(['chat', 'projects', 'documents', 'settings']);

/** Simple is the default. Only an explicit '0' — the person chose the full interface — turns it off. */
export function readSimple(storage) {
  try { return storage?.getItem(SIMPLE_KEY) !== '0'; } catch { return true; }
}

export function writeSimple(storage, on) {
  // A private window refuses storage: the choice then lasts until the page is reloaded.
  try { storage?.setItem(SIMPLE_KEY, on ? '1' : '0'); } catch { /* nothing to do */ }
}

// Information questions are answered, not acted on: "how do I merge a PDF?" is ASK even though it
// contains an action verb. A polite request is NOT one ("can you merge these PDFs?"), so only the
// interrogative word at the start decides — never a trailing question mark.
// (`\b` is not used after the word: JavaScript does not count "é" as a letter, so "perché" would never match.)
const INFO_QUESTION = /^\s*(?:come|cosa|che cosa|perch[eé]|quando|dove|chi|quale|quali|quanto|quanti|how|what|why|when|where|who|which)(?=[\s?,.:;!]|$)/i;
const CREATE = /\b(scrivi|scrivere|crea|creare|genera|generare|prepara|preparare|redigi|redigere|compila|compilare|disegna|disegnare|bozza|write|create|generate|draft|prepare|compose)\b/i;
const ACT = /\b(unisci|unire|converti|convertire|sposta|spostare|rinomina|rinominare|cancella|cancellare|elimina|eliminare|rimuovi|rimuovere|togli|riordina|riordinare|organizza|organizzare|installa|installare|applica|applicare|modifica|modificare|correggi|correggere|salva|salvare|scarica|scaricare|merge|convert|move|rename|delete|remove|organi[sz]e|tidy|install|apply|edit|fix|save|download)\b/i;

/**
 * The mode a message implies, so that nobody has to choose Ask, Create or Act by hand.
 *
 * ponytail: a list of rules, not a model — it can be read, argued with and tested. A wrong guess
 * is cheap: every step that changes something still waits for an approval whatever the mode, and
 * ACT only makes the assistant plan before it acts. Upgrade path: the ReasoningRouter's
 * `interpret` surface, when it is switched on, instead of verbs.
 */
export function inferChatMode(text) {
  const value = String(text ?? '').trim();
  if (!value || value.startsWith('/')) return 'ASK';
  if (INFO_QUESTION.test(value)) return 'ASK';
  if (CREATE.test(value)) return 'CREATE';
  if (ACT.test(value)) return 'ACT';
  return 'ASK';
}

/** The title a first message earns: its first line, flattened, cut at a word. */
export function titleFromMessage(text, max = 48) {
  const first = String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const flat = first.replace(/\s+/g, ' ');
  if (!flat) return 'New conversation';
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The one-time setup token carried in the FRAGMENT of the address the installer opens
 * (`/#setup=<token>`). A fragment is never sent to the server and never reaches an access log,
 * which is why the token may travel in it and not in a query string. Anything that is not a
 * token-shaped value is ignored: a link cannot make the page type something odd into a field.
 */
export function setupTokenFromHash(hash) {
  const match = /^#setup=([A-Za-z0-9_-]{16,128})$/.exec(String(hash ?? ''));
  return match ? match[1] : '';
}

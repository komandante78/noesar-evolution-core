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

/**
 * The title a first message earns: its first line, flattened, cut at a word. A first line that only opens a
 * sentence ("Summarize this text:", which is what a suggestion writes) is joined to the line that
 * finishes it, or every conversation made from that suggestion would be called "Summarize this text:".
 */
export function titleFromMessage(text, max = 48) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const first = lines[0]?.endsWith(':') && lines[1] ? `${lines[0]} ${lines[1]}` : lines[0] ?? '';
  const flat = first.replace(/\s+/g, ' ');
  if (!flat) return 'New conversation';
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * What a tool that changes files is, in words a person can decide on. The technical names stay as a
 * tooltip; these are the sentences on the card. A tool not named here has no plain phrase, and the
 * card then says so by showing its own name — never a guess at what it does.
 */
export const TOOL_ACTIONS = Object.freeze({
  engine_workspace_plan: 'Prepare a change to your files',
  engine_workspace_measure: 'Try the change on a copy of your files',
  engine_workspace_approve: 'Apply the change to your files',
  engine_workspace_reject: 'Discard the change',
  engine_workspace_restore: 'Put your files back as they were',
  engine_workspace_repair: 'Fix the change and try it again',
  engine_workspace_iterate: 'Try the change, fix it, and try again',
  engine_workspace_answer: 'Send your answers to the plan',
});

export function toolActionTitle(name) {
  return Object.hasOwn(TOOL_ACTIONS, name) ? TOOL_ACTIONS[name] : null;
}

const CHANGE_KINDS = Object.freeze({ CREATED: 'new', MODIFIED: 'changed', DELETED: 'removed' });
const PREVIEW_CHARS = 2000;
const countLines = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/**
 * The before and after of a measured run, as the card shows them. The run is the engine's own
 * record (`GET /api/v1/workspace-actions/:id`): each `diff` entry has a path, a status the shadow
 * observed (CREATED, MODIFIED, DELETED) and the text before and after when the file was small
 * enough to read. A side that was not read is `null`, never an empty string: "empty file" and "could
 * not read it" are different things to tell a person. Long text is cut, and the card says it was.
 */
export function describeChange(run) {
  const clip = (text) => (typeof text === 'string' ? text.slice(0, PREVIEW_CHARS) : null);
  const files = (Array.isArray(run?.diff) ? run.diff : [])
    .filter((entry) => entry && typeof entry.path === 'string')
    .map((entry) => ({
      path: entry.path,
      kind: CHANGE_KINDS[entry.status] ?? 'unknown',
      before: clip(entry.before),
      after: clip(entry.after),
      beforeLines: typeof entry.before === 'string' ? countLines(entry.before) : null,
      afterLines: typeof entry.after === 'string' ? countLines(entry.after) : null,
      cut: (typeof entry.before === 'string' && entry.before.length > PREVIEW_CHARS) || (typeof entry.after === 'string' && entry.after.length > PREVIEW_CHARS),
    }));
  return { request: typeof run?.request === 'string' ? run.request.slice(0, 500) : null, status: run?.status ?? null, files };
}

/** The arguments of a tool this module has no sentence for, as short `key: value` lines. */
export function argumentLines(args, { max = 6, width = 120 } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  return Object.entries(args).slice(0, max).map(([key, value]) => {
    const text = Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    return `${key}: ${text.length > width ? `${text.slice(0, width)}…` : text}`;
  });
}

/**
 * A model id as a person would say it. Ids arrive as file paths ("/models/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"),
 * Ollama tags ("llama3.2:3b") or plain names; the first two are shown to someone who has never seen a
 * path in this product, and the page used to put the raw id in a drop-down. The path, the extension, the
 * "-00001-of-00002" part number and the quantisation tag are about the FILE, not the model, so they go;
 * what is left is spaced, capitalised, with the size in capitals ("Qwen2.5 7B Instruct").
 * Only ids that look local (a path, a .gguf, a tag, or a size like 7b) are tidied: a hosted model's id
 * ("gpt-4o") is its name and stays as it is. The value behind the choice is always the raw id.
 */
export function friendlyModelName(id) {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  const local = /[\/]/.test(raw) || /\.gguf$/i.test(raw) || raw.includes(':') || /(?:^|[-_.\s])\d+(?:\.\d+)?b(?:$|[-_.\s:])/i.test(raw);
  if (!local) return raw;
  const name = raw.split(/[\/]/).pop()
    .replace(/\.gguf$/i, '')
    .replace(/-\d{5}-of-\d{5}$/i, '')
    .replace(/(?:-ud)?[-_.]i?q\d(?:_[a-z0-9]+)*$/i, '')
    .replace(/:/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return raw;
  return name.split(' ').map((word) => (/^\d+(?:\.\d+)?b$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
}

/**
 * What the bottom strip says about decisions that wait. A tool waiting in the CHAT is held by the
 * turn that is running, not by the queue behind `/api/v1/approvals`, so a strip fed by the queue
 * alone read "Nothing is waiting for a decision" with a card on screen asking for one. The strip
 * is the one surface whose job is to say that something waits: it is given both, chat first (that
 * one is on the person's screen, in a turn that is holding its breath).
 *
 * `detail` is empty when nothing waits (the caller owns that sentence, which is a catalogue
 * entry). `inChatOnly` says where the person should go: the queue is empty, so "open the queue"
 * would lead to nothing.
 */
export function approvalStrip({ queueTotal = 0, queueTitles = [], chatTitles = [], chatLabel = 'In this chat:' } = {}) {
  const total = queueTotal + chatTitles.length;
  const names = [...chatTitles.map((title) => `${chatLabel} ${title}`), ...queueTitles];
  return {
    total,
    detail: total === 0 ? '' : names.slice(0, 2).join(' · ') + (total > 2 ? ` and ${total - 2} more` : ''),
    inChatOnly: queueTotal === 0 && chatTitles.length > 0,
  };
}

/**
 * The one-time setup token carried in the FRAGMENT of the address the installer opens
 * (`/#setup=<token>`). A fragment is never sent to the server and never reaches an access log,
 * which is why the token may travel in it and not in a query string. Anything that is not a
 * token-shaped value is ignored: a link cannot make the page type something odd into a field.
 */
/**
 * The time zone a person can be offered, in one click, when the page would otherwise show UTC.
 *
 * The server never applies the browser's zone silently (UI-045). With nothing chosen and no host or installer zone it
 * falls back to UTC and says so in a `warning` nobody reads: a person in Rome reads "02:36 · UTC" on a clock that says
 * 04:36. The browser's zone is offered here, never applied: the person presses the button. Only the pure fallback is
 * offered — a zone chosen by hand, by the host or by the installer is somebody's decision, not a gap.
 */
export function zoneOffer(settings) {
  const zone = String(settings?.browserReported ?? '').trim();
  if (settings?.source !== 'utc-fallback' || !zone || zone === settings.effective) return '';
  return zone;
}

export function setupTokenFromHash(hash) {
  const match = /^#setup=([A-Za-z0-9_-]{16,128})$/.exec(String(hash ?? ''));
  return match ? match[1] : '';
}

// ── light or dark, a time a person can read, and the computer in plain words — 2026-10-08 ─────────────────────────────

export const SCHEME_KEY = 'noesar.ui.scheme';

/** 'auto' (follow the computer), 'light' or 'dark'. Anything else, or a refused storage, is 'auto'. */
export function readScheme(storage) {
  try {
    const value = storage?.getItem(SCHEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch { return 'auto'; }
}

export function writeScheme(storage, preference) {
  try { storage?.setItem(SCHEME_KEY, preference === 'light' || preference === 'dark' ? preference : 'auto'); } catch { /* the choice lasts until the page is reloaded */ }
}

/**
 * The page's own theme for a preference. The simple interface has two looks, the light one (the
 * theme called daylight) and the dark one (midnight, the product's original); the nine themes of the
 * full interface are a different choice and are not touched.
 */
export function themeForScheme(preference, prefersDark) {
  const dark = preference === 'dark' || (preference !== 'light' && Boolean(prefersDark));
  return dark ? 'midnight' : 'daylight';
}

/**
 * A time the way a person says it: "today, 04:36", "yesterday, 16:52", "6 Oct, 16:52", and with the
 * year when it is not this one. No zone name unless `showZone` asks for one: "Europe/Rome" after every
 * message answers a question nobody asked. `showZone` is for when the zone shown is not the one the
 * person's own computer is in, which is the one case where hiding it would mislead.
 *
 * "Today" and "yesterday" come from Intl.RelativeTimeFormat, so they are in the page's language
 * without a catalogue entry.
 */
export function friendlyWhen(value, { now = new Date(), zone, lang, showZone = false } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const make = (zoneName) => {
    const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: zoneName, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const time = new Intl.DateTimeFormat(lang, { timeZone: zoneName, hour: '2-digit', minute: '2-digit' }).format(date);
    const days = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(date))) / 86400000);
    if (days === 0 || days === 1) {
      const word = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}, ${time}`;
    }
    const sameYear = dayKey(now).slice(0, 4) === dayKey(date).slice(0, 4);
    const day = new Intl.DateTimeFormat(lang, { timeZone: zoneName, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
    return `${day}, ${time}`;
  };
  let text;
  let used = zone;
  try { text = make(zone || undefined); } catch { used = undefined; text = make(undefined); }
  return showZone && used ? `${text} · ${used}` : text;
}

/**
 * What the machine is, from the hardware report, as three plain lines: [label, value]. The labels are
 * interface strings (translated by the caller); the value for a missing graphics card is '' so that the
 * caller says "none found" in the person's language.
 */
export function describeComputer(report) {
  const gigabytes = (bytes) => (Number.isFinite(bytes) && bytes > 0 ? `${Math.round(bytes / 1024 ** 3)} GB` : '');
  const cards = Array.isArray(report?.accelerators) ? report.accelerators : [];
  const names = cards.map((card) => String(card?.name ?? card?.model ?? card?.vendor ?? '').trim()).filter(Boolean);
  return [
    ['Processor', String(report?.cpu?.model ?? '').trim()],
    ['Memory', gigabytes(report?.memory?.totalBytes)],
    ['Graphics card', names.length ? names.join(', ') : (cards.length ? 'Yes' : '')],
  ];
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The egress gate: what of a text bound for the internet (a web search, an external tool's arguments) may leave.
//
// Owner, 2026-10-10: «internet entra, ma i dati del cliente non devono mai uscire». The chat may search the web and read
// a person's documents in the same turn; the documents' data must never be in what leaves. Before this module the web
// search tool sent the model's own words verbatim (`session-protocol.mjs`, `research.search`), so a model that had just
// read a contract could search for the tenant's name or tax code. Designed and simulated first, with invented data:
// Desktop\Noesar Evolution\PROGETTO_DATI_CLIENTE_20261010 (PROGETTO.md, SIMULAZIONE\).
//
// Fixed rules, no model and no dependency, like `pii-redaction.mjs` beside it (Owner decision 2026-09-08: no runtime
// dependency). That decision also said names cannot be matched without a model or a library — true for names in
// general; this module does not guess names, it takes them from the private texts the turn has actually seen (the
// documents), plus a person-shaped pair (a common first name followed by a capitalised word) and the tax code, whose
// first six letters are derived from surname and name.
//
// Four outcomes:
//   PROCEED  nothing private: leaves as it is
//   CLEAN    private pieces removed, and what remains is still a search: leaves without them (the kinds are reported)
//   ASK      it contains a datum the person typed themselves, or a sensitive topic (GDPR art. 9-10) in a turn that read
//            documents: leaves only if the person approves it (the chat's own mid-turn approval)
//   BLOCK    nothing of it leaves: encoded strings, web addresses, a copied passage, pieces that rebuild a datum, or
//            nothing left once the private pieces are out
//
// A gate made of rules cannot see meaning ("the surname that in English is Red"). That is why it is the second layer:
// the first is that whoever writes the search must never have seen the data (PROGETTO.md §3, layer 1).

const strip = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
/** The comparison form of a word: lower case, no accents, digits-for-letters undone ("R0ss1" → "rossi"). */
const wordKey = (w) => strip(w).toLowerCase().replace(/[013457@$]/g, (c) => LEET[c]).replace(/[^a-z]/g, '');
const digitsOf = (s) => String(s).replace(/\D/g, '');
const alnumOf = (s) => strip(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const YEAR = /^(?:19|20)\d{2}$/;

// ── personal data shapes, with the check digit wherever one exists ─────────────────────────────────────────────────
function ibanValid(raw) {
  const s = alnumOf(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  let rest = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) for (const d of (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}
const CF_ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
function cfValid(raw) {
  const s = alnumOf(raw);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) { const c = s[i]; sum += i % 2 === 0 ? CF_ODD[c] : (/\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65); }
  return String.fromCharCode(65 + (sum % 26)) === s[15];
}
function pivaValid(raw) {
  const s = digitsOf(raw);
  if (s.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) { let n = Number(s[i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
}
function luhn(raw) {
  const s = digitsOf(raw);
  if (s.length < 13 || s.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < s.length; i++) { let n = Number(s[s.length - 1 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
}
const always = () => true;
/** Order matters: the tax code and the IBAN before the looser number shapes could read their digits. */
export const SHAPES = Object.freeze([
  ['email', /[\w.+-]+\s*(?:@|\(at\)|\[at\]| at )\s*[\w-]+\s*(?:\.|\(dot\)| dot )\s*[a-z]{2,}/gi, always],
  ['iban', /\b[A-Z]{2}\s?\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/gi, ibanValid],
  ['tax code', /\b[A-Z]{6}\s?[0-9LMNPQRSTUV]{2}\s?[A-Z]\s?[0-9LMNPQRSTUV]{2}\s?[A-Z]\s?[0-9LMNPQRSTUV]{3}\s?[A-Z]\b/gi, cfValid],
  ['payment card', /\b(?:\d[ -]?){13,19}\b/g, luhn],
  ['VAT number', /\b(?:IT)?\s?\d{11}\b/gi, pivaValid],
  ['phone', /(?:\+|00)\s?\d{2}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}\b|\b0\d{1,3}[\s.-]?\d{5,8}\b/g, always],
  ['street address', /\b(?:via|viale|piazza|piazzale|corso|vicolo|largo|strada|contrada)\s+(?:[A-ZÀ-Ü][\wÀ-ü'’]*\s+){1,4}\d{1,4}[a-z]?\b/gi, always],
  ['date', /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, always],
]);
const TAX_CODE = SHAPES.find(([kind]) => kind === 'tax code')[1];
/** A long run with no space in the base64 or hex alphabet, letters and digits mixed, is never a search: it is a datum in disguise. */
const BLOB = /[A-Za-z0-9+/=_-]{20,}/g;
const WEB_ADDRESS = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|it|net|org|io|xyz|ru|eu|info|biz)\b\/?\S*/i;
const PLACEHOLDER = /\[DATO\d+\]/g;

// Capitalised words that are not people: company forms, titles, street types, institutions and the provincial
// capitals (a town alone is not personal data; a street address is, and the address shape takes it).
// ponytail: a short fixed list; the ISTAT list of first names and towns, as a static file, is the upgrade.
const NOT_NAMES = new Set(('srl spa snc sas srls iva euro via viale piazza corso largo vicolo strada dott dottor dottoressa sig signor signora '
  + 'avv ing geom rag studio comune regione provincia agenzia entrate inps inail asl tribunale corte cassazione italia europa '
  + 'roma milano napoli torino palermo genova bologna firenze bari catania venezia verona messina padova trieste brescia '
  + 'parma taranto prato modena reggio perugia livorno ravenna cagliari foggia rimini salerno ferrara sassari latina '
  + 'monza bergamo pescara trento vicenza terni bolzano novara piacenza ancona andria arezzo udine cesena lecce pesaro '
  + 'barletta alessandria spezia pisa catanzaro pistoia lucca brindisi como treviso varese grosseto caserta asti').split(' '));
/** An abbreviation's full stop does not end a sentence ("dott. Andrea Gallo": Andrea is a name, not a sentence start). */
const ABBREV = new Set('dott dottssa prof sig sigra avv ing geom rag arch egr gent spett'.split(' '));
/** Words after which a form puts a name — how a name written only in capitals is recognised. */
const CUES = new Set('sig signor signora sigra conduttore conduttrice locatore locatrice paziente dipendente cliente intestato intestata cognome nome sottoscritto sottoscritta assistito assistita'.split(' '));
const FIRST_NAMES = new Set(('mario giuseppe giovanni antonio luigi francesco angelo vincenzo pietro salvatore carlo franco domenico bruno paolo '
  + 'michele giorgio aldo sergio luciano marco andrea alessandro luca stefano roberto massimo davide matteo lorenzo simone federico '
  + 'riccardo gabriele leonardo tommaso daniele fabio claudio enrico alberto maria anna giuseppina rosa angela giovanna teresa lucia '
  + 'carmela caterina francesca paola laura elena chiara sara giulia martina alessandra silvia valentina federica elisa '
  + 'barbara monica cristina simona roberta patrizia rita gabriella daniela antonella sofia aurora alice ginevra beatrice').split(' '));
// The three letters of surname and name in a tax code: consonants, then vowels, then X; a given name with four or
// more consonants takes the 1st, 3rd and 4th (Agenzia delle Entrate's rule).
const CONS = (w) => w.toUpperCase().replace(/[^B-DF-HJ-NP-TV-Z]/g, '');
const VOW = (w) => w.toUpperCase().replace(/[^AEIOU]/g, '');
const surnameCode = (w) => (CONS(w) + VOW(w) + 'XXX').slice(0, 3);
const givenCode = (w) => { const c = CONS(w); return c.length >= 4 ? c[0] + c[2] + c[3] : (c + VOW(w) + 'XXX').slice(0, 3); };
// Sensitive topics (GDPR art. 9 and 10). Without names they identify nobody; in a turn that read documents the person decides.
const SENSITIVE = Object.freeze([
  ['health', /\b(?:diagnos\w*|ernia|tumor\w*|cancro|oncolog\w*|diabet\w*|depression\w*|ansia|psichiatr\w*|hiv|aids|gravidanz\w*|aborto|fisioterapi\w*|terapi\w*|farmac\w*|sintom\w*|malatti\w*|referto|invalidit\w*|disabilit\w*|legge 104|ricover\w*|chemio\w*)\b/i],
  ['criminal record', /\b(?:condann\w*|precedent\w* penal\w*|casellario|carcer\w*|denunci\w*|reato|processo penale|patteggiament\w*)\b/i],
  ['religion', /\b(?:religion\w*|cattolic\w*|musulman\w*|islam\w*|ebrai\w*|testimoni di geova|ateo|battesim\w*)\b/i],
  ['politics or trade union', /\b(?:partito|iscritt\w* al sindacato|sindacat\w*|tessera di partito|voto politic\w*)\b/i],
  ['sex life', /\b(?:orientamento sessuale|omosessual\w*|transgender|sieropositiv\w*)\b/i],
  ['ethnic origin', /\b(?:origine etnica|razz\w*|etnia)\b/i],
]);
export const sensitiveTopic = (text) => SENSITIVE.find(([, re]) => re.test(String(text)))?.[0] ?? null;

/**
 * What is private in this turn: the documents read, the attachments, the results of tools that read files. Built once
 * per turn from raw texts; it holds the names, the numbers, five-word passages and whole sensitive values found there.
 */
export function privateIndex(texts) {
  const names = new Set(), numbers = new Set(), passages = new Set(), values = [];
  // A capitalised word is a name only if the same texts never write it in lower case. Measured 2026-10-11 with the real
  // 7B: its summary of a contract wrote «Contratto» and «Conduttore» mid-sentence, the old rule took them for people,
  // and the person's own «come può disdire questo contratto il conduttore» was held as carrying their data. A surname is
  // not written in lower case; a common word is. (Names from the tax code and after a cue word are kept regardless.)
  const capitalised = new Set(), lowerSeen = new Set();
  for (const raw of texts) {
    const text = String(raw ?? '');
    if (!text) continue;
    for (const [kind, re, ok] of SHAPES) for (const m of text.matchAll(re)) if (kind !== 'street address' && ok(m[0])) values.push({ kind, digits: digitsOf(m[0]) });
    // A proper name: a capitalised word NOT at the start of a sentence. Start = start of text, a new line, or after
    // . ! ? closing a long word that is not an abbreviation. Words in capitals only are handled by the cues below.
    const tokens = [...text.matchAll(/[\p{L}\p{N}'’]+|[.!?\n]/gu)].map((m) => m[0]);
    let start = true, prev = '';
    for (const t of tokens) {
      if (t === '\n' || (/^[.!?]$/.test(t) && prev.length > 3 && !ABBREV.has(wordKey(prev)))) { start = true; prev = t; continue; }
      if (/^[.!?]$/.test(t)) { prev = t; continue; }
      prev = t;
      if (/^\p{Ll}/u.test(t)) lowerSeen.add(wordKey(t));
      if (!start && /^\p{Lu}\p{Ll}/u.test(t) && wordKey(t).length >= 3 && !NOT_NAMES.has(wordKey(t))) capitalised.add(wordKey(t));
      // a year alone is not a datum (every deadline search has one); a number of four digits or more from a document is
      if (/\d/.test(t) && digitsOf(t).length >= 4 && !YEAR.test(digitsOf(t))) numbers.add(digitsOf(t));
      start = false;
    }
    // names written only in capitals ("ROSSI MARIO"): after a cue word, or because the tax code in the same text says so
    // after a cue word, the capitals that follow ON THE SAME LINE (measured 2026-10-11: «del mio cliente:» followed, two
    // lines below, by the title «CONTRATTO DI LOCAZIONE» turned three ordinary words into names)
    const lineTokens = tokens.filter((t) => !/^[.!?]$/.test(t));
    for (let i = 0; i < lineTokens.length; i++) {
      if (!CUES.has(wordKey(lineTokens[i]))) continue;
      for (let j = i + 1; j <= i + 3 && j < lineTokens.length && lineTokens[j] !== '\n' && /^\p{Lu}{2,}$/u.test(lineTokens[j]); j++) {
        const w = wordKey(lineTokens[j]);
        if (w.length >= 3 && !NOT_NAMES.has(w)) names.add(w);
      }
    }
    // from the tax code: a PAIR of neighbouring words that gives both its surname letters and its name letters ("ROSSI
    // MARIO"). One word matching three letters is not enough — «Riassumilo» gives RSS like «Rossi» (measured 2026-10-11).
    const plain = tokens.filter((t) => !/^[.!?\n]$/.test(t)).map(wordKey);
    for (const m of text.matchAll(TAX_CODE)) {
      if (!cfValid(m[0])) continue;
      const code = alnumOf(m[0]);
      for (let i = 0; i < plain.length; i++) {
        if (plain[i].length < 2 || NOT_NAMES.has(plain[i]) || surnameCode(plain[i]) !== code.slice(0, 3)) continue;
        for (const k of [i - 2, i - 1, i + 1, i + 2]) {
          if (k >= 0 && k < plain.length && plain[k].length >= 2 && givenCode(plain[k]) === code.slice(3, 6)) { names.add(plain[i]); names.add(plain[k]); }
        }
      }
    }
    // five words in a row: "contratto di locazione" is everybody's phrase, a line copied from a document is not
    const words = strip(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (let i = 0; i + 4 < words.length; i++) passages.add(words.slice(i, i + 5).join(' '));
  }
  for (const word of capitalised) if (!lowerSeen.has(word)) names.add(word);
  return { names, numbers, passages, values, empty: names.size === 0 && numbers.size === 0 && values.length === 0 };
}
const EMPTY_INDEX = privateIndex([]);

/**
 * Decide what of `text` may leave. `index` is `privateIndex()` of the turn's private texts; `userSaid` is the message
 * the person wrote now (a datum they typed themselves leads to ASK, never to an automatic exit); `history` is what
 * already left in this conversation (a datum split over several searches is rebuilt from it).
 */
export function gate(text, index = EMPTY_INDEX, { userSaid = '', history = [] } = {}) {
  const removed = [];
  const source = String(text ?? '');
  let out = ` ${source} `;
  const userKeys = new Set((String(userSaid).match(/[\p{L}\p{N}'’]+/gu) ?? []).map(wordKey));
  const userDigits = digitsOf(userSaid);
  let userOwn = false;

  if (WEB_ADDRESS.test(source)) return { outcome: 'BLOCK', reason: 'a search carries no web address: addresses are only read from the results', removed: [{ kind: 'web address' }] };
  for (const [kind, re, ok] of SHAPES) {
    out = out.replace(re, (m) => {
      if (!ok(m)) return m;
      if (digitsOf(m) && userDigits.includes(digitsOf(m))) userOwn = true;
      removed.push({ kind, value: m.trim() });
      return ' ';
    });
  }
  // after the known shapes (so a glued IBAN is called an IBAN): whatever encoded run remains is not a search
  if ((out.match(BLOB) ?? []).some((b) => /\d/.test(b) && /[A-Za-z]/.test(b))) return { outcome: 'BLOCK', reason: 'it carries an encoded string', removed: [...removed, { kind: 'encoded string' }] };
  // the placeholders that stand in for data ("[DATO1]") never leave: behind each one is a real datum that stays here
  out = out.replace(PLACEHOLDER, (m) => { removed.push({ kind: 'placeholder', value: m }); return ' '; });
  // a person's first and last name even when it is not in the documents
  out = out.replace(/(?<![\p{L}])(\p{Lu}\p{Ll}+)\s+(\p{Lu}\p{Ll}+)(?![\p{L}])/gu, (m, first, last) => {
    if (!FIRST_NAMES.has(wordKey(first)) || NOT_NAMES.has(wordKey(last))) return m;
    if (userKeys.has(wordKey(first)) && userKeys.has(wordKey(last))) userOwn = true;
    removed.push({ kind: 'person name', value: m });
    return ' ';
  });
  // word by word: names and numbers from the documents, names spelt letter by letter or glued together
  const collapsed = out.replace(/(?<![\p{L}\p{N}])(?:\p{L}\s){2,}\p{L}(?![\p{L}\p{N}])/gu, (m) => m.replace(/\s/g, ''));
  out = collapsed.replace(/[\p{L}\p{N}'’@$]+/gu, (w) => {
    const key = wordKey(w);
    const digits = digitsOf(w);
    const isName = key.length >= 3 && (index.names.has(key) || (key.length >= 8 && [...index.names].some((n) => n.length >= 5 && key.includes(n))));
    const isNumber = digits.length >= 4 && !YEAR.test(digits) && ([...index.numbers].some((n) => n.includes(digits)) || index.values.some((v) => v.digits.includes(digits)));
    if (!isName && !isNumber) return w;
    if (userKeys.has(key) || (digits && userDigits.includes(digits))) userOwn = true;
    removed.push({ kind: isName ? 'name from the documents' : 'number from the documents', value: w });
    return ' ';
  });
  // a passage copied from the documents: five words in a row equal to a document, counted on the ORIGINAL text, and
  // carrying something distinctive — a name of the documents or a figure. «contratto di locazione ad uso abitativo» is a
  // contract's standard title and everybody's search (measured 2026-10-11: three general searches of the real 7B were
  // blocked on it); «corso vittorio emanuele 88 milano» is not.
  const words = strip(source).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let copied = false;
  for (let i = 0; i + 4 < words.length; i++) {
    const five = words.slice(i, i + 5);
    if (index.passages.has(five.join(' ')) && five.some((w) => /\d/.test(w) || index.names.has(wordKey(w)))) { copied = true; break; }
  }
  if (copied) return { outcome: 'BLOCK', reason: 'it copies a passage of the documents', removed: [...removed, { kind: 'passage from the documents' }] };
  // a slow attack: the digits that left so far, in a row, must not rebuild six digits of a sensitive value
  const sentDigits = [...history, out].map((q) => (String(q).match(/\d+/g) ?? []).join('')).join('');
  if (index.values.some((v) => v.digits.length >= 6 && [...Array(v.digits.length - 5).keys()].some((i) => sentDigits.includes(v.digits.slice(i, i + 6))))) {
    return { outcome: 'BLOCK', reason: 'the searches of this conversation would rebuild a datum', removed: [...removed, { kind: 'pieces of a datum' }] };
  }
  const sent = out.replace(/\s+/g, ' ').trim();
  if (userOwn && removed.length) return { outcome: 'ASK', reason: 'it carries a datum the person wrote: it leaves only if they confirm', removed, sent: source.trim() };
  if (removed.length && (sent.match(/\p{L}{3,}/gu) ?? []).length < 2) return { outcome: 'BLOCK', reason: 'without the private pieces nothing is left to search', removed };
  const topic = sensitiveTopic(sent);
  if (topic && !index.empty) return { outcome: 'ASK', reason: `sensitive topic (${topic}) in a turn that read documents: it leaves only if the person confirms`, removed, sent, topic };
  return removed.length ? { outcome: 'CLEAN', sent, removed } : { outcome: 'PROCEED', sent };
}

/** A tool whose arguments leave this computer: the web search, and any tool the operator registered as external. */
export const leavesThisComputer = (tool) => Boolean(tool?.external) || (tool?.transport === 'builtin' && tool?.config?.method === 'research.search');
const RANK = { PROCEED: 0, CLEAN: 1, ASK: 2, BLOCK: 3 };
/**
 * Every string inside a tool's arguments, gated one by one. The worst outcome decides; `value` is the gated form (a
 * CLEAN string without its private pieces, the others as they were); `kinds` names what was removed, never the values.
 */
export function gateArguments(value, index = EMPTY_INDEX, options = {}) {
  const results = [];
  const walk = (item) => {
    if (typeof item === 'string') { const r = gate(item, index, options); results.push(r); return r.outcome === 'CLEAN' ? r.sent : item; }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, walk(inner)]));
    return item;
  };
  const gated = walk(value);
  const worst = results.reduce((top, r) => (RANK[r.outcome] > RANK[top.outcome] ? r : top), { outcome: 'PROCEED' });
  const kinds = [...new Set(results.flatMap((r) => (r.removed ?? []).map((piece) => piece.kind)))];
  return { value: gated, worst, kinds, sent: results.map((r) => r.sent ?? '').filter(Boolean) };
}

/**
 * Placeholders: before the search writer sees the person's message, data become [DATO1], [DATO2]… The table stays on
 * the server and serves only the writer of the answer, which has no way out. A surname never seen cannot be translated.
 */
export function pseudonymize(text, index = EMPTY_INDEX) {
  const found = gate(text, index).removed ?? [];
  const table = new Map();
  let masked = String(text ?? '');
  for (const { value } of found) {
    const key = String(value ?? '').trim();
    if (!key || /^\[DATO\d+\]$/.test(key) || table.has(key)) continue;
    const tag = `[DATO${table.size + 1}]`;
    table.set(key, tag);
    masked = masked.split(key).join(tag);
  }
  return { masked, table };
}

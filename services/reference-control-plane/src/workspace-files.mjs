// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A person's files, seen through the workspace: `files.list` and `files.read`. Phase 5 of the plain-language interface, first slice:
// READING only. Writing, moving and joining stay with the plan -> shadow -> approve flow the engine already has, and are not here.
//
// The workspace is the folder the installer mounts, so it is where a person's own files are. It is also where the engine keeps its
// state (`config/`, `audit/`, `state/auth.json`…), and that is the whole care of this module: a reader that takes a path from a
// model must never return what `repo-map.mjs` hides from its scanner. Three refusals, each answered as "not found" so that a
// refusal cannot be used to learn what exists:
//   - the path IS or lies inside the engine's state (`isInsideEngineState`: a directory, a file, or a copy of a file);
//   - the path, followed to where it really lands, is outside the workspace (a symlink the person or a program left behind);
//   - the entry is not a plain file or folder.
// Listings leave the engine's own entries out instead of refusing, so the root of the workspace shows a person their things.
//
// ponytail: text, PDF and Office files only, and a byte ceiling instead of streaming. Upgrade path: the extractor already knows
// images (OCR) and archives; they are one branch each when somebody asks for them.

import { readdirSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, extname, basename, sep, resolve } from 'node:path';
import { isInsideEngineState, DELIBERATELY_SCANNED_PATHS } from './repo-map.mjs';
import { sniffContentType, looksLikeText } from './ai-workspace/file-extractors.mjs';

export class FilesError extends Error {
  constructor(kind, message) { super(message); this.name = 'FilesError'; this.kind = kind; }
}

/** What one call returns, in characters. The chat's context is a few thousand tokens; the rest is read by asking for the next offset. */
export const READ_CHARS = 12_000;
/** Larger than this is not opened at all. */
export const READ_MAX_BYTES = 8 * 1024 * 1024;
export const LIST_MAX = 100;
const OFFICE = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.epub']);

/**
 * What people keep as files, by name, in the interface's six languages. Written out form by form (singular and plural), because a
 * stem with a question mark is how "lettera" was missed on the first try. Words that are also something else are left out: carta,
 * brief, notes, quote.
 */
const KEPT_AS_FILES = new RegExp(`\\b(?:${[
  'documents?', 'letters?', 'contracts?', 'invoices?', 'receipts?',
  'documento', 'documenti', 'documentos', 'lettera', 'lettere', 'contratto', 'contratti', 'fattura', 'fatture', 'ricevuta', 'ricevute',
  'bolletta', 'bollette', 'relazione', 'relazioni', 'verbale', 'verbali', 'preventivo', 'preventivi', 'appunti',
  'contrato', 'contratos', 'factura', 'facturas', 'recibo', 'recibos', 'informe', 'informes', 'presupuesto', 'presupuestos', 'apuntes',
  'lettre', 'lettres', 'contrat', 'contrats', 'facture', 'factures', 're[cç]u', 're[cç]us', 'rapport', 'rapports', 'devis',
  'dokument', 'dokumente', 'vertrag', 'vertr[aä]ge', 'rechnung', 'rechnungen', 'bericht', 'berichte', 'angebot', 'angebote', 'notizen',
  'fatura', 'faturas', 'relat[oó]rio', 'relat[oó]rios', 'or[cç]amento', 'or[cç]amentos', 'anota[cç][oõ]es',
].join('|')})\\b`, 'i');

/**
 * Does a message name a file or a folder of the person's? A file name with an extension, or the plain word for "file" or "folder" in
 * the six languages the interface speaks. It decides one thing, whether two small tool schemas ride in an otherwise tool-less turn,
 * so it errs toward offering: a wrong yes costs a few hundred bytes of schema, a wrong no is "I cannot read files" said to someone
 * who just named one. The plain words are unambiguous; the names of things people keep (letter, invoice, contract…) count only when
 * the message is a question, because "write me a letter" asks for the opposite.
 */
export function mentionsFiles(message, { asking = false } = {}) {
  const text = String(message ?? '');
  if (/\.(?:txt|md|csv|pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|html?|epub)\b|\b(?:files?|folders?|cartella|cartelle|archivos?|carpetas?|fichiers?|dossiers?|dateien|datei|ordner|arquivos?|pastas?)\b/i.test(text)) return true;
  // People say "the letter from the building" and never "the file". For a QUESTION (`asking`) the names of the things people keep as
  // files count too, measured 2026-10-08: with only the words above, "dimmi la data nella lettera del condominio" got no tool and an
  // answer telling the person to go and read it. Not for a request to write: "scrivi una lettera" asks for the opposite.
  return asking && KEPT_AS_FILES.test(text);
}

const shown = (workspaceRoot, target) => relative(resolve(workspaceRoot), target).split(sep).join('/') || '.';
const missing = (what, workspaceRoot, target) => new FilesError('NOT_FOUND', `\`${shown(workspaceRoot, target)}\` is not ${what} in the workspace`);

/**
 * The files of one name, wherever they are in the workspace (the person's, never the engine's): a model that is given "nota.txt" says
 * `nota.txt`, or `Casa/Nota.txt`, and the file is `Casa/nota.txt`. Case-insensitive, at most 5,000 entries looked at, at most 6 found.
 */
function findByName(workspaceRoot, name) {
  const wanted = basename(String(name)).toLowerCase();
  const root = resolve(workspaceRoot);
  const found = [];
  const stack = [root];
  let looked = 0;
  while (stack.length && looked < 5000 && found.length < 6) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      looked += 1;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if ((dir === root && PRODUCT_FOLDERS.has(entry.name)) || isInsideEngineState(root, full)) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.toLowerCase() === wanted) found.push(full);
    }
  }
  return found;
}

/** Where `target` really is, refused unless it is inside the workspace and is not the engine's. */
function personal(workspaceRoot, target, what) {
  let real;
  try { real = realpathSync(target); } catch { throw missing(what, workspaceRoot, target); }
  let realRoot;
  try { realRoot = realpathSync(workspaceRoot); } catch { throw missing(what, workspaceRoot, target); }
  if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) throw missing(what, workspaceRoot, target);
  if (isInsideEngineState(workspaceRoot, target)) throw missing(what, workspaceRoot, target);
  return real;
}

/**
 * Folders the product keeps at the top of the workspace and a person never put there: the ones the scanner deliberately still reads
 * (`DELIBERATELY_SCANNED_PATHS`: state, logs, backups, files…) and the shadows. Left out of the TOP listing only, so "what is in my
 * folder" is not answered with the product's own housekeeping; they stay readable by path, exactly as for the scanner.
 */
const PRODUCT_FOLDERS = new Set([...Object.keys(DELIBERATELY_SCANNED_PATHS), 'shadows']);

/** How many folders deep a listing goes (the folder asked about is the first), and how many entries it looks at before it stops. */
export const LIST_DEPTH = 3;
const LIST_LOOKED = 5000;

/**
 * The FILES below one folder, shallowest first, each named by its path from the workspace so that the path can be read as it stands.
 * Measured on 2026-10-08 with a 7B: given the top of a folder it asked the person for a file name that one more level would have
 * shown, so one call has to be enough to find a file in a person's folder. Dotfiles, symlinks and the engine's and the product's own
 * entries are left out; a folder with nothing readable shows nothing.
 */
export function listFolder(workspaceRoot, target) {
  const real = personal(workspaceRoot, target, 'a folder');
  if (!lstatSync(real).isDirectory()) throw missing('a folder', workspaceRoot, target);
  const realRoot = realpathSync(workspaceRoot);
  const entries = [];
  let total = 0; let looked = 0;
  const queue = [{ dir: target, depth: 1 }];
  while (queue.length && looked < LIST_LOOKED) {
    const { dir, depth } = queue.shift();
    let here;
    try { here = realpathSync(dir); } catch { continue; }
    let found;
    try { found = readdirSync(here, { withFileTypes: true }); } catch { continue; }
    found.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of found) {
      looked += 1;
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || (here === realRoot && PRODUCT_FOLDERS.has(entry.name))) continue;
      const full = join(dir, entry.name);
      try { personal(workspaceRoot, full, 'an entry'); } catch { continue; }
      if (entry.isDirectory()) { if (depth < LIST_DEPTH) queue.push({ dir: full, depth: depth + 1 }); continue; }
      if (!entry.isFile()) continue;
      total += 1;
      if (entries.length < LIST_MAX) {
        const stat = lstatSync(full);
        entries.push({ path: shown(workspaceRoot, full), bytes: stat.size, modified: stat.mtime.toISOString().slice(0, 10) });
      }
    }
  }
  return { path: shown(workspaceRoot, target), total, truncated: total > entries.length || looked >= LIST_LOOKED, entries };
}

const normalize = (text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const wordsOf = (text) => normalize(text).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3);
const EXTENSION_WORDS = new Set(['txt', 'md', 'csv', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'htm', 'html', 'epub', 'json']);
/** "fattura" and "fatture", "lettera" and "lettere": the same word up to its last letter. Shorter words must be equal. */
function sameWord(a, b) {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  let prefix = 0;
  while (prefix < shorter && a[prefix] === b[prefix]) prefix += 1;
  return prefix >= shorter - 1;
}

/**
 * The ONE file a message is about, found by the words of its path, and its text, as a passage the chat carries like any retrieved
 * source (`{ sourceId, index, text, source: { name }, score }`). Not the model's job: asked to list, choose and read, a 7B did it 3
 * times in 8 (files_live.mjs, 2026-10-08), and a person who says "la lettera del condominio" is not going to say the file name.
 *
 * A file qualifies when the message contains its whole name ("Riassumi nota.txt"), or at least two words of its path (folders
 * included: "la fattura di marzo" finds `Fatture/fattura-marzo.txt`) — and only when it beats the next best. Anything less sure
 * returns nothing and the model is left to look with the file tools. The engine's files cannot match: the listing never shows them.
 */
export async function filePassagesFor(workspaceRoot, message, { extract = null } = {}) {
  const asked = wordsOf(message);
  if (!asked.length) return [];
  const root = resolve(workspaceRoot);
  const scored = listFolder(root, root).entries.map((entry) => {
    const name = basename(entry.path);
    if (normalize(message).includes(normalize(name))) return { entry, score: 100 };
    const pathWords = [...new Set(wordsOf(entry.path).filter((word) => !EXTENSION_WORDS.has(word)))];
    // words of four letters or more: "del" and "per" appear in half the names a person gives their files and in every sentence
    const matched = pathWords.filter((word) => word.length >= 4 && asked.some((candidate) => sameWord(candidate, word)));
    return { entry, score: matched.length >= 2 && matched.some((word) => word.length >= 5) ? matched.length : 0 };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return [];
  const path = scored[0].entry.path;
  const read = await readFileText(root, join(root, path), { extract });
  if (!read.readable || !read.text) return [];
  const text = read.nextOffset === null ? read.text : `${read.text}\n[the file continues; only its first part is shown here]`;
  return [{ sourceId: `file:${path}`, index: 0, text, source: { name: path }, score: scored[0].score }];
}

/**
 * One file as text. `extract` is the product's own file extractor, passed in (`({name, bytes}) => {text, status, warning}`): PDF and
 * Office files go through it, plain text does not need it. A file that cannot be read comes back as `readable:false` with a reason a
 * person can be told, not as an error: "this is a photo" is an answer.
 */
export async function readFileText(workspaceRoot, target, { offset = 0, extract = null } = {}) {
  let real;
  try { real = personal(workspaceRoot, target, 'a file'); } catch (error) {
    if (!(error instanceof FilesError)) throw error;
    // Not there as written: a bare name, the wrong case, or the folder left out. One file of that name anywhere in the person's
    // folder is the file; several are listed, so the person (or the model) can say which. The engine's own files never match.
    const [only, ...others] = findByName(workspaceRoot, target);
    if (!only) throw error;
    if (others.length) return { path: shown(workspaceRoot, target), readable: false, reason: `there are several files with that name: ${[only, ...others].map((file) => shown(workspaceRoot, file)).join(', ')}` };
    target = only;
    real = personal(workspaceRoot, target, 'a file');
  }
  const stat = lstatSync(real);
  if (!stat.isFile()) throw missing('a file', workspaceRoot, target);
  const path = shown(workspaceRoot, target);
  if (stat.size > READ_MAX_BYTES) return { path, bytes: stat.size, readable: false, reason: `this file is larger than ${READ_MAX_BYTES / 1024 / 1024} MB, too big to read here` };
  const bytes = readFileSync(real);
  const type = sniffContentType(bytes);
  const extension = extname(real).toLowerCase();
  let text; let readAs;
  if (type === 'unknown' && looksLikeText(bytes)) { text = bytes.toString('utf8').replace(/\0/g, ''); readAs = 'text'; }
  else if (type === 'pdf' || (type === 'zip' && OFFICE.has(extension))) {
    if (!extract) return { path, bytes: stat.size, readable: false, reason: 'this installation cannot read PDF or Office files' };
    const result = await extract({ name: basename(real), bytes });
    if (result.status !== 'complete' || !String(result.text ?? '').trim()) {
      return { path, bytes: stat.size, readable: false, reason: String(result.warning ?? 'no text could be taken out of this file').slice(0, 300) };
    }
    text = result.text; readAs = type === 'pdf' ? 'pdf' : 'office';
  } else {
    return { path, bytes: stat.size, readable: false, reason: `this is ${type === 'unknown' ? 'a binary file' : `a ${type} file`}; only text, PDF and Word, Excel or PowerPoint files can be read` };
  }
  const start = Math.max(0, Math.min(Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0, text.length));
  const end = Math.min(text.length, start + READ_CHARS);
  return { path, bytes: stat.size, readable: true, readAs, chars: text.length, offset: start, text: text.slice(start, end), nextOffset: end < text.length ? end : null };
}

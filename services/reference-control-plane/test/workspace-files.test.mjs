// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `files.list` and `files.read` (`workspace-files.mjs`): a person's own files, read only, through the workspace that is also where the
// engine keeps its state. What is defended is the property that the reader returns what a person put there and nothing the engine
// hides from its own scanner, whatever path a model names. The oracle for each refusal is a canary string that must never appear.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { listFolder, readFileText, mentionsFiles, filePassagesFor, FilesError, READ_CHARS, READ_MAX_BYTES, LIST_MAX } from '../src/workspace-files.mjs';
import { createSessionDispatch, ProtocolError } from '../src/session-protocol.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'noesar-files-'));
  const outside = mkdtempSync(join(tmpdir(), 'noesar-outside-'));
  for (const dir of ['config', 'audit', 'state', 'notes', 'photos', 'logs', 'files', 'shadows', 'notes/logs']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'letter.txt'), 'Dear Anna, the CANARY_LETTER is here.\n');
  writeFileSync(join(root, 'notes/logs/today.txt'), 'a folder of the person\'s own called logs');
  for (const product of ['logs/noesar.log', 'files/blob.txt', 'shadows/run.txt']) writeFileSync(join(root, product), 'product housekeeping');
  writeFileSync(join(root, 'notes/ideas.md'), '# Ideas\n- one\n');
  writeFileSync(join(root, '.secret-note'), 'CANARY_DOT');
  writeFileSync(join(root, 'config/provider-credentials.key'), 'CANARY_KEY');
  writeFileSync(join(root, 'audit/events.jsonl'), '{"e":"CANARY_AUDIT"}');
  writeFileSync(join(root, 'state/auth.json'), '{"h":"CANARY_AUTH"}');
  writeFileSync(join(root, 'state/auth.json.bak_old'), '{"h":"CANARY_COPY"}');
  writeFileSync(join(root, 'state/machine.txt'), 'the operator\'s own file');
  writeFileSync(join(outside, 'passwd'), 'CANARY_OUTSIDE');
  symlinkSync(outside, join(root, 'photos/to-outside'));
  symlinkSync(join(outside, 'passwd'), join(root, 'notes/passwd-link'));
  symlinkSync(join(root, 'config'), join(root, 'notes/to-config'));
  writeFileSync(join(root, 'photos/me.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  return { root, outside, done: () => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); } };
}
const at = (root, path = '') => join(root, path);

describe('listing a folder', () => {
  test('shows a person their files, all levels at once, by path; the engine\'s and the product\'s own are not among them', () => {
    const { root, done } = workspace();
    try {
      const top = listFolder(root, at(root));
      const paths = top.entries.map((entry) => entry.path);
      // shallowest first, and each path is what `files.read` takes as it stands
      assert.deepEqual(paths, ['letter.txt', 'notes/ideas.md', 'photos/me.png', 'notes/logs/today.txt']);
      assert.equal(top.total, 4);
      assert.ok(!paths.some((path) => /^(logs|files|shadows|state|config|audit)\//.test(path)), 'housekeeping and engine state are not offered at the top');
      assert.ok(!paths.includes('.secret-note'), 'dotfiles are not listed');
      assert.ok(top.entries[0].bytes > 0 && /^\d{4}-\d{2}-\d{2}$/.test(top.entries[0].modified));
      assert.equal(listFolder(root, at(root, 'logs')).entries[0].path, 'logs/noesar.log', 'and the product\'s own logs/ is still listable by path, as for the scanner');
    } finally { done(); }
  });

  test('goes three folders deep and no further', () => {
    const { root, done } = workspace();
    try {
      mkdirSync(join(root, 'x/y/w/u'), { recursive: true });
      writeFileSync(join(root, 'x/y/z.txt'), '2'); writeFileSync(join(root, 'x/y/w/v.txt'), '3'); writeFileSync(join(root, 'x/y/w/u/deep.txt'), '4');
      // the folder asked about is the first level: x, x/y, x/y/w
      assert.deepEqual(listFolder(root, at(root, 'x')).entries.map((entry) => entry.path), ['x/y/z.txt', 'x/y/w/v.txt']);
    } finally { done(); }
  });

  test('the state/ container lists the operator\'s file and not auth.json or its copy', () => {
    const { root, done } = workspace();
    try { assert.deepEqual(listFolder(root, at(root, 'state')).entries.map((entry) => entry.path), ['state/machine.txt']); } finally { done(); }
  });

  test('a folder that is, or lies inside, the engine\'s state is "not a folder", whatever it is called', () => {
    const { root, done } = workspace();
    try {
      for (const path of ['config', 'audit', 'notes/to-config', 'photos/to-outside', 'nowhere']) {
        assert.throws(() => listFolder(root, at(root, path)), (error) => error instanceof FilesError && error.kind === 'NOT_FOUND', path);
      }
    } finally { done(); }
  });

  test('a symlink that points out of the workspace, or into the engine\'s state, is not listed', () => {
    const { root, done } = workspace();
    try {
      assert.deepEqual(listFolder(root, at(root, 'notes')).entries.map((entry) => entry.path), ['notes/ideas.md', 'notes/logs/today.txt']);
      assert.deepEqual(listFolder(root, at(root, 'photos')).entries.map((entry) => entry.path), ['photos/me.png']);
    } finally { done(); }
  });

  test('a very large folder is cut, and says so', () => {
    const { root, done } = workspace();
    try {
      mkdirSync(join(root, 'many'));
      for (let index = 0; index < LIST_MAX + 5; index += 1) writeFileSync(join(root, 'many', `f${String(index).padStart(4, '0')}.txt`), 'x');
      const listing = listFolder(root, at(root, 'many'));
      assert.equal(listing.entries.length, LIST_MAX);
      assert.equal(listing.total, LIST_MAX + 5);
      assert.equal(listing.truncated, true);
    } finally { done(); }
  });
});

describe('reading a file', () => {
  test('returns the text, the way the person wrote it', async () => {
    const { root, done } = workspace();
    try {
      const result = await readFileText(root, at(root, 'letter.txt'));
      assert.equal(result.readable, true);
      assert.equal(result.readAs, 'text');
      assert.match(result.text, /CANARY_LETTER/);
      assert.equal(result.nextOffset, null);
      assert.equal(result.path, 'letter.txt');
    } finally { done(); }
  });

  test('a long file is read in pages: the next offset continues exactly where this one stopped', async () => {
    const { root, done } = workspace();
    try {
      const text = 'abcdefghij'.repeat(3_500);              // 35,000 characters
      writeFileSync(join(root, 'long.txt'), text);
      let offset = 0; let assembled = ''; let pages = 0;
      while (offset !== null) {
        const page = await readFileText(root, at(root, 'long.txt'), { offset });
        assert.ok(page.text.length <= READ_CHARS);
        assembled += page.text; offset = page.nextOffset; pages += 1;
      }
      assert.equal(assembled, text);
      assert.equal(pages, 3);
      const past = await readFileText(root, at(root, 'long.txt'), { offset: 10 ** 9 });
      assert.equal(past.text, '', 'an offset past the end is the end, not an error');
      assert.equal((await readFileText(root, at(root, 'long.txt'), { offset: 'banana' })).offset, 0);
    } finally { done(); }
  });

  test('refuses the engine\'s state as a file, with the answer a missing file gets', async () => {
    const { root, done } = workspace();
    try {
      for (const path of ['config/provider-credentials.key', 'audit/events.jsonl', 'state/auth.json', 'state/auth.json.bak_old', 'notes/to-config/provider-credentials.key', 'notes/passwd-link', 'photos/to-outside/passwd', 'nowhere.txt']) {
        await assert.rejects(readFileText(root, at(root, path)), (error) => error instanceof FilesError && error.kind === 'NOT_FOUND' && !/CANARY/.test(error.message), path);
      }
      assert.match((await readFileText(root, at(root, 'state/machine.txt'))).text, /operator's own file/, 'an operator\'s own file in state/ is still a file');
    } finally { done(); }
  });

  test('a bare name, the wrong case or a missing folder finds the one file of that name; several are listed; the engine\'s files never match', async () => {
    const { root, done } = workspace();
    try {
      mkdirSync(join(root, 'a')); mkdirSync(join(root, 'b'));
      writeFileSync(join(root, 'a/twin.txt'), 'one'); writeFileSync(join(root, 'b/twin.txt'), 'two');
      assert.equal((await readFileText(root, at(root, 'ideas.md'))).path, 'notes/ideas.md', 'a bare name');
      assert.equal((await readFileText(root, at(root, 'Notes/IDEAS.MD'))).path, 'notes/ideas.md', 'the wrong case');
      assert.equal((await readFileText(root, at(root, 'elsewhere/letter.txt'))).path, 'letter.txt', 'the wrong folder');
      const several = await readFileText(root, at(root, 'twin.txt'));
      assert.equal(several.readable, false);
      assert.match(several.reason, /several files with that name: .*a\/twin\.txt.*b\/twin\.txt|several files with that name: .*b\/twin\.txt.*a\/twin\.txt/);
      // the engine's files: not by path (above), and not by their bare name either — and a symlink is not a candidate
      for (const name of ['provider-credentials.key', 'auth.json', 'auth.json.bak_old', 'events.jsonl', 'passwd-link']) {
        await assert.rejects(readFileText(root, at(root, name)), (error) => error instanceof FilesError && error.kind === 'NOT_FOUND' && !/CANARY/.test(error.message), name);
      }
    } finally { done(); }
  });

  test('a name the engine also uses is the person\'s own file when they have one: the engine\'s copy is not a second candidate', async () => {
    // Refused at the end either way, but a lookup that COUNTS the engine's file answers "several files with that name: config/…, notes/…":
    // a refusal that names a path inside the engine's state has already said what is there.
    const { root, done } = workspace();
    try {
      writeFileSync(join(root, 'notes/provider-credentials.key'), 'mine, not the engine\'s');
      const result = await readFileText(root, at(root, 'provider-credentials.key'));
      assert.deepEqual([result.readable, result.path, result.text], [true, 'notes/provider-credentials.key', 'mine, not the engine\'s']);
    } finally { done(); }
  });

  test('a folder is not a file, and a file is not a folder', async () => {
    const { root, done } = workspace();
    try {
      await assert.rejects(readFileText(root, at(root, 'notes')), (error) => error.kind === 'NOT_FOUND');
      assert.throws(() => listFolder(root, at(root, 'letter.txt')), (error) => error.kind === 'NOT_FOUND');
    } finally { done(); }
  });

  test('a file too large to open is said to be too large, and is not opened', async () => {
    const { root, done } = workspace();
    try {
      writeFileSync(join(root, 'huge.txt'), Buffer.alloc(READ_MAX_BYTES + 1, 97));
      const result = await readFileText(root, at(root, 'huge.txt'));
      assert.equal(result.readable, false);
      assert.match(result.reason, /too big/);
    } finally { done(); }
  });

  test('a photo is an answer ("this is a png file"), not an error and not gibberish', async () => {
    const { root, done } = workspace();
    try {
      const result = await readFileText(root, at(root, 'photos/me.png'));
      assert.deepEqual([result.readable, /png file/.test(result.reason)], [false, true]);
      assert.equal(result.text, undefined);
    } finally { done(); }
  });

  test('PDF and Office files go through the extractor, and its refusal reaches the person in words', async () => {
    const { root, done } = workspace();
    try {
      writeFileSync(join(root, 'report.pdf'), Buffer.from('%PDF-1.4\n…binary…'));
      writeFileSync(join(root, 'plan.docx'), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('zipbytes')]));
      writeFileSync(join(root, 'archive.zip'), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('zipbytes')]));
      const seen = [];
      const extract = async ({ name, bytes }) => { seen.push([name, bytes.length > 0]); return { status: 'complete', text: `text of ${name}` }; };
      assert.equal((await readFileText(root, at(root, 'report.pdf'), { extract })).text, 'text of report.pdf');
      const word = await readFileText(root, at(root, 'plan.docx'), { extract });
      assert.deepEqual([word.readAs, word.text], ['office', 'text of plan.docx']);
      assert.equal((await readFileText(root, at(root, 'archive.zip'), { extract })).readable, false, 'a plain zip is not an Office file');
      assert.deepEqual(seen.map(([name]) => name), ['report.pdf', 'plan.docx']);

      const noReader = await readFileText(root, at(root, 'report.pdf'));
      assert.match(noReader.reason, /cannot read PDF or Office/);
      const unavailable = await readFileText(root, at(root, 'report.pdf'), { extract: async () => ({ status: 'extractor_unavailable', text: '', warning: 'pdftotext is not installed.' }) });
      assert.deepEqual([unavailable.readable, unavailable.reason], [false, 'pdftotext is not installed.']);
    } finally { done(); }
  });
});

describe('the file a message is about', () => {
  const home = () => {
    const base = workspace();
    for (const dir of ['Fatture', 'Casa', 'Lavoro']) mkdirSync(join(base.root, dir));
    writeFileSync(join(base.root, 'Fatture/fattura-marzo.txt'), 'Fattura n. 112. Importo totale: 1.250 euro.');
    writeFileSync(join(base.root, 'Fatture/fattura-aprile.txt'), 'Fattura n. 131. Importo totale: 780 euro.');
    writeFileSync(join(base.root, 'lettera-condominio.txt'), 'Assemblea il 15 novembre alle 18:30.');
    writeFileSync(join(base.root, 'contratto-del-condominio.txt'), 'Il contratto.');
    writeFileSync(join(base.root, 'Casa/nota.txt'), 'Portare le chiavi.');
    writeFileSync(join(base.root, 'Lavoro/relazione-trimestrale.pdf'), Buffer.from('%PDF-1.4\n…'));
    writeFileSync(join(base.root, 'Lavoro/foto-vacanza-mare.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
    return base;
  };
  const found = async (root, message, options) => (await filePassagesFor(root, message, options)).map((passage) => passage.source.name);

  test('finds the one file by the words of its path, folders included, accents and plurals and case aside', async () => {
    const { root, done } = home();
    try {
      assert.deepEqual(await found(root, 'Quanto devo pagare con la fattura di Marzo?'), ['Fatture/fattura-marzo.txt']);
      assert.deepEqual(await found(root, 'dimmi la data e l\'ora dell\'assemblea nella lettera del condominio'), ['lettera-condominio.txt'], '"del" is not a word that finds anything');
      assert.deepEqual(await found(root, 'Riassumi NOTA.TXT'), ['Casa/nota.txt'], 'the whole name, anywhere in the folder, whatever the case');
      const [passage] = await filePassagesFor(root, 'la fattura di marzo');
      assert.deepEqual([passage.sourceId, passage.index, passage.text], ['file:Fatture/fattura-marzo.txt', 0, 'Fattura n. 112. Importo totale: 1.250 euro.']);
    } finally { done(); }
  });

  test('says nothing when it is not sure: a tie, one word, a stop-word, nothing — the model is left to look', async () => {
    const { root, done } = home();
    try {
      assert.deepEqual(await found(root, 'quanto costa una fattura?'), [], 'two invoices fit equally: none is chosen');
      assert.deepEqual(await found(root, 'dimmi del contratto'), [], 'one word is not enough');
      assert.deepEqual(await found(root, 'ciao come stai'), []);
      assert.deepEqual(await found(root, ''), []);
      assert.deepEqual(await found(root, 'la foto della vacanza al mare'), [], 'a photo cannot be read');
    } finally { done(); }
  });

  test('never reaches the engine\'s files, by name or by words', async () => {
    const { root, done } = home();
    try {
      for (const message of ['leggi auth.json', 'provider credentials key', 'events jsonl audit', 'state auth json']) assert.deepEqual(await found(root, message), [], message);
    } finally { done(); }
  });

  test('PDF goes through the extractor; a long file is cut and says so', async () => {
    const { root, done } = home();
    try {
      const extract = async ({ name }) => ({ status: 'complete', text: `text of ${name}` });
      assert.deepEqual((await filePassagesFor(root, 'riassumi la relazione trimestrale', { extract })).map((passage) => passage.text), ['text of relazione-trimestrale.pdf']);
      writeFileSync(join(root, 'Lavoro/diario-lungo.txt'), 'abcdefghij'.repeat(2_000));
      const [long] = await filePassagesFor(root, 'cosa dice il diario lungo');
      assert.match(long.text, /\[the file continues; only its first part is shown here\]$/);
    } finally { done(); }
  });
});

describe('does a message name a file', () => {
  test('a file name with an extension, or the word for file or folder in the six languages', () => {
    for (const text of ['riassumi lettera.docx', 'resume el archivo de mi carpeta', 'Résume mon fichier', 'Fasse meine Datei zusammen', 'Resuma o arquivo na pasta', 'what is in my files?', 'open budget.xlsx please']) {
      assert.equal(mentionsFiles(text), true, text);
    }
  });
  test('and not a request to write one, nor an empty message', () => {
    for (const text of ['write a document to my accountant', 'Scrivi una email al commercialista', 'hello', '', null, undefined]) {
      assert.equal(mentionsFiles(text), false, String(text));
    }
    for (const text of ['scrivi una lettera al comune', 'redacta un contrato', 'Écris une lettre', 'Schreib einen Brief']) {
      assert.equal(mentionsFiles(text), false, `a request to write is not asking about a file: ${text}`);
    }
  });
  test('in a QUESTION the names of what people keep as files count too, in the six languages', () => {
    for (const text of ['dimmi la data dell\'assemblea nella lettera del condominio', 'cuánto es el total de la factura de marzo', 'quel est le montant de la facture', 'Wie hoch ist der Betrag der Rechnung', 'qual é o valor da fatura', 'what does my contract say about notice?']) {
      assert.equal(mentionsFiles(text, { asking: true }), true, text);
      assert.equal(mentionsFiles(text), false, `without asking the noun alone is not enough: ${text}`);
    }
  });
});

describe('through the session protocol', () => {
  // the server's own resolver, restated: a path under the workspace or null
  const resolveWorkspaceSubpath = (root, sub) => {
    const base = resolve(root);
    if (!sub) return base;
    const candidate = resolve(base, String(sub));
    return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
  };
  const allow = () => true;
  const dispatchFor = (root, extra = {}) => createSessionDispatch({ workspaceRoot: root, resolveWorkspaceSubpath, ...extra });

  test('files.list and files.read answer, and a path outside the workspace or in the engine\'s state is INVALID_PATH', async () => {
    const { root, done } = workspace();
    try {
      const dispatch = dispatchFor(root);
      assert.ok((await dispatch('files.list', {}, 'owner', allow)).entries.some((entry) => entry.path === 'letter.txt'));
      assert.match((await dispatch('files.read', { path: 'letter.txt' }, 'owner', allow)).text, /CANARY_LETTER/);
      for (const call of [['files.read', { path: '../../etc/passwd' }], ['files.read', { path: 'state/auth.json' }], ['files.list', { path: 'config' }], ['files.read', { path: 'nowhere.txt' }]]) {
        await assert.rejects(dispatch(call[0], call[1], 'owner', allow), (error) => error instanceof ProtocolError && error.kind === 'INVALID_PATH', JSON.stringify(call));
      }
      await assert.rejects(dispatch('files.read', {}, 'owner', allow), (error) => error instanceof ProtocolError && error.kind === 'INVALID_REQUEST');
    } finally { done(); }
  });

  test('the permission is the same one the scanner asks, and the caller\'s own can() decides', async () => {
    const { root, done } = workspace();
    try {
      const dispatch = dispatchFor(root);
      const asked = [];
      await dispatch('files.read', { path: 'letter.txt' }, 'owner', (permission) => { asked.push(permission); return true; });
      assert.deepEqual(asked, ['workspace.read']);
      await assert.rejects(dispatch('files.list', {}, 'viewer', () => false), (error) => error instanceof ProtocolError);
    } finally { done(); }
  });
});

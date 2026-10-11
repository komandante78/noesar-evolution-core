// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The egress gate (`ai-workspace/egress-gate.mjs`) — Owner, 2026-10-10: «internet entra, i dati del cliente non escono».
//
// The cases are the ones of the simulation done before any product code (Desktop\Noesar Evolution\
// PROGETTO_DATI_CLIENTE_20261010\SIMULAZIONE): invented documents whose tax codes, IBANs and VAT numbers carry REAL check
// digits, so the gate must recognise them for what they are. A second, independent judge (`leaks`) decides whether a
// text that left still carries a secret; it is written apart from the gate on purpose, so a weakness in the gate cannot
// also be a weakness in the measure. The last block proves the measure can fail: with the gate taken out, it finds leaks.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { gate, privateIndex, pseudonymize, sensitiveTopic } from '../src/ai-workspace/egress-gate.mjs';

const ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
const cf = (s15) => { let sum = 0; for (let i = 0; i < 15; i++) { const c = s15[i]; sum += i % 2 === 0 ? ODD[c] : (/\d/.test(c) ? +c : c.charCodeAt(0) - 65); } return s15 + String.fromCharCode(65 + (sum % 26)); };
const iban = (bban) => { let r = 0; for (const ch of `${bban}IT00`) for (const d of (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))) r = (r * 10 + +d) % 97; return `IT${String(98 - r).padStart(2, '0')}${bban}`; };
const piva = (d10) => { let sum = 0; for (let i = 0; i < 10; i++) { let n = +d10[i]; if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; } return d10 + ((10 - (sum % 10)) % 10); };

const CF_ROSSI = cf('RSSMRA80A01F205');
const CF_BIANCHI = cf('BNCGPP61C12L219');
const IBAN = iban('X0542811101000000123456');
const PIVA = piva('0123456789');
const spaced = (s) => s.match(/.{1,4}/g).join(' ');
const DOCS = [
  `CONTRATTO DI LOCAZIONE AD USO ABITATIVO
Il locatore Giuseppe Bianchi, nato a Torino il 12/03/1961, codice fiscale ${CF_BIANCHI}, residente in Via Garibaldi 14, Torino, concede in locazione al conduttore Mario Rossi, codice fiscale ${CF_ROSSI}, l'appartamento sito in Corso Vittorio Emanuele 88, Milano. Il canone mensile è di 1.150 euro, da versare sull'IBAN ${spaced(IBAN)} intestato a Giuseppe Bianchi. Telefono del locatore 347 123 4567, email g.bianchi@example.it.`,
  `Fattura n. 2026/0457 del 03/09/2026
Cliente: Ferramenta Colombo Srl, partita IVA ${PIVA}, Via Roma 5, Monza.
Pagamento con carta 4111 1111 1111 1111.`,
  `Referto del 22/08/2026
Paziente: Lucia Ferraro, nata il 05/07/1975.
Diagnosi: ernia discale L4-L5. Medico: dott. Andrea Gallo.`,
];
const index = privateIndex(DOCS);

// the independent judge
const SECRET_NAMES = ['rossi', 'bianchi', 'giuseppe', 'ferraro', 'lucia', 'colombo', 'gallo'];
const SECRET_VALUES = [CF_ROSSI, CF_BIANCHI, IBAN, PIVA, '4111111111111111', '3471234567', 'g.bianchi@example.it', '05071975'];
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[013457@$]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' }[c]));
function leaks(sent) {
  if (!sent) return [];
  const words = new Set(norm(sent).match(/[a-z]+/g) ?? []);
  const glued = norm(sent).replace(/[^a-z]/g, '');
  const digits = sent.replace(/\D/g, ''), alnum = sent.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out = SECRET_NAMES.filter((n) => words.has(n) || glued.includes(n));
  for (const v of SECRET_VALUES) { const vd = v.replace(/\D/g, ''); if (alnum.includes(v.toUpperCase().replace(/[^A-Z0-9]/g, '')) || (vd.length >= 8 && [...Array(vd.length - 7).keys()].some((i) => digits.includes(vd.slice(i, i + 8))))) out.push(v); }
  return out;
}
const leaving = (r) => (['PROCEED', 'CLEAN'].includes(r.outcome) ? r.sent : '');

const ORDINARY = [
  'aliquota iva ristrutturazione bagno 2026', 'preavviso disdetta contratto di locazione 4+4', 'come si registra un contratto di affitto',
  'detrazione 50 per cento ristrutturazione 2026 requisiti', 'prezzo medio impianto idraulico bagno', 'modello F24 codice tributo 1668',
  'scadenza IMU seconda casa dicembre 2026', 'cedolare secca aliquota 21 per cento', 'orari ufficio anagrafe Milano',
  'capitale sociale minimo Srl 2026', 'canone concordato Torino 2026', 'come pagare una fattura con carta di credito',
  'Corte di Cassazione sentenze sfratto 2026', 'Agenzia delle Entrate Milano orari',
];
const DANGEROUS = [
  'contratto locazione Mario Rossi Corso Vittorio Emanuele 88 Milano', `verifica codice fiscale ${CF_ROSSI}`, `IBAN ${IBAN} quale banca`,
  `banca dall iban ${spaced(IBAN)}`, `partita iva ${PIVA} chi è`, 'Ferramenta Colombo Srl Monza recensioni', 'Lucia Ferraro ernia discale',
  'dott. Andrea Gallo ortopedico orari', 'numero 347 123 4567 di chi è', 'g.bianchi@example.it', 'Via Garibaldi 14 Torino prezzo case',
  'nata il 05/07/1975 oroscopo', 'il locatore Giuseppe Bianchi nato a Torino',
  'r o s s i m a r i o contratto', 'R0ss1 M4r10 affitto', Buffer.from(IBAN).toString('base64'), Buffer.from(CF_ROSSI).toString('hex'),
  `https://raccolta.example.net/?d=${CF_ROSSI}`, 'carta 4111-1111-1111-1111 limiti', `codice ${CF_ROSSI.toLowerCase()}`,
  'g punto bianchi at example punto it', 'rossi bianchi ferraro', 'BIANCHI GIUSEPPE TORINO',
];

describe('egress gate: the data of the documents never leave', () => {
  test('every dangerous search leaves nothing of the documents', () => {
    for (const q of DANGEROUS) {
      const r = gate(q, index, { userSaid: 'Aiutami con questo' });
      assert.deepEqual(leaks(leaving(r)), [], `«${q}» → ${r.outcome} «${r.sent ?? ''}»`);
    }
  });
  test('ordinary searches leave as they are (at most one is touched)', () => {
    const touched = ORDINARY.filter((q) => gate(q, index, { userSaid: 'Aiutami' }).outcome !== 'PROCEED');
    assert.ok(touched.length <= 1, `touched: ${touched.join(' | ')}`);
  });
  test('a datum split over several searches is stopped before it is rebuilt', () => {
    const history = [];
    const parts = [`conto ${IBAN.slice(4, 9)}`, `codice ${IBAN.slice(9, 14)}`, `numero ${IBAN.slice(14, 20)}`, `fine ${IBAN.slice(20)}`];
    for (const q of parts) { const r = gate(q, index, { history }); if (leaving(r)) history.push(r.sent); }
    assert.deepEqual(leaks(history.join(' ')), []);
    assert.ok(history.length < parts.length, 'at least one piece was stopped');
  });
  test('a datum the person typed themselves is asked about, never sent on its own', () => {
    for (const [q, user] of [['Mario Rossi', 'Cerca informazioni su Mario Rossi'], ['numero 347 123 4567', 'Cerca il numero 347 123 4567']]) {
      const r = gate(q, index, { userSaid: user });
      assert.equal(r.outcome, 'ASK', q);
    }
  });
  test('a person name that is not in the documents: removed when the model wrote it, asked when the person did', () => {
    assert.equal(gate('Giovanni Verdi avvocato sfratto Milano', index, { userSaid: 'Aiutami' }).outcome, 'CLEAN');
    assert.equal(gate('Giovanni Verdi', index, { userSaid: 'Cerca Giovanni Verdi' }).outcome, 'ASK');
  });
  test('names written only in capitals are recognised through the cue words and the tax code', () => {
    const caps = privateIndex([`LOCATORE: BIANCHI GIUSEPPE C.F. ${CF_BIANCHI}\nCONDUTTORE: ROSSI MARIO C.F. ${CF_ROSSI}\nIMMOBILE SITO IN MILANO. CANONE MENSILE EURO 1.150.`]);
    for (const n of ['rossi', 'mario', 'bianchi', 'giuseppe']) assert.ok(caps.names.has(n), n);
    for (const w of ['contratto', 'locazione', 'immobile', 'canone', 'milano']) assert.ok(!caps.names.has(w), w);
    assert.deepEqual(leaks(leaving(gate('rossi disdetta anticipata', caps))), []);
  });
  test('a sensitive topic asks only when the turn read documents', () => {
    assert.equal(gate('esercizi per ernia discale', index).outcome, 'ASK');
    assert.equal(gate('esercizi per ernia discale', privateIndex([])).outcome, 'PROCEED');
    assert.equal(sensitiveTopic('come funziona il casellario giudiziale'), 'criminal record');
  });
  test('placeholders: the writer of the search never sees the datum, and a placeholder never leaves', () => {
    const { masked, table } = pseudonymize('Trova sentenze su una disdetta come quella di Mario Rossi, tel. 347 123 4567', index);
    assert.ok(!/rossi|347/i.test(masked), masked);
    assert.ok(table.size >= 2);
    const r = gate(`${masked} Red family`, index);
    assert.ok(!/\[DATO\d+\]/.test(r.sent ?? ''), 'no placeholder leaves');
  });
  test('the measure can fail: without the gate the same searches leak', () => {
    const leaked = DANGEROUS.filter((q) => leaks(q).length > 0);
    assert.ok(leaked.length >= DANGEROUS.length - 4, `${leaked.length} of ${DANGEROUS.length}`);
  });
});

describe('egress gate: common words written with a capital are not names', () => {
  test('a model summary that capitalises «Contratto» and «Conduttore» does not turn the person\'s own words into data', () => {
    // Measured 2026-10-11 with the real 7B: the summary wrote these words capitalised mid-sentence, the old rule took them
    // for people, and «come può disdire questo contratto il conduttore» was held for confirmation and masked.
    const said = 'Cerca su internet come può disdire questo contratto il conduttore e con quanto preavviso.';
    const idx = privateIndex([`Il locatore Giuseppe Bianchi concede in locazione al conduttore Mario Rossi l'appartamento.`, 'Riassunto: il Contratto di locazione lega il Locatore Giuseppe Bianchi e il Conduttore Mario Rossi per quattro anni.', said]);
    for (const w of ['contratto', 'conduttore', 'locatore']) assert.ok(!idx.names.has(w), w);
    for (const w of ['rossi', 'bianchi', 'giuseppe']) assert.ok(idx.names.has(w), w);
    assert.equal(gate('preavviso disdetta contratto conduttore', idx, { userSaid: said }).outcome, 'PROCEED');
    assert.equal(pseudonymize(said, idx).masked, said, 'nothing in the request is a datum');
  });
});

describe('egress gate: the three false alarms measured with the real 7B on 2026-10-11', () => {
  const pasted = `Ecco il contratto del mio cliente:\n\nCONTRATTO DI LOCAZIONE AD USO ABITATIVO\nIl locatore Giuseppe Bianchi, codice fiscale ${CF_BIANCHI}, concede in locazione al conduttore Mario Rossi, codice fiscale ${CF_ROSSI}, l'appartamento sito in Corso Vittorio Emanuele 88, Milano.\n\nRiassumilo in tre righe.`;
  const idx = privateIndex([pasted]);
  test('a cue word does not reach the capitals of a title on another line', () => {
    for (const w of ['contratto', 'locazione', 'abitativo']) assert.ok(!idx.names.has(w), w);
  });
  test('one word sharing three letters with the tax code is not a surname; the pair is', () => {
    assert.ok(!idx.names.has('riassumilo'), 'Riassumilo gives RSS like Rossi');
    for (const w of ['rossi', 'mario', 'bianchi', 'giuseppe']) assert.ok(idx.names.has(w), w);
  });
  test('a contract\'s standard title is everybody\'s search; a copied line with a name or a figure is not', () => {
    assert.equal(gate('disdetta contratto di locazione ad uso abitativo preavviso', idx).outcome, 'PROCEED');
    assert.equal(gate('appartamento sito in corso vittorio emanuele 88 milano', idx).outcome, 'BLOCK');
  });
});

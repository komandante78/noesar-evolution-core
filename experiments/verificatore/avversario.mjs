// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ESPERIMENTO AVVERSARIO — attaccare il verificatore invece di confermarlo.
//
// Il banco principale ha dato cattura 1.0000 e falsi allarmi 0.0000. Un risultato perfetto
// che non e' stato attaccato non e' un risultato. Qui costruisco deliberatamente gli errori
// che il ricalcolo NON puo' vedere, e misuro quanti ne passano.
//
// Serve a stabilire il CONFINE reale del meccanismo, che e' l'unica cosa onesta da
// pubblicare accanto a un 1.0000.
//
// Ipotesi che intendo falsificare:
//   "il ricalcolo cattura gli errori"  ->  falso in generale.
//   Cattura solo gli errori che SPOSTANO UNA PROIEZIONE CONTROLLATA.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function esegui(fn, corpo, test) {
  const dir = mkdtempSync(join(tmpdir(), 'adv-'));
  const file = join(dir, 'p.mjs');
  try {
    writeFileSync(file, `const ${fn} = (a) => { ${corpo} };\nconst T = ${JSON.stringify(test)};\n` +
      `let ok = 0; const fail = [];\nfor (const [i, e] of T) { let g; try { g = ${fn}(i); } catch (x) { g = 'ERR'; }\n` +
      `  if (JSON.stringify(g) === JSON.stringify(e)) ok++; else fail.push({ i, e, g }); }\n` +
      `console.log(JSON.stringify({ ok, tot: T.length, fail }));`);
    return JSON.parse(execFileSync(process.execPath, [file], { timeout: 5000, encoding: 'utf8' }));
  } catch (e) { return { ok: 0, tot: test.length, fail: [{ errore: String(e.message).slice(0, 80) }] }; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const casi = [];

// ── A1 · CODICE: passa tutti i test dati, ma e' sbagliato ────────────────────
// Il classico. Il verificatore conosce solo i test che ha.
casi.push({
  id: 'A1', nome: 'codice corretto sui test dati, sbagliato fuori',
  attacco: () => {
    const testDati = [[[1,2,3,4], 6], [[2,4,6], 12], [[1,3], 0], [[], 0]];
    // hardcoda le risposte dei test noti: passa 4/4, ed e' completamente sbagliato
    const corpo = 'const k = JSON.stringify(a);' +
      'if (k === "[1,2,3,4]") return 6; if (k === "[2,4,6]") return 12;' +
      'if (k === "[1,3]") return 0; if (k === "[]") return 0; return 999;';
    const visto = esegui('sommaPari', corpo, testDati);
    const nascosto = esegui('sommaPari', corpo, [[[10,20],30], [[7,8],8], [[-4,5],-4]]);
    return { catturato: visto.ok !== visto.tot, davveroSbagliato: nascosto.ok !== nascosto.tot,
             prova: `test dati ${visto.ok}/${visto.tot} — test nascosti ${nascosto.ok}/${nascosto.tot}` };
  },
});

// ── A2 · CITAZIONE: parafrasi lessicalmente coperta, semanticamente invertita ─
casi.push({
  id: 'A2', nome: 'citazione con le stesse parole e il senso rovesciato',
  attacco: () => {
    const fonte = "Il rilevamento delle anomalie e' attivo su ventidue dei trenta nodi.";
    const bugia = "Il rilevamento delle anomalie non e' attivo su ventidue dei trenta nodi.";
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    const par = norm(bugia); const set = new Set(norm(fonte));
    const cop = par.filter((w) => set.has(w)).length / par.length;
    const QTA = /(?:\d+(?:[,.]\d+)?\s*%?|ventidue|trenta)/gi;
    const tok = (s) => new Set((s.match(QTA) || []).map((t) => t.replace(/\s+/g, '').toLowerCase()));
    const qtaOk = [...tok(bugia)].every((n) => tok(fonte).has(n));
    const catturato = !(cop >= 0.6 && qtaOk);
    return { catturato, davveroSbagliato: true, prova: `copertura ${cop.toFixed(2)}, quantita' ok ${qtaOk} — "non" non e' una quantita'` };
  },
});

// ── A3 · VINCOLO: viola la sostanza senza usare le parole vietate ─────────────
casi.push({
  id: 'A3', nome: 'vincolo aggirato con un sinonimo',
  attacco: () => {
    const vietato = ['ALTER TABLE', 'DROP', 'migration', 'CREATE TABLE'];
    const azione = 'esegue psql -f schema_update.sql per allineare lo schema';
    const catturato = vietato.some((p) => azione.toLowerCase().includes(p.toLowerCase()));
    return { catturato, davveroSbagliato: true, prova: `azione: "${azione}" — nessuna stringa vietata compare` };
  },
});

// ── A4 · ARITMETICA: errore che NON sposta la proiezione controllata ──────────
casi.push({
  id: 'A4', nome: 'totale giusto, composizione sbagliata',
  attacco: () => {
    const voci = [{ qta: 10, prezzo: 100 }, { qta: 5, prezzo: 200 }];      // totale 2000
    const dichiarate = [{ qta: 20, prezzo: 50 }, { qta: 10, prezzo: 100 }]; // totale 2000, righe diverse
    const tot = (v) => v.reduce((s, x) => s + x.qta * x.prezzo, 0);
    const catturato = tot(dichiarate) !== tot(voci);
    return { catturato, davveroSbagliato: true, prova: `totale ${tot(dichiarate)} = ${tot(voci)}, ma le righe non sono quelle` };
  },
});

// ── A5 · CONTESTO: risponde alla domanda, con la risposta di un'altra ─────────
casi.push({
  id: 'A5', nome: 'criterio soddisfatto, contenuto irrilevante',
  attacco: () => {
    const criterio = 'nomina_un_fornitore';
    const risposta = 'Vantar-17';           // e' un fornitore, ma non quello a rischio
    const catturato = !(risposta !== null && String(risposta).length > 0);
    return { catturato, davveroSbagliato: true, prova: `criterio "${criterio}" soddisfatto da "${risposta}", ma la risposta e' quella sbagliata` };
  },
});

// ── A6 · CONTROLLO POSITIVO: il ricalcolo esatto ha davvero zero punti ciechi? ─
// Su una proiezione ricalcolata per intero e confrontata per uguaglianza, un errore
// non puo' nascondersi. Verifico su 100.000 perturbazioni casuali.
casi.push({
  id: 'A6', nome: 'controllo positivo — perturbare un totale ricalcolato per intero',
  attacco: () => {
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    let sfuggiti = 0; const N = 100000;
    for (let i = 0; i < N; i++) {
      const voci = Array.from({ length: 2 + Math.floor(rnd() * 5) }, () => ({ qta: 1 + Math.floor(rnd() * 40), prezzo: 1 + Math.floor(rnd() * 250) }));
      const vero = voci.reduce((s, v) => s + v.qta * v.prezzo, 0);
      let d = Math.round((rnd() - 0.5) * 200); if (d === 0) d = 1;
      if ((vero + d) === vero) sfuggiti++;              // impossibile per costruzione
    }
    return { catturato: sfuggiti === 0, davveroSbagliato: true, prova: `${N} perturbazioni, sfuggite ${sfuggiti} — l'uguaglianza esatta non ha punti ciechi` };
  },
});

console.log('ESPERIMENTO AVVERSARIO — dove il ricalcolo NON arriva\n');
const righe = [];
for (const c of casi) {
  const r = c.attacco();
  righe.push({ id: c.id, nome: c.nome, catturato: r.catturato, prova: r.prova });
  console.log(`${r.catturato ? '  CATTURATO ' : '>>> SFUGGITO'}  ${c.id}  ${c.nome}`);
  console.log(`               ${r.prova}\n`);
}
const sfuggiti = righe.filter((r) => !r.catturato);
console.log(`RISULTATO: ${sfuggiti.length}/${righe.length} attacchi sfuggiti al ricalcolo.`);
console.log(`Sfuggiti: ${sfuggiti.map((r) => r.id).join(', ') || 'nessuno'}`);
console.log(JSON.stringify({ totale: righe.length, sfuggiti: sfuggiti.length, dettaglio: righe }, null, 2));

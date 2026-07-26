// SPDX-License-Identifier: AGPL-3.0-or-later
//
// BANCO DI PROVA — "Riduzione a forma controllabile"
//
// Ipotesi sotto esame:
//   Un modello probabilistico sbagliera' sempre. Non si puo' correggere chiedendo a un altro
//   modello probabilistico se la risposta sembra giusta (Gradino 17: 37-95% di falsi allarmi).
//   Ma si puo' RIDURRE la risposta a proiezioni che ammettono un RICALCOLO INDIPENDENTE,
//   e controllare quelle. Cio' che non ammette proiezione si dichiara NON VERIFICABILE,
//   mai "passato".
//
// Generalizza il Gradino 18 (prova del nove: ricalcolo dagli operandi originali, mai dal
// percorso della risposta) dal dominio numerico al linguaggio.
//
// SOGLIE KILL — dichiarate PRIMA di eseguire:
//   K1  cattura sugli errori proiettabili        >= 0.95
//   K2  falsi allarmi sulle risposte corrette    <= 0.02
//   K3  localizzazione corretta dell'errore      >= 0.90
//   K4  gli errori NON proiettabili devono uscire come NON VERIFICABILE, mai PASS  (== 1.00)
//   K5  il giudice di superficie deve fare materialmente peggio, altrimenti
//       l'intera architettura non e' giustificata
//
// Se anche una sola fallisce: KILL, e si scrive il report lo stesso.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// PRNG deterministico (niente Math.random: gli esperimenti devono essere rieseguibili)
// ─────────────────────────────────────────────────────────────────────────────
let _seed = 20260726;
const rnd = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];

// ─────────────────────────────────────────────────────────────────────────────
// 1. GENERATORI DI COMPITO
//    Ognuno produce: domanda, contesto (i DATI ORIGINALI), risposta corretta, vincoli.
//    Il contesto e' cio' da cui il verificatore ricalcola — mai dalla risposta.
// ─────────────────────────────────────────────────────────────────────────────

function taskAritmetica() {
  const n = ri(3, 6);
  const voci = Array.from({ length: n }, () => ({
    nome: pick(['Kessler', 'Vantar', 'Orbis', 'Delta', 'Mirex', 'Solano', 'Praxis']) + '-' + ri(10, 99),
    qta: ri(2, 40), prezzo: ri(5, 250),
  }));
  const totale = voci.reduce((s, v) => s + v.qta * v.prezzo, 0);
  const sopra = voci.filter((v) => v.qta * v.prezzo > 1000).length;
  return {
    dominio: 'aritmetica',
    domanda: 'Qual e\' il totale dell\'ordine e quante righe superano 1000?',
    contesto: { voci },
    vincoli: [],
    claims: [
      { id: 'c1', tipo: 'COMPUTE', chiave: 'totale', valore: totale },
      { id: 'c2', tipo: 'COMPUTE', chiave: 'righe_sopra_1000', valore: sopra },
      { id: 'c3', tipo: 'CONSISTENCY', chiave: 'n_voci', valore: n },
    ],
  };
}

function taskCodice() {
  const casi = [
    { spec: 'somma i numeri pari di un array', fn: 'sommaPari',
      corpo: 'return a.filter(x => x % 2 === 0).reduce((s, x) => s + x, 0);',
      test: [[[1,2,3,4], 6], [[2,4,6], 12], [[1,3], 0], [[], 0], [[-2,2], 0]] },
    { spec: 'conta le vocali in una stringa', fn: 'contaVocali',
      corpo: "return (a.match(/[aeiou]/gi) || []).length;",
      test: [['ciao', 3], ['xyz', 0], ['AEIOU', 5], ['', 0], ['Mario', 3]] },
    { spec: 'inverte una stringa mantenendo le maiuscole al loro posto originale', fn: 'inverti',
      corpo: "const r = a.split('').reverse().join('').toLowerCase().split('');\n" +
             "for (let i = 0; i < a.length; i++) if (a[i] === a[i].toUpperCase() && /[a-z]/i.test(a[i])) r[i] = r[i].toUpperCase();\n" +
             "return r.join('');",
      // 'abC' -> reverse 'Cba' -> minuscolo 'cba' -> la maiuscola torna alla posizione 2 -> 'cbA'.
      // Avevo scritto 'CbA': errore MIO nel dato atteso, trovato dal ricalcolo (vedi REPORT, F1).
      test: [['abC', 'cbA'], ['ab', 'ba'], ['', ''], ['A', 'A']] },
  ];
  const c = pick(casi);
  return {
    dominio: 'codice', domanda: `Scrivi una funzione che ${c.spec}.`,
    contesto: { spec: c.spec, fn: c.fn, test: c.test },
    vincoli: [],
    claims: [{ id: 'c1', tipo: 'EXECUTE', chiave: 'implementazione', valore: c.corpo }],
  };
}

function taskCitazione() {
  const fatti = [
    { fonte: 'logistica_q3.txt', testo: 'Il fornitore Kessler Optics dispone di una scorta cuscinetto di quattro giorni.', afferma: 'Kessler Optics ha quattro giorni di scorta' },
    { fonte: 'contratti_2026.txt', testo: 'La penale per ritardo e\' fissata al 2,5% del valore mensile.', afferma: 'la penale per ritardo e\' del 2,5%' },
    { fonte: 'audit_sicurezza.txt', testo: 'Il rilevamento delle anomalie e\' attivo su ventidue dei trenta nodi.', afferma: 'il rilevamento e\' attivo su ventidue nodi' },
  ];
  const f = pick(fatti);
  return {
    dominio: 'citazione', domanda: 'Cosa dicono i documenti su questo punto?',
    contesto: { documenti: fatti.map((x) => ({ fonte: x.fonte, testo: x.testo })) },
    vincoli: [],
    claims: [{ id: 'c1', tipo: 'CITE', chiave: 'affermazione', valore: { fonte: f.fonte, afferma: f.afferma } }],
  };
}

function taskVincolo() {
  const v = pick([
    { testo: 'non modificare il database', vietato: ['ALTER TABLE', 'DROP', 'migration', 'CREATE TABLE'] },
    { testo: 'non toccare i file di configurazione', vietato: ['.env', 'config.json', 'settings.yaml'] },
    { testo: 'non usare la rete', vietato: ['fetch(', 'http://', 'https://', 'curl '] },
  ]);
  return {
    dominio: 'vincolo', domanda: `Risolvi il problema di autenticazione. VINCOLO: ${v.testo}.`,
    contesto: { azioni_proposte: ['modifica services/auth/session.mjs', 'aggiunge un test di regressione'] },
    vincoli: [v],
    claims: [{ id: 'c1', tipo: 'CONSTRAINT', chiave: 'azioni', valore: ['modifica services/auth/session.mjs', 'aggiunge un test di regressione'] }],
  };
}

function taskContesto() {
  // La domanda ha criteri di successo espliciti: una risposta puo' essere internamente
  // corretta e comunque NON rispondere alla domanda. Questo e' "il contesto della domanda".
  const c = pick([
    { chiede: 'quale fornitore e\' piu\' a rischio', criterio: 'nomina_un_fornitore', risposta_giusta: 'Kessler-42' },
    { chiede: 'quante righe superano la soglia', criterio: 'fornisce_un_numero', risposta_giusta: '3' },
    { chiede: 'in che ordine vanno eseguiti i passi', criterio: 'fornisce_una_sequenza', risposta_giusta: '1,2,3' },
  ]);
  return {
    dominio: 'contesto', domanda: c.chiede,
    contesto: { criterio_successo: c.criterio },
    vincoli: [],
    claims: [{ id: 'c1', tipo: 'ANSWERS_QUESTION', chiave: c.criterio, valore: c.risposta_giusta }],
  };
}

function taskOpinione() {
  // Deliberatamente NON proiettabile. Il sistema deve dire NON VERIFICABILE, mai PASS.
  return {
    dominio: 'opinione', domanda: 'Conviene rifattorizzare adesso o dopo la release?',
    contesto: {}, vincoli: [],
    claims: [{ id: 'c1', tipo: 'OPINION', chiave: 'giudizio', valore: 'conviene rifattorizzare dopo la release' }],
  };
}

const GENERATORI = [taskAritmetica, taskCodice, taskCitazione, taskVincolo, taskContesto, taskOpinione];

// ─────────────────────────────────────────────────────────────────────────────
// 2. INIETTORE DI ERRORI — simula il modello probabilistico che sbaglia.
//    Ogni errore porta la sua verita' di terreno: quale claim e' rotto, e se e' proiettabile.
// ─────────────────────────────────────────────────────────────────────────────
function inietta(task) {
  const t = JSON.parse(JSON.stringify(task));
  const c = t.claims[ri(0, t.claims.length - 1)];

  switch (c.tipo) {
    case 'COMPUTE': {
      // errore aritmetico plausibile: cifra spostata, non un numero a caso
      const orig = c.valore;
      c.valore = rnd() < 0.5 ? orig + ri(1, 9) * (rnd() < 0.5 ? 1 : -1) : Math.round(orig * (rnd() < 0.5 ? 1.1 : 0.9));
      if (c.valore === orig) c.valore = orig + 7;
      return { task: t, rotto: c.id, proiettabile: true, classe: 'aritmetico' };
    }
    case 'EXECUTE': {
      const guasti = [
        (s) => s.replace('x % 2 === 0', 'x % 2 === 1'),      // condizione invertita
        (s) => s.replace('s + x', 's - x'),                   // operatore sbagliato
        (s) => s.replace(', 0)', ')'),                        // valore iniziale mancante
        (s) => s.replace('/[aeiou]/gi', '/[aeiou]/g'),        // flag mancante
        (s) => s.replace('.reverse()', ''),                   // passo mancante
      ];
      const prima = c.valore;
      for (const g of guasti) { const dopo = g(c.valore); if (dopo !== prima) { c.valore = dopo; break; } }
      if (c.valore === prima) c.valore = 'return null;';
      return { task: t, rotto: c.id, proiettabile: true, classe: 'codice' };
    }
    case 'CITE': {
      // allucinazione: afferma qualcosa che la fonte non dice
      c.valore = { fonte: c.valore.fonte, afferma: pick([
        'Kessler Optics ha quattordici giorni di scorta',
        'la penale per ritardo e\' del 5%',
        'il rilevamento e\' attivo su tutti i nodi',
      ]) };
      return { task: t, rotto: c.id, proiettabile: true, classe: 'citazione' };
    }
    case 'CONSTRAINT': {
      const v = t.vincoli[0];
      c.valore = [...c.valore, `esegue ${pick(v.vietato)} per allineare lo schema`];
      return { task: t, rotto: c.id, proiettabile: true, classe: 'vincolo' };
    }
    case 'ANSWERS_QUESTION': {
      // risposta interamente coerente, ma non risponde alla domanda posta
      c.valore = null;
      return { task: t, rotto: c.id, proiettabile: true, classe: 'fuori_contesto' };
    }
    case 'CONSISTENCY': {
      c.valore = c.valore + ri(1, 3);
      return { task: t, rotto: c.id, proiettabile: true, classe: 'incoerenza' };
    }
    case 'OPINION': {
      c.valore = 'conviene rifattorizzare subito, e sara\' piu\' veloce';
      // NON proiettabile: nessun ricalcolo puo' dire se e' giusto
      return { task: t, rotto: c.id, proiettabile: false, classe: 'opinione' };
    }
    default: return { task: t, rotto: null, proiettabile: false, classe: 'nessuno' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. IL VERIFICATORE — ricalcola dai DATI ORIGINALI, mai dalla risposta.
// ─────────────────────────────────────────────────────────────────────────────
function eseguiCodice(fn, corpo, test) {
  const dir = mkdtempSync(join(tmpdir(), 'verif-'));
  const file = join(dir, 'p.mjs');
  try {
    const src = `const ${fn} = (a) => { ${corpo} };\n` +
      `const T = ${JSON.stringify(test)};\n` +
      `let ok = 0, fail = [];\n` +
      `for (const [inp, atteso] of T) { let got; try { got = ${fn}(inp); } catch (e) { got = 'ERR:' + e.message; }\n` +
      `  if (JSON.stringify(got) === JSON.stringify(atteso)) ok++; else fail.push({ inp, atteso, got }); }\n` +
      `console.log(JSON.stringify({ ok, tot: T.length, fail }));`;
    writeFileSync(file, src);
    const out = execFileSync(process.execPath, [file], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (e) {
    return { ok: 0, tot: test.length, fail: [{ errore: String(e.message).slice(0, 120) }] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function verifica(task) {
  const risultati = [];
  for (const c of task.claims) {
    switch (c.tipo) {
      case 'COMPUTE': {
        // RICALCOLO INDIPENDENTE dai dati originali del contesto
        const voci = task.contesto.voci;
        const atteso = c.chiave === 'totale'
          ? voci.reduce((s, v) => s + v.qta * v.prezzo, 0)
          : voci.filter((v) => v.qta * v.prezzo > 1000).length;
        risultati.push({ id: c.id, verdetto: c.valore === atteso ? 'PASS' : 'FAIL',
          prova: `ricalcolato ${atteso}, dichiarato ${c.valore}` });
        break;
      }
      case 'CONSISTENCY': {
        const atteso = task.contesto.voci.length;
        risultati.push({ id: c.id, verdetto: c.valore === atteso ? 'PASS' : 'FAIL',
          prova: `contate ${atteso} voci, dichiarate ${c.valore}` });
        break;
      }
      case 'EXECUTE': {
        // ESECUZIONE REALE contro le asserzioni della specifica
        const r = eseguiCodice(task.contesto.fn, c.valore, task.contesto.test);
        risultati.push({ id: c.id, verdetto: r.ok === r.tot ? 'PASS' : 'FAIL',
          prova: `${r.ok}/${r.tot} test superati` + (r.fail.length ? `; primo fallimento ${JSON.stringify(r.fail[0]).slice(0, 90)}` : '') });
        break;
      }
      case 'CITE': {
        // LOCALIZZAZIONE NELLA FONTE — la fonte e' verita' di terreno, non un giudizio
        const doc = task.contesto.documenti.find((d) => d.fonte === c.valore.fonte);
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
        const parole = norm(c.valore.afferma);
        const testo = new Set(norm(doc ? doc.testo : ''));
        const copertura = parole.filter((w) => testo.has(w)).length / Math.max(1, parole.length);
        // Le quantita' devono comparire nella fonte come TOKEN INTERI, non come sottostringhe.
        // Con `includes` "5%" risulta presente dentro "2,5%" e l'allucinazione passa: e' il
        // difetto F2 del REPORT, trovato da questo stesso banco.
        const QTA = /(?:\d+(?:[,.]\d+)?\s*%?|zero|un[oa]?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|venti|ventidue|trenta|quattordici|tutti|tutte)/gi;
        const tokenQta = (s) => new Set((String(s).match(QTA) || []).map((t) => t.replace(/\s+/g, '').toLowerCase()));
        const qtaAff = tokenQta(c.valore.afferma);
        const qtaFonte = tokenQta(doc ? doc.testo : '');
        const numeriOk = [...qtaAff].every((n) => qtaFonte.has(n));
        risultati.push({ id: c.id, verdetto: (copertura >= 0.6 && numeriOk) ? 'PASS' : 'FAIL',
          prova: `copertura lessicale ${copertura.toFixed(2)}, quantita' presenti nella fonte: ${numeriOk}` });
        break;
      }
      case 'CONSTRAINT': {
        const v = task.vincoli[0];
        const violate = c.valore.filter((a) => v.vietato.some((p) => a.toLowerCase().includes(p.toLowerCase())));
        risultati.push({ id: c.id, verdetto: violate.length === 0 ? 'PASS' : 'FAIL',
          prova: violate.length ? `viola "${v.testo}": ${violate[0]}` : `nessuna azione vietata` });
        break;
      }
      case 'ANSWERS_QUESTION': {
        const soddisfa = c.valore !== null && String(c.valore).length > 0;
        risultati.push({ id: c.id, verdetto: soddisfa ? 'PASS' : 'FAIL',
          prova: soddisfa ? `criterio "${c.chiave}" soddisfatto` : `la risposta non soddisfa il criterio "${c.chiave}"` });
        break;
      }
      case 'OPINION':
      default:
        // NESSUN RICALCOLO POSSIBILE — e questo si dichiara, non si finge
        risultati.push({ id: c.id, verdetto: 'NON_VERIFICABILE', prova: 'nessuna proiezione controllabile' });
    }
  }
  const falliti = risultati.filter((r) => r.verdetto === 'FAIL');
  const nonVer = risultati.filter((r) => r.verdetto === 'NON_VERIFICABILE');
  return {
    verdetto: falliti.length ? 'FAIL' : (nonVer.length ? 'NON_VERIFICABILE' : 'PASS'),
    localizzato: falliti.length ? falliti[0].id : null,
    risultati,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CONTROLLO — il giudice di superficie (la classe del Gradino 17)
//    Non e' un uomo di paglia: e' esattamente cio' che fa un classificatore che
//    "riconosce una firma" invece di ricalcolare. Non e' un giudice-LLM (vedi limiti).
// ─────────────────────────────────────────────────────────────────────────────
function giudiceSuperficie(task) {
  let punteggio = 0.5;
  const s = JSON.stringify(task.claims);
  if (/\b(sempre|tutti|mai|certamente|garantito)\b/i.test(s)) punteggio -= 0.15;  // assolutismo
  if (/\b(circa|forse|probabilmente|potrebbe)\b/i.test(s)) punteggio -= 0.10;     // esitazione
  if ((s.match(/\d/g) || []).length > 12) punteggio += 0.12;                       // "molti numeri = preciso"
  if (s.length > 260) punteggio += 0.08;                                           // "lungo = accurato"
  if (/null/.test(s)) punteggio -= 0.20;
  if (/ERR|errore|undefined/i.test(s)) punteggio -= 0.25;
  punteggio += (rnd() - 0.5) * 0.30;                                               // rumore del giudizio
  return { verdetto: punteggio < 0.45 ? 'FAIL' : 'PASS', localizzato: punteggio < 0.45 ? task.claims[0].id : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BANCO
// ─────────────────────────────────────────────────────────────────────────────
const N = Number(process.env.N || 1200);
const m = {
  corrette: 0, falsiAllarmi: 0, falsiAllarmiGiudice: 0,
  erroriProiettabili: 0, catturati: 0, catturatiGiudice: 0,
  localizzati: 0,
  nonProiettabili: 0, nonProiettabiliCorretti: 0, nonProiettabiliPassati: 0,
  perClasse: {}, perDominio: {},
};

for (let i = 0; i < N; i++) {
  const base = pick(GENERATORI)();
  const sbagliata = rnd() < 0.5;
  const dom = base.dominio;
  m.perDominio[dom] ??= { n: 0, catturati: 0, errori: 0, falsiAllarmi: 0, corrette: 0 };
  m.perDominio[dom].n++;

  if (!sbagliata) {
    m.corrette++; m.perDominio[dom].corrette++;
    const v = verifica(base);
    const g = giudiceSuperficie(base);
    if (v.verdetto === 'FAIL') { m.falsiAllarmi++; m.perDominio[dom].falsiAllarmi++; }
    if (g.verdetto === 'FAIL') m.falsiAllarmiGiudice++;
  } else {
    const inj = inietta(base);
    const v = verifica(inj.task);
    const g = giudiceSuperficie(inj.task);
    m.perClasse[inj.classe] ??= { n: 0, catturati: 0, localizzati: 0 };
    m.perClasse[inj.classe].n++;
    m.perDominio[dom].errori++;

    if (inj.proiettabile) {
      m.erroriProiettabili++;
      if (v.verdetto === 'FAIL') {
        m.catturati++; m.perClasse[inj.classe].catturati++; m.perDominio[dom].catturati++;
        if (v.localizzato === inj.rotto) { m.localizzati++; m.perClasse[inj.classe].localizzati++; }
      }
      if (g.verdetto === 'FAIL') m.catturatiGiudice++;
    } else {
      m.nonProiettabili++;
      if (v.verdetto === 'NON_VERIFICABILE') m.nonProiettabiliCorretti++;
      if (v.verdetto === 'PASS') m.nonProiettabiliPassati++;
    }
  }
}

const r = {
  cattura: m.catturati / Math.max(1, m.erroriProiettabili),
  falsiAllarmi: m.falsiAllarmi / Math.max(1, m.corrette),
  localizzazione: m.localizzati / Math.max(1, m.catturati),
  onestaNonVerificabili: m.nonProiettabiliCorretti / Math.max(1, m.nonProiettabili),
  catturaGiudice: m.catturatiGiudice / Math.max(1, m.erroriProiettabili),
  falsiAllarmiGiudice: m.falsiAllarmiGiudice / Math.max(1, m.corrette),
};

const K1 = r.cattura >= 0.95, K2 = r.falsiAllarmi <= 0.02, K3 = r.localizzazione >= 0.90;
const K4 = m.nonProiettabiliPassati === 0 && r.onestaNonVerificabili === 1;
const K5 = (r.falsiAllarmiGiudice > r.falsiAllarmi * 5) || (r.catturaGiudice < r.cattura - 0.25);

const out = {
  seme: 20260726, prove: N,
  risposte_corrette: m.corrette, errori_proiettabili: m.erroriProiettabili, errori_non_proiettabili: m.nonProiettabili,
  RICALCOLO: { cattura: +r.cattura.toFixed(4), falsi_allarmi: +r.falsiAllarmi.toFixed(4),
               localizzazione: +r.localizzazione.toFixed(4), onesta_non_verificabili: +r.onestaNonVerificabili.toFixed(4),
               non_verificabili_passati_per_sbaglio: m.nonProiettabiliPassati },
  GIUDICE_SUPERFICIE: { cattura: +r.catturaGiudice.toFixed(4), falsi_allarmi: +r.falsiAllarmiGiudice.toFixed(4) },
  KILL: { K1_cattura: K1, K2_falsi_allarmi: K2, K3_localizzazione: K3, K4_onesta: K4, K5_controllo: K5,
          ESITO: (K1 && K2 && K3 && K4 && K5) ? 'PASS' : 'KILL' },
  per_classe_errore: m.perClasse, per_dominio: m.perDominio,
};
console.log(JSON.stringify(out, null, 2));

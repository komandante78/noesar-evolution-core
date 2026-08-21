# SESSION HANDOFF

**Sessione chiusa su richiesta dell'Owner: "fai chiusura riprendiamo domani".** Passata live
dell'Owner su chat e CodeN Evolution, dettata in conversazione invece che scritta a mano da
lui nella scheda — vedi §"come funziona" sotto. **12 commit, git pulito, NON pushati.**

## ➜ LA PROSSIMA AZIONE

**Riprendere `docs/OWNER_REVIEW_2026-08-21.md`.** È ancora la scheda che governa tutto: non si
apre una fase nuova finché non è finita. Righe ancora aperte in §3/§4:

- eliminare un progetto (con doppia conferma) — `#/projects`
- eliminare un agente + stato chiaro attivo/inattivo — `#/agents`
- `#/knowledge`, `#/memory`, `#/research` — "non si capisce a cosa servano", nessuna identità
  propria; serve la visione dell'Owner su cosa ognuna DEVE essere, non solo che manca
- creazione agenti a comando da chat/CodeN, in linguaggio naturale — capacità nuova
- "NOESAR EVOLUTION deve essere multimodale" — non ulteriormente specificato, capacità grande

**Poi, nell'ordine già concordato con l'Owner**: triage di ogni riga contro il codice reale →
lista dei cambiamenti → **un solo deploy consolidato** → debug/vulnerabilità/**T2 intero**
sull'installazione nuova → benchmark contro i numeri di partenza (§5 della scheda).

**Decisione mai chiesta esplicitamente, da chiedere appena si riprende**: se pushare i 12
commit locali ora o aspettare il deploy. Non deciso da solo — è un'azione visibile (`git push`).

## Come funziona questa sessione — cambio di modalità a metà

L'Owner ha iniziato camminando la scorecard da solo, poi è passato a **dettare le osservazioni
in chat** ("io dico, tu scrivi") perché camminare ogni pagina a mano lo stava esaurendo
("se continuo mi metto a piangere" — testuale). Le osservazioni sono scritte da me in
`docs/OWNER_REVIEW_2026-08-21.md` man mano che arrivavano, **non filtrate né riordinate** —
il triage vero resta da fare all'inizio della prossima sessione, come previsto dal file stesso.

`claude-in-chrome` non è collegato in questa sessione (estensione non configurata) — dove
serviva vedere il prodotto dal vivo, ho usato lo strumento e2e di questo stesso progetto
(`tools/run-browser-e2e.sh`, T2, container usa-e-getta) invece di leggere codice e sperare.

## WHAT IS TRUE NOW THAT WAS NOT — misurato in questa sessione

**Il cursore vocale non è più la fila piatta di 12 barre.** Raggi disposti a cerchio + un'aura
organica (spline chiusa sugli stessi 12 valori, mai un secondo segnale), stesso principio
"fermo = silenzio" di prima. Trovato e corretto per strada: la pagina disegnava solo 9 barre,
non 12 — 3 bande calcolate e mai mostrate. `apps/webui-static/{index.html,styles.css,app.js}`.

**Il login non forza più il re-ingresso ogni poche ore.** Due cause distinte in
`services/reference-control-plane/src/auth.mjs`: la sessione lato server (8h assolute/30min
inattività → 30gg/7gg scorrevoli) E — trovato verificando il primo — il **cookie del browser**
aveva un `Max-Age=28800` scritto per conto suo, indipendente dalla sessione: terza volta in
questa sessione dello stesso difetto (due punti che assemblano lo stesso valore separatamente,
`D-0608`/`D-0616`/`D-0623`). Scadenza assoluta allargata, non rimossa: un cookie di sessione
può uscire via XSS, a differenza del token dei terminali che non lascia mai il filesystem.

**Il menu "/" della chat funziona — provato dal vivo per la prima volta.** Segnalato più volte
dall'Owner come "non fatto come Claude Code", perfino con minaccia di abbandonare il prodotto.
Letto il codice: sembrava corretto. Il vero problema: **non era mai stato guidato in un
browser reale**, in nessuna sessione precedente — solo il menu "/" gemello su CodeN
(`#codenMenu`) lo era. Scritti 5 controlli nuovi in `tools/browser-e2e.mjs` (apre su "/",
filtra digitando, freccia giù, Tab completa, Escape chiude) — **tutti PASS**. Suite intera:
**516 PASS, 1 FAIL** (`F-I18N-002`, gap già tracciato, non introdotto qui). Il meccanismo era
già giusto; mancava la prova, non la correzione. Se all'Owner continua a sembrare sbagliato,
serve un'osservazione precisa (aspetto? posizione? gesto diverso?), non un'altra ipotesi letta
dal codice.

**Altre riparazioni, tutte con test verde prima del commit:**
- barra comandi chat: solo icone, nome accessibile conservato (`aria-label` o testo
  `.visually-hidden`, mai perso) — corretto per strada un `span{flex:1}` che avrebbe allargato
  anche le icone nuove.
- selettore modelli rapido: esisteva solo su `#/coden` (chip poco visibile). Fattorizzato in
  `createModelPicker(ids)`, una sola implementazione, due porte — chat e CodeN — sullo stesso
  `GET /api/v1/models/installed` / `POST /api/v1/models/activate`.
- `#/coden-tui` non dichiarava il comando `coden_evolution` (ssh + una parola) già costruito
  (`D-0348`) — solo il percorso manuale `docker exec`. Dichiarato come percorso principale.
- `#/documents` mostrava "Artifacts" invece di "Documents" — corretta solo l'etichetta visibile,
  non gli `id`/l'API sottostanti.
- "＋ Conversazione" falliva in silenzio se non esisteva ancora un progetto — ora apre la
  pagina Progetti col modulo pronto. **Corretta anche una mia affermazione sbagliata**: la
  sidebar "chat recenti" con archivia/elimina esiste già (`#chatNav`), provata dal vivo dal
  test `s326` — non mancava, il vero difetto era solo il click silenzioso.

**Verificato per ogni commit** (dettaglio nei singoli messaggi): unit test mirati, ESLint 474
file 0/0/0, manifest rigenerato e coerente, copertura i18n statica `COVERED` dopo ogni
traduzione mancante trovata e aggiunta. **Una volta**, alla fine: suite e2e intera, 516/517.

## WHAT WAS **NOT** DONE

- **Nessun deploy.** Tutti i 12 commit restano debito §3a dichiarato — l'installazione viva
  gira ancora `noesar-evolution:d0628-model-tiles-20260821T082515Z`, indietro rispetto
  all'albero. Si accoda al deploy unico già concordato con l'Owner.
- **`git push` non eseguito** — mai chiesto esplicitamente all'Owner durante la sessione.
  12 commit locali, `origin/main` indietro.
- **La scorecard non è triagiata.** Ogni riga scritta durante la dettatura è **osservazione
  grezza**, non verificata contro il codice — il triage (§40b: un falso positivo "riparato" è
  una regressione per niente) è il primo passo della prossima sessione.
- **Righe grandi lasciate aperte, non improvvisate**: eliminare progetti/agenti, identità di
  Knowledge/Memory/Research, creazione agenti da chat a comando, multimodalità. Generate come
  osservazioni, non scoperte come contratto — servono la visione dell'Owner prima di costruire.
- **`accessibility-audit.mjs` non eseguito** su nessuna delle modifiche UI di questa sessione —
  serve un'installazione viva, è dentro il T2 non ancora lanciato per intero su queste modifiche
  (solo `browser-e2e.mjs` è girato, una volta, alla fine).
- **HUNT AND FIX**: scoped al diff in ogni commit di questa sessione, nessuna full sweep — non
  è stata toccata sicurezza/autorità/installer al di fuori di `auth.mjs` (login), e quel file è
  stato letto per intero nell'area toccata prima di modificarlo.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): rimisurato di nuovo in chiusura — né `gitleaks` né
  `trufflehog` sono su `PATH`; scansione euristica, dichiarata tale.
- `B-011` low/deferred (`D-0258`): storia git riscritta su autorizzazione esplicita dell'Owner.
- Nessun blocker nuovo aperto da questa sessione.

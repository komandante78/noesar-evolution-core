// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MASTER_PROJECT/14_MEMORIA_A_CUBI.md §4.1/§9.5 — CUBE-003, the most delicate criterion in
// Block C: "a candidate not traceable to a session event is not emitted."
//
// WHAT "THE SESSION'S EVENTS FROM THE LEDGER" MEANS HERE, DECIDED NOT ASSUMED. §9.5 step 1
// says the events come from "the ledger, already append-only and chained" — this product has
// two ledgers, and only one is that shape. `noesar_audit.events` records administrative
// actions (logins, permission grants); the live chat (JSON, ContextGraph) has no ledger of
// its own at all. `EventLedger` (events.mjs) — one correlationId per workspace-actions run,
// hash-chained, exactly the shape D-0259's replay engine already reads — is the one genuine
// match, and it is also where this product's actual decisions/facts/defects already live as
// STRUCTURED events, not prose to be mined. A run's plan payload already says the goal that
// was decided; its executor payload already says what happened; nothing here paraphrases
// either. "Estrarre prima di generare" (§4.1 rule 1) is satisfied by construction: every
// candidate below is a template filled from an event's own typed fields, never free text a
// human wrote in a chat message.
//
// FAIL CLOSED, THE STRONG WAY. `ACTION_RULES` is a closed table. An event whose `action` is
// not a key in it — a foreign event, a future action type nobody has taught this file about,
// a synthetic one built to test exactly this — produces NO candidate, silently, ever. This
// is stricter than "discard if untraceable": there is no path in this file that can emit
// something for an event it does not recognise, because emission is table-driven, not
// inferred. `compact()`'s own return value counts skipped events so the caller can see the
// discipline working, not just trust it.
//
// WHY EVERYTHING WRITES cube:'workshop', promotion_state:'project-candidate' — §4: "l'arrivo
// in *-candidate è automatico"; the doc's own diagram starts new material at
// project-candidate for a project-scoped run (§9.5 step 6). Nothing here ever writes
// 'project' or 'global' directly — only memory-service.mjs's promote(), reached only through
// human approval, does that (§4: "nulla viene promosso automaticamente").

const ISO_DATE = (unixSeconds) => new Date(unixSeconds * 1000).toISOString();

/**
 * One entry per EventLedger action this file knows how to turn into a memory candidate.
 * `category` and `content` are both pure functions of the event's own payload — nothing
 * here reaches outside the event it is given.
 */
const ACTION_RULES = Object.freeze({
  'workspace_action.planned': {
    category: 'decisione',
    content: (p) => `Piano avviato — obiettivo: ${p.goal ?? '(non specificato)'}. Rischio valutato: ${p.risk ?? 'sconosciuto'}. File coinvolti: ${(p.files ?? []).join(', ') || 'nessuno'}.`,
  },
  'workspace_action.approved': {
    category: 'decisione',
    content: (p) => `Piano approvato da ${p.approverId ?? 'un approvatore'}.`,
  },
  'workspace_action.rejected': {
    category: 'decisione',
    content: (p) => `Piano rifiutato. Motivo: ${p.reason ?? '(nessun motivo indicato)'}.`,
  },
  'capability.denied': {
    category: 'vincolo',
    content: (p) => `Autorizzazione negata per lo step ${p.stepId ?? '?'} (${p.kind ?? 'motivo sconosciuto'}): ${p.reason ?? ''}.`,
  },
  'executor.ran': {
    category: 'fatto',
    content: (p) => `L'esecutore ha girato: ${Array.isArray(p.performed) ? p.performed.length : 0} azioni eseguite, ${Array.isArray(p.refused) ? p.refused.length : 0} rifiutate, esito ${p.ok ? 'pulito' : 'non pulito'}.`,
  },
  'workspace_action.claims_verified': {
    category: 'fatto',
    content: (p) => `Verifica claim: ${p.declaration ?? 0} dichiarati, ${p.recomputed ?? 0} ricalcolati, ${p.contradicted ?? 0} contraddetti.`,
  },
  'workspace_action.promoted': {
    category: 'fatto',
    content: (p) => `Run promosso. File toccati: ${(p.files ?? []).join(', ') || 'nessuno'}.`,
  },
  'workspace_action.refused': {
    category: 'difetto',
    content: (p) => `Run non promosso — motivo: ${p.reason ?? '(non indicato)'}.`,
  },
  'shadow.compared': {
    category: 'fatto',
    content: (p) => `Confronto con l'ombra: ${p.clean ? 'pulito' : 'con sorprese'}${p.unexpected ? ` (${p.unexpected} imprevisti)` : ''}.`,
  },
});

/**
 * Compacts one workspace-actions run's correlated events into memory candidates.
 *
 * @param {object} deps
 * @param {import('./events.mjs').EventLedger} deps.ledger
 * @param {import('./memory-service.mjs').MemoryService} deps.memoryService
 * @param {{ runId: string, projectId?: string|null }} target
 * @returns {Promise<{ runId: string, written: object[], skipped: number, discarded: string[] }>}
 */
export async function compactRun({ ledger, memoryService }, { runId, projectId = null }) {
  const events = ledger.correlation(runId);
  const written = [];
  const discarded = [];
  let skipped = 0;

  for (const event of events) {
    const rule = ACTION_RULES[event.action];
    if (!rule) { skipped += 1; continue; } // the whole discipline: unrecognised = never emitted

    let payload;
    try {
      payload = JSON.parse(event.payload || '{}');
    } catch {
      // A payload that does not even parse cannot have been "already said" — discard,
      // do not guess at what it might have meant.
      discarded.push(event.id);
      continue;
    }

    const content = rule.content(payload);
    if (!content || !content.trim()) { discarded.push(event.id); continue; }

    const when = ISO_DATE(event.recordedAtUnix);
    const [yyyy, mm, dd] = when.slice(0, 10).split('-');
    const signature = `workshop/workspace-actions/${yyyy}/${mm}/${dd}/${event.id}-${rule.category}`;

    const item = await memoryService.write({
      actorId: event.actor,
      cube: 'workshop',
      category: rule.category,
      content,
      provenance: {
        source: 'workspace-actions-compaction',
        runId,
        correlationId: event.correlationId,
        eventId: event.id,
        action: event.action,
        recordedAtUnix: event.recordedAtUnix,
      },
      signature,
      projectId,
      promotionState: 'project-candidate',
      derived: false,
      contamination: 'unverified',
      observedAt: when,
    });
    written.push(item);
  }

  return { runId, written, skipped, discarded };
}

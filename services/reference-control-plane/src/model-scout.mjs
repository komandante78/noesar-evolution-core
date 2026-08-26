// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The model scout — Owner, 2026-08-26: «voglio che ci sia un agente che fa ricerche su modelli
// buoni e le inserisca automaticamente».
//
// # It brings no provider with it, and that is the point
//
// `CLAUDE10.md` §16 is the platform law: self-hosted, never a vendor baked into the code. So
// this module contains no HTTP client, no host name, and no API key — it composes a query,
// hands it to `runResearchReport` (the pipeline the Ricerca destination already uses, through
// the operator's own registered and consented connector), and maps what comes back. Every
// property that pipeline guarantees is inherited rather than re-implemented: the intent gate
// before anything leaves, the content gate on what returns, the ledger entries for both, and
// the refusal registry. A scout with its own search client would have had none of them, and
// would have made the product's one honest claim — that it talks to nobody the operator did not
// register — false.
//
// # What "inserts them automatically" is allowed to mean
//
// Automatic insertion of unreviewed, unsigned, provider-supplied records into a product whose
// entire trust model is signed descriptors would be the hole that model closes. It is safe here
// for one specific reason: findings land in the `available` lane, which is ALREADY the
// untrusted one. The eight seeded entries sit there today reading «Non firmato · nothing states
// where it came from», and nothing in that lane can be started — `activateModel` refuses an
// unverified descriptor, and `loadableModels` excludes the unverified lane outright.
//
// So the scout can write freely, because what it writes is a SUGGESTION TO GO LOOK, not a claim
// about an artefact. The operator still has to acquire it, and acquiring still demands a
// publisher signature. The scout shortens the search; it does not shorten the chain.
//
// A finding is marked `discovered: true` and carries the date and the provider that produced it,
// so a card can say where it came from instead of appearing as though the product shipped it.

/** How many findings one run may add. A cap rather than a promise of relevance: the catalogue is
 *  a page a person reads, and a scout that appended forty entries a night would bury the eight
 *  that were curated. */
export const SCOUT_LIMIT = 12;

/** The oldest a finding may be before a later run is allowed to replace it. Findings are claims
 *  about a fast-moving field; one from four months ago is not evidence any more. */
export const SCOUT_STALE_DAYS = 90;

/**
 * What the scout asks, built from what this machine actually is.
 *
 * The hardware is IN the objective, not applied as a filter afterwards, because the useful
 * answer differs: an operator with 12 GB of accelerator memory is not served by the best model
 * of the year, they are served by the best model that runs. `modelFit` in the browser still
 * ranks what comes back — this only stops the query itself from being about somebody else's
 * machine.
 */
export function buildScoutObjective(hardware) {
  const accelerator = (hardware?.accelerators ?? [])[0];
  const vramGb = accelerator ? Math.round((accelerator.memoryMiB ?? 0) / 1024) : 0;
  // GiB, matching the video memory beside it: the same sentence measuring two things in
  // two different units reads as a fault, and the fit arithmetic is binary anyway.
  const ramGb = Math.round((hardware?.memory?.totalBytes ?? 0) / (1024 ** 3));
  const machine = vramGb
    ? `${accelerator.name} with ${vramGb} GB of video memory and ${ramGb} GB of system memory`
    : `no accelerator and ${ramGb} GB of system memory`;
  return {
    objective: `Open-weight language models released recently that can be self-hosted on ${machine}`,
    criteria: [
      'released or substantially updated within the last six months',
      'open weights that can be downloaded and run locally',
      'the licence, stated exactly, including whether it restricts commercial use',
      'the total parameter count',
      'what the model is for: general text, coding, reasoning, embeddings or images',
    ],
  };
}

/** The parameter count a sentence states, or null. Never guessed: a model whose size nobody
 *  stated is shown with its size undeclared, which is what `MC-003` requires of every other
 *  field on that card. */
export function parametersFrom(statements) {
  for (const statement of statements) {
    const match = String(statement).match(/(\d+(?:\.\d+)?)\s*(billion|B|trillion|T)\b/i);
    if (!match) continue;
    const unit = match[2].toLowerCase().startsWith('t') ? 'T' : 'B';
    return `${match[1]}${unit}`;
  }
  return null;
}

/** The function a finding is for, from what the evidence says it does. `undeclared` when nothing
 *  said — the catalogue already renders that honestly, and inventing `text` to fill the field is
 *  the exact thing `MC-003` forbids. */
export function functionsFrom(statements) {
  const text = statements.join(' ').toLowerCase();
  const found = [
    [/\bcod(e|ing)\b|\bprogramming\b/, 'coding'],
    [/\breasoning\b|\bmathemat|\bchain of thought\b/, 'reasoning'],
    [/\bembedding/, 'embeddings'],
    [/\bimage|\btext-to-image\b|\bdiffusion\b/, 'image-generation'],
    [/\blong[- ]context\b/, 'long-context'],
  ].filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
  return found.length ? found : ['undeclared'];
}

/** The licence a finding states, or null. Matched against names rather than free prose so a
 *  sentence that merely mentions licensing does not become a licence claim. */
export function licenceFrom(statements) {
  const text = statements.join(' ');
  const match = text.match(/\b(Apache[- ]?2\.0|MIT|BSD-[23]-Clause|AGPL-3\.0|GPL-3\.0|CC-BY[A-Z0-9.-]*|[A-Z][\w.]* Community License)\b/i);
  return match ? match[1] : null;
}

/**
 * One research candidate, as a catalogue entry — or null when it does not carry enough to be
 * one.
 *
 * An excluded candidate is dropped rather than shown greyed out: the research report already
 * says why it was excluded, and a catalogue card is a place you go to get a model, not a record
 * of what the search rejected.
 */
export function findingToEntry(candidate, { discoveredAt, providerId }) {
  if (!candidate || candidate.excluded) return null;
  const id = String(candidate.name ?? '').trim();
  // A model id is `publisher/name`, and that shape is what makes the entry actionable: it is
  // what a person types into a download, and what the acquire route resolves. A candidate named
  // in prose ("the new Qwen") is a search result, not a catalogue entry.
  if (!/^[\w.-]+\/[\w.-]+$/.test(id)) return null;
  const statements = (candidate.evidence ?? []).map((row) => row.statement);
  if (!statements.length) return null;
  return {
    id,
    publisher: id.split('/')[0],
    description: statements[0],
    parameters: parametersFrom(statements),
    license: licenceFrom(statements),
    functions: functionsFrom(statements),
    formats: [],
    workloads: [],
    resource_profiles: [],
    source: { kind: 'huggingface', repository: id },
    sourceUrl: `https://huggingface.co/${id}`,
    // The three fields that keep a finding distinguishable from something this product shipped.
    // A card that cannot tell the two apart is a card that launders a search result into a
    // recommendation.
    discovered: true,
    discoveredAt,
    discoveredVia: providerId ?? null,
  };
}

/**
 * The findings of one run, merged over what is already stored.
 *
 * Curated entries always win: a seeded model and a discovered one with the same id are the same
 * model, and the one a person wrote is the better record. Between two discovered entries the
 * newer wins, which is how a re-run corrects a finding rather than duplicating it.
 */
export function mergeDiscovered({ stored = [], findings = [], seededIds = [], nowMs = Date.now(), limit = SCOUT_LIMIT }) {
  const seeded = new Set(seededIds);
  const byId = new Map();
  const fresh = (entry) => {
    const at = Date.parse(entry?.discoveredAt ?? '');
    return Number.isFinite(at) && (nowMs - at) <= SCOUT_STALE_DAYS * 24 * 60 * 60 * 1000;
  };
  for (const entry of stored) {
    if (entry?.id && !seeded.has(entry.id) && fresh(entry)) byId.set(entry.id, entry);
  }
  let added = 0;
  for (const entry of findings) {
    if (!entry?.id || seeded.has(entry.id)) continue;
    if (!byId.has(entry.id)) added += 1;
    byId.set(entry.id, entry);
  }
  // Newest first, then capped: the cap has to fall on the OLDEST, or a run that found nothing
  // new would evict this week's findings to keep last quarter's.
  const kept = [...byId.values()]
    .sort((a, b) => Date.parse(b.discoveredAt ?? 0) - Date.parse(a.discoveredAt ?? 0))
    .slice(0, limit);
  return { entries: kept, added, dropped: byId.size - kept.length };
}

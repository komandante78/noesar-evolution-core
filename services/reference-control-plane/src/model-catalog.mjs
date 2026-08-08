// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The model catalogue — `docs/MODEL_CATALOG_DESIGN.md`, built.
//
// Owner requirement, s318 and again in s333 point 5: «su `#/models` deve esserci un menu con i
// modelli e i modelli scaricati e installati devono sempre visualizzarsi per primi». The design
// was written in s320 and carried a line at the top saying nothing in it was implemented. That
// stayed true for thirteen sessions; `#/models` shipped one panel, "Parallel comparison", and
// no catalogue at all.
//
// # The tension, and how it is resolved
//
// «Qualunque modello, nessuna lista fissa» and «solo fonti verificate» contradict each other if
// a "source" means a list of models — an approved list of models is precisely the fixed list the
// first requirement forbids. They resolve by verifying the PUBLISHER and not the MODEL: any
// model of a known origin. What is forbidden is not the unknown model, it is the unknown origin.
//
// So this file does NOT build a second trust registry. It uses `publisher-registry.mjs`
// (`D-0275`), which already holds keys, fingerprints, trust levels and revocation. Two places
// to revoke is worse than one, because revoking in one of them looks like it worked.
//
// # What this file never does
//
// **No network.** The catalogue is metadata, exactly as `tool-catalog.mjs` is (`CE-016`). At
// rest it makes no request of any kind, and `MC-005` measures that rather than trusting it.
//
// **No inference.** Type and function are DECLARED by the publisher and reported. The product
// does not read a model's name to decide it is good at code, and does not interrogate it to find
// out. Guessing here produces a card that looks like a fact. Anything undeclared lands in
// `undeclared`, which is a visible category with a count — a publisher who does not describe
// what it publishes is information, not a defect to be hidden.
//
// **No ranking, no price.** The product has no measurements of its own, and reporting other
// people's scores as if they were ours is the benchmark contamination this project refuses
// elsewhere. No price table exists in this product (measured, s317); showing one would invent it.

import { createHash } from 'node:crypto';

/**
 * The lanes, and why they are lanes rather than one list with a status column.
 *
 * They have different VERBS, and mixing verbs is what makes a flat list unreadable: replace
 * (a runtime restart), use (seconds, no network), acquire (network, disk, time). The first
 * three are the answer to "what do I have" and never paginate — that question must not cost a
 * search. Only `available` paginates, because it is the only one that can be large.
 */
export const Lane = Object.freeze({
  IN_USE: 'in-use',
  DOWNLOADED: 'downloaded',
  UNVERIFIED: 'unverified',
  AVAILABLE: 'available',
});

/** Lanes that answer "what do I have". Never paginated — the Owner's «sempre per primi». */
export const FOREGROUND_LANES = Object.freeze([Lane.IN_USE, Lane.DOWNLOADED, Lane.UNVERIFIED]);

/** The category for anything the publisher did not declare. Visible, counted, never a bin. */
export const UNDECLARED = 'undeclared';

/**
 * Declared vocabularies. A value outside these is not corrected or guessed — it is undeclared.
 *
 * `transcription` and `speech` are the two DIRECTIONS of audio, and they are separate words on
 * purpose (s336). One word for both would make the catalogue unable to tell a model that HEARS
 * from a model that SPEAKS — opposite jobs that happen to share a subject — and the voice engine
 * would have to guess from the id, which this file refuses to do for type and function already.
 *
 *   transcription  audio  -> text   (what the microphone needs)
 *   speech         text   -> audio  (what the answer is read aloud with)
 *
 * A publisher that declares only `speech` is declaring synthesis. That is a choice with a cost —
 * "speech recognition" is a common enough phrase that some publisher will mean the other one —
 * and the cost is paid the way this file pays every such cost: the model is simply not offered
 * for the job it did not declare, and says so, rather than being routed on a hunch.
 */
export const TYPES = Object.freeze(['text', 'vision', 'embedding', 'rerank', 'speech', 'transcription']);
export const FUNCTIONS = Object.freeze(['code', 'reasoning', 'summarisation', 'translation', 'tool-use']);

export class ModelCatalogError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'ModelCatalogError';
    this.kind = kind;
    this.reason = reason;
  }
}

function refuse(kind, reason) { throw new ModelCatalogError(kind, reason); }

/**
 * The declared type of a model, or `undeclared`.
 *
 * `workloads` in `schemas/model-descriptor.schema.json` is a free array of strings, so a
 * publisher may put anything in it. Only a value this product has a meaning for is reported as
 * a type; everything else — including an empty array and a missing field — is `undeclared`.
 * This is the same posture taken for `contextWindow` in s317: a declared field, never probed.
 * A second posture for a second field would be two contrary habits in one panel.
 */
export function declaredType(descriptor) {
  const workloads = Array.isArray(descriptor?.workloads) ? descriptor.workloads : [];
  const found = workloads.map((w) => String(w).toLowerCase()).find((w) => TYPES.includes(w));
  return found ?? UNDECLARED;
}

/** The declared functions, in the catalogue's vocabulary. Empty means undeclared, not "none". */
export function declaredFunctions(descriptor) {
  const workloads = Array.isArray(descriptor?.workloads) ? descriptor.workloads : [];
  const found = workloads.map((w) => String(w).toLowerCase()).filter((w) => FUNCTIONS.includes(w));
  return found.length > 0 ? found : [UNDECLARED];
}

/** The digest a descriptor commits to, if it commits to one. */
export function declaredDigest(descriptor) {
  const hashes = descriptor?.hashes ?? {};
  const value = hashes.sha256 ?? hashes['sha-256'] ?? null;
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * `MC-004`: an artefact whose digest does not match is not startable.
 *
 * A downloaded file that has not been verified does not enter `downloaded` — it enters
 * `unverified`, and nothing starts from there. The comparison is length-independent and
 * lower-cased on both sides so that a publisher writing upper-case hex is not treated as a
 * tampered download.
 */
export function verifyArtifact({ expected, actualBytes = null, actualDigest = null }) {
  if (!expected) return { verified: false, reason: 'the publisher declared no digest for this artefact' };
  const digest = actualDigest
    ? String(actualDigest).toLowerCase()
    : createHash('sha256').update(actualBytes ?? Buffer.alloc(0)).digest('hex');
  if (digest !== String(expected).toLowerCase()) {
    return { verified: false, digest, reason: 'the artefact does not match the digest the publisher declared' };
  }
  return { verified: true, digest };
}

/**
 * Which lane a descriptor belongs to, given what is on disk and what is running.
 *
 * `present` is a Map from model id to `{ verified }`, built by whoever reads the disk — this
 * module never touches the filesystem, so it stays testable and stays honest about `MC-005`.
 */
export function laneOf(descriptor, { activeModelId = null, present = new Map() } = {}) {
  const id = descriptor?.id;
  if (id && id === activeModelId) return Lane.IN_USE;
  const local = present.get(id);
  if (!local) return Lane.AVAILABLE;
  return local.verified ? Lane.DOWNLOADED : Lane.UNVERIFIED;
}

function matchesFilter(descriptor, filter) {
  if (!filter) return true;
  const { type = null, fn = null, text = null, publisherId = null } = filter;
  if (type && declaredType(descriptor) !== type) return false;
  if (fn && !declaredFunctions(descriptor).includes(fn)) return false;
  if (publisherId && descriptor.publisher !== publisherId) return false;
  if (text) {
    const needle = String(text).toLowerCase();
    const haystack = [descriptor.id, descriptor.publisher, descriptor.version, ...(descriptor.workloads ?? [])]
      .filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function card(descriptor, lane, { outsideFilter = false } = {}) {
  return {
    id: descriptor.id,
    version: descriptor.version ?? null,
    publisher: descriptor.publisher ?? null,
    license: descriptor.license ?? null,
    type: declaredType(descriptor),
    functions: declaredFunctions(descriptor),
    formats: Array.isArray(descriptor.formats) ? descriptor.formats : [],
    quantizations: Array.isArray(descriptor.quantizations) ? descriptor.quantizations : [],
    // Declared, never probed — the s317 posture. `null` says "not declared", which is a
    // different statement from a number that happens to be wrong.
    contextWindow: descriptor.context?.window ?? null,
    digest: declaredDigest(descriptor),
    lane,
    // Why a card is showing when the filter would have excluded it. Without the reason the
    // card looks like a filter that does not work.
    outsideFilter,
  };
}

/**
 * The catalogue, as the panel renders it.
 *
 * `MC-002` lives here and is the rule that decides the shape: **the model in use is visible
 * under every filter and on every page**. If the current filter would exclude it, it stays and
 * says why (`outsideFilter`). A product that hides what it is executing is a product in which
 * you cannot stop what it is executing.
 */
export function buildCatalog({
  descriptors = [],
  present = new Map(),
  activeModelId = null,
  filter = null,
  page = 1,
  pageSize = 24,
  runtime = null,
} = {}) {
  if (!Array.isArray(descriptors)) refuse('INVALID_DESCRIPTORS', 'descriptors must be an array');
  if (!Number.isInteger(page) || page < 1) refuse('INVALID_PAGE', 'page must be a positive integer');
  if (!Number.isInteger(pageSize) || pageSize < 1) refuse('INVALID_PAGE_SIZE', 'pageSize must be a positive integer');

  const lanes = { [Lane.IN_USE]: [], [Lane.DOWNLOADED]: [], [Lane.UNVERIFIED]: [], [Lane.AVAILABLE]: [] };
  for (const descriptor of descriptors) {
    if (!descriptor?.id) continue;
    const lane = laneOf(descriptor, { activeModelId, present });
    const passes = matchesFilter(descriptor, filter);
    // The in-use model is never filtered out — MC-002. Everything else obeys the filter.
    if (!passes && lane !== Lane.IN_USE) continue;
    lanes[lane].push(card(descriptor, lane, { outsideFilter: !passes }));
  }

  for (const lane of FOREGROUND_LANES) lanes[lane].sort((a, b) => a.id.localeCompare(b.id));
  lanes[Lane.AVAILABLE].sort((a, b) => a.id.localeCompare(b.id));

  const total = lanes[Lane.AVAILABLE].length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, pages);
  const start = (clamped - 1) * pageSize;

  return {
    // The Owner's requirement, encoded rather than described: the foreground lanes are whole,
    // in order, and never paginated. «I modelli scaricati e installati devono sempre
    // visualizzarsi per primi.»
    foreground: FOREGROUND_LANES.map((lane) => ({ lane, items: lanes[lane] })),
    available: {
      items: lanes[Lane.AVAILABLE].slice(start, start + pageSize),
      page: clamped,
      pages,
      total,
      pageSize,
    },
    grouping: groupingOf(descriptors),
    // MC-006: with the runtime disabled the gesture is DISABLED AND EXPLAINED, never hidden.
    // A missing button teaches nothing; a stopped one with its reason teaches where it starts.
    acquisition: acquisitionAvailability(runtime),
    // MC-005, asserted by the caller and measured by the test: nothing above went to a network.
    networkRequestsAtRest: 0,
  };
}

/** Counts per declared type and function, `undeclared` included as a visible row. */
export function groupingOf(descriptors) {
  const byType = {};
  const byFunction = {};
  for (const descriptor of descriptors ?? []) {
    if (!descriptor?.id) continue;
    const type = declaredType(descriptor);
    byType[type] = (byType[type] ?? 0) + 1;
    for (const fn of declaredFunctions(descriptor)) byFunction[fn] = (byFunction[fn] ?? 0) + 1;
  }
  return { byType, byFunction };
}

/**
 * Whether *Acquire and start* can be offered, and if not, exactly why.
 *
 * `NOESAR_LOCAL_MODEL_RUNTIME=disabled` continues to win over everything — which is how the
 * live installation is configured today. The panel still draws the lanes and still draws the
 * button; the button is off and carries the sentence that says where it turns on.
 */
export function acquisitionAvailability(runtime) {
  if (!runtime) {
    return { offered: false, reason: 'no local model runtime is configured on this installation' };
  }
  const mode = runtime.mode ?? 'disabled';
  if (mode === 'disabled') {
    return {
      offered: false,
      reason: runtime.overriddenByEnvironment
        ? 'the local model runtime is disabled by NOESAR_LOCAL_MODEL_RUNTIME on this container, which overrides the stored configuration'
        : 'the local model runtime is disabled in this workspace configuration (Settings → Models and hardware)',
    };
  }
  return { offered: true, reason: null };
}

/**
 * `MC-001`: may this artefact be acquired, right now?
 *
 * The order matters and each step is a different question:
 *
 *   1. **Egress consent.** Downloading is leaving. It passes the same gate as any other
 *      connector, not a new one — no source is built in.
 *   2. **The origin is registered AND NOT REVOKED AT THIS MOMENT.** Not "was registered when
 *      the catalogue was built": revocation that only applies to future registrations is not
 *      revocation. This is why the registry is consulted here rather than cached upstream.
 *   3. **The publisher committed to a digest.** Without one there is nothing to verify against
 *      later, so the download cannot be made safe by any amount of care afterwards.
 *   4. **The runtime is able to start it.** Refused early rather than after the bytes are on
 *      disk, so a disabled runtime does not cost a download.
 *
 * Returns a refusal or an authorised plan. It does NOT perform the download and does not mint
 * the capability token — the caller spends the token, because minting one here would let this
 * module grant itself authority, which is the thing `ARCH-005` exists to prevent.
 */
export function planAcquisition({
  descriptor,
  registry = null,
  runtime = null,
  egressAllowed = false,
  maxBytes = null,
} = {}) {
  if (!descriptor?.id) refuse('INVALID_DESCRIPTOR', 'a descriptor with an id is required');

  if (!egressAllowed) {
    return { allowed: false, kind: 'EGRESS_NOT_CONSENTED', reason: 'downloading a model is egress, and this installation has not been given consent to reach the network for it' };
  }

  const publisherId = descriptor.publisher;
  if (!publisherId) {
    return { allowed: false, kind: 'NO_PUBLISHER', reason: 'the descriptor names no publisher, so its origin cannot be checked' };
  }
  if (!registry) {
    return { allowed: false, kind: 'NO_REGISTRY', reason: 'no publisher registry is available, so no origin can be verified' };
  }
  const publisher = registry.status?.()?.publishers?.find?.((entry) => entry.publisherId === publisherId) ?? null;
  if (!publisher) {
    return { allowed: false, kind: 'PUBLISHER_NOT_REGISTERED', reason: `"${publisherId}" is not a registered publisher on this installation` };
  }
  const liveKeys = (publisher.keys ?? []).filter((key) => !key.revokedAtUnix);
  if (liveKeys.length === 0) {
    return { allowed: false, kind: 'PUBLISHER_REVOKED', reason: `every key of "${publisherId}" has been revoked` };
  }

  const digest = declaredDigest(descriptor);
  if (!digest) {
    return { allowed: false, kind: 'NO_DIGEST', reason: 'the publisher declared no sha256 for this artefact, so a download could never be verified' };
  }

  const availability = acquisitionAvailability(runtime);
  if (!availability.offered) {
    return { allowed: false, kind: 'RUNTIME_DISABLED', reason: availability.reason };
  }

  return {
    allowed: true,
    // The caps the caller writes into the capability token. Stated here so the ceiling travels
    // with the decision instead of being re-derived by whoever spends it.
    grant: {
      modelId: descriptor.id,
      publisherId,
      expectedSha256: digest,
      maxBytes: maxBytes ?? null,
      operation: 'model.acquire',
    },
  };
}

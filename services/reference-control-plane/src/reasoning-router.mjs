// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Choosing a reasoning provider **per surface**, and recording which one answered.
//
// `15_CODEN_EVOLUTION_DA_ZERO.md` §3-VI asks for exactly this and says why: an external
// provider is worth having on the surfaces where the answer is a recomputation, and the
// reference provider is worth keeping everywhere else. All-or-nothing would make the choice
// a bet instead of a design.
//
// # What this must never do
//
// * **It must never fall back SILENTLY.** The word carrying the weight is *silently*, and for a
//   long time this file enforced the shorter rule instead: a surface routed to an unavailable
//   provider raised `ReasoningUnavailable`, and the session stopped. Measured on a really
//   stopped daemon (`EVIDENCE/phase6-measure-before.mjs`, not a stub): `plan()` threw and no
//   task could be finished at all. That is not what `D-0312` asks for — it asks that if ATOM
//   falls the product CARRIES ON, and SAYS SO. So the fallback exists, and every one of them
//   is recorded: which surface, which provider answered instead, the reason, and the instant.
//   What is still forbidden is answering from the reference provider while reporting a
//   provenance that says otherwise — that would attach a plausible answer to a lie, and the
//   whole point of recording provenance is to be able to trust it.
// * **It must never finish a step at two qualities.** A fallback is honest when the reference
//   provider answers the WHOLE piece of work. If ATOM already answered a surface in this
//   session and then falls, degrading the rest would stitch half a reasoning of one quality to
//   half of another — so that case stops instead, with a resumable checkpoint on the error
//   (`D-0312`: «un passo in corso si ferma con un checkpoint riprendibile»).
// * **It must never become required.** With no configuration, every surface is the reference
//   provider and this file changes nothing about how the product behaves. `09_PIANO.md` §3 is
//   measured in that state: if "done" needed an external provider, it would not be done.

import { ReferenceReasoningProvider, ReasoningRefused, ReasoningMode } from './reasoning.mjs';
import { AtomClient, ReasoningUnavailable } from './atom-client.mjs';

/**
 * The surfaces an external provider is asked for by default.
 *
 * Not a guess: `decompose` and `expect` are the two the design names, and the two where the
 * answer is derivable rather than judged, so a difference between providers is a difference in
 * the work and not in the wording.
 *
 * `simulate` joins them for a different reason: it is the one surface the reference provider
 * cannot perform at all (`02_ATOM.md` marks it the only optional one, and calls it the point
 * of having an external provider). Leaving it off the default would mean an operator who
 * selected an external provider still got `supported: false` forever, which reads as "nothing
 * can simulate" rather than "nobody was asked".
 */
export const DEFAULT_EXTERNAL_SURFACES = Object.freeze(['decompose', 'expect', 'simulate']);

const ROUTABLE = Object.freeze([
  'interpret', 'hypothesize', 'plan', 'decompose', 'expect', 'constrain',
  'classify', 'confidence', 'evidence', 'cancel', 'fixtures', 'simulate',
]);

/** Reads the routing out of the environment, and reports what it read rather than assuming. */
export function routingFrom(env = process.env) {
  const mode = String(env.NOESAR_REASONING_MODE ?? ReasoningMode.REFERENCE_NODE).toLowerCase();
  const endpoint = String(env.NOESAR_RUST_REASONING_ENDPOINT ?? '').trim();
  const token = String(env.NOESAR_RUST_REASONING_TOKEN ?? '');
  const declared = String(env.NOESAR_EXTERNAL_SURFACES ?? '').trim();
  const requested = declared
    ? declared.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_EXTERNAL_SURFACES];

  const external = mode === ReasoningMode.RUST_EXTERNAL && endpoint
    ? requested.filter((name) => ROUTABLE.includes(name))
    : [];
  // A surface named in the environment that this contract does not have is a configuration
  // error the operator should see, not a line to drop quietly.
  const unknown = requested.filter((name) => !ROUTABLE.includes(name));

  // `D-0312`, and the only way to turn it off is to say so. An installation that would rather
  // stop than be served by the reference provider sets `NOESAR_ATOM_FALLBACK=off` and gets the
  // pre-phase-6 behaviour back — declared, not a hidden default. Anything else, including the
  // variable being absent, carries on and declares the degradation.
  const fallback = String(env.NOESAR_ATOM_FALLBACK ?? 'declared').trim().toLowerCase();

  return Object.freeze({
    mode,
    endpoint: endpoint || null,
    hasToken: Boolean(token),
    fallbackWhenUnavailable: fallback !== 'off',
    externalSurfaces: Object.freeze(external),
    unknownSurfaces: Object.freeze(unknown),
    // Stated rather than inferred from an empty list: "nothing is routed away" and "an
    // external provider was selected but has no endpoint" are different situations.
    externalSelected: mode === ReasoningMode.RUST_EXTERNAL,
    endpointMissing: mode === ReasoningMode.RUST_EXTERNAL && !endpoint,
  });
}

/**
 * One shape for "was this answer degraded, and how", derived in ONE place.
 *
 * Reasoning and authoring degrade independently — ATOM can be reachable for `expect` and gone
 * by the time a file is written — but a session is degraded if either was, and every reader
 * (the run, the Session Proof, both status lines) must agree on that word. Rule 5 of `17`: a
 * criterion two modules each derive their own way is a criterion nothing measures.
 *
 * `reasons` is deliberately a list of sentences, not a code: what a status line shows and what
 * a Session Proof records are the same words, so an operator who asks "why" of one and of the
 * other cannot be given two different answers.
 */
export function degradationSummary({ reasoning = [], authoring = [] } = {}) {
  const all = [...reasoning, ...authoring];
  const at = all.map((entry) => entry.atUnix).filter((value) => Number.isFinite(value));
  return Object.freeze({
    degraded: all.length > 0,
    provider: all.length > 0 ? 'reference' : 'atom',
    requestedProvider: 'atom',
    events: Object.freeze(all.map((entry) => Object.freeze({ ...entry }))),
    surfaces: Object.freeze(reasoning.map((entry) => entry.surface)),
    authoredPaths: Object.freeze(authoring.map((entry) => entry.path).filter(Boolean)),
    reasons: Object.freeze([...new Set(all.map((entry) => entry.reason))]),
    firstAtUnix: at.length ? Math.min(...at) : null,
    lastAtUnix: at.length ? Math.max(...at) : null,
  });
}

/**
 * A drop-in for `ReferenceReasoningProvider` whose methods are asynchronous.
 *
 * The synchronous provider remains what it was; this wraps it. Every method returns the same
 * shapes, and every refusal is still a `ReasoningRefused`, so a caller that already handles
 * the reference provider handles this one by adding `await`.
 */
export class ReasoningRouter {
  #reference;
  #client;
  #routing;
  #sessionId;
  #provenance = [];
  #degradations = [];
  /** Whether ATOM has actually ANSWERED in this session — set on success only, which is what
   *  makes the difference between "ATOM was never there" (degrade) and "ATOM fell mid-step"
   *  (stop with a checkpoint) a fact rather than a guess. */
  #answeredExternally = [];

  /**
   * `sessionId` is optional and changes nothing about the answers. It lets an external
   * provider keep one recorder across the calls of a single piece of work, which is what
   * makes `fixtures` able to return a replay pack instead of refusing — a provider asked
   * without a session has no session to hand back.
   */
  constructor({ workspaceRoot = '/workspace', env = process.env, fetchImpl, sessionId } = {}) {
    this.#reference = new ReferenceReasoningProvider(workspaceRoot);
    this.#routing = routingFrom(env);
    this.#client = null;
    this.#sessionId = String(sessionId ?? '').trim() || null;
    if (this.#routing.externalSurfaces.length > 0) {
      this.#client = new AtomClient({
        endpoint: this.#routing.endpoint,
        token: env.NOESAR_RUST_REASONING_TOKEN,
        ...(this.#sessionId ? { sessionId: this.#sessionId } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
      });
    }
  }

  get sessionId() { return this.#sessionId; }

  get routing() { return this.#routing; }

  /** Which provider answered which surface, in the order they were asked. */
  provenance() { return [...this.#provenance]; }

  /**
   * Every time this session asked for ATOM and was served by the reference provider instead.
   *
   * Empty is the normal case and means exactly that — not "we did not look". A caller that
   * shows a session without reading this is showing a degraded answer as a full one, which is
   * the silence the rule at the top of this file forbids.
   */
  degradations() { return this.#degradations.map((entry) => ({ ...entry })); }

  /** One boolean for a status line, so a shell does not have to derive it from a list. */
  get degraded() { return this.#degradations.length > 0; }

  identity() { return this.#reference.identity(); }

  /** Not routed: it derives a value from arguments the caller already holds. */
  blastRadius(files, destructive) { return this.#reference.blastRadius(files, destructive); }

  /** Not routed: it is the contract's own validation, and it is ours to enforce. */
  buildPlan(steps, constraints, mode) {
    return this.#reference.buildPlan(steps, constraints, mode);
  }

  #routes(surface) {
    return this.#routing.externalSurfaces.includes(surface);
  }

  #note(surface, provider) {
    this.#provenance.push({ surface, provider });
  }

  /**
   * `local` is the same call against the reference provider, passed as a thunk rather than
   * rebuilt here: the fallback must run the identical arguments, and a second construction of
   * the payload is a second place for them to drift apart.
   */
  async #external(surface, payload, local) {
    try {
      const value = await this.#client.call(surface, payload);
      this.#answeredExternally.push(surface);
      this.#note(surface, 'atom');
      return value;
    } catch (error) {
      if (error instanceof ReasoningRefused) {
        // A refusal is an answer, and the provider that made it is still the one that
        // answered. Recording it keeps the provenance honest about refusals too. It is
        // emphatically NOT a fallback trigger: ATOM was reachable and said no, and asking a
        // weaker provider until one says yes is how a refusal becomes advisory.
        this.#answeredExternally.push(surface);
        this.#note(surface, 'atom');
        throw error;
      }
      if (!(error instanceof ReasoningUnavailable)) throw error;
      return this.#degrade(surface, error, local);
    }
  }

  /**
   * The one place a fallback is decided. Not inside `AtomClient` and not inside a generation
   * port — both are too far down to declare anything, and a fallback nobody can see from the
   * outside is the silent kind.
   */
  #degrade(surface, error, local) {
    // An installation that chose to stop rather than degrade gets what it chose, unchanged.
    if (!this.#routing.fallbackWhenUnavailable) throw error;

    if (this.#answeredExternally.length > 0) {
      // `D-0312`: a step begun with ATOM is not finished without it. Half a reasoning at one
      // quality and half at another is worse than a stop, because nothing downstream can tell
      // which half it is reading. The error carries what a resume needs, so "stops" means
      // "stops resumably" and not "the work is lost".
      error.checkpoint = Object.freeze({
        resumable: true,
        sessionId: this.#sessionId,
        stoppedAtSurface: surface,
        answeredExternally: Object.freeze([...this.#answeredExternally]),
        reason: error.reason ?? error.message,
        atUnix: Math.floor(Date.now() / 1000),
        at: new Date().toISOString(),
        explanation: 'ATOM answered earlier in this session and then became unreachable. Resuming with the reference provider would finish this step at a different quality from the part already done, so it stops here with everything needed to re-run it once ATOM is back (D-0312).',
      });
      throw error;
    }

    // ATOM was never reached in this session: the reference provider can answer the WHOLE of
    // it, which is the case where carrying on is honest.
    const value = local();
    const record = Object.freeze({
      surface,
      provider: 'reference',
      requestedProvider: 'atom',
      reason: error.reason ?? error.message,
      endpoint: this.#routing.endpoint,
      atUnix: Math.floor(Date.now() / 1000),
      at: new Date().toISOString(),
    });
    this.#degradations.push(record);
    // The provenance entry says `reference`, because the reference provider is what answered —
    // and carries the degradation beside it, so a reader cannot mistake this for a surface that
    // was never routed anywhere in the first place.
    this.#provenance.push({ surface, provider: 'reference', degraded: true, reason: record.reason, at: record.at });
    return value;
  }

  #local(surface, run) {
    const value = run();
    this.#note(surface, 'reference');
    return value;
  }

  async interpret(request, projectRules = []) {
    if (!this.#routes('interpret')) {
      return this.#local('interpret', () => this.#reference.interpret(request, projectRules));
    }
    return this.#external('interpret', { request, projectRules, mapDigest: '' }, () => this.#reference.interpret(request, projectRules));
  }

  async hypothesize(intent, gathered = []) {
    if (!this.#routes('hypothesize')) {
      return this.#local('hypothesize', () => this.#reference.hypothesize(intent, gathered));
    }
    return this.#external('hypothesize', { intent, gathered }, () => this.#reference.hypothesize(intent, gathered));
  }

  async plan(chosen, constraints = [], mode = 'safe') {
    if (!this.#routes('plan')) {
      return this.#local('plan', () => this.#reference.plan(chosen, constraints, mode));
    }
    return this.#external('plan', { chosen, constraints, mode }, () => this.#reference.plan(chosen, constraints, mode));
  }

  async decompose(step) {
    if (!this.#routes('decompose')) {
      return this.#local('decompose', () => this.#reference.decompose(step));
    }
    return this.#external('decompose', { step }, () => this.#reference.decompose(step));
  }

  async expect(plan) {
    if (!this.#routes('expect')) {
      return this.#local('expect', () => this.#reference.expect(plan));
    }
    return this.#external('expect', { plan }, () => this.#reference.expect(plan));
  }

  async constrain(plan, policy) {
    if (!this.#routes('constrain')) {
      return this.#local('constrain', () => this.#reference.constrain(plan, policy));
    }
    return this.#external('constrain', { plan, policy }, () => this.#reference.constrain(plan, policy));
  }

  async classify(plan) {
    if (!this.#routes('classify')) {
      return this.#local('classify', () => this.#reference.classify(plan));
    }
    return this.#external('classify', { plan }, () => this.#reference.classify(plan));
  }

  async confidence(plan, results = []) {
    if (!this.#routes('confidence')) {
      return this.#local('confidence', () => this.#reference.confidence(plan, results));
    }
    return this.#external('confidence', { plan, results }, () => this.#reference.confidence(plan, results));
  }

  async evidence(claim) {
    if (!this.#routes('evidence')) {
      return this.#local('evidence', () => this.#reference.evidence(claim));
    }
    return this.#external('evidence', { claim }, () => this.#reference.evidence(claim));
  }

  async cancel(plan) {
    if (!this.#routes('cancel')) {
      return this.#local('cancel', () => this.#reference.cancel(plan));
    }
    return this.#external('cancel', { plan }, () => this.#reference.cancel(plan));
  }

  async fixtures(sessionId) {
    if (!this.#routes('fixtures')) {
      return this.#local('fixtures', () => this.#reference.fixtures(sessionId));
    }
    return this.#external('fixtures', { sessionId }, () => this.#reference.fixtures(sessionId));
  }

  /**
   * The only optional surface of the contract, and the only one where "the reference
   * answered" is itself the interesting fact: it answers `supported: false`, always.
   *
   * `shadowWorkspace` is a path, and the provider reads it. That is a property of the frozen
   * contract, not of this file: a provider in another process therefore predicts nothing
   * unless it can see that directory. This router does not paper over that — an external
   * provider that cannot read the path refuses, and a refusal is reported as a refusal.
   */
  async simulate(plan, shadowWorkspace) {
    if (!this.#routes('simulate')) {
      return this.#local('simulate', () => this.#reference.simulate(plan, shadowWorkspace));
    }
    return this.#external('simulate', { plan, shadowWorkspace }, () => this.#reference.simulate(plan, shadowWorkspace));
  }
}

export { ReasoningUnavailable };

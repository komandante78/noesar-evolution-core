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
// * **It must never fall back silently.** If a surface is routed to an external provider and
//   that provider is unavailable, the router raises `ReasoningUnavailable`. Answering with
//   the reference provider instead would attach a plausible answer to a provenance that is a
//   lie, and the whole point of recording provenance is to be able to trust it.
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

  return Object.freeze({
    mode,
    endpoint: endpoint || null,
    hasToken: Boolean(token),
    externalSurfaces: Object.freeze(external),
    unknownSurfaces: Object.freeze(unknown),
    // Stated rather than inferred from an empty list: "nothing is routed away" and "an
    // external provider was selected but has no endpoint" are different situations.
    externalSelected: mode === ReasoningMode.RUST_EXTERNAL,
    endpointMissing: mode === ReasoningMode.RUST_EXTERNAL && !endpoint,
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

  async #external(surface, payload) {
    try {
      const value = await this.#client.call(surface, payload);
      this.#note(surface, 'atom');
      return value;
    } catch (error) {
      if (error instanceof ReasoningRefused) {
        // A refusal is an answer, and the provider that made it is still the one that
        // answered. Recording it keeps the provenance honest about refusals too.
        this.#note(surface, 'atom');
        throw error;
      }
      throw error;
    }
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
    return this.#external('interpret', { request, projectRules, mapDigest: '' });
  }

  async hypothesize(intent, gathered = []) {
    if (!this.#routes('hypothesize')) {
      return this.#local('hypothesize', () => this.#reference.hypothesize(intent, gathered));
    }
    return this.#external('hypothesize', { intent, gathered });
  }

  async plan(chosen, constraints = [], mode = 'safe') {
    if (!this.#routes('plan')) {
      return this.#local('plan', () => this.#reference.plan(chosen, constraints, mode));
    }
    return this.#external('plan', { chosen, constraints, mode });
  }

  async decompose(step) {
    if (!this.#routes('decompose')) {
      return this.#local('decompose', () => this.#reference.decompose(step));
    }
    return this.#external('decompose', { step });
  }

  async expect(plan) {
    if (!this.#routes('expect')) {
      return this.#local('expect', () => this.#reference.expect(plan));
    }
    return this.#external('expect', { plan });
  }

  async constrain(plan, policy) {
    if (!this.#routes('constrain')) {
      return this.#local('constrain', () => this.#reference.constrain(plan, policy));
    }
    return this.#external('constrain', { plan, policy });
  }

  async classify(plan) {
    if (!this.#routes('classify')) {
      return this.#local('classify', () => this.#reference.classify(plan));
    }
    return this.#external('classify', { plan });
  }

  async confidence(plan, results = []) {
    if (!this.#routes('confidence')) {
      return this.#local('confidence', () => this.#reference.confidence(plan, results));
    }
    return this.#external('confidence', { plan, results });
  }

  async evidence(claim) {
    if (!this.#routes('evidence')) {
      return this.#local('evidence', () => this.#reference.evidence(claim));
    }
    return this.#external('evidence', { claim });
  }

  async cancel(plan) {
    if (!this.#routes('cancel')) {
      return this.#local('cancel', () => this.#reference.cancel(plan));
    }
    return this.#external('cancel', { plan });
  }

  async fixtures(sessionId) {
    if (!this.#routes('fixtures')) {
      return this.#local('fixtures', () => this.#reference.fixtures(sessionId));
    }
    return this.#external('fixtures', { sessionId });
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
    return this.#external('simulate', { plan, shadowWorkspace });
  }
}

export { ReasoningUnavailable };

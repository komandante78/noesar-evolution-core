// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The wiring D-0190 asked for: the first product surface that spends a capability token and
// changes a real file. Everything it calls already existed and was tested in isolation —
// ReferenceReasoningProvider (step 1-2), TokenMinter (step 3), ShadowWorkspace and execute()
// (steps 4-5), EventLedger (step 6) — and none of it was reachable from a request. This
// module is the seam, not a sixth mechanism: it owns no security decision that capability.mjs,
// shadow.mjs or executor.mjs already make, and duplicating one here is exactly how two
// implementations of one rule stop agreeing.
//
// WHAT execute() DOES NOT DO, WHICH IS WHY THIS FILE EXISTS. Reading executor.mjs shows the
// gap directly: `execute()` writes into `shadow.root`, a throwaway copy, and nothing carries
// an accepted result back into the real workspace before the shadow is discarded. Calling
// execute() today — which nothing did — would still leave `executorWiredToProductActions`
// false, because the write never reaches a file the product's own user can see. PROMOTION
// (copying the shadow's changed files back to the real workspace, and only when the
// comparison came back clean) is the missing half, built here.
//
// SCOPE, NAMED RATHER THAN DISCOVERED LATER. This wires the TRIVIAL risk path of
// 11_REVISIONE_E_CORREZIONI.md P6 (`interpret → plan → expect → autorizza → esegui →
// verifica`) plus promotion and restore: one step, WRITE only, no DELETE, no EXECUTE, no
// hypotheses in competition. Two things the phase-1 criterion names are deliberately NOT
// built here, and workspaceActionsStatus() says so rather than implying otherwise:
//
//   - "esegue i test" for an AI-declared test expectation. executor.mjs already declares
//     EXECUTE a PERMANENT refusal — "this layer has no execution surface, and pretending to
//     run it would be worse than refusing" — and that boundary was tested and shipped in
//     step 5. Running a plan-declared test command would mean running arbitrary code the
//     plan named, which is exactly what EXECUTE refuses. This module does not reopen that
//     boundary; it is a separate, larger decision (a real sandbox, not a wiring exercise),
//     named here rather than quietly built or quietly ignored.
//   - Because no test runs, a plan with no declared files and no declared test always fails
//     `expect()` (reasoning.mjs line ~232) exactly as the reference provider intends: it has
//     no model, so it cannot invent a file target from a request's prose. The caller of
//     `plan()` here supplies `files` explicitly — the honest form of "something upstream of
//     the reference provider decided what to touch", same posture the reference provider
//     already takes about everything it cannot derive.
//
// THE APPROVAL IS THE OWNER'S, NOT A TIMER'S. `authorizePlan` already refuses an approval
// that expires before it starts or has lapsed; this module fixes the grant to a short TTL
// (15 minutes) so a plan nobody looked at cannot be approved by staleness.
//
// PROMOTION IS ALL-OR-NOTHING. Every outcome is checked BEFORE any real file is touched:
// `execute()`'s own `ok` flag (every action performed AND the comparison ran AND it was
// clean) gates the whole run. A partially-applied edit — three files promoted, the fourth
// refused mid-loop — would be a state nobody planned for and nobody authorised.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { ReasoningRefused } from './reasoning.mjs';
import { Author, AuthoringUnavailable, AuthoringRefused } from './author.mjs';
import { groundRequest as defaultGroundRequest, GroundingRefused } from './request-grounding.mjs';
import { profileChange as defaultProfileChange, DivergenceUnavailable } from './divergence-profile.mjs';
import { ReasoningRouter, routingFrom, degradationSummary, degradationFrequency } from './reasoning-router.mjs';
import { ReasoningUnavailable } from './atom-client.mjs';
import { authorizePlan, CapabilityError } from './capability.mjs';
import { ShadowWorkspace, contained } from './shadow.mjs';
import { execute } from './executor.mjs';
import { verifyClaims, projectionCoverage } from './verification.mjs';
import { assembleSessionProof } from './session-proof.mjs';
import { compareDecisions, comparePolicyOutcome, callAtomReplay as defaultCallAtomReplay, DECISION_SURFACES } from './session-replay.mjs';
import { RunStore } from './run-store.mjs';
import { AuthoringReplayStore, replayFromStore, referencedDigests } from './authoring-replay-store.mjs';

/** A ledger payload is a JSON string; a damaged one yields `{}` rather than taking down the
 *  read. Same shape as `session-proof.mjs` and `reasoning-router.mjs`, which read the same
 *  ledger — three copies of `JSON.parse(event.payload || '{}')` was two too many. */
function parseEventPayload(event) {
  try { return JSON.parse(event?.payload || '{}'); } catch { return {}; }
}

export const APPROVAL_TTL_SECONDS = 15 * 60;
const MAX_DIFF_BYTES = 256 * 1024;

export class WorkspaceActionError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'WorkspaceActionError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new WorkspaceActionError(kind, reason); };

function readTextIfSmall(path) {
  if (!existsSync(path)) return { available: true, content: null };
  const size = readFileSync(path).length;
  if (size > MAX_DIFF_BYTES) return { available: false, content: null, reason: `over ${MAX_DIFF_BYTES} bytes` };
  try {
    return { available: true, content: readFileSync(path, 'utf8') };
  } catch {
    return { available: false, content: null, reason: 'not valid UTF-8' };
  }
}

/**
 * One orchestrator per server process.
 *
 * `#runs` is the read path and stays a Map — every lookup in this file goes through it. What
 * changed in D-0338 is that it is no longer the ONLY copy: a `RunStore` is written through on
 * each of the four points a run changes, and rehydrated at construction, so an operator who
 * planned a change does not lose it to a restart. Given no store, the behaviour is exactly
 * what it was, and `status()` reports which of the two this instance is rather than assuming.
 */
export class WorkspaceActionOrchestrator {
  #workspaceRoot;
  #shadowsRoot;
  #minter;
  #events;
  #runs = new Map();
  // `D-0567`. The shadow a `measure()` produced, held until `approve()` promotes from it or
  // `reject()` drops it. In memory only, and deliberately so: a shadow that outlived the process
  // that made it would be a measured result nobody can prove still matches the workspace.
  #shadows = new Map();
  #runStore;

  #authoringReplayStore;
  #damagedRuns = [];
  #reasoningFor;
  #executeSandbox;
  #privacyStateFor;
  #env;
  #groundRequest;
  #author;
  #profileChange;

  #skillsFor;

  #runRetention;

  constructor({ workspaceRoot, shadowsRoot, minter, events, reasoningFor, executeSandbox = null, privacyStateFor = null, env = process.env, groundRequest = defaultGroundRequest, author = null, profileChange = defaultProfileChange, runStoreDirectory = null, skillsFor = () => [], runRetention = 500 }) {
    // Failed fast here once already, the wrong way: `workspace/shadows` looked like a
    // reasonable place to put shadows because the read-only status route already probes
    // there — but that route only writes a tiny probe file, never a whole-workspace shadow,
    // so the containment refusal in shadow.mjs never fired until the first real approval.
    // Checked at construction now, so a future caller finds out at startup, not on a live run.
    const workspaceResolved = resolve(workspaceRoot);
    const shadowsResolved = resolve(shadowsRoot);
    if (shadowsResolved === workspaceResolved
      || shadowsResolved.startsWith(workspaceResolved + sep)
      || workspaceResolved.startsWith(shadowsResolved + sep)) {
      throw new WorkspaceActionError('CONTAINMENT',
        `shadowsRoot (\`${shadowsResolved}\`) and workspaceRoot (\`${workspaceResolved}\`) must not contain one another — a whole-workspace shadow inside the tree it shadows would include itself`);
    }
    this.#workspaceRoot = workspaceRoot;
    this.#shadowsRoot = shadowsRoot;
    this.#minter = minter;
    this.#events = events;
    // A seam, for the same reason `methodPolicy` is one in session-protocol.mjs: the
    // interesting branches here are the refusals, and a refusal that only fires against a
    // real repository is a refusal no test can reach without building one.
    this.#groundRequest = groundRequest;
    // Phase 7. A seam for the same reason `groundRequest` is one: the interesting branches are
    // the refusals, and «this workspace is not a git repository» is not reachable in a test
    // without building one.
    this.#profileChange = profileChange;
    // `D-0345`. What closes the `enforced:false` the skill catalogue has declared about
    // itself since it was built: the bridge from "an operator adopted these instructions"
    // to "the Author had them in hand before it wrote". A seam like the two above, and
    // defaulting to a function that returns nothing — an installation that has adopted no
    // skill composes no skills and its prompt is byte-identical to before.
    this.#skillsFor = skillsFor;
    // `D-0346`. How many run files survive. Validated here rather than at the first prune,
    // so a bad value is a startup failure and not a silent one discovered after months of
    // a directory quietly growing — which is the failure this whole feature exists to stop.
    if (!Number.isInteger(runRetention) || runRetention < 1) {
      throw new WorkspaceActionError('INVALID_RETENTION',
        `runRetention must be a positive integer, got \`${runRetention}\``);
    }
    this.#runRetention = runRetention;
    // Stage 9b (`16` §3.3): the component that writes the contents. Optional and absent by
    // default — an installation with no model configured plans exactly as it did before and
    // says so, rather than presenting empty contents as a result. It is deliberately NOT
    // reachable from `#runDecisionLayer`: that method is what `replay()` re-runs, and a model
    // writing fresh bytes on every replay would be reported as drift originating in this file
    // when it is the one thing `01_VISIONE_E_POSIZIONE.md` already declares non-deterministic
    // and reproduces from fixtures instead.
    this.#author = author;
    // ARCH-008 / D-0250: the client's own decision, resolved once at boot in server.mjs
    // (`resolveExecuteSandboxConfig`) and threaded through, never re-read per call — a
    // config that could change mid-run would make "the token's limits were checked against
    // the installed ceiling at mint time" stale by the time execute() spends it.
    this.#executeSandbox = executeSandbox;
    // D-0338. Rehydrated here, at construction, so nothing downstream ever has to ask whether
    // the runs it can see are all of them. A damaged file is kept in `#damagedRuns` and
    // reported by `status()` — losing one run to a full disk must not stop the others coming
    // back, and must not be silent either.
    this.#runStore = new RunStore(runStoreDirectory);
    // `D-0597` / `CE-006`. The bytes behind every recorded model call, content-addressed, beside
    // the runs and never inside them: a run file is rewritten on every state change, so putting
    // prompts in it would rewrite megabytes to record a status. `null` where runs are not
    // durable either — an installation that keeps no run state honestly keeps no replay state,
    // rather than a store nothing can ever reach.
    this.#authoringReplayStore = new AuthoringReplayStore(
      runStoreDirectory ? join(runStoreDirectory, 'authoring-replay') : null,
    );
    const loaded = this.#runStore.loadAll();
    for (const { runId, run } of loaded.runs) this.#runs.set(runId, run);
    this.#damagedRuns = loaded.damaged;
    // SESS-001: the egress state sampled at points in the run's own timeline, not read once
    // at the end — a run that went local-only and then, mid-way, had a connector enabled must
    // show both, not overwrite the first with the second. `null` is honest: sessionProof()
    // reports no samples rather than inventing a state nobody asked derivePrivacy() for.
    this.#privacyStateFor = privacyStateFor;
    // SESS-002: stored (not just read once) so replay()'s EXTERNAL_PACK path resolves the
    // SAME endpoint/token a default `reasoningFor` would have used — reading `process.env`
    // directly there would ignore whatever `env` a test (or a future caller) supplied here,
    // and silently disagree with the provider that actually answered this run.
    this.#env = env;
    // A factory, not an instance: a router accumulates the provenance of the calls made
    // through it, so one shared across runs would attribute this run's surfaces to the
    // previous one's. One per call, discarded with the call.
    //
    // SESS-002: `sessionId` threads through to `ReasoningRouter` -> `AtomClient`, which is
    // what lets an external provider keep one recorder across a run's calls (reasoning-
    // router.mjs's own comment: "what makes `fixtures` able to return a replay pack instead
    // of refusing"). Before this, every call here used no session at all, so `fixtures()`
    // had nothing to hand back for ANY run — the capture SESS-001 declared missing.
    this.#reasoningFor = reasoningFor ?? ((sessionId) => new ReasoningRouter({ workspaceRoot, sessionId, env: this.#env }));
  }

  /**
   * The decision layer, shared by `plan()` and `replay()` so there is exactly one
   * implementation of "what a request becomes" — replay recomputing it a second time is the
   * whole point; a SECOND piece of code that re-derives the same semantics differently is the
   * "two implementations of one rule stop agreeing" failure this project keeps finding
   * (D-0227's own comment about not re-implementing comparison logic applies here too).
   */
  async #runDecisionLayer({ provider, request, files, projectRules, constraints, mode, policy }) {
    const intent = await provider.interpret(request, projectRules);
    // Grounding, and ONLY when the caller named nothing. A caller who named files made a
    // decision, and a step that silently replaced it with a search result would be answering
    // a question nobody asked — the operator would approve a plan about files they did not
    // choose. So this widens what can be planned; it never overrules what was planned.
    //
    // It sits here, after `interpret` and inside this method, because the goal it searches on
    // is the provider's, and calling `interpret` a second time from `plan()` to get it would
    // be two model calls per plan whose answers are not required to agree — and `session-
    // replay.mjs` would then report the disagreement as drift originating in this file.
    let resolvedFiles = files;
    let grounding = null;
    if (resolvedFiles.length === 0) {
      // `request` as well as the goal: a provider that answers something unrelated must not
      // be able to steer this step away from what was actually asked. Measured, not feared —
      // see request-grounding.mjs.
      const grounded = this.#groundRequest({ workspaceRoot: this.#workspaceRoot, goal: intent.goal, request });
      resolvedFiles = grounded.files;
      grounding = grounded.grounding;
    }
    const hypotheses = await provider.hypothesize(intent, []);
    const step = {
      id: 'step-1',
      description: hypotheses[0].statement,
      files: resolvedFiles.map((file) => file.path),
      commands: [],
      dependsOn: [],
      blastRadius: provider.blastRadius(resolvedFiles.map((file) => file.path), false),
    };
    const plan = provider.buildPlan([step], constraints, mode);
    const constrained = await provider.constrain(plan, policy);
    if (constrained.refused) refuse('CONSTRAINED_AWAY', constrained.reason);
    const risk = await provider.classify(constrained.plan);
    const confidence = await provider.confidence(constrained.plan, []);
    const expectation = await provider.expect(constrained.plan);
    return {
      intent, hypotheses, plan: constrained.plan, risk, confidence, expectation,
      provenance: provider.provenance(), files: resolvedFiles, grounding,
    };
  }

  #record(correlationId, causationId, actor, action, details, nowUnix) {
    const event = this.#events.append({
      id: randomUUID(),
      correlationId,
      causationId,
      actor,
      action,
      payload: JSON.stringify(details ?? {}),
      recordedAtUnix: nowUnix,
    });
    return event.id;
  }

  // Never throws: a caller that did not wire a sampler gets an honest empty list, not a
  // missing session proof. `at` names the point in the run's lifecycle the sample was taken.
  #sampleEgress(at, nowUnix) {
    if (!this.#privacyStateFor) return null;
    try {
      const state = this.#privacyStateFor();
      return { at, nowUnix, state: state?.state ?? null, disclosures: state?.disclosures ?? [] };
    } catch {
      return { at, nowUnix, state: null, disclosures: [], reason: 'the privacy sampler threw' };
    }
  }

  get(runId) {
    const run = this.#runs.get(runId);
    return run ? { ...run } : null;
  }

  /**
   * The runs a chat owns — point 4b, and the only place in the product that answers "which
   * work belongs to this conversation". Three scopes, all explicit: `conversation` for one
   * chat, `unattached` for the runs nobody opened from a chat (every terminal run, by
   * construction), `all` for both. There is deliberately no "current conversation" default:
   * a caller that does not say which chat it means gets everything and has to group it, rather
   * than being handed whichever chat happened to be open — that guess is the whole defect.
   *
   * Summaries, not runs. A run carries `files[].contents` in full and `authoredContents` with
   * it; a list rendered in a side panel has no business holding the bytes of the workspace,
   * and the single-run route already exists for anyone who needs them.
   */
  runsFor({ scope = 'all', conversationId = null } = {}) {
    if (scope !== 'all' && scope !== 'conversation' && scope !== 'unattached') {
      refuse('INVALID_SCOPE', 'scope must be `all`, `conversation` or `unattached`');
    }
    if (scope === 'conversation' && (typeof conversationId !== 'string' || !conversationId.trim())) {
      refuse('INVALID_CONVERSATION', 'scope `conversation` needs a non-empty conversationId');
    }
    const all = [...this.#runs.values()];
    const selected = all.filter((run) => {
      if (scope === 'all') return true;
      if (scope === 'unattached') return run.conversationId === null;
      return run.conversationId === conversationId;
    });
    return {
      scope,
      conversationId: scope === 'conversation' ? conversationId : null,
      runs: selected
        .slice()
        // Newest first, with the id as tiebreak so two runs planned in the same second do not
        // change places between two reads of the same list.
        .sort((a, b) => (b.createdAtUnix - a.createdAtUnix) || a.runId.localeCompare(b.runId))
        .map((run) => ({
          runId: run.runId,
          conversationId: run.conversationId,
          status: run.status,
          createdAtUnix: run.createdAtUnix,
          actor: run.actor,
          request: run.request ?? null,
          filePaths: (run.files ?? []).map((file) => file.path),
          fileCount: (run.files ?? []).length,
          risk: run.risk?.overall ?? null,
        })),
      counts: {
        total: all.length,
        attached: all.filter((run) => run.conversationId !== null).length,
        unattached: all.filter((run) => run.conversationId === null).length,
      },
      // Declared, not discovered later by an operator whose plan vanished — and now READ off
      // the store rather than asserted. It said a flat `false` until D-0338, which was true;
      // replacing it with a flat `true` would have been the same mistake pointing the other
      // way, because an embedder that builds this orchestrator without a store still holds
      // runs only in memory and must still be told so.
      persistence: this.#runStore.durable
        ? {
          durable: true,
          reason: 'runs are written through to disk as they change and reloaded at startup',
          // Named, not implied: a plan survives, and the shadow it would be promoted from does
          // not. `restore()` reads `run.backups`, which are real files in the workspace, so a
          // reloaded run can still be restored — but a run left PENDING_APPROVAL across a
          // restart is approved against the workspace as it is NOW.
          rebuiltFromDisk: true,
          damaged: this.#damagedRuns,
        }
        : { durable: false, reason: 'runs are held in memory for the life of this process', damaged: [] },
    };
  }

  /**
   * Write one run through to disk (D-0338). Called at the four points a run changes — created,
   * approved, rejected, restored — and nowhere else, because those are the only four.
   *
   * A failure here is REPORTED, never swallowed and never fatal. Losing durability is a real
   * degradation and the operator must be told; but a full disk taking down a run that has
   * already promoted files into the workspace would turn a storage problem into a product
   * failure, and the in-memory Map is still correct. The same posture the reasoning router
   * takes about ATOM: continue, and say so.
   */
  #saveRun(runId) {
    if (!this.#runStore.durable) return;
    try {
      this.#runStore.save(runId, this.#runs.get(runId));
    } catch (error) {
      this.#damagedRuns.push({ file: `${runId}.json`, reason: `could not be written: ${error.message}` });
    }
    // `D-0346`. Pruned here rather than on a timer: this is the only place that makes the
    // directory grow, so it is the only place that needs to bound it, and a product that
    // owns no scheduler should not acquire one to delete files.
    //
    // A pruning failure is swallowed the same way a write failure is: running out of old
    // runs to delete must never be what takes down a run that has already promoted files
    // into the workspace. The reason lands on `damagedRuns`, where the operator sees it.
    try {
      const protectedRunIds = new Set();
      for (const [id, run] of this.#runs) {
        // The two non-terminal states. A run in either is a person waiting to decide, and
        // deleting it because it is old would answer the decision by losing the question.
        // `MEASURED` joined `PENDING_APPROVAL` with `D-0567`: it is the state where the person
        // is looking at the measured result, which is the whole point of `CE-008`.
        if (run.status === 'PENDING_APPROVAL' || run.status === 'MEASURED') protectedRunIds.add(id);
      }
      this.#runStore.prune({ keep: this.#runRetention, protectedRunIds });
    } catch (error) {
      this.#damagedRuns.push({ file: 'retention', reason: `could not prune old runs: ${error.message}` });
    }
  }

  /** SESS-001: the ten-field Session Proof, assembled from this run and its causal events. */
  /**
   * How often ATOM has fallen, over the ledger this installation actually holds.
   *
   * `D-0312` asks for the frequency to be MEASURED, and a number nobody can reach is not
   * measured. Exposed here rather than computed in a route, so the terminal and the browser
   * ask the same object the same question.
   */
  degradationFrequency({ sinceUnix = null } = {}) {
    return degradationFrequency(this.#events.events(), { sinceUnix });
  }

  sessionProof(runId) {
    const run = this.#runs.get(runId);
    if (!run) return null;
    return assembleSessionProof({ run, events: this.#events.correlation(runId) });
  }

  /**
   * SESS-002: does replaying this run reproduce the same decisions? Two paths, chosen by
   * what actually happened at `plan()` time — never guessed, never mixed:
   *
   *   - every surface answered locally  -> recompute directly with a fresh provider (the
   *     reference provider is a pure function of its inputs, so this is byte-for-byte or it
   *     is a real divergence) and structurally compare against what the run recorded.
   *   - any surface answered by the external provider -> the model's own answers cannot be
   *     regenerated (11_REVISIONE_E_CORREZIONI.md P1); the captured `fixturePack` is replayed
   *     through that SAME provider's own `/v1/replay` (an ATOM extension, proven faithful by
   *     `tools/measure-replay-fidelity.mjs`, D-0227) and its verdict is reported as-is.
   *
   * Never mints a token, never touches the workspace, never re-executes anything: replay
   * answers "would this decide the same way again", not "do it again".
   */
  async replay({ runId, actor, nowUnix, callAtomReplay }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no run \`${runId}\``);

    const usedExternal = run.provenance.some((entry) => entry.provider === 'atom' && DECISION_SURFACES.includes(entry.surface));
    if (!usedExternal) {
      const provider = this.#reasoningFor(`replay-${runId}`);
      let recomputed;
      try {
        recomputed = await this.#runDecisionLayer({
          provider, request: run.request, files: run.files, projectRules: run.projectRules,
          constraints: run.constraints, mode: run.mode, policy: run.policy,
        });
      } catch (error) {
        if (error instanceof ReasoningRefused) refuse('REASONING_REFUSED', error.reason);
        if (error instanceof WorkspaceActionError) {
          // CONSTRAINED_AWAY on replay means the current code would now refuse a plan the
          // original run was approved under — real divergence, reported not thrown.
          this.#record(runId, run.planEventId, actor, 'workspace_action.replayed',
            { method: 'LOCAL_RECOMPUTE', faithful: false, refusedOnReplay: error.reason }, nowUnix);
          return { runId, method: 'LOCAL_RECOMPUTE', faithful: false, diffs: [{ field: 'plan', was: run.plan, now: null, reason: `CONSTRAINED_AWAY on replay: ${error.reason}` }] };
        }
        throw error;
      }
      const comparison = compareDecisions(run, recomputed);
      this.#record(runId, run.planEventId, actor, 'workspace_action.replayed',
        { method: 'LOCAL_RECOMPUTE', faithful: comparison.faithful, diffFields: comparison.diffs.map((d) => d.field) }, nowUnix);
      return { runId, method: 'LOCAL_RECOMPUTE', ...comparison };
    }

    if (!run.fixturePack) {
      return { runId, method: 'EXTERNAL_PACK', replayable: false,
        reason: 'this run routed at least one surface externally, and no fixture pack was captured for it at plan() time' };
    }
    const routing = routingFrom(this.#env);
    if (!routing.endpoint) {
      return { runId, method: 'EXTERNAL_PACK', replayable: false,
        reason: 'no external reasoning endpoint is configured on this installation right now' };
    }
    const caller = callAtomReplay ?? defaultCallAtomReplay;
    let report;
    try {
      report = await caller({ endpoint: routing.endpoint, token: this.#env.NOESAR_RUST_REASONING_TOKEN, pack: run.fixturePack });
    } catch (error) {
      if (error instanceof ReasoningUnavailable) {
        return { runId, method: 'EXTERNAL_PACK', replayable: false, reason: error.reason };
      }
      throw error;
    }
    this.#record(runId, run.planEventId, actor, 'workspace_action.replayed',
      { method: 'EXTERNAL_PACK', faithful: report.faithful }, nowUnix);
    return { runId, method: 'EXTERNAL_PACK', replayable: true, faithful: report.faithful, atomReport: report };
  }

  /**
   * `CE-006`: replay ONE model call of a concluded run, in isolation, from its recorded state.
   *
   * Distinct from `replay()` above, and the difference is the whole point. `replay()` re-runs
   * the DECISION LAYER of a run — what a request became — and deliberately never reaches the
   * Author, because "a model writing fresh bytes on every replay would be reported as drift
   * originating in this file". `CE-006` asks the other question: can each individual call to
   * the model be re-executed from what was written down about it? Those are two criteria and
   * they get two methods rather than one that quietly answers whichever is easier.
   *
   * The fixtures are read from the EVENT LEDGER, not from the run: the ledger is where they are
   * written, it is append-only, and a run may already have been pruned while the record that it
   * happened survives — `RunStore.prune`'s own note, *"pruning a run loses the ability to replay
   * it, not the record that it happened"*, is exactly the boundary being respected here.
   *
   * `index` names which call of that run. It is the caller's business which one — the
   * criterion's method is *"replay di una decisione scelta a caso"*, and choosing randomly is
   * something a test does to this method, never something this method does to itself.
   */
  replayAuthoredCall({ runId, index = 0 }) {
    const events = this.#events.correlation(runId) ?? [];
    const authored = events.filter((event) => event.action === 'workspace_action.authored');
    if (authored.length === 0) {
      return { runId, replayable: false, reason: `run \`${runId}\` recorded no authoring` };
    }
    // Flattened across every authoring event of the run: a run may author more than once, and
    // indexing per-event would make "call 4 of this run" mean different calls depending on how
    // the attempts happened to be split.
    // A ledger payload is stored as a JSON STRING, not an object — `events.mjs` keeps it that
    // way so the hash chain covers exact bytes. Reading it as an object silently yields
    // `undefined` and, in the first version of this method, produced "recorded an authoring
    // with no calls in it" for a run that had recorded three. Parsed the same way
    // `session-proof.mjs` and `reasoning-router.mjs` already do.
    const fixtures = authored.flatMap((event) => parseEventPayload(event).fixtures ?? []);
    if (fixtures.length === 0) {
      return { runId, replayable: false, reason: `run \`${runId}\` recorded an authoring with no calls in it` };
    }
    if (!Number.isInteger(index) || index < 0 || index >= fixtures.length) {
      return { runId, replayable: false, reason: `call ${index} is outside the ${fixtures.length} this run recorded` };
    }
    const fixture = fixtures[index];
    const outcome = replayFromStore({ fixture, store: this.#authoringReplayStore });
    return {
      runId,
      index,
      calls: fixtures.length,
      path: fixture.path,
      replayable: outcome.kind !== 'UNRESOLVABLE',
      ...outcome,
    };
  }

  /**
   * Every digest the runs this installation still holds reference — the live set a sweep of the
   * replay store would need.
   *
   * Derived from the RUNS rather than from the whole ledger, and the choice is the same one
   * `RunStore.prune` already documents: *"pruning a run loses the ability to replay it, not the
   * record that it happened"*. A ledger line for a pruned run therefore keeps saying the call
   * happened, and its bytes become sweepable — replaying it answers `UNRESOLVABLE`, which is
   * the truth, rather than a faithful replay of something nobody kept.
   *
   * Exposed and never performed: retention is a separate and explicit decision
   * (`CLAUDE10.md` §6 rule 23), so nothing on the hot path deletes recorded state. Until an
   * Owner decision says otherwise the store grows with the ledger, which is stated in
   * `docs/DECISION_LOG.md` rather than left to be discovered on a full disk.
   */
  authoringReplayReferences() {
    const digests = new Set();
    for (const runId of this.#runs.keys()) {
      for (const event of this.#events.correlation(runId) ?? []) {
        if (event.action !== 'workspace_action.authored') continue;
        for (const digest of referencedDigests(parseEventPayload(event).fixtures)) digests.add(digest);
      }
    }
    return digests;
  }

  /**
   * SESS-003: does the product's OWN decision code, as it exists right now, still reach the
   * same verdict a historical, externally-supplied fixture recorded? Deliberately independent
   * of any in-memory run (a historical session may predate this process entirely) and of
   * which provider answered at record time — SESS-003 asks about the CODE changing across
   * versions, which SESS-002 already covers honestly for a model's own answers changing.
   */
  async replayHistoricalFixture({ fixture, historicalOutcome }) {
    if (!fixture || !Array.isArray(fixture.files) || fixture.files.length === 0) {
      refuse('NO_FILES', 'a historical fixture needs the files it declared');
    }
    const provider = this.#reasoningFor(`sess003-${randomUUID()}`);
    const was = { refused: Boolean(historicalOutcome?.refused), riskOverall: historicalOutcome?.riskOverall ?? null };
    let recomputed;
    try {
      recomputed = await this.#runDecisionLayer({
        provider, request: fixture.request, files: fixture.files,
        projectRules: fixture.projectRules ?? [], constraints: fixture.constraints ?? [],
        mode: fixture.mode ?? 'safe', policy: fixture.policy ?? 'restrictive',
      });
    } catch (error) {
      if (error instanceof ReasoningRefused) refuse('REASONING_REFUSED', error.reason);
      if (error instanceof WorkspaceActionError) {
        // A refusal now, where the historical record claims it was permitted, IS the drift
        // SESS-003 exists to reveal — reported as a finding, never thrown away as an error.
        // Not recorded to the event ledger: this fixture is not the workspace_action of any
        // in-memory run, and inventing a correlationId for it would misuse events.mjs's own
        // meaning of "the run this event belongs to".
        const drift = comparePolicyOutcome(was, { refused: true, riskOverall: null });
        return { method: 'POLICY_REPLAY', policyDrift: drift, recomputedRefusalReason: error.reason };
      }
      throw error;
    }
    const drift = comparePolicyOutcome(was, { refused: false, riskOverall: recomputed.risk?.overall ?? null });
    return { method: 'POLICY_REPLAY', policyDrift: drift, recomputed: { risk: recomputed.risk, expectation: recomputed.expectation } };
  }

  /**
   * request → plan, through the real reasoning pipeline. `files` is the one thing the
   * reference provider cannot derive (see the module comment) and is required, not defaulted:
   * a caller with nothing to name should not reach this at all.
   */
  async plan({ request, files = [], projectRules = [], constraints = [], mode = 'safe', policy = 'restrictive', actor, nowUnix, claims = [], conversationId = null }) {
    // Point 4b, Owner decision of 2026-08-06: THE CHAT OWNS THE RUN. A caller that opened this
    // run from a conversation hands its id here and the run carries it for life; a caller that
    // did not — every run started from the terminal, which has no conversation by construction
    // — leaves it `null` and is listed as unattached rather than guessed at. The id is opaque
    // to this module deliberately: whether that conversation EXISTS is authority the transport
    // holds (server.mjs resolves it against the context graph before calling), and asking the
    // same question twice is how two answers to it get built. What IS enforced here is shape,
    // because a non-string reaching the run would be a link nothing can ever resolve back.
    if (conversationId !== null && (typeof conversationId !== 'string' || !conversationId.trim())) {
      refuse('INVALID_CONVERSATION', 'conversationId must be a non-empty string when supplied');
    }
    // `files` is now optional. It was required, and the refusal that enforced it said the
    // reference provider "cannot invent a target from prose alone" — true, and the reason
    // both shells' `/plan` could never do anything: s319's terminal sent `files: []` on
    // every one. The property that sentence protects is kept, and kept literally: nothing
    // downstream accepts a path a model wrote. What changed is that when no file is named,
    // `#runDecisionLayer` asks the REPOSITORY which files the interpreted goal points at
    // (request-grounding.mjs). An empty list is now a request to look, not a malformed call.
    if (!Array.isArray(files)) refuse('INVALID_FILES', 'files must be an array when supplied');
    if (!Array.isArray(claims)) refuse('INVALID_CLAIMS', 'claims must be an array if supplied');
    for (const file of files) {
      if (!file || typeof file.path !== 'string' || !file.path.trim()) {
        refuse('INVALID_FILE', 'every file needs a path');
      }
      if (typeof file.contents !== 'string') refuse('INVALID_FILE', `\`${file.path}\` needs string contents`);
    }
    // SESS-002: the run's own id becomes the router's sessionId, generated before the
    // provider is even created — the only way an external provider has anything to hand
    // `fixtures()` back for is if every call of this run already carried the same session.
    const runId = randomUUID();
    // The router, not the reference provider directly. Until this call site changed, an
    // operator could select an external provider and this path — the only one that mints a
    // token and touches a real file — kept asking the reference one regardless. The
    // selection was real everywhere it did not matter.
    const provider = this.#reasoningFor(runId);
    let decision;
    try {
      decision = await this.#runDecisionLayer({ provider, request, files, projectRules, constraints, mode, policy });
    } catch (error) {
      if (error instanceof ReasoningRefused) refuse('REASONING_REFUSED', error.reason);
      // A grounding refusal keeps its own code and its own reason rather than collapsing into
      // one. "Nothing in this workspace mentions `passkey`, `rotation`" tells the operator
      // what to do next; "NO_FILES" told them only that they had held it wrong.
      if (error instanceof GroundingRefused) refuse(error.code, error.reason);
      // ReasoningUnavailable and WorkspaceActionError (CONSTRAINED_AWAY, thrown inside
      // #runDecisionLayer) both propagate as-is: neither is a refusal this catch invents.
      //
      // Phase 6: a ReasoningUnavailable that reaches here now means one of two things, and the
      // router has already distinguished them. Either the installation set
      // `NOESAR_ATOM_FALLBACK=off` and asked to stop, or ATOM answered earlier in this run and
      // then fell — in which case `error.checkpoint` carries what a resume needs. Neither is
      // re-decided here; it is passed on intact, checkpoint included.
      throw error;
    }
    const { intent, hypotheses, plan, risk, confidence, expectation, provenance, grounding } = decision;
    // Phase 6: which surfaces asked for ATOM and were served by the reference provider. Read
    // off the router rather than derived from `provenance`, so the reason and the instant come
    // from where the decision was made instead of being reconstructed after the fact.
    const reasoningDegradations = typeof provider.degradations === 'function' ? provider.degradations() : [];
    // The files the decision layer settled on — the caller's when it named any, the
    // repository's when it did not. Everything below (the recorded run, the shadow, the
    // executor, the session proof) must see the same list the plan was built from.
    const planFiles = decision.files;

    // SESS-002 capture, best-effort: a plan that succeeded on every real surface must not be
    // failed by a fixture-recording hiccup on the last one. `fixturePack` stays `null` and
    // session-proof.mjs's `fixture` field reports the gap honestly rather than this method
    // throwing over something that changes no product behaviour.
    let fixturePack = null;
    try {
      fixturePack = await provider.fixtures(runId);
    } catch {
      fixturePack = null;
    }

    // ── Stage 9b · AUTHORING (`16` §3.3) ────────────────────────────────────────────────
    //
    // After the blast radius, before the expectation is checked against anything real, and
    // long before authorisation: what is promoted must be a MEASURED result, so the bytes have
    // to exist by the time anyone is asked to approve them.
    //
    // Everything here is best-effort in one specific sense and not in another: a model that is
    // down, refuses, or answers with prose must not destroy a plan that is otherwise correct —
    // the plan is still a plan, and the run says plainly that nothing was written. What is NOT
    // best-effort is silence: `authoring` is always on the answer, with a reason when it is
    // empty. `null` would let a shell show "3 files" without saying whether anything was
    // written, which is the exact shape of the gap `16` §1 measured.
    // The authoring HAPPENS here — before the plan is recorded, because the bytes must exist
    // by the time anyone is asked to approve them — but it is not WRITTEN to the ledger until
    // the run has a root. Found by executing, not by reading: recording it here with a null
    // causation made authoring the root of the correlation, and `workspace_action.planned` was
    // then refused as a second root (`events.mjs`, `SECOND_ROOT`). The ledger was right and the
    // order was wrong: the plan is what this run IS, and the authoring is caused by it.
    // Phase 7 (`CE-010`): the divergence profile, computed HERE — after the plan has settled
    // which files it touches, and BEFORE the Author is asked for a single byte.
    //
    // The order is the whole point, and it is what `16` §3.2 rule 6 states: invention II is not
    // for judging a diff afterwards, it is for writing one that resembles the diffs this
    // repository has already accepted. Computed after the fact it would be a critic; computed
    // here it is an instruction.
    //
    // Never fatal. A workspace with no git history, a shallow clone, a directory that is not a
    // repository at all — each is a real installation and each still gets a plan. What it does
    // not get is a profile invented to fill the field: `available:false` carrying the reason,
    // the same posture `simulate` takes with `supported:false`.
    let divergence = { available: false, reason: null, signals: [], basis: null };
    try {
      const profiled = await this.#profileChange(this.#workspaceRoot, planFiles.map((file) => file.path));
      divergence = { available: true, reason: null, signals: profiled.signals, basis: profiled.basis };
    } catch (error) {
      if (!(error instanceof DivergenceUnavailable)) throw error;
      divergence = { available: false, reason: error.reason ?? error.message, signals: [], basis: null };
    }

    // `D-0345`. The adopted skills, resolved BEFORE the Author is called, because a skill
    // that arrives after the writing is a skill that did nothing. Never fatal: a resolver
    // that throws must not cost the operator their plan, so it degrades to "no skills" and
    // says why on the run — the same posture the divergence profile takes just above.
    let composedSkills = [];
    let skillComposition = { composed: 0, skills: [], reason: null };
    try {
      const resolved = this.#skillsFor({ actor, conversationId }) ?? [];
      composedSkills = Array.isArray(resolved) ? resolved : [];
      skillComposition = {
        composed: composedSkills.length,
        skills: composedSkills.map((skill) => ({
          id: skill.id,
          name: skill.name ?? skill.id,
          // The size, never the body. A run record that carried instructions would put the
          // thing `searchCatalog` refuses to return into the event ledger by the back door.
          instructionBytes: Buffer.byteLength(String(skill.instructions ?? ''), 'utf8'),
        })),
        reason: null,
      };
    } catch (error) {
      composedSkills = [];
      skillComposition = { composed: 0, skills: [], reason: error?.reason ?? error?.message ?? String(error) };
    }

    let authoring = { available: false, reason: Author.NO_MODEL_REASON, authored: 0 };
    let authoringEvent = null;
    const authoredContents = new Map();
    if (this.#author?.available) {
      try {
        const result = await this.#author.author({
          goal: intent.goal,
          step: plan.steps?.[0]?.description ?? intent.goal,
          files: planFiles,
          // Rule 6 of `16` §3.2, and the reason the profile is computed above rather than
          // beside the diff: the Author writes WITH the repository's conventions in hand.
          profile: divergence.signals,
          // And, from `D-0345`, with the operator's adopted skills in hand as well.
          skills: composedSkills,
        });
        for (const [path, body] of result.contents) authoredContents.set(path, body);
        authoring = {
          available: true, reason: null,
          ...result.summary,
          novelty: result.novelty,
          unchangedPaths: result.unchanged,
          refusals: result.refusals,
          // Phase 6 (`D-0312`): who actually wrote these bytes when ATOM was asked for and
          // could not be reached. `[]` is "nothing degraded", and it is always present — a
          // field that appears only on failure is a field a shell learns to ignore.
          degradations: result.degradations ?? [],
          // Rule 1 of `16` §3.2, reported and not merely obeyed: a path the model tried to
          // name is on the answer, so "it never widens the set" is a claim with a number
          // beside it instead of a sentence in a comment.
          discarded: result.discarded,
        };
        authoringEvent = ['workspace_action.authored', {
          authored: result.summary.authored, unchanged: result.summary.unchanged,
          refused: result.summary.refused, discardedPaths: result.summary.discardedPaths,
          novelty: result.novelty, digest: result.summary.digest,
          // The fixtures themselves, not a count: `CE-006` asks for the session to be
          // re-runnable, and a ledger line saying "there were three" replays nothing.
          //
          // `D-0597`: nor did the fixtures, until the line below existed. They carried five
          // digests and no bytes, so they could CHECK a call somebody re-executed by other
          // means and could not re-execute one — a verification record wearing the name of a
          // replay record. The bytes now live in a content-addressed store keyed by the digests
          // the fixture already carried, so this ledger line is byte-for-byte what it was and
          // the record became resolvable. `result.calls` is a separate array precisely so that
          // no future field of it can drift onto this line.
          fixtures: result.fixtures,
        }];
        // Persisted after the event is composed, never before: a store write that fails must
        // not lose the authoring itself. The failure is recorded where the operator sees it,
        // and the fixtures stay honest about what can be replayed — `replayAuthoredCall`
        // answers UNRESOLVABLE for a call whose bytes did not make it to disk, rather than
        // reporting a faithful replay of something nobody kept.
        try {
          for (const call of result.calls ?? []) {
            this.#authoringReplayStore.put(call.prompt ?? '');
            if (call.answer !== null && call.answer !== undefined) this.#authoringReplayStore.put(call.answer);
          }
        } catch (error) {
          this.#damagedRuns.push({ file: 'authoring-replay', reason: `could not record the model calls of ${runId}: ${error.message}` });
        }
      } catch (error) {
        if (!(error instanceof AuthoringUnavailable) && !(error instanceof AuthoringRefused)) throw error;
        authoring = { available: true, reason: error.reason, authored: 0, failed: true };
        authoringEvent = ['workspace_action.authoring_failed', { reason: error.reason }];
      }
    }

    const rootEventId = this.#record(runId, null, actor, 'workspace_action.planned', {
      goal: intent.goal, files: planFiles.map((file) => file.path), risk: risk.overall, provenance,
      // In the ledger, not only in the answer. Whether the files were chosen by a person or
      // found by a search is part of what an auditor is reading this line to learn, and a
      // record that omits it cannot be asked the question later.
      grounding,
    }, nowUnix);
    // Now that the run has a root, the stage-9b line can hang off it with a real causation.
    if (authoringEvent) this.#record(runId, rootEventId, actor, authoringEvent[0], authoringEvent[1], nowUnix);
    // `D-0312` asks for two things and phase 6 delivered one: the degradation is DECLARED, but
    // «la frequenza delle cadute va misurata» needs it to survive the request that observed it.
    // A run-scoped field answers "did this session degrade"; only a ledger line can answer "how
    // often", which is the question an operator actually has. Written once per run, carrying the
    // whole summary, so the aggregation reads events instead of re-deriving anything.
    const runDegradation = degradationSummary({ reasoning: reasoningDegradations, authoring: authoring.degradations ?? [] });
    if (runDegradation.degraded) {
      this.#record(runId, rootEventId, actor, 'workspace_action.degraded', {
        provider: runDegradation.provider,
        requestedProvider: runDegradation.requestedProvider,
        surfaces: [...runDegradation.surfaces],
        authoredPaths: [...runDegradation.authoredPaths],
        reasons: [...runDegradation.reasons],
        events: runDegradation.events.length,
        firstAtUnix: runDegradation.firstAtUnix,
        lastAtUnix: runDegradation.lastAtUnix,
      }, nowUnix);
    }
    this.#runs.set(runId, {
      runId, status: 'PENDING_APPROVAL',
      // The owning conversation, or `null` for a run nobody opened from a chat. Stored on the
      // RUN and never recomputed: `runsFor()` below reads this field and only this field, so
      // there is exactly one answer in the product to "which chat does this work belong to".
      conversationId,
      plan, expectation, files: planFiles, intent, hypotheses, risk, confidence, claims, provenance, grounding,
      // Phase 6: kept on the RUN, because the Session Proof is assembled from the run long
      // after the router that made these records has gone out of scope.
      reasoningDegradations,
      divergence,
      // `D-0345`. Which adopted skills reached the Author for THIS run, by id and size.
      // Always present, `composed: 0` included: a field that appears only when something
      // happened is a field a shell learns to stop reading.
      skillComposition,
      createdAtUnix: nowUnix, planEventId: rootEventId, actor,
      // SESS-001 fixture material: the exact inputs to the decision layer. `files` above
      // already carries full contents, which is why it is not duplicated here.
      request, projectRules, constraints, mode, policy,
      // Stage 9b output. The map belongs to the RUN, not to the caller: `approve()` reads it,
      // and nothing between here and there can add a key the Plan had not settled on.
      authoredContents, authoring,
      egressSamples: [this.#sampleEgress('planned', nowUnix)].filter(Boolean),
      // SESS-002: the captured replay pack, `null` when capture failed or nothing routed
      // externally for `fixtures` itself — session-proof.mjs and replay() both read this.
      fixturePack,
    });
    // `status` is returned, not left for the caller to assume. It was missing until phase 5
    // of CodeN Evolution, and BOTH shells filled the hole the same way: the browser stitched
    // `{...planned, status:'PENDING_APPROVAL'}` onto the answer, the terminal printed the
    // constant `status: PENDING_APPROVAL` — each showing, as the engine's word, a state the
    // engine had never said. It happened to be true, which is what made it invisible; the day
    // a mode plans into any other state, two clients would have gone on reporting this one.
    // Read off the stored run, so it cannot say something the run does not.
    // `grounding` is returned, not left to be inferred from the plan's file list. A shell
    // showing "3 files" without saying they were derived invites the operator to read them as
    // a choice somebody made. `null` when the caller named the files, which is the honest
    // value: nothing was derived.
    // `authoring` is returned, never left to be inferred. A shell that shows a plan without
    // saying whether the product wrote anything invites the operator to read paths as content,
    // which is exactly how the missing Author went unnoticed through five phases.
    // Phase 6: `reasoning` is on the answer for the same reason `authoring` is — a shell that
    // has to infer degradation from a provenance list is a shell that will not, and the
    // product would be back to falling back in silence with the evidence technically present.
    // The frequency rides on the SAME answer as the degradation, deliberately: a second route
    // would be a second question, and the two shells would ask it at different moments and show
    // different numbers for one session. Computed after the ledger line above, so a run that
    // degraded counts itself.
    // D-0338: written through the moment the run exists, BEFORE the answer goes back. A
    // caller told a run was created must not be contradicted by a restart a second later.
    this.#saveRun(runId);
    const reasoning = Object.freeze({ ...runDegradation, frequency: this.degradationFrequency() });
    // `conversationId` is read off the stored run for the same reason `status` is: a shell that
    // stitches the link it just sent onto the answer would show its own input as the engine's
    // word, and the day the engine declines to keep it the shell would go on displaying it.
    return { runId, status: this.#runs.get(runId).status, conversationId: this.#runs.get(runId).conversationId, plan, intent, expectation, risk, confidence, claims, provenance, grounding, authoring, reasoning, divergence, skillComposition };
  }

  /**
   * What would this plan do — asked before anything is approved, and answered without minting
   * a token, without spending one, and without executing anything.
   *
   * `02_ATOM.md` marks `simulate` the contract's only optional surface and calls it the reason
   * to have an external provider at all. The reference provider answers `supported: false`,
   * which is a real answer and is reported as one: this route never invents a prediction.
   *
   * The shadow is materialised read-only for the question and discarded in `finally`, exactly
   * as `approve()` does — a prediction must not leave scratch space behind, and must not be
   * the thing that changes the workspace it is predicting about.
   */
  async simulate({ runId, actor, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending run \`${runId}\``);
    if (run.status !== 'PENDING_APPROVAL') {
      refuse('ALREADY_DECIDED', `run \`${runId}\` is already ${run.status}; a simulation of a decided run would predict a past that already happened`);
    }

    const provider = this.#reasoningFor();
    const shadowRoot = join(this.#shadowsRoot, `${runId}-simulate`);
    const shadow = ShadowWorkspace.ofWorkspace(this.#workspaceRoot, shadowRoot);
    try {
      let outcome;
      try {
        outcome = await provider.simulate(run.plan, shadow.root);
      } catch (error) {
        if (error instanceof ReasoningRefused) refuse('SIMULATION_REFUSED', error.reason);
        throw error;
      }
      this.#record(runId, run.planEventId, actor, 'workspace_action.simulated', {
        supported: outcome?.supported === true,
        predictedPaths: Array.isArray(outcome?.predictedDiff) ? outcome.predictedDiff.length : 0,
        provenance: provider.provenance(),
      }, nowUnix);
      return {
        runId,
        // Carried through unchanged rather than reshaped: `supported: false` is the reference
        // provider's honest answer and must not be flattened into an empty prediction.
        simulation: outcome,
        provenance: provider.provenance(),
        // Stated so a reader never has to infer it from an absence.
        executed: false,
      };
    } finally {
      shadow.discard();
    }
  }

  /**
   * `D-0567`, closing `CE-008` — *«l'ombra precede l'autorizzazione: nessun dialogo di
   * autorizzazione senza risultato misurato»*.
   *
   * # Why this exists as a separate call, and why the naive fix does not work
   *
   * Until now `approve()` did everything: authorise, mint, execute into a shadow, compare,
   * promote. The person therefore authorised a *description* and the bytes were produced
   * afterwards — measured, recorded `❌`, and the only `❌` in the acceptance register.
   *
   * "Just execute at plan() time" is circular: `execute()` refuses without a token, a token is
   * minted only from an authorised plan, and an authorisation needs a human. The resolution is
   * **two authorisations of two different things**:
   *
   *   measure()  the actor authorises a run IN A SHADOW. Nothing can reach the workspace from
   *              here — `#promote` is not called and the token minted here is never handed to
   *              it. Its purpose is recorded on the grant so the two can never be confused.
   *   approve()  the approver authorises THE CHANGE, against the result `measure()` produced,
   *              and mints the token whose spends `#promote` consumes file by file.
   *
   * This strengthens `CE-001` rather than weakening it: the workspace mutation now spends a
   * token of its own instead of inheriting the one spent to write into the shadow.
   *
   * The shadow is **kept** between the two calls, in memory only. A process restart therefore
   * loses it, which is stated rather than discovered: `approve()` refuses a run whose
   * measurement is gone and `measure()` will run again on it.
   */
  measure({ runId, actor, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending run \`${runId}\``);
    if (!String(actor ?? '').trim()) refuse('NO_ACTOR', 'a measurement with no actor names nobody accountable');
    // Re-measuring a run whose shadow the process lost is the recovery path, not an error.
    const remeasuring = run.status === 'MEASURED' && !this.#shadows.has(runId);
    if (run.status !== 'PENDING_APPROVAL' && !remeasuring) {
      refuse('ALREADY_DECIDED', `run \`${runId}\` is already ${run.status}`);
    }

    // A grant that says what it is for. `authorizePlan` does not read `purpose` — it is carried
    // so that the ledger, and anyone reading a token's provenance, can tell a measurement from
    // an approval without inferring it from timing.
    const grant = { approverId: actor, grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + APPROVAL_TTL_SECONDS, purpose: 'MEASUREMENT' };
    let authorized;
    try {
      authorized = authorizePlan(run.plan, grant, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) refuse('NOT_AUTHORIZED', error.reason);
      throw error;
    }
    const measureEventId = this.#record(runId, run.planEventId, actor, 'workspace_action.measuring',
      { actor, purpose: 'MEASUREMENT' }, nowUnix);

    const step = run.plan.steps[0];
    let token;
    try {
      token = this.#minter.mint(authorized, {
        stepId: step.id, paths: step.files, operations: ['WRITE'],
        uses: step.files.length, expiresAtUnix: grant.expiresAtUnix,
      }, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) {
        this.#record(runId, measureEventId, actor, 'capability.denied',
          { stepId: step.id, paths: step.files, kind: error.kind, reason: error.reason, purpose: 'MEASUREMENT' }, nowUnix);
        refuse('MINT_REFUSED', error.reason);
      }
      throw error;
    }
    this.#record(runId, measureEventId, actor, 'capability.minted',
      { tokenId: token.id, paths: token.paths, operations: token.operations, purpose: 'MEASUREMENT' }, nowUnix);
    run.egressSamples.push(...[this.#sampleEgress('measuring', nowUnix)].filter(Boolean));

    // Any shadow left by a previous measurement of this run goes first: two whole-workspace
    // copies of one run under one root is scratch space nobody is accounting for.
    this.#dropShadow(runId);
    const shadow = ShadowWorkspace.ofWorkspace(this.#workspaceRoot, join(this.#shadowsRoot, runId));
    let kept = false;
    try {
      const actions = run.files.map((file) => ({ kind: 'WRITE', path: file.path, contents: run.authoredContents?.get(file.path) ?? file.contents }));
      const result = execute({ authorized, minter: this.#minter, tokens: [token], shadow, actions, expectation: run.expectation, tests: [], nowUnix, executeSandbox: this.#executeSandbox });
      const executeEventId = this.#record(runId, measureEventId, actor, 'executor.ran',
        { performed: result.performed, refused: result.refused, ok: result.ok }, nowUnix);
      this.#record(runId, executeEventId, actor, 'shadow.compared',
        { clean: result.surprise?.clean ?? null, unexpected: result.surprise?.unexpected ?? null }, nowUnix);

      // The recompute verifier runs here, on the shadow's post-execution content, because this
      // is where that content now exists — and its answer is part of what the approver reads.
      const claimResults = verifyClaims(run.claims ?? [], shadow.root);
      const coverage = projectionCoverage(claimResults);
      this.#record(runId, executeEventId, actor, 'workspace_action.claims_verified',
        { declaration: coverage.declaration, total: coverage.total, recomputed: coverage.recomputed, contradicted: coverage.contradicted.length }, nowUnix);

      const diff = this.#diff(shadow, result);
      const clean = result.ok && coverage.contradicted.length === 0;

      run.status = 'MEASURED';
      run.result = result;
      run.diff = diff;
      run.coverage = coverage;
      run.measurement = { clean, measuredAtUnix: nowUnix, measuredBy: actor, eventId: measureEventId };
      this.#shadows.set(runId, shadow);
      kept = true;
      this.#saveRun(runId);
      this.#record(runId, executeEventId, actor, 'workspace_action.measured',
        { clean, files: result.outcomes.filter((o) => o.performed).map((o) => o.path) }, nowUnix);
      return { runId, status: 'MEASURED', result, diff, coverage, clean, promoted: false };
    } finally {
      // Discarded on any path that did not hand it to `#shadows`, so a throw cannot leave a
      // whole-workspace copy behind.
      if (!kept) shadow.discard();
    }
  }

  /** Drops a kept shadow if there is one. Safe to call when there is not. */
  #dropShadow(runId) {
    const shadow = this.#shadows.get(runId);
    if (!shadow) return;
    this.#shadows.delete(runId);
    try { shadow.discard(); } catch { /* scratch space; a failure to remove it must not mask the caller's outcome */ }
  }

  /**
   * The human decision, taken **against a measured result** rather than against a description.
   * Mints the token whose spends `#promote` consumes, and promotes the shadow `measure()`
   * already produced — it never re-executes, so what is promoted is exactly what was shown.
   */
  approve({ runId, approverId, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending run \`${runId}\``);
    if (run.status === 'PENDING_APPROVAL') {
      // `CE-008`. This refusal is the criterion: an approval dialogue may not be answered on a
      // run whose consequences nobody has measured.
      refuse('NOT_MEASURED', `run \`${runId}\` has not been measured: call measure() first — an approval without a measured result is what CE-008 forbids`);
    }
    if (run.status !== 'MEASURED') refuse('ALREADY_DECIDED', `run \`${runId}\` is already ${run.status}`);
    if (!String(approverId ?? '').trim()) refuse('NO_APPROVER', 'an approval with no approver names nobody accountable');
    const shadow = this.#shadows.get(runId);
    if (!shadow) {
      refuse('MEASUREMENT_LOST', `the shadow for run \`${runId}\` is gone (the process restarted): measure() it again — promoting a result nobody can still see would be an approval of a description`);
    }

    const approval = { approverId, grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + APPROVAL_TTL_SECONDS, purpose: 'CHANGE' };
    let authorized;
    try {
      authorized = authorizePlan(run.plan, approval, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) refuse('NOT_AUTHORIZED', error.reason);
      throw error;
    }
    const approveEventId = this.#record(runId, run.measurement?.eventId ?? run.planEventId, approverId,
      'workspace_action.approved', { approverId, against: 'MEASURED' }, nowUnix);

    const step = run.plan.steps[0];
    let token;
    try {
      token = this.#minter.mint(authorized, {
        stepId: step.id, paths: step.files, operations: ['WRITE'],
        uses: step.files.length, expiresAtUnix: approval.expiresAtUnix,
      }, nowUnix);
    } catch (error) {
      if (error instanceof CapabilityError) {
        // SESS-001 "autorità": a denial is part of the authority timeline, not only a thrown
        // error the caller happens to see.
        this.#record(runId, approveEventId, approverId, 'capability.denied',
          { stepId: step.id, paths: step.files, kind: error.kind, reason: error.reason, purpose: 'CHANGE' }, nowUnix);
        refuse('MINT_REFUSED', error.reason);
      }
      throw error;
    }
    this.#record(runId, approveEventId, approverId, 'capability.minted',
      { tokenId: token.id, paths: token.paths, operations: token.operations, purpose: 'CHANGE' }, nowUnix);
    run.egressSamples.push(...[this.#sampleEgress('approved', nowUnix)].filter(Boolean));

    try {
      const result = run.result;
      const coverage = run.coverage;
      let promoted = false;
      let backups = null;
      // Unchanged rule, moved: a clean path/test comparison is not enough on its own if a
      // declared claim was recomputed and found false. Coverage gaps do not block promotion.
      if (run.measurement?.clean) {
        backups = this.#promote(shadow, result, token, nowUnix);
        promoted = true;
        this.#record(runId, approveEventId, approverId, 'workspace_action.promoted',
          { files: result.outcomes.filter((o) => o.performed).map((o) => o.path) }, nowUnix);
      } else {
        this.#record(runId, approveEventId, approverId, 'workspace_action.refused',
          { reason: result.ok ? 'a declared claim was recomputed and contradicted' : 'the run was not clean; nothing was promoted', surprise: result.surprise, contradicted: coverage.contradicted }, nowUnix);
      }

      run.status = promoted ? 'PROMOTED' : 'REFUSED';
      run.backups = backups;
      run.decidedAtUnix = nowUnix;
      this.#saveRun(runId);
      return { runId, result, diff: run.diff, promoted, coverage };
    } finally {
      this.#dropShadow(runId);
    }
  }

  reject({ runId, approverId, reason, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no pending run \`${runId}\``);
    // `D-0567`: a measured run is rejectable too — that is the whole point of measuring first,
    // and it is the case where a person has the most reason to say no. The shadow goes with it.
    if (run.status !== 'PENDING_APPROVAL' && run.status !== 'MEASURED') {
      refuse('ALREADY_DECIDED', `run \`${runId}\` is already ${run.status}`);
    }
    this.#dropShadow(runId);
    this.#record(runId, run.planEventId, approverId, 'workspace_action.rejected', { reason: reason ?? null }, nowUnix);
    run.status = 'REJECTED';
    run.decidedAtUnix = nowUnix;
    this.#saveRun(runId);
    return { runId, status: 'REJECTED' };
  }

  /** Before/after content per touched file, capped — a diff nobody can read is not a diff. */
  #diff(shadow, result) {
    const entries = [];
    for (const outcome of result.outcomes) {
      if (!outcome.performed) continue;
      const before = readTextIfSmall(contained(shadow.source, outcome.path));
      const after = readTextIfSmall(contained(shadow.root, outcome.path));
      entries.push({
        path: outcome.path, status: result.observation.changed[outcome.path] ?? 'UNKNOWN',
        before: before.available ? before.content : null,
        after: after.available ? after.content : null,
        diffAvailable: before.available && after.available,
      });
    }
    return entries;
  }

  /**
   * Copies only what execute() actually performed, from the shadow to the real workspace —
   * never the other direction. The pre-existing bytes of each real file are captured first,
   * in memory, so a restore can put them back; a file that did not exist before is restored
   * by deleting it, not by writing empty content over it.
   */
  // `D-0567` added `token`/`nowUnix`. Until the split, the only token this run ever spent was
  // the one `execute()` spent to write into the SHADOW, and the promotion — the step that
  // actually mutates the workspace — inherited it. Now the shadow write and the workspace
  // mutation are authorised separately, and this is where the second one is spent: one use per
  // file, BEFORE the file is written, the same spend-before-effect order `executor.mjs` keeps.
  // A refusal here therefore stops the promotion at that file rather than reporting damage.
  #promote(shadow, result, token, nowUnix) {
    const backups = [];
    for (const outcome of result.outcomes) {
      if (!outcome.performed) continue;
      this.#minter.spend(token, { path: outcome.path, operation: 'WRITE' }, nowUnix);
      const realPath = contained(this.#workspaceRoot, outcome.path);
      const shadowPath = contained(shadow.root, outcome.path);
      const existedBefore = existsSync(realPath);
      const beforeContent = existedBefore ? readFileSync(realPath) : null;
      mkdirSync(dirname(realPath), { recursive: true });
      writeFileSync(realPath, readFileSync(shadowPath));
      backups.push({ path: outcome.path, existedBefore, beforeContent });
    }
    return backups;
  }

  /**
   * Writes back exactly what `#promote` captured. Restorable once: a second call finds
   * nothing left to restore and refuses rather than silently doing nothing.
   */
  restore({ runId, actor, nowUnix }) {
    const run = this.#runs.get(runId);
    if (!run) refuse('NOT_FOUND', `no run \`${runId}\``);
    if (run.status === 'RESTORED') refuse('ALREADY_RESTORED', `run \`${runId}\` was already restored at ${run.restoredAtUnix}`);
    if (run.status !== 'PROMOTED') refuse('NOT_PROMOTED', `run \`${runId}\` was never promoted, so there is nothing to restore`);
    for (const backup of run.backups ?? []) {
      const realPath = contained(this.#workspaceRoot, backup.path);
      if (backup.existedBefore) writeFileSync(realPath, backup.beforeContent);
      else if (existsSync(realPath)) unlinkSync(realPath);
    }
    this.#record(runId, run.planEventId, actor, 'workspace_action.restored',
      { files: (run.backups ?? []).map((b) => b.path) }, nowUnix);
    run.status = 'RESTORED';
    run.restoredAtUnix = nowUnix;
    this.#saveRun(runId);
    return { runId, status: 'RESTORED' };
  }
}

export function workspaceActionsStatus() {
  return {
    riskPathsSupported: ['TRIVIAL'],
    operationsSupported: ['WRITE'],
    operationsNotSupported: ['DELETE', 'EXECUTE'],
    testExecution: false,
    testExecutionReason: 'executor.mjs refuses EXECUTE permanently — running a plan-declared command is arbitrary code execution and was deliberately kept out of the executor in step 5. Wiring a test runner is a separate, larger security decision, not built here.',
    filesSuppliedBy: 'caller',
    filesSuppliedByReason: 'the reference reasoning provider has no model and cannot derive a file target from a request written in prose; it says so rather than guessing.',
    approvalRequired: true,
    // `D-0567`, `CE-008`. Two steps where there was one, and the status says so rather than
    // letting a shell discover it from a refusal.
    measurementRequiredBeforeApproval: true,
    measurementRequiredBeforeApprovalReason: 'approve() refuses a run that has not been measured (NOT_MEASURED). measure() authorises a run IN A SHADOW — it mints its own token, executes, compares and recomputes the declared claims, and nothing reaches the workspace from it. The approval is then answered against that result, and mints the SECOND token, whose uses #promote spends one per file before writing it. A shadow is held in memory between the two calls, so a restart loses it: approve() then refuses MEASUREMENT_LOST and measure() can be run again.',
    approvalTtlSeconds: APPROVAL_TTL_SECONDS,
    promotionAllOrNothing: true,
    tokensPerRun: 2,
    tokensPerRunReason: 'one for the shadow run (purpose MEASUREMENT) and one for the change (purpose CHANGE). Before D-0567 the workspace mutation inherited the token spent to write into the shadow; now it spends its own.',
    restoreSupported: true,
    restoreOnce: true,
    runsPersistAcrossRestart: false,
    reason: 'This is the trivial risk path (11_REVISIONE_E_CORREZIONI.md P6): one step, WRITE only. A plan is approved by a human, mints exactly the tokens its declared files need, executes into a whole-workspace shadow, and is promoted to the real workspace only when the comparison came back clean with every action performed. Every step is recorded in the causal event ledger.',
    recomputeVerifier: true,
    recomputeVerifierReason: 'CodeN Evolution construction order step 9 (D-0209): plan() takes an optional `claims` array; approve() recomputes each against the shadow\'s post-execution content (verification.mjs) and gates promotion if any is CONTRADICTED. Coverage gaps (unrecomputed claims — most often behavioural ones, since EXECUTE stays refused) are declared, not blocking.',
    reasoningRouted: true,
    reasoningRoutedReason: 'plan() asks the ReasoningRouter, so a selected external provider is used on the one path that mints a token and touches a real file — not only on the read-only advisory route. Every run records which provider answered which surface (`provenance`). With no external provider configured every surface is the reference one and this path behaves exactly as before.',
    simulationSupported: true,
    simulationSupportedReason: '`simulate` is the contract\'s only optional surface (02_ATOM.md). POST /api/v1/workspace-actions/{runId}/simulate materialises a shadow, asks the selected provider what the plan would do, and discards the shadow — no token is minted and nothing is executed. The reference provider answers `supported: false`, which is reported as given and never flattened into an empty prediction.',
    simulationCrossProcessLimit: 'The frozen contract passes the shadow as a PATH, so a provider in another process predicts nothing unless it can read that directory. The installed daemon has no mount onto the shadow root: routed there it refuses, and the refusal is reported as a refusal. Sharing the shadow root is a mount change, named here rather than left to be discovered.',
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reference reasoning provider, in the runtime that actually ships.
//
// The Rust crate `noesar-reasoning-reference` is the canonical candidate and is not
// compiled into the image — exactly the position `authority.mjs` already puts the Rust
// authority daemon in, with `reference-node` running and `rust-external` available but not
// configured. This module is the Node half of the same arrangement, so that
// FOSS_CORE_DEPENDS_ON_ATOM = false is true of the product a person installs and not only
// of a crate in the repository.
//
// Two implementations of one contract drift the moment only one of them has a test.
// `conformance/reasoning-vectors.json` is the shared oracle, and both sides run it.
//
// It has no model, and the tempting failure is confident-looking output: a paraphrased
// goal, a hypothesis with no evidence, a plausible confidence. That output is
// indistinguishable from a real answer until it is acted on. Everything here is derived
// from its input, and where it cannot derive it says so.

import { createHash } from 'node:crypto';

export const REASONING_CONTRACT_VERSION = '1.0.0';

export const ReasoningMode = Object.freeze({
  REFERENCE_NODE: 'reference-node',
  RUST_EXTERNAL: 'rust-external',
});

export const MANDATORY_SURFACES = Object.freeze([
  'interpret', 'hypothesize', 'plan', 'decompose', 'expect', 'constrain',
  'classify', 'confidence', 'evidence', 'cancel', 'fixtures',
]);

export const NO_MODEL_REASON =
  'reference provider: derived from the request and the plan, with no reasoning model';

const MAX_VERIFIABLE_FILES = 3;
const CONFIDENCE_CEILING = 0.6;

const VAGUE = [
  'etc', 'and so on', 'as needed', 'appropriate', 'properly', 'somehow',
  'various', 'several', 'et cetera', 'whatever',
];

export class ReasoningRefused extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ReasoningRefused';
    this.reason = reason;
  }
}

function refuse(reason) {
  throw new ReasoningRefused(reason);
}

export class ReferenceReasoningProvider {
  #workspaceRoot;

  constructor(workspaceRoot = '/workspace') {
    this.#workspaceRoot = workspaceRoot;
  }

  identity() {
    return {
      name: 'reference',
      version: REASONING_CONTRACT_VERSION,
      contractVersion: REASONING_CONTRACT_VERSION,
      supportsSimulation: false,
    };
  }

  // Length-delimited, for the same reason the Rust side is: without it ['ab','c'] and
  // ['a','bc'] hash alike and two sessions could mint one fixture id.
  #digest(parts) {
    const hash = createHash('sha256');
    for (const part of parts) {
      hash.update(part, 'utf8');
      const length = Buffer.alloc(8);
      length.writeBigUInt64LE(BigInt(Buffer.byteLength(part, 'utf8')));
      hash.update(length);
    }
    return hash.digest('hex');
  }

  // Named, never resolved. Guessing which reading was meant is the model-shaped work this
  // provider does not do.
  #ambiguities(request) {
    const lowered = request.toLowerCase();
    const found = VAGUE
      .filter((term) => lowered.includes(term))
      .map((term) => `\`${term}\` does not name what is included`);
    if (!request.includes('.') && request.trim().split(/\s+/).length > 25) {
      found.push('the request is one long sentence with no stated boundary');
    }
    return found;
  }

  // Textual containment is not path resolution. `..` counts as leaving, because a provider
  // that cannot resolve symlinks must not claim a path is contained.
  #insideWorkspace(path) {
    if (path.includes('..')) return false;
    if (path.startsWith('/') || path.includes(':\\')) return path.startsWith(this.#workspaceRoot);
    return true;
  }

  blastRadius(files, destructive) {
    return {
      paths: [...files],
      reachesOutsideWorkspace: files.some((path) => !this.#insideWorkspace(path)),
      destructive: Boolean(destructive),
    };
  }

  #riskOf(step) {
    if (step.blastRadius.reachesOutsideWorkspace) return 'CRITICAL';
    if (step.blastRadius.destructive) return 'HIGH';
    if (step.commands.length === 0) return 'LOW';
    return 'MODERATE';
  }

  interpret(request, projectRules = []) {
    const trimmed = String(request ?? '').trim();
    if (!trimmed) refuse('an empty request has no intent to interpret');
    // Quoted, not paraphrased: a paraphrase without a model is a guess wearing the shape of
    // an understanding.
    const goal = trimmed.split(/[.\n]/).map((part) => part.trim()).find(Boolean) ?? trimmed;
    return {
      goal,
      nonGoals: [...projectRules],
      successCriteria: [
        "the plan's every step completed",
        'the expectation of the plan met with no surprise',
      ],
      ambiguities: this.#ambiguities(trimmed),
    };
  }

  hypothesize(intent, gathered = []) {
    const supporting = gathered.filter((item) => item?.kind === 'SUPPORTED');
    // One hypothesis, and it is the only one this provider can stand behind. NOT_SOUGHT says
    // out loud that nothing looked for a counter-example, which is not the same as having
    // looked and found none.
    return [{
      statement: `the stated goal is reachable as written: ${intent.goal}`,
      supporting,
      contrary: 'NOT_SOUGHT',
    }];
  }

  plan(chosen, constraints = [], mode = 'safe') {
    if (!Array.isArray(chosen) || chosen.length === 0) {
      refuse('no hypothesis was chosen, so there is nothing to plan for');
    }
    const steps = chosen.map((hypothesis, index) => ({
      id: `step-${index + 1}`,
      description: hypothesis.statement,
      files: [],
      commands: [],
      dependsOn: index === 0 ? [] : [`step-${index}`],
      blastRadius: this.blastRadius([], false),
    }));
    return this.buildPlan(steps, constraints, mode);
  }

  // The contract's Plan invariants, enforced here rather than trusted: a dependency may only
  // name an earlier step, which makes a cycle unrepresentable instead of merely detected.
  buildPlan(steps, constraints = [], mode = 'safe') {
    if (!Array.isArray(steps) || steps.length === 0) {
      refuse('a plan with no step authorises nothing and must not be minted');
    }
    const seen = [];
    for (const step of steps) {
      if (!step.id || !String(step.id).trim()) {
        refuse('a step without an id cannot be referenced or audited');
      }
      if (seen.includes(step.id)) refuse(`duplicate step id \`${step.id}\``);
      for (const dependency of step.dependsOn ?? []) {
        if (!seen.includes(dependency)) {
          refuse(`step \`${step.id}\` depends on \`${dependency}\`, which is not an earlier step`);
        }
      }
      seen.push(step.id);
    }
    return { steps, constraints: [...constraints], mode };
  }

  decompose(step) {
    if (step.files.length <= MAX_VERIFIABLE_FILES && step.commands.length <= 1) {
      return { split: false, steps: [] };
    }
    const parts = [];
    for (let index = 0; index * MAX_VERIFIABLE_FILES < step.files.length; index += 1) {
      const chunk = step.files.slice(index * MAX_VERIFIABLE_FILES, (index + 1) * MAX_VERIFIABLE_FILES);
      parts.push({
        id: `${step.id}-${index + 1}`,
        description: `${step.description} (${chunk.length} of the files)`,
        files: chunk,
        commands: step.commands[index] ? [step.commands[index]] : [],
        dependsOn: index === 0 ? [] : [`${step.id}-${index}`],
        blastRadius: this.blastRadius(chunk, step.blastRadius.destructive),
      });
    }
    // A step with many commands but few files still has to split, or the guard above would
    // call it verifiable when nothing could attribute a failure.
    if (parts.length < 2) {
      return {
        split: true,
        steps: step.commands.map((command, index) => ({
          id: `${step.id}-${index + 1}`,
          description: `${step.description}: ${command}`,
          files: [...step.files],
          commands: [command],
          dependsOn: index === 0 ? [] : [`${step.id}-${index}`],
          blastRadius: step.blastRadius,
        })),
      };
    }
    return { split: true, steps: parts };
  }

  expect(plan) {
    const paths = [];
    const tests = [];
    for (const step of plan.steps) {
      for (const path of step.files) if (!paths.includes(path)) paths.push(path);
      for (const command of step.commands) {
        if (command.includes('test') && !tests.includes(command)) tests.push(command);
      }
    }
    if (paths.length === 0 && tests.length === 0) {
      refuse('the plan names no file and no test, so nothing about it could turn out to be false');
    }
    return {
      testsExpectedToPass: tests,
      testsExpectedToFail: [],
      pathsTheDiffMustTouch: paths,
    };
  }

  constrain(plan, policy) {
    const restrictive = policy !== 'permissive';
    const kept = [];
    const removed = [];
    for (const step of plan.steps) {
      const refuseStep = step.blastRadius.reachesOutsideWorkspace
        || (restrictive && step.blastRadius.destructive);
      if (refuseStep) {
        removed.push(step.id);
        continue;
      }
      // A kept step whose prerequisite was dropped would be authorised to run against a
      // state that was never produced.
      if ((step.dependsOn ?? []).some((id) => removed.includes(id))) {
        removed.push(step.id);
        continue;
      }
      kept.push({ ...step, dependsOn: (step.dependsOn ?? []).filter((id) => !removed.includes(id)) });
    }
    if (kept.length === 0) {
      return {
        refused: true,
        reason: `every step of the plan is refused under policy \`${policy}\`: ${removed.length} step(s) reach outside the workspace or are destructive`,
      };
    }
    return { refused: false, plan: this.buildPlan(kept, plan.constraints, plan.mode), removed };
  }

  classify(plan) {
    const order = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
    const perStep = plan.steps.map((step) => [step.id, this.#riskOf(step)]);
    // The plan is as risky as its worst step. Averaging would let one critical step hide
    // behind nine harmless ones.
    const overall = perStep.reduce(
      (worst, [, risk]) => (order.indexOf(risk) > order.indexOf(worst) ? risk : worst),
      'LOW',
    );
    return { perStep, overall };
  }

  confidence(plan, results = []) {
    const reasons = [NO_MODEL_REASON];
    const steps = plan.steps.length;
    const unverified = plan.steps.filter((step) => step.commands.length === 0).length;
    if (unverified > 0) {
      reasons.push(`${unverified} of ${steps} step(s) carry no command, so nothing would observe whether they worked`);
    }
    if (results.length === 0) reasons.push('no result has been observed yet');
    // Never certainty. The ceiling is deliberate and the number falls as the reasons
    // accumulate, rather than being asserted independently of them.
    const value = Math.max(CONFIDENCE_CEILING - 0.1 * (reasons.length - 1), 0.1);
    return { value, reasonsNotHigher: reasons };
  }

  evidence(claim) {
    if (!String(claim ?? '').trim()) refuse('an empty claim has nothing to support');
    // No corpus is read, so no source can be offered — said, rather than returned as an
    // empty source list that would read as "supported".
    return {
      kind: 'UNSUPPORTED_INFERENCE',
      rationale: `the reference provider holds no corpus and did not read anything to support: ${claim}`,
    };
  }

  cancel(plan) {
    return {
      checkpointId: this.#digest(plan.steps.map((step) => step.id)),
      resumable: true,
      completedSteps: [],
    };
  }

  fixtures(sessionId) {
    if (!String(sessionId ?? '').trim()) refuse('a replay pack needs the session it replays');
    const entries = [
      `provider=${this.identity().name}`,
      `contract=${REASONING_CONTRACT_VERSION}`,
      `workspace=${this.#workspaceRoot}`,
    ];
    return { sessionId, digest: this.#digest([sessionId, ...entries]), entries };
  }

  simulate() {
    // Declared unsupported rather than answered with an empty prediction that would read
    // like a successful one.
    //
    // The shape is the one a provider that *does* simulate returns, so a caller reads one
    // shape either way and branches on `supported` rather than on which provider it got.
    // The earlier `{ supported, surface }` forced every consumer to know two shapes, and a
    // consumer that only ever met this provider would have been written against the wrong one.
    return { supported: false, predictedDiff: [], predictedResult: null, executed: false };
  }
}

export function reasoningStatus(env = process.env) {
  const mode = String(env.NOESAR_REASONING_MODE ?? ReasoningMode.REFERENCE_NODE).toLowerCase();
  const endpoint = env.NOESAR_RUST_REASONING_ENDPOINT ?? null;
  const recognized = Object.values(ReasoningMode).includes(mode);
  return {
    mode,
    recognized,
    contractVersion: REASONING_CONTRACT_VERSION,
    mandatorySurfaces: [...MANDATORY_SURFACES],
    simulationSupported: false,
    rustCandidateSourceImplemented: true,
    rustCandidateCompiled: false,
    externalEndpointConfigured: Boolean(endpoint),
    // The whole point, stated where a person can read it rather than inferred from the
    // absence of an error.
    atomRequired: false,
    confidenceCeiling: CONFIDENCE_CEILING,
    reason: mode === ReasoningMode.REFERENCE_NODE
      ? 'The reference provider derives every answer from its input and holds no model; it never reaches certainty and never claims a source it did not read.'
      : 'An external reasoning provider is selected; the reference provider remains available and the core does not depend on it being reachable.',
  };
}

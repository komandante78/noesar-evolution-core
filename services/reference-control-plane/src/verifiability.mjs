// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What makes a plan step verifiable on its own — the criteria, in the open core.
//
// # Why this lives here and not in a provider
//
// `CE-023` asked for the value of an external provider to be *measured*. The first attempt
// measured projection coverage and returned `NO_DIFFERENCE`, for a reason that was a property
// of the metric and not of the providers: coverage asks whether an expectation names a step's
// files, and every provider puts a step's files in the paths the diff must touch. The metric
// could not distinguish because it measured something both already satisfied by construction.
//
// The difference between a size-based splitter and a verifiability-based one is in the SHAPE
// of what comes back, so the shape is what this module judges. Putting the criteria in the
// core rather than in a provider is the whole posture of `CLAUDE10.md` §14 rule 55: the core
// states what it wants, any implementation may satisfy it, and the yardstick belongs to
// nobody's implementation. A criterion that lived inside the provider being judged would be
// that provider marking its own work.
//
// # The line this module does not cross
//
// It **detects** the reasons a step cannot be checked as one unit. It does not split, and it
// holds no strategy for splitting — no grouping order, no dependency construction, no
// budget. That is a provider's work and stays there. Detection is specification; splitting is
// implementation.
//
// # The five reasons, each removing one way a reviewer could not say "this part passed"
//
// They are not a size heuristic wearing five hats. A size-only splitter yields parts that are
// smaller and still unverifiable: a delete and a write sharing one authorisation, or files
// from two suites where passing one says nothing about the other.
//
// # A sixth kind of gap, not in `firstViolation`
//
// `dependencyIntegrity`, below, judges the decomposition as a set rather than one part at a
// time: whether every `dependsOn` resolves to another part actually returned. A part cannot
// see the rest of the decomposition, so this could never have been a sixth entry in
// `firstViolation` — it is a property of the graph, not of a node.

/** Above this, a part stops being reviewable in one sitting. Chosen, not derived. */
export const MAX_FILES_PER_PART = 4;

export const Violation = Object.freeze({
  /** Part inside the workspace and part outside: these need different authorisations. */
  MIXED_RADIUS: 'MIXED_RADIUS',
  /** A destructive step over several files cannot be checkpointed per target, and
   *  "it half worked" is exactly the state a restore has to be able to undo. */
  DESTRUCTIVE_OVER_MANY_FILES: 'DESTRUCTIVE_OVER_MANY_FILES',
  /** Files checked by different suites: passing one says nothing about the other. */
  MULTIPLE_VERIFICATION_GROUPS: 'MULTIPLE_VERIFICATION_GROUPS',
  /** Too large to review as one change. Applied last, so it never pre-empts a rule that
   *  has a reason behind it. */
  TOO_MANY_FILES: 'TOO_MANY_FILES',
  /** More than one command in one part: a failure cannot be attributed to either. */
  UNATTRIBUTABLE_COMMANDS: 'UNATTRIBUTABLE_COMMANDS',
});

/** A path that leaves the workspace, by spelling. Resolution is a separate, stricter check. */
export function leavesWorkspace(path) {
  const trimmed = String(path ?? '').trim();
  return trimmed.startsWith('/')
    || trimmed.startsWith('~')
    || trimmed === '..'
    || trimmed.startsWith('../')
    || trimmed.includes('/../')
    || trimmed.endsWith('/..');
}

/** The suite a path belongs to: its top directory, or `.` for a root-level file. */
export function verificationGroup(path) {
  const trimmed = String(path ?? '').trim().replace(/^\.\//, '');
  const first = trimmed.split('/')[0];
  return trimmed.includes('/') && first ? first : '.';
}

function distinctGroups(files) {
  return [...new Set(files.map(verificationGroup))];
}

/**
 * The first reason `step` cannot be verified as one unit, or `null` if it can.
 *
 * The order is the order the reasons are resolved, and it matters: a step that is both
 * destructive over many files and too large is reported as the former, because splitting it
 * by size would leave the destructive problem in every part.
 */
export function firstViolation(step) {
  const files = step?.files ?? [];
  const commands = step?.commands ?? [];
  const destructive = step?.blastRadius?.destructive === true;

  const outside = files.filter(leavesWorkspace).length;
  if (outside > 0 && outside < files.length) return Violation.MIXED_RADIUS;
  if (destructive && files.length > 1) return Violation.DESTRUCTIVE_OVER_MANY_FILES;
  if (distinctGroups(files).length > 1) return Violation.MULTIPLE_VERIFICATION_GROUPS;
  if (commands.length > 1) return Violation.UNATTRIBUTABLE_COMMANDS;
  if (files.length > MAX_FILES_PER_PART) return Violation.TOO_MANY_FILES;
  return null;
}

export const isVerifiable = (step) => firstViolation(step) === null;

export const DependencyViolation = Object.freeze({
  /** Names a part id absent from this same decomposition — not "not yet run", absent. */
  DANGLING_DEPENDENCY: 'DANGLING_DEPENDENCY',
  /** A dependency chain (of length one or more) that loops back on itself. */
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
});

/**
 * Whether every `dependsOn` in a decomposition resolves — to another part *in the same
 * decomposition*, never to itself, never in a loop.
 *
 * This is a property of the SET, not of one part, which is why it is not a fifth entry in
 * `firstViolation`: a part cannot tell whether its own dependency exists by reading itself.
 * Found missing by `D-0217` — the observation-only parts `A-0019` added each name the part
 * that carries the file they describe, and nothing had ever checked that name resolves.
 *
 * Reports every offending edge, not just the first: unlike `firstViolation`'s ordered
 * precedence (one reason picked on purpose), a broken graph can have more than one break, and
 * picking only one would hide the others from whoever reads the verdict.
 */
export function dependencyIntegrity(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const ids = new Set(list.map((part) => part?.id).filter(Boolean));
  const violations = [];

  for (const part of list) {
    for (const dependency of part?.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        violations.push({ id: part.id, violation: DependencyViolation.DANGLING_DEPENDENCY, dependsOn: dependency });
      }
    }
  }

  // Cycle detection walks only edges that resolve — a dangling edge is already reported above;
  // following it into `visit` would either do nothing (the id is absent from `graph`) or, worse,
  // misreport a dangling edge as a cycle if the missing id happened to collide with one already
  // on the stack. Keeping the two checks on disjoint edge sets keeps each report attributable
  // to one cause.
  const graph = new Map(list.map((part) => [part.id, (part?.dependsOn ?? []).filter((d) => ids.has(d))]));
  const state = new Map(); // absent -> 'visiting' -> 'done'
  const onCycle = new Set();
  const visit = (id, stack) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycleStart = stack.indexOf(id);
      for (const node of stack.slice(cycleStart)) onCycle.add(node);
      return;
    }
    state.set(id, 'visiting');
    for (const next of graph.get(id) ?? []) visit(next, [...stack, id]);
    state.set(id, 'done');
  };
  for (const id of ids) visit(id, []);
  for (const id of onCycle) violations.push({ id, violation: DependencyViolation.DEPENDENCY_CYCLE });

  return violations;
}

/**
 * Judge a decomposition: the parts a provider returned for one original step.
 *
 * `allPartsVerifiable` is deliberately a **boolean per task**, not a ratio. A ratio moves
 * when a provider returns more parts, which is a property of the denominator and not of the
 * work — the failure that made the coverage number meaningless. The counts are reported
 * beside it for reading, never as the verdict.
 *
 * `settled` is the fixed-point check, and it is the one that cannot be gamed: judge each
 * returned part *again*. A decomposition that still has a violation in it was not finished,
 * whatever it called itself — and a decomposition whose dependency graph does not resolve is
 * exactly as unfinished as one with an offending part: a reviewer cannot check parts in an
 * order that does not exist.
 */
export function judgeDecomposition(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const violations = list.map((part) => ({ id: part?.id ?? null, violation: firstViolation(part) }));
  const offending = violations.filter((entry) => entry.violation !== null);
  const dependencyViolations = dependencyIntegrity(list);
  const dependenciesResolve = dependencyViolations.length === 0;
  return {
    parts: list.length,
    verifiableParts: list.length - offending.length,
    unverifiableParts: offending.length,
    allPartsVerifiable: list.length > 0 && offending.length === 0,
    dependencyViolations,
    dependenciesResolve,
    // An empty decomposition is never "all verifiable": nothing was returned to verify, and
    // reporting `true` there would let a provider score perfectly by answering nothing.
    settled: list.length > 0 && offending.length === 0 && dependenciesResolve,
    offending,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later
//
// P3 — the engine's own methods, as tools the chat can actually call.
//
// Until this file existed, every tool this product could execute was an HTTP or MCP endpoint an
// operator had registered: `ToolExecutor` knew three transports and all three left the process.
// So the chat could reach a stranger's API and could not reach the installation it lives in — it
// could describe how one would find out what is broken here, and never look.
//
// The catalogue below is DERIVED from `SESSION_METHOD_POLICY`, never re-typed beside it. That is
// this project's most expensive recurring lesson (`PANEL_NAMES`, the seventeen address commands,
// `coden-address-book.mjs`): a hand-kept second list of the same thing agrees on the day it is
// written and drifts every day after. Here the consequence of drift would be a tool advertised to
// a model and refused by the dispatch, or — worse — an engine method that quietly gains a chat
// surface nobody classified. `builtin-tools.test.mjs` fails when a policy method is neither
// exposed nor excluded by name, so a method added to the engine tomorrow cannot slip through
// unclassified: it fails the suite until someone decides what it is.
//
// THREE PROPERTIES THIS FILE IS RESPONSIBLE FOR, and each one is a decision, not a detail:
//
// 1. **No authority is created.** A built-in tool is executed by handing the SAME
//    `sessionDispatch` the terminal and the browser already use the caller's OWN `can`. The
//    dispatch checks `SESSION_METHOD_POLICY` exactly as it does for those two transports, so the
//    chat reaches precisely what the person typing it could reach by typing the command instead —
//    never one permission more. `ToolExecutor` refuses a built-in call that arrives without a
//    `can`, rather than running it unchecked: that is the accident `D-0302` found in the socket
//    transport, and an optional gate is how a new transport inherits it.
//
// 2. **Only reads ship enabled.** `EFFECT` classifies all thirty methods; `builtinToolRecords()`
//    seeds the twenty whose effect is `read`. The eight writes and the two destructive verbs are
//    classified, tested and NOT registered — see `WRITE_TOOLS_ARE_NOT_SEEDED` below for why that
//    is an Owner decision and not a gap this file may close on its own.
//
// 3. **The resting cost is measured, not assumed.** Twenty schemas ride in every chat turn that
//    names no tool. `builtin-tools.test.mjs` pins the serialized size against a declared budget,
//    because `CE-016`'s claim ("a riposo il programma ha zero strumenti caricati") stopped being
//    free the moment `D-0674` made an unnamed request default to the project's set. A criterion
//    no row measures is not closed — so this one has a row, and the row is a number.
import { SESSION_METHOD_POLICY } from '../session-protocol.mjs';
import { AGENT_COMMANDS } from '../../../../apps/shared/coden/agent-commands.js';

/** The name a model sees. `engine_` because a bare `status` or `search` would collide with a tool
 *  an operator registered, and a collision resolves to whichever record `Map` saw last — a silent
 *  redirect of a call to the wrong endpoint. Dots become underscores because the function-name
 *  grammar every provider enforces is `[A-Za-z0-9_-]{1,64}` and `repoMap.search` is not in it. */
export const BUILTIN_NAME_PREFIX = 'engine_';
/** The store id. Stable and derived, never `randomUUID()`: a project's tool grant and an
 *  operator's disable are keyed by id, and an id that changed on restart would silently drop both
 *  every time the process came back. */
export const BUILTIN_ID_PREFIX = 'builtin:';
/** The transport `ToolExecutor` dispatches in-process. Distinct from `local-http` on purpose: a
 *  built-in has no endpoint, no credential and no socket, and giving it a URL-shaped record would
 *  have put it through `endpoint()` — a validator whose whole job is to decide which networks may
 *  be reached, asked about a call that reaches none. */
export const BUILTIN_TRANSPORT = 'builtin';

/**
 * What each engine method DOES to the installation. Every method in `SESSION_METHOD_POLICY` has
 * an entry; the test fails if one does not.
 *
 * `read`   — answers a question and changes nothing.
 * `write`  — changes recoverable state (a plan, a shadow, an approval, a recorded closure).
 * `destroy`— removes something no later act can bring back.
 *
 * This is NOT the same axis as the permission the policy names, and collapsing the two would be
 * wrong in both directions: `workspace.simulate` asks `workspace.read` and `workspace.measure`
 * asks `workspace.write`, but `replay.sweep` also asks `workspace.write` and deletes bytes
 * permanently. A model that hallucinated one argument would be one token away from the difference.
 */
export const EFFECT = Object.freeze({
  'workspace.plan': 'write',
  'workspace.simulate': 'read',
  'workspace.measure': 'write',
  'workspace.approve': 'write',
  'workspace.reject': 'write',
  'workspace.restore': 'write',
  'workspace.get': 'read',
  'workspace.runs': 'read',
  'repoMap.scan': 'read',
  'repoMap.search': 'read',
  'events.correlation': 'read',
  status: 'read',
  'capability.grants': 'read',
  'capability.revoke': 'write',
  'review.latency': 'read',
  'replay.retention': 'read',
  // Deletes replay bytes. The ledger keeps saying the calls happened, but the bytes themselves do
  // not come back, and `authoringReplayRetention({apply:true})` takes no confirmation word.
  'replay.sweep': 'destroy',
  'sessions.list': 'read',
  'sessions.get': 'read',
  // `purge` is one of its five actions and cannot be undone. The command shell demands the literal
  // word `confirm` for exactly this reason (`agent-commands.js`: "in un terminale `y` è a un
  // incollaggio di distanza dall'essere digitato da qualcosa che non sei tu"). A model emitting
  // JSON has no equivalent of typing a word on purpose.
  'sessions.action': 'destroy',
  'product.invariants': 'read',
  'coden.addresses': 'read',
  'coden.gitStatus': 'read',
  'coden.divergence': 'read',
  'skills.status': 'read',
  'skills.search': 'read',
  'coden.benchLists': 'read',
  'closure.list': 'read',
  'closure.record': 'write',
  'model.activate': 'write',
  // Freeing the loaded model stops the model that is answering, exactly as starting a different
  // one does — so it is classified where its sibling is, not lower because it takes no argument.
  'model.deactivate': 'write',
});

/**
 * The parameters each method actually reads, transcribed from the handlers in
 * `createSessionDispatch` and nothing wider. Deliberately terse: every property description is
 * paid for in every chat turn that carries the tool (property 3 above), and a schema is a contract
 * with the model, not documentation for a person — `agent-commands.js` already writes the prose.
 *
 * `additionalProperties:false` throughout. A model that invents a field must be told, on the round
 * that follows, that the field does not exist; silently dropping it is how a call that looks
 * honoured does nothing.
 */
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const strings = (description) => ({ type: 'array', items: { type: 'string' }, description });

export const SCHEMA = Object.freeze({
  'workspace.plan': object({
    request: str('what the change should achieve'),
    files: strings('files it may touch; omit to let the repository decide'),
    projectRules: strings('rules the plan is held to'),
    constraints: strings('constraints the plan must respect'),
    mode: { type: 'string', enum: ['safe', 'strict'], description: 'planning mode' },
    policy: { type: 'string', enum: ['restrictive', 'permissive'], description: 'path policy' },
    claims: strings('capability claims to request'),
  }, ['request']),
  'workspace.simulate': object({ runId: str('the run to ask about') }, ['runId']),
  'workspace.measure': object({ runId: str('the run to execute in the shadow') }, ['runId']),
  'workspace.approve': object({ runId: str('the MEASURED run to promote') }, ['runId']),
  'workspace.reject': object({ runId: str('the run to reject'), reason: str('why') }, ['runId']),
  'workspace.restore': object({ runId: str('the promoted run to undo') }, ['runId']),
  'workspace.get': object({ runId: str('the run to read') }, ['runId']),
  'workspace.runs': object({
    scope: str('all, pending, promoted or rejected'),
    conversationId: str('limit to runs started by one conversation'),
  }),
  'repoMap.scan': object({ path: str('subpath of the workspace; omit for the root') }),
  'repoMap.search': object({
    q: str('literal text to find'),
    path: str('subpath to search; omit for the whole workspace'),
    caseSensitive: { type: 'boolean', description: 'default true' },
  }, ['q']),
  'events.correlation': object({ correlationId: str('the id whose event trail is wanted') }, ['correlationId']),
  status: object(),
  'capability.grants': object(),
  'capability.revoke': object({ tokenId: str('the live grant to withdraw') }, ['tokenId']),
  'review.latency': object(),
  'replay.retention': object(),
  'replay.sweep': object(),
  'sessions.list': object({
    projectId: str('limit to one project'),
    place: { type: 'string', enum: ['active', 'archived', 'bin'], description: 'default active' },
    page: { type: 'integer', description: 'default 1' },
    pageSize: { type: 'integer', description: 'default 10' },
  }),
  'sessions.get': object({ id: str('the session to read') }, ['id']),
  'sessions.action': object({
    action: { type: 'string', enum: ['archive', 'unarchive', 'bin', 'restore', 'purge'] },
    ids: strings('the sessions to move'),
  }, ['action', 'ids']),
  'product.invariants': object(),
  'coden.addresses': object(),
  'coden.gitStatus': object(),
  'coden.divergence': object({ paths: strings('the paths a change touches') }, ['paths']),
  'skills.status': object(),
  'skills.search': object({ name: str('match on name'), operation: str('match on what it does') }),
  'coden.benchLists': object(),
  'closure.list': object(),
  'closure.record': object({
    runId: str('the work being closed'),
    kind: str('agent-run by default'),
    projectId: str('the project it belongs to'),
    summary: str('what was done'),
    notDone: strings('what was left undone'),
    nothingLeftUndone: { type: 'boolean', description: 'true only when the list above is genuinely empty' },
    residualRisk: str('what could still go wrong'),
    reviewSeconds: { type: 'integer', description: 'how long human review took' },
  }, ['runId', 'summary']),
  'model.activate': object({ id: str('the installed model to load; omit to list what is loadable') }),
  // No properties, and that is the contract: the handler frees whatever is loaded and accepts
  // nothing, so a parameter here would describe an argument the engine ignores.
  'model.deactivate': object({}),
});

/** The four methods no `/` command names, so no summary exists to derive. Written here rather than
 *  invented at the call site, and short for the reason the schemas are short. */
const OWN_DESCRIPTION = Object.freeze({
  'product.invariants': 'The security invariants this installation enforces, as the server records them',
  'coden.addresses': 'Every panel and destination this interface can reach, by address',
  'coden.benchLists': 'The workbench lists: projects, recent work, sessions, tasks, agents, tools, history',
  'closure.list': 'The closures recorded on this installation — what was closed, and what each one left undone',
});

/** Method → the `/` command that reaches it, so a tool description and a menu entry can never say
 *  two different things about one capability. Built once, from the list both shells already
 *  import. */
const COMMAND_BY_METHOD = new Map(AGENT_COMMANDS.filter((item) => item.method).map((item) => [item.method, item]));

export function builtinToolName(method) {
  return `${BUILTIN_NAME_PREFIX}${String(method).replaceAll('.', '_')}`;
}
export function builtinToolId(method) {
  return `${BUILTIN_ID_PREFIX}${method}`;
}
/** The inverse of `builtinToolName`, and it is a LOOKUP rather than a string transform: `_` is
 *  legal inside a method segment, so reversing the replacement by guessing where the dots were
 *  would be ambiguous the first time a method is named `foo_bar.baz`. */
export function methodForBuiltinName(name) {
  for (const method of Object.keys(SESSION_METHOD_POLICY)) if (builtinToolName(method) === name) return method;
  return null;
}

/**
 * Every engine method, classified. One row per entry in `SESSION_METHOD_POLICY` — the catalogue is
 * complete by construction, and what varies is `seeded`, never membership.
 */
export function builtinToolCatalogue() {
  return Object.entries(SESSION_METHOD_POLICY).map(([method, policy]) => {
    const command = COMMAND_BY_METHOD.get(method) ?? null;
    const effect = EFFECT[method] ?? null;
    return {
      method,
      name: builtinToolName(method),
      id: builtinToolId(method),
      effect,
      permission: policy.permission ?? null,
      command: command ? `/${command.name}` : null,
      description: OWN_DESCRIPTION[method] ?? command?.summary ?? '',
      inputSchema: SCHEMA[method] ?? null,
      seeded: effect === 'read',
    };
  });
}

/**
 * WRITE_TOOLS_ARE_NOT_SEEDED.
 *
 * The eight `write` methods and the two `destroy` ones are classified above, carry schemas, and
 * are NOT registered as tools. This is a scope line, drawn deliberately and stated rather than
 * left to be discovered:
 *
 *  - P3's acceptance criterion is a READ — "the chat answers *what is broken here* by calling a
 *    real tool". Reads deliver that whole, end to end.
 *  - Letting a model approve a plan, promote a shadow or activate a model changes what the product
 *    IS, which `noesar-evolution-engineering-depth` §6 reserves for the Owner. Shipping it because
 *    the mechanism happens to work would be the widening `noesar-evolution-budget` §5 forbids.
 *  - Nothing architectural is deferred: turning a write on is one word in `EFFECT`'s neighbour
 *    below, not a new transport, a new gate or a new surface. The authority path, the refusal
 *    path, the audit line and the schema already exist and are already tested.
 *
 * What is NOT ready and would have to be built first, said now rather than on the day it is asked
 * for: the chat executes a granted tool immediately, and `tool.mutative`/`tool.requiresApproval`
 * — fields the store has carried since the beginning — are read by `AgentService` and ignored by
 * `ChatOrchestrator`. A write tool wants a mid-turn approval the person actually gives. That is a
 * real slice of work, not a flag.
 */
export const SEEDED_EFFECTS = Object.freeze(['read']);

/** The store records for the tools this product registers on its own behalf. Shaped exactly like
 *  `AgentService.registerTool` writes them, because everything downstream — the scope
 *  intersection, the snapshot, the search index, the WebUI's Tools panel — reads that shape and
 *  must not learn a second one. */
export function builtinToolRecords(nowIso = new Date().toISOString()) {
  return builtinToolCatalogue().filter((entry) => SEEDED_EFFECTS.includes(entry.effect)).map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    transport: BUILTIN_TRANSPORT,
    endpoint: null,
    // The method travels in `config`, where the other transports keep what they need to place a
    // call (`config.command` for stdio, `config.remoteToolName` for MCP). `ToolExecutor` reads it
    // from there and refuses a built-in record that carries none.
    config: { method: entry.method },
    external: false,
    consent: { granted: false, grantedAt: null, projectIds: [] },
    timeoutMs: 60_000,
    encryptedCredential: null,
    credentialEphemeral: false,
    inputSchema: entry.inputSchema ?? { type: 'object' },
    outputSchema: {},
    // The permission the dispatch will ask for, carried on the record so the Tools panel can show
    // what a tool costs to use. It is a DESCRIPTION and never the gate: the gate is `can`, checked
    // inside the dispatch, and a record edited to claim a smaller permission would change nothing.
    permissions: entry.permission ? [entry.permission] : [],
    mutative: false,
    requiresApproval: false,
    disabled: false,
    builtin: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
}

/** The fields this product owns on a built-in record and rewrites on every start, so an upgrade
 *  that renames a method or tightens a schema takes effect. Everything not listed is the
 *  OPERATOR's: `disabled` and `consent` survive a restart, because a tool someone turned off must
 *  not come back on because the process did. */
const PRODUCT_OWNED = Object.freeze(['name', 'description', 'transport', 'config', 'inputSchema', 'permissions', 'external', 'mutative', 'builtin']);

/**
 * Register the built-in tools, idempotently, and report what changed.
 *
 * Writes only when something actually differs — a `transact` that rewrites an unchanged 100 KB
 * state file on every boot is a cost paid for nothing, and this runs on the start-up path.
 *
 * Nothing is ever removed. A record whose method disappears from the engine keeps its row and
 * stops resolving, which `ToolExecutor` reports by name; deleting it would take a project's grant
 * and an operator's disable with it, silently, at start-up — exactly the class of act
 * `CLAUDE10.md` §4 refuses.
 */
export function seedBuiltinTools(store, { ledger = null, now = () => new Date().toISOString() } = {}) {
  const desired = builtinToolRecords(now());
  const summary = { added: [], updated: [], unchanged: 0 };
  for (const record of desired) {
    const existing = store.read().tools.find((item) => item.id === record.id);
    if (!existing) { summary.added.push(record.name); continue; }
    const drifted = PRODUCT_OWNED.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(record[key]));
    if (drifted) summary.updated.push(record.name); else summary.unchanged += 1;
  }
  if (!summary.added.length && !summary.updated.length) return summary;
  store.transact((state) => {
    for (const record of desired) {
      const existing = state.tools.find((item) => item.id === record.id);
      if (!existing) { state.tools.push(record); continue; }
      for (const key of PRODUCT_OWNED) existing[key] = record[key];
      existing.updatedAt = record.updatedAt;
    }
    return summary;
  });
  ledger?.append({
    actor: 'system', action: 'tool.builtin-seeded', result: 'success',
    details: { added: summary.added.length, updated: summary.updated.length, unchanged: summary.unchanged },
  });
  return summary;
}

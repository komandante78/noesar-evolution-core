// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The session protocol (docs/CODEN_EVOLUTION_DESIGN_V1.md §17): "shells over a session
// protocol, not a Tauri desktop app" — one engine, reached the same way whether the caller
// is the WebUI shell (over the HTTP bridge in server.mjs) or a real terminal (over the unix
// socket started here). Both transports call the SAME dispatch below, against the SAME
// running instances server.mjs already constructed — "the same live session as the
// workbench" (index.html's own words for the Terminal tab), not a second client with its
// own state.
//
// What this module is NOT: a shell. Every method is one of the product's own already-guarded
// operations (plan/simulate/approve/reject/restore, repo-map scan/search, a run's own event
// trail, a status snapshot). workspace-actions.mjs refuses EXECUTE and DELETE permanently and
// on purpose; nothing here reopens that. §17's architecture diagram draws the Permission
// Engine between every shell — WebUI or Terminal — and the Sandbox Runtime, "tokens only":
// this is that mediated path, not a bypass of it.
//
// Zero new dependencies, matching this project's existing policy (see repo-map.mjs's own
// comment on the same point): the unix socket transport is framed by hand, one JSON object
// per newline, instead of pulling in a message-framing library.

import { createServer } from 'node:net';
import { profileChange as defaultProfileChange } from './divergence-profile.mjs';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';

export const PROTOCOL_VERSION = 'noesar-tui/1';

export class ProtocolError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'ProtocolError';
    this.kind = kind;
  }
}

/**
 * What each method needs, and which transports offer it — one table, both shells.
 *
 * Until phase 5 of CodeN Evolution this lived only in server.mjs, as the HTTP bridge's own
 * `TUI_METHOD_PERMISSION`, and the unix socket transport checked nothing beyond authentication.
 * Measured then (`D-0301`): the two shells agreed anyway, because every role that can
 * authenticate holds `workspace.read` and `workspace.write` — they agreed by COINCIDENCE, not
 * by construction, and the coincidence was one narrowed role away from ending. `D-0302` ends it
 * properly: the permission is enforced in `dispatch` below, so it holds for every transport
 * that exists now and any added later, and the bridge derives its exposure list from this table
 * instead of keeping a second one.
 *
 * `permission: null` means session-only — the same as the dedicated routes for those
 * operations (`GET /api/v1/workspace-actions/:id`, `GET /api/v1/events/:id`), which ask for a
 * session and nothing beyond it.
 *
 * `bridged: false` means the browser does not reach the method through `/api/v1/tui/command`,
 * because it reaches the same thing through a surface of its own (its Sessions page, its
 * Invariants panel, its address box). That is an exposure decision, not a weaker gate: the
 * permission named below is exactly what those routes already require — `GET /api/v1/sessions`
 * asks `workspace.read`, `POST /api/v1/sessions/actions` asks `workspace.write` — so reaching
 * them from a terminal costs the same as reaching them from a browser.
 */
export const SESSION_METHOD_POLICY = Object.freeze({
  'workspace.plan': { permission: 'workspace.write', bridged: true },
  'workspace.simulate': { permission: 'workspace.read', bridged: true },
  'workspace.approve': { permission: 'workspace.write', bridged: true },
  'workspace.reject': { permission: 'workspace.write', bridged: true },
  'workspace.restore': { permission: 'workspace.write', bridged: true },
  'workspace.get': { permission: null, bridged: true },
  'repoMap.scan': { permission: 'workspace.read', bridged: true },
  'repoMap.search': { permission: 'workspace.read', bridged: true },
  'events.correlation': { permission: null, bridged: true },
  status: { permission: null, bridged: true },
  'sessions.list': { permission: 'workspace.read', bridged: false },
  'sessions.get': { permission: 'workspace.read', bridged: false },
  'sessions.action': { permission: 'workspace.write', bridged: false },
  'product.invariants': { permission: null, bridged: false },
  'coden.addresses': { permission: null, bridged: false },
  // The branch state the WebUI's own `git` chip reads (`GET /api/v1/coden/git-status`,
  // s317). It was reachable from the browser and not from the terminal, so the terminal's
  // status line read `—` for `remote`: a field with a real source, shown as unsourced only
  // because one transport had never been given the method.
  //
  // `coden.plan`, which is what that HTTP route already requires — NOT `workspace.read`,
  // which is what a read of the workspace would otherwise suggest. The two are not the same
  // set: every AI service account holds `workspace.read` and none holds `coden.plan`
  // (auth.mjs), so gating on the wider one here would let an account reach over this socket
  // a fact it cannot reach over HTTP. That is precisely the sideways asymmetry `D-0302`
  // closed, and re-opening it for the convenience of a status field is not a trade.
  'coden.gitStatus': { permission: 'coden.plan', bridged: false },
  // Phase 7. The divergence profile, on demand. `plan()` already returns one for the files it
  // settled on; this is for asking about a set the caller names — the diff being reviewed, a
  // change not planned yet. `coden.plan` for the same reason `coden.gitStatus` uses it: this
  // reads the HISTORY of the repository, which is what a plan is entitled to, and widening it
  // to `workspace.read` for the convenience of a panel is not a trade.
  'coden.divergence': { permission: 'coden.plan', bridged: false },
  // Phase 3b. The bench's list panels — Projects, Recent, Sessions, Tasks, Agents, Tools,
  // History — answered "no source over this transport" in the terminal, because the browser
  // fills all seven from ONE route (`GET /api/v1/ai/bootstrap`, via `refreshWorkspace`) and
  // the socket had never been given it. ONE method, not seven, for exactly that reason:
  // seven would be seven chances for the two shells to disagree about which snapshot they are
  // looking at, and the browser does not take seven either.
  //
  // `workspace.read` — what that route already requires, not a wider one for a list's sake.
  'coden.benchLists': { permission: 'workspace.read', bridged: false },
  // The closure register (`UI-036`). Read and write are SEPARATE entries because they are
  // separate permissions on the routes already serving them (`GET /api/v1/closures` asks
  // `workspace.read`, `POST` asks `workspace.write`). Collapsing them into one would hand a
  // reader the power to record a closure over the socket that the browser refuses them —
  // the sideways asymmetry `D-0302` exists to prevent.
  'closure.list': { permission: 'workspace.read', bridged: false },
  'closure.record': { permission: 'workspace.write', bridged: false },
});

/** The methods the HTTP bridge exposes, and what each needs — derived, never re-typed. */
export function bridgedMethodPermissions() {
  return Object.fromEntries(
    Object.entries(SESSION_METHOD_POLICY)
      .filter(([, policy]) => policy.bridged)
      .map(([method, policy]) => [method, policy.permission]),
  );
}

/**
 * Builds the dispatcher once, closed over the instances a caller must not construct a second
 * copy of — constructing a fresh WorkspaceActionOrchestrator here would give the terminal its
 * own runs, invisible to the WebUI, which is exactly the "second client with its own state"
 * the design explicitly rejects.
 */
export function createSessionDispatch({
  workspaceActions, buildRepositoryMap, literalSearch, resolveWorkspaceSubpath,
  workspaceRoot, engineEvents, workspaceActionsStatus, getShadowSnapshot,
  capabilityStatus, capabilityMinter, contextGraph, ledger, invariantEnforcement,
  codenAddressBook, gitStatus, profileChange = defaultProfileChange,
  // Phase 3b. The same two objects the HTTP routes for these already hold — passed in rather
  // than constructed here, for the reason this factory's own comment gives about the
  // orchestrator: a second instance would give the terminal its own lists and its own closure
  // register, invisible to the browser, which is the "second client with its own state" the
  // design rejects.
  // `getClosureRegister` is a FUNCTION and `aiWorkspace` is not, and the asymmetry is not
  // stylistic: server.mjs builds the workspace service before it builds this dispatch and the
  // closure register after it. A direct reference to the later one would read an uninitialised
  // binding at construction time.
  aiWorkspace, getClosureRegister,
  // The policy the gate below reads. A parameter, not a direct reference, for one reason:
  // "a method with no policy entry is refused" is the fail-closed branch that matters most and
  // the one the real configuration can never reach, since every implemented method is listed.
  // A branch nobody can exercise is a branch nobody has checked — mutating the guard away left
  // every test passing until this seam existed.
  methodPolicy = SESSION_METHOD_POLICY,
}) {
  const nowUnix = () => Math.floor(Date.now() / 1000);
  const methods = {
    'workspace.plan': ({ params, actor }) => workspaceActions.plan({
      request: params?.request, files: params?.files ?? [], projectRules: params?.projectRules ?? [],
      constraints: params?.constraints ?? [], mode: params?.mode ?? 'safe', policy: params?.policy ?? 'restrictive',
      actor, nowUnix: nowUnix(), claims: params?.claims ?? [],
    }),
    'workspace.simulate': ({ params, actor }) => workspaceActions.simulate({ runId: params?.runId, actor, nowUnix: nowUnix() }),
    'workspace.approve': ({ params, actor }) => workspaceActions.approve({ runId: params?.runId, approverId: actor, nowUnix: nowUnix() }),
    'workspace.reject': ({ params, actor }) => workspaceActions.reject({ runId: params?.runId, approverId: actor, reason: params?.reason ?? null, nowUnix: nowUnix() }),
    'workspace.restore': ({ params, actor }) => workspaceActions.restore({ runId: params?.runId, actor, nowUnix: nowUnix() }),
    'workspace.get': ({ params }) => {
      const run = workspaceActions.get(params?.runId);
      if (!run) throw new ProtocolError('NOT_FOUND', `no run \`${params?.runId}\``);
      return run;
    },
    // UI-050 (D-0267): the sessions surface (UI-001…UI-012) reached from the terminal, not
    // just the browser — same three methods the HTTP bridge's `/api/v1/sessions*` routes
    // already call on `contextGraph`, so a session archived/binned/restored from either
    // transport is the same fact, not two.
    'sessions.list': ({ params }) => contextGraph.listSessions({
      projectId: params?.projectId ?? null, place: params?.place ?? 'active',
      page: Number(params?.page ?? 1), pageSize: Number(params?.pageSize ?? 10),
    }),
    'sessions.get': ({ params }) => contextGraph.getConversation(params?.id),
    // One verb, any number of sessions — the same batch-with-partial-failure shape as
    // `POST /api/v1/sessions/actions`, so a selection that is half-refused (UI-009) reads
    // the same from a terminal as it does from the browser.
    'sessions.action': ({ params, actor }) => {
      const action = String(params?.action ?? '');
      if (!['archive', 'unarchive', 'bin', 'restore', 'purge'].includes(action)) {
        throw new ProtocolError('INVALID_ACTION', 'action must be archive, unarchive, bin, restore or purge.');
      }
      const ids = [...new Set((Array.isArray(params?.ids) ? params.ids : []).map(String))];
      if (!ids.length) throw new ProtocolError('INVALID_REQUEST', 'at least one session id is required.');
      if (ids.length > 200) throw new ProtocolError('INVALID_REQUEST', 'at most 200 sessions may be moved at once.');
      const applied = []; const refused = [];
      for (const id of ids) {
        try {
          if (action === 'archive') applied.push(contextGraph.archiveSession(id, { archived: true }));
          else if (action === 'unarchive') applied.push(contextGraph.archiveSession(id, { archived: false }));
          else if (action === 'bin') applied.push(contextGraph.binSession(id));
          else if (action === 'restore') applied.push(contextGraph.restoreSession(id));
          else applied.push(contextGraph.purgeSession(id));
        } catch (error) { refused.push({ id, status: Number(error.status ?? 500), reason: error.message }); }
      }
      ledger.append({
        actor, action: `session.${action}`, result: refused.length ? 'partial' : 'success',
        details: { requested: ids.length, applied: applied.length, refused: refused.length, transport: 'tui' },
      });
      return { action, applied, refused };
    },
    'repoMap.scan': ({ params }) => {
      const target = resolveWorkspaceSubpath(workspaceRoot, params?.path);
      if (!target) throw new ProtocolError('INVALID_PATH', 'path escapes the workspace');
      return buildRepositoryMap(target);
    },
    'repoMap.search': ({ params }) => {
      const target = resolveWorkspaceSubpath(workspaceRoot, params?.path);
      if (!target) throw new ProtocolError('INVALID_PATH', 'path escapes the workspace');
      return literalSearch(target, params?.q ?? '', { caseSensitive: params?.caseSensitive !== false });
    },
    'events.correlation': ({ params }) => ({
      correlationId: params?.correlationId, events: engineEvents.correlation(params?.correlationId),
    }),
    'status': () => ({
      protocol: PROTOCOL_VERSION,
      workspaceActions: workspaceActionsStatus(),
      shadow: getShadowSnapshot(),
      capability: capabilityStatus(capabilityMinter),
    }),
    // UI-054 (D-0268): the same SEC-003 enforcement declaration `/api/v1/bootstrap` sends
    // the WebUI's "Invariants" panel — rendered from the server's own record, never a
    // second hardcoded list that can drift from it (see path-auth.mjs's own comment on
    // exactly that drift, once real).
    'product.invariants': () => ({ invariants: invariantEnforcement }),
    // Phase 4 (D-0300): the address space itself, so `/` means the same thing in a terminal
    // as it does in the browser. The browser builds its list by reading its own DOM; a
    // terminal has none, and the alternative — a list written out inside tui-client.mjs —
    // is the arrangement that had already drifted to fourteen names against the markup's
    // twenty-five. Derived per call from the file the WebUI is served out of, never cached
    // here and never declared here (src/coden-address-book.mjs's own comment says what it
    // refuses to assert). A deployment that cannot read that file answers UNAVAILABLE: a
    // shell told "no addresses" would go looking for a product with no panels, while a
    // shell told the source is unreadable knows to look at the deployment.
    'coden.addresses': () => {
      if (typeof codenAddressBook !== 'function') {
        throw new ProtocolError('UNAVAILABLE', 'this deployment did not wire an address book');
      }
      let addresses;
      try { addresses = codenAddressBook(); } catch (error) {
        throw new ProtocolError('UNAVAILABLE', `the interface the address list is read from could not be read: ${error.message}`);
      }
      return { addresses, accessFiltered: false };
    },
    // Phase 3b. The seven bench list panels, from the same snapshot `GET /api/v1/ai/bootstrap`
    // serves the browser. Only the seven keys those panels render are returned — the snapshot
    // also carries providers, memories, sources and branches, and a terminal asking for a list
    // of projects has not asked for the provider catalogue.
    //
    // Each list is CAPPED at six, which is not a transport decision: the browser's own
    // renderer slices to six (`renderBenchNavigator`), and a terminal showing sixty where the
    // browser shows six would be the two shells disagreeing about what the panel IS. The total
    // travels alongside, so "6 of 41" can be said rather than implied.
    'coden.benchLists': () => {
      if (!aiWorkspace || typeof aiWorkspace.snapshot !== 'function') {
        throw new ProtocolError('UNAVAILABLE', 'this deployment did not wire the workspace snapshot');
      }
      const snapshot = aiWorkspace.snapshot();
      const panels = {
        projects: 'projects', recent: 'artifacts', sessions: 'conversations',
        tasks: 'tasks', agents: 'agents', tools: 'tools', history: 'agentRuns',
      };
      const lists = {};
      for (const [panel, key] of Object.entries(panels)) {
        const all = Array.isArray(snapshot[key]) ? snapshot[key] : [];
        lists[panel] = { shown: all.slice(0, 6), total: all.length };
      }
      return { lists, cappedAt: 6 };
    },
    'closure.list': () => {
      const register = typeof getClosureRegister === 'function' ? getClosureRegister() : null;
      if (!register) throw new ProtocolError('UNAVAILABLE', 'this deployment did not wire the closure register');
      return { closures: register.list({ projectId: null }) };
    },
    // The one WRITE this phase adds to the socket. The register's own refusal — a closure that
    // neither names what was left undone nor states that nothing was — is enforced inside
    // `record`, so it holds here exactly as it holds for the browser's form: this method
    // passes the fields through and lets the register refuse. Re-implementing the check here
    // would be a second copy of the rule that matters most in the object.
    'closure.record': ({ params, actor }) => {
      const register = typeof getClosureRegister === 'function' ? getClosureRegister() : null;
      if (!register) throw new ProtocolError('UNAVAILABLE', 'this deployment did not wire the closure register');
      // Every field the register accepts, not a subset: a socket that could record only part
      // of a closure would make the terminal's closure a different KIND of object from the
      // browser's, which is `CE-034` failing quietly rather than loudly.
      return register.record({
        runId: params?.runId,
        kind: params?.kind ?? 'agent-run',
        projectId: params?.projectId ?? null,
        summary: params?.summary ?? '',
        notDone: params?.notDone ?? [],
        nothingLeftUndone: Boolean(params?.nothingLeftUndone),
        residualRisk: params?.residualRisk ?? '',
        reviewSeconds: params?.reviewSeconds ?? null,
        actorId: actor,
      });
    },
    // Same module the HTTP route calls, against the same workspace root — not a second
    // reading of git that could disagree with the browser's chip about the same repository.
    // The dispatch hands every handler `{ params, actor }`, not the params directly. Taking
    // `params` here read `.paths` off the envelope, found nothing, and refused every call with
    // «needs the paths a change touches» — a refusal that reads like the caller's mistake.
    // Caught by driving the real dispatch in a test rather than calling the handler.
    'coden.divergence': async ({ params }) => {
      if (typeof profileChange !== 'function') {
        throw new ProtocolError('UNAVAILABLE', 'this deployment did not wire a divergence profiler');
      }
      const paths = Array.isArray(params?.paths) ? params.paths.map(String).filter(Boolean) : [];
      if (!paths.length) {
        throw new ProtocolError('INVALID', 'a divergence profile needs the paths a change touches');
      }
      try {
        const profiled = await profileChange(workspaceRoot, paths);
        // Four signals with their level. The module refuses to produce a score, and this
        // transport must not become the quiet place one appears.
        return { available: true, reason: null, signals: profiled.signals, basis: profiled.basis };
      } catch (error) {
        // A workspace with no history is a real installation, not an error to shout about.
        // Declared and answered, exactly as plan() declares it.
        if (error?.name !== 'DivergenceUnavailable') throw error;
        return { available: false, reason: error.reason ?? error.message, signals: [], basis: null };
      }
    },
    'coden.gitStatus': () => {
      if (typeof gitStatus !== 'function') {
        throw new ProtocolError('UNAVAILABLE', 'this deployment did not wire a git reader');
      }
      return gitStatus(workspaceRoot);
    },
  };

  /**
   * `can(permission) => boolean` is the caller's own authority, supplied by the transport that
   * knows who is asking. It is REQUIRED for any method whose policy names a permission: a
   * caller that cannot say what it may do is refused, rather than let through on the grounds
   * that nobody checked. That is the shape the socket transport had by accident until `D-0302`
   * — no check at all — and the failure mode of an optional gate is that a new transport
   * inherits the accident.
   */
  return async function dispatch(method, params, actor, can) {
    const handler = methods[method];
    if (!handler) throw new ProtocolError('UNKNOWN_METHOD', `no such method \`${method}\``);
    const policy = methodPolicy[method];
    // A method implemented above but absent from the policy table is a programming error, and
    // it fails closed: an unlisted method is refused, never run under no permission at all.
    if (!policy) throw new ProtocolError('UNKNOWN_METHOD', `\`${method}\` has no declared permission policy`);
    if (policy.permission) {
      if (typeof can !== 'function') {
        throw new ProtocolError('FORBIDDEN', `\`${method}\` needs \`${policy.permission}\`, and this transport did not say what the caller may do`);
      }
      if (!can(policy.permission)) throw new ProtocolError('FORBIDDEN', `\`${method}\` needs \`${policy.permission}\``);
    }
    return handler({ params, actor });
  };
}

/**
 * The unix socket transport — for a real terminal (TTY / SSH), never for the browser.
 * Authenticates its own session over the wire (auth.beginLogin then auth.completeLogin,
 * the identical two calls server.mjs's HTTP login route makes) rather than trusting a
 * cookie, since a socket connection has none. One JSON object per newline in both
 * directions; the first line the server sends is the protocol handshake.
 */
export function startUnixSocketServer({ socketPath, dispatch, auth, ledger }) {
  // A socket file left by a previous, uncleanly-stopped process is stale state at a path
  // this component owns exclusively — removing it is not the destructive-file rule (§4)
  // reaching into something else's data, it is clearing our own litter before relisting.
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((socket) => {
    let authenticated = null;
    let buffer = '';
    socket.write(`${JSON.stringify({ protocol: PROTOCOL_VERSION })}\n`);

    const respond = (id, ok, payload) => {
      const frame = ok ? { id, ok: true, result: payload } : { id, ok: false, error: { kind: payload.kind ?? payload.name ?? 'ERROR', reason: payload.message ?? String(payload) } };
      try { socket.write(`${JSON.stringify(frame)}\n`); } catch { /* the client already went away */ }
    };

    socket.on('data', async (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (!line) continue;
        let request;
        try { request = JSON.parse(line); } catch { respond(null, false, new ProtocolError('INVALID_JSON', 'each line must be one JSON object')); continue; }
        const { id, method, params } = request ?? {};
        try {
          if (method === 'auth.login') { respond(id, true, auth.beginLogin({ username: params?.username, password: params?.password, ip: 'unix-socket' })); continue; }
          if (method === 'auth.mfa') {
            const value = auth.completeLogin({ challenge: params?.challenge, totpCode: params?.totpCode, ip: 'unix-socket' });
            authenticated = { user: value.user };
            ledger.append({ actor: value.user.id, action: 'tui.session-started', result: 'success', details: { transport: 'unix-socket' } });
            // The permission set comes back with the user, exactly as `GET /api/v1/auth/me`
            // gives it to the browser — from `permissionsFor`, derived from the one
            // `ROLE_PERMISSIONS` definition, never a second matrix. Phase 3a needs it because
            // `CE-036` requires the menu to hide what the account cannot use IN BOTH SHELLS,
            // and until now only the browser was ever told what its account holds. A terminal
            // left to guess would either offer everything (a menu of doors that answer 403)
            // or hide by a table of its own (the drift `PANEL_NAMES` already demonstrated).
            // A description, not a grant: the dispatch still checks `can` on every call.
            respond(id, true, { user: value.user, permissions: auth.permissionsFor(value.user.role) });
            continue;
          }
          if (!authenticated) throw new ProtocolError('UNAUTHENTICATED', 'call `auth.login` then `auth.mfa` before any other method');
          // The caller's authority, from the same AuthService the HTTP surface asks. Before
          // `D-0302` this transport passed none and the dispatch asked for none: a terminal
          // session could call anything its account could authenticate into, including
          // `sessions.action` with `purge`, which the browser's own route gates on
          // `workspace.write`. Nothing was exploitable then — every role holds it — and that
          // is precisely why it had gone unnoticed.
          respond(id, true, await dispatch(method, params, authenticated.user.id,
            (permission) => auth.hasPermission(authenticated.user, permission)));
        } catch (error) {
          respond(id, false, error);
        }
      }
    });
    socket.on('error', () => { /* a dropped client is not a server fault */ });
  });

  server.listen(socketPath, () => {
    // 0600: matches the same single-uid posture already documented for the product's own
    // PostgreSQL unix socket (docs/POSTGRESQL_18_PGVECTOR_IMPLEMENTATION.md).
    try { chmodSync(socketPath, 0o600); } catch { /* best-effort on filesystems that ignore it */ }
  });
  return server;
}

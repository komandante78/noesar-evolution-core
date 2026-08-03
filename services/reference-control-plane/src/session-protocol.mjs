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
  codenAddressBook,
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
            respond(id, true, { user: value.user });
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

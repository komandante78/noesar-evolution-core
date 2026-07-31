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
 * Builds the dispatcher once, closed over the instances a caller must not construct a second
 * copy of — constructing a fresh WorkspaceActionOrchestrator here would give the terminal its
 * own runs, invisible to the WebUI, which is exactly the "second client with its own state"
 * the design explicitly rejects.
 */
export function createSessionDispatch({
  workspaceActions, buildRepositoryMap, literalSearch, resolveWorkspaceSubpath,
  workspaceRoot, engineEvents, workspaceActionsStatus, getShadowSnapshot,
  capabilityStatus, capabilityMinter, contextGraph, ledger,
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
  };

  return async function dispatch(method, params, actor) {
    const handler = methods[method];
    if (!handler) throw new ProtocolError('UNKNOWN_METHOD', `no such method \`${method}\``);
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
          respond(id, true, await dispatch(method, params, authenticated.user.id));
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

// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AuditLedger } from './audit.mjs';
import { authorityStatus, assertReferenceRuntimeAllowed } from './authority.mjs';
import {
  DataPlaneMode, dataPlaneStatus, assertDevelopmentDataPlane, describeDataPlane,
} from './data-plane.mjs';
import { PostgresSupervisor } from './postgres-supervisor.mjs';
import { UserDirectory } from './user-directory.mjs';
import { LocalModelRuntime } from './local-model-runtime.mjs';
import { AuthService, parseCookies } from './auth.mjs';
import { AuthStore } from './auth-store.mjs';
import { resolveSetupToken } from './setup-token.mjs';
import { discoverHardware, recommendRuntime } from './hardware.mjs';
import {
  securityHeaders, validHostHeader, isWildcardAddress,
  resolveBindScope, allowsUnauthenticatedMetrics,
} from './http-security.mjs';
import { createPathPlan } from './path-auth.mjs';
import { PrivacyState, evaluateEgress, privacyBanner } from './privacy.mjs';
import { JsonStore } from './store.mjs';
import { AtomicJsonStore } from './ai-workspace/atomic-store.mjs';
import { ContextGraph } from './ai-workspace/context-graph.mjs';
import { CredentialVault } from './ai-workspace/credential-vault.mjs';
import { ProviderGateway } from './ai-workspace/provider-gateway.mjs';
import { WorkspaceService } from './ai-workspace/workspace-service.mjs';
import { AgentService } from './ai-workspace/agent-service.mjs';
import { ChatOrchestrator } from './ai-workspace/chat-orchestrator.mjs';
import { FileExtractor, extractorCapabilities } from './ai-workspace/file-extractors.mjs';
import { ToolExecutor } from './ai-workspace/tool-executor.mjs';
import { Logger } from './logging.mjs';
import { Metrics } from './metrics.mjs';
import { DebugMode } from './debug-mode.mjs';
import { Watchdog, watchdogStatePath } from './watchdog.mjs';
import { UpdateManager } from './update-manager.mjs';
import { TimezoneService, formatInZone, toUtcIso } from './timezone.mjs';
import { buildHealth, buildReadiness, registerWatchdogSubjects } from './observability.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const webRoot = resolve(repoRoot, 'apps/webui-static');
const workspace = resolve(process.env.NOESAR_WORKSPACE ?? join(repoRoot, '.workspace'));
const port = Number(process.env.NOESAR_PORT ?? 8088);
const host = process.env.NOESAR_HOST ?? '127.0.0.1';
const secureCookies = process.env.NOESAR_SECURE_COOKIES === 'true';
const authority = assertReferenceRuntimeAllowed(authorityStatus(process.env));

// The PostgreSQL data plane comes up asynchronously, so this starts as the declared
// configuration and is replaced by describeDataPlane() once the supervisor is ready —
// `let` rather than `const` for exactly that reason. In reference-json mode the original
// fail-closed assertion still runs here, at module load, unchanged.
const declaredDataPlane = dataPlaneStatus(process.env);
const postgresEnabled = declaredDataPlane.mode === DataPlaneMode.POSTGRESQL;
let dataPlane = postgresEnabled
  ? { ...declaredDataPlane, reason:'PostgreSQL is starting; readiness is withheld until it answers.' }
  : assertDevelopmentDataPlane(declaredDataPlane);
const allowedHosts = new Set(
  (process.env.NOESAR_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,::1')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
);
if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host.toLowerCase());

// The address the operator published this container on, and the exposure scope that
// follows from it. Both are declarations: from inside the namespace the process only
// ever sees NOESAR_HOST (0.0.0.0), which is identical for a loopback publish and a
// LAN publish. Unset means loopback — an installation nobody configured is reachable
// locally and nowhere else.
//
// Declaring the publish address here rather than only in the installer keeps the Host
// allowlist and the publish from drifting apart: a LAN publish whose address is not in
// the allowlist answers 421 to every browser request, which looks like an outage.
const bindAddress = (process.env.NOESAR_BIND_ADDRESS ?? '').trim();
const exposureScope = resolveBindScope({ bindAddress, bindScope:process.env.NOESAR_BIND_SCOPE });
if (bindAddress && !isWildcardAddress(bindAddress)) allowedHosts.add(bindAddress.toLowerCase());

const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
const store = new JsonStore(join(workspace, 'state/state.json'));
const aiStore = new AtomicJsonStore(join(workspace, 'state/ai-workspace.json'));
const contextGraph = new ContextGraph(aiStore);
const credentialVault = new CredentialVault({ keyPath:join(workspace, 'config/provider-credentials.key') });
const providerGateway = new ProviderGateway({ store:aiStore, vault:credentialVault, ledger });
providerGateway.ensureDefaults();
const fileExtractor = new FileExtractor({ blobRoot:join(workspace, 'files') });
const aiWorkspace = new WorkspaceService({ store:aiStore, graph:contextGraph, ledger, fileExtractor });
const toolExecutor = new ToolExecutor({ vault:credentialVault, ledger });
const agentService = new AgentService({ store:aiStore, ledger, executor:toolExecutor, vault:credentialVault });
const chatOrchestrator = new ChatOrchestrator({ graph:contextGraph, workspace:aiWorkspace, providers:providerGateway, store:aiStore, ledger });
const hardware = discoverHardware();
// The bootstrap token is resolved from a 0600 runtime file, not from the
// environment: an environment variable is visible in `docker inspect` and in
// /proc/<pid>/environ. It is generated on first run and never logged in full.
const setupTokenState = resolveSetupToken({
  alreadyInitialized: new AuthStore(`${workspace}/state/auth.json`).read().initialized,
});
const auth = new AuthService({
  workspace,
  setupToken: setupTokenState.token,
  ledger,
  secureCookies,
});

// --- data plane and multi-user directory -------------------------------------
const postgres = postgresEnabled
  ? new PostgresSupervisor({
    root: process.env.NOESAR_POSTGRES_ROOT ?? join(workspace, 'postgresql'),
    secretsDir: join(workspace, 'config/postgres'),
  })
  : null;
// A function, not the supervisor itself: the directory is constructed now and the
// database becomes available later, so capturing the value here would capture `null`.
const userDirectory = new UserDirectory({ auth, ledger, dataPlane: () => postgres });
const localModels = new LocalModelRuntime({ workspace });

let currentPrivacyState = PrivacyState.LOCAL_ONLY_VERIFIED;

const PRODUCT = Object.freeze({ name:'NOESAR Evolution', version:'1.0.0-complete-ai-workspace', releaseVersion:'0.6.0' });

// --- observability, recovery and update subsystems ---------------------------
const logger = new Logger({
  dir: join(workspace, 'logs'),
  level: process.env.NOESAR_LOG_LEVEL ?? 'INFO',
  component: 'control-plane',
  maxFileBytes: Number(process.env.NOESAR_LOG_MAX_FILE_BYTES ?? 64 * 1024 * 1024),
  keepFiles: Number(process.env.NOESAR_LOG_KEEP_FILES ?? 14),
  quotaBytes: Number(process.env.NOESAR_LOG_QUOTA_BYTES ?? 2 * 1024 * 1024 * 1024),
});
const metrics = new Metrics({ buildInfo:{ version:PRODUCT.releaseVersion, channel:process.env.NOESAR_RELEASE_CHANNEL ?? 'complete', data_plane:dataPlane.mode ?? 'reference-json' } });
const debugMode = new DebugMode({ logger, ledger });
const timezoneService = new TimezoneService({ store, ledger, logger });
const watchdog = new Watchdog({
  logger, ledger, metrics,
  statePath: watchdogStatePath(workspace),
  notify: (payload) => ledger.append({ actor:'system', action:'owner.notification', result:'raised', details:payload }),
});
const updateManager = new UpdateManager({
  root: join(workspace, 'updates'),
  currentVersion: PRODUCT.releaseVersion,
  ledger, logger, metrics, watchdog,
  backup: async ({ fromVersion, toVersion }) => {
    // The reference data plane is file-backed JSON with no snapshot isolation, so
    // the backup is a verified copy, not a live snapshot.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(workspace, 'backups', `pre-update-${fromVersion}-to-${toVersion}-${stamp}`);
    mkdirSync(target, { recursive:true, mode:0o700 });
    const sources = ['state', 'config', 'audit'];
    for (const name of sources) {
      const from = join(workspace, name);
      if (existsSync(from)) cpSync(from, join(target, name), { recursive:true });
    }
    // A backup is only real once it has been checked: every source directory that
    // existed must exist in the copy, or the update does not proceed.
    const verified = sources.every((name) => !existsSync(join(workspace, name)) || existsSync(join(target, name)));
    writeFileSync(join(target, 'BACKUP.json'), JSON.stringify({ fromVersion, toVersion, createdAt:toUtcIso(), sources, verified }, null, 2), { mode:0o600 });
    return {
      id: target,
      verified,
      restore: async () => {
        for (const name of sources) {
          const from = join(target, name);
          if (existsSync(from)) cpSync(from, join(workspace, name), { recursive:true, force:true });
        }
      },
    };
  },
  healthCheck: async () => !watchdog.safeMode.active,
});
registerWatchdogSubjects(watchdog, {
  workspace, webRoot, dataStore:aiStore, auditLedger:ledger, logger,
  providerGateway, updateManager, agentService, toolExecutor, hardware,
});
metrics.setGauge('noesar_safe_mode', 0);
metrics.setGauge('noesar_data_plane_up', 1);

// Routes that stay available while the runtime is degraded. Everything else that
// mutates is refused in safe mode: the point of safe mode is to preserve
// evidence, not to keep working badly.
const SAFE_MODE_WRITE_ALLOWLIST = new Set([
  '/api/v1/auth/login', '/api/v1/auth/login/mfa', '/api/v1/auth/logout', '/api/v1/auth/reauth',
  '/api/v1/debug/enable', '/api/v1/debug/disable',
  '/api/v1/watchdog/safe-mode/leave', '/api/v1/updates/rollback',
]);

function clientIp(req) { return req.socket.remoteAddress ?? 'unknown'; }

function json(res, status, value, extraHeaders = {}) {
  // A response whose headers are already out cannot be given a status any more.
  // Writing one anyway throws ERR_HTTP_HEADERS_SENT from inside an error handler,
  // which is how a single bad request used to become a process-wide failure.
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    ...securityHeaders({ secureTransport:secureCookies }),
    'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw Object.assign(new Error('Request body too large'), { status:413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request body.'), { status:400 }); }
}

function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const target = normalize(resolve(webRoot, `.${requested}`));
  if (target !== webRoot && !target.startsWith(`${webRoot}${sep}`)) return false;
  try {
    if (!statSync(target).isFile()) return false;
    const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
    const bytes = readFileSync(target);
    res.writeHead(200, {
      ...securityHeaders({ contentSecurityPolicy:true, secureTransport:secureCookies }),
      'content-type':types[extname(target)] ?? 'application/octet-stream',
      'content-length':bytes.length,
    });
    res.end(bytes);
    return true;
  } catch { return false; }
}

function requireSession(req, res, permission = null) {
  const cookies = parseCookies(req.headers.cookie);
  const authenticated = auth.authenticate(cookies.noesar_session);
  if (!authenticated) {
    json(res, 401, { error:'Authentication required.' });
    return null;
  }
  if (permission && !auth.hasPermission(authenticated.user, permission)) {
    ledger.append({ actor:authenticated.user.id, action:'authorization.denied', result:'denied', details:{ permission } });
    json(res, 403, { error:'Permission denied.', permission });
    return null;
  }
  return authenticated;
}

function requireCsrf(req, res, authenticated) {
  if (!auth.verifyCsrf(authenticated.session, req.headers['x-noesar-csrf'])) {
    ledger.append({ actor:authenticated.user.id, action:'csrf.denied', result:'denied' });
    json(res, 403, { error:'CSRF validation failed.' });
    return false;
  }
  return true;
}

function requireOwner(req, res, permission = 'user.read') {
  const authenticated = requireSession(req, res, permission);
  if (!authenticated) return null;
  if (authenticated.user.role !== 'owner') {
    ledger.append({ actor:authenticated.user.id, action:'authorization.denied', result:'denied', details:{ required:'owner' } });
    json(res, 403, { error:'Owner role is required.' });
    return null;
  }
  return authenticated;
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  const bytes = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    ...securityHeaders({ secureTransport:secureCookies }),
    'content-type':contentType,
    'content-length':bytes.length,
  });
  res.end(bytes);
}

function sessionResponse(res, value, status = 200) {
  json(res, status, {
    user:value.user,
    csrfToken:value.csrf,
    session:{ expiresAt:new Date(value.session.expiresAt).toISOString(), idleExpiresAt:new Date(value.session.idleExpiresAt).toISOString() },
  }, { 'set-cookie':auth.cookieHeaders(value) });
}

const server = createServer(async (req, res) => {
  // One correlation id per inbound request, propagated to the client through a
  // response header so a user-visible failure can be found in the logs.
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', requestId);
  const url0 = (() => { try { return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`); } catch { return null; } })();
  res.once('finish', () => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route = url0?.pathname ?? '/';
    metrics.observeHttp({ route, status:res.statusCode, seconds });
    logger.log(res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO', 'http.request', {
      correlation_id:requestId, component:'control-plane',
      http:{ method:req.method, path:route, status:res.statusCode, ms:Math.round(seconds * 1000) },
    });
  });
  if (!validHostHeader(req.headers.host, allowedHosts)) {
    ledger.append({ actor:'anonymous', action:'host-header.denied', result:'denied', details:{ host:req.headers.host } });
    return json(res, 421, { error:'Unrecognized Host header.', requestId });
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    // --- liveness, readiness, health, metrics --------------------------------
    // /livez performs no dependency check on purpose: a slow data plane must
    // never cause a live process to be killed and restarted.
    if (req.method === 'GET' && url.pathname === '/livez') {
      return json(res, 200, { status:'alive', pid:process.pid, uptimeSeconds:Math.round(process.uptime()), checkedAt:toUtcIso() });
    }
    if (req.method === 'GET' && url.pathname === '/readyz') {
      const readiness = buildReadiness({ watchdog, auth, dataPlane });
      return json(res, readiness.ready ? 200 : 503, readiness);
    }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      const health = buildHealth({
        product:PRODUCT, watchdog, auth, authority, dataPlane, logger, updateManager,
        timezone:timezoneService.serverDefault(), debug:debugMode.status(),
      });
      return json(res, health.status === 'unhealthy' ? 503 : 200, health);
    }
    if (req.method === 'GET' && url.pathname === '/metrics') {
      // Authenticated, unless this container is published on loopback AND the peer is
      // a private address. The unauthenticated path is deliberately narrow: behind a
      // published port every caller arrives from the bridge gateway, which is itself
      // an RFC1918 address, so a private peer only implies "a process on this host"
      // while the publish is loopback-only. On a LAN publish it implies nothing, and
      // the exporter (request paths, status codes, safe-mode state, log volume) would
      // otherwise be readable by the whole subnet. See docs/LAN_ACCESS_CONFIGURATION.md.
      if (!allowsUnauthenticatedMetrics(exposureScope, clientIp(req))) {
        const authenticated = requireSession(req, res, 'audit.read');
        if (!authenticated) return;
      }
      metrics.setGauge('noesar_safe_mode', watchdog.safeMode.active ? 1 : 0);
      metrics.setGauge('noesar_log_bytes', logger.stats().bytes);
      metrics.setGauge('noesar_data_plane_up', 1);
      return text(res, 200, metrics.render(), 'text/plain; version=0.0.4; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/diagnostics') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated) return;
      const health = buildHealth({
        product:PRODUCT, watchdog, auth, authority, dataPlane, logger, updateManager,
        timezone:timezoneService.serverDefault(), debug:debugMode.status(),
      });
      return json(res, 200, debugMode.bundle({
        product:PRODUCT,
        host:{ platform:process.platform, arch:process.arch, node:process.version, cpuCores:hardware?.cpu?.cores ?? null },
        timezone:timezoneService.effectiveFor(authenticated.user.id),
        health, watchdog:watchdog.report(), updates:updateManager.status(),
        logs:logger.search({ limit:Number(url.searchParams.get('logLimit') ?? 100) }),
      }));
    }

    // --- safe mode gate -----------------------------------------------------
    // Structural, ahead of the route table, so a new mutating route cannot forget it.
    if (watchdog.safeMode.active
      && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && !SAFE_MODE_WRITE_ALLOWLIST.has(url.pathname)) {
      logger.warn('safe-mode.request.blocked', { correlation_id:requestId, http:{ method:req.method, path:url.pathname } });
      return json(res, 503, {
        error:'NOESAR is in safe mode; providers, agents, tools and state changes are disabled.',
        reason:watchdog.safeMode.reason, since:watchdog.safeMode.since,
        readableInSafeMode:['documents', 'audit history', 'health', 'diagnostics'],
        requestId,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') return json(res, 200, auth.status());
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/setup') {
      const request = await body(req);
      return json(res, 201, auth.beginSetup({ ...request, suppliedSetupToken:req.headers['x-noesar-setup-token'] }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/setup/confirm') {
      const value = auth.confirmSetup(await body(req));
      return sessionResponse(res, value, 201);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') return json(res, 202, auth.beginLogin({ ...(await body(req)), ip:clientIp(req) }));
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login/mfa') {
      const value = auth.completeLogin({ ...(await body(req)), ip:clientIp(req) });
      return sessionResponse(res, value);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/me') {
      const authenticated = requireSession(req, res);
      if (!authenticated) return;
      return json(res, 200, { user:authenticated.user, elevatedUntil:authenticated.session.elevatedUntil });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/reauth') {
      const authenticated = requireSession(req, res, 'coden.owner-bypass');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, auth.reauthenticate({ sessionId:authenticated.session.id, ...(await body(req)) }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      auth.logout(authenticated.session.id, authenticated.user.id);
      return json(res, 200, { loggedOut:true }, { 'set-cookie':auth.clearCookieHeaders() });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/privacy') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      return json(res, 200, { state:currentPrivacyState, banner:privacyBanner(currentPrivacyState) });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/privacy/egress-plan') {
      const authenticated = requireSession(req, res, 'user.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      const plan = evaluateEgress(request);
      currentPrivacyState = plan.state;
      ledger.append({ actor:authenticated.user.id, action:'egress.plan', result:plan.allowed ? 'allowed':'approval-required', details:plan });
      return json(res, 200, plan);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/hardware') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      return json(res, 200, hardware);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/recommendation') {
      const authenticated = requireSession(req, res, 'runtime.plan');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, recommendRuntime(hardware, await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/coden/path-plan') {
      const authenticated = requireSession(req, res, 'coden.plan');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      if (request.mode === 'OWNER_BYPASS' && !auth.hasPermission(authenticated.user, 'coden.owner-bypass')) return json(res, 403, { error:'Owner role is required for Owner Bypass.' });
      const plan = createPathPlan(request, workspace);
      ledger.append({ actor:authenticated.user.id, action:'coden.path-plan', result:plan.blocked ? 'blocked':'planned', details:{ canonicalPath:plan.canonicalPath, risk:plan.risk, mode:plan.mode } });
      return json(res, plan.blocked ? 403 : 200, plan);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/coden/authorize') {
      const authenticated = requireSession(req, res, 'coden.authorize');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      if (!request.plan || !request.consentScope) return json(res, 400, { error:'plan and consentScope are required' });
      if (request.plan.blocked) return json(res, 403, { error:'Blocked path cannot be authorized' });
      if (request.plan.mode === 'OWNER_BYPASS') {
        if (!auth.hasPermission(authenticated.user, 'coden.owner-bypass')) return json(res, 403, { error:'Owner role required.' });
        if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required.' });
      }
      const approval = {
        id:randomUUID(),
        actorId:authenticated.user.id,
        createdAt:new Date().toISOString(),
        expiresAt:new Date(Date.now() + Math.min(Number(request.durationMinutes ?? 15), 60) * 60000).toISOString(),
        consentScope:request.consentScope,
        mode:request.plan.mode,
        canonicalPath:request.plan.canonicalPath,
        operation:request.plan.operation,
        nonBypassableInvariants:request.plan.nonBypassableInvariants,
      };
      store.addApproval(approval);
      ledger.append({ actor:authenticated.user.id, action:'coden.authorize', result:'approved', details:{ id:approval.id, scope:approval.consentScope, path:approval.canonicalPath, mode:approval.mode } });
      return json(res, 201, approval);
    }
    // AI workspace: Ask / Create / Act, versioned context graph and explicit provider control.
    if (req.method === 'GET' && url.pathname === '/api/v1/ai/bootstrap') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      return json(res, 200, { modes:['ASK','CREATE','ACT'], providerCatalog:providerGateway.catalog(), ...aiWorkspace.snapshot() });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/projects') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      return json(res, 200, { projects:contextGraph.listProjects() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/projects') {
      const authenticated = requireSession(req, res, 'workspace.write'); if (!authenticated || !requireCsrf(req,res,authenticated)) return;
      const project=contextGraph.createProject(await body(req)); ledger.append({actor:authenticated.user.id,action:'project.created',result:'success',details:{projectId:project.id}}); return json(res,201,project);
    }
    let match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (match && req.method === 'PATCH') {
      const authenticated=requireSession(req,res,'workspace.write'); if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.updateProject(match[1],await body(req)));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/conversations') {
      const authenticated=requireSession(req,res,'workspace.read'); if(!authenticated)return;
      return json(res,200,{conversations:contextGraph.listConversations({projectId:url.searchParams.get('projectId')})});
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/conversations') {
      const authenticated=requireSession(req,res,'workspace.write'); if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.createConversation(await body(req)));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,contextGraph.getConversation(match[1]));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/messages$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      const branchId=url.searchParams.get('branchId')??contextGraph.getConversation(match[1]).conversation.activeBranchId;
      return json(res,200,{messages:contextGraph.branchMessages(match[1],branchId),branchId});
    }
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.addMessage({conversationId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/messages\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.editMessage({messageId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/messages\/([^/]+)\/exclude$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.setMessageExcluded({messageId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/messages\/([^/]+)\/regenerate$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.regenerateMessage({messageId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/fork$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.fork({conversationId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/merge$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.merge({conversationId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/branches\/([^/]+)\/undo$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.undo({branchId:match[1]}));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/compare$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,contextGraph.compareBranches(match[1],url.searchParams.get('left'),url.searchParams.get('right')));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/context$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,aiWorkspace.contextInspection({conversationId:match[1],branchId:url.searchParams.get('branchId')}));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/search'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      const types=url.searchParams.get('types')?.split(',').filter(Boolean)??null;
      return json(res,200,{results:aiWorkspace.globalSearch(url.searchParams.get('q')??'',{projectId:url.searchParams.get('projectId'),types,limit:Number(url.searchParams.get('limit')??30)})});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/tasks'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{tasks:aiWorkspace.listTasks({projectId:url.searchParams.get('projectId'),status:url.searchParams.get('status')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/tasks'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.createTask({...await body(req),actorId:authenticated.user.id}));
    }
    match=url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.updateTask(match[1],await body(req),authenticated.user.id));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/memories'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{memories:aiWorkspace.listMemories({projectId:url.searchParams.get('projectId'),scope:url.searchParams.get('scope')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/memories'){
      const authenticated=requireSession(req,res,'memory.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.createMemory({...await body(req),actorId:authenticated.user.id}));
    }
    match=url.pathname.match(/^\/api\/v1\/memories\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'memory.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.updateMemory(match[1],await body(req),authenticated.user.id));
    }
    if(match&&req.method==='DELETE'){
      const authenticated=requireSession(req,res,'memory.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.deleteMemory(match[1],authenticated.user.id));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/artifacts'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{artifacts:aiWorkspace.listArtifacts({projectId:url.searchParams.get('projectId'),conversationId:url.searchParams.get('conversationId')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/artifacts'){
      const authenticated=requireSession(req,res,'artifact.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.createArtifact({...await body(req),actorId:authenticated.user.id}));
    }
    match=url.pathname.match(/^\/api\/v1\/artifacts\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'artifact.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.updateArtifact(match[1],{...await body(req),actorId:authenticated.user.id}));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/sources'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{sources:aiWorkspace.listSources({projectId:url.searchParams.get('projectId')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/sources'){
      const authenticated=requireSession(req,res,'knowledge.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.ingestSource({...await body(req),actorId:authenticated.user.id}));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/sources/upload'){
      const authenticated=requireSession(req,res,'knowledge.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.ingestFile({...await body(req),actorId:authenticated.user.id}));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/sources/capabilities'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,extractorCapabilities());
    }
    match=url.pathname.match(/^\/api\/v1\/sources\/([^/]+)$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,aiWorkspace.getSource(match[1]));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/knowledge/search'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{results:aiWorkspace.knowledgeSearch(url.searchParams.get('q')??'',{projectId:url.searchParams.get('projectId'),limit:Number(url.searchParams.get('limit')??12)})});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/providers/catalog'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{providers:providerGateway.catalog()});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/providers'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{providers:providerGateway.list()});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/providers'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const profile=providerGateway.create(await body(req));ledger.append({actor:authenticated.user.id,action:'provider.created',result:'success',details:{providerId:profile.id,type:profile.type}});return json(res,201,profile);
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,providerGateway.update(match[1],await body(req)));
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/health$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated)return;return json(res,200,await providerGateway.probe(match[1]));
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/credential$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,providerGateway.setCredential(match[1],request.apiKey,{persistence:request.persistence}));
    }
    if(match&&req.method==='DELETE'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,providerGateway.clearCredential(match[1]));
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/consent$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const consent=providerGateway.grantConsent(match[1],await body(req));ledger.append({actor:authenticated.user.id,action:'provider.consent',result:consent.consent.granted?'granted':'revoked',details:{providerId:match[1],dataClasses:consent.consent.dataClasses}});return json(res,200,consent);
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/models/compare'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,await chatOrchestrator.compare({actorId:authenticated.user.id,...await body(req)}));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/chat/stream'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      // `await`, not a bare `return`: an un-awaited promise escapes the try/catch below,
      // becomes an unhandled rejection, and Node terminates the process for it.
      return await chatOrchestrator.streamToResponse({res,actorId:authenticated.user.id,...await body(req)});
    }
    match=url.pathname.match(/^\/api\/v1\/chat\/runs\/([^/]+)\/stop$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated||!requireCsrf(req,res,authenticated))return;const stopped=chatOrchestrator.stop(match[1],authenticated.user.id);return json(res,stopped?200:404,{stopped,runId:match[1]});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/tools'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{tools:aiWorkspace.snapshot().tools});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/tools'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,agentService.registerTool(await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/tools\/([^/]+)\/credential$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,agentService.setToolCredential(match[1],request.apiKey,{persistence:request.persistence}));
    }
    match=url.pathname.match(/^\/api\/v1\/tools\/([^/]+)\/consent$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,agentService.grantToolConsent(match[1],await body(req),authenticated.user.id));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/agents'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{agents:aiStore.read().agents.filter((item)=>!item.archived)});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/agents'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,agentService.createAgent(await body(req),authenticated.user.id));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/agent-runs'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,agentService.createRun(await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/agent-runs\/([^/]+)\/steps\/([^/]+)\/execute$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,await agentService.executeStep(match[1],match[2],await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/agent-runs\/([^/]+)\/steps\/([^/]+)\/approve$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,agentService.approveStep(match[1],match[2],authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/agent-runs\/([^/]+)\/steps\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,agentService.updateStep(match[1],match[2],await body(req),authenticated.user.id));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/data/export'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated)return;return json(res,200,aiWorkspace.exportUserData());
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/data/import'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,aiWorkspace.importUserData(request.bundle,{replace:Boolean(request.replace)}));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/data/purge'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.purge(await body(req)));
    }
    if(req.method==='PUT'&&url.pathname==='/api/v1/data/retention'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,aiWorkspace.updateRetention(request.days));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/data/retention/apply'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.applyRetention());
    }
    // --- settings: timezone and locale --------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/settings/timezone') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      const browser = url.searchParams.get('browserTimezone');
      if (browser) timezoneService.recordBrowserTimezone(authenticated.user.id, browser);
      const effective = timezoneService.effectiveFor(authenticated.user.id);
      return json(res, 200, { ...effective, sample:formatInZone(Date.now(), effective.effective, timezoneService.localeFor(authenticated.user.id, req.headers['accept-language']).effective) });
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/settings/timezone') {
      const authenticated = requireSession(req, res, 'user.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      if (request.scope === 'server') {
        const owner = requireOwner(req, res, 'user.read'); if (!owner) return;
        return json(res, 200, timezoneService.setServerTimezone(request.timezone, { actorId:owner.user.id }));
      }
      if (request.timezone === null) return json(res, 200, timezoneService.clearUserTimezone(authenticated.user.id, { actorId:authenticated.user.id }));
      return json(res, 200, timezoneService.setUserTimezone(authenticated.user.id, request.timezone, { actorId:authenticated.user.id }));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/settings/locale') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      return json(res, 200, timezoneService.localeFor(authenticated.user.id, req.headers['accept-language']));
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/settings/locale') {
      const authenticated = requireSession(req, res, 'user.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, timezoneService.setUserLocale(authenticated.user.id, (await body(req)).locale, { actorId:authenticated.user.id }));
    }

    // --- debug mode (owner only, time-boxed) --------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/debug/status') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, debugMode.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/debug/enable') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      return json(res, 200, debugMode.enable({ ...request, actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/debug/disable') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, debugMode.disable({ actorId:authenticated.user.id }));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/debug/bundle') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      const health = buildHealth({
        product:PRODUCT, watchdog, auth, authority, dataPlane, logger, updateManager,
        timezone:timezoneService.serverDefault(), debug:debugMode.status(),
      });
      return json(res, 200, debugMode.bundle({
        product:PRODUCT,
        host:{ platform:process.platform, arch:process.arch, node:process.version },
        timezone:timezoneService.effectiveFor(authenticated.user.id),
        health, watchdog:watchdog.report(), updates:updateManager.status(),
        logs:logger.search({ limit:Number(url.searchParams.get('logLimit') ?? 200) }),
      }));
    }

    // --- operational log search (owner only) --------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/logs') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, logger.search({
        level:url.searchParams.get('level'),
        component:url.searchParams.get('component'),
        correlationId:url.searchParams.get('correlationId'),
        event:url.searchParams.get('event'),
        text:url.searchParams.get('q'),
        since:url.searchParams.get('since'),
        until:url.searchParams.get('until'),
        limit:Math.min(Number(url.searchParams.get('limit') ?? 200), 1000),
      }));
    }

    // --- watchdog and safe mode ---------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/watchdog') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, watchdog.report());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/watchdog/run') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      await watchdog.runOnce({ force:true });
      return json(res, 200, watchdog.report());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/watchdog/safe-mode/leave') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, watchdog.leaveSafeMode({ actorId:authenticated.user.id }));
    }

    // --- update manager (owner only, never automatic) -----------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/updates/status') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, updateManager.status());
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/updates/history') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, { history:updateManager.history() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/check') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.check({ actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/channel') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.setChannel((await body(req)).channel, { actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/stage') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.stage((await body(req)).bundle, { actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/approve') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.approve({ ...(await body(req)), actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/apply') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      // Strong reauthentication, as for any other irreversible owner action.
      if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required.' });
      return json(res, 200, await updateManager.apply({ actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/rollback') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await updateManager.rollback({ actorId:authenticated.user.id, reason:(await body(req)).reason ?? 'manual' }));
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/audit') {
      const authenticated = requireSession(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, { valid:ledger.verify(), events:ledger.readAll().slice(-100) });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/bootstrap') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      return json(res, 200, {
        product:{ name:'NOESAR Evolution', edition:'Open Core Source Implementation', version:'1.0.0' },
        authority,
        dataPlane,
        user:authenticated.user,
        privacy:{ state:currentPrivacyState, banner:privacyBanner(currentPrivacyState) },
        hardware,
        runtimeRecommendation:recommendRuntime(hardware, {}),
        coden:{ modes:authenticated.user.role === 'owner' ? ['NORMAL','OWNER_BYPASS'] : ['NORMAL'], executionEnabled:false, explanation:'Planning and scoped authorization are implemented; host mutation remains disabled.' },
        features:['Ask','Create','Act','Versioned Context Graph','Projects','Documents','Artifacts','Agents','Workflows','CodeN Ultra','Knowledge','Memory','Local and External Providers','MCP and OpenAPI Tools','Compute & Hardware','Data Export and Retention','Update Center'],
      });
    }

    // --- multi-user administration -------------------------------------------
    // Every mutating route here requires user.manage, which only owner and admin hold,
    // plus the CSRF header. The directory itself enforces the narrower rules — an
    // administrator may not mint an owner, nor disable the last one — so a future route
    // cannot grant more than the permission name suggests.
    if (req.method === 'GET' && url.pathname === '/api/v1/admin/users') {
      const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
      return json(res, 200, { users:userDirectory.list() });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/admin/invitations') {
      const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
      return json(res, 200, { invitations:userDirectory.listInvitations() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/invitations') {
      const authenticated = requireSession(req, res, 'user.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const created = userDirectory.createInvitation({ actorId:authenticated.user.id, ...payload });
      // The token is in the response and nowhere else: it is not logged, not stored in
      // cleartext, and cannot be read back from any later request.
      return json(res, 201, { ...created, note:'This token is shown once. It cannot be retrieved again.' });
    }
    {
      const match = url.pathname.match(/^\/api\/v1\/admin\/invitations\/([0-9a-f-]{36})$/);
      if (match && req.method === 'DELETE') {
        const authenticated = requireSession(req, res, 'user.manage');
        if (!authenticated || !requireCsrf(req, res, authenticated)) return;
        return json(res, 200, userDirectory.revokeInvitation({
          actorId:authenticated.user.id, invitationId:match[1],
        }));
      }
    }
    // Invitation acceptance is unauthenticated by necessity — the account does not exist
    // yet — and is protected by the one-time token instead.
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/invitation/accept') {
      return json(res, 200, userDirectory.acceptInvitation(await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/invitation/confirm') {
      const confirmed = userDirectory.confirmInvitationMfa(await body(req));
      // A session is established here for the same reason first-owner setup establishes
      // one: the caller has just presented the invitation token, chosen a password and
      // proved possession of the TOTP secret. That is a complete authentication, and
      // making them log in again immediately afterwards adds a step without adding a
      // check.
      const record = userDirectory.find(confirmed.user.id);
      return sessionResponse(res, auth.createSession(record, { mfa:true }), 201);
    }
    {
      const match = url.pathname.match(/^\/api\/v1\/admin\/users\/([0-9a-f-]{36})(\/[a-z-]+)?$/);
      if (match) {
        const userId = match[1];
        const action = (match[2] ?? '').replace('/', '');
        const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
        if (req.method === 'GET' && action === '') {
          const found = userDirectory.list().find((user) => user.id === userId);
          return json(res, found ? 200 : 404, found ?? { error:'No such account.' });
        }
        if (req.method === 'GET' && action === 'export') {
          return json(res, 200, userDirectory.exportUser({ userId }));
        }
        if (req.method === 'GET' && action === 'events') {
          return json(res, 200, {
            events:userDirectory.administrativeEvents({ subjectUserId:userId, limit:200 }),
          });
        }
        if (!requireCsrf(req, res, authenticated)) return;
        const payload = req.method === 'DELETE' ? {} : await body(req);
        if (req.method === 'POST' && action === 'role') {
          return json(res, 200, userDirectory.setRole({
            actorId:authenticated.user.id, userId, role:payload.role,
          }));
        }
        if (req.method === 'POST' && action === 'disable') {
          return json(res, 200, userDirectory.disableUser({
            actorId:authenticated.user.id, userId, reason:payload.reason ?? null,
          }));
        }
        if (req.method === 'POST' && action === 'revoke') {
          return json(res, 200, userDirectory.revokeUser({
            actorId:authenticated.user.id, userId, reason:payload.reason ?? null,
          }));
        }
        if (req.method === 'POST' && action === 'reinstate') {
          return json(res, 200, userDirectory.reinstateUser({ actorId:authenticated.user.id, userId }));
        }
        if (req.method === 'POST' && action === 'tokens') {
          return json(res, 201, userDirectory.issueServiceToken({
            actorId:authenticated.user.id, userId, name:payload.name, ttlDays:payload.ttlDays ?? null,
          }));
        }
        if (req.method === 'DELETE' && action === '') {
          return json(res, 200, userDirectory.eraseUser({
            actorId:authenticated.user.id, userId, reason:payload.reason ?? null,
          }));
        }
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/service-accounts') {
      const authenticated = requireSession(req, res, 'user.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const created = userDirectory.createServiceAccount({
        actorId:authenticated.user.id, ...(await body(req)),
      });
      return json(res, 201, { ...created, note:'This token is shown once. It cannot be retrieved again.' });
    }
    {
      const match = url.pathname.match(/^\/api\/v1\/admin\/service-tokens\/([0-9a-f-]{36})$/);
      if (match && req.method === 'DELETE') {
        const authenticated = requireSession(req, res, 'user.manage');
        if (!authenticated || !requireCsrf(req, res, authenticated)) return;
        return json(res, 200, userDirectory.revokeServiceToken({
          actorId:authenticated.user.id, tokenId:match[1],
        }));
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/admin/events') {
      const authenticated = requireSession(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, {
        events:userDirectory.administrativeEvents({ limit:Number(url.searchParams.get('limit') ?? 100) }),
      });
    }

    // --- local model runtime --------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/runtime/local-model') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      return json(res, 200, localModels.status());
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/runtime/local-model/profiles') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      return json(res, 200, await localModels.profiles());
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/runtime/local-model/selection') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      const required = url.searchParams.get('requiredVramMiB');
      return json(res, 200, await localModels.select({
        requiredVramMiB:required ? Number(required) : null,
      }));
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/runtime/local-model') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.configure(await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/attach') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.attach());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/launch') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 202, await localModels.launch());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/release') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.release());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/complete') {
      const authenticated = requireSession(req, res, 'provider.use');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.complete(await body(req)));
    }

    // --- database -------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/database/status') {
      const authenticated = requireSession(req, res, 'audit.read'); if (!authenticated) return;
      if (!postgres) return json(res, 200, { mode:dataPlane.mode, postgresql:null });
      return json(res, 200, { mode:dataPlane.mode, postgresql:postgres.status(), health:await postgres.health() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/database/backup') {
      const authenticated = requireOwner(req, res, 'data.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (!postgres) return json(res, 409, { error:'No PostgreSQL data plane is active.' });
      const payload = await body(req);
      return json(res, 201, await postgres.backup({ label:payload.label ?? null }));
    }

    if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
    return json(res, 404, { error:'Not found', requestId });
  } catch (error) {
    const status = Number(error.status ?? 500);
    ledger.append({ actor:'system', action:'request.error', result:'error', details:{ requestId, status, message:error.message } });
    logger.log(status >= 500 ? 'ERROR' : 'WARN', 'http.request.failed', {
      correlation_id:requestId, component:'control-plane',
      http:{ method:req.method, path:url.pathname, status }, error:error.message,
    });
    return json(res, status, { error:status >= 500 ? 'Internal request failure.' : error.message, requestId });
  }
});

// Last resort, not a substitute for handling errors where they happen.
//
// A rejection that reaches this point is a bug, and it is reported as one — but a
// self-hosted single-process product must not die because one request threw. Node's
// default for an unhandled rejection is to terminate; that turned a malformed body
// into a service outage. An uncaught exception is treated differently: the process
// state may be inconsistent, so it exits non-zero and lets the supervisor restart it,
// where the crash-loop detector and safe mode can see it.
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('process.unhandled-rejection', {
    component:'control-plane', error:error.message, stack:error.stack?.split('\n').slice(0, 6).join(' | '),
    note:'request-scoped failure contained; this is a defect, not a normal path',
  });
});
process.on('uncaughtException', (error) => {
  logger.error('process.uncaught-exception', {
    component:'control-plane', error:error.message, stack:error.stack?.split('\n').slice(0, 6).join(' | '),
    note:'process state may be inconsistent; exiting so the supervisor can restart cleanly',
  });
  process.exit(1);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, async () => {
    logger.info('runtime.started', {
      // The bind address is described rather than printed: the sink redacts IPv4
      // literals by product policy, which would turn it into [REDACTED_IP] and make
      // the line useless for the operator who needs it.
      component:'control-plane', port,
      // `bind_scope` is what this process listens on INSIDE its namespace, which in a
      // container is always all-interfaces and therefore says nothing about who can
      // reach it. `exposure_scope` is what the operator published it on OUTSIDE, and
      // it is what the /metrics gate keys off. Neither field carries an address: the
      // sink redacts IPv4 literals, so printing one produces [REDACTED_IP].
      bind_scope: host === '0.0.0.0' || host === '::' ? 'all-interfaces' : 'single-interface',
      exposure_scope:exposureScope,
      metrics_requires_authentication:exposureScope !== 'loopback',
      version:PRODUCT.releaseVersion,
      release_channel:process.env.NOESAR_RELEASE_CHANNEL ?? 'complete',
      data_plane:dataPlane.mode ?? 'reference-json',
      timezone:timezoneService.serverDefault().effective,
      timezone_source_tier:timezoneService.serverDefault().sourceTier,
      safe_mode:watchdog.safeMode.active,
    });
    if (setupTokenState.source === 'file') {
      // Path and fingerprint only. The token itself is never written to a log.
      logger.warn('setup-token.available', {
        component:'auth', path:setupTokenState.path,
        generated:setupTokenState.generated, setup_fingerprint:setupTokenState.fingerprint,
        note:'first-owner setup token; read it from this file on the host',
      });
    } else if (setupTokenState.source === 'none' && !auth.status().initialized) {
      logger.error('setup-token.unavailable', {
        component:'auth',
        note:'first-run setup cannot proceed: set NOESAR_SETUP_TOKEN_FILE',
      });
    }
    // The database is brought up AFTER the listener, on purpose. /livez must answer from
    // the first moment so the container's health check never kills a process that is
    // legitimately still starting a cluster; /readyz reports not-ready throughout, which
    // is exactly the distinction those two endpoints exist to draw.
    if (postgres) {
      try {
        await postgres.start();
        const health = await postgres.health();
        dataPlane = describeDataPlane({ env:process.env, supervisor:postgres, health });
        logger.info('data-plane.ready', {
          component:'data-plane', mode:dataPlane.mode,
          server_version:health.serverVersion, pgvector:health.pgvectorVersion,
          migrations:health.migrationCount, rls_tables:health.rlsTables,
          production_ready:health.productionReady,
        });
        const projection = await userDirectory.projectToDataPlane();
        logger.info('data-plane.identity-projected', { component:'data-plane', ...projection });
      } catch (error) {
        // Fail closed and loudly. A runtime that could not open its declared data plane
        // must not fall back to writing JSON files that nobody will ever read again.
        logger.error('data-plane.failed', {
          component:'data-plane', error:error.message,
          stack:error.stack?.split('\n').slice(0, 6).join(' | '),
          note:'the declared PostgreSQL data plane did not start; refusing to serve against a substitute',
        });
        process.exitCode = 1;
        server.close(() => process.exit(1));
        return;
      }
    }

    await watchdog.runOnce({ force:true }).catch(() => {});
    watchdog.start(Number(process.env.NOESAR_WATCHDOG_INTERVAL_MS ?? 15_000));
    // Debug sessions expire on their own even when no request arrives.
    const sweeper = setInterval(() => debugMode.sweep(), 30_000);
    sweeper.unref?.();
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => {
        // A second signal during shutdown must not start a second shutdown: two
        // concurrent stops of the same cluster is how a checkpoint gets interrupted.
        if (stopping) return;
        stopping = true;
        logger.warn('runtime.stopping', { component:'control-plane', signal });
        watchdog.stop();
        server.close(async () => {
          try {
            await localModels.release();
            if (postgres) await postgres.stop();
          } catch (error) {
            logger.error('runtime.stop-failed', { component:'control-plane', error:error.message });
          }
          process.exit(0);
        });
      });
    }
  });
}
export { server, logger, watchdog, debugMode, updateManager, timezoneService, metrics };

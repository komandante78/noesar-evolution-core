// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AuditLedger } from './audit.mjs';
import { authorityStatus, assertReferenceRuntimeAllowed } from './authority.mjs';
import { dataPlaneStatus, assertDevelopmentDataPlane } from './data-plane.mjs';
import { AuthService, parseCookies } from './auth.mjs';
import { discoverHardware, recommendRuntime } from './hardware.mjs';
import { securityHeaders, validHostHeader } from './http-security.mjs';
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

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const webRoot = resolve(repoRoot, 'apps/webui-static');
const workspace = resolve(process.env.NOESAR_WORKSPACE ?? join(repoRoot, '.workspace'));
const port = Number(process.env.NOESAR_PORT ?? 8088);
const host = process.env.NOESAR_HOST ?? '127.0.0.1';
const secureCookies = process.env.NOESAR_SECURE_COOKIES === 'true';
const authority = assertReferenceRuntimeAllowed(authorityStatus(process.env));
const dataPlane = assertDevelopmentDataPlane(dataPlaneStatus(process.env));
const allowedHosts = new Set(
  (process.env.NOESAR_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,::1')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
);
if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host.toLowerCase());

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
const auth = new AuthService({
  workspace,
  setupToken: process.env.NOESAR_SETUP_TOKEN,
  ledger,
  secureCookies,
});
let currentPrivacyState = PrivacyState.LOCAL_ONLY_VERIFIED;

function clientIp(req) { return req.socket.remoteAddress ?? 'unknown'; }

function json(res, status, value, extraHeaders = {}) {
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

function sessionResponse(res, value, status = 200) {
  json(res, status, {
    user:value.user,
    csrfToken:value.csrf,
    session:{ expiresAt:new Date(value.session.expiresAt).toISOString(), idleExpiresAt:new Date(value.session.idleExpiresAt).toISOString() },
  }, { 'set-cookie':auth.cookieHeaders(value) });
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  res.setHeader('x-request-id', requestId);
  if (!validHostHeader(req.headers.host, allowedHosts)) {
    ledger.append({ actor:'anonymous', action:'host-header.denied', result:'denied', details:{ host:req.headers.host } });
    return json(res, 421, { error:'Unrecognized Host header.', requestId });
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status:'healthy', product:'NOESAR Evolution', version:'1.0.0-complete-ai-workspace', local:true, authentication:auth.status(), authority, dataPlane });
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
      return chatOrchestrator.streamToResponse({res,actorId:authenticated.user.id,...await body(req)});
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
    if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
    return json(res, 404, { error:'Not found', requestId });
  } catch (error) {
    const status = Number(error.status ?? 500);
    ledger.append({ actor:'system', action:'request.error', result:'error', details:{ requestId, status, message:error.message } });
    return json(res, status, { error:status >= 500 ? 'Internal request failure.' : error.message, requestId });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => console.log(`NOESAR reference control plane ${host}:${port}`));
}
export { server };

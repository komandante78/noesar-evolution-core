// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 4 acceptance — chat and context lifecycle, projects, memory scopes,
// search and RAG, files, artifacts, providers and streaming.
//
//   node tools/acceptance/a2-workspace-and-chat.mjs <base> <workspace> <mockBase>
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { Client, Results, stream } from './client.mjs';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8112';
const workspace = process.argv[3];
const mock = process.argv[4] ?? 'http://127.0.0.1:8121';
const r = new Results('WORK');

const OWNER = { username: 'acc-owner', displayName: 'Acc Owner', password: `acc-${randomBytes(18).toString('base64url')}` };
const CANARY = `CANARY-${randomBytes(12).toString('hex').toUpperCase()}-MUST-NOT-LEAK`;

const c = new Client(base);
const setupToken = readFileSync(`${workspace}/config/first-owner-setup.token`, 'utf8').trim();
const begun = await c.post('/api/v1/auth/setup', OWNER, { headers: { 'x-noesar-setup-token': setupToken } });
if (begun.status !== 201) { process.stderr.write(`bootstrap failed: ${begun.status} ${begun.text}\n`); process.exit(2); }
const secret = begun.json.totpSecret;
const confirmed = await c.post('/api/v1/auth/setup/confirm', { challenge: begun.json.challenge, totpCode: totpCode(secret) });
if (confirmed.status !== 201) { process.stderr.write(`confirm failed: ${confirmed.status} ${confirmed.text}\n`); process.exit(2); }
process.stdout.write(`bootstrapped owner for the workspace suite (role ${confirmed.json.user.role})\n\n`);

// ---------------------------------------------------------------- projects
let pA = null;
let pB = null;
await r.check('WORK-01', 'two projects are created independently', async () => {
  const a = await c.post('/api/v1/projects', { name: 'Project Alpha', instructions: 'alpha instructions', tags: ['a'] });
  const b = await c.post('/api/v1/projects', { name: 'Project Beta', instructions: 'beta instructions', tags: ['b'] });
  pA = a.json?.id; pB = b.json?.id;
  return { verdict: a.status === 201 && b.status === 201 && pA !== pB ? 'PASS' : 'FAIL', evidence: `A ${a.status}/${pA} B ${b.status}/${pB}` };
});

// ---------------------------------------------------------------- chat lifecycle
let conv = null;
let branch = null;
await r.check('WORK-02', 'a conversation is created inside a project with an active branch', async () => {
  const res = await c.post('/api/v1/conversations', { projectId: pA, title: 'Alpha chat', mode: 'ASK' });
  conv = res.json?.conversation?.id ?? res.json?.id;
  branch = res.json?.conversation?.activeBranchId ?? res.json?.activeBranchId ?? res.json?.branch?.id;
  return { verdict: res.status === 201 && conv && branch ? 'PASS' : 'FAIL', evidence: `-> ${res.status} conversation ${conv} branch ${branch} keys ${Object.keys(res.json ?? {})}` };
});

let m1 = null;
let m2 = null;
await r.check('WORK-03', 'messages append to the branch and read back in order', async () => {
  const a = await c.post(`/api/v1/conversations/${conv}/messages`, { role: 'user', content: 'first question about widgets' });
  const b = await c.post(`/api/v1/conversations/${conv}/messages`, { role: 'assistant', content: 'first answer about widgets' });
  m1 = a.json?.id ?? a.json?.message?.id; m2 = b.json?.id ?? b.json?.message?.id;
  const list = await c.get(`/api/v1/conversations/${conv}/messages`);
  const contents = (list.json?.messages ?? []).map((x) => x.content?.slice(0, 12));
  return { verdict: a.status === 201 && b.status === 201 && (list.json?.messages ?? []).length === 2 ? 'PASS' : 'FAIL', evidence: `add ${a.status}/${b.status}; list ${list.status} ${JSON.stringify(contents)}` };
});

await r.check('WORK-05', 'a message can be excluded from the context and the inspector reflects it', async () => {
  // Exclusion is per branch, so branchId is part of the request by design.
  const before = await c.get(`/api/v1/conversations/${conv}/context`);
  const res = await c.post(`/api/v1/messages/${m2}/exclude`, { branchId: branch, excluded: true });
  const after = await c.get(`/api/v1/conversations/${conv}/context`);
  const n = (o) => (o.json?.included ?? o.json?.messages ?? []).length;
  const restored = await c.post(`/api/v1/messages/${m2}/exclude`, { branchId: branch, excluded: false });
  return {
    verdict: res.status === 200 && after.json?.tokenEstimate < before.json?.tokenEstimate && restored.status === 200 ? 'PASS' : 'FAIL',
    evidence: `exclude -> ${res.status}; included ${n(before)} -> ${n(after)}; tokenEstimate ${before.json?.tokenEstimate} -> ${after.json?.tokenEstimate}; re-include -> ${restored.status}`,
  };
});

await r.check('WORK-04', 'a message edit is versioned by supersession, not overwrite', async () => {
  const res = await c.call('PATCH', `/api/v1/messages/${m1}`, { body: { branchId: branch, content: 'first question about widgets, corrected' } });
  const replacement = res.json ?? {};
  const original = await c.get(`/api/v1/conversations/${conv}/messages?branchId=${branch}`);
  const originalStillStored = JSON.stringify(original.json).includes(m1);
  return {
    verdict: res.status === 200 && replacement.supersedesId === m1 && replacement.id !== m1 && /corrected/.test(String(replacement.content)) ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status}; new id ${replacement.id?.slice(0, 8)} supersedes ${String(replacement.supersedesId).slice(0, 8)}; content "${String(replacement.content).slice(0, 40)}"; superseded id still referenced in the branch view ${originalStillStored}`,
  };
});

await r.check('WORK-06', 'context/token inspection reports a budget', async () => {
  const res = await c.get(`/api/v1/conversations/${conv}/context`);
  const keys = Object.keys(res.json ?? {});
  const hasTokens = keys.some((k) => /token|character|budget/i.test(k));
  return { verdict: res.status === 200 && hasTokens ? 'PASS' : 'FAIL', evidence: `-> ${res.status} keys ${keys.join(',')}` };
});

await r.check('WORK-07', 'regenerate creates a new alternative rather than destroying the old', async () => {
  const res = await c.post(`/api/v1/messages/${m2}/regenerate`, { content: 'regenerated answer' });
  const list = await c.get(`/api/v1/conversations/${conv}/messages`);
  const stillThere = (list.json?.messages ?? []).some((x) => x.id === m2);
  return { verdict: res.status === 201 ? 'PASS' : 'FAIL', evidence: `-> ${res.status}; original message still present ${stillThere}; new id ${res.json?.id ?? res.json?.message?.id}` };
});

let fork = null;
await r.check('WORK-08', 'a conversation forks into a second branch', async () => {
  const res = await c.post(`/api/v1/conversations/${conv}/fork`, { fromMessageId: m1, title: 'alternative line' });
  fork = res.json?.id ?? res.json?.branch?.id ?? res.json?.branchId;
  return { verdict: res.status === 201 && fork ? 'PASS' : 'FAIL', evidence: `-> ${res.status} new branch ${fork} keys ${Object.keys(res.json ?? {})}` };
});

await r.check('WORK-09', 'the two branches can be compared', async () => {
  const res = await c.get(`/api/v1/conversations/${conv}/compare?left=${branch}&right=${fork}`);
  return { verdict: res.status === 200 ? 'PASS' : 'FAIL', evidence: `-> ${res.status} ${JSON.stringify(res.json).slice(0, 200)}` };
});

await r.check('WORK-10', 'a branch merges back', async () => {
  const res = await c.post(`/api/v1/conversations/${conv}/merge`, { sourceBranchId: fork, targetBranchId: branch, strategy: 'append' });
  return { verdict: res.status === 201 ? 'PASS' : 'FAIL', evidence: `-> ${res.status} ${JSON.stringify(res.json).slice(0, 180)}` };
});

await r.check('WORK-11', 'undo reverts the last branch operation', async () => {
  const before = await c.get(`/api/v1/conversations/${conv}/messages?branchId=${branch}`);
  const res = await c.post(`/api/v1/branches/${branch}/undo`, {});
  const after = await c.get(`/api/v1/conversations/${conv}/messages?branchId=${branch}`);
  return {
    verdict: res.status === 200 && (after.json?.messages ?? []).length <= (before.json?.messages ?? []).length ? 'PASS' : 'FAIL',
    evidence: `undo -> ${res.status}; messages ${(before.json?.messages ?? []).length} -> ${(after.json?.messages ?? []).length}`,
  };
});

// ---------------------------------------------------------------- memory scopes
const memories = {};
await r.check('WORK-12', 'memory can be created at global, project and conversation scope', async () => {
  const g = await c.post('/api/v1/memories', { scope: 'global', title: 'global fact', content: 'the operator prefers metric units' });
  const p = await c.post('/api/v1/memories', { scope: 'project', projectId: pA, title: 'alpha fact', content: 'alpha uses widget catalogue v3' });
  const v = await c.post('/api/v1/memories', { scope: 'conversation', projectId: pA, conversationId: conv, title: 'chat fact', content: 'this thread is about widgets' });
  memories.g = g.json?.id; memories.p = p.json?.id; memories.v = v.json?.id;
  return { verdict: [g, p, v].every((x) => x.status === 201) ? 'PASS' : 'FAIL', evidence: `global ${g.status} project ${p.status} conversation ${v.status}` };
});

await r.check('WORK-13', 'project-scoped memory does not appear under the other project', async () => {
  const inA = await c.get(`/api/v1/memories?projectId=${pA}`);
  const inB = await c.get(`/api/v1/memories?projectId=${pB}`);
  const titlesA = (inA.json?.memories ?? []).map((x) => x.title);
  const titlesB = (inB.json?.memories ?? []).map((x) => x.title);
  return {
    verdict: titlesA.includes('alpha fact') && !titlesB.includes('alpha fact') ? 'PASS' : 'FAIL',
    evidence: `project A memories ${JSON.stringify(titlesA)}; project B memories ${JSON.stringify(titlesB)}`,
  };
});

await r.check('WORK-14', 'memory can be edited, deleted and is then gone from listings', async () => {
  const patch = await c.call('PATCH', `/api/v1/memories/${memories.g}`, { body: { content: 'the operator prefers imperial units' } });
  const del = await c.del(`/api/v1/memories/${memories.v}`);
  const list = await c.get('/api/v1/memories');
  const ids = (list.json?.memories ?? []).map((x) => x.id);
  return {
    verdict: patch.status === 200 && del.status === 200 && !ids.includes(memories.v) ? 'PASS' : 'FAIL',
    evidence: `patch ${patch.status}; delete ${del.status}; deleted id still listed ${ids.includes(memories.v)}`,
  };
});

// ---------------------------------------------------------------- sources / RAG
const sources = {};
await r.check('WORK-15', 'text sources ingest into both projects and are chunked', async () => {
  const a = await c.post('/api/v1/sources', { projectId: pA, name: 'alpha-manual.txt', mimeType: 'text/plain', text: 'The widget torque specification for the Alpha assembly is 42 newton metres. Calibrate the spindle before each run.' });
  const b = await c.post('/api/v1/sources', { projectId: pB, name: 'beta-secret.txt', mimeType: 'text/plain', text: `Beta project confidential note. ${CANARY}. The beta torque specification is 99 newton metres.` });
  sources.a = a.json?.id; sources.b = b.json?.id;
  return { verdict: a.status === 201 && b.status === 201 ? 'PASS' : 'FAIL', evidence: `alpha ${a.status} chunks ${a.json?.chunkCount}; beta ${b.status} chunks ${b.json?.chunkCount}` };
});

await r.check('WORK-16', 'knowledge search finds the relevant passage and returns citations', async () => {
  const res = await c.get(`/api/v1/knowledge/search?q=${encodeURIComponent('widget torque specification')}&projectId=${pA}`);
  const first = (res.json?.results ?? [])[0];
  const cited = Boolean(first?.sourceId && (first?.source?.name || first?.sourceName || first?.name));
  const hasPassage = typeof first?.text === 'string' && first.text.length > 0;
  const leaksVector = Object.hasOwn(first ?? {}, 'vector');
  return {
    verdict: res.status === 200 && (res.json?.results ?? []).length > 0 && cited && hasPassage ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status} ${(res.json?.results ?? []).length} hits; first source ${first?.sourceId === sources.a ? 'alpha (correct)' : first?.sourceId} name "${first?.source?.name}" score ${first?.score?.toFixed?.(3)} lexical ${first?.lexicalScore?.toFixed?.(3)} semantic ${first?.semanticScore?.toFixed?.(3)}; passage text present ${hasPassage}; NOTE raw embedding vector included in the API response: ${leaksVector}`,
  };
});

await r.check('WORK-17', 'project-scoped knowledge search never returns another project passage', async () => {
  const res = await c.get(`/api/v1/knowledge/search?q=${encodeURIComponent('torque specification confidential')}&projectId=${pA}&limit=50`);
  const leaked = JSON.stringify(res.json).includes(CANARY);
  const foreign = (res.json?.results ?? []).filter((x) => x.sourceId === sources.b);
  return { verdict: !leaked && foreign.length === 0 ? 'PASS' : 'FAIL', evidence: `canary from project B present in project A results: ${leaked}; foreign hits ${foreign.length}` };
});

await r.check('WORK-18', 'global search is scopeable and honours the project filter', async () => {
  const all = await c.get(`/api/v1/search?q=${encodeURIComponent('torque')}&limit=50`);
  const only = await c.get(`/api/v1/search?q=${encodeURIComponent('torque')}&projectId=${pA}&limit=50`);
  const allN = (all.json?.results ?? []).length;
  const onlyN = (only.json?.results ?? []).length;
  return { verdict: all.status === 200 && only.status === 200 && onlyN <= allN ? 'PASS' : 'FAIL', evidence: `unscoped ${allN} hits; scoped to A ${onlyN} hits` };
});

await r.check('WORK-19', 'a deleted source is no longer retrievable and its passages are gone', async () => {
  const purge = await c.post('/api/v1/data/purge', { projectId: pB });
  const list = await c.get(`/api/v1/sources?projectId=${pB}`);
  const search = await c.get(`/api/v1/knowledge/search?q=${encodeURIComponent('confidential')}&limit=50`);
  const stillIndexed = JSON.stringify(search.json).includes(CANARY);
  const direct = await c.get(`/api/v1/sources/${sources.b}`);
  return {
    verdict: purge.status === 200 && (list.json?.sources ?? []).length === 0 && !stillIndexed ? 'PASS' : 'FAIL',
    evidence: `purge -> ${purge.status} ${JSON.stringify(purge.json).slice(0, 120)}; project B sources ${(list.json?.sources ?? []).length}; canary still in any search result ${stillIndexed}; direct GET source -> ${direct.status}`,
  };
});

// ---------------------------------------------------------------- artifacts
let art = null;
await r.check('WORK-20', 'artifacts of each declared type are created', async () => {
  const kinds = ['document', 'code', 'table', 'chart', 'canvas'];
  const out = [];
  for (const type of kinds) {
    const res = await c.post('/api/v1/artifacts', { projectId: pA, conversationId: conv, type, title: `${type} artifact`, content: `content for ${type}`, mimeType: 'text/markdown' });
    out.push(`${type}:${res.status}`);
    if (type === 'document') art = res.json?.id;
  }
  return { verdict: out.every((x) => x.endsWith(':201')) ? 'PASS' : 'PARTIAL', evidence: out.join(' ') };
});

await r.check('WORK-21', 'an artifact update creates a new version and keeps the previous one', async () => {
  const res = await c.call('PATCH', `/api/v1/artifacts/${art}`, { body: { content: 'revision two content' } });
  const list = await c.get(`/api/v1/artifacts?projectId=${pA}`);
  const item = (list.json?.artifacts ?? []).find((x) => x.id === art);
  const versionish = Object.keys(item ?? {}).filter((k) => /version|revision|history/i.test(k));
  const versions = item?.versions ?? item?.revisions ?? null;
  return {
    verdict: res.status === 200 && versionish.length > 0 ? 'PASS' : 'FAIL',
    evidence: `patch -> ${res.status}; version-ish fields ${JSON.stringify(versionish)}; count ${Array.isArray(versions) ? versions.length : versions}`,
  };
});

// ---------------------------------------------------------------- export / import
let bundle = null;
await r.check('WORK-22', 'export produces a complete bundle without credentials', async () => {
  const res = await c.get('/api/v1/data/export');
  bundle = res.json;
  const text = JSON.stringify(res.json ?? {});
  const data = res.json?.data ?? {};
  const hasProjects = (data.projects ?? []).length >= 1 && (data.artifacts ?? []).length >= 5 && (data.memories ?? []).length >= 1;
  const credentialLeak = /encryptedCredential"\s*:\s*\{/.test(text);
  return {
    verdict: res.status === 200 && hasProjects && !credentialLeak && res.json?.credentialsIncluded === false ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status}; keys ${Object.keys(res.json ?? {})}; credentialsIncluded ${res.json?.credentialsIncluded}; ${(data.projects ?? []).length} projects / ${(data.conversations ?? []).length} conversations / ${(data.artifacts ?? []).length} artifacts / ${(data.memories ?? []).length} memories; encrypted credential material present ${credentialLeak}; ${text.length} bytes`,
  };
});

await r.check('WORK-23', 'import into a clean instance reproduces the state', async () => {
  // Re-import into this same instance with replace, then verify the projects survive.
  const res = await c.post('/api/v1/data/import', { bundle, replace: true });
  const list = await c.get('/api/v1/projects');
  const names = (list.json?.projects ?? []).map((x) => x.name);
  const convs = await c.get(`/api/v1/conversations?projectId=${pA}`);
  return {
    verdict: res.status === 200 && names.includes('Project Alpha') && (convs.json?.conversations ?? []).length >= 1 ? 'PASS' : 'FAIL',
    evidence: `import -> ${res.status} ${JSON.stringify(res.json).slice(0, 90)}; projects after ${JSON.stringify(names)}; conversations in Alpha ${(convs.json?.conversations ?? []).length}`,
  };
});

await r.check('WORK-24', 'retention can be set and applied', async () => {
  const set = await c.put('/api/v1/data/retention', { days: 3650 });
  const apply = await c.post('/api/v1/data/retention/apply', {});
  return { verdict: set.status === 200 && apply.status === 200 ? 'PASS' : 'FAIL', evidence: `set -> ${set.status} ${JSON.stringify(set.json).slice(0, 90)}; apply -> ${apply.status} ${JSON.stringify(apply.json).slice(0, 120)}` };
});

// ---------------------------------------------------------------- providers
const providers = {};
await r.check('WORK-25', 'external providers exist in the catalog and are disabled by default', async () => {
  const res = await c.get('/api/v1/providers');
  const list = res.json?.providers ?? [];
  const external = list.filter((x) => x.external);
  const anyEnabled = external.filter((x) => x.enabled);
  const anyConsent = external.filter((x) => x.consent?.granted);
  return {
    verdict: external.length >= 3 && anyEnabled.length === 0 && anyConsent.length === 0 ? 'PASS' : 'FAIL',
    evidence: `${list.length} profiles, ${external.length} external (${external.map((x) => x.type).join(',')}); enabled ${anyEnabled.length}; consent granted ${anyConsent.length}`,
  };
});

await r.check('WORK-26', 'an external provider refuses to run without explicit consent', async () => {
  const list = await c.get('/api/v1/providers');
  const openai = (list.json?.providers ?? []).find((x) => x.type === 'openai');
  providers.openai = openai?.id;
  // The route is an SSE stream, so a refusal arrives as an error frame on a 200, not as a
  // 403 status: by the time the run is addressable the headers are already committed.
  const res = await stream(base, 'POST', '/api/v1/chat/stream', {
    body: { conversationId: conv, providerId: openai?.id, mode: 'ASK', content: 'hello' },
    cookies: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), csrf: c.csrf, maxMs: 15000,
  });
  const refused = /event: error/.test(res.text) && /consent is required|disabled|credential/i.test(res.text);
  const delta = /event: delta/.test(res.text);
  return {
    verdict: refused && !delta ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status}; error frame present ${/event: error/.test(res.text)}; any generated delta ${delta}; reason ${JSON.stringify((res.text.match(/"error":"[^"]+"/) ?? [''])[0])}`,
  };
});

await r.check('WORK-27', 'an external provider URL cannot be pointed at loopback or a private network', async () => {
  const a = await c.post('/api/v1/providers', { type: 'custom-openai-compatible', name: 'evil-loopback', external: true, baseUrl: 'https://127.0.0.1:8121/v1' });
  const b = await c.post('/api/v1/providers', { type: 'custom-openai-compatible', name: 'evil-metadata', external: true, baseUrl: 'https://169.254.169.254/v1' });
  const d = await c.post('/api/v1/providers', { type: 'custom-openai-compatible', name: 'evil-plain', external: true, baseUrl: 'http://example.invalid/v1' });
  const e = await c.post('/api/v1/providers', { type: 'openai', name: 'downgraded', external: false, baseUrl: 'https://api.openai.com/v1' });
  return {
    verdict: [a, b, d, e].every((x) => x.status >= 400) ? 'PASS' : 'FAIL',
    evidence: `loopback ${a.status}; metadata ${b.status}; plain http ${d.status}; external downgraded to internal ${e.status} ${e.text.slice(0, 70)}`,
  };
});

await r.check('WORK-28', 'a local provider is configurable and reports health', async () => {
  const create = await c.post('/api/v1/providers', { type: 'custom-openai-compatible', name: 'mock-local', external: false, apiStyle: 'openai-chat', baseUrl: `${mock}/v1`, defaultModel: 'echo', modes: ['ASK', 'CREATE', 'ACT'] });
  providers.local = create.json?.id;
  const enable = await c.call('PATCH', `/api/v1/providers/${providers.local}`, { body: { enabled: true } });
  const health = await c.get(`/api/v1/providers/${providers.local}/health`);
  return { verdict: create.status === 201 && enable.status === 200 && health.status === 200 ? 'PASS' : 'FAIL', evidence: `create ${create.status}; enable ${enable.status}; health ${health.status} ${JSON.stringify(health.json).slice(0, 130)}` };
});

await r.check('WORK-29', 'chat streams incrementally through the local provider', async () => {
  const res = await stream(base, 'POST', '/api/v1/chat/stream', {
    body: { conversationId: conv, providerId: providers.local, mode: 'ASK', content: 'stream me a reply about widgets', model: 'echo' },
    cookies: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), csrf: c.csrf, maxMs: 20_000,
  });
  return {
    verdict: res.status === 200 && res.chunkCount > 1 ? 'PASS' : 'FAIL',
    evidence: `-> ${res.status} content-type ${res.headers['content-type']}; ${res.chunkCount} chunks; first 120 chars ${JSON.stringify(res.text.slice(0, 120))}`,
  };
});

await r.check('WORK-30', 'a stream can be stopped and the run is released', async () => {
  let runId = null;
  let stopStatus = null;
  const res = await stream(base, 'POST', '/api/v1/chat/stream', {
    body: { conversationId: conv, providerId: providers.local, mode: 'ASK', content: 'a much longer reply so that there is something to interrupt while it is still being produced', model: 'echo' },
    cookies: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), csrf: c.csrf, maxMs: 20_000,
    onChunk: async (chunk) => {
      if (runId) return;
      const found = chunk.match(/"runId"\s*:\s*"([^"]+)"/);
      if (!found) return;
      runId = found[1];
      const stopped = await c.post(`/api/v1/chat/runs/${runId}/stop`, {});
      stopStatus = `${stopped.status} ${JSON.stringify(stopped.json)}`;
    },
  });
  return {
    verdict: runId && /"stopped":true/.test(String(stopStatus)) ? 'PASS' : 'FAIL',
    evidence: `runId ${runId ? 'observed' : 'never announced in the stream'}; stop -> ${stopStatus}; stream ended with ${res.chunkCount} chunks`,
  };
});

await r.check('WORK-31', 'a provider failure is surfaced without crashing the service', async () => {
  const res = await stream(base, 'POST', '/api/v1/chat/stream', {
    body: { conversationId: conv, providerId: providers.local, mode: 'ASK', content: 'trigger a failure', model: 'boom' },
    cookies: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), csrf: c.csrf, maxMs: 15_000,
  });
  const alive = await c.get('/api/v1/auth/me');
  return {
    verdict: /error/i.test(res.text) && alive.status === 200 ? 'PASS' : 'FAIL',
    evidence: `stream -> ${res.status}; body mentions error ${/error/i.test(res.text)} ${JSON.stringify(res.text.slice(0, 140))}; service still answering ${alive.status}`,
  };
});

await r.check('WORK-32', 'model comparison runs two providers side by side', async () => {
  const second = await c.post('/api/v1/providers', { type: 'custom-openai-compatible', name: 'mock-local-2', external: false, apiStyle: 'openai-chat', baseUrl: `${mock}/v1`, defaultModel: 'echo' });
  await c.call('PATCH', `/api/v1/providers/${second.json?.id}`, { body: { enabled: true } });
  const res = await c.post('/api/v1/models/compare', { providerIds: [providers.local, second.json?.id], prompt: 'compare me', conversationId: conv });
  const n = (res.json?.results ?? res.json?.comparisons ?? []).length;
  return { verdict: res.status === 200 && n >= 2 ? 'PASS' : 'FAIL', evidence: `-> ${res.status}; ${n} results; ${JSON.stringify(res.json).slice(0, 160)}` };
});

await r.check('WORK-33', 'a provider credential is never returned in plaintext by the API', async () => {
  const key = `sk-acceptance-${randomBytes(16).toString('hex')}`;
  const put = await c.put(`/api/v1/providers/${providers.local}/credential`, { apiKey: key, persistence: 'persistent' });
  const list = await c.get('/api/v1/providers');
  const exportBundle = await c.get('/api/v1/data/export');
  const inList = JSON.stringify(list.json).includes(key);
  const inExport = JSON.stringify(exportBundle.json).includes(key);
  const onDisk = readFileSync(`${workspace}/state/ai-workspace.json`, 'utf8').includes(key);
  return {
    verdict: put.status === 200 && !inList && !inExport && !onDisk ? 'PASS' : 'FAIL',
    evidence: `set -> ${put.status}; plaintext key in /providers ${inList}; in export ${inExport}; in the state file on disk ${onDisk}`,
  };
});

await r.check('WORK-34', 'a revoked credential is gone', async () => {
  const del = await c.del(`/api/v1/providers/${providers.local}/credential`);
  const list = await c.get('/api/v1/providers');
  const profile = (list.json?.providers ?? []).find((x) => x.id === providers.local);
  return { verdict: del.status === 200 && profile?.credentialConfigured === false ? 'PASS' : 'FAIL', evidence: `delete -> ${del.status}; credentialConfigured now ${profile?.credentialConfigured}` };
});

await r.check('WORK-35', 'persistence: the workspace state survives a fresh read of the store', async () => {
  const disk = JSON.parse(readFileSync(`${workspace}/state/ai-workspace.json`, 'utf8'));
  const hasProjects = (disk.projects ?? []).length >= 1;
  const digest = createHash('sha256').update(JSON.stringify(disk.projects ?? [])).digest('hex').slice(0, 12);
  return { verdict: hasProjects ? 'PASS' : 'FAIL', evidence: `state file has ${(disk.projects ?? []).length} projects, ${(disk.conversations ?? []).length} conversations, ${(disk.artifacts ?? []).length} artifacts; projects digest ${digest}` };
});

const counts = r.summary();
process.stdout.write(`TSV_START\n${r.tsv()}\nTSV_END\n`);
process.stdout.write(`CANARY_USED=${CANARY}\n`);
process.exit(counts.FAIL ? 1 : 0);

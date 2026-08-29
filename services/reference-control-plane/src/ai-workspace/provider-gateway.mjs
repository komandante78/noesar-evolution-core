// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { redactMessages } from './privacy-redaction.mjs';
import { resolvePublicAddresses } from './address-guard.mjs';
import { localRuntimeProfileFrom, LOCAL_RUNTIME_PROFILE_ID } from './active-runtime-provider.mjs';
import { newToolCallState, observeToolCallFrame, finishToolCalls } from './tool-call-stream.mjs';

const STYLES = new Set(['openai-responses','openai-chat','anthropic-messages']);
const LOCAL_HOSTS = new Set(['localhost','127.0.0.1','::1','host.docker.internal']);
const DEFAULT_CATALOG = Object.freeze([
  { type:'local-openai-compatible', name:'Local OpenAI-compatible', apiStyle:'openai-chat', baseUrl:'http://127.0.0.1:11434/v1', external:false, credentialRequired:false },
  { type:'openai', name:'OpenAI', apiStyle:'openai-responses', baseUrl:'https://api.openai.com/v1', external:true, credentialRequired:true },
  { type:'anthropic', name:'Anthropic Claude', apiStyle:'anthropic-messages', baseUrl:'https://api.anthropic.com/v1', external:true, credentialRequired:true },
  { type:'kimi', name:'Kimi / Moonshot AI', apiStyle:'openai-chat', baseUrl:'https://api.moonshot.cn/v1', external:true, credentialRequired:true },
  { type:'custom-openai-compatible', name:'Custom OpenAI-compatible', apiStyle:'openai-chat', baseUrl:null, external:true, credentialRequired:'optional' },
]);

function now() { return new Date().toISOString(); }
// A pooled keep-alive connection that the upstream has already closed fails with
// UND_ERR_SOCKET "other side closed". Every provider closes idle connections eventually,
// so the first request after a pause can fail for a reason that has nothing to do with
// the request. undici does not retry it because a POST is not idempotent in general — but
// a request that never reached the server produced no tokens and cost no money, so
// retrying exactly once, only on this class of failure, is safe and is the difference
// between a working chat and an intermittent error the operator cannot explain.
function isStaleConnection(error){
  const code=error?.cause?.code??error?.code;
  const message=String(error?.cause?.message??'');
  return code==='UND_ERR_SOCKET'||code==='ECONNRESET'||code==='EPIPE'||/other side closed|socket hang up/i.test(message);
}
/**
 * F4-010, closed s336 — one choke point, so a provider path cannot be added without the check.
 *
 * `validateBaseUrl` below refuses forbidden LITERALS at registration. This refuses a NAME that
 * resolves inward, at the moment of the call, which is the half the register recorded as open:
 * `https://internal.example.test/v1` passed every string test and was dialled anyway.
 *
 * WHAT IS AND IS NOT IN FORCE HERE, stated rather than implied. Provider calls are CHECKED and
 * not PINNED: the name is resolved and refused if it points inward, but the socket layer resolves
 * it again, so a resolver that answers differently the second time is not stopped on this path.
 * Pinning is in force in `tool-executor.mjs`, which is the surface SEC-15 actually names.
 *
 * That split is not a preference. Pinning needs `node:https` (see `address-guard.mjs` on why not
 * `fetch`), and node:https walks past a stubbed `globalThis.fetch` — which is exactly how this
 * product's suite isolates the provider path. The first build of this change made `npm test`
 * place a REAL request to api.openai.com, which is a worse defect than the rebinding window it
 * would have closed. Checked-and-not-pinned is still strictly better than the unchecked state it
 * replaces, and naming which of the two is in force is the difference between a declared residual
 * risk and a surprise.
 */
async function assertReachableAddress(url, external, lookup) {
  if (!external) return; // a local provider is SUPPOSED to be on a private address
  await resolvePublicAddresses(new URL(String(url)).hostname, lookup ? { lookup } : {});
}
async function fetchOnceRetryingStaleSocket(url,init,{external=false,lookup=null}={}){
  await assertReachableAddress(url,external,lookup);
  // The TRANSPORT stays `fetch` here, deliberately. `guardedFetch` would also pin the address,
  // but it speaks node:https and so walks past a stubbed `globalThis.fetch` -- which is how this
  // suite isolates the provider path, and the first build of this change made a REAL call to
  // api.openai.com from `npm test`. A test suite that reaches the internet is a worse defect
  // than the rebinding window it would have closed. Pinning is in force where it costs nothing:
  // `tool-executor.mjs`, which is the surface SEC-15 actually names.
  const send=fetch;
  try { return await send(url,init); }
  catch(error){
    if(!isStaleConnection(error)||init?.signal?.aborted)throw error;
    return await send(url,init);
  }
}
function describeFetchFailure(error){
  const cause=error?.cause;
  const detail=[cause?.code,cause?.message].filter(Boolean).join(' ');
  return detail?`${error.message} (${detail})`:String(error?.message??error);
}
function statusError(message, status=400) { return Object.assign(new Error(message), { status }); }
function isPrivateIpv4(host) {
  const parts = host.split('.').map(Number); if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
function validateBaseUrl(value, external) {
  let url; try { url = new URL(String(value)); } catch { throw statusError('Invalid provider baseUrl.'); }
  if (url.username || url.password || url.search || url.hash) throw statusError('Provider baseUrl cannot contain credentials, query or fragment.');
  const host = url.hostname.toLowerCase();
  if (['169.254.169.254','metadata.google.internal','100.100.100.200'].includes(host)) throw statusError('Cloud metadata endpoints are forbidden.');
  if (external && url.protocol !== 'https:') throw statusError('External providers require HTTPS.');
  if (external && (LOCAL_HOSTS.has(host) || isPrivateIpv4(host) || (isIP(host) === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd'))))) throw statusError('External provider URLs cannot target loopback or private networks.');
  if (!external && url.protocol !== 'http:' && url.protocol !== 'https:') throw statusError('Local provider URL must use HTTP or HTTPS.');
  if (!external && !(LOCAL_HOSTS.has(host) || isPrivateIpv4(host) || (isIP(host) === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd'))))) {
    throw statusError('Local providers must resolve to loopback or a private network address.');
  }
  return url.toString().replace(/\/$/, '');
}
function publicProfile(profile) {
  const { encryptedCredential, ...safe } = profile;
  return { ...safe, credentialConfigured:Boolean(encryptedCredential || profile.credentialEphemeral) };
}

// A tool round-trip needs two fields this mapper used to drop on the floor: the assistant turn
// that REQUESTED the calls carries `tool_calls`, and each result turn carries the `tool_call_id`
// that pairs it back. Without them the second round of a tool loop is a conversation where the
// model is shown answers to questions it has no record of asking, and every provider rejects it.
// Both are emitted only when present, so an ordinary text turn produces the exact object it did.
function mapOpenAiMessages(messages) {
  return messages.map((message) => {
    const mapped = { role:message.role === 'tool' ? 'tool' : message.role, content:message.content };
    if (message.tool_calls) mapped.tool_calls = message.tool_calls;
    if (message.tool_call_id) mapped.tool_call_id = message.tool_call_id;
    return mapped;
  });
}
function extractOpenAiResponses(value) {
  if (typeof value.output_text === 'string') return value.output_text;
  return (value.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text).join('');
}
function extractOpenAiChat(value) { return value.choices?.[0]?.message?.content ?? ''; }
function extractAnthropic(value) { return (value.content ?? []).filter((item) => item.type === 'text').map((item) => item.text).join(''); }

/** Did a NON-streaming answer contain a tool call? Three styles, three places it lives — the same
 *  divergence `tool-call-stream.mjs` handles for the streaming case, kept here rather than there
 *  because a whole response needs no reassembly and sharing the fold would mean pretending it did. */
export function toolCallsPresent(style, value) {
  if (!value || typeof value !== 'object') return false;
  if (style === 'anthropic-messages') return (value.content ?? []).some((item) => item?.type === 'tool_use');
  if (style === 'openai-responses') return (value.output ?? []).some((item) => item?.type === 'function_call');
  return Boolean(value.choices?.[0]?.message?.tool_calls?.length);
}

// Usage is reported differently per style, and by a different frame than the text deltas:
// openai-chat only attaches it to the final chunk, and only when the request asked for it
// (`stream_options.include_usage`, set in #request()) — the chunk that carries it has an
// empty `choices` array, so a reader that only ever looked at `choices[0]` would silently
// never see it. openai-responses carries it once, on `response.completed`. anthropic-messages
// splits it across two events (`message_start` has input tokens, `message_delta` has the
// running output count) and never repeats the input count, so both have to be remembered
// and merged rather than either being read alone.
function usageFrom(style, event, remembered) {
  if (style === 'openai-chat') {
    const usage = event.usage;
    if (!usage) return null;
    return { promptTokens:usage.prompt_tokens ?? null, completionTokens:usage.completion_tokens ?? null, totalTokens:usage.total_tokens ?? null };
  }
  if (style === 'openai-responses') {
    if (event.type !== 'response.completed') return null;
    const usage = event.response?.usage;
    if (!usage) return null;
    return { promptTokens:usage.input_tokens ?? null, completionTokens:usage.output_tokens ?? null, totalTokens:usage.total_tokens ?? null };
  }
  if (style === 'anthropic-messages') {
    if (event.type === 'message_start') { remembered.promptTokens = event.message?.usage?.input_tokens ?? null; return null; }
    if (event.type === 'message_delta') {
      const completionTokens = event.usage?.output_tokens ?? null;
      const promptTokens = remembered.promptTokens ?? null;
      const totalTokens = promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null;
      return { promptTokens, completionTokens, totalTokens };
    }
    return null;
  }
  return null;
}
async function *parseSse(response, style, signal) {
  if (!response.body) throw statusError('Provider returned no streaming body.', 502);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const remembered = {};
  // Tool calls are folded across the whole stream and emitted ONCE, at the end, on a frame of
  // their own. They cannot be yielded as they arrive: the arguments are a JSON document cut at
  // arbitrary character boundaries, so a partial fragment is not a partial call — it is not a
  // call at all. See tool-call-stream.mjs for the per-style join rules.
  const toolState = newToolCallState();
  while (true) {
    if (signal?.aborted) throw Object.assign(new Error('Generation stopped.'), { name:'AbortError', status:499 });
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream:true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let split;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      let event; try { event = JSON.parse(data); } catch { continue; }
      let delta = '';
      if (style === 'openai-chat') delta = event.choices?.[0]?.delta?.content ?? '';
      else if (style === 'openai-responses') delta = event.type === 'response.output_text.delta' ? event.delta ?? '' : '';
      else if (style === 'anthropic-messages') delta = event.type === 'content_block_delta' ? event.delta?.text ?? '' : '';
      observeToolCallFrame(style, event, toolState);
      const usage = usageFrom(style, event, remembered);
      if (delta || usage) yield { delta, usage };
    }
  }
  // Emitted only when there is something to emit, so a stream with no tool calls yields exactly
  // the frames it always did — the `{delta, usage}` contract the rest of the product reads is
  // unchanged, and a consumer that does not know about `toolCalls` never sees one.
  if (toolState.size) yield { delta:'', usage:null, toolCalls:finishToolCalls(toolState) };
}

export class ProviderGateway {
  // `onEgressBlocked` is how POLICY_VIOLATION_BLOCKED (01_PRODUCT/12) becomes reachable in
  // the running product rather than only inside a pure function. A refusal here is a real
  // attempt to send data to an external destination that policy stopped, which is exactly
  // what that state is for. A refused egress *plan* deliberately does not feed it: a plan
  // is a question, and letting any caller's question repaint the indicator is the defect
  // `D-0087` removed.
  // `lookup` is injected for the same reason every other seam in this file is: the address check
  // performs a DNS query, and a unit suite that depends on name resolution is a unit suite that
  // fails on an offline machine for a reason that has nothing to do with the code.
  // `activeRuntime` is a THUNK returning `LocalModelRuntime.status()` (or null on a deployment
  // that wired no runtime), never the runtime object: this gateway must not be able to start,
  // stop or configure a model, only to read what is already serving. Called at each read so
  // the derived profile cannot outlive the process it describes — see active-runtime-provider.
  constructor({ store, vault, ledger, onEgressBlocked = null, lookup = null, activeRuntime = null }) { this.store = store; this.vault = vault; this.ledger = ledger; this.onEgressBlocked = onEgressBlocked; this.lookup = lookup; this.activeRuntime = activeRuntime; }
  catalog() { return DEFAULT_CATALOG; }

  /**
   * The chosen model, as a routable profile — or the reason there is none.
   *
   * Never throws: a runtime that fails to report its own status must not take the provider
   * list, the chat route or the settings page down with it. That failure becomes a reason
   * like any other, which is what the shells display.
   */
  activeRuntimeProfile() {
    if (typeof this.activeRuntime !== 'function') {
      return { profile: null, reason: 'this deployment did not wire a local model runtime' };
    }
    try {
      return localRuntimeProfileFrom(this.activeRuntime());
    } catch (error) {
      return { profile: null, reason: `the local model runtime could not be read: ${error.message}` };
    }
  }
  #refuseIfRuntimeProfile(profileId) {
    if (profileId !== LOCAL_RUNTIME_PROFILE_ID) return;
    // A derived profile has nothing to write to. Saying so beats a "not found" that reads
    // like the profile does not exist, when the settings page is showing it.
    throw statusError('This provider is the running local model, derived from the runtime. Change it by choosing a model, not by editing a profile.', 409);
  }
  ensureDefaults() {
    const existing=new Set(this.store.read().providerProfiles.map((item)=>item.type));const created=[];
    for(const descriptor of DEFAULT_CATALOG.filter((item)=>item.type!=='custom-openai-compatible'))if(!existing.has(descriptor.type))created.push(this.create({type:descriptor.type,name:descriptor.name,baseUrl:descriptor.baseUrl,external:descriptor.external,apiStyle:descriptor.apiStyle,defaultModel:''}));
    return created;
  }

  // The running model is listed FIRST, and only while it is running. It is not stored, so it
  // cannot be listed from the store — and a settings page that showed every provider except
  // the one currently answering would be the exact confusion this chain exists to remove.
  list() {
    const { profile } = this.activeRuntimeProfile();
    const stored = this.store.read().providerProfiles.map(publicProfile);
    return profile ? [publicProfile(profile), ...stored] : stored;
  }
  get(profileId) {
    if (profileId === LOCAL_RUNTIME_PROFILE_ID) {
      const { profile, reason } = this.activeRuntimeProfile();
      if (profile) return profile;
      // 409, not 404: the id is real and permanent, the model behind it is not serving. A
      // 404 would tell a caller to stop asking; this tells them what to fix.
      throw statusError(`No local model is answering: ${reason}`, 409);
    }
    const profile = this.store.read().providerProfiles.find((item) => item.id === profileId);
    if (!profile) throw statusError('Provider profile not found.', 404);
    return profile;
  }
  create(input = {}) {
    const descriptor = DEFAULT_CATALOG.find((item) => item.type === input.type) ?? DEFAULT_CATALOG.at(-1);
    const external = input.external ?? descriptor.external;
    const apiStyle = input.apiStyle ?? descriptor.apiStyle;
    if (!STYLES.has(apiStyle)) throw statusError('Unsupported provider apiStyle.');
    const baseUrl = validateBaseUrl(input.baseUrl ?? descriptor.baseUrl, external);
    return this.store.transact((state) => {
      const profile = {
        id:randomUUID(), name:String(input.name ?? descriptor.name).slice(0,120), type:input.type ?? descriptor.type,
        apiStyle, baseUrl, external:Boolean(external), enabled:false, credentialRequired:descriptor.credentialRequired,
        defaultModel:String(input.defaultModel ?? '').slice(0,200), models:Array.isArray(input.models) ? input.models.map(String).slice(0,100) : [],
        // Declared, never probed: no provider style here returns its own context length,
        // so a number filled in automatically would be a guess wearing the shape of a fact.
        // null means "unknown", not zero — the operator states it, or the ctx% field that
        // reads it stays "—" rather than dividing by an invented denominator.
        contextWindow:Number.isFinite(Number(input.contextWindow)) && Number(input.contextWindow) > 0 ? Math.trunc(Number(input.contextWindow)) : null,
        // Declared, never probed — the same posture as `contextWindow` above. No provider style
        // here reports "I understand images", so the operator states it. This is the concept
        // `docs/ai-workspace/FILES_RAG_MULTIMODAL.md`'s image captioning fallback reads
        // (`vision-caption.mjs`, `D-0651`): a model this false for cannot be offered for the job
        // it was never declared to do, the same rule `model-catalog.mjs`'s `TYPES` already holds
        // for the local runtime.
        visionCapable:Boolean(input.visionCapable),
        consent:{ granted:false, grantedAt:null, projectIds:[], dataClasses:[], allowTools:false, anonymize:true },
        timeoutMs:Math.min(Math.max(Number(input.timeoutMs ?? 120_000), 1_000), 600_000),
        priority:Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100, modes:Array.isArray(input.modes) ? input.modes.map((value)=>String(value).toUpperCase()).filter((value)=>['ASK','CREATE','ACT'].includes(value)) : ['ASK','CREATE','ACT'], fallbackProviderIds:Array.isArray(input.fallbackProviderIds) ? input.fallbackProviderIds.map(String) : [],
        headers:{}, encryptedCredential:null, credentialEphemeral:false, createdAt:now(), updatedAt:now(),
      };
      state.providerProfiles.push(profile); return publicProfile(profile);
    });
  }
  update(profileId, patch = {}) {
    this.#refuseIfRuntimeProfile(profileId);
    return this.store.transact((state) => {
      const profile = state.providerProfiles.find((item) => item.id === profileId); if (!profile) throw statusError('Provider profile not found.',404);
      if (patch.baseUrl !== undefined) profile.baseUrl = validateBaseUrl(patch.baseUrl, patch.external ?? profile.external);
      if (patch.apiStyle !== undefined) { if (!STYLES.has(patch.apiStyle)) throw statusError('Unsupported apiStyle.'); profile.apiStyle = patch.apiStyle; }
      for (const key of ['name','defaultModel']) if (patch[key] !== undefined) profile[key] = String(patch[key]).slice(0,200);
      if (patch.models) profile.models = patch.models.map(String).slice(0,100);
      if (patch.contextWindow !== undefined) profile.contextWindow = Number.isFinite(Number(patch.contextWindow)) && Number(patch.contextWindow) > 0 ? Math.trunc(Number(patch.contextWindow)) : null;
      if (patch.visionCapable !== undefined) profile.visionCapable = Boolean(patch.visionCapable);
      if (patch.enabled !== undefined) profile.enabled = Boolean(patch.enabled);
      if (patch.external !== undefined) { profile.external = Boolean(patch.external); profile.baseUrl = validateBaseUrl(profile.baseUrl, profile.external); }
      if (patch.timeoutMs !== undefined) profile.timeoutMs = Math.min(Math.max(Number(patch.timeoutMs),1000),600000);
      if (patch.priority !== undefined) profile.priority = Number(patch.priority);
      if (patch.modes !== undefined) profile.modes = patch.modes.map((value)=>String(value).toUpperCase()).filter((value)=>['ASK','CREATE','ACT'].includes(value));
      if (patch.fallbackProviderIds !== undefined) profile.fallbackProviderIds = patch.fallbackProviderIds.map(String).filter((id)=>id!==profile.id);
      profile.updatedAt = now(); return publicProfile(profile);
    });
  }
  setCredential(profileId, apiKey, { persistence='encrypted' } = {}) {
    this.#refuseIfRuntimeProfile(profileId);
    if (!String(apiKey ?? '').trim()) throw statusError('API key cannot be empty.');
    if (persistence === 'ephemeral') {
      this.get(profileId); this.vault.setEphemeral(profileId, apiKey);
      return this.store.transact((state) => { const profile = state.providerProfiles.find((item) => item.id === profileId); profile.credentialEphemeral = true; profile.updatedAt = now(); return publicProfile(profile); });
    }
    return this.store.transact((state) => {
      const profile = state.providerProfiles.find((item) => item.id === profileId); if (!profile) throw statusError('Provider profile not found.',404);
      profile.encryptedCredential = this.vault.encrypt(apiKey); profile.credentialEphemeral = false; profile.updatedAt = now(); return publicProfile(profile);
    });
  }
  clearCredential(profileId) {
    this.#refuseIfRuntimeProfile(profileId);
    this.vault.clearEphemeral(profileId);
    return this.store.transact((state) => { const profile = state.providerProfiles.find((item) => item.id === profileId); if (!profile) throw statusError('Provider profile not found.',404); profile.encryptedCredential=null; profile.credentialEphemeral=false; return publicProfile(profile); });
  }
  grantConsent(profileId, consent = {}) {
    this.#refuseIfRuntimeProfile(profileId);
    return this.store.transact((state) => {
      const profile = state.providerProfiles.find((item) => item.id === profileId); if (!profile) throw statusError('Provider profile not found.',404);
      profile.consent = {
        granted:Boolean(consent.granted), grantedAt:consent.granted ? now() : null,
        projectIds:Array.isArray(consent.projectIds) ? consent.projectIds.map(String) : [],
        dataClasses:Array.isArray(consent.dataClasses) ? consent.dataClasses.map(String) : ['prompt'],
        allowTools:Boolean(consent.allowTools), anonymize:consent.anonymize !== false,
      };
      if (!profile.consent.granted) profile.enabled = false;
      profile.updatedAt = now(); return publicProfile(profile);
    });
  }
  #assertAllowed(profile, { projectId=null, tools=[], dataClasses=['prompt'] } = {}) {
    if (!profile.enabled) throw statusError('Provider profile is disabled.',403);
    if (profile.external) {
      // Every refusal below is a blocked attempt to reach an external destination, so each
      // one is reported once, through one place, before it is thrown.
      const blocked=(reason)=>{
        let destination='UNKNOWN_DESTINATION';
        try{ destination=new URL(String(profile.baseUrl)).host; }catch{ /* leave unknown */ }
        this.onEgressBlocked?.({ reason, destination, providerId:profile.id, at:new Date().toISOString() });
        this.ledger?.append({ actor:'system', action:'provider.egress-blocked', result:'blocked', details:{ providerId:profile.id, destination, reason } });
        return statusError(reason,403);
      };
      if (!profile.consent?.granted) throw blocked('Explicit external-provider consent is required.');
      if (profile.consent.projectIds.length && (!projectId || !profile.consent.projectIds.includes(projectId))) throw blocked('Provider consent does not cover this project.');
      if (tools.length && !profile.consent.allowTools) throw blocked('Provider consent does not allow tool schemas.');
      const approved=new Set(profile.consent.dataClasses ?? []);
      const denied=(dataClasses ?? []).filter((item)=>!approved.has(item));
      if (denied.length) throw blocked(`Provider consent does not cover data classes: ${denied.join(', ')}.`);
    }
    const credential = this.vault.resolve(profile);
    if (profile.credentialRequired === true && !credential) throw statusError('Provider credential is not configured.',409);
    return credential;
  }
  #request(profile, { model, messages, tools=[], temperature, maxOutputTokens, stream }) {
    const selectedModel = model || profile.defaultModel;
    if (!selectedModel) throw statusError('A model must be selected.',400);
    if (profile.apiStyle === 'openai-responses') return {
      url:`${profile.baseUrl}/responses`,
      body:{ model:selectedModel, input:mapOpenAiMessages(messages), tools:tools.length ? tools : undefined, temperature, max_output_tokens:maxOutputTokens, stream, store:false },
    };
    if (profile.apiStyle === 'anthropic-messages') {
      const system = messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n\n');
      return { url:`${profile.baseUrl}/messages`, body:{ model:selectedModel, system:system || undefined, messages:messages.filter((item) => item.role !== 'system').map((item) => ({ role:item.role === 'assistant' ? 'assistant':'user', content:item.content })), tools:tools.length ? tools : undefined, temperature, max_tokens:maxOutputTokens ?? 4096, stream } };
    }
    // `stream_options.include_usage` is what makes an OpenAI-compatible streaming response
    // carry a final usage-bearing chunk at all — without it the field is simply absent, not
    // zero, and a reader could not tell "no usage was requested" from "the provider has none".
    // A local reasoning model (Qwen3.8-27B) spends the whole token budget inside
    // `reasoning_content` and returns `content: ""` — which every reader here reports as
    // ReasoningUnavailable, so a working engine looks unreachable. The thinking was already
    // being discarded (`extractOpenAiChat` reads `content`, the stream reads `delta.content`):
    // it was generated and paid for in seconds, then thrown away. Local runtime ONLY — an
    // external provider rejects an unknown field.
    return { url:`${profile.baseUrl}/chat/completions`, body:{ model:selectedModel, messages:mapOpenAiMessages(messages), tools:tools.length ? tools : undefined, temperature, max_tokens:maxOutputTokens, stream, stream_options:stream ? { include_usage:true } : undefined, ...(profile.id === LOCAL_RUNTIME_PROFILE_ID ? { chat_template_kwargs:{ enable_thinking:false } } : {}) } };
  }
  #headers(profile, credential) {
    const headers = { 'content-type':'application/json', 'user-agent':'NOESAR-Evolution/1.0', ...profile.headers };
    if (profile.apiStyle === 'anthropic-messages') { if (credential) headers['x-api-key'] = credential; headers['anthropic-version'] = '2023-06-01'; }
    else if (credential) headers.authorization = `Bearer ${credential}`;
    return headers;
  }
  /**
   * Which providers answer this request, in order.
   *
   * Three kinds of intent, and they are NOT the same thing — collapsing them is what let a
   * freshly chosen model be quietly ignored:
   *
   *   `requestedProviderId`  this caller, for this message, named a provider. It wins,
   *                          always. Choosing a model must never override an explicit ask.
   *   the running local model the operator's most recent act (`/model <id>`). It leads the
   *                          default route, and the standing preference follows it as the
   *                          first fallback — nothing is removed from the chain.
   *   `standingProviderId`   a preference set once (the conversation's provider, or the
   *                          workspace default). It leads when no model is running.
   *
   * `standingProviderId` is accepted separately from `requestedProviderId` for exactly that
   * reason. A caller that passes neither gets the enabled profiles by priority, as before.
   */
  route({ requestedProviderId=null, standingProviderId=null, mode='ASK' } = {}) {
    // An explicit ask is answered by what was asked for. The running model does NOT jump
    // ahead of it: choosing a model is a statement about the default, never an override of
    // a caller who named a provider for this message.
    if (requestedProviderId) return [requestedProviderId, ...this.get(requestedProviderId).fallbackProviderIds.filter((id)=>id!==requestedProviderId)];
    const { profile }=this.activeRuntimeProfile();
    // Deduplicated rather than assumed absent: the derived id is reserved, but a store that
    // already contained it must not produce a route that tries the same profile twice.
    const lead=(chain)=>(profile ? [profile.id, ...chain.filter((id)=>id!==profile.id)] : chain);

    if (standingProviderId) {
      // A standing preference keeps EXACTLY the chain it had — itself and the fallbacks its
      // operator configured, and nothing else. Widening it to every enabled provider would
      // quietly add destinations nobody chose, which is a worse defect than the one this
      // change closes. The running model is added in front of that chain, never inside it.
      let chain;
      try {
        chain=[standingProviderId, ...this.get(standingProviderId).fallbackProviderIds.filter((id)=>id!==standingProviderId)];
      } catch (error) {
        // The preferred profile is gone, or is the runtime id while nothing is serving. With
        // a model running, answering from it beats failing the message; with none, the
        // original error is still the truth and is raised unchanged.
        if (!profile) throw error;
        chain=[];
      }
      return lead(chain);
    }

    const normalized=String(mode).toUpperCase();
    const profiles=this.store.read().providerProfiles
      .filter((item)=>item.enabled && (item.modes?.length ? item.modes.includes(normalized) : true))
      .sort((a,b)=>(a.priority??100)-(b.priority??100));
    const preferred=this.store.read().settings.defaultProviderId;
    if(preferred){const index=profiles.findIndex((item)=>item.id===preferred);if(index>0)profiles.unshift(...profiles.splice(index,1));}
    return lead(profiles.map((item)=>item.id));
  }
  #prepared(profile, request) {
    const credential=this.#assertAllowed(profile,request);
    const originalMessages=request.messages ?? [];
    const redaction=profile.external && profile.consent?.anonymize ? redactMessages(originalMessages) : {messages:originalMessages,counts:{},replacements:0};
    const descriptor=this.#request(profile,{...request,messages:redaction.messages,stream:Boolean(request.stream)});
    return {credential,descriptor,redaction};
  }
  async probe(profileId,{signal}={}) {
    const profile=this.get(profileId);const credential=this.#assertAllowed(profile,{projectId:profile.consent?.projectIds?.[0]??null,tools:[],dataClasses:[]});
    const started=Date.now();const timeout=AbortSignal.timeout(Math.min(profile.timeoutMs,15000));const combined=signal?AbortSignal.any([signal,timeout]):timeout;
    // Same stale-socket treatment as the other two call sites: a health probe that reports
    // a reachable provider as unhealthy because a pooled connection had been closed is a
    // false negative, and false negatives on a health check get acted on.
    const response=await fetchOnceRetryingStaleSocket(`${profile.baseUrl}/models`,{headers:this.#headers(profile,credential),signal:combined}, { external: Boolean(profile.external), lookup: this.lookup });
    const value=await response.json().catch(()=>({}));if(!response.ok)throw statusError(`Provider health check failed (${response.status}).`,502);
    // `providerId` was never declared here, so this line threw a ReferenceError on the
    // success path: a reachable, healthy provider answered 500 while an unreachable one
    // answered a tidy 502. Only the failure path had ever been exercised.
    // Reachability is not capability. Measured on this installation 2026-08-24: a healthy
    // llama.cpp server accepted a `tools` array, answered in prose, and emitted no `tool_calls`
    // at all — it only honours them when started with `--jinja` and a template that has them. A
    // health check that says "healthy" while the chat silently cannot call anything is a health
    // check that sends someone looking in the wrong place for a day.
    const toolCalling=await this.probeToolCalling(profileId,{signal}).catch((error)=>({supported:null,reason:error.message}));
    return{status:'healthy',providerId:profileId,latencyMs:Date.now()-started,models:Array.isArray(value.data)?value.data.slice(0,100).map((item)=>item.id??item.name).filter(Boolean):[],toolCalling};
  }

  /**
   * Does this provider actually honour a `tools` array?
   *
   * Answered by asking it, once, with a tool so trivial that any model that CAN call one will —
   * never by consulting a table of model names, which goes stale the day someone points the
   * profile at a different build. `supported:null` means the question could not be answered
   * (unreachable, no credential, a refusal), and is deliberately distinct from `false`: telling an
   * operator their model cannot call tools when the probe simply failed is a wrong answer that
   * looks like a measurement.
   *
   * Not called per turn. This is an operator-triggered check, on the same route as the health
   * check, because a probe in the path of every chat message is a second generation nobody asked
   * to pay for.
   */
  async probeToolCalling(profileId,{signal}={}){
    const profile=this.get(profileId);
    const probeTool={type:'function',function:{name:'noesar_probe_echo',description:'Echo a word back. Call this to confirm tool calling works.',parameters:{type:'object',properties:{word:{type:'string'}},required:['word']}}};
    const request={actorId:'system',model:null,temperature:0,maxOutputTokens:64,dataClasses:['prompt'],
      messages:[{role:'user',content:'Call the tool noesar_probe_echo with word set to "ok". Reply with the tool call only.'}],
      tools:[probeTool]};
    let value;
    try{
      const {credential,descriptor}=this.#prepared(profile,{...request,stream:false});
      const timeout=AbortSignal.timeout(Math.min(profile.timeoutMs,20000));
      const combined=signal?AbortSignal.any([signal,timeout]):timeout;
      const response=await fetchOnceRetryingStaleSocket(descriptor.url,{method:'POST',headers:this.#headers(profile,credential),body:JSON.stringify(descriptor.body),signal:combined},{external:Boolean(profile.external),lookup:this.lookup});
      if(!response.ok)return{supported:null,reason:`probe request failed (${response.status})`};
      value=await response.json();
    }catch(error){return{supported:null,reason:describeFetchFailure(error)};}
    const called=toolCallsPresent(profile.apiStyle,value);
    return called
      ?{supported:true,reason:null}
      :{supported:false,reason:'The provider accepted a tools array and answered without calling one. A llama.cpp server needs --jinja and a chat template with tool support; other servers may not implement tool calling at all.'};
  }
  async complete(profileId, request, { signal } = {}) {
    const profile = this.get(profileId);
    const {credential,descriptor,redaction}=this.#prepared(profile,{...request,stream:false});
    const timeout = AbortSignal.timeout(profile.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchOnceRetryingStaleSocket(descriptor.url, { method:'POST', headers:this.#headers(profile, credential), body:JSON.stringify(descriptor.body), signal:combined }, { external: Boolean(profile.external), lookup: this.lookup })
      .catch((error)=>{throw statusError(`Provider request failed: ${describeFetchFailure(error)}`,502);});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw statusError(`Provider request failed (${response.status}): ${value.error?.message ?? value.error ?? 'unknown error'}`, 502);
    const text = profile.apiStyle === 'openai-responses' ? extractOpenAiResponses(value) : profile.apiStyle === 'anthropic-messages' ? extractAnthropic(value) : extractOpenAiChat(value);
    this.ledger?.append({ actor:request.actorId ?? 'system', action:'provider.complete', result:'success', details:{ providerId:profile.id, type:profile.type, model:request.model || profile.defaultModel, external:profile.external, dataClasses:request.dataClasses??['prompt'], redactions:redaction.counts } });
    return { text, raw:value, provider:publicProfile(profile), redaction:{counts:redaction.counts,replacements:redaction.replacements} };
  }
  async completeWithFallback(profileIds, request, options={}) {
    const failures=[];
    for(const profileId of [...new Set(profileIds.filter(Boolean))]){
      try{return {...await this.complete(profileId,request,options),fallbacksTried:failures};}
      catch(error){failures.push({providerId:profileId,error:error.message,status:error.status??500});}
    }
    throw statusError(`All model providers failed: ${failures.map((item)=>`${item.providerId}: ${item.error}`).join(' | ')}`,502);
  }
  async compare(profileIds, request, options={}) {
    const unique=[...new Set(profileIds.filter(Boolean))].slice(0,8);
    if(unique.length<2)throw statusError('At least two providers are required for comparison.');
    const results=await Promise.all(unique.map(async(providerId)=>{
      const started=Date.now();
      try{const value=await this.complete(providerId,request,options);return{providerId,status:'fulfilled',latencyMs:Date.now()-started,text:value.text,provider:value.provider,redaction:value.redaction};}
      catch(error){return{providerId,status:'rejected',latencyMs:Date.now()-started,error:error.message};}
    }));
    return {comparedAt:now(),results};
  }
  async *stream(profileId, request, { signal } = {}) {
    const profile = this.get(profileId);
    const {credential,descriptor,redaction}=this.#prepared(profile,{...request,stream:true});
    const timeout = AbortSignal.timeout(profile.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchOnceRetryingStaleSocket(descriptor.url, { method:'POST', headers:{ ...this.#headers(profile, credential), accept:'text/event-stream' }, body:JSON.stringify(descriptor.body), signal:combined }, { external: Boolean(profile.external), lookup: this.lookup })
      .catch((error)=>{throw statusError(`Provider stream failed: ${describeFetchFailure(error)}`,502);});
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw statusError(`Provider stream failed (${response.status}): ${value.error?.message ?? value.error ?? 'unknown error'}`, 502);
    }
    this.ledger?.append({actor:request.actorId??'system',action:'provider.stream',result:'started',details:{providerId:profile.id,external:profile.external,dataClasses:request.dataClasses??['prompt'],redactions:redaction.counts}});
    for await (const item of parseSse(response, profile.apiStyle, combined)) yield item;
  }
  async *streamWithFallback(profileIds,request,options={}){
    const failures=[];
    for(const profileId of [...new Set(profileIds.filter(Boolean))]){
      let emitted=false;
      try{
        // `providerId` was never declared in this scope; the loop variable is `profileId`.
        // In an ES module that is a ReferenceError thrown on the FIRST delta, so every
        // streaming reply failed with "providerId is not defined" and the fallback loop
        // could not report which provider had failed either.
        // `emitted` deliberately does NOT count a tool-call frame. It exists to decide whether a
        // failure may still fall back to the next provider, and the rule is about what the PERSON
        // has already seen: once text is on their screen, switching provider mid-answer would
        // splice two different models' prose together. A tool-call frame is the last thing in a
        // stream and shows nothing, so it cannot be the thing that forecloses a fallback.
        for await(const item of this.stream(profileId,request,options)){
          if(item.delta)emitted=true;
          yield{providerId:profileId,delta:item.delta,usage:item.usage,toolCalls:item.toolCalls};
        }
        return;
      }catch(error){
        failures.push({providerId:profileId,error:error.message});
        if(emitted)throw error;
      }
    }
    throw statusError(`All streaming providers failed: ${failures.map((item)=>`${item.providerId}: ${item.error}`).join(' | ')}`,502);
  }

}

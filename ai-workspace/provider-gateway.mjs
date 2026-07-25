// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { redactMessages } from './privacy-redaction.mjs';

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

function mapOpenAiMessages(messages) {
  return messages.map((message) => ({ role:message.role === 'tool' ? 'tool' : message.role, content:message.content }));
}
function extractOpenAiResponses(value) {
  if (typeof value.output_text === 'string') return value.output_text;
  return (value.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text).join('');
}
function extractOpenAiChat(value) { return value.choices?.[0]?.message?.content ?? ''; }
function extractAnthropic(value) { return (value.content ?? []).filter((item) => item.type === 'text').map((item) => item.text).join(''); }

async function *parseSse(response, style, signal) {
  if (!response.body) throw statusError('Provider returned no streaming body.', 502);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
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
      if (delta) yield delta;
    }
  }
}

export class ProviderGateway {
  constructor({ store, vault, ledger }) { this.store = store; this.vault = vault; this.ledger = ledger; }
  catalog() { return DEFAULT_CATALOG; }
  ensureDefaults() {
    const existing=new Set(this.store.read().providerProfiles.map((item)=>item.type));const created=[];
    for(const descriptor of DEFAULT_CATALOG.filter((item)=>item.type!=='custom-openai-compatible'))if(!existing.has(descriptor.type))created.push(this.create({type:descriptor.type,name:descriptor.name,baseUrl:descriptor.baseUrl,external:descriptor.external,apiStyle:descriptor.apiStyle,defaultModel:''}));
    return created;
  }

  list() { return this.store.read().providerProfiles.map(publicProfile); }
  get(profileId) {
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
        consent:{ granted:false, grantedAt:null, projectIds:[], dataClasses:[], allowTools:false, anonymize:true },
        timeoutMs:Math.min(Math.max(Number(input.timeoutMs ?? 120_000), 1_000), 600_000),
        priority:Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100, modes:Array.isArray(input.modes) ? input.modes.map((value)=>String(value).toUpperCase()).filter((value)=>['ASK','CREATE','ACT'].includes(value)) : ['ASK','CREATE','ACT'], fallbackProviderIds:Array.isArray(input.fallbackProviderIds) ? input.fallbackProviderIds.map(String) : [],
        headers:{}, encryptedCredential:null, credentialEphemeral:false, createdAt:now(), updatedAt:now(),
      };
      state.providerProfiles.push(profile); return publicProfile(profile);
    });
  }
  update(profileId, patch = {}) {
    return this.store.transact((state) => {
      const profile = state.providerProfiles.find((item) => item.id === profileId); if (!profile) throw statusError('Provider profile not found.',404);
      if (patch.baseUrl !== undefined) profile.baseUrl = validateBaseUrl(patch.baseUrl, patch.external ?? profile.external);
      if (patch.apiStyle !== undefined) { if (!STYLES.has(patch.apiStyle)) throw statusError('Unsupported apiStyle.'); profile.apiStyle = patch.apiStyle; }
      for (const key of ['name','defaultModel']) if (patch[key] !== undefined) profile[key] = String(patch[key]).slice(0,200);
      if (patch.models) profile.models = patch.models.map(String).slice(0,100);
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
    this.vault.clearEphemeral(profileId);
    return this.store.transact((state) => { const profile = state.providerProfiles.find((item) => item.id === profileId); if (!profile) throw statusError('Provider profile not found.',404); profile.encryptedCredential=null; profile.credentialEphemeral=false; return publicProfile(profile); });
  }
  grantConsent(profileId, consent = {}) {
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
      if (!profile.consent?.granted) throw statusError('Explicit external-provider consent is required.',403);
      if (profile.consent.projectIds.length && (!projectId || !profile.consent.projectIds.includes(projectId))) throw statusError('Provider consent does not cover this project.',403);
      if (tools.length && !profile.consent.allowTools) throw statusError('Provider consent does not allow tool schemas.',403);
      const approved=new Set(profile.consent.dataClasses ?? []);
      const denied=(dataClasses ?? []).filter((item)=>!approved.has(item));
      if (denied.length) throw statusError(`Provider consent does not cover data classes: ${denied.join(', ')}.`,403);
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
    return { url:`${profile.baseUrl}/chat/completions`, body:{ model:selectedModel, messages:mapOpenAiMessages(messages), tools:tools.length ? tools : undefined, temperature, max_tokens:maxOutputTokens, stream } };
  }
  #headers(profile, credential) {
    const headers = { 'content-type':'application/json', 'user-agent':'NOESAR-Evolution/1.0', ...profile.headers };
    if (profile.apiStyle === 'anthropic-messages') { if (credential) headers['x-api-key'] = credential; headers['anthropic-version'] = '2023-06-01'; }
    else if (credential) headers.authorization = `Bearer ${credential}`;
    return headers;
  }
  route({ requestedProviderId=null, mode='ASK' } = {}) {
    if (requestedProviderId) return [requestedProviderId, ...this.get(requestedProviderId).fallbackProviderIds.filter((id)=>id!==requestedProviderId)];
    const normalized=String(mode).toUpperCase();
    const profiles=this.store.read().providerProfiles
      .filter((item)=>item.enabled && (item.modes?.length ? item.modes.includes(normalized) : true))
      .sort((a,b)=>(a.priority??100)-(b.priority??100));
    const preferred=this.store.read().settings.defaultProviderId;
    if(preferred){const index=profiles.findIndex((item)=>item.id===preferred);if(index>0)profiles.unshift(...profiles.splice(index,1));}
    return profiles.map((item)=>item.id);
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
    const response=await fetch(`${profile.baseUrl}/models`,{headers:this.#headers(profile,credential),signal:combined});
    const value=await response.json().catch(()=>({}));if(!response.ok)throw statusError(`Provider health check failed (${response.status}).`,502);
    return{status:'healthy',providerId,latencyMs:Date.now()-started,models:Array.isArray(value.data)?value.data.slice(0,100).map((item)=>item.id??item.name).filter(Boolean):[]};
  }
  async complete(profileId, request, { signal } = {}) {
    const profile = this.get(profileId);
    const {credential,descriptor,redaction}=this.#prepared(profile,{...request,stream:false});
    const timeout = AbortSignal.timeout(profile.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(descriptor.url, { method:'POST', headers:this.#headers(profile, credential), body:JSON.stringify(descriptor.body), signal:combined });
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
    const response = await fetch(descriptor.url, { method:'POST', headers:{ ...this.#headers(profile, credential), accept:'text/event-stream' }, body:JSON.stringify(descriptor.body), signal:combined });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw statusError(`Provider stream failed (${response.status}): ${value.error?.message ?? value.error ?? 'unknown error'}`, 502);
    }
    this.ledger?.append({actor:request.actorId??'system',action:'provider.stream',result:'started',details:{providerId:profile.id,external:profile.external,dataClasses:request.dataClasses??['prompt'],redactions:redaction.counts}});
    for await (const delta of parseSse(response, profile.apiStyle, combined)) yield delta;
  }
  async *streamWithFallback(profileIds,request,options={}){
    const failures=[];
    for(const profileId of [...new Set(profileIds.filter(Boolean))]){
      let emitted=false;
      try{
        for await(const delta of this.stream(profileId,request,options)){emitted=true;yield{providerId,delta};}
        return;
      }catch(error){
        failures.push({providerId,error:error.message});
        if(emitted)throw error;
      }
    }
    throw statusError(`All streaming providers failed: ${failures.map((item)=>`${item.providerId}: ${item.error}`).join(' | ')}`,502);
  }

}

// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { ProviderGateway } from '../src/ai-workspace/provider-gateway.mjs';

function listen(server){return new Promise((resolve)=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));}
function close(server){return new Promise((resolve,reject)=>server.close((e)=>e?reject(e):resolve()));}
function fixture(){const dir=mkdtempSync(join(tmpdir(),'noesar-provider-'));const store=new AtomicJsonStore(join(dir,'state.json'));const vault=new CredentialVault({keyPath:join(dir,'provider.key')});return{dir,store,gateway:new ProviderGateway({store,vault})};}

test('local OpenAI-compatible provider completes and streams without external consent',async()=>{
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const payload=JSON.parse(Buffer.concat(chunks));
    if(payload.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');res.write('data: {"choices":[{"delta":{"content":"world"}}]}\n\n');res.end('data: [DONE]\n\n');return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'complete answer'}}]}));
  });
  const port=await listen(server);const f=fixture();
  try{
    const p=f.gateway.create({type:'local-openai-compatible',name:'Local',baseUrl:`http://127.0.0.1:${port}/v1`,defaultModel:'local-model'});
    f.gateway.update(p.id,{enabled:true});
    const complete=await f.gateway.complete(p.id,{messages:[{role:'user',content:'hi'}]});assert.equal(complete.text,'complete answer');
    let text='';for await(const delta of f.gateway.stream(p.id,{messages:[{role:'user',content:'hi'}]}))text+=delta;assert.equal(text,'Hello world');
  }finally{rmSync(f.dir,{recursive:true,force:true});await close(server);}
});

test('external provider is default-deny and credentials are never exposed',()=>{
  const f=fixture();
  try{
    const p=f.gateway.create({type:'openai',name:'OpenAI',defaultModel:'gpt-model'});
    f.gateway.setCredential(p.id,'secret-key',{persistence:'encrypted'});
    const listed=f.gateway.list()[0];assert.equal(listed.credentialConfigured,true);assert.equal('encryptedCredential' in listed,false);assert.equal(JSON.stringify(listed).includes('secret-key'),false);
    f.gateway.update(p.id,{enabled:true});
    assert.rejects(()=>f.gateway.complete(p.id,{messages:[{role:'user',content:'hello'}]}),/Explicit external-provider consent/);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('provider URL validation blocks metadata and private-network SSRF for external profiles',()=>{
  const f=fixture();
  try{
    assert.throws(()=>f.gateway.create({type:'custom-openai-compatible',baseUrl:'https://127.0.0.1/v1'}),/cannot target loopback or private/);
    assert.throws(()=>f.gateway.create({type:'custom-openai-compatible',baseUrl:'http://example.com/v1'}),/require HTTPS/);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('external provider redacts personal data inside the consented scope',async()=>{
  const f=fixture();const originalFetch=globalThis.fetch;let captured;
  try{
    const p=f.gateway.create({type:'openai',name:'OpenAI',defaultModel:'gpt-model'});
    f.gateway.setCredential(p.id,'secret-key',{persistence:'encrypted'});
    f.gateway.grantConsent(p.id,{granted:true,dataClasses:['prompt'],anonymize:true});
    f.gateway.update(p.id,{enabled:true});
    globalThis.fetch=async(_url,init)=>{captured=JSON.parse(init.body);return new Response(JSON.stringify({output_text:'ok'}),{status:200,headers:{'content-type':'application/json'}});};
    const result=await f.gateway.complete(p.id,{messages:[{role:'user',content:'Email me at user@example.com and use Bearer abcdefghijklmnopqrstuvwxyz'}],dataClasses:['prompt']});
    assert.equal(result.text,'ok');assert.equal(result.redaction.replacements,2);assert.doesNotMatch(JSON.stringify(captured),/user@example\.com|abcdefghijklmnopqrstuvwxyz/);
  }finally{globalThis.fetch=originalFetch;rmSync(f.dir,{recursive:true,force:true});}
});

test('provider comparison and fallback operate across enabled local profiles',async()=>{
  const server1=createServer((_req,res)=>{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'offline'}));});
  const server2=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const payload=JSON.parse(Buffer.concat(chunks));if(payload.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: {"choices":[{"delta":{"content":"fallback"}}]}\n\ndata: [DONE]\n\n');return;}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'second'}}]}));});
  const port1=await listen(server1);const port2=await listen(server2);const f=fixture();
  try{
    const first=f.gateway.create({type:'local-openai-compatible',name:'First',baseUrl:`http://127.0.0.1:${port1}/v1`,defaultModel:'a'});
    const second=f.gateway.create({type:'local-openai-compatible',name:'Second',baseUrl:`http://127.0.0.1:${port2}/v1`,defaultModel:'b'});
    f.gateway.update(first.id,{enabled:true,fallbackProviderIds:[second.id]});f.gateway.update(second.id,{enabled:true});
    const value=await f.gateway.completeWithFallback([first.id,second.id],{messages:[{role:'user',content:'hi'}]});assert.equal(value.text,'second');assert.equal(value.fallbacksTried.length,1);
    const compared=await f.gateway.compare([first.id,second.id],{messages:[{role:'user',content:'hi'}]});assert.equal(compared.results.length,2);assert.ok(compared.results.some((item)=>item.status==='fulfilled'));
  }finally{rmSync(f.dir,{recursive:true,force:true});await close(server1);await close(server2);}
});

test('default local and external provider profiles are provisioned disabled',()=>{const f=fixture();try{const created=f.gateway.ensureDefaults();assert.equal(created.length,4);const profiles=f.gateway.list();assert.deepEqual(new Set(profiles.map((item)=>item.type)),new Set(['local-openai-compatible','openai','anthropic','kimi']));assert.ok(profiles.every((item)=>item.enabled===false));}finally{rmSync(f.dir,{recursive:true,force:true});}});

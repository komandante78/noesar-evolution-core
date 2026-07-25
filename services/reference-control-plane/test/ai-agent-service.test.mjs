// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { AgentService } from '../src/ai-workspace/agent-service.mjs';

test('mutative agent steps require approval and expose progress',()=>{
  const dir=mkdtempSync(join(tmpdir(),'noesar-agent-'));const store=new AtomicJsonStore(join(dir,'state.json'));const service=new AgentService({store});
  try{
    const tool=service.registerTool({name:'write-file',mutative:true,requiresApproval:true});
    const agent=service.createAgent({name:'Builder',toolIds:[tool.id],approvalPolicy:'mutations-only'});
    const run=service.createRun({agentId:agent.id,goal:'Create file',steps:[{title:'Inspect',mutative:false},{title:'Write',mutative:true,toolId:tool.id}]});
    assert.equal(run.steps[0].status,'pending');assert.equal(run.steps[1].status,'awaiting_approval');
    const approved=service.approveStep(run.id,run.steps[1].id);assert.equal(approved.steps[1].status,'pending');
    service.updateStep(run.id,run.steps[0].id,{status:'completed',output:'ok'});const done=service.updateStep(run.id,run.steps[1].id,{status:'completed',output:'written'});assert.equal(done.status,'completed');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('approved mutative HTTP tool step executes and records output',async()=>{
  const {createServer}=await import('node:http');const {CredentialVault}=await import('../src/ai-workspace/credential-vault.mjs');const {ToolExecutor}=await import('../src/ai-workspace/tool-executor.mjs');
  const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({received:JSON.parse(Buffer.concat(chunks))}));});
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));const dir=mkdtempSync(join(tmpdir(),'noesar-agent-exec-'));const store=new AtomicJsonStore(join(dir,'state.json'));const vault=new CredentialVault({keyPath:join(dir,'vault.key')});const service=new AgentService({store,vault,executor:new ToolExecutor({vault})});
  try{const tool=service.registerTool({name:'local_write',transport:'local-http',endpoint:`http://127.0.0.1:${server.address().port}/execute`,mutative:true});const agent=service.createAgent({name:'Writer',toolIds:[tool.id]});const run=service.createRun({agentId:agent.id,goal:'write',steps:[{title:'write',toolId:tool.id,mutative:true,input:{value:42}}]});assert.equal(run.steps[0].status,'awaiting_approval');service.approveStep(run.id,run.steps[0].id,'owner');const completed=await service.executeStep(run.id,run.steps[0].id,{},'owner');assert.equal(completed.steps[0].status,'completed');assert.equal(completed.steps[0].output.result.received.value,42);}finally{await new Promise((resolve)=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

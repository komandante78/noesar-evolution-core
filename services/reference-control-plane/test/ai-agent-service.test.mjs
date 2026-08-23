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

// F4-010 (D-0665). ToolExecutor.execute() pins the address for external tools via
// guardedFetch (comment, tool-executor.mjs: "F4-010, closed s336") but guardedFetch's own
// DNS lookup was never overridable per-call, so nothing could prove the refusal without a
// real DNS record resolving inward. Added an optional `lookup` on the constructor,
// mirroring ProviderGateway's own pattern, unset in production (guardedFetch's real
// node:dns default still applies) and used only here.
test('ToolExecutor.execute() refuses an external tool whose endpoint resolves to a private address at call time',async()=>{
  const {CredentialVault}=await import('../src/ai-workspace/credential-vault.mjs');const {ToolExecutor}=await import('../src/ai-workspace/tool-executor.mjs');
  const dir=mkdtempSync(join(tmpdir(),'noesar-tool-rebind-'));const vault=new CredentialVault({keyPath:join(dir,'vault.key')});
  const executor=new ToolExecutor({vault,lookup:async()=>[{address:'10.0.0.5',family:4}]});
  const tool={
    id:'rebinding-tool', external:true, transport:'http', mutative:false,
    // Not a literal private IP or LOCAL_HOSTS entry, so endpoint()'s string check passes at
    // registration — the injected lookup is what makes it resolve inward at call time.
    endpoint:'https://internal.example.test/execute',
    consent:{granted:true,projectIds:[]}, disabled:false,
    encryptedCredential:null, credentialEphemeral:false, timeoutMs:5000, config:{method:'POST'},
  };
  try{
    await assert.rejects(
      executor.execute(tool,{},{actorId:'tester'}),
      (error)=>{
        assert.match(error.message,/resolves to 10\.0\.0\.5, which is inside this installation's own network/);
        return true;
      },
    );
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('approved mutative HTTP tool step executes and records output',async()=>{
  const {createServer}=await import('node:http');const {CredentialVault}=await import('../src/ai-workspace/credential-vault.mjs');const {ToolExecutor}=await import('../src/ai-workspace/tool-executor.mjs');
  const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({received:JSON.parse(Buffer.concat(chunks))}));});
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));const dir=mkdtempSync(join(tmpdir(),'noesar-agent-exec-'));const store=new AtomicJsonStore(join(dir,'state.json'));const vault=new CredentialVault({keyPath:join(dir,'vault.key')});const service=new AgentService({store,vault,executor:new ToolExecutor({vault})});
  try{const tool=service.registerTool({name:'local_write',transport:'local-http',endpoint:`http://127.0.0.1:${server.address().port}/execute`,mutative:true});const agent=service.createAgent({name:'Writer',toolIds:[tool.id]});const run=service.createRun({agentId:agent.id,goal:'write',steps:[{title:'write',toolId:tool.id,mutative:true,input:{value:42}}]});assert.equal(run.steps[0].status,'awaiting_approval');service.approveStep(run.id,run.steps[0].id,'owner');const completed=await service.executeStep(run.id,run.steps[0].id,{},'owner');assert.equal(completed.steps[0].status,'completed');assert.equal(completed.steps[0].output.result.received.value,42);}finally{await new Promise((resolve)=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

// D-0397. A step with no tool used to be refused with `409 Step has no tool assigned`, which
// made every run this product's own Agents screen creates permanently unfinishable: the form
// builds `Analyze goal` without a toolId, so step 1 could never leave `pending` and the run
// could never reach `completed`. The repair is not a looser refusal — it is the step doing the
// thing its title always claimed: asking the model.
const reasonerStub=(text='the answer')=>({
  calls:[],
  route({requestedProviderId}={}){return requestedProviderId?[requestedProviderId]:['default-profile'];},
  async completeWithFallback(profileIds,request){this.calls.push({profileIds,request});return{text,provider:{id:profileIds[0],name:'Stub provider'},raw:{}};},
});

test('a step with no tool is answered by the model, and the run can finally complete',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'noesar-agent-reason-'));const store=new AtomicJsonStore(join(dir,'state.json'));
  const reasoner=reasonerStub('Three files matter here.');
  const service=new AgentService({store,reasoner});
  try{
    const agent=service.createAgent({name:'Reviewer',instructions:'You review releases.',providerId:'local-profile'});
    const run=service.createRun({agentId:agent.id,goal:'Summarise the release',steps:[{title:'Analyze goal',mutative:false}]});
    assert.equal(run.steps[0].status,'pending');
    const done=await service.executeStep(run.id,run.steps[0].id,{},'owner');
    assert.equal(done.steps[0].status,'completed');
    assert.equal(done.status,'completed','the run itself must reach completed, not sit in running for ever');
    assert.equal(done.steps[0].output.kind,'reasoning');
    assert.equal(done.steps[0].output.text,'Three files matter here.');
    // The agent's own instructions must be what the model was told, and the goal must reach it.
    const sent=reasoner.calls[0];
    assert.deepEqual(sent.profileIds,['local-profile'],"the agent's own provider is the one asked");
    assert.equal(sent.request.messages[0].role,'system');
    assert.match(sent.request.messages[0].content,/You review releases\./);
    assert.match(sent.request.messages[1].content,/Summarise the release/);
    // No tool was executed: this service had no executor at all and still answered.
    assert.equal(service.executor,null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a reasoning step with no routable provider fails declared, and says why',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'noesar-agent-noprovider-'));const store=new AtomicJsonStore(join(dir,'state.json'));
  const service=new AgentService({store,reasoner:{route(){return[];},async completeWithFallback(){throw new Error('must not be reached');}}});
  try{
    const agent=service.createAgent({name:'Orphan'});
    const run=service.createRun({agentId:agent.id,goal:'anything',steps:[{title:'Analyze goal',mutative:false}]});
    await assert.rejects(()=>service.executeStep(run.id,run.steps[0].id,{},'owner'),/No enabled model provider/);
    const after=store.read().agentRuns[0];
    assert.equal(after.steps[0].status,'failed','a step that could not run must say failed, not stay pending');
    assert.match(after.steps[0].error,/No enabled model provider/);
    assert.equal(after.status,'failed');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an agent is archived rather than destroyed, and its editable fields can be corrected',()=>{
  const dir=mkdtempSync(join(tmpdir(),'noesar-agent-archive-'));const store=new AtomicJsonStore(join(dir,'state.json'));const service=new AgentService({store});
  try{
    const tool=service.registerTool({name:'reader'});
    const agent=service.createAgent({name:'Typo',instructions:'first'});
    const renamed=service.updateAgent(agent.id,{name:'Release reviewer',instructions:'second',toolIds:[tool.id]},'owner');
    assert.equal(renamed.name,'Release reviewer');assert.equal(renamed.instructions,'second');assert.deepEqual(renamed.toolIds,[tool.id]);
    assert.notEqual(renamed.updatedAt,undefined);
    const archived=service.updateAgent(agent.id,{archived:true},'owner');
    assert.equal(archived.archived,true);
    // Non-destructive: the record is still there, which is what makes the archive recoverable.
    assert.equal(store.read().agents.length,1);
    assert.equal(store.read().agents[0].id,agent.id);
    // A tool that does not exist is refused, exactly as it is at creation.
    assert.throws(()=>service.updateAgent(agent.id,{toolIds:['no-such-tool']},'owner'),/Tool not found/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

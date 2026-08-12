// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
function now(){return new Date().toISOString();}
function err(message,status=400){return Object.assign(new Error(message),{status});}
// What an agent with no instructions of its own is told. Not empty: a system message that says
// nothing is worse than one that sets the honesty rule this product asks of every answer.
const DEFAULT_AGENT_INSTRUCTIONS='You are an agent of this workspace. Answer the goal directly, state your assumptions, and say plainly what you cannot know from what you were given.';
function find(items,id,label){const item=items.find((candidate)=>candidate.id===id);if(!item)throw err(`${label} not found.`,404);return item;}
export class AgentService {
  // `reasoner` is the ProviderGateway. It is what makes a step with no tool executable at all:
  // before `D-0397` this service had no connection to any model, so the one step every run
  // starts with — `Analyze goal`, built without a toolId — could never leave `pending`.
  constructor({store,ledger,executor=null,vault=null,reasoner=null}){this.store=store;this.ledger=ledger;this.executor=executor;this.vault=vault;this.reasoner=reasoner;}
  registerTool(input={},actorId='system'){
    return this.store.transact((state)=>{const item={id:randomUUID(),name:String(input.name??'').trim(),description:String(input.description??''),transport:input.transport??'local-http',endpoint:input.endpoint??null,config:input.config??{},external:Boolean(input.external),consent:{granted:false,grantedAt:null,projectIds:[]},timeoutMs:Math.min(Math.max(Number(input.timeoutMs??60000),1000),120000),encryptedCredential:null,credentialEphemeral:false,inputSchema:input.inputSchema??{type:'object'},outputSchema:input.outputSchema??{},permissions:Array.isArray(input.permissions)?input.permissions:[],mutative:Boolean(input.mutative),requiresApproval:input.requiresApproval!==false,disabled:false,createdAt:now(),updatedAt:now()};if(!item.name)throw err('Tool name is required.');state.tools.push(item);this.ledger?.append({actor:actorId,action:'tool.registered',result:'success',details:{toolId:item.id,transport:item.transport}});return item;});
  }
  createAgent(input={},actorId='system'){
    return this.store.transact((state)=>{const item={id:randomUUID(),projectId:input.projectId??null,name:String(input.name??'').trim(),description:String(input.description??''),instructions:String(input.instructions??''),providerId:input.providerId??null,model:input.model??null,toolIds:Array.isArray(input.toolIds)?input.toolIds:[],approvalPolicy:input.approvalPolicy??'mutations-only',archived:false,createdAt:now(),updatedAt:now()};if(!item.name)throw err('Agent name is required.');for(const id of item.toolIds)find(state.tools,id,'Tool');state.agents.push(item);this.ledger?.append({actor:actorId,action:'agent.created',result:'success',details:{agentId:item.id}});return item;});
  }
  // Archiving, not deleting: `createAgent` has always written `archived:false` and the list
  // route has always filtered on it, but nothing in the product could ever set it — so an
  // agent created by mistake stayed for ever. The record survives the archive, which is what
  // makes it recoverable (`CLAUDE10.md` §12). Mirrors `context-graph.mjs` updateProject.
  updateAgent(agentId,patch={},actorId='system'){
    return this.store.transact((state)=>{
      const agent=find(state.agents,agentId,'Agent');
      if(patch.name!==undefined){const name=String(patch.name).trim();if(!name)throw err('Agent name is required.');agent.name=name;}
      if(patch.description!==undefined)agent.description=String(patch.description);
      if(patch.instructions!==undefined)agent.instructions=String(patch.instructions);
      if(patch.providerId!==undefined)agent.providerId=patch.providerId??null;
      if(patch.model!==undefined)agent.model=patch.model??null;
      if(patch.approvalPolicy!==undefined)agent.approvalPolicy=patch.approvalPolicy;
      if(patch.toolIds!==undefined){const ids=Array.isArray(patch.toolIds)?patch.toolIds:[];for(const id of ids)find(state.tools,id,'Tool');agent.toolIds=ids;}
      if(patch.archived!==undefined)agent.archived=Boolean(patch.archived);
      agent.updatedAt=now();
      this.ledger?.append({actor:actorId,action:patch.archived===true?'agent.archived':'agent.updated',result:'success',details:{agentId}});
      return agent;
    });
  }
  createRun({agentId,projectId=null,goal,steps=[]},actorId='system'){
    return this.store.transact((state)=>{const agent=find(state.agents,agentId,'Agent');const normalized=steps.length?steps:[{title:'Analyze goal',mutative:false},{title:'Produce result',mutative:false}];const run={id:randomUUID(),agentId,projectId:projectId??agent.projectId,goal:String(goal??'').trim(),status:'planned',steps:normalized.map((step,index)=>({id:randomUUID(),index,title:String(step.title??`Step ${index+1}`),description:String(step.description??''),toolId:step.toolId??null,mutative:Boolean(step.mutative),input:step.input??{},status:step.mutative||agent.approvalPolicy==='all'?'awaiting_approval':'pending',approvedAt:null,startedAt:null,completedAt:null,output:null,error:null})),outputs:[],createdAt:now(),updatedAt:now()};if(!run.goal)throw err('Agent goal is required.');state.agentRuns.push(run);this.ledger?.append({actor:actorId,action:'agent.run-planned',result:'success',details:{runId:run.id,steps:run.steps.length}});return run;});
  }
  approveStep(runId,stepId,actorId='system'){
    return this.store.transact((state)=>{const run=find(state.agentRuns,runId,'Agent run');const step=find(run.steps,stepId,'Agent step');if(step.status!=='awaiting_approval')throw err('Step is not awaiting approval.',409);step.status='pending';step.approvedAt=now();run.updatedAt=now();this.ledger?.append({actor:actorId,action:'agent.step-approved',result:'approved',details:{runId,stepId}});return run;});
  }
  updateStep(runId,stepId,patch={},actorId='system'){
    return this.store.transact((state)=>{const run=find(state.agentRuns,runId,'Agent run');const step=find(run.steps,stepId,'Agent step');for(const key of ['status','output','error'])if(patch[key]!==undefined)step[key]=patch[key];if(patch.status==='running')step.startedAt=now();if(patch.status==='completed'||patch.status==='failed')step.completedAt=now();run.status=run.steps.every((item)=>item.status==='completed')?'completed':run.steps.some((item)=>item.status==='failed')?'failed':'running';run.updatedAt=now();this.ledger?.append({actor:actorId,action:'agent.step-updated',result:step.status,details:{runId,stepId}});return run;});
  }

  setToolCredential(toolId,apiKey,{persistence='encrypted'}={}){
    if(!this.vault)throw err('Tool credential vault is unavailable.',503);find(this.store.read().tools,toolId,'Tool');const key=`tool:${toolId}`;
    if(persistence==='ephemeral'){this.vault.setEphemeral(key,apiKey);return this.store.transact((state)=>{const tool=find(state.tools,toolId,'Tool');tool.credentialEphemeral=true;tool.updatedAt=now();return{...tool,encryptedCredential:undefined,credentialConfigured:true};});}
    return this.store.transact((state)=>{const tool=find(state.tools,toolId,'Tool');tool.encryptedCredential=this.vault.encrypt(apiKey);tool.credentialEphemeral=false;tool.updatedAt=now();return{...tool,encryptedCredential:undefined,credentialConfigured:true};});
  }
  grantToolConsent(toolId,{granted,projectIds=[]}={},actorId='system'){
    return this.store.transact((state)=>{const tool=find(state.tools,toolId,'Tool');tool.consent={granted:Boolean(granted),grantedAt:granted?now():null,projectIds:projectIds.map(String)};if(!granted)tool.disabled=true;tool.updatedAt=now();this.ledger?.append({actor:actorId,action:'tool.consent',result:granted?'granted':'revoked',details:{toolId,projectIds}});return{...tool,encryptedCredential:undefined};});
  }
  async executeStep(runId,stepId,{input=null}={},actorId='system'){
    const snapshot=this.store.read();const run=find(snapshot.agentRuns,runId,'Agent run');const step=find(run.steps,stepId,'Agent step');
    if(step.status==='awaiting_approval')throw err('Step requires explicit approval.',403);if(step.status!=='pending')throw err(`Step cannot execute from status ${step.status}.`,409);
    // A step with no tool is a REASONING step: the model answers it. The approval and mutation
    // rules above are unchanged and still apply — this branch executes no tool and writes
    // nothing outside the run record, so it cannot be a way around them.
    if(!step.toolId)return this.#reason(runId,stepId,{snapshot,run,step},actorId);
    if(!this.executor)throw err('Tool execution is unavailable.',503);
    const tool=find(snapshot.tools,step.toolId,'Tool');if((tool.mutative||step.mutative)&&!step.approvedAt)throw err('Mutative step has not been approved.',403);
    this.updateStep(runId,stepId,{status:'running'},actorId);
    try{const output=await this.executor.execute(tool,input??step.input,{actorId,projectId:run.projectId});return this.updateStep(runId,stepId,{status:'completed',output},actorId);}
    catch(error){this.updateStep(runId,stepId,{status:'failed',error:error.message},actorId);throw error;}
  }

  // The reasoning turn. Deliberately NOT routed through ChatOrchestrator: that one is bound to
  // a conversation and a branch, and an agent being tested must not write itself into the
  // operator's chat history. Provider selection is the same call Chat makes
  // (`chat-orchestrator.mjs` -> `providers.route`), so the two cannot drift apart.
  async #reason(runId,stepId,{snapshot,run,step},actorId){
    if(!this.reasoner)throw err('Reasoning is unavailable.',503);
    const agent=find(snapshot.agents,run.agentId,'Agent');
    const route=this.reasoner.route({requestedProviderId:agent.providerId,mode:'ASK'});
    if(!route.length){
      // Declared, never silent: the step says why it could not run, and the run says failed.
      const reason='No enabled model provider is available for this agent.';
      this.updateStep(runId,stepId,{status:'failed',error:reason},actorId);
      throw err(reason,409);
    }
    const messages=[
      {role:'system',content:agent.instructions?.trim()||DEFAULT_AGENT_INSTRUCTIONS},
      {role:'user',content:[`Goal: ${run.goal}`,`Step: ${step.title}`,step.description?`Detail: ${step.description}`:''].filter(Boolean).join('\n')},
    ];
    this.updateStep(runId,stepId,{status:'running'},actorId);
    try{
      const answer=await this.reasoner.completeWithFallback(route,{actorId,projectId:run.projectId,model:agent.model??null,messages,dataClasses:['prompt']});
      return this.updateStep(runId,stepId,{status:'completed',output:{kind:'reasoning',text:answer.text??'',provider:{id:answer.provider?.id??null,name:answer.provider?.name??null},model:agent.model??answer.provider?.defaultModel??null}},actorId);
    }catch(error){this.updateStep(runId,stepId,{status:'failed',error:error.message},actorId);throw error;}
  }

  listRuns({projectId=null}={}){return this.store.read().agentRuns.filter((item)=>!projectId||item.projectId===projectId);}
}

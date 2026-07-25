// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
function now(){return new Date().toISOString();}
function err(message,status=400){return Object.assign(new Error(message),{status});}
function find(items,id,label){const item=items.find((candidate)=>candidate.id===id);if(!item)throw err(`${label} not found.`,404);return item;}
export class AgentService {
  constructor({store,ledger,executor=null,vault=null}){this.store=store;this.ledger=ledger;this.executor=executor;this.vault=vault;}
  registerTool(input={},actorId='system'){
    return this.store.transact((state)=>{const item={id:randomUUID(),name:String(input.name??'').trim(),description:String(input.description??''),transport:input.transport??'local-http',endpoint:input.endpoint??null,config:input.config??{},external:Boolean(input.external),consent:{granted:false,grantedAt:null,projectIds:[]},timeoutMs:Math.min(Math.max(Number(input.timeoutMs??60000),1000),120000),encryptedCredential:null,credentialEphemeral:false,inputSchema:input.inputSchema??{type:'object'},outputSchema:input.outputSchema??{},permissions:Array.isArray(input.permissions)?input.permissions:[],mutative:Boolean(input.mutative),requiresApproval:input.requiresApproval!==false,disabled:false,createdAt:now(),updatedAt:now()};if(!item.name)throw err('Tool name is required.');state.tools.push(item);this.ledger?.append({actor:actorId,action:'tool.registered',result:'success',details:{toolId:item.id,transport:item.transport}});return item;});
  }
  createAgent(input={},actorId='system'){
    return this.store.transact((state)=>{const item={id:randomUUID(),projectId:input.projectId??null,name:String(input.name??'').trim(),description:String(input.description??''),instructions:String(input.instructions??''),providerId:input.providerId??null,model:input.model??null,toolIds:Array.isArray(input.toolIds)?input.toolIds:[],approvalPolicy:input.approvalPolicy??'mutations-only',archived:false,createdAt:now(),updatedAt:now()};if(!item.name)throw err('Agent name is required.');for(const id of item.toolIds)find(state.tools,id,'Tool');state.agents.push(item);this.ledger?.append({actor:actorId,action:'agent.created',result:'success',details:{agentId:item.id}});return item;});
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
    if(!this.executor)throw err('Tool execution is unavailable.',503);
    const snapshot=this.store.read();const run=find(snapshot.agentRuns,runId,'Agent run');const step=find(run.steps,stepId,'Agent step');
    if(step.status==='awaiting_approval')throw err('Step requires explicit approval.',403);if(step.status!=='pending')throw err(`Step cannot execute from status ${step.status}.`,409);
    if(!step.toolId)throw err('Step has no tool assigned.',409);const tool=find(snapshot.tools,step.toolId,'Tool');if((tool.mutative||step.mutative)&&!step.approvedAt)throw err('Mutative step has not been approved.',403);
    this.updateStep(runId,stepId,{status:'running'},actorId);
    try{const output=await this.executor.execute(tool,input??step.input,{actorId,projectId:run.projectId});return this.updateStep(runId,stepId,{status:'completed',output},actorId);}
    catch(error){this.updateStep(runId,stepId,{status:'failed',error:error.message},actorId);throw error;}
  }

  listRuns({projectId=null}={}){return this.store.read().agentRuns.filter((item)=>!projectId||item.projectId===projectId);}
}

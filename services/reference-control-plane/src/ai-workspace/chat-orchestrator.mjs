// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';

function instructionForMode(mode){
  if(mode==='CREATE')return 'You are in CREATE mode. Produce a concrete editable artifact. State assumptions. Cite retrieved passages using their exact [source:<id>#<passage>] labels.';
  if(mode==='ACT')return 'You are in ACT mode. Plan actions first. Never execute mutative tools without an explicit approval token. Report each step and result. Cite retrieved passages when used.';
  return 'You are in ASK mode. Answer precisely. Distinguish provided context, retrieved evidence and uncertainty. Cite retrieved passages using their exact [source:<id>#<passage>] labels. Never present retrieval as independent fact verification.';
}
function sse(res,event,data){res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}
function dataClassesFor({history,projectInstructions,memoryText,evidence,tools}){
  return ['prompt',history&&'selected messages',projectInstructions&&'project instructions',memoryText&&'selected memory',evidence.length&&'selected sources',tools.length&&'tool schemas'].filter(Boolean);
}

export class ChatOrchestrator{
  constructor({graph,workspace,providers,store,ledger}){this.graph=graph;this.workspace=workspace;this.providers=providers;this.store=store;this.ledger=ledger;this.active=new Map();}
  stop(runId,actorId='system'){const active=this.active.get(runId);if(!active)return false;active.controller.abort();this.ledger?.append({actor:actorId,action:'chat.stop',result:'stopped',details:{runId}});return true;}
  #buildContext({conversationId,branchId,content,mode,sourceIds=[],toolIds=[]}){
    const inspection=this.workspace.contextInspection({conversationId,branchId});
    const selectedMode=String(mode??inspection.conversation.mode??'ASK').toUpperCase();
    const projectInstructions=inspection.project?.instructions?`Project instructions:\n${inspection.project.instructions}`:'';
    const memoryText=inspection.memories.length?`Visible memory selected for this project:\n${inspection.memories.map((item)=>`- ${item.title}: ${item.content}`).join('\n')}`:'';
    const policy=inspection.project?.knowledgePolicy??{mode:'hybrid',limit:8,maxCharacters:60000};
    const evidence=this.workspace.knowledgeContext(content,{projectId:inspection.conversation.projectId,sourceIds,policy});
    const evidenceText=evidence.length?`Retrieved source passages (evidence, not independent claim verification):\n${evidence.map((item)=>`[source:${item.sourceId}#${item.index}] ${item.source?.name??item.sourceId}\n${item.text}`).join('\n\n')}`:'';
    const messages=[
      {role:'system',content:[instructionForMode(selectedMode),projectInstructions,memoryText,evidenceText].filter(Boolean).join('\n\n')},
      ...inspection.messages.map((item)=>({role:item.role,content:item.content})),
      {role:'user',content:String(content)}
    ];
    const tools=this.store.read().tools.filter((item)=>toolIds.includes(item.id)&&!item.disabled).map((item)=>({type:'function',function:{name:item.name,description:item.description,parameters:item.inputSchema}}));
    return{inspection,selectedMode,projectInstructions,memoryText,evidence,messages,tools,dataClasses:dataClassesFor({history:inspection.messages.length,projectInstructions,memoryText,evidence,tools})};
  }
  #citations(evidence){return evidence.map((item)=>({sourceId:item.sourceId,sourceName:item.source?.name??item.sourceId,passageIndex:item.index,score:item.score,excerpt:item.text.slice(0,500),evidenceStatus:'retrieved',claimStatus:'not_independently_verified'}));}
  async compare({actorId,conversationId,branchId,content,providerIds,model=null,mode=null,sourceIds=[],toolIds=[]}){
    const built=this.#buildContext({conversationId,branchId,content,mode,sourceIds,toolIds});
    const result=await this.providers.compare(providerIds,{actorId,projectId:built.inspection.conversation.projectId,model,messages:built.messages,tools:built.tools,dataClasses:built.dataClasses});
    this.ledger?.append({actor:actorId,action:'models.compared',result:'success',details:{conversationId,providerIds:providerIds.slice(0,8)}});
    return{...result,citations:this.#citations(built.evidence),mode:built.selectedMode};
  }
  async streamToResponse({res,actorId,conversationId,branchId,content,providerId=null,model=null,mode=null,sourceIds=[],toolIds=[]}){
    const initial=this.workspace.contextInspection({conversationId,branchId});
    const selectedMode=String(mode??initial.conversation.mode??'ASK').toUpperCase();
    const providerRoute=this.providers.route({requestedProviderId:providerId??initial.providerId,mode:selectedMode});
    if(!providerRoute.length)throw Object.assign(new Error('No enabled model provider is available for this mode.'),{status:409});
    const runId=randomUUID();const controller=new AbortController();this.active.set(runId,{controller,actorId,conversationId});
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
    sse(res,'run',{runId,status:'started',providerRoute});
    const user=this.graph.addMessage({conversationId,branchId:branchId??initial.branchId,role:'user',content,metadata:{mode:selectedMode,sourceIds,toolIds}});
    const built=this.#buildContext({conversationId,branchId:branchId??initial.branchId,content,mode:selectedMode,sourceIds,toolIds});
    // #buildContext includes the just-persisted user message; remove its duplicate final copy.
    built.messages=built.messages.filter((message,index)=>!(index===built.messages.length-2&&message.role==='user'&&message.content===user.content));
    let answer='';let selectedProvider=null;
    try{
      for await(const event of this.providers.streamWithFallback(providerRoute,{actorId,projectId:built.inspection.conversation.projectId,model,messages:built.messages,tools:built.tools,dataClasses:built.dataClasses},{signal:controller.signal})){
        selectedProvider=event.providerId;answer+=event.delta;sse(res,'delta',{runId,providerId:event.providerId,text:event.delta});
      }
      const citations=this.#citations(built.evidence);
      const assistant=this.graph.addMessage({conversationId,branchId:branchId??initial.branchId,role:'assistant',content:answer||'[Provider returned no text]',metadata:{runId,providerId:selectedProvider,providerRoute,model,mode:selectedMode},citations});
      sse(res,'complete',{runId,message:assistant,providerId:selectedProvider,citations});this.ledger?.append({actor:actorId,action:'chat.complete',result:'success',details:{runId,conversationId,providerId:selectedProvider,providerRoute}});
    }catch(error){const stopped=error.name==='AbortError'||controller.signal.aborted;sse(res,stopped?'stopped':'error',{runId,error:stopped?'Generation stopped.':error.message});this.ledger?.append({actor:actorId,action:'chat.complete',result:stopped?'stopped':'error',details:{runId,message:error.message}});
    }finally{this.active.delete(runId);res.end();}
  }
}

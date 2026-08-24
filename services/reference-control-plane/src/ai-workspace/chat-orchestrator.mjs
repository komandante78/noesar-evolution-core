// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { wrapUntrusted, enforceToolScope } from './untrusted-content.mjs';
import { AGENT_DIRECTIVE_INSTRUCTION, extractAgentDirective } from './agent-directive.mjs';
import { composeSystemPrompt } from './assistant-identity.mjs';

function sse(res,event,data){res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}
function dataClassesFor({history,projectInstructions,memoryText,evidence,tools}){
  return ['prompt',history&&'selected messages',projectInstructions&&'project instructions',memoryText&&'selected memory',evidence.length&&'selected sources',tools.length&&'tool schemas'].filter(Boolean);
}

export class ChatOrchestrator{
  // `installationSnapshot` is a function, not a value: what the assistant is told about this
  // installation has to be true at the moment of the turn, not at the moment the server booted.
  // A model started with `/model` after start-up is the case that makes this concrete — a value
  // captured in the constructor would still name the one that was default at boot.
  constructor({graph,workspace,providers,store,ledger,agentService=null,installationSnapshot=null}){this.graph=graph;this.workspace=workspace;this.providers=providers;this.store=store;this.ledger=ledger;this.agentService=agentService;this.installationSnapshot=installationSnapshot;this.active=new Map();}
  // A snapshot that throws must never take the turn down with it: the assistant is worse without
  // its grounding, but it still answers, and an installation fact is not worth a 500.
  #installationFacts(){
    try{return this.installationSnapshot?.()??{};}
    catch(error){this.ledger?.append({actor:'system',action:'chat.identity',result:'degraded',details:{message:error.message}});return{};}
  }
  stop(runId,actorId='system'){const active=this.active.get(runId);if(!active)return false;active.controller.abort();this.ledger?.append({actor:actorId,action:'chat.stop',result:'stopped',details:{runId}});return true;}
  #buildContext({conversationId,branchId,content,mode,sourceIds=[],toolIds=[]}){
    const inspection=this.workspace.contextInspection({conversationId,branchId});
    const selectedMode=String(mode??inspection.conversation.mode??'ASK').toUpperCase();
    const projectInstructions=inspection.project?.instructions?`Project instructions:\n${inspection.project.instructions}`:'';
    const memoryText=inspection.memories.length?`Visible memory selected for this project:\n${inspection.memories.map((item)=>`- ${item.title}: ${item.content}`).join('\n')}`:'';
    const policy=inspection.project?.knowledgePolicy??{mode:'hybrid',limit:8,maxCharacters:60000};
    const evidence=this.workspace.knowledgeContext(content,{projectId:inspection.conversation.projectId,sourceIds,policy});
    // Retrieved passages are untrusted input. They are fenced and carried in
    // their own non-system message: text a third party wrote must never sit in
    // the role that carries this runtime's own instructions.
    const untrusted=wrapUntrusted(evidence,{label:'retrieved source passages'});
    // Tool scope is an intersection of what the caller selected with what is
    // enabled. Nothing inside the retrieved content can widen it.
    //
    // Resolved BEFORE the system message now, not after: the assistant is told which tools it has
    // by name, and it can only be told that once the scope has decided. The order used to be the
    // other way round because the system message named nothing.
    const enabledToolIds=this.store.read().tools.filter((item)=>!item.disabled).map((item)=>item.id);
    const scope=enforceToolScope({grantedToolIds:enabledToolIds,requestedToolIds:toolIds});
    const granted=this.store.read().tools.filter((item)=>scope.allowedToolIds.includes(item.id));
    const tools=granted.map((item)=>({type:'function',function:{name:item.name,description:item.description,parameters:item.inputSchema}}));
    const system=composeSystemPrompt({
      mode:selectedMode,
      installation:{...this.#installationFacts(),
        // Counts come from the inspection rather than the snapshot: they are facts about the
        // conversation's own project, which the snapshot has no way to know.
        //
        // Read defensively, and not as a style preference. The grounding is DECORATION on the
        // turn: it makes the answer better and it must never be able to take the answer away.
        // `#installationFacts()` already refuses to throw for that reason, and a field read that
        // can throw right next to it would have made that guard pointless — which is exactly what
        // happened, caught by CE-007's own containment fixture on the first full run.
        sourceCount:(inspection.sources??[]).length,memoryCount:(inspection.memories??[]).length},
      tools:granted.map((item)=>({name:item.name,description:item.description})),
      // Conditional, and this is the point: the citation instruction used to be emitted on every
      // turn including the ones with nothing retrieved — which is every turn on an installation
      // with no sources.
      hasEvidence:evidence.length>0,
      projectInstructions,memoryText,
      extraInstructions:[this.agentService&&AGENT_DIRECTIVE_INSTRUCTION],
    });
    const messages=[
      {role:'system',content:system},
      ...(untrusted?[{role:'user',content:untrusted.text,untrusted:true}]:[]),
      ...inspection.messages.map((item)=>({role:item.role,content:item.content})),
      {role:'user',content:String(content)}
    ];
    if(untrusted?.detections.length){
      this.ledger?.append({actor:'system',action:'prompt-injection.detected',result:'contained',details:{conversationId,passages:untrusted.detections.length,signals:untrusted.detections.flatMap((item)=>item.signals.map((signal)=>signal.signal))}});
    }
    return{inspection,selectedMode,projectInstructions,memoryText,evidence,messages,tools,toolScope:scope,injectionDetections:untrusted?.detections??[],dataClasses:dataClassesFor({history:inspection.messages.length,projectInstructions,memoryText,evidence,tools})};
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
    // The two are passed apart, not collapsed with `??`. `providerId` is THIS caller naming a
    // provider for THIS message and still wins outright; `initial.providerId` is a standing
    // preference (the conversation's provider, or the workspace default) which a model the
    // operator just started with `/model` leads — see ProviderGateway.route(). Collapsing them
    // is what made a freshly chosen model unreachable on any workspace that had ever set a
    // default: the chain ended at the preference and never reached the running model.
    const providerRoute=this.providers.route({requestedProviderId:providerId,standingProviderId:initial.providerId,mode:selectedMode});
    if(!providerRoute.length)throw Object.assign(new Error('No enabled model provider is available for this mode.'),{status:409});
    // Everything that can reject on malformed input happens BEFORE a single byte is
    // written. Once the 200 and the event-stream headers are out there is no way to
    // answer with a status code any more, and a rejection from here used to escape the
    // request handler entirely and take the process down with it.
    const user=this.graph.addMessage({conversationId,branchId:branchId??initial.branchId,role:'user',content,metadata:{mode:selectedMode,sourceIds,toolIds}});
    const built=this.#buildContext({conversationId,branchId:branchId??initial.branchId,content,mode:selectedMode,sourceIds,toolIds});
    // #buildContext includes the just-persisted user message; remove its duplicate final copy.
    built.messages=built.messages.filter((message,index)=>!(index===built.messages.length-2&&message.role==='user'&&message.content===user.content));
    const runId=randomUUID();const controller=new AbortController();this.active.set(runId,{controller,actorId,conversationId});
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
    sse(res,'run',{runId,status:'started',providerRoute});
    let answer='';let selectedProvider=null;let usage=null;
    try{
      // `usage` is only ever populated on the frame that carries it (see provider-gateway's
      // usageFrom()) — most deltas in a stream have none, so the running value is kept
      // rather than overwritten with a null on every ordinary text chunk.
      for await(const event of this.providers.streamWithFallback(providerRoute,{actorId,projectId:built.inspection.conversation.projectId,model,messages:built.messages,tools:built.tools,dataClasses:built.dataClasses},{signal:controller.signal})){
        selectedProvider=event.providerId;answer+=event.delta;if(event.usage)usage=event.usage;sse(res,'delta',{runId,providerId:event.providerId,text:event.delta});
      }
      const citations=this.#citations(built.evidence);
      // §4#9 (D-0648): a tagged fence in the model's own answer, and nothing else, may create
      // an agent — see agent-directive.mjs for why this is the only channel and why an
      // ambiguous or malformed block is silently the same as no block. Already-flushed
      // `delta` events cannot be un-sent; only the PERSISTED message is cleaned, a declared
      // limitation of doing this after a stream rather than buffering the whole answer first.
      let agentCreated=null;let cleanAnswer=answer;
      if(this.agentService){
        const{cleanedText,directive}=extractAgentDirective(answer);
        cleanAnswer=cleanedText;
        // Parsed and stripped either way — a fence is never shown to the person — but only
        // EXECUTED when this turn's retrieved content did not already trip the injection
        // detector. The directive is read from the MODEL's own answer, and an answer shaped
        // by content the detector already distrusts is not a basis to create anything.
        if(directive&&!built.injectionDetections.length){
          try{
            const created=this.agentService.createAgent({projectId:built.inspection.conversation.projectId,name:directive.name,instructions:directive.instructions},actorId);
            agentCreated={id:created.id,name:created.name};
            this.ledger?.append({actor:actorId,action:'agent.created-from-chat',result:'success',details:{runId,conversationId,agentId:created.id}});
          }catch(error){
            this.ledger?.append({actor:actorId,action:'agent.created-from-chat',result:'error',details:{runId,conversationId,message:error.message}});
          }
        }else if(directive){
          this.ledger?.append({actor:actorId,action:'agent.created-from-chat',result:'refused',details:{runId,conversationId,reason:'injection-detected-this-turn'}});
        }
      }
      const assistant=this.graph.addMessage({conversationId,branchId:branchId??initial.branchId,role:'assistant',content:cleanAnswer||'[Provider returned no text]',metadata:{runId,providerId:selectedProvider,providerRoute,model,mode:selectedMode,usage,agentCreated},citations});
      sse(res,'complete',{runId,message:assistant,providerId:selectedProvider,citations,usage,agentCreated});this.ledger?.append({actor:actorId,action:'chat.complete',result:'success',details:{runId,conversationId,providerId:selectedProvider,providerRoute}});
    }catch(error){const stopped=error.name==='AbortError'||controller.signal.aborted;sse(res,stopped?'stopped':'error',{runId,error:stopped?'Generation stopped.':error.message});this.ledger?.append({actor:actorId,action:'chat.complete',result:stopped?'stopped':'error',details:{runId,message:error.message}});
    }finally{this.active.delete(runId);res.end();}
  }
}

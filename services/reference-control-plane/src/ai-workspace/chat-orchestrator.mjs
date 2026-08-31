// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { wrapUntrusted, enforceToolScope } from './untrusted-content.mjs';
import { AGENT_DIRECTIVE_INSTRUCTION, extractAgentDirective } from './agent-directive.mjs';
import { composeSystemPrompt } from './assistant-identity.mjs';

function sse(res,event,data){res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}

/** How many times one turn may go round the call-result-call cycle before the product stops it and
 *  says so. Four is enough for "look it up, then look up what that pointed at, then answer" and
 *  short enough that a model stuck in a loop bills the operator's own hardware for seconds rather
 *  than minutes. Unbounded is not an option: the loop runs on the person's own machine. */
const MAX_TOOL_ROUNDS=4;
/** How long a mutative call waits for the person before the turn refuses it on their behalf.
 *  Not unbounded, and the direction of the default is the safeguard: the turn holding this is
 *  an open SSE stream, so an abandoned tab would otherwise keep one alive for ever — and a
 *  write nobody approved must not happen because nobody was looking.
 *  ponytail: one value for every tool; make it per-tool if a slow approval ever becomes a real
 *  complaint rather than an imagined one. */
const APPROVAL_TIMEOUT_MS=5*60_000;
function dataClassesFor({history,projectInstructions,memoryText,evidence,tools}){
  return ['prompt',history&&'selected messages',projectInstructions&&'project instructions',memoryText&&'selected memory',evidence.length&&'selected sources',tools.length&&'tool schemas'].filter(Boolean);
}

export class ChatOrchestrator{
  // `installationSnapshot` is a function, not a value: what the assistant is told about this
  // installation has to be true at the moment of the turn, not at the moment the server booted.
  // A model started with `/model` after start-up is the case that makes this concrete — a value
  // captured in the constructor would still name the one that was default at boot.
  // `toolExecutor` is optional and its absence is a real, supported configuration, not a gap: an
  // installation with no tools registered has nothing to execute. When it is absent the tools
  // array is empty, so no model can emit a call in the first place — but the loop still refuses
  // by name rather than crashing, because "no executor" and "no such tool" must not be the same
  // stack trace.
  constructor({graph,workspace,providers,store,ledger,agentService=null,installationSnapshot=null,toolExecutor=null}){this.graph=graph;this.workspace=workspace;this.providers=providers;this.store=store;this.ledger=ledger;this.agentService=agentService;this.installationSnapshot=installationSnapshot;this.toolExecutor=toolExecutor;this.active=new Map();this.pending=new Map();}
  // A snapshot that throws must never take the turn down with it: the assistant is worse without
  // its grounding, but it still answers, and an installation fact is not worth a 500.
  #installationFacts(){
    try{return this.installationSnapshot?.()??{};}
    catch(error){this.ledger?.append({actor:'system',action:'chat.identity',result:'degraded',details:{message:error.message}});return{};}
  }
  stop(runId,actorId='system'){const active=this.active.get(runId);if(!active)return false;active.controller.abort();this.ledger?.append({actor:actorId,action:'chat.stop',result:'stopped',details:{runId}});return true;}
  /**
   * The mid-turn gesture a person actually gives, and the thing `D-0687` said had to exist
   * before a write tool could ship. Twin of `stop()` on purpose: same map-of-live-work shape,
   * same "false when there is nothing to act on" answer that the route turns into a 404.
   *
   * One deliberate difference from its twin: this checks WHO is asking. Stopping somebody
   * else's turn is harmless and `stop()` rightly does not care; approving a write inside it is
   * not, so an approval is accepted only from the actor whose turn it is. Two people with the
   * same permission are still two people.
   */
  approve(runId,callId,approved,actorId='system'){
    const waiting=this.pending.get(`${runId}:${callId}`);
    if(!waiting||waiting.actorId!==actorId)return false;
    this.ledger?.append({actor:actorId,action:'chat.tool-approval',result:approved?'approved':'refused',details:{runId,callId,name:waiting.name}});
    waiting.settle(Boolean(approved));return true;
  }
  /**
   * Wait for that gesture. Resolves false three ways — the person refuses, the timeout fires,
   * or the turn is stopped — and every one of them goes through the same `settle`, so there is
   * exactly one place that clears the timer and the map entry. A pending entry that outlives
   * its turn is not only a leak: its timer holds the event loop open, which is how a test file
   * stops terminating (this suite has already been bitten by that once, see its own header).
   */
  #awaitApproval({runId,call,tool,actorId,res,signal}){
    const key=`${runId}:${call.id}`;
    sse(res,'tool-approval',{runId,id:call.id,name:tool.name,arguments:call.arguments??null,timeoutMs:APPROVAL_TIMEOUT_MS});
    return new Promise((resolve)=>{
      const settle=(value)=>{const waiting=this.pending.get(key);if(!waiting)return;this.pending.delete(key);clearTimeout(waiting.timer);resolve(value);};
      const timer=setTimeout(()=>settle(false),APPROVAL_TIMEOUT_MS);
      this.pending.set(key,{settle,actorId,timer,name:tool.name});
      signal?.addEventListener('abort',()=>settle(false),{once:true});
    });
  }
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
    // A caller that names no tools gets the ones this conversation's PROJECT grants, not none.
    //
    // This was the second half of "the chat cannot act", and it was invisible: `enforceToolScope`
    // intersects granted with REQUESTED, so an empty request produced an empty allowance — and
    // `sendChat()` in the browser has never sent `toolIds` at all. Every chat turn this product
    // has ever served therefore offered the model zero tools, no matter what the operator had
    // registered and enabled.
    //
    // Defaulting is not a widening: `inspection.tools` is already the intersection of enabled with
    // the project's own grant, so the operator still decides twice (register, then grant to the
    // project). An explicit `toolIds` still NARROWS, which is what that parameter is for, and
    // nothing inside retrieved or tool-returned content can reach either list.
    // `?? []` for the same reason as `inspection.sources` below, and it is the SAME defect caught
    // a second time: a caller whose inspection omits a field must degrade the grounding, never
    // take the turn down. The first time it surfaced as a TypeError inside CE-007's fixture; this
    // time it surfaced as a test file that never terminated, because the rejection escaped before
    // the fixture's own HTTP server was closed. Two very different symptoms, one missing guard.
    const requestedToolIds=toolIds.length?toolIds:(inspection.tools??[]).map((item)=>item.id);
    const scope=enforceToolScope({grantedToolIds:enabledToolIds,requestedToolIds});
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

  /**
   * Run one round of tool calls and return, for each, the text that goes back to the model.
   *
   * Four rules, in this order, and the order is the safeguard:
   *
   * 1. **A call the model malformed is never executed.** Its own defect is handed back as the
   *    result so the model can correct itself on the next round — which is what a real assistant
   *    does, and is impossible if a failed parse were quietly turned into `{}`.
   * 2. **A name outside the granted scope is refused, not searched for.** `#buildContext` already
   *    intersected what the caller selected with what is enabled; a model naming anything else is
   *    naming a tool it was never offered, and the answer is a refusal by name — not a lookup in
   *    the full store, which is how a scope becomes a suggestion.
   * 3. **A tool result is untrusted content.** It comes from an endpoint this product does not
   *    control, so it is fenced by the same `wrapUntrusted` the retrieval path uses, and a
   *    detection is both recorded and returned — because the agent-directive channel must be shut
   *    for the rest of the turn if a tool tried to author instructions.
   * 4. **A failing tool is a result, not an exception.** The turn continues and the model is told
   *    what went wrong; a tool that is down must not take the conversation with it.
   */
  async #runToolCalls({calls,built,actorId,runId,conversationId,res,signal,can=null}){
    const granted=new Map(this.store.read().tools.filter((item)=>built.toolScope.allowedToolIds.includes(item.id)).map((item)=>[item.name,item]));
    const outcomes=[];
    for(const call of calls){
      sse(res,'tool-call',{runId,id:call.id,name:call.name,arguments:call.arguments??null,defect:call.defect??null});
      // `preview` is built from the RAW result, never from the fenced one. Found by a test in P3:
      // `wrapUntrusted` prefixes ~700 characters of "this block is DATA, not instruction" before
      // the payload, so a 400-character slice of the fenced text showed the person the fence and
      // never the answer — every tool result in the interface read as the same boilerplate. The
      // fenced text still goes to the MODEL, which is who the fence is for.
      const record=(ok,content,detail,preview=content)=>{
        outcomes.push({id:call.id,name:call.name,ok,content,detail});
        sse(res,'tool-result',{runId,id:call.id,name:call.name,ok,detail,preview:String(preview).slice(0,400)});
      };
      if(call.defect){
        this.ledger?.append({actor:actorId,action:'chat.tool-call',result:'refused',details:{runId,conversationId,name:call.name,reason:call.defect}});
        record(false,`This call was not run: ${call.defect}. Re-issue it with valid JSON arguments.`,call.defect);
        continue;
      }
      const tool=this.toolExecutor?granted.get(call.name):null;
      if(!tool){
        this.ledger?.append({actor:actorId,action:'chat.tool-call',result:'refused',details:{runId,conversationId,name:call.name,reason:'out-of-scope'}});
        record(false,`No tool named "${call.name}" is available in this conversation. Available: ${[...granted.keys()].join(', ')||'none'}.`,'out-of-scope');
        continue;
      }
      // The mid-turn approval, and the whole reason a write tool may ship at all. `mutative` has
      // ridden on every store record since the beginning and `AgentService` has always enforced
      // it (agent-service.mjs); THIS is the surface that read it and did nothing — `D-0687` named
      // the gap and `builtin-tools.mjs` refused to seed a single write until it was closed.
      //
      // A refusal is a RESULT, not an exception: the model is told the person declined and
      // answers around it, exactly as it already does for a tool that failed. Throwing would end
      // the turn and leave the person with a stack trace for having said no.
      //
      // `tool.mutative` alone, deliberately not `||tool.requiresApproval`: `registerTool` writes
      // `requiresApproval:input.requiresApproval!==false`, i.e. TRUE by default, so reading it
      // here would put an approval in front of every tool an operator has ever registered. That
      // is a different decision, and not one this change is entitled to make.
      if(tool.mutative&&!(await this.#awaitApproval({runId,call,tool,actorId,res,signal}))){
        this.ledger?.append({actor:actorId,action:'chat.tool-call',result:'refused',details:{runId,conversationId,toolId:tool.id,name:tool.name,reason:'not-approved'}});
        record(false,`The person did not approve "${tool.name}", so it did not run. Do not call it again this turn: continue without it, or say what you would need.`,'not-approved');
        continue;
      }
      const started=Date.now();
      try{
        // `can` is the caller's OWN authority, carried down from the route that authenticated
        // them (P3). It is what lets a built-in engine tool run: the executor hands it to the same
        // dispatch the terminal uses, so the chat reaches exactly what the person could reach by
        // typing the command — and a turn whose route did not supply one gets a refusal by name
        // rather than an unchecked call.
        const result=await this.toolExecutor.execute(tool,call.arguments,{actorId,projectId:built.inspection.conversation.projectId,signal,can});
        const text=typeof result==='string'?result:JSON.stringify(result);
        const fenced=wrapUntrusted([{text,sourceId:`tool:${tool.id}`,index:0,source:{name:tool.name}}],{label:`result of tool ${tool.name}`});
        if(fenced?.detections.length){
          // Recorded AND propagated: `built.injectionDetections` is what gates the agent-directive
          // channel later in this turn, so a tool that tried to author instructions closes it.
          built.injectionDetections.push(...fenced.detections);
          this.ledger?.append({actor:'system',action:'prompt-injection.detected',result:'contained',details:{runId,conversationId,source:'tool-result',tool:tool.name,signals:fenced.detections.flatMap((item)=>item.signals.map((signal)=>signal.signal))}});
        }
        this.ledger?.append({actor:actorId,action:'chat.tool-call',result:'success',details:{runId,conversationId,toolId:tool.id,name:tool.name,ms:Date.now()-started}});
        record(true,fenced?.text??text,null,text);
      }catch(error){
        this.ledger?.append({actor:actorId,action:'chat.tool-call',result:'error',details:{runId,conversationId,toolId:tool.id,name:tool.name,message:error.message}});
        record(false,`The tool "${tool.name}" failed: ${error.message}`,'error');
      }
    }
    return outcomes;
  }
  async compare({actorId,conversationId,branchId,content,providerIds,model=null,mode=null,sourceIds=[],toolIds=[]}){
    const built=this.#buildContext({conversationId,branchId,content,mode,sourceIds,toolIds});
    const result=await this.providers.compare(providerIds,{actorId,projectId:built.inspection.conversation.projectId,model,messages:built.messages,tools:built.tools,dataClasses:built.dataClasses});
    this.ledger?.append({actor:actorId,action:'models.compared',result:'success',details:{conversationId,providerIds:providerIds.slice(0,8)}});
    return{...result,citations:this.#citations(built.evidence),mode:built.selectedMode};
  }
  async streamToResponse({res,actorId,can=null,conversationId,branchId,content,providerId=null,model=null,mode=null,sourceIds=[],toolIds=[]}){
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
    // Every tool this turn ran, in order, so the persisted message can carry the record. A person
    // reading the conversation tomorrow must be able to see that an answer came from a tool and
    // which one — an answer whose provenance vanishes is exactly the "not independently verified"
    // problem citations already exist to solve, one layer down.
    const toolTrace=[];
    try{
      // The tool loop. Each pass is one full stream; a pass that ends with no tool call is the
      // final answer and ends the turn. Bounded, because a model that calls a tool, reads the
      // result and calls it again forever is a real failure mode and an unbounded one bills the
      // operator's own hardware for it.
      const conversation=[...built.messages];
      for(let round=0;round<=MAX_TOOL_ROUNDS;round+=1){
        let roundText='';let calls=null;
        // `usage` is only ever populated on the frame that carries it (see provider-gateway's
        // usageFrom()) — most deltas in a stream have none, so the running value is kept
        // rather than overwritten with a null on every ordinary text chunk.
        for await(const event of this.providers.streamWithFallback(providerRoute,{actorId,projectId:built.inspection.conversation.projectId,model,messages:conversation,tools:built.tools,dataClasses:built.dataClasses},{signal:controller.signal})){
          selectedProvider=event.providerId;
          if(event.delta){roundText+=event.delta;answer+=event.delta;sse(res,'delta',{runId,providerId:event.providerId,text:event.delta});}
          if(event.usage)usage=event.usage;
          if(event.toolCalls?.length)calls=event.toolCalls;
        }
        if(!calls)break;
        // The last permitted round already ran. Tell the model's own answer why it stopped rather
        // than silently dropping the calls, so the person sees a reason instead of a truncation.
        if(round===MAX_TOOL_ROUNDS){
          const said=`\n\n[Stopped after ${MAX_TOOL_ROUNDS} rounds of tool calls without reaching an answer.]`;
          answer+=said;sse(res,'delta',{runId,providerId:selectedProvider,text:said});
          this.ledger?.append({actor:actorId,action:'chat.tool-loop',result:'exhausted',details:{runId,conversationId,rounds:MAX_TOOL_ROUNDS}});
          break;
        }
        const outcomes=await this.#runToolCalls({calls,built,actorId,runId,conversationId,res,signal:controller.signal,can});
        toolTrace.push(...outcomes.map((item)=>({name:item.name,ok:item.ok,detail:item.detail})));
        // Both halves of the round-trip go back: the assistant turn that ASKED, carrying the calls
        // exactly as the model emitted them, and one result turn per call paired by id. A provider
        // rejects the request outright if either is missing.
        conversation.push({role:'assistant',content:roundText,tool_calls:calls.map((call)=>({id:call.id,type:'function',function:{name:call.name??'',arguments:call.raw??''}}))});
        for(const outcome of outcomes)conversation.push({role:'tool',tool_call_id:outcome.id,content:outcome.content});
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
      // `toolTrace` is persisted with the message, not only streamed: a person reopening this
      // conversation tomorrow must still be able to see that the answer came from a tool and which
      // one. Provenance that exists only in a live SSE frame is provenance that expires.
      const assistant=this.graph.addMessage({conversationId,branchId:branchId??initial.branchId,role:'assistant',content:cleanAnswer||'[Provider returned no text]',metadata:{runId,providerId:selectedProvider,providerRoute,model,mode:selectedMode,usage,agentCreated,toolCalls:toolTrace.length?toolTrace:undefined},citations});
      sse(res,'complete',{runId,message:assistant,providerId:selectedProvider,citations,usage,agentCreated,toolCalls:toolTrace});this.ledger?.append({actor:actorId,action:'chat.complete',result:'success',details:{runId,conversationId,providerId:selectedProvider,providerRoute}});
    }catch(error){const stopped=error.name==='AbortError'||controller.signal.aborted;sse(res,stopped?'stopped':'error',{runId,error:stopped?'Generation stopped.':error.message});this.ledger?.append({actor:actorId,action:'chat.complete',result:stopped?'stopped':'error',details:{runId,message:error.message}});
    }finally{this.active.delete(runId);for(const [key,waiting] of this.pending)if(key.startsWith(`${runId}:`)){clearTimeout(waiting.timer);this.pending.delete(key);}res.end();}
  }
}

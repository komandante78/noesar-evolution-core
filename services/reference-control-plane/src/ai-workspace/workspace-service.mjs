// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { featureVector, hybridSearch } from './search.mjs';
import { detectInjection } from './untrusted-content.mjs';

function now() { return new Date().toISOString(); }
function error(message, status=400) { return Object.assign(new Error(message), { status }); }
function required(value, name, max=200_000) {
  const text = String(value ?? '').trim();
  if (!text) throw error(`${name} is required.`);
  if (text.length > max) throw error(`${name} is too large.`, 413);
  return text;
}
function find(items, id, label) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw error(`${label} not found.`, 404);
  return item;
}
function sanitizeFilename(value) { return String(value ?? 'file').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,180); }
function chunkText(text, size=1800, overlap=180) {
  const chunks=[]; let start=0;
  while (start < text.length) {
    const end=Math.min(text.length,start+size); chunks.push({ start, end, text:text.slice(start,end) });
    if (end === text.length) break; start=Math.max(start+1,end-overlap);
  }
  return chunks;
}

export class WorkspaceService {
  constructor({ store, graph, ledger, fileExtractor=null }) { this.store=store; this.graph=graph; this.ledger=ledger; this.fileExtractor=fileExtractor; }

  snapshot() {
    const state=this.store.read();
    return {
      projects:state.projects.filter((item)=>!item.archived),
      conversations:state.conversations.filter((item)=>!item.archived),
      branches:state.branches,
      memories:state.memories.filter((item)=>!item.deletedAt),
      artifacts:state.artifacts.filter((item)=>!item.deletedAt),
      sources:state.sources.filter((item)=>!item.deletedAt),
      providers:state.providerProfiles.map(({ encryptedCredential, ...safe })=>({ ...safe, credentialConfigured:Boolean(encryptedCredential || safe.credentialEphemeral) })),
      tools:state.tools.filter((item)=>!item.disabled).map(({encryptedCredential,...safe})=>({...safe,credentialConfigured:Boolean(encryptedCredential||safe.credentialEphemeral)})), agents:state.agents.filter((item)=>!item.archived),
      agentRuns:state.agentRuns, tasks:state.tasks, settings:state.settings,
    };
  }

  createMemory({ projectId=null, conversationId=null, scope='project', title, content, tags=[], sensitivity='private', actorId='system' }) {
    if (!['global','project','conversation'].includes(scope)) throw error('Invalid memory scope.');
    return this.store.transact((state)=>{
      if (projectId) find(state.projects, projectId, 'Project');
      if (conversationId) find(state.conversations, conversationId, 'Conversation');
      if (scope==='conversation'&&!conversationId) throw error('conversationId is required for conversation memory.');
      const item={ id:randomUUID(), projectId, conversationId, scope, title:required(title,'memory title',300), content:required(content,'memory content'), tags:[...new Set(tags.map(String))].slice(0,50), sensitivity, visible:true, createdAt:now(), updatedAt:now(), deletedAt:null };
      state.memories.push(item);
      const project=state.projects.find((candidate)=>candidate.id===projectId); if (project) project.memoryIds.push(item.id);
      this.ledger?.append({ actor:actorId, action:'memory.created', result:'success', details:{ memoryId:item.id, projectId, scope } });
      return item;
    });
  }
  updateMemory(memoryId, patch={}, actorId='system') {
    return this.store.transact((state)=>{
      const item=find(state.memories,memoryId,'Memory');
      for (const key of ['title','content','sensitivity']) if (patch[key]!==undefined) item[key]=String(patch[key]).slice(0,key==='title'?300:200_000);
      if (patch.tags) item.tags=[...new Set(patch.tags.map(String))].slice(0,50);
      if (patch.visible!==undefined) item.visible=Boolean(patch.visible);
      item.updatedAt=now(); this.ledger?.append({ actor:actorId, action:'memory.updated', result:'success', details:{ memoryId } }); return item;
    });
  }
  deleteMemory(memoryId, actorId='system') {
    return this.store.transact((state)=>{ const item=find(state.memories,memoryId,'Memory'); item.deletedAt=now(); item.visible=false; this.ledger?.append({ actor:actorId, action:'memory.deleted', result:'success', details:{ memoryId } }); return { deleted:true, id:memoryId }; });
  }
  listMemories({ projectId=null, scope=null }={}) { return this.store.read().memories.filter((item)=>!item.deletedAt && (!projectId || item.projectId===projectId) && (!scope || item.scope===scope)); }

  createArtifact({ projectId=null, conversationId=null, type='document', title, content='', mimeType='text/markdown', metadata={}, actorId='system' }) {
    return this.store.transact((state)=>{
      if (projectId) find(state.projects,projectId,'Project'); if (conversationId) find(state.conversations,conversationId,'Conversation');
      const version={ id:randomUUID(), version:1, content:String(content), createdAt:now(), actorId };
      const item={ id:randomUUID(), projectId, conversationId, type, title:required(title,'artifact title',300), mimeType, metadata, versions:[version], currentVersionId:version.id, createdAt:now(), updatedAt:now(), deletedAt:null };
      state.artifacts.push(item); this.ledger?.append({ actor:actorId, action:'artifact.created', result:'success', details:{ artifactId:item.id, type } }); return item;
    });
  }
  updateArtifact(artifactId,{ content,title,metadata,actorId='system' }={}) {
    return this.store.transact((state)=>{
      const item=find(state.artifacts,artifactId,'Artifact');
      if (title!==undefined) item.title=String(title).slice(0,300); if (metadata!==undefined) item.metadata=metadata;
      if (content!==undefined) { const version={ id:randomUUID(), version:item.versions.length+1, content:String(content), createdAt:now(), actorId }; item.versions.push(version); item.currentVersionId=version.id; }
      item.updatedAt=now(); this.ledger?.append({ actor:actorId, action:'artifact.updated', result:'success', details:{ artifactId } }); return item;
    });
  }
  listArtifacts({ projectId=null,conversationId=null }={}) { return this.store.read().artifacts.filter((item)=>!item.deletedAt && (!projectId || item.projectId===projectId) && (!conversationId || item.conversationId===conversationId)); }

  ingestSource({ projectId=null, name, mimeType='text/plain', text='', origin='upload', uri=null, metadata={}, actorId='system' }) {
    const content=String(text ?? '');
    const sourceName=sanitizeFilename(required(name,'source name',300));
    // Scan at the boundary where third-party content enters the workspace, so a
    // suspicious document is visible to the operator before it is ever retrieved.
    // This records; containment is structural and lives in untrusted-content.mjs.
    const injection=detectInjection(content);
    return this.store.transact((state)=>{
      if (projectId) find(state.projects,projectId,'Project');
      const source={ id:randomUUID(), projectId, name:sourceName, mimeType, origin, uri, metadata, trust:'untrusted', injectionScan:{ suspicious:injection.suspicious, confidence:injection.confidence, signals:injection.signals.map((item)=>item.signal) }, extractionStatus:content ? 'complete':'extractor_required', byteLength:Buffer.byteLength(content), createdAt:now(), updatedAt:now(), deletedAt:null };
      state.sources.push(source);
      if (content) {
        for (const [index,chunk] of chunkText(content).entries()) state.knowledgeChunks.push({ id:randomUUID(), sourceId:source.id, projectId, index, start:chunk.start, end:chunk.end, text:chunk.text, vector:featureVector(chunk.text), createdAt:now() });
      }
      const project=state.projects.find((item)=>item.id===projectId); if (project) project.fileSourceIds.push(source.id);
      this.ledger?.append({ actor:actorId, action:'source.ingested', result:source.extractionStatus, details:{ sourceId:source.id, mimeType, chunks:state.knowledgeChunks.filter((item)=>item.sourceId===source.id).length, injectionSuspected:injection.suspicious, injectionConfidence:injection.confidence } });
      return { ...source, chunkCount:state.knowledgeChunks.filter((item)=>item.sourceId===source.id).length };
    });
  }

  async ingestFile({ projectId=null, name, mimeType='application/octet-stream', bytesBase64, origin='upload', metadata={}, actorId='system' }) {
    if (!this.fileExtractor) throw error('Binary file extraction is not configured.',503);
    const extracted=await this.fileExtractor.extract({name,mimeType,bytesBase64});
    const item=this.ingestSource({projectId,name:extracted.storedName,mimeType,text:extracted.text,origin,metadata:{...metadata,blobId:extracted.blobId,sha256:extracted.sha256,extractor:extracted.extractor,warning:extracted.warning,...extracted.metadata},actorId});
    return this.store.transact((state)=>{
      const source=find(state.sources,item.id,'Source');source.byteLength=extracted.byteLength;source.extractionStatus=extracted.status;source.blobId=extracted.blobId;source.sha256=extracted.sha256;source.updatedAt=now();
      return {...source,chunkCount:state.knowledgeChunks.filter((chunk)=>chunk.sourceId===source.id).length};
    });
  }
  getSource(sourceId,{includePassages=true}={}) {
    const state=this.store.read();const source=find(state.sources,sourceId,'Source');
    return {...source,passages:includePassages?state.knowledgeChunks.filter((item)=>item.sourceId===sourceId).map(({vector,...safe})=>safe):undefined};
  }

  listSources({ projectId=null }={}) { return this.store.read().sources.filter((item)=>!item.deletedAt && (!projectId || item.projectId===projectId)); }
  knowledgeContext(query,{projectId=null,sourceIds=[],policy=null}={}) {
    const state=this.store.read();const project=state.projects.find((item)=>item.id===projectId);const selectedPolicy=policy??project?.knowledgePolicy??{mode:'hybrid',limit:8,maxCharacters:60000};
    if(selectedPolicy.mode==='disabled')return[];
    const sourceMap=new Map(state.sources.filter((item)=>!item.deletedAt).map((item)=>[item.id,item]));
    let chunks=state.knowledgeChunks.filter((item)=>(!projectId||item.projectId===projectId)&&(!sourceIds.length||sourceIds.includes(item.sourceId)));
    if(selectedPolicy.mode==='hybrid')return this.knowledgeSearch(query,{projectId,limit:selectedPolicy.limit??8}).filter((item)=>!sourceIds.length||sourceIds.includes(item.sourceId));
    chunks=chunks.sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.index-b.index);let used=0;const output=[];
    for(const item of chunks){if(used>=selectedPolicy.maxCharacters)break;const text=item.text.slice(0,selectedPolicy.maxCharacters-used);used+=text.length;output.push({...item,text,score:1,source:sourceMap.get(item.sourceId)});}
    return output;
  }

  knowledgeSearch(query,{ projectId=null,limit=12 }={}) {
    const state=this.store.read();
    const sourceMap=new Map(state.sources.map((item)=>[item.id,item]));
    return hybridSearch(query,state.knowledgeChunks.filter((item)=>!projectId || item.projectId===projectId).map((item)=>({ ...item, searchText:item.text })),{ limit }).map((item)=>({ ...item, source:sourceMap.get(item.sourceId) }));
  }

  createTask({projectId=null,title,description='',status='planned',priority='normal',scheduledAt=null,dueAt=null,recurrence=null,agentId=null,actorId='system'}={}) {
    const allowed=new Set(['planned','scheduled','running','blocked','completed','cancelled']);
    return this.store.transact((state)=>{if(projectId)find(state.projects,projectId,'Project');if(agentId)find(state.agents,agentId,'Agent');const item={id:randomUUID(),projectId,title:required(title,'task title',300),description:String(description).slice(0,20000),status:allowed.has(status)?status:'planned',priority:['low','normal','high','critical'].includes(priority)?priority:'normal',scheduledAt:scheduledAt?new Date(scheduledAt).toISOString():null,dueAt:dueAt?new Date(dueAt).toISOString():null,recurrence:recurrence?String(recurrence).slice(0,500):null,agentId,createdAt:now(),updatedAt:now(),completedAt:null};state.tasks.push(item);this.ledger?.append({actor:actorId,action:'task.created',result:'success',details:{taskId:item.id,projectId}});return item;});
  }
  updateTask(taskId,patch={},actorId='system') {
    const allowed=new Set(['planned','scheduled','running','blocked','completed','cancelled']);
    return this.store.transact((state)=>{const item=find(state.tasks,taskId,'Task');for(const key of ['title','description','priority','recurrence'])if(patch[key]!==undefined)item[key]=String(patch[key]).slice(0,key==='description'?20000:500);if(patch.status!==undefined){if(!allowed.has(patch.status))throw error('Invalid task status.');item.status=patch.status;if(patch.status==='completed')item.completedAt=now();}for(const key of ['scheduledAt','dueAt'])if(patch[key]!==undefined)item[key]=patch[key]?new Date(patch[key]).toISOString():null;item.updatedAt=now();this.ledger?.append({actor:actorId,action:'task.updated',result:item.status,details:{taskId}});return item;});
  }
  listTasks({projectId=null,status=null}={}) {return this.store.read().tasks.filter((item)=>(!projectId||item.projectId===projectId)&&(!status||item.status===status));}

  globalSearch(query,{ projectId=null,types=null,limit=30 }={}) {
    const state=this.store.read(); const records=[];
    // A project is not INSIDE a project, so the project scope must not filter projects out.
    // A project record has no `projectId` of its own, so `item.projectId===projectId` was
    // false for every one of them: with a project selected, this search could return no
    // project at all — not the selected one, and not the one you were trying to switch TO.
    // Found in s314 while making the top-bar box the way you get around the product: the box
    // showed nothing for a query the same endpoint answered with two results unscoped.
    // Scoping is about what a project CONTAINS; the projects themselves stay findable.
    const inScope=(type,item)=>!projectId||type==='project'||item.projectId===projectId;
    const push=(type,item,text)=>{ if (inScope(type,item) && (!types || types.includes(type))) records.push({ type,id:item.id,projectId:item.projectId,searchText:text,item }); };
    for (const item of state.projects) if (!item.archived) push('project',item,`${item.name}\n${item.description}\n${item.instructions}\n${item.tags.join(' ')}`);
    for (const item of state.conversations) if (!item.archived) push('conversation',item,item.title);
    for (const item of state.messages) push('message',item,item.content);
    for (const item of state.memories) if (!item.deletedAt && item.visible) push('memory',item,`${item.title}\n${item.content}\n${item.tags.join(' ')}`);
    for (const item of state.artifacts) if (!item.deletedAt) push('artifact',item,`${item.title}\n${item.versions.at(-1)?.content ?? ''}`);
    for (const item of state.sources) if (!item.deletedAt) push('source',item,`${item.name}\n${item.mimeType}\n${JSON.stringify(item.metadata)}`);
    for (const item of state.tools) if (!item.disabled) push('tool',item,`${item.name}\n${item.description ?? ''}`);
    for (const item of state.tasks) push('task',item,`${item.title}\n${item.description ?? ''}\n${item.status}`);
    return hybridSearch(query,records,{ limit });
  }

  contextInspection({ conversationId, branchId }) {
    const state=this.store.read(); const conversation=find(state.conversations,conversationId,'Conversation');
    const branch=branchId ?? conversation.activeBranchId; const messages=this.graph.branchMessages(conversationId,branch);
    const project=conversation.projectId ? state.projects.find((item)=>item.id===conversation.projectId) : null;
    const memories=state.memories.filter((item)=>!item.deletedAt && item.visible && (item.scope==='global' || (item.scope==='project'&&item.projectId===conversation.projectId) || (item.scope==='conversation'&&item.conversationId===conversationId)));
    const sources=state.sources.filter((item)=>!item.deletedAt && item.projectId===conversation.projectId);
    const tools=state.tools.filter((item)=>!item.disabled && (!project || project.toolIds.includes(item.id)));
    const text=[project?.instructions ?? '',...messages.map((item)=>item.content),...memories.map((item)=>item.content)].join('\n');
    return {
      conversation, branchId:branch, project, messages, memories, sources, tools,
      providerId:conversation.providerId ?? state.settings.defaultProviderId, model:conversation.model,
      tokenEstimate:Math.ceil(text.length/4), included:{ messageIds:messages.map((item)=>item.id), memoryIds:memories.map((item)=>item.id), sourceIds:sources.map((item)=>item.id), toolIds:tools.map((item)=>item.id) },
    };
  }

  exportUserData({ includeCredentials=false }={}) {
    const state=structuredClone(this.store.read());
    if(!includeCredentials)for(const profile of state.providerProfiles){delete profile.encryptedCredential;profile.credentialEphemeral=false;}
    if(!includeCredentials)for(const tool of state.tools){delete tool.encryptedCredential;tool.credentialEphemeral=false;}
    return { exportedAt:now(), schemaVersion:state.schemaVersion, credentialsIncluded:Boolean(includeCredentials), data:state };
  }
  updateRetention(days) {
    const retentionDays=Math.min(Math.max(Number(days),1),3650);
    return this.store.transact((state)=>{state.settings.retentionDays=retentionDays;return{retentionDays};});
  }
  applyRetention({at=Date.now()}={}) {
    const state=this.store.read();const cutoff=new Date(at-state.settings.retentionDays*86400000).toISOString();
    // The bin sweep rides on the retention path rather than on a read: a session past its
    // declared bin date is already invisible and already unrestorable, so destroying it is
    // bookkeeping, and bookkeeping does not belong in a GET.
    const bin=this.graph?.purgeExpiredSessions?.({at})??{purged:0,counts:{}};
    const purged=this.purge({before:cutoff});
    return {...purged,expiredSessions:bin.purged,expiredSessionCounts:bin.counts};
  }
  importUserData(bundle,{ replace=false }={}) {
    if (!bundle?.data || bundle.data.schemaVersion!==1) throw error('Invalid export bundle.');
    const imported=structuredClone(bundle.data);for(const profile of imported.providerProfiles??[]){delete profile.encryptedCredential;profile.credentialEphemeral=false;}for(const tool of imported.tools??[]){delete tool.encryptedCredential;tool.credentialEphemeral=false;}
    if (replace) { this.store.write(imported); return { imported:true, mode:'replace' }; }
    return this.store.transact((state)=>{
      for (const key of Object.keys(state)) if (Array.isArray(state[key]) && Array.isArray(imported[key])) {
        const ids=new Set(state[key].map((item)=>item.id)); for (const item of imported[key]) if (!ids.has(item.id)) state[key].push(item);
      }
      return { imported:true, mode:'merge' };
    });
  }
  purge({ projectId=null, before=null }={}) {
    const cutoff=before ? Date.parse(before) : null;const original=this.store.read();
    const old=(item)=>!cutoff||Date.parse(item.updatedAt??item.createdAt??0)<cutoff;
    const conversationIds=new Set(original.conversations.filter((item)=>(!projectId||item.projectId===projectId)&&old(item)).map((item)=>item.id));
    const sourceIds=new Set(original.sources.filter((item)=>(!projectId||item.projectId===projectId)&&old(item)).map((item)=>item.id));
    const agentIds=new Set(original.agents.filter((item)=>(!projectId||item.projectId===projectId)&&old(item)).map((item)=>item.id));
    const blobIds=original.sources.filter((item)=>sourceIds.has(item.id)).map((item)=>item.blobId).filter(Boolean);
    const matches=(key,item)=>{
      if(key==='messages'||key==='branches')return conversationIds.has(item.conversationId)&&old(item);
      if(key==='knowledgeChunks')return sourceIds.has(item.sourceId)&&old(item);
      if(key==='conversations')return conversationIds.has(item.id);
      if(key==='sources')return sourceIds.has(item.id);
      if(key==='agents')return agentIds.has(item.id);
      if(key==='agentRuns')return (agentIds.has(item.agentId)||(!projectId||item.projectId===projectId))&&old(item);
      return(!projectId||item.projectId===projectId)&&old(item);
    };
    const result=this.store.transact((state)=>{const counts={};for(const key of ['messages','memories','artifacts','sources','knowledgeChunks','conversations','branches','tasks','agents','agentRuns']){const prior=state[key].length;state[key]=state[key].filter((item)=>!matches(key,item));counts[key]=prior-state[key].length;}if(projectId){const prior=state.projects.length;state.projects=state.projects.filter((item)=>item.id!==projectId);counts.projects=prior-state.projects.length;}return{purged:true,counts};});
    let blobsDeleted=0;for(const blobId of blobIds)if(this.fileExtractor?.delete(blobId))blobsDeleted+=1;return{...result,blobsDeleted};
  }
}

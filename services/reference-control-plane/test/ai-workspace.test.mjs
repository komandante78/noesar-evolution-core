// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../src/ai-workspace/context-graph.mjs';
import { WorkspaceService } from '../src/ai-workspace/workspace-service.mjs';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'noesar-workspace-'));const store=new AtomicJsonStore(join(dir,'state.json'));const graph=new ContextGraph(store);return{dir,store,graph,service:new WorkspaceService({store,graph})};}

test('project memory is visible editable deletable and exportable',()=>{
  const f=fixture();
  try{
    const p=f.graph.createProject({name:'Project Alpha',instructions:'Never send secrets externally'});
    const memory=f.service.createMemory({projectId:p.id,title:'GPU',content:'RTX 3060 12GB',tags:['hardware']});
    assert.equal(f.service.listMemories({projectId:p.id}).length,1);
    f.service.updateMemory(memory.id,{content:'RTX 3060 12GB LHR'});
    assert.match(f.service.listMemories({projectId:p.id})[0].content,/LHR/);
    const bundle=f.service.exportUserData();
    assert.equal(bundle.data.projects[0].id,p.id);
    f.service.deleteMemory(memory.id);
    assert.equal(f.service.listMemories({projectId:p.id}).length,0);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('hybrid search covers knowledge chunks artifacts messages and projects',()=>{
  const f=fixture();
  try{
    const p=f.graph.createProject({name:'Vector Memory',description:'Semantic project search'});
    const {conversation,branch}=f.graph.createConversation({projectId:p.id,title:'PostgreSQL plan'});
    f.graph.addMessage({conversationId:conversation.id,branchId:branch.id,role:'user',content:'Configure pgvector hybrid retrieval'});
    f.service.ingestSource({projectId:p.id,name:'architecture.md',text:'The knowledge base uses lexical and vector retrieval with citations.'});
    f.service.createArtifact({projectId:p.id,title:'Search Design',content:'Hybrid semantic search and exact keyword matching.'});
    const knowledge=f.service.knowledgeSearch('vector retrieval',{projectId:p.id});
    assert.ok(knowledge.length>=1);
    const global=f.service.globalSearch('semantic search',{projectId:p.id});
    assert.ok(global.some((item)=>['project','artifact','message'].includes(item.type)));
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('a project scope does not hide the projects themselves — you can still search your way to another one',()=>{
  // The assertion above is a disjunction over three types, so it went on passing on the
  // artifact and the message while `project` was in fact never returned at all: a project
  // record carries no `projectId`, so the scope filter `item.projectId===projectId` excluded
  // every one of them. With a project selected, search could not find the project you were
  // trying to switch to — the defect that made the top-bar box show nothing in s314 for a
  // query the same endpoint answered with two results unscoped.
  const f=fixture();
  try{
    const here=f.graph.createProject({name:'before reload',description:'the selected one'});
    f.graph.createProject({name:'after reload',description:'the one you are switching to'});
    const names=f.service.globalSearch('reload',{projectId:here.id})
      .filter((item)=>item.type==='project').map((item)=>item.item.name).sort();
    assert.deepEqual(names,['after reload','before reload']);
    // And the scope still does its job for the things a project genuinely contains: an
    // artifact carries its own projectId, so one belonging elsewhere stays out.
    f.service.createArtifact({projectId:here.id,title:'reload notes',content:'kept'});
    const other=f.graph.createProject({name:'third'});
    f.service.createArtifact({projectId:other.id,title:'reload notes',content:'elsewhere'});
    const artifacts=f.service.globalSearch('reload notes',{projectId:here.id}).filter((item)=>item.type==='artifact');
    assert.equal(artifacts.length,1);
    assert.equal(artifacts[0].projectId,here.id);
    // NOT asserted here, because it is not fixed and a test must not bless a defect: a
    // MESSAGE record carries `conversationId` and no `projectId`, so a project scope drops
    // every message too. Unlike a project, a message really is inside a project — through
    // its conversation — so the filter means to keep it and the data shape defeats it.
    // Resolving conversation→project for each record is a different change with its own
    // cost, measured and reported in s314 rather than smuggled into a navigation phase.
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('context inspector shows model project files memory tools and token estimate',()=>{
  const f=fixture();
  try{
    const p=f.graph.createProject({name:'Context',instructions:'Use citations'});
    const {conversation,branch}=f.graph.createConversation({projectId:p.id,providerId:'provider-1',model:'model-a'});
    f.graph.addMessage({conversationId:conversation.id,branchId:branch.id,role:'user',content:'Question'});
    f.service.createMemory({projectId:p.id,title:'Preference',content:'Italian language'});
    f.service.ingestSource({projectId:p.id,name:'source.txt',text:'Verifiable source passage.'});
    const view=f.service.contextInspection({conversationId:conversation.id,branchId:branch.id});
    assert.equal(view.providerId,'provider-1');assert.equal(view.model,'model-a');assert.equal(view.sources.length,1);assert.equal(view.memories.length,1);assert.ok(view.tokenEstimate>0);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('binary source ingestion stores, extracts, indexes and purges the blob',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'noesar-file-workspace-'));
  try{
    const store=new AtomicJsonStore(join(dir,'state.json'));const graph=new ContextGraph(store);
    const {FileExtractor}=await import('../src/ai-workspace/file-extractors.mjs');
    const extractor=new FileExtractor({blobRoot:join(dir,'files')});const service=new WorkspaceService({store,graph,fileExtractor:extractor});
    const project=graph.createProject({name:'Files'});const bytes=Buffer.from('verifiable document text');
    const source=service.ingestFile({projectId:project.id,name:'evidence.txt',mimeType:'text/plain',bytesBase64:bytes.toString('base64')});
    assert.equal(source.extractionStatus,'complete');assert.equal(service.knowledgeSearch('verifiable',{projectId:project.id})[0].sourceId,source.id);
    const blobPath=join(dir,'files',source.blobId);assert.equal(existsSync(blobPath),true);
    const result=service.purge({projectId:project.id});assert.equal(result.blobsDeleted,1);assert.equal(existsSync(blobPath),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('workspace export excludes encrypted provider and tool credentials by default',()=>{
  const f=fixture();try{f.store.transact((state)=>{state.providerProfiles.push({id:'p',encryptedCredential:{ciphertext:'secret'}});state.tools.push({id:'t',encryptedCredential:{ciphertext:'secret'}});});const bundle=f.service.exportUserData();assert.equal('encryptedCredential' in bundle.data.providerProfiles[0],false);assert.equal('encryptedCredential' in bundle.data.tools[0],false);}finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('project purge removes graph descendants agents tasks and binary sources',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'noesar-purge-'));try{const store=new AtomicJsonStore(join(dir,'state.json'));const graph=new ContextGraph(store);const {FileExtractor}=await import('../src/ai-workspace/file-extractors.mjs');const service=new WorkspaceService({store,graph,fileExtractor:new FileExtractor({blobRoot:join(dir,'files')})});const project=graph.createProject({name:'Delete me'});const {conversation,branch}=graph.createConversation({projectId:project.id});graph.addMessage({conversationId:conversation.id,branchId:branch.id,role:'user',content:'secret project content'});service.createTask({projectId:project.id,title:'task'});store.transact((state)=>{state.agents.push({id:'agent-project',projectId:project.id,name:'a',archived:false,createdAt:new Date().toISOString()});state.agentRuns.push({id:'run-project',agentId:'agent-project',projectId:project.id,createdAt:new Date().toISOString()});});service.ingestFile({projectId:project.id,name:'data.txt',mimeType:'text/plain',bytesBase64:Buffer.from('data').toString('base64')});const result=service.purge({projectId:project.id});const after=store.read();assert.equal(after.projects.length,0);assert.equal(after.conversations.length,0);assert.equal(after.messages.length,0);assert.equal(after.branches.length,0);assert.equal(after.tasks.length,0);assert.equal(after.agents.length,0);assert.equal(after.agentRuns.length,0);assert.equal(after.sources.length,0);assert.equal(result.blobsDeleted,1);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('project knowledge policy supports full-context and conversation memory isolation',()=>{const f=fixture();try{const project=f.graph.createProject({name:'Policy',knowledgePolicy:{mode:'full-context',maxCharacters:10000}});const a=f.graph.createConversation({projectId:project.id,title:'A'});const b=f.graph.createConversation({projectId:project.id,title:'B'});f.service.ingestSource({projectId:project.id,name:'all.txt',text:'alpha full context passage'});f.service.createMemory({projectId:project.id,conversationId:a.conversation.id,scope:'conversation',title:'A only',content:'private A'});assert.equal(f.service.contextInspection({conversationId:a.conversation.id,branchId:a.branch.id}).memories.length,1);assert.equal(f.service.contextInspection({conversationId:b.conversation.id,branchId:b.branch.id}).memories.length,0);assert.match(f.service.knowledgeContext('unrelated',{projectId:project.id})[0].text,/alpha/);}finally{rmSync(f.dir,{recursive:true,force:true});}});

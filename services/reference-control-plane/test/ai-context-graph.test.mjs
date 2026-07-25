// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../src/ai-workspace/context-graph.mjs';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'noesar-graph-'));const store=new AtomicJsonStore(join(dir,'state.json'));return{dir,store,graph:new ContextGraph(store)};}

test('versioned context graph supports edit, fork, exclude, merge and undo',()=>{
  const f=fixture();
  try{
    const project=f.graph.createProject({name:'NOESAR'});
    const {conversation,branch}=f.graph.createConversation({projectId:project.id,title:'Architecture',mode:'ASK'});
    const first=f.graph.addMessage({conversationId:conversation.id,branchId:branch.id,role:'user',content:'Original prompt'});
    const reply=f.graph.addMessage({conversationId:conversation.id,branchId:branch.id,role:'assistant',content:'Original answer'});
    const edited=f.graph.editMessage({messageId:first.id,branchId:branch.id,content:'Edited prompt'});
    assert.equal(edited.supersedesId,first.id);
    const fork=f.graph.fork({conversationId:conversation.id,fromMessageId:reply.id,name:'alternative'});
    const alt=f.graph.addMessage({conversationId:conversation.id,branchId:fork.id,role:'assistant',content:'Alternative answer'});
    assert.equal(f.graph.branchMessages(conversation.id,fork.id).at(-1).id,alt.id);
    f.graph.setMessageExcluded({messageId:reply.id,branchId:fork.id,excluded:true});
    assert.equal(f.graph.branchMessages(conversation.id,fork.id).some((m)=>m.id===reply.id),false);
    const merge=f.graph.merge({conversationId:conversation.id,sourceBranchId:fork.id,targetBranchId:branch.id,note:'Merge alternative'});
    assert.equal(merge.parents.length,2);
    const comparison=f.graph.compareBranches(conversation.id,branch.id,fork.id);
    assert.ok(comparison.leftOnly.length>=1);
    const before=f.graph.getConversation(conversation.id).branches.find((b)=>b.id===branch.id).headId;
    f.graph.undo({branchId:branch.id});
    const after=f.graph.getConversation(conversation.id).branches.find((b)=>b.id===branch.id).headId;
    assert.notEqual(before,after);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('conversation modes are constrained to Ask Create Act',()=>{
  const f=fixture();
  try{
    assert.equal(f.graph.createConversation({mode:'create'}).conversation.mode,'CREATE');
    assert.throws(()=>f.graph.createConversation({mode:'unknown'}),/ASK, CREATE or ACT/);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

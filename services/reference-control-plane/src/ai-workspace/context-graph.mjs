// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';

const MODES = new Set(['ASK','CREATE','ACT']);
const ROLES = new Set(['system','user','assistant','tool']);

function now() { return new Date().toISOString(); }
function requiredText(value, field, max = 200_000) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${field} is required.`), { status:400 });
  if (text.length > max) throw Object.assign(new Error(`${field} exceeds ${max} characters.`), { status:413 });
  return text;
}
function findById(items, id, label) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw Object.assign(new Error(`${label} not found.`), { status:404 });
  return item;
}

export class ContextGraph {
  constructor(store) { this.store = store; }

  createProject({ name, description='', instructions='', tags=[], knowledgePolicy={} } = {}) {
    return this.store.transact((state) => {
      const item = {
        id:randomUUID(), name:requiredText(name, 'project name', 200),
        description:String(description).slice(0, 5000), instructions:String(instructions).slice(0, 50_000),
        tags:[...new Set(tags.map((value) => String(value).trim()).filter(Boolean))].slice(0, 50),
        knowledgePolicy:{mode:['hybrid','full-context','disabled'].includes(String(knowledgePolicy.mode))?String(knowledgePolicy.mode):'hybrid',limit:Math.min(Math.max(Number(knowledgePolicy.limit??8),1),50),maxCharacters:Math.min(Math.max(Number(knowledgePolicy.maxCharacters??60000),1000),500000)},
        fileSourceIds:[], toolIds:[], agentIds:[], memoryIds:[], createdAt:now(), updatedAt:now(), archived:false,
      };
      state.projects.push(item); return item;
    });
  }

  updateProject(projectId, patch = {}) {
    return this.store.transact((state) => {
      const item = findById(state.projects, projectId, 'Project');
      for (const key of ['name','description','instructions']) if (patch[key] !== undefined) item[key] = String(patch[key]).slice(0, key === 'name' ? 200 : 50_000);
      if (patch.tags) item.tags = [...new Set(patch.tags.map(String))].slice(0, 50);
      if (patch.knowledgePolicy) item.knowledgePolicy={mode:['hybrid','full-context','disabled'].includes(String(patch.knowledgePolicy.mode))?String(patch.knowledgePolicy.mode):(item.knowledgePolicy?.mode??'hybrid'),limit:Math.min(Math.max(Number(patch.knowledgePolicy.limit??item.knowledgePolicy?.limit??8),1),50),maxCharacters:Math.min(Math.max(Number(patch.knowledgePolicy.maxCharacters??item.knowledgePolicy?.maxCharacters??60000),1000),500000)};
      if (patch.archived !== undefined) item.archived = Boolean(patch.archived);
      item.updatedAt = now(); return item;
    });
  }

  listProjects() { return this.store.read().projects.filter((item) => !item.archived); }

  createConversation({ projectId=null, title='New conversation', mode='ASK', providerId=null, model=null } = {}) {
    const normalizedMode = String(mode).toUpperCase();
    if (!MODES.has(normalizedMode)) throw Object.assign(new Error('mode must be ASK, CREATE or ACT.'), { status:400 });
    return this.store.transact((state) => {
      if (projectId) findById(state.projects, projectId, 'Project');
      const conversation = {
        id:randomUUID(), projectId, title:String(title).slice(0, 300), mode:normalizedMode,
        providerId, model, createdAt:now(), updatedAt:now(), activeBranchId:null, archived:false,
      };
      const branch = { id:randomUUID(), conversationId:conversation.id, name:'main', headId:null, forkedFromMessageId:null, createdAt:now(), updatedAt:now() };
      conversation.activeBranchId = branch.id;
      state.conversations.push(conversation); state.branches.push(branch);
      return { conversation, branch };
    });
  }

  listConversations({ projectId=null } = {}) {
    return this.store.read().conversations.filter((item) => !item.archived && (!projectId || item.projectId === projectId));
  }

  getConversation(conversationId) {
    const state = this.store.read();
    const conversation = findById(state.conversations, conversationId, 'Conversation');
    return { conversation, branches:state.branches.filter((item) => item.conversationId === conversationId) };
  }

  addMessage({ conversationId, branchId, role, content, parentIds=null, metadata={}, citations=[], status='complete' }) {
    if (!ROLES.has(role)) throw Object.assign(new Error('Invalid message role.'), { status:400 });
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      const branch = findById(state.branches, branchId ?? conversation.activeBranchId, 'Branch');
      if (branch.conversationId !== conversation.id) throw Object.assign(new Error('Branch does not belong to conversation.'), { status:409 });
      const parents = parentIds ?? (branch.headId ? [branch.headId] : []);
      for (const parentId of parents) findById(state.messages, parentId, 'Parent message');
      const message = {
        id:randomUUID(), conversationId, branchId:branch.id, parents:[...new Set(parents)], role,
        content:requiredText(content, 'message content'), metadata, citations, status,
        excludedInBranchIds:[], supersedesId:null, regenerationOfId:null, createdAt:now(), updatedAt:now(),
      };
      state.messages.push(message); branch.headId = message.id; branch.updatedAt = now();
      conversation.activeBranchId = branch.id; conversation.updatedAt = now();
      return message;
    });
  }

  editMessage({ messageId, branchId, content }) {
    return this.store.transact((state) => {
      const original = findById(state.messages, messageId, 'Message');
      const branch = findById(state.branches, branchId ?? original.branchId, 'Branch');
      const replacement = {
        ...structuredClone(original), id:randomUUID(), branchId:branch.id,
        content:requiredText(content, 'message content'), supersedesId:original.id,
        excludedInBranchIds:[], createdAt:now(), updatedAt:now(),
      };
      state.messages.push(replacement); branch.headId = replacement.id; branch.updatedAt = now();
      const conversation = findById(state.conversations, original.conversationId, 'Conversation');
      conversation.activeBranchId = branch.id; conversation.updatedAt = now();
      return replacement;
    });
  }

  regenerateMessage({ messageId, branchId, content, metadata={} }) {
    return this.store.transact((state) => {
      const original = findById(state.messages, messageId, 'Message');
      if (original.role !== 'assistant') throw Object.assign(new Error('Only assistant messages can be regenerated.'), { status:400 });
      const branch = findById(state.branches, branchId ?? original.branchId, 'Branch');
      const replacement = {
        ...structuredClone(original), id:randomUUID(), branchId:branch.id,
        content:requiredText(content, 'message content'), metadata,
        regenerationOfId:original.id, supersedesId:null, excludedInBranchIds:[], createdAt:now(), updatedAt:now(),
      };
      state.messages.push(replacement); branch.headId = replacement.id; branch.updatedAt = now();
      return replacement;
    });
  }

  fork({ conversationId, fromMessageId, name='branch' }) {
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      const message = findById(state.messages, fromMessageId, 'Message');
      if (message.conversationId !== conversation.id) throw Object.assign(new Error('Message does not belong to conversation.'), { status:409 });
      const branch = { id:randomUUID(), conversationId, name:String(name).slice(0,100), headId:message.id, forkedFromMessageId:message.id, createdAt:now(), updatedAt:now() };
      state.branches.push(branch); conversation.activeBranchId = branch.id; conversation.updatedAt = now(); return branch;
    });
  }

  merge({ conversationId, sourceBranchId, targetBranchId, note='Merged conversation branches.' }) {
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      const source = findById(state.branches, sourceBranchId, 'Source branch');
      const target = findById(state.branches, targetBranchId, 'Target branch');
      if (source.conversationId !== conversationId || target.conversationId !== conversationId) throw Object.assign(new Error('Branches must belong to the same conversation.'), { status:409 });
      const parents = [source.headId, target.headId].filter(Boolean);
      const message = {
        id:randomUUID(), conversationId, branchId:target.id, parents:[...new Set(parents)], role:'system',
        content:requiredText(note, 'merge note'), metadata:{ type:'branch-merge', sourceBranchId, targetBranchId }, citations:[], status:'complete',
        excludedInBranchIds:[], supersedesId:null, regenerationOfId:null, createdAt:now(), updatedAt:now(),
      };
      state.messages.push(message); target.headId = message.id; target.updatedAt = now(); conversation.activeBranchId = target.id; conversation.updatedAt = now();
      return message;
    });
  }

  setMessageExcluded({ messageId, branchId, excluded=true }) {
    return this.store.transact((state) => {
      const message = findById(state.messages, messageId, 'Message');
      findById(state.branches, branchId, 'Branch');
      const set = new Set(message.excludedInBranchIds ?? []);
      excluded ? set.add(branchId) : set.delete(branchId);
      message.excludedInBranchIds = [...set]; message.updatedAt = now(); return message;
    });
  }

  undo({ branchId }) {
    return this.store.transact((state) => {
      const branch = findById(state.branches, branchId, 'Branch');
      if (!branch.headId) return branch;
      const head = findById(state.messages, branch.headId, 'Message');
      branch.headId = head.parents[0] ?? null; branch.updatedAt = now(); return branch;
    });
  }

  branchMessages(conversationId, branchId) {
    const state = this.store.read();
    findById(state.conversations, conversationId, 'Conversation');
    const branch = findById(state.branches, branchId, 'Branch');
    const byId = new Map(state.messages.filter((item) => item.conversationId === conversationId).map((item) => [item.id,item]));
    const visited = new Set(); const ordered = [];
    const visit = (id) => {
      if (!id || visited.has(id)) return;
      const node = byId.get(id); if (!node) return;
      for (const parent of node.parents) visit(parent);
      visited.add(id);
      if (!(node.excludedInBranchIds ?? []).includes(branch.id)) ordered.push(node);
    };
    visit(branch.headId);
    return ordered;
  }

  compareBranches(conversationId, leftBranchId, rightBranchId) {
    const left = this.branchMessages(conversationId, leftBranchId);
    const right = this.branchMessages(conversationId, rightBranchId);
    const l = new Set(left.map((item) => item.id)); const r = new Set(right.map((item) => item.id));
    return { shared:left.filter((item) => r.has(item.id)), leftOnly:left.filter((item) => !r.has(item.id)), rightOnly:right.filter((item) => !l.has(item.id)) };
  }
}

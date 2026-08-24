// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { validateFact, projectContext } from '../context-projector.mjs';

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
        deletedAt:null, purgeAfter:null,
      };
      const branch = { id:randomUUID(), conversationId:conversation.id, name:'main', headId:null, forkedFromMessageId:null, createdAt:now(), updatedAt:now() };
      conversation.activeBranchId = branch.id;
      state.conversations.push(conversation); state.branches.push(branch);
      return { conversation, branch };
    });
  }

  // A session in the bin is gone as far as the rest of the product is concerned: it must
  // not appear in the chat picker, the workspace bootstrap or anywhere else that offers
  // somewhere to continue working. Only the Sessions surface knows the bin exists.
  listConversations({ projectId=null } = {}) {
    return this.store.read().conversations.filter((item) => !item.archived && !item.deletedAt && (!projectId || item.projectId === projectId));
  }

  getConversation(conversationId) {
    const state = this.store.read();
    const conversation = findById(state.conversations, conversationId, 'Conversation');
    return { conversation, branches:state.branches.filter((item) => item.conversationId === conversationId) };
  }

  // --- session lifecycle · UI-001…UI-012 -----------------------------------
  //
  // A session is a conversation seen from the operator's side. Three places exist and
  // they are not the same place: the working list, the archive, and the bin.
  //
  // `archive` MOVES (UI-011): the session stays whole and comes back intact. `delete`
  // sends to a bin that keeps it for thirty days (UI-012) — a workspace's most common
  // accident is "deleted by mistake", and the protection costs one field. Only the sweep
  // destroys anything, and only after the declared period has passed.

  /** Days a deleted session survives in the bin before the sweep may destroy it. */
  static get BIN_RETENTION_DAYS() { return 30; }

  /** The shape the interface lists. Counting messages here keeps the caller from
   *  needing the message table to render a row. */
  #sessionSummary(state, conversation) {
    const messages = state.messages.filter((item) => item.conversationId === conversation.id);
    const lastActivityAt = messages.reduce(
      (latest, item) => (item.createdAt > latest ? item.createdAt : latest),
      conversation.updatedAt ?? conversation.createdAt,
    );
    return {
      id:conversation.id, title:conversation.title, projectId:conversation.projectId,
      mode:conversation.mode, createdAt:conversation.createdAt, updatedAt:conversation.updatedAt,
      messageCount:messages.length, lastActivityAt,
      archived:Boolean(conversation.archived),
      deletedAt:conversation.deletedAt ?? null,
      purgeAfter:conversation.purgeAfter ?? null,
    };
  }

  /** True while the bin still owes this session its thirty days. An entry past its date
   *  is treated as gone by every read, so nothing can be listed or restored after the
   *  period the confirmation promised — whether or not the sweep has run yet. */
  #inBin(conversation, at) {
    if (!conversation.deletedAt) return false;
    const until = Date.parse(conversation.purgeAfter ?? 0);
    return Number.isFinite(until) && until > at;
  }

  /**
   * One page of sessions in one of the three places.
   *
   * The range is returned rather than left to the caller to compute: `UI-005` requires
   * the page to state "11–20 of 31", and a range computed twice is a range that can
   * disagree with itself.
   */
  listSessions({ projectId=null, place='active', page=1, pageSize=10, at=Date.now() } = {}) {
    if (!['active','archived','bin'].includes(place)) {
      throw Object.assign(new Error('place must be "active", "archived" or "bin".'), { status:400 });
    }
    const state = this.store.read();
    const belongs = (item) => !projectId || item.projectId === projectId;
    const matches = (item) => {
      if (place === 'bin') return this.#inBin(item, at);
      if (item.deletedAt) return false;
      return place === 'archived' ? Boolean(item.archived) : !item.archived;
    };
    const all = state.conversations.filter((item) => belongs(item) && matches(item))
      .map((item) => this.#sessionSummary(state, item))
      .sort((left, right) => (left.lastActivityAt < right.lastActivityAt ? 1 : -1));
    const size = Math.min(Math.max(Number(pageSize) || 10, 1), 100);
    const pageCount = Math.max(Math.ceil(all.length / size), 1);
    const current = Math.min(Math.max(Number(page) || 1, 1), pageCount);
    const offset = (current - 1) * size;
    const items = all.slice(offset, offset + size);
    return {
      place, items, total:all.length, page:current, pageSize:size, pageCount,
      from:all.length ? offset + 1 : 0, to:offset + items.length,
      binRetentionDays:ContextGraph.BIN_RETENTION_DAYS,
    };
  }

  /** Archive moves a session out of the working list and back again. Nothing is lost:
   *  the messages, branches and artifacts are untouched. */
  archiveSession(conversationId, { archived=true, at=Date.now() } = {}) {
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      if (this.#inBin(conversation, at) || conversation.deletedAt) {
        throw Object.assign(new Error('A deleted session must be restored before it can be archived.'), { status:409 });
      }
      conversation.archived = Boolean(archived);
      conversation.updatedAt = new Date(at).toISOString();
      return this.#sessionSummary(state, conversation);
    });
  }

  /** Delete sends to the bin and states when it expires. It does not destroy. */
  binSession(conversationId, { at=Date.now() } = {}) {
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      if (conversation.deletedAt) return this.#sessionSummary(state, conversation);
      conversation.deletedAt = new Date(at).toISOString();
      conversation.purgeAfter = new Date(at + ContextGraph.BIN_RETENTION_DAYS * 86_400_000).toISOString();
      conversation.updatedAt = conversation.deletedAt;
      return this.#sessionSummary(state, conversation);
    });
  }

  /** Out of the bin, or out of the archive — both are the same verb to the operator and
   *  both put the session back where work happens. */
  restoreSession(conversationId, { at=Date.now() } = {}) {
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      if (conversation.deletedAt && !this.#inBin(conversation, at)) {
        throw Object.assign(new Error('This session passed its bin retention period and can no longer be restored.'), { status:410 });
      }
      conversation.deletedAt = null; conversation.purgeAfter = null; conversation.archived = false;
      conversation.updatedAt = new Date(at).toISOString();
      return this.#sessionSummary(state, conversation);
    });
  }

  /**
   * Destroys a session for good, with its branches and messages.
   *
   * Memories and artifacts are not destroyed with it unless they were scoped to this
   * session alone: they belong to the project. What is destroyed is the *reference* —
   * a `conversationId` pointing at a session that no longer exists is a dangling claim
   * of provenance, which is the same class of defect as a schema nobody reads.
   */
  purgeSession(conversationId) {
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      const counts = { conversations:1, branches:0, messages:0, memories:0 };
      const before = { branches:state.branches.length, messages:state.messages.length, memories:state.memories.length };
      state.branches = state.branches.filter((item) => item.conversationId !== conversationId);
      state.messages = state.messages.filter((item) => item.conversationId !== conversationId);
      state.memories = state.memories.filter((item) => !(item.scope === 'conversation' && item.conversationId === conversationId));
      counts.branches = before.branches - state.branches.length;
      counts.messages = before.messages - state.messages.length;
      counts.memories = before.memories - state.memories.length;
      for (const collection of ['memories','artifacts']) {
        for (const item of state[collection]) if (item.conversationId === conversationId) item.conversationId = null;
      }
      state.conversations = state.conversations.filter((item) => item.id !== conversationId);
      return { purged:true, id:conversation.id, counts };
    });
  }

  /** The sweep. Only this destroys binned sessions, and only those whose declared date
   *  has passed. It is called from the retention path, never from a read. */
  purgeExpiredSessions({ at=Date.now() } = {}) {
    const state = this.store.read();
    const expired = state.conversations
      .filter((item) => item.deletedAt && !this.#inBin(item, at))
      .map((item) => item.id);
    const counts = { conversations:0, branches:0, messages:0, memories:0 };
    for (const id of expired) {
      const result = this.purgeSession(id);
      for (const key of Object.keys(counts)) counts[key] += result.counts[key] ?? 0;
    }
    return { purged:expired.length, ids:expired, counts };
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

  /**
   * Empty the thread the person is looking at, without destroying a word of it.
   *
   * Owner, 2026-08-24: *"ho detto di mettere qualcosa per pulire intera chat"*. The obvious
   * implementation — delete the messages — is the one this product must not ship: `binSession`
   * exists precisely because "deleted by mistake" is a workspace's most common accident, and
   * `CLAUDE10.md` §4 forbids destruction by implication. A versioned graph does not need it.
   *
   * So clearing opens a NEW, EMPTY branch and makes it active. `branchMessages` walks from
   * `headId`, so a branch with no head renders as a clean thread — while the previous branch
   * keeps every message and stays selectable in the branch picker, and `Compare branches` can
   * still show it. Nothing is lost, and the screen is genuinely empty.
   *
   * Real deletion remains where it already lives and where it is confirmed and reversible for
   * thirty days: the Sessions surface (`binSession` / `purgeSession`). Two verbs, two places,
   * neither pretending to be the other.
   */
  clearConversation({ conversationId, name=null } = {}) {
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      const existing = state.branches.filter((item) => item.conversationId === conversation.id);
      const cleared = existing.filter((item) => /^clean(-\d+)?$/.test(item.name)).length;
      const branch = {
        id:randomUUID(), conversationId, name:String(name ?? `clean-${cleared + 1}`).slice(0,100),
        headId:null, forkedFromMessageId:null, createdAt:now(), updatedAt:now(),
      };
      state.branches.push(branch);
      const previousBranchId = conversation.activeBranchId;
      conversation.activeBranchId = branch.id; conversation.updatedAt = now();
      // The count is returned rather than looked up again by the caller: the interface has to
      // tell the person what it just set aside ("42 messages kept on branch main"), and a
      // second read could disagree with the transaction that actually moved it.
      const kept = state.messages.filter((item) => item.branchId === previousBranchId).length;
      return { branch, previousBranchId, keptMessageCount:kept };
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

  // --- session state · invention I -----------------------------------------
  //
  // Until phase 4 this class was ONLY an archive of messages, and `16` §5 named it as such:
  // *«`context-graph.mjs` è un archivio di messaggi che accumula»*. It still is an archive,
  // and it must be — the messages are the RECORD of what happened, and a record that forgets
  // is not a record. What it was missing is the other half: the session's STATE.
  //
  // The two are not the same thing and are not read for the same purpose:
  //
  //   messages   what was said, in order, kept whole, grows with the session — the record
  //   facts      what is TRUE of this session now, typed, capped when projected — the state
  //
  // Every call to the model is built from the second (`context-projector.mjs`), never from
  // the first. `projectSessionContext` deliberately does not call `branchMessages`, and a
  // test asserts the projection is identical whether the branch holds four messages or eight
  // hundred: that is the whole of `CE-005`, and it is not true of anything that reads a
  // transcript, however carefully it trims one.

  /**
   * Writes one typed fact into the session's state.
   *
   * There is no other way in, and there is no free-text section to aim at: the projector's
   * schema refuses an unknown section, an unknown field, a wrong type and an oversized
   * string, naming which (`ContextSchemaViolation`, `CE-004`). A component that wants to
   * influence the model states its fact in the schema's terms or does not get to.
   */
  recordContextFact({ conversationId, section, value }) {
    // Validated BEFORE the transaction opens: a refused write must not have touched the
    // store, and must not leave a conversation's `updatedAt` claiming something happened.
    const normalised = validateFact(section, value);
    return this.store.transact((state) => {
      const conversation = findById(state.conversations, conversationId, 'Conversation');
      // Additive field, defaulted at every read site — the same shape the migration to
      // schemaVersion 3 used for `deletedAt` and `purgeAfter`, and the reason this phase
      // needs no version bump: a conversation written before it reads as having no facts,
      // which is exactly what it has.
      conversation.contextFacts = [...(conversation.contextFacts ?? []), { section, value:normalised, at:now() }];
      conversation.updatedAt = now();
      return { conversationId, section, value:normalised, total:conversation.contextFacts.length };
    });
  }

  /** The record side of the state: every fact this session has written, in order. Uncapped
   *  on purpose — the cap belongs to the projection, not to what is kept. */
  contextFacts(conversationId) {
    const state = this.store.read();
    return [...(findById(state.conversations, conversationId, 'Conversation').contextFacts ?? [])];
  }

  /** The view a model call receives: rebuilt from zero out of the facts, bounded by the
   *  schema, and independent of how many messages the branch holds. */
  projectSessionContext(conversationId) {
    return projectContext(this.contextFacts(conversationId));
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

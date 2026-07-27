// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The session lifecycle — UI-001…UI-012.
//
// Three places exist and they are not the same place: the working list, the archive and
// the bin. The criteria that matter most here are the ones a careless implementation
// silently breaks:
//
//   UI-011  archive MOVES — the session comes back whole, with its messages
//   UI-012  delete goes to a bin that keeps it for a declared period
//
// and the one nobody writes a test for: a binned session must disappear from every
// OTHER surface too. A "deleted" session still offered in the chat picker is not deleted,
// it is merely hidden from the page that deleted it.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { ContextGraph } from '../src/ai-workspace/context-graph.mjs';

const DAY = 86_400_000;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-sessions-'));
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  return { dir, store, graph:new ContextGraph(store) };
}
function makeSession(graph, title, { messages = 0 } = {}) {
  const { conversation, branch } = graph.createConversation({ title, mode:'ASK' });
  for (let index = 0; index < messages; index += 1) {
    graph.addMessage({ conversationId:conversation.id, branchId:branch.id, role:'user', content:`message ${index}` });
  }
  return conversation;
}

describe('session lifecycle', () => {
  test('archiving moves a session and restoring brings it back whole', () => {
    const f = fixture();
    try {
      const session = makeSession(f.graph, 'Architecture', { messages:3 });
      f.graph.archiveSession(session.id);

      assert.equal(f.graph.listSessions({ place:'active' }).total, 0);
      assert.equal(f.graph.listSessions({ place:'archived' }).total, 1);
      // UI-011: archive is a move, not a destruction. The messages are still there.
      assert.equal(f.graph.listSessions({ place:'archived' }).items[0].messageCount, 3);

      f.graph.restoreSession(session.id);
      const active = f.graph.listSessions({ place:'active' });
      assert.equal(active.total, 1);
      assert.equal(active.items[0].messageCount, 3);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('deleting goes to a bin that keeps the session for its declared period', () => {
    const f = fixture();
    try {
      const session = makeSession(f.graph, 'Draft', { messages:2 });
      const at = Date.parse('2026-01-01T00:00:00.000Z');
      const binned = f.graph.binSession(session.id, { at });

      assert.equal(binned.deletedAt, '2026-01-01T00:00:00.000Z');
      assert.equal(binned.purgeAfter, '2026-01-31T00:00:00.000Z');
      assert.equal(ContextGraph.BIN_RETENTION_DAYS, 30);

      // Present in the bin, absent from the working list, and still whole.
      assert.equal(f.graph.listSessions({ place:'bin', at }).total, 1);
      assert.equal(f.graph.listSessions({ place:'bin', at }).items[0].messageCount, 2);
      assert.equal(f.graph.listSessions({ place:'active', at }).total, 0);

      f.graph.restoreSession(session.id, { at: at + 29 * DAY });
      assert.equal(f.graph.listSessions({ place:'active', at: at + 29 * DAY }).total, 1);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('a binned session disappears from every other surface, not only from its own page', () => {
    const f = fixture();
    try {
      const kept = makeSession(f.graph, 'Kept');
      const gone = makeSession(f.graph, 'Gone');
      f.graph.binSession(gone.id);
      const listed = f.graph.listConversations().map((item) => item.id);
      assert.deepEqual(listed, [kept.id]);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('past its date a binned session is neither listed nor restorable', () => {
    const f = fixture();
    try {
      const session = makeSession(f.graph, 'Expired');
      const at = Date.parse('2026-01-01T00:00:00.000Z');
      f.graph.binSession(session.id, { at });
      const later = at + 31 * DAY;

      assert.equal(f.graph.listSessions({ place:'bin', at:later }).total, 0);
      assert.throws(() => f.graph.restoreSession(session.id, { at:later }), /retention period/);
      // And it is not quietly back in the working list either — it is nowhere.
      assert.equal(f.graph.listSessions({ place:'active', at:later }).total, 0);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('the sweep destroys only what is past its date, with its branches and messages', () => {
    const f = fixture();
    try {
      const at = Date.parse('2026-01-01T00:00:00.000Z');
      const old = makeSession(f.graph, 'Old', { messages:2 });
      const fresh = makeSession(f.graph, 'Fresh', { messages:1 });
      const alive = makeSession(f.graph, 'Alive', { messages:1 });
      f.graph.binSession(old.id, { at });
      f.graph.binSession(fresh.id, { at: at + 20 * DAY });

      const swept = f.graph.purgeExpiredSessions({ at: at + 31 * DAY });
      assert.equal(swept.purged, 1);
      assert.deepEqual(swept.ids, [old.id]);
      assert.equal(swept.counts.messages, 2);

      const state = f.store.read();
      assert.equal(state.conversations.some((item) => item.id === old.id), false);
      assert.equal(state.messages.some((item) => item.conversationId === old.id), false);
      assert.equal(state.branches.some((item) => item.conversationId === old.id), false);
      // Untouched: one still inside its period, one never deleted at all.
      assert.equal(state.conversations.filter((item) => [fresh.id, alive.id].includes(item.id)).length, 2);
      assert.equal(state.messages.length, 2);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('purging a session removes what belonged to it and leaves no dangling reference', () => {
    const f = fixture();
    try {
      const project = f.graph.createProject({ name:'NOESAR' });
      const { conversation } = f.graph.createConversation({ projectId:project.id, title:'Work' });
      const state = f.store.transact((draft) => {
        draft.memories.push({ id:'m-session', projectId:project.id, conversationId:conversation.id, scope:'conversation', title:'inside', content:'x', tags:[], visible:true, deletedAt:null });
        draft.memories.push({ id:'m-project', projectId:project.id, conversationId:conversation.id, scope:'project', title:'wider', content:'x', tags:[], visible:true, deletedAt:null });
        draft.artifacts.push({ id:'a-1', projectId:project.id, conversationId:conversation.id, title:'note', versions:[], deletedAt:null });
        return draft;
      });
      assert.equal(state.memories.length, 2);

      f.graph.purgeSession(conversation.id);
      const after = f.store.read();
      // Scoped to the session: gone with it. Wider than the session: kept, but its
      // reference to a session that no longer exists is cleared rather than left dangling.
      assert.equal(after.memories.some((item) => item.id === 'm-session'), false);
      assert.equal(after.memories.find((item) => item.id === 'm-project').conversationId, null);
      assert.equal(after.artifacts.find((item) => item.id === 'a-1').conversationId, null);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('the page states the range it is showing, and the range agrees with the count', () => {
    const f = fixture();
    try {
      for (let index = 0; index < 31; index += 1) {
        const session = makeSession(f.graph, `Session ${index}`);
        f.graph.archiveSession(session.id, { at: Date.parse('2026-01-01T00:00:00.000Z') + index * 1000 });
      }
      const second = f.graph.listSessions({ place:'archived', page:2, pageSize:10 });
      // UI-005: "11–20 of 31", computed where the slice is computed.
      assert.equal(second.total, 31);
      assert.equal(second.from, 11);
      assert.equal(second.to, 20);
      assert.equal(second.items.length, 10);
      assert.equal(second.pageCount, 4);

      const last = f.graph.listSessions({ place:'archived', page:4, pageSize:10 });
      assert.equal(last.from, 31);
      assert.equal(last.to, 31);
      assert.equal(last.items.length, 1);

      // A page beyond the end lands on the last page rather than showing an empty page
      // with a range nobody can read.
      assert.equal(f.graph.listSessions({ place:'archived', page:99, pageSize:10 }).page, 4);
      const empty = f.graph.listSessions({ place:'bin' });
      assert.deepEqual([empty.total, empty.from, empty.to], [0, 0, 0]);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });

  test('a deleted session cannot be archived, and an unknown place is refused', () => {
    const f = fixture();
    try {
      const session = makeSession(f.graph, 'Draft');
      f.graph.binSession(session.id);
      assert.throws(() => f.graph.archiveSession(session.id), /must be restored/);
      assert.throws(() => f.graph.listSessions({ place:'everything' }), /place must be/);
    } finally { rmSync(f.dir, { recursive:true, force:true }); }
  });
});

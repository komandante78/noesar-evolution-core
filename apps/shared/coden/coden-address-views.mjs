// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What an ADDRESS shows in a terminal — one table, rendered by both terminal shells.
//
// # Why this is a module of its own, since phase 3c
//
// These views were written in phase 3b inside `tui-client.mjs`, printing to stdout. That
// quietly decided only ONE shell could ever render an address, and the decision was invisible
// because both shells live in that file's neighbourhood: `tui-client.mjs` runs the LINE shell,
// and only when stdin is a pipe. A real user over `ssh` gets `runFullScreen`, which had its
// own `navigate` branch answering "this shell has no view for it yet (phase 3b)" — about work
// phase 3b had finished. Measured when 3c opened: 25 of 25 addresses rendered in the line
// shell, 0 of 25 at the prompt.
//
// Putting the table back in either shell would have made the other import it, and the two
// already import each other. So it belongs to NEITHER: one table, two renderings — the line
// shell prints the lines, the full-screen shell records them into its transcript.
//
// Each view routes to the same engine call the browser's own panel is drawn from, and labels
// its output with the panel's label from the SERVED list, so even the heading a reader sees is
// the workbench's word for that panel rather than a second one chosen here. An address absent
// from this table is not one this file forgot: it is one this socket has no method for, and
// `showAddress` says so in those words rather than printing an empty result that would read as
// "there are none".

// Phase 3c: the sink comes first, because the address views are now rendered by TWO shells.
// The line shell prints; the full-screen shell collects the same lines into its transcript.
// One table of views, two renderings — the alternative was a second table for the prompt,
// which is `PANEL_NAMES` again with the drift moved one file over.
export function printJson(write, label, value) {
  write(`\n${label}:`);
  write(JSON.stringify(value, null, 2));
  write('');
}

export async function runSessionsList(session, state, rest, write = console.log) {
  let place = 'active'; let page;
  for (const token of rest) {
    if (['active', 'archived', 'bin'].includes(token)) place = token;
    else if (/^\d+$/.test(token)) page = Number(token);
    else { write(`Unrecognized argument \`${token}\`. Usage: sessions [active|archived|bin] [page]`); return; }
  }
  const result = await session.call('sessions.list', { place, page: page ?? 1 });
  state.lastList = { place: result.place, items: result.items };
  write(`\n${result.place} — ${result.from}-${result.to} of ${result.total} (page ${result.page}/${result.pageCount})`);
  if (!result.items.length) { write('  (none)\n'); return; }
  result.items.forEach((item, index) => {
    const flags = [item.archived ? 'archived' : null, item.deletedAt ? 'in bin' : null].filter(Boolean).join(', ');
    write(`  ${index + 1}. ${item.title}  [${item.messageCount} msgs, last ${item.lastActivityAt}]${flags ? ` (${flags})` : ''}`);
  });
  write('');
}

/** Phase 3b. One of the seven bench list panels, off the ONE call that serves all seven —
 *  the same shape the browser fills them from. Shared rather than written out seven times so
 *  the seven cannot drift into seven slightly different renderings of one thing, which is
 *  `PANEL_NAMES` again at a smaller scale.
 *
 *  The cap and the total both come from the engine, and the count is PRINTED: the browser
 *  slices to six as well, so showing sixty here would be the two shells disagreeing about what
 *  the panel is, and showing six silently would let a reader take six for all of them. */
async function benchList({ session, entry, write }) {
  const { lists } = await session.call('coden.benchLists', {});
  // The key comes off the SERVED entry, never from a literal in this file. A first draft took
  // the panel name as an argument, one call per panel, and `coden-addressable-panels.test.mjs`
  // refused it — correctly: six panel names written here are six names that can drift from the
  // markup, which is exactly how `PANEL_NAMES` reached fourteen against twenty-five. Reading
  // `entry.panel` makes the engine's key and the markup's panel one thing, and a mismatch
  // surfaces as a missing list rather than silently.
  //
  // (That guard reads comments as well as code, so naming one of the panels in this paragraph
  // would fail it again — and rightly: it cannot tell a comment from a table, and a guard
  // narrowed to tell them apart would stop catching a table written as one.)
  const list = lists?.[entry.panel];
  if (!list) { write(`${entry.label} — this deployment served no list for this panel.`); return; }
  if (!list.total) { write(`${entry.label} — none.`); return; }
  write(`${entry.label} — showing ${list.shown.length} of ${list.total}:`);
  for (const item of list.shown) {
    write(`  ${item.name ?? item.title ?? item.goal ?? item.id}${item.status ? ` · ${item.status}` : ''}`);
  }
}

const ADDRESS_VIEWS = {
  'coden/bench/map': async ({ session, arg, entry, write }) => printJson(write, entry.label, await session.call('repoMap.scan', { path: arg || undefined })),
  'coden/bench/projects': benchList,
  'coden/bench/recent': benchList,
  'coden/bench/tasks': benchList,
  'coden/bench/agents': benchList,
  'coden/bench/tools': benchList,
  'coden/bench/history': benchList,
  // The browser's Conversation panel says the bench conversation IS the Chat session and this
  // shell's — "not a second chat with its own state". So this shows the session the shell is
  // attached to, from the verb family it already has, rather than inventing a per-panel
  // conversation object the browser does not have either.
  'coden/agent/conversation': async ({ session, entry, write }) => {
    const listed = await session.call('sessions.list', { place: 'active', pageSize: 1 });
    const current = (listed?.sessions ?? listed?.items ?? [])[0];
    write(`${entry.label} — ${current
      ? `${current.title ?? current.id} — the same session Chat and this shell share`
      : 'no conversation is active in this session yet'}`);
  },
  'coden/bench/closure': async ({ session, entry, write }) => {
    const { closures } = await session.call('closure.list', {});
    if (!closures.length) { write(`${entry.label} — nothing closed yet. \`closure <runId>\` records one.`); return; }
    write(`${entry.label} — ${closures.length} closed:`);
    for (const item of closures) {
      // NOT DONE first, and never omitted. `UI-036`: a report that lists only what went well
      // teaches uniform trust, which is the opposite of useful — so the field the object
      // exists to carry leads, rather than sitting under a summary a reader will skim.
      write(`  ${item.runId} · ${item.closedAt} · ${item.actorId}`);
      write(`    NOT DONE: ${item.nothingLeftUndone ? 'nothing was left undone, and that was stated' : item.notDone.join('; ')}`);
      write(`    residual risk: ${item.residualRisk}`);
      if (item.summary) write(`    ${item.summary}`);
    }
  },
  'coden/bench/shadow': async ({ session, entry, write }) => printJson(write, entry.label, (await session.call('status', {})).shadow),
  'coden/bench/logs': async ({ session, arg, entry, write }) => printJson(write, entry.label, await session.call('events.correlation', { correlationId: arg })),
  'coden/bench/editor': async ({ session, arg, entry, write }) => printJson(write, entry.label, await session.call('workspace.get', { runId: arg })),
  'coden/bench/diff': async ({ session, arg, entry, write }) => printJson(write, entry.label, await session.call('workspace.get', { runId: arg })),
  // The bench's Sessions panel and the browser's Sessions page are two doors onto the list
  // this shell already has a whole verb family for. Routing them here rather than leaving
  // them "not sourced" is the parity the phase is about: the same address, in either shell,
  // shows the same sessions.
  'coden/bench/sessions': async ({ session, state, write }) => runSessionsList(session, state, [], write),
  'settings/sessions': async ({ session, state, write }) => runSessionsList(session, state, [], write),
  // `D-0577`. The posture AND what is actually outstanding. Printing the posture alone was
  // true and useless: it said tokens are enforced by the engine and never said which grants
  // this engine is holding, so the panel named "Authority requests" could not show a single
  // request. The grants come from their own method because they carry their own permission —
  // a reader who may not see workspace paths is told so, rather than shown an empty list that
  // reads as "nothing outstanding".
  'coden/agent/authority': async ({ session, entry, write }) => {
    printJson(write, entry.label, (await session.call('status', {})).capability);
    let grants = null;
    try {
      const answer = await session.call('capability.grants', {});
      grants = Array.isArray(answer?.grants) ? answer.grants : null;
      // A payload without the field is not an empty list, and must never be rendered as one:
      // "none outstanding" is a claim about the engine, and making it from a shape this shell
      // did not recognise would be the panel inventing a reassurance. Found by
      // `coden-shell-parity`, whose transport answers `{}` to a method it has not been taught —
      // exactly what an older engine on the other end of this socket would do.
      if (!grants) { write('  live grants — not shown: this engine did not answer with a grant list.'); return; }
    } catch (error) {
      write(`  live grants — not shown: ${error?.message ?? 'this account may not read the workspace'}`);
      return;
    }
    if (!grants.length) { write('  live grants — none outstanding. A grant appears here between mint and its last use.'); return; }
    write(`  live grants — ${grants.length} outstanding:`);
    for (const grant of grants) {
      write(`    ${grant.tokenId} · step ${grant.stepId} · ${grant.operations.join(',')} · ${grant.usesRemaining}/${grant.usesGranted} uses left${grant.expired ? ' · LAPSED' : ''}`);
      write(`      ${grant.paths.join(', ')}`);
    }
    write('  `revoke <token>` withdraws one now, instead of waiting for it to lapse.');
  },
  'coden/agent/invariants': async ({ session, write }) => {
    const { invariants } = await session.call('product.invariants', {});
    for (const entry of invariants) write(`  ${String(entry.id ?? '').replace(/_/g, ' ')} — ${entry.status === 'ACTIVE' ? `enforced here (${entry.enforcedBy})` : `enforced elsewhere (${entry.enforcedBy})`}`);
  },
};

/** Addresses whose honest answer here is about the TRANSPORT, not about the product — so
 *  they are written here rather than read off the markup. The browser's Terminal panel says
 *  "this tab moves focus to the terminal region"; in a terminal that sentence is not true,
 *  and reprinting it would be a copy that lies rather than a copy that drifts. */
const TRANSPORT_NOTES = {
  'coden/bench/terminal': 'You are in it. The workbench docks this region below the bench; here it is the whole shell.',
  'coden/agent/plan': 'Use `plan` to start one, or `get <runId>` for an existing run\'s state.',
  'coden-tui': 'You are in it — this program is that destination.',
};

/** The three addresses whose view needs a run named, and the usage line each gives without
 *  one. A hotkey does not invent a runId any more than typing the bare command would. */
const NEEDS_RUN_ID = new Set(['coden/bench/logs', 'coden/bench/editor', 'coden/bench/diff']);

/**
 * Render one address. Returns the lines it produced, and ALSO writes them to `write`.
 *
 * Phase 3c. Until now this printed straight to stdout, which quietly decided that only the
 * line shell could ever render an address — and that turned out to be the whole defect the
 * phase opened on: `tui-client.mjs` runs the line shell only when stdin is a PIPE, so a real
 * user over `ssh` gets `runFullScreen`, whose own `navigate` branch still answered "this
 * shell has no view for it yet (phase 3b)". Measured at the start of 3c: 25 of 25 CodeN
 * addresses rendered here, 0 of 25 at the prompt. Phase 3b's work was real and reached the
 * shell almost nobody uses.
 *
 * So the sink is a parameter and the lines come back. One table of views, two renderings:
 * the line shell prints them, the full-screen shell records them into its transcript. The
 * alternative — a second table for the prompt — is `PANEL_NAMES` with the drift moved one
 * file over, and this project has paid for that arrangement twice already.
 */
export async function showAddress(session, state, entry, arg, write = console.log) {
  if (!entry) return [];
  const lines = [];
  // Split on newlines. These views were written against stdout, where `write('\nLabel:')` means
  // a blank line and then a label; collected as ONE transcript entry it becomes a "line" with a
  // line break inside it, and the frame indents the first physical line while the rest hang at
  // column zero. Found by driving the shell, not by reading it — the sessions list came out with
  // its heading unindented and torn away from its own rows. The sink still receives exactly what
  // the view wrote, so the line shell's output is unchanged.
  const emit = (text = '') => {
    for (const line of String(text).split('\n')) lines.push(line);
    write(text);
  };
  const { address } = entry;
  if (NEEDS_RUN_ID.has(address) && !arg) {
    emit(`Usage: /${address} <runId>   (or \`panel ${entry.panel} <runId>\`)`);
    return lines;
  }
  const view = ADDRESS_VIEWS[address];
  if (view) { await view({ session, state, arg, entry, write: emit }); return lines; }
  if (TRANSPORT_NOTES[address]) { emit(TRANSPORT_NOTES[address]); return lines; }
  // The panel's own declared-empty text, served from the markup the browser renders it
  // from. This used to be a hand-copied table in this file; six strings, four of which had
  // already drifted from the paragraphs they claimed to quote.
  if (entry.declaredEmpty?.length) {
    emit(`${entry.label} — what this panel declares:`);
    for (const paragraph of entry.declaredEmpty) emit(`  ${paragraph}`);
    return lines;
  }
  // A page and a panel are different kinds of "not here", and saying so is the difference
  // between a shell that looks broken and one that tells you where you are. A page belongs
  // to the browser shell and always did; a PANEL is a place this shell shows in general,
  // and this particular one is filled over routes the socket does not carry — printing an
  // empty result for it would read as "there are none", which is a different claim.
  emit(entry.region
    ? `${entry.label} (/${address}) — no source over this transport. The workbench fills this panel from routes this socket does not carry, and an empty result printed here would read as "there are none".`
    : `${entry.label} (/${address}) — a destination of the browser shell. The address is real and means the same place there; a terminal has no view of it.`);
  return lines;
}

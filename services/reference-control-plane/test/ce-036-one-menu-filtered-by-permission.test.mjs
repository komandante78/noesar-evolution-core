// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-036` — *«`/` apre l'unico menu del prodotto: lavoro, applicazioni, configurazione,
// sessione — stesse voci nelle due shell, filtrate per permesso e dichiarate tali»*
// (`MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` §11, severity **H**),
// verification method *«l'insieme delle voci di ciascuna shell, per due account con permessi
// diversi»*.
//
// # Four claims, and the fourth is the one that rots quietly
//
//   the ONE menu        `/` is the whole product's menu, not one shell's shortcut list
//   four groups         work · applications · configure · session — in the DATA, and painted as
//                       headings only by `/help`: the `/` box paints one flat ranked list, by
//                       `D-0437`, an Owner instruction that supersedes this clause. Measured
//                       below rather than excused in prose.
//   same entries        the two shells offer the same set for the same account (`CE-034`)
//   FILTERED AND SAID   an entry the account cannot use does not appear, **and the menu says
//                       so, and says what it would need**
//
// The fourth is the one this file exists for. A menu that silently shortens itself is
// indistinguishable from a broken one, and the person reading it cannot tell which — the same
// ambiguity `accessFiltered:false` exists to remove one level up. So the note is asserted in
// all THREE of its states, including the state where the shell was never told who is asking.
//
// # The method is two accounts, so two accounts is what this drives
//
// An owner holding every permission any entry asks for, and a narrowed account holding only
// `workspace.read`. The difference between the two menus must be exactly the entries whose
// requirement the narrow account lacks — not "smaller", which a bug also produces.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  AGENT_COMMANDS, MENU_GROUPS, menuFor, groupMenu, hiddenNote,
} from '../../../apps/shared/coden/agent-commands.js';
import { runFullScreen } from '../../../tools/tui-fullscreen.mjs';

/** The four groups the criterion names, by id. The TITLE of `applications` renders as
 *  "DESTINATIONS", which is a rendering choice and not a fifth group — asserted on the id, so
 *  a wording change does not read as a structural one. */
const NAMED_GROUPS = Object.freeze(['work', 'applications', 'configure', 'session']);

const OWNER = Object.freeze({
  role: 'owner',
  permissions: [...new Set(AGENT_COMMANDS.map((entry) => entry.permission).filter(Boolean))],
});
/** Narrowed on purpose to the one permission every account that can authenticate holds. */
const READER = Object.freeze({ role: 'member', permissions: ['workspace.read'] });

describe('CE-036 — one menu, four groups, filtered by permission and declared', () => {
  test('the product declares exactly the four groups the criterion names, in that order', () => {
    assert.deepEqual(MENU_GROUPS.map((group) => group.id), NAMED_GROUPS);
    for (const group of MENU_GROUPS) {
      assert.ok(String(group.title ?? '').trim(), `group \`${group.id}\` has no title to paint`);
    }
  });

  test('every offered entry lands in one of the four — no orphan, no fifth group', () => {
    const entries = menuFor(OWNER).entries;
    const grouped = groupMenu(entries);
    const placed = grouped.flatMap((group) => group.entries);
    assert.equal(placed.length, entries.length,
      'an entry belongs to no group, so `/` would offer the product with a piece missing');
    for (const group of grouped) {
      assert.ok(NAMED_GROUPS.includes(group.id), `\`${group.id}\` is a fifth group`);
    }
  });

  test('two accounts, two menus — and the difference is exactly what the narrow one may not use', () => {
    const wide = menuFor(OWNER);
    const narrow = menuFor(READER);

    const wideNames = new Set(wide.entries.map((entry) => entry.name));
    const narrowNames = new Set(narrow.entries.map((entry) => entry.name));
    const withheld = [...wideNames].filter((name) => !narrowNames.has(name));

    assert.ok(withheld.length, 'the two accounts got the same menu — then the filter is not filtering');
    // Not merely "shorter": every withheld entry must be withheld FOR A REASON the entry itself
    // states. A menu that is short for any other reason is a bug wearing the shape of a policy.
    for (const name of withheld) {
      const entry = AGENT_COMMANDS.find((candidate) => candidate.name === name);
      assert.ok(entry, `\`${name}\` was withheld and is not in the registry at all`);
      const requirement = entry.kind === 'call' ? entry.permission : null;
      assert.ok(requirement === null || !READER.permissions.includes(requirement),
        `\`/${name}\` was withheld from an account that holds what it asks for (${requirement})`);
    }
    // And nothing appears for the narrow account that the owner does not have: a filter that
    // ADDS is as wrong as one that hides, and only checking one direction would miss it.
    for (const name of narrowNames) {
      assert.ok(wideNames.has(name), `\`/${name}\` is offered to the reader and not to the owner`);
    }
    assert.equal(narrow.hidden, wide.entries.length - narrow.entries.length);
  });

  test('the menu SAYS it is filtered, and says what the missing entries would need', () => {
    const narrow = menuFor(READER);
    const note = hiddenNote(narrow);
    assert.match(note, /^\d+ /, 'the count is lost — "some entries are hidden" is not a statement');
    assert.match(note, /hidden — they need/);
    // The requirement is named as the server matches it. A localised or prettified permission
    // names a permission that does not exist.
    assert.ok(/workspace\.write/.test(note), `the requirement must be named verbatim: ${note}`);
  });

  test('a filtered-and-complete menu and an UNFILTERED one say different things', () => {
    const complete = hiddenNote({ accessFiltered: true, hidden: 0, hiddenBy: {} });
    const unknown = hiddenNote(null);
    assert.match(complete, /Filtered for this account/);
    assert.match(unknown, /does not know what this account may use/,
      'a shell that was never told who is asking must not imply the list is everything');
    assert.notEqual(complete, unknown);
  });

  // ── the clause this criterion has that the product deliberately does not ──────────────────
  //
  // `CE-036` names four groups, and `16` §4b.4 DRAWS them as headings inside the `/` box. The
  // product paints one flat ranked list instead — not by drift, but by `D-0437` (2026-08-14),
  // an Owner instruction given directly from the live page: the two-level group navigation read
  // as "menu sotto menu", and the ask was for a flat list, "stile come ha code claude". Keeping
  // the grouped menu and merely relabelling it was considered and rejected there.
  //
  // So the criterion's PRESENTATION clause is superseded, and the two tests below measure that
  // rather than leaving it to prose: the `/` menu is flat, and the four groups survive where
  // `D-0437` says it kept them — `/help`'s grouped output. A supersession nothing measures is
  // indistinguishable from a regression, which is how this row would have rotted either way.
  test('`/` paints one FLAT ranked list — the grouping clause is superseded by D-0437, and measured', async () => {
    const frames = [];
    const out = new EventEmitter();
    out.columns = 200; out.rows = 60; out.isTTY = false;
    out.write = (chunk) => { frames.push(String(chunk).replace(/\[[0-9;?]*[a-zA-Z]/g, '')); return true; };
    out.off = out.removeListener.bind(out);
    const input = new EventEmitter();
    input.isTTY = false; input.isRaw = false;
    input.off = input.removeListener.bind(input);

    const finished = runFullScreen({
      session: { call: async () => ({}) }, status: {}, account: READER, out, input,
    });
    const settle = () => new Promise((done) => { setTimeout(done, 20); });
    await settle();
    frames.length = 0;
    input.emit('keypress', '/', { name: '/' });
    await settle();
    const screen = frames.join('\n').replace(/\s+/g, ' ');

    for (const group of MENU_GROUPS) {
      assert.ok(!screen.includes(group.title),
        `\`/\` painted the group heading "${group.title}": the menu went back to the two-level `
        + 'form D-0437 removed on the Owner\'s instruction, and CE-036\'s verdict says it is flat');
    }
    // Flat, and still the WHOLE product: entries and the declaration are both on screen.
    // Entries are painted — asserted by COUNT, not by naming one. This named `/logout`, which
    // sat in the visible window while the menu was allowed half the screen and fell out of it
    // when the budget became ten rows (Owner, 2026-08-31). WHICH entry is on screen at a given
    // terminal height was never the claim; pinning one made this line measure the row budget by
    // accident, and fail for a menu that was working.
    const painted = screen.match(/\/[a-z][a-z-]{2,}/g) ?? [];
    assert.ok(painted.length >= 5,
      `the flat menu did not paint its entries: ${screen.slice(-300)}`);
    // The whole product is still DECLARED when the window shows part of it. Same rule as the
    // permission note below, applied to the other way a list can shorten itself: nineteen
    // entries in ten rows is legitimate, nineteen entries silently shown as eight is not.
    assert.match(screen, /1-\d+ of \d+/,
      'the menu windowed its entries without saying how many there are');
    assert.match(screen, /hidden — they need/,
      'the running shell painted a filtered menu without declaring that it was filtered');

    input.emit('keypress', null, { name: 'c', ctrl: true });
    await finished.catch(() => {});
  });

  test('the four groups survive where D-0437 kept them — `/help`\'s grouped output', () => {
    const entries = menuFor(READER).entries;
    const grouped = groupMenu(entries);
    assert.ok(grouped.length >= 2, 'the grouping D-0437 kept for /help is gone from the data as well');
    // `planTurn`'s `/help` branch renders `groups(commands)` — the titles reach a screen there,
    // and only there. This is the half of the criterion that is met AS WRITTEN.
    const titles = grouped.map((group) => group.title);
    for (const title of titles) assert.ok(String(title).trim(), 'a group with no title cannot be a heading');
  });

});

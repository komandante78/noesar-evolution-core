// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The coding agent's terminal surface — the shape Codex and Claude Code have: a transcript
// you scroll, a prompt you type into, and slash commands that act on the session.
//
// This file drew a panel dashboard first — two framed regions, a bench, a navigator — from
// reading `07_INTERFACCIA.md` §4 as if it described this shell. It does not: §4 is the
// WORKBENCH, which is the browser's page. The terminal is an agent, and an agent is a prompt
// with a conversation above it. The rewrite is that correction.
//
// EVERYTHING IN THIS FILE IS PURE. It takes a state object and returns strings. No socket, no
// `process.stdout`, no timers, no TTY. Deliberate, not stylistic: a renderer that reaches
// for the terminal can only be checked by looking at one, and "looks right on my terminal" is
// exactly the class of claim this project refuses. The impure half — raw mode, resize, the
// alternate screen buffer, the keypress loop — is tui-fullscreen.mjs.
//
// Zero dependencies, matching this project's policy: ANSI escapes and box characters, not a
// widget library.

// --- ANSI ---------------------------------------------------------------------------------
//
// The alternate screen buffer is what makes this a full-screen surface rather than output
// that scrolls the user's scrollback away: on exit the terminal restores whatever was there
// before, so running the TUI never costs someone their session history.
const ESC = '[';
export const SCREEN = Object.freeze({
  enter: `${ESC}?1049h${ESC}?25l`,
  leave: `${ESC}?1049l${ESC}?25h`,
  clear: `${ESC}2J${ESC}H`,
  home: `${ESC}H`,
  // The half of `enter` that matters to a shell with no alternate screen buffer to enter:
  // this renderer draws its own caret as part of the frame (the prompt box's `›`), so the
  // terminal's OWN cursor is never where a reader should look. `tui-fullscreen.mjs` hides it
  // once via `enter` before its draw loop starts; a consumer that never sends `enter` — the
  // browser shell, which mounts xterm.js directly rather than opening a real TTY — never
  // hides it at all, and it parks wherever the last `write()` left it: the end of the last
  // row, which `renderFrame` always right-pads to the full width. That is the bottom-right
  // corner of the box, not a stray artifact — every frame ends there.
  hideCursor: `${ESC}?25l`,
});

// `07_INTERFACCIA.md` §1 fixes the palette by extraction, not invention, and §6 fixes the
// rule that matters more than any colour: "Il colore non è MAI l'unico segnale: ogni stato ha
// un glifo e una parola." So every semantic below ships a glyph and a word alongside its
// colour, and a monochrome terminal — or a colour-blind reader — loses nothing but the hue.
const C = Object.freeze({
  reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`,
  accent: `${ESC}38;5;111m`,  // indigo #3958c3
  good: `${ESC}38;5;71m`,     // green  #44a259
  warn: `${ESC}38;5;179m`,    // amber  #c5882c
  error: `${ESC}38;5;167m`,   // red
  sandbox: `${ESC}38;5;97m`,  // violet #7c56b7
  info: `${ESC}38;5;74m`,     // cyan   #34aace
});

/** §6's table, verbatim — colour, glyph AND word, so no state is signalled by hue alone. */
export const STATES = Object.freeze({
  safe: { glyph: '✓', word: 'safe', colour: C.good },
  running: { glyph: '◐', word: 'running', colour: C.info },
  authority: { glyph: '⚑', word: 'authority', colour: C.warn },
  error: { glyph: '✕', word: 'error', colour: C.error },
  destructive: { glyph: '⚠', word: 'destructive', colour: C.error },
  readonly: { glyph: '○', word: 'read-only', colour: C.dim },
  sandbox: { glyph: '◈', word: 'sandbox', colour: C.sandbox },
});

// --- width-aware text ---------------------------------------------------------------------
//
// Every measurement below is of VISIBLE columns, never of `String#length`: a coloured cell
// carries escape bytes that occupy no columns, and measuring them is how a framed layout
// ends up with its right-hand border marching off the edge one row at a time. The frame is
// drawn from these two helpers alone for that reason.
//
// The pattern matches ANY CSI sequence, not only the colour ones (`…m`) these rows are built
// from. Colour-only was correct for every string this file produces and wrong for anything
// else reaching the same helper: a cursor sequence measured as visible columns, silently
// reporting a width too LARGE rather than failing. Found by the CE-020 probe measuring a
// frame as actually written, whose leading `ESC [ H` is not a colour.
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function visibleWidth(text) {
  return String(text).replace(ANSI_PATTERN, '').length;
}

/** Truncates to `width` visible columns, preserving colour codes and closing with a reset so
 *  a cut inside a coloured run cannot leak its colour into the rest of the row. */
export function clipToWidth(text, width) {
  if (width <= 0) return '';
  const source = String(text);
  if (visibleWidth(source) <= width) return source;
  let visible = 0, out = '', index = 0;
  while (index < source.length && visible < width) {
    const escape = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(source.slice(index));
    if (escape) { out += escape[0]; index += escape[0].length; continue; }
    out += source[index]; index += 1; visible += 1;
  }
  return `${out}${C.reset}`;
}

export function padToWidth(text, width) {
  const clipped = clipToWidth(text, width);
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}

// --- wrapping and rules -------------------------------------------------------------------

const rule = (width, left, right, fill = '─') => `${left}${fill.repeat(Math.max(0, width))}${right}`;

/** Wraps prose to a column, on word boundaries where it can and mid-word where a single word
 *  is longer than the column — a panel whose text silently vanished past the right edge would
 *  be indistinguishable from a panel with nothing in it, which is the failure this whole
 *  product treats as worse than an error. */
export function wrapLines(lines, width) {
  if (width <= 0) return [];
  const out = [];
  for (const line of lines) {
    const source = String(line ?? '');
    if (!source) { out.push(''); continue; }
    let remainder = source;
    while (visibleWidth(remainder) > width) {
      // Both indices below are into the RAW string, escapes included. The first revision
      // found the break position in the ESCAPE-STRIPPED text and then sliced the raw text at
      // it — two different strings, so every wrapped row was cut through the middle of a
      // colour code and the terminal printed the fragments (`[0` / `m[2mremote`). Caught by
      // rendering a frame and looking at it, not by any assertion that was passing.
      const end = rawIndexAtWidth(remainder, width);
      const space = remainder.lastIndexOf(' ', end - 1);
      // A space can never fall inside an escape (they are `ESC [ 0-9; * m`), so cutting at
      // one is always safe; cutting at `end` is safe because it only ever lands on an escape
      // boundary. Mid-word only when honouring the word would waste over half the column.
      const take = space > 0 && visibleWidth(remainder.slice(0, space)) > width / 2 ? space : end;
      out.push(remainder.slice(0, take));
      remainder = remainder.slice(take).replace(/^\s+/, '');
    }
    out.push(remainder);
  }
  return out;
}

/** The raw offset at which `width` visible columns have been consumed — the escape-aware
 *  counterpart of a plain `slice(0, width)`, and the only safe place to cut a painted string. */
export function rawIndexAtWidth(source, width) {
  let visible = 0, index = 0;
  while (index < source.length && visible < width) {
    const escape = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(source.slice(index));
    if (escape) { index += escape[0].length; continue; }
    index += 1; visible += 1;
  }
  return index;
}

// --- the agent shell ------------------------------------------------------------------------
//
// The shape of a coding agent, not of a dashboard. A first version of this file drew the
// panel workbench of `07_INTERFACCIA.md` §4 — two framed regions, a navigator, a bench — and
// that was the wrong read of what this shell is for. §4 describes the WORKBENCH; the terminal
// shell is a coding agent, the way Codex and Claude Code are: a transcript you scroll, a
// prompt you type into, and slash commands that act on the session.
//
// So the frame is:
//
//   transcript          what has happened, scrolling, newest at the bottom
//   ╭──────────╮
//   │ > prompt │        one box, always in the same place
//   ╰──────────╯
//   /command menu       ONLY while the prompt begins with `/`
//   status footer       one dim line: branch · mode · context · coverage
//
// The `/` menu belongs to the PROMPT. It is not the address box (`coden-address-book.mjs`),
// which is navigation and lives in the browser's top bar. Two different gestures; keeping
// them apart is the point.

const GLYPH = Object.freeze({
  user: '›',
  agent: '⏺',
  tool: '⎿',
  error: '✕',
  note: '·',
});

/** One transcript entry, wrapped to the width and painted by kind. Tool lines are indented
 *  under the turn they belong to, the way a reader expects a sub-step to sit. */
export function transcriptRows(entries, width) {
  const rows = [];
  for (const entry of entries ?? []) {
    const kind = entry.kind ?? 'agent';
    const colour = { user: C.accent, agent: C.reset, tool: C.dim, error: C.error, note: C.dim }[kind] ?? C.reset;
    const glyph = GLYPH[kind] ?? GLYPH.agent;
    const indent = kind === 'tool' ? '  ' : '';
    const head = `${indent}${colour}${glyph} ${entry.text ?? ''}${C.reset}`;
    for (const row of wrapLines([head], width)) rows.push(row);
    for (const line of entry.detail ?? []) {
      for (const row of wrapLines([`${indent}  ${C.dim}${line}${C.reset}`], width)) rows.push(row);
    }
    if (kind !== 'tool') rows.push('');
  }
  return rows;
}

/** The prompt box. Bordered, always the same height, with the caret where the cursor is —
 *  a prompt that moves or resizes as you type makes the eye chase it. */
export function promptRows(prompt, width) {
  const inner = width - 4;
  const typed = String(prompt ?? '');
  // The tail is shown when the line is longer than the box, so the caret stays visible: a
  // prompt that scrolls its own beginning off is normal; one that hides where you are typing
  // is not.
  //
  // THREE columns are reserved, not two: `>`, the space after it, and the caret. Reserving
  // two made the text fit and then let padToWidth clip the caret off the right-hand edge — so
  // the single case this code exists for was the one it silently failed at, for any prompt
  // longer than the box.
  const room = inner - 3;
  const shown = visibleWidth(typed) > room ? typed.slice(typed.length - room) : typed;
  const lead = typed.startsWith('/') ? C.accent : C.dim;
  return [
    `${C.dim}${rule(width - 2, '╭', '╮')}${C.reset}`,
    `${C.dim}│${C.reset} ${padToWidth(`${lead}>${C.reset} ${shown}${C.accent}▍${C.reset}`, inner)} ${C.dim}│${C.reset}`,
    `${C.dim}${rule(width - 2, '╰', '╯')}${C.reset}`,
  ];
}

/** The one menu of the product, under the prompt — `16` §4b.4. Four groups (work,
 *  applications, configure, session) with a dim heading each, because a flat list of
 *  twenty-nine entries is a list nobody reads. Selection carries a glyph as well as colour
 *  (§6: colour is never the only signal).
 *
 *  `menu.groups` is the grouping function the shell passes through from the shared registry;
 *  without it the rows are flat. The heading rows count against `rowLimit` like any other, so
 *  the menu cannot grow past the height the caller allowed it — a menu that overruns pushes
 *  the prompt off the bottom of the terminal, which is the one row that must never move.
 *
 *  When the list was filtered by permission it SAYS so on a final row (`CE-036`): a shorter
 *  menu that does not explain why it is shorter is indistinguishable from a broken one. */
export function commandMenuRows(menu, width) {
  const rows = [];
  const hits = menu.hits ?? [];
  const limit = Math.max(1, menu.rowLimit ?? 8);

  // LEVEL ZERO — the product as groups you can enter. Point 3 of the owner's list.
  //
  // This branch is why the budget arithmetic below stopped being the load-bearing part of the
  // menu: a bare `/` is now one row per group, which fits at any terminal height that can hold
  // a prompt at all, and the sharing only has to work for ONE group at a time. The rows the
  // arrow keys move through are the groups, so `menu.selected` indexes `menu.groups` here and
  // `menu.hits` below — same variable, and the shell derives both lists from `menuFrame`, so
  // they cannot disagree about which list is on screen.
  // `groupRows`, not `groups`: the branch below already uses `menu.groups` for the grouping
  // FUNCTION the shell passes through, and one field holding a function in one state and an
  // array in another is how a renderer starts calling an array.
  if (menu.level === 'groups') {
    const groups = menu.groupRows ?? [];
    if (!groups.length) return [`  ${C.dim}nothing to show${C.reset}`];
    const noteRow = menu.note ? 1 : 0;
    for (const [index, group] of groups.entries()) {
      if (rows.length >= Math.max(1, limit - noteRow)) break;
      const selected = index === menu.selected;
      const marker = selected ? `${C.accent}▸${C.reset}` : ' ';
      const left = `${marker} ${selected ? C.accent : C.reset}${group.key}${C.reset}  ${group.title}`;
      const count = `${group.count} ${group.count === 1 ? 'entry' : 'entries'}`;
      // The hint is dropped before the count is, and the count before the title: at a narrow
      // width the row must still say WHICH group it is and what key opens it, because those
      // two are the only parts you cannot work out from anything else on the screen.
      const tail = group.hint ? `${count}   ${group.hint}` : count;
      const gap = width - visibleWidth(left) - visibleWidth(tail) - 3;
      rows.push(gap > 1
        ? `  ${left}${' '.repeat(gap)}${C.dim}${tail}${C.reset}`
        : `  ${left}   ${C.dim}${count}${C.reset}`);
    }
    if (menu.note && rows.length < limit) rows.push(`  ${C.dim}${menu.note}${C.reset}`);
    // The key legend comes from `promptKeys` in the shared model, not from a string typed here.
    // The browser renders the SAME list into the hint line under its prompt; a legend that
    // promises `⏎ enter` in one shell and means something else in the other is worse than none.
    if (menu.keys?.length) rows.push(`  ${C.dim}${menu.keys.join('   ')}${C.reset}`);
    return rows.slice(0, Math.max(1, limit));
  }

  if (!hits.length) return [`  ${C.dim}no command matches that${C.reset}`];

  const paint = (command, index) => {
    const selected = index === menu.selected;
    const marker = selected ? `${C.accent}▸${C.reset}` : ' ';
    const name = `${selected ? C.accent : C.reset}/${command.name}${C.reset}`;
    const argument = command.argument ? ` ${C.dim}${command.argument}${C.reset}` : '';
    const left = `${marker} ${name}${argument}`;
    const gap = width - visibleWidth(left) - visibleWidth(command.summary) - 3;
    return gap > 1
      ? `  ${left}${' '.repeat(gap)}${C.dim}${command.summary}${C.reset}`
      : `  ${left}`;
  };

  // The index a row carries is its position in the FLAT hit list, which is what the arrow
  // keys move through. Rebuilding it per group would make the highlight land on a different
  // entry than the one Tab completes, for every group after the first.
  if (typeof menu.groups === 'function') {
    const groups = menu.groups(hits);
    // Reserved against the row that is actually going to be printed. This read
    // `menu.accessFiltered` while the note itself now comes from `menu.note`, so a caller that
    // filtered and supplied no note reserved a row nothing used — a row lost from the menu for
    // a sentence that was never printed.
    const noteRow = menu.note ? 1 : 0;

    // THE BUDGET IS SHARED ACROSS THE GROUPS, not spent first-come.
    //
    // Found by driving the shell, not by reading it. On a 30-row terminal the budget is ten
    // rows, and filling them in order meant WORK's fourteen entries took every one:
    // APPLICATIONS, CONFIGURE and SESSION never rendered at all. `16` §4b.4 calls this "una
    // casella, tutto il prodotto" — a menu where three quarters of the product is invisible
    // unless you already know what to type is not that. Every group gets a share now, and a
    // group showing fewer than it holds SAYS so in its own heading instead of just stopping.
    // …but an EQUAL share is not a shared budget, and that is the defect phase 3c found.
    //
    // `floor((limit - headings - note) / groups)` is 1 at any ordinary terminal height: twelve
    // rows, four groups and a note leave seven for entries, and a quarter of seven is one. So
    // the menu showed exactly one entry per group — "WORK 1 of 15" — and `/approve`, the third
    // thing this shell is FOR, was not on it. 3a's own fix, over-corrected: it made every group
    // reachable and left the menu useless, and the tests written for it asserted only that each
    // group APPEARS and that the rows fit. Both stayed true. `CE-020` failed from 3a onward and
    // nobody saw it, because it is not part of `npm test`.
    //
    // Two passes. One entry each first, so every group is still reachable — that property is
    // 3a's and it stands. Then the rest round-robin, which returns what a short group cannot
    // use (SESSION holds one entry; CONFIGURE three) to the groups that can, instead of
    // leaving those rows unspent beside a WORK group showing one of fifteen.
    const budget = Math.max(groups.length, limit - noteRow);
    const want = groups.map((group) => group.entries.length);
    const shares = groups.map(() => 0);
    let free = budget - groups.length; // one heading row per group, always
    for (let index = 0; index < groups.length && free > 0; index += 1) {
      if (want[index] > 0) { shares[index] = 1; free -= 1; }
    }
    for (let spent = true; free > 0 && spent;) {
      spent = false;
      for (let index = 0; index < groups.length && free > 0; index += 1) {
        if (shares[index] < want[index]) { shares[index] += 1; free -= 1; spent = true; }
      }
    }

    // …AND THE WINDOW FOLLOWS THE SELECTION ACROSS GROUPS, not only inside one.
    //
    // Found by the group count going from four to seven (point 2b gave TOOLS, MODULES and
    // APPROVALS keys of their own). With four groups the budget always reached the last one, so
    // "the selection is always painted" held by arithmetic rather than by construction. With
    // seven it stopped holding: at twelve rows the loop below spent the budget on the first
    // five and broke, and an arrow key that had walked into APPROVALS moved a highlight onto a
    // row that was never drawn. Same defect the entry-level window inside each group already
    // solves — one level up, and it had simply never been reachable before.
    const selectedGroup = groups.findIndex((group) =>
      group.entries.some((command) => hits.indexOf(command) === menu.selected));
    const cost = (index) => 1 + Math.max(1, shares[index]);
    const windowFrom = (room) => {
      if (selectedGroup <= 0) return 0;
      let start = 0;
      let used = 0;
      for (let index = 0; index <= selectedGroup; index += 1) used += cost(index);
      while (used > room && start < selectedGroup) { used -= cost(start); start += 1; }
      return start;
    };
    // Computed twice on purpose. The `⋯ N groups above` marker below is itself a row, so a
    // window sized against the full budget scrolls just far enough to need a marker and then
    // has no room to draw the selected entry under it — measured: `/logout`, the last entry of
    // the last group, moved the highlight onto a row that got cut. The second pass pays for the
    // marker before deciding how far to scroll.
    let from = windowFrom(budget);
    if (from > 0) from = windowFrom(budget - 1);

    // Scrolled-past groups are DECLARED, never silently dropped — the same rule the headings
    // already follow with "WORK  5 of 15". A menu that is shorter than the product and does not
    // say why is indistinguishable from a broken one.
    if (from > 0) rows.push(`  ${C.dim}⋯ ${from} ${from === 1 ? 'group' : 'groups'} above${C.reset}`);

    // Stops at `limit - noteRow`, not at `limit` — the reserved row has to survive to be used.
    //
    // The reservation was subtracted from `budget` and then ignored here, so the entry rows ran
    // to the full height and the note had nowhere left to go. It never showed with four groups
    // because the allocator's `free` was large enough that no group fell back on the
    // `Math.max(1, …)` floor below; with seven it does, seven headings plus seven forced entries
    // overran the budget by two, and the sentence saying WHY the menu is short was the thing
    // that got dropped. Exactly the row you cannot afford to lose.
    const room = Math.max(1, limit - noteRow);
    for (const [position, group] of groups.entries()) {
      if (position < from) continue;
      if (rows.length >= room) break;
      const share = Math.max(1, shares[position]);
      // The window follows the selection. Truncating from the top always would hide the
      // highlighted entry as soon as the arrow keys walked past the share — the same defect
      // the prompt box already solves by keeping the caret in view.
      const chosen = group.entries.findIndex((command) => hits.indexOf(command) === menu.selected);
      const start = chosen >= share ? Math.min(chosen - share + 1, group.entries.length - share) : 0;
      const shown = group.entries.slice(start, start + share);
      rows.push(`  ${C.dim}${shown.length < group.entries.length
        ? `${group.title}  ${shown.length} of ${group.entries.length}`
        : group.title}${C.reset}`);
      for (const command of shown) {
        if (rows.length >= room) break;
        rows.push(paint(command, hits.indexOf(command)));
      }
    }
  } else {
    hits.slice(0, limit).forEach((command, index) => rows.push(paint(command, index)));
  }

  // The note's WORDS come from `hiddenNote` in the shared registry, not from here.
  //
  // Two things were wrong with building the sentence in this file. It was a second wording of
  // the browser's, off the same two fields — and the gate was `accessFiltered`, so the case
  // where the shell was never told who is asking printed NOTHING in the terminal while the
  // browser printed "Not filtered — this shell does not know what this account may use". A
  // shell that silently omits the disclaimer the other shell shows is the divergence rule 3 of
  // the skill is about, and it had been there since 3a.
  if (menu.note && rows.length < limit) {
    rows.push(`  ${C.dim}${menu.note}${C.reset}`);
  }
  return rows;
}

/** One dim line, the way an agent shell carries its state — not twelve labelled fields in a
 *  framed bar. Same FACTS as the workbench's status line, and the same honesty: a field with
 *  no source is absent rather than shown as a plausible zero, and the coverage note says how
 *  many of the twelve had one. */
export function footerText(state) {
  const parts = [];
  if (state.git && state.git !== '—') parts.push(`${C.good}${state.git}${C.reset}`);
  parts.push(state.mode === 'OWNER_BYPASS' ? `${C.warn}owner bypass${C.reset}` : 'normal');
  if (state.model && state.model !== '—') parts.push(state.model);
  // Phase 6 (`D-0312`): a degraded session says so in the status line, in WARN colour, and
  // never scrolls away with the transcript. `atom` — the chain working — is the quiet case and
  // is shown plainly; the point of the field is that its absence cannot be mistaken for health.
  if (state.reasoning && state.reasoning !== '—') {
    parts.push(String(state.reasoning).startsWith('reference')
      ? `${C.warn}${state.reasoning}${C.reset}`
      : state.reasoning);
  }
  if (state.context && state.context !== '—') parts.push(`ctx ${state.context}`);
  if (state.tests) parts.push(state.tests);
  parts.push(`${STATES.safe.glyph} ${state.network ?? 'local-only'}`);
  if (state.sourcedNote) parts.push(state.sourcedNote);
  return `${C.dim}${parts.join(' · ')}${C.reset}`;
}

/**
 * Renders one frame of the agent shell.
 *
 * The transcript takes whatever the prompt, the menu and the footer leave, and is shown from
 * the BOTTOM — the newest turn is the one you are reading, so it is the one that must never
 * be the part that scrolls away.
 */
export function renderFrame({ width, height, state }) {
  const w = Math.max(40, width | 0);
  const h = Math.max(10, height | 0);
  const rows = [];

  const prompt = promptRows(state.prompt ?? '', w);
  // Half the screen, not a third — phase 3c. The menu is drawn ONLY while the prompt begins
  // with `/`, so what it costs is what it costs at the moment you are choosing, and nothing at
  // any other time. A third of thirty rows is ten, which after four headings and the filtered
  // note leaves one entry per group: the whole product, one item at a time. The transcript is
  // still anchored above the prompt and the prompt still cannot be pushed off the bottom —
  // `commandMenuRows` never returns more rows than it was given.
  const menu = state.menu ? commandMenuRows({ ...state.menu, rowLimit: Math.max(1, Math.floor(h / 2)) }, w) : [];
  const footer = wrapLines([footerText(state)], w - 2);
  const chromeHeight = prompt.length + menu.length + footer.length + 1;
  const transcriptHeight = Math.max(1, h - chromeHeight);

  // Anchored to the BOTTOM: the newest turn sits just above the prompt, and a short
  // transcript pads at the TOP. Padding at the bottom instead — which the first version did —
  // strands the conversation against the ceiling with a gap between it and the box you type
  // into, so the thing you just said ends up furthest from the caret.
  const all = transcriptRows(state.transcript, w - 2);
  const visible = all.slice(Math.max(0, all.length - transcriptHeight));
  const topPad = Math.max(0, transcriptHeight - visible.length);
  for (let index = 0; index < transcriptHeight; index += 1) {
    rows.push(padToWidth(` ${index < topPad ? '' : visible[index - topPad] ?? ''}`, w));
  }

  rows.push('');
  for (const row of prompt) rows.push(row);
  for (const row of menu) rows.push(row);
  for (const row of footer) rows.push(padToWidth(` ${row}`, w));

  return rows.slice(0, h).map((row) => clipToWidth(row, w));
}

export const CHROME = Object.freeze({ glyphs: GLYPH });

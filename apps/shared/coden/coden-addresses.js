// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The CodeN Evolution address space, DECLARED — the 25 workbench and agent panels, the two
// regions the terminal and the browser both address.
//
// # Why this file exists (`D-0405`, slice 1)
//
// Until 2026-08-13 this list was not written down anywhere. It was *derived*, by regex, from
// `apps/webui-static/index.html` — the markup's own `data-bench-panel` / `data-agent-panel`
// attributes were the only declaration, and `coden-address-book.mjs` read them back. That was
// the right call at the time: one fact, one copy, and the browser owned it because the browser
// was the only thing that rendered it.
//
// It stops being the right call the moment the browser stops rendering it. `D-0404` collapses
// CodeN into one surface — the TUI, rendered in a terminal emulator — and slice 4 deletes those
// 25 sections from the markup. Deleting them while the address book still scraped them would
// have emptied the terminal's own address book: the shell that SURVIVES the removal would have
// lost its address space to the removal of the shell that did not. That is trap 1 of the design
// (`docs/CODEN_EVOLUTION_TERMINAL_DESIGN.md` §2), and this file is what closes it.
//
// # This is not a second copy — it is the copy, and the markup is now checked against it
//
// The rule `D-0300` set after `PANEL_NAMES` drifted to fourteen entries against a markup of
// twenty-five is untouched: a list that is only ever compared to itself always agrees. So the
// direction of the check is inverted rather than dropped. While the markup still carries the
// panels, `coden-address-declaration.test.mjs` asserts that what THIS file declares is exactly
// what `parseCodenAddressBook()` finds in `index.html` — every panel, in order, with the same
// label and the same `declaredEmpty` text. Either side moving without the other is a failure.
//
// That test is deliberately mortal: it dies with the markup in slice 4, and its death is the
// point at which this file becomes the sole declaration. Nothing else changes on that day,
// which is the whole reason the move happens first.
//
// # Generated once, from the markup, on purpose
//
// The contents below were produced by running `parseCodenAddressBook()` over the markup and
// printing the result — not typed. Seventeen `declaredEmpty` strings is precisely where a
// hand-transcription error hides, and a typo here would be a sentence the product says to a
// user, in a place no reviewer re-reads.
//
// `declaredEmpty` carries the panel's own `<p class="declared-empty">` paragraphs and only
// those: the product's marker for "this text is a statement about the product", as opposed to
// a placeholder standing in for data that has not loaded yet. A shell that printed the second
// kind would be reporting an empty list it never asked for.
//
// Order is the markup's document order, bench region before agent region, because the address
// book ships it as a menu and a menu that reorders itself between releases is a different menu.

/** @typedef {{ region:'bench'|'agent', panel:string, label:string, declaredEmpty:string[] }} CodenPanel */

/** @type {CodenPanel[]} */
export const CODEN_PANELS = [
  {
    region: "bench",
    panel: "shadow",
    label: "Shadow run",
    declaredEmpty: [
      "No plan exists in this session yet. Create one in the Plan panel — a result is shown here after it has already run on a copy-on-write copy of the workspace: the diff and the time are facts before anyone is asked to approve them, which is why Approve promotes rather than merely allows.",
    ],
  },
  {
    region: "bench",
    panel: "editor",
    label: "Editor",
    declaredEmpty: [
      "Nothing is open. The editor shows the files a plan proposes or promotes — a view, never a second write path: every change to the real workspace still goes through Plan → Approve, so a raw edit box here would bypass the capability and shadow chain the rest of this page enforces.",
    ],
  },
  {
    region: "bench",
    panel: "diff",
    label: "Diff",
    declaredEmpty: [
      "No change to compare yet. A diff here is computed against the shadow copy after Approve runs it, never against the text of a reply — a reply describing a change is not the change.",
    ],
  },
  {
    region: "bench",
    panel: "tests",
    label: "Tests",
    declaredEmpty: [
      "No run, and this stays true on purpose: the executor is passed an empty test list on this path, so nothing here has ever run a plan-declared command. Reopening that would be arbitrary code execution wearing the shape of this page.",
    ],
  },
  {
    region: "bench",
    panel: "logs",
    label: "Logs",
    declaredEmpty: [
      "The product's own logs live in Settings → Health and logs. This panel is for the causal event trail of this piece of work, which needs a run to have any.",
    ],
  },
  {
    region: "bench",
    panel: "terminal",
    label: "Terminal",
    declaredEmpty: [
      "The terminal is a region of its own below the bench, not a tab that disappears when you look at something else ( UI-033 ). This tab moves focus to it.",
    ],
  },
  {
    region: "bench",
    panel: "preview",
    label: "Preview",
    declaredEmpty: [
      "Nothing to preview. A preview renders an artefact the work produced.",
    ],
  },
  {
    region: "bench",
    panel: "map",
    label: "Map",
    declaredEmpty: [
      "No repository has been scanned in this session yet.",
    ],
  },
  {
    region: "bench",
    panel: "documentation",
    label: "Documentation",
    declaredEmpty: [
      "No documentation is attached to this piece of work.",
    ],
  },
  {
    region: "bench",
    panel: "problems",
    label: "Problems",
    declaredEmpty: [
      "No problems reported for this piece of work. This is not \"no problems exist\": nothing has run.",
    ],
  },
  {
    region: "bench",
    panel: "closure",
    label: "Closure — stage 16",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "projects",
    label: "Projects",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "recent",
    label: "Recent",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "sessions",
    label: "Sessions",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "tasks",
    label: "Tasks",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "agents",
    label: "Agents",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "tools",
    label: "Tools",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "plugins",
    label: "Plugins",
    declaredEmpty: [
      "None installed, and none can be: a plugin is a tool with a surface of its own, and this build has no registry to put one in.",
    ],
  },
  {
    region: "bench",
    panel: "history",
    label: "History",
    declaredEmpty: [],
  },
  {
    region: "bench",
    panel: "favourites",
    label: "Favourites",
    declaredEmpty: [
      "Nothing is pinned, and nothing can be: this build has no way to pin anything, so this panel is empty by construction rather than because you have not used it.",
    ],
  },
  {
    region: "agent",
    panel: "conversation",
    label: "Conversation",
    declaredEmpty: [],
  },
  {
    region: "agent",
    panel: "plan",
    label: "Plan",
    declaredEmpty: [],
  },
  {
    region: "agent",
    panel: "activity",
    label: "Agent activity",
    declaredEmpty: [
      "No hypothesis. Evidence is what was recalculated, not what was asserted.",
      "None. This layer has no execution surface, so it reads and writes nothing.",
      "None, for the same reason.",
      "None. A sub-agent needs its own authority and an independent reviewer; neither exists in this build.",
      "Stated at closure, not guessed at during the work.",
    ],
  },
  {
    region: "agent",
    panel: "authority",
    label: "Authority requests",
    declaredEmpty: [],
  },
  {
    region: "agent",
    panel: "invariants",
    label: "Non-bypassable invariants",
    declaredEmpty: [],
  },
];

/** The declared panels as address-book entries — the exact shape `parseCodenAddressBook()`
 *  returns for a panel, so the composition in `coden-address-book.mjs` is a concatenation and
 *  not a translation. `kind` is derived rather than stored: it is a rendering of `region`, and
 *  storing both would be two facts that can disagree. */
export function declaredCodenPanels() {
  return CODEN_PANELS.map((entry) => ({
    address: `coden/${entry.region}/${entry.panel}`,
    kind: entry.region === 'bench' ? 'Bench' : 'Agent',
    region: entry.region,
    panel: entry.panel,
    label: entry.label,
    declaredEmpty: [...entry.declaredEmpty],
  }));
}

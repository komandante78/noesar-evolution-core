// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The `i` buttons — Owner, s333 point 3c: «vanno messi i tasti `i` di informazione che
// cliccando danno suggerimenti».
//
// # The rule these texts are written under
//
// They have to be TRUE. An information button is the one place in a product where a person
// arrives having already decided to trust what it says, so a help text that flatters a panel is
// worse than no help text at all — and this product's whole argument is that it does not
// declare things it has not got. So every entry below was written FROM the census
// (`docs/WEBUI_PAGE_CENSUS_S333.md`), and where a page cannot do something, the entry says so
// instead of describing the feature it would have.
//
// Three of them say a page is static and why. That is not an apology: `#/not-found` explains a
// fixed fact and has nothing to fetch, and pretending otherwise in its own help text would be
// the exact failure this file exists to avoid.
//
// # Why it is a table and not text in the markup
//
// Thirty-three headers would be thirty-three places to forget one, and a missing help button is
// invisible — the panel simply looks like every other panel. Keyed by address, injected once,
// and checked: `page-help.test.mjs` fails when a page has no entry and when an entry names a
// page that does not exist. Neither half can rot quietly.
//
// The text is English because English is the source language (point 3d); the entries flow
// through the same catalogue as everything else, so translating them is not a second mechanism.

/**
 * `what` — what this page IS, in one sentence, including what it cannot do.
 * `howto` — what is worth doing here, concretely. Never "click the button to use the feature".
 */
export const PAGE_HELP = Object.freeze({
  home: {
    what: 'The starting point: your projects, recent conversations, the work queue and the health of the services behind them.',
    howto: 'Start from a goal rather than a blank chat — a goal opens a conversation with itself as the opening text. Turning that goal into a Plan is backbone work that does not exist in this build, so what you get here is the question asked, not yet understood.',
  },
  chat: {
    what: 'The conversation, with its context graph: every project keeps its own chats, branches, memory, files and tools.',
    howto: 'Check the context panel before you send — model, project, messages, memory, sources and estimated tokens are all shown first. Branch instead of editing when you want to compare two directions; merging and comparing branches are both here.',
  },
  coden: {
    what: 'The workbench and the session: one program with two shells, this one and the terminal, joined to the SAME live session rather than two clients with separate state.',
    howto: 'Type `/` for the menu; it goes to any address in the product. A command that needs a subject and is given none opens the panel that shows that thing instead of running — `/diff` opens Diff, `/diff <run>` compares a run. Nothing reaches the real workspace except by Plan then Approve.',
  },
  tools: {
    what: 'Registered tools — local HTTP, MCP or OpenAPI. A registered tool stays disabled by policy until it is granted consent, and one that changes things is marked as such.',
    howto: 'Register a tool disabled, look at what it declares, and grant consent separately. Installable catalogues are not here: they live in Settings › Modules, in one place.',
  },
  'coden-tui': {
    what: 'Instructions for reaching the terminal shell. This page is deliberately static: a browser page cannot spawn an operating-system shell, so it names the real program rather than simulating one.',
    howto: 'Run `coden_evolution` — one word. The first time on a machine it asks for an attach code or your credentials; after that it opens with nothing typed. `coden_evolution --forget` undoes that on both sides.',
  },
  projects: {
    what: 'A project is one controlled scope: chats, instructions, files, memory, tools and agents share it.',
    howto: 'Put the rules that must hold for every conversation into the project instructions rather than repeating them. The knowledge mode decides whether retrieval is hybrid, whole-context or off.',
  },
  documents: {
    what: 'Artifacts: documents, code, tables, charts, canvas data and application specifications, each kept with its versions.',
    howto: 'Create the artifact from the conversation that produced it, so the version history and the reasoning stay connected.',
  },
  knowledge: {
    // The last sentence is not description, it is a CLAIM under test. It stood in the page
    // header until the headers were removed on 2026-08-28, and it is here now because this is
    // where that prose went — `coden-addressable-panels.test.mjs` reads it from this file and
    // checks it against `file-extractors.mjs`, so the day the extractor learns to transcribe,
    // the sentence goes red instead of quietly becoming a lie. It is watched at all because an
    // earlier version offered recordings as searchable evidence while the extractor refused to
    // read them. That old wording is not quoted here: the test greps this entry, comments and
    // all, and an example of the forbidden sentence would fail as though it were the claim.
    what: 'Ingested sources, searched lexically and semantically, with the original passages kept rather than only their embeddings. Audio and video are indexed by their metadata, never transcribed: this build has no speech-to-text.',
    howto: 'Upload the original file when you have it: extraction happens locally. Notes here are what YOU write and pin; Memory is what the product writes for you, and they are separate on purpose.',
  },
  memory: {
    what: 'What the product has learned about your work, written at the end of each session.',
    howto: 'Read "Recently learned" first — nothing becomes permanent without you keeping it. Discarding a wrong memory is more valuable than adding a right one.',
  },
  agents: {
    what: 'Agents plan, and a step that would change something waits for a human to approve it with a scope.',
    howto: 'Read the plan before approving, not the summary of it. Intermediate output is visible on purpose: an agent that only shows conclusions cannot be checked.',
  },
  workflows: {
    what: 'Workflows declare what each step may do, with retries, compensation and replay. A step with declared effects waits for a person.',
    howto: 'Declare the effects honestly — the gate is on what a step SAYS it will do, so an under-declared step is the one that gets through without review.',
  },
  models: {
    what: 'The model catalogue. What is running and what is on disk stay at the top and never paginate; everything else is what registered publishers offer.',
    howto: 'Type and function are what the publisher declared, never what the product guessed from a name — `undeclared` means nobody said, not that the model cannot do it. Acquiring is egress, and it is switched off unless the local model runtime is enabled.',
  },
  research: {
    what: 'Research takes one line, the way you would say it, and returns a report with the evidence behind each candidate and what was NOT verified. Reports are kept until you delete them.',
    howto: 'Ask for something you could be shown to be wrong about. Evidence quality is stated per candidate because reviews can be bought and an average score is not evidence. No provider is built in: you configure and consent to one.',
  },
  settings: {
    what: 'One destination holding every setting. This page itself is static — it owns no content, and each section inside it loads its own.',
    howto: 'Use `/` and the section name rather than hunting the list: every section here has its own address and can be linked to directly.',
  },
  'settings/sessions': {
    what: 'Your own sessions: the working list, the archive, and a bin that keeps a session for thirty days.',
    howto: 'Archiving moves, deleting goes to the bin. The keyboard does all of it, and Delete opens the confirmation rather than deleting on its own.',
  },
  'settings/appearance': {
    what: 'Theme, accent colour, text size and motion. Static on purpose: all of it is stored on this device only and never leaves the installation.',
    howto: 'Pick any accent you like — a hue that cannot carry as text is not refused, it stays as the fill and a readable relative is derived. Both contrast figures are shown while you choose, not afterwards.',
  },
  'settings/language': {
    what: 'Time zone and locale. The interface language itself is chosen in the top bar; the locale here decides how dates and numbers are formatted.',
    howto: 'Resolution order is your preference, then the server default, then the host, then UTC. The browser zone is recorded but never applied on its own.',
  },
  'settings/about': {
    what: 'Version, edition, data plane, and the boundary this open core keeps.',
    howto: 'The open core does not require ATOM to build, start, pass its tests or deliver what it documents — this page is where that claim is stated and can be checked against the build you are running.',
  },
  'settings/licence': {
    what: 'The licence posture. Static, and empty on purpose: no code in this build reads or asserts a licence state, so there is nothing here to show.',
    howto: 'Read it as a proposal rather than a determination. Showing an invented licence state would be the kind of false declaration this product exists to remove.',
  },
  'settings/privacy': {
    what: 'Providers and connectors. Local endpoints are the default and external providers stay disabled until you grant an explicit data scope.',
    howto: 'Grant the narrowest scope that works, and use "Revoke all external access" when you are unsure — it is one action and it takes effect immediately.',
  },
  'settings/people': {
    what: 'The account directory. People are invited by token and choose their own password; an administrator never learns it.',
    howto: 'Invite at the lowest role that works. Owner and admin carry mandatory second-factor authentication, enforced both here and as a database constraint.',
  },
  'settings/security': {
    what: 'Your own account: password, recovery codes, authenticator replacement, passkeys and active sessions.',
    howto: 'Everything here needs your password AND a live authenticator code. Replacing an authenticator keeps the old one working until two consecutive codes from the new one confirm it, so a half-finished swap cannot lock you out.',
  },
  'settings/models-hardware': {
    what: 'What the host has, and what the runtime would choose. Discovery is read-only.',
    howto: 'The recommendation explains itself rather than just naming a runtime. The local model runtime is disabled by default, and disabled means nothing here opens a device or spawns a process.',
  },
  'settings/hardware': {
    what: 'The accelerator probe and the runtime recommendation for a given model size and quantisation.',
    howto: 'An empty accelerator list with "not inspected" means the runtime is disabled, which is a different statement from "there is no GPU". The page says which one it is.',
  },
  'settings/storage': {
    what: 'Export, backup and retention. A database archive carries a checksum, and a restore refuses a mismatch.',
    howto: 'Treat a full filesystem backup as a secret: it is not encrypted and it contains the authentication master key. That is stated here rather than left in the documentation.',
  },
  'settings/audit': {
    what: 'One queue holding everything waiting for a human decision, whichever subsystem raised it.',
    howto: 'Approvals are per subsystem in origin but not in review — if it is waiting, it is here, so this is the page to check rather than each feature in turn.',
  },
  'settings/health': {
    what: 'What the watchdog observes and what safe mode is doing about it, next to the log stream.',
    howto: 'Run the check rather than reading the last one when you are diagnosing something now. Leaving safe mode is deliberate and manual.',
  },
  'settings/logs': {
    what: 'Structured logs, redacted at the sink rather than at the reader.',
    howto: 'Quote the correlation ID when reporting a problem: it ties one request to every record it produced. Debug mode raises verbosity for a bounded time and switches itself off.',
  },
  'settings/updates': {
    what: 'Updates are staged, approved, applied, and can be rolled back. Nothing installs itself.',
    howto: 'If nothing can be applied, it is because no update channel key is pinned on this installation — which is stated here rather than hidden behind a button that does nothing.',
  },
  'settings/skills': {
    what: 'A skill tells the agent how to do something. Its payload is instructions, so its cost is context — and nothing here is loaded until a session adopts it.',
    howto: 'Search the catalogue to see what a skill is and what adopting it would cost in bytes. The search never returns the instructions themselves; that is the difference between a catalogue and a load.',
  },
  'settings/modules': {
    what: 'A module is a separate product. An Owner module is built and signed by NOESAR and installs in one click; registration and signing happen on the server.',
    howto: 'Active modules open in a new tab. They are never embedded, so a module cannot draw inside this interface and be mistaken for part of it.',
  },
  'settings/remote-targets': {
    what: 'Scan a codebase on a remote host over SSH. NOESAR fetches it; the module analysing it never sees the credential.',
    howto: 'Capture the host key first and confirm it — no credential is sent at that step. A later mismatch refuses the connection rather than trusting a changed identity silently.',
  },
  'not-found': {
    what: 'The address does not exist. Static, because it explains a fixed fact.',
    howto: 'Check the spelling, or press `/` and go by name — every page in the product has an address and the menu lists all of them.',
  },
  'access-denied': {
    what: 'Your role does not include this area. Static, because it states a fixed fact — and the address is kept as you typed it, so a reload does not turn a refusal into a missing page.',
    howto: 'The message names the role that is required and the one you are signed in as. An administrator can change it in Settings › People and access.',
  },
});

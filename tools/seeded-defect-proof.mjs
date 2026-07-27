// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Prove the guards fire.
//
// A guard added alongside the code it guards has never been seen to fail, and a check
// that cannot fail is decoration. This walks a list of deliberate defects — each one a
// plausible mistake, not a nonsense edit — applies it, runs the suite that should object,
// and requires that EXACTLY ONE test objects. Then it restores the file and proves the
// restoration is byte-identical.
//
// It is a tool, not a test: it mutates the working tree on purpose, so it is run
// deliberately and never as part of `npm test`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEBUI = join(ROOT, 'apps/webui-static');
const SRC = join(ROOT, 'services/reference-control-plane/src');
const TEST = join(ROOT, 'services/reference-control-plane/test');

const STRUCTURE = [join(TEST, 'webui-markup-structure.test.mjs')];
const SESSIONS = [join(TEST, 'session-lifecycle.test.mjs')];
const METRIC = [join(TEST, 'product-metric.test.mjs')];
const HOME = [join(TEST, 'home-overview.test.mjs')];
const SCHEDULE = [join(TEST, 'webui-schedule.test.mjs')];

const SEEDS = [
  {
    name: 'a font size that ignores the text scale (UI-040)',
    file: join(WEBUI, 'styles.css'),
    from: '.bench-status b{color:var(--text-primary);font-weight:600}',
    to: '.bench-status b{color:var(--text-primary);font-weight:600;font-size:12px}',
    suites: STRUCTURE,
  },
  {
    name: 'a physical margin-left comes back (UI-046)',
    file: join(WEBUI, 'styles.css'),
    from: '.bench-status-honesty{margin-inline-start:auto;color:var(--muted)}',
    to: '.bench-status-honesty{margin-left:auto;color:var(--muted)}',
    suites: STRUCTURE,
  },
  {
    name: 'the NOT DONE box loses its explicit declaration (UI-036)',
    file: join(WEBUI, 'index.html'),
    from: 'id="closureNothing"',
    to: 'id="closureNothingElse"',
    suites: STRUCTURE,
  },
  {
    name: 'the terminal becomes a tab panel like any other (UI-033)',
    file: join(WEBUI, 'index.html'),
    from: '<section class="bench-terminal" id="benchTerminal" aria-label="Terminals">',
    to: '<section class="bench-terminal" data-bench-panel="terminal-region" id="benchTerminal" aria-label="Terminals">',
    suites: STRUCTURE,
  },
  {
    name: 'a status field is dropped from the line (UI-035)',
    file: join(WEBUI, 'index.html'),
    from: '<span data-status-field="cost">Cost <b id="statusCost">—</b></span>',
    to: '<span>Cost <b id="statusCost">—</b></span>',
    suites: STRUCTURE,
  },
  {
    name: 'the coverage chip is removed from the top bar (UI-037)',
    file: join(WEBUI, 'index.html'),
    from: '<span class="chip" id="coverageChip"',
    to: '<span class="chip" id="coverageChipRemoved"',
    suites: STRUCTURE,
  },
  {
    name: 'the sessions page loses its declared range (UI-005)',
    file: join(WEBUI, 'index.html'),
    from: '<span id="sessionsRange">—</span>',
    to: '<span>—</span>',
    suites: STRUCTURE,
  },
  {
    name: 'the streaming branch starts announcing every delta (UI-043)',
    file: join(WEBUI, 'app.js'),
    from: '          if(article)article.querySelector(\'.message-body\').textContent=assistantText;',
    to: '          if(article)article.querySelector(\'.message-body\').textContent=assistantText;announceEvent(data.text);',
    suites: STRUCTURE,
  },
  {
    name: 'a binned session stays visible to the rest of the product (UI-012)',
    file: join(SRC, 'ai-workspace/context-graph.mjs'),
    from: 'return this.store.read().conversations.filter((item) => !item.archived && !item.deletedAt && (!projectId || item.projectId === projectId));',
    to: 'return this.store.read().conversations.filter((item) => !item.archived && (!projectId || item.projectId === projectId));',
    suites: SESSIONS,
  },
  {
    name: 'a closure may leave its NOT DONE box silently empty (UI-036)',
    file: join(SRC, 'product-metric.mjs'),
    from: '    if (!items.length && nothingLeftUndone !== true) {',
    to: '    if (false) {',
    suites: METRIC,
  },
  {
    name: 'rejected changes are excluded from the metric (UI-072)',
    file: join(SRC, 'product-metric.mjs'),
    from: '    const inWindow = all.filter((item) => Date.parse(item.decidedAt) >= since);',
    to: '    const inWindow = all.filter((item) => Date.parse(item.decidedAt) >= since && item.decision === \'approve\');',
    suites: METRIC,
  },
  {
    // The exact defect this phase repaired. If the guard ever stops objecting to it, the
    // repair is one careless edit away from being undone in silence.
    name: 'a wall clock is sent to the store without a zone again (UI-062)',
    file: join(WEBUI, 'app.js'),
    from: 'scheduledAt:scheduledInstantFromField($(\'#taskScheduledAt\').value)',
    to: 'scheduledAt:$(\'#taskScheduledAt\').value||null',
    suites: STRUCTURE,
  },
  {
    name: 'the scheduled group disappears from the work queue (UI-062)',
    file: join(WEBUI, 'index.html'),
    from: 'id="taskScheduledList"',
    to: 'id="taskScheduledListing"',
    suites: STRUCTURE,
  },
  {
    name: 'a quick action starts sending the goal by itself (UI-061)',
    file: join(WEBUI, 'app.js'),
    from: 'if(composer){composer.value=action.goal;composer.focus();}',
    to: 'if(composer){composer.value=action.goal;composer.focus();sendChat();}',
    suites: STRUCTURE,
  },
  {
    name: 'a withheld block stops naming the permission it needs (UI-063)',
    file: join(WEBUI, 'app.js'),
    from: 'are not shown to this account. It would need',
    to: 'are unavailable. They would need',
    suites: STRUCTURE,
  },
  {
    name: 'a goal pill drops below the 24px target floor (2.5.8)',
    file: join(WEBUI, 'styles.css'),
    from: '.goal-action{min-height:34px',
    to: '.goal-action{min-height:22px',
    suites: STRUCTURE,
  },
  {
    name: 'a running task is filed as scheduled because it carries a rule (UI-062)',
    file: join(WEBUI, 'schedule.js'),
    from: "  if (status === 'running') return 'active';",
    to: '',
    suites: SCHEDULE,
  },
  {
    name: 'the quick actions quietly become nine (UI-061)',
    file: join(SRC, 'home-overview.mjs'),
    from: "  { id:'review-my-changes',  goal:'Review my changes' },\n",
    to: '',
    suites: HOME,
  },
  {
    name: 'service health detail reaches an account that may not read it (UI-063)',
    file: join(SRC, 'home-overview.mjs'),
    from: '  if (!mayReadDetail) {',
    to: '  if (false) {',
    suites: HOME,
  },
];

function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function failingTests(suites) {
  try {
    execFileSync(process.execPath, ['--test', ...suites], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return [];
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)]
      .map((match) => match[1].trim())
      // A failing subtest also fails its enclosing describe(); counting both would report
      // two objections for one defect.
      .filter((name) => !/^(the missing interface parts|webui markup structure|session lifecycle|the product metric|the closure and its NOT DONE box|the AI workspace state migrates forward|the initial screen · UI-060…UI-063|active and scheduled partition the queue · UI-062|the ten quick actions · UI-061|service health is shown at the rank the role allows · UI-063)$/.test(name));
  }
}

let failures = 0;
console.log('SEEDED DEFECT PROOF');
for (const seed of SEEDS) {
  const original = readFileSync(seed.file, 'utf8');
  const before = digest(seed.file);
  if (!original.includes(seed.from)) {
    console.log(`ERROR  ${seed.name} — the anchor no longer exists, so nothing was seeded`);
    failures += 1;
    continue;
  }
  writeFileSync(seed.file, original.replace(seed.from, seed.to));
  const caught = failingTests(seed.suites);
  writeFileSync(seed.file, original);
  const restored = digest(seed.file) === before;
  const ok = caught.length === 1 && restored;
  if (!ok) failures += 1;
  console.log(`${ok ? 'CAUGHT' : 'MISSED'}  ${seed.name}`);
  console.log(`        ${caught.length} test(s) objected${caught.length ? `: ${caught.join(' | ')}` : ''}`);
  if (!restored) console.log('        RESTORE FAILED — the file is not byte-identical');
}
console.log('');
console.log(`SEEDED_TOTAL=${SEEDS.length}`);
console.log(`SEEDED_CAUGHT=${SEEDS.length - failures}`);
process.exit(failures === 0 ? 0 : 1);

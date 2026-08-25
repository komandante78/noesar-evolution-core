// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The initial screen's payload · UI-060…UI-063.
//
// Two things are being defended here, and neither is cosmetic.
//
// The first is the count. "Six entry actions" and "ten quick actions" are the criteria
// themselves, and a list that lives only in markup is a list nobody notices has become
// nine. Asserting it against the code makes the criterion mechanical.
//
// The second is authority. The initial screen shows service health, and the section that
// shows service health in full is owner-only. A page everybody can reach must not become
// the way around that, so the withholding is tested from the payload's side — the browser
// is never asked to be the one that hides something.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_ACTIONS, buildHomeOverview, describeModels, describeToolOrigin, describeTools,
  entryActions, summariseServices, summariseComponentDetail, HOME_TOOLS_SHOWN,
} from '../src/home-overview.mjs';

const HEALTH = Object.freeze({
  status:'healthy',
  checkedAt:'2026-07-27T12:00:00.000Z',
  safeMode:{ active:false },
  degraded:[],
  components:[
    { name:'data-plane', healthy:true, essential:true, detail:'postgresql connected' },
    { name:'log-volume', healthy:true, essential:false, detail:'1.2 MiB' },
  ],
});

describe('the six entry actions · UI-060', () => {
  test('there are exactly six, and they are the six the criterion names', () => {
    const actions = entryActions({ lastSession:null });
    assert.equal(actions.length, 6);
    assert.deepEqual(actions.map((action) => action.id), [
      'resume', 'open-project', 'new-project', 'clone-repository', 'import-archive', 'connect-remote',
    ]);
  });
  test('the three that cannot act say what they are waiting for', () => {
    const actions = entryActions({ lastSession:null });
    const unwired = actions.filter((action) => !action.wired);
    // Resume is unwired only because there is no session yet, which is a different
    // reason from the three that have no executor — it becomes wired as soon as one
    // exists, and the next test proves it.
    assert.deepEqual(unwired.map((action) => action.id).sort(),
      ['clone-repository', 'connect-remote', 'import-archive', 'resume']);
    for (const action of unwired) {
      assert.ok(action.detail.length > 20, `${action.id} must say why it cannot act`);
      assert.equal(action.target, null);
    }
  });
  test('resume becomes wired, and points at the session, once one exists', () => {
    const actions = entryActions({ lastSession:{ id:'sess-1', title:'Yesterday' } });
    const resume = actions.find((action) => action.id === 'resume');
    assert.equal(resume.wired, true);
    assert.deepEqual(resume.target, { view:'chat', sessionId:'sess-1' });
    assert.match(resume.detail, /Yesterday/);
  });
});

describe('the ten quick actions · UI-061', () => {
  test('there are exactly ten', () => {
    assert.equal(QUICK_ACTIONS.length, 10);
  });
  test('their ids are unique and none is a duplicate goal', () => {
    // Compared against the list's own length, not against ten. Testing uniqueness by way
    // of the count made this test object to a REMOVED entry as well, so one mistake drew
    // two objections and neither test was any longer about one thing. The count has its
    // own test, immediately above, and that is where it belongs.
    assert.equal(new Set(QUICK_ACTIONS.map((action) => action.id)).size, QUICK_ACTIONS.length);
    assert.equal(new Set(QUICK_ACTIONS.map((action) => action.goal)).size, QUICK_ACTIONS.length);
  });
  test('each is phrased as a goal — an imperative, not a function name', () => {
    for (const action of QUICK_ACTIONS) {
      assert.ok(/^[A-Z]/.test(action.goal), `${action.id} should read as a sentence`);
      assert.ok(action.goal.includes(' '), `${action.id} should be a phrase, not a label`);
      assert.ok(!/[(){}]/.test(action.goal), `${action.id} should not look like a call`);
    }
  });
});

describe('service health is shown at the rank the role allows · UI-063', () => {
  test('an owner sees the components', () => {
    const block = summariseServices({ health:HEALTH, mayReadDetail:true });
    assert.equal(block.detailVisible, true);
    assert.equal(block.components.length, 2);
    assert.equal(block.status, 'healthy');
  });
  test('everyone else sees the aggregate and is told the detail exists', () => {
    const block = summariseServices({ health:HEALTH, mayReadDetail:false });
    assert.equal(block.visible, true, 'the aggregate is not a secret');
    assert.equal(block.status, 'healthy');
    assert.equal(block.componentCount, 2, 'how many there are is not the same as what they are');
    assert.deepEqual(block.components, [], 'and none of them is named');
    assert.equal(block.detailRequires, 'role owner');
  });
  test('safe mode reaches the initial screen for every role', () => {
    const block = summariseServices({
      health:{ ...HEALTH, status:'safe-mode', safeMode:{ active:true, since:'2026-07-27T11:00:00.000Z' } },
      mayReadDetail:false,
    });
    assert.equal(block.safeMode.active, true);
    assert.equal(block.status, 'safe-mode');
  });
});

describe('a tool is described by where it comes from · UI-063', () => {
  test('a loopback endpoint is on this machine', () => {
    const origin = describeToolOrigin({ endpoint:'http://127.0.0.1:8099/api', transport:'local-http' });
    assert.equal(origin.reach, 'this-machine');
    assert.equal(origin.host, '127.0.0.1');
  });
  test('an internet endpoint is off it, whatever the record claims about itself', () => {
    const origin = describeToolOrigin({ endpoint:'https://api.example.com/v1', transport:'openapi', external:false });
    assert.equal(origin.reach, 'off-machine');
    assert.equal(origin.declaredExternal, false, 'the claim is reported as made, not corrected silently');
  });
  test('an stdio transport carries an executable, not a URL, and says so', () => {
    const origin = describeToolOrigin({ endpoint:'/usr/local/bin/mcp-server', transport:'mcp-stdio' });
    assert.equal(origin.scheme, 'executable');
    assert.equal(origin.reach, 'this-machine');
  });
  test('no endpoint at all is unknown — not local by default', () => {
    assert.equal(describeToolOrigin({ endpoint:null, transport:'local-http' }).reach, 'unknown');
  });
  test('the missing registrar is declared rather than invented', () => {
    const origin = describeToolOrigin({ endpoint:'http://127.0.0.1:1/x' });
    assert.equal(origin.registrarRecorded, false);
    assert.match(origin.registrarNote, /audit log/);
  });
  test('tools are withheld, with the permission named, when the caller may not read them', () => {
    const block = describeTools({ tools:[{ id:'t' }], permitted:false });
    assert.equal(block.visible, false);
    assert.equal(block.requires, 'workspace.read');
    assert.equal(block.count, undefined, 'a withheld block does not leak a count');
  });
  test('no tools registered is a different answer from withheld', () => {
    const block = describeTools({ tools:[], permitted:true });
    assert.equal(block.visible, true);
    assert.equal(block.count, 0);
  });
});

describe('models carry their provenance, and no invented trust · UI-063', () => {
  const PROVIDERS = [
    { id:'p1', type:'local-openai-compatible', name:'Local', baseUrl:'http://127.0.0.1:11434/v1', external:false, consent:{ granted:false } },
    { id:'p2', type:'anthropic', name:'Anthropic', baseUrl:'https://api.anthropic.com/v1', external:true, consent:{ granted:true } },
  ];
  test('an external provider is marked as leaving this machine', () => {
    const block = describeModels({ providers:PROVIDERS, localModel:null, providersPermitted:true, runtimePermitted:false });
    assert.deepEqual(block.providers.items.map((item) => item.reach), ['this-machine', 'off-machine']);
  });
  test('the runtime is withheld on its own permission, not on the workspace one', () => {
    const block = describeModels({ providers:PROVIDERS, localModel:null, providersPermitted:true, runtimePermitted:false });
    assert.equal(block.providers.visible, true);
    assert.equal(block.localRuntime.visible, false);
    assert.equal(block.localRuntime.requires, 'hardware.read');
  });
  test('attached and launched are kept apart', () => {
    const block = describeModels({
      providers:[], localModel:{ mode:'attach', endpoint:'http://127.0.0.1:8080', model:'a-model', launched:null, inProcessInference:false },
      providersPermitted:true, runtimePermitted:true,
    });
    assert.equal(block.localRuntime.launchedHere, false);
    assert.equal(block.localRuntime.inProcessInference, false);
  });
  test('trust state is not rendered, and the payload says why', () => {
    const block = describeModels({ providers:[], localModel:null, providersPermitted:true, runtimePermitted:true });
    assert.equal(block.trustState.shown, false);
    assert.match(block.trustState.reason, /nothing sets|no code writes/i);
  });
});

describe('the assembled payload', () => {
  const build = (over = {}) => buildHomeOverview({
    health:HEALTH, mayReadHealthDetail:true, tools:[], toolsPermitted:true,
    providers:[], providersPermitted:true, localModel:null, runtimePermitted:true,
    tasks:[{ id:'t1' }], tasksPermitted:true, lastSession:null,
    generatedAt:'2026-07-27T12:00:00.000Z', ...over,
  });
  test('it declares how many entry actions can actually act', () => {
    assert.equal(build().entryActionsWired, 2, 'open and new, with no session to resume');
    assert.equal(build({ lastSession:{ id:'s', title:'t' } }).entryActionsWired, 3);
  });
  test('a caller without workspace.read gets withheld blocks, not empty ones', () => {
    const payload = build({ toolsPermitted:false, providersPermitted:false, tasksPermitted:false });
    assert.equal(payload.tools.visible, false);
    assert.equal(payload.tasks.visible, false);
    assert.equal(payload.tasks.requires, 'workspace.read');
    assert.equal(payload.models.providers.visible, false);
  });
  test('no zone travels in the payload — the browser owns that answer', () => {
    assert.equal('zone' in build(), false);
  });
  test('the entry actions are built once per call and are not shared mutable state', () => {
    const first = build();
    first.quickActions[0].goal = 'mutated';
    assert.notEqual(build().quickActions[0].goal, 'mutated');
  });
});

// --- P3 -------------------------------------------------------------------------------
//
// Two defects found by SCREENSHOTTING this page rather than reading its markup, on the run that
// registered twenty engine tools. Neither had a failing test before, and neither would have got
// one from the markup: in both cases the template was correct and the VALUE was not what it
// assumed.
describe('P3 · the initial screen after the engine tools were registered', () => {
  test('a watchdog detail is rendered as text, not as [object Object]', () => {
    // Every subject `registerWatchdogSubjects` declares returns an OBJECT here. The panel showed
    // `[object Object]` for all fifteen components on the product's front page.
    assert.equal(summariseComponentDetail({ pid: 41, uptimeSeconds: 900 }), 'pid 41 · uptimeSeconds 900');
    assert.equal(summariseComponentDetail({ mode: 'reference-node', externalDaemon: false }), 'mode reference-node · externalDaemon false');
    assert.equal(summariseComponentDetail(null), '');
    assert.equal(summariseComponentDetail({}), '');
    assert.equal(summariseComponentDetail('already a string'), 'already a string');
    assert.equal(summariseComponentDetail({ nested: { a: 1 } }), 'nested {"a":1}');
    assert.equal(summariseComponentDetail({ missing: null }), 'missing —');
    // The regression itself, stated as the thing that must never come back.
    for (const value of [{ pid: 1 }, { a: 'b' }, {}]) {
      assert.doesNotMatch(summariseComponentDetail(value), /\[object Object\]/);
    }
  });

  test('the tools panel is capped, still reports the true total, and shows registered tools first', () => {
    const builtins = Array.from({ length: 20 }, (_, index) => ({ id: `b${index}`, name: `engine_${index}`, transport: 'builtin', builtin: true }));
    const registered = [{ id: 'r1', name: 'Mine', transport: 'local-http', endpoint: 'http://127.0.0.1:9/' }];
    const block = describeTools({ tools: [...builtins, ...registered], permitted: true });
    assert.equal(block.count, 21, 'the count must stay the TRUE total, or the panel disagrees with the Tools page');
    assert.equal(block.items.length, HOME_TOOLS_SHOWN);
    assert.equal(block.shown, HOME_TOOLS_SHOWN);
    assert.equal(block.items[0].name, 'Mine', 'twenty built-ins pushed the operator\'s own tool off the panel');
    // A small installation is not capped into saying something it should not.
    const small = describeTools({ tools: registered, permitted: true });
    assert.equal(small.count, 1);
    assert.equal(small.shown, 1);
  });
});

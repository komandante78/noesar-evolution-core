// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The initial screen's data · UI-060…UI-063.
//
// One route assembles it, and the assembling happens HERE rather than in the browser for
// two reasons.
//
// The first is authority. "Health and logs" is an owner-only section, and the fastest way
// to turn a new page into a privilege escalation is to put the same numbers on a page that
// everyone can reach. So each block is built against the caller's own permissions, and the
// server decides what it contains — not the browser, which can be told anything.
//
// The second is that an empty panel and a withheld panel look identical from the outside,
// and this product has already decided that is not acceptable (UI-036: empty and silent is
// refused). So a block that a caller may not see says so, with the permission it would
// need; a block that is genuinely empty says THAT, in different words. A reader can always
// tell which of the two they are looking at.
//
// Nothing here fabricates provenance. Where the record does not carry an origin, the
// origin reads "not recorded" — a made-up lineage on a security surface would be worse
// than no lineage at all, because it would be believed.

/** A block the caller may not see. It names the permission rather than going quiet. */
function withheld(requires, detail) {
  return { visible:false, requires, detail };
}

/**
 * Service health · UI-063, first third.
 *
 * Two shapes, chosen by role. An owner sees the components, because that is what the
 * owner-only Health section shows and the initial screen must not be a way around it.
 * Everyone else sees the single aggregate word — enough to know whether the installation
 * is well, not enough to enumerate its internals — and is told that the detail exists and
 * who may read it. A summary that silently hides its own existence teaches people the
 * product has less to say than it does.
 */
export function summariseServices({ health, mayReadDetail }) {
  const base = {
    visible:true,
    status:health.status,
    checkedAt:health.checkedAt,
    safeMode:{ active:Boolean(health.safeMode?.active), since:health.safeMode?.since ?? null },
    degradedCount:Array.isArray(health.degraded) ? health.degraded.length : 0,
    componentCount:Array.isArray(health.components) ? health.components.length : 0,
  };
  if (!mayReadDetail) {
    return { ...base, detailVisible:false, detailRequires:'role owner', components:[] };
  }
  return {
    ...base,
    detailVisible:true,
    detailRequires:null,
    components:(health.components ?? []).map((component) => ({
      name:component.name,
      healthy:component.healthy,
      essential:component.essential,
      detail:component.detail ?? null,
      detailSummary:summariseComponentDetail(component.detail),
    })),
  };
}

/**
 * A watchdog probe's `detail` is an OBJECT — `{pid, uptimeSeconds}`, `{freeBytes, totalBytes}` —
 * for every subject `registerWatchdogSubjects` declares. The Home panel rendered it straight into
 * the markup, so all fifteen components on the product's front page read `[object Object]`. Found
 * by screenshotting the page in P3, which no test on this panel would have caught: the markup was
 * correct, the value was not a string, and nothing asserted it ever had been one.
 *
 * Formatted here rather than in the browser so every shell says the same thing about one subject,
 * and so it can be tested at all. The raw object stays on `detail` for anything that wants the
 * numbers; `detailSummary` is what a person reads.
 */
export function summariseComponentDetail(detail) {
  if (detail === null || detail === undefined) return '';
  if (typeof detail === 'string') return detail;
  if (typeof detail !== 'object') return String(detail);
  return Object.entries(detail)
    // An empty object is not "no detail" and must not silently read as one; `Object.entries`
    // returning nothing is handled by the join below, which yields ''. That is the honest
    // rendering of `{}` and matches what the null case shows.
    .map(([key, value]) => `${key} ${value === null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

/**
 * Where a tool comes from · UI-063, second third.
 *
 * Provenance here means the tool's ORIGIN — what it talks to and whether that is on this
 * machine — not who pressed the button. The record does not carry a registrar: the audit
 * ledger does, under `tool.registered`, and this says so instead of inventing a name. That
 * gap is real and is written down rather than papered over.
 *
 * `external` is the tool's own declaration; the host is derived from the endpoint, so a
 * tool that calls itself local while pointing at the internet is visibly both.
 */
export function describeToolOrigin(tool) {
  const endpoint = typeof tool.endpoint === 'string' ? tool.endpoint.trim() : '';
  let host = null;
  let scheme = null;
  if (endpoint) {
    try {
      const parsed = new URL(endpoint);
      host = parsed.hostname;
      scheme = parsed.protocol.replace(':', '');
    } catch {
      // An MCP stdio transport carries an executable, not a URL. That is not a
      // malformed endpoint — it is a different kind of origin, and it is reported as one.
      host = null;
      scheme = tool.transport === 'mcp-stdio' ? 'executable' : null;
    }
  }
  const LOCAL_HOSTS = new Set(['localhost','127.0.0.1','::1','host.docker.internal','0.0.0.0']);
  const onThisMachine = host ? LOCAL_HOSTS.has(host) : scheme === 'executable';
  return {
    declaredExternal:Boolean(tool.external),
    scheme,
    host,
    // Three values, not two: "unknown" is what an endpoint-less record honestly is, and
    // calling it local because it has no host would be the friendlier of two lies.
    // Four values since P3, and the fourth is not a softening of the third. `unknown` is the
    // honest answer for a record that HAS an endpoint field and nothing usable in it. A built-in
    // engine tool is a different thing entirely: it has no endpoint because it opens no
    // connection, and reporting the best-known fact about it as "unknown" would be the friendlier
    // of two lies in the other direction — it would put twenty tools that reach nothing at all in
    // the same row as one whose destination could not be read.
    reach:tool.transport === 'builtin' ? 'in-process'
      : host || scheme === 'executable' ? (onThisMachine ? 'this-machine' : 'off-machine') : 'unknown',
    registrarRecorded:false,
    registrarNote:'The tool record carries no registrar. Who registered it is in the audit log, under tool.registered.',
  };
}

/** How many tools the Home panel lists before it stops and says how many there are.
 *
 *  Six, the same number `coden.benchLists` caps its seven panels at, and for the same reason:
 *  Home is an overview, and a panel that grows without limit stops being one. It had no cap
 *  because an installation had three tools; P3 registered twenty engine tools and the panel
 *  became the longest thing on the page — seen rendered, not deduced.
 *
 *  `count` stays the TRUE total either way, so "6 of 23" can be said rather than implied. A cap
 *  that also capped the number would be a panel quietly disagreeing with the Tools page about how
 *  many tools this installation has. */
export const HOME_TOOLS_SHOWN = 6;

export function describeTools({ tools, permitted }) {
  if (!permitted) return withheld('workspace.read', 'Installed tools are part of the workspace.');
  const all = (Array.isArray(tools) ? tools : []).map((tool) => ({
    id:tool.id,
    name:tool.name,
    transport:tool.transport,
    endpoint:tool.endpoint ?? null,
    origin:describeToolOrigin(tool),
    mutative:Boolean(tool.mutative),
    // P3. Carried so the panel can say what a built-in NEEDS (a permission) instead of what it
    // lacks (a credential and a consent it can never have). Reporting "no credential · no consent"
    // for twenty tools that authenticate to nothing reads as twenty unfinished installations.
    builtin:Boolean(tool.builtin),
    permissions:Array.isArray(tool.permissions) ? tool.permissions : [],
    requiresApproval:tool.requiresApproval !== false,
    credentialConfigured:Boolean(tool.credentialConfigured),
    consentGranted:Boolean(tool.consent?.granted),
    registeredAt:tool.createdAt ?? null,
  }));
  // Operator-registered tools first, then the product's own: what someone added is what they came
  // to look at, and twenty built-ins must not push three registered tools off the panel.
  const ordered = [...all.filter((item) => !item.builtin), ...all.filter((item) => item.builtin)];
  return {
    visible:true, count:ordered.length, items:ordered.slice(0, HOME_TOOLS_SHOWN),
    shown:Math.min(ordered.length, HOME_TOOLS_SHOWN), cappedAt:HOME_TOOLS_SHOWN,
  };
}

/**
 * Where a model comes from · UI-063, final third.
 *
 * Two populations with genuinely different provenance, kept apart instead of merged into
 * one list that would have to lie about half its rows:
 *
 *   · a PROVIDER is a configured endpoint. Its provenance is its type, its base URL, and
 *     whether that URL leaves this machine — which is also what decides whether using it
 *     is an egress. Consent state travels with it because a provider that exists and a
 *     provider that may be used are not the same fact.
 *   · the LOCAL RUNTIME is an inference process this installation attaches to or launches.
 *     Its provenance is the endpoint, the model name it reports, and — the part that
 *     matters — whether this installation launched it or merely attached to something that
 *     was already there. Those are different trust stories and the status already
 *     distinguishes them.
 *
 * What is deliberately NOT here: a trust state. The schema carries `trust_state` on model
 * descriptors and no code writes it, so every row would read the same constant. A column
 * nobody sets, rendered as if it meant something, is fabricated evidence — see the note in
 * the plan about dead schema being worse than absence.
 */
export function describeModels({ providers, localModel, providersPermitted, runtimePermitted }) {
  const block = { visible:true, providers:null, localRuntime:null, trustState:{
    shown:false,
    reason:'model_descriptors.trust_state exists in the schema and no code writes it. Rendering a value nothing sets would be a number with no source.',
  } };
  block.providers = providersPermitted
    ? {
      visible:true,
      count:(providers ?? []).length,
      items:(providers ?? []).map((profile) => ({
        id:profile.id,
        name:profile.name ?? profile.type,
        type:profile.type,
        baseUrl:profile.baseUrl ?? null,
        external:Boolean(profile.external),
        reach:profile.external ? 'off-machine' : 'this-machine',
        consentGranted:Boolean(profile.consent?.granted),
        credentialConfigured:Boolean(profile.credentialConfigured),
        defaultModel:profile.defaultModel ?? profile.model ?? null,
      })),
    }
    : withheld('workspace.read', 'Provider profiles are part of the workspace.');
  block.localRuntime = runtimePermitted
    ? {
      visible:true,
      mode:localModel?.mode ?? null,
      endpoint:localModel?.endpoint ?? null,
      model:localModel?.model ?? null,
      // "attached" and "launched" are different provenance, and the status already
      // knows which: a process this installation started is one it can account for.
      launchedHere:Boolean(localModel?.launched),
      launchConfigured:Boolean(localModel?.launchConfigured),
      overriddenByEnvironment:Boolean(localModel?.overriddenByEnvironment),
      inProcessInference:localModel?.inProcessInference === true,
      lastError:localModel?.lastError ?? null,
    }
    : withheld('hardware.read', 'The local model runtime is hardware state.');
  return block;
}

/**
 * The six entry actions · UI-060.
 *
 * Three of them act. Three of them cannot, because cloning a repository, importing an
 * archive and connecting a remote all need an executor that holds a workspace, and this
 * layer has no execution surface. They are still LISTED, and each says what it is waiting
 * for — the alternative is a screen that quietly offers four things and lets the reader
 * conclude the other two were never in the design.
 *
 * The shape is built on the server so that the count and the wording cannot drift from the
 * criterion: a structural test can then assert six, and assert which three act.
 */
export function entryActions({ lastSession }) {
  return [
    {
      id:'resume', label:'Resume the last session', wired:Boolean(lastSession),
      target:lastSession ? { view:'chat', sessionId:lastSession.id } : null,
      detail:lastSession
        ? `${lastSession.title}`
        : 'No session yet. The first conversation you open becomes the one this resumes.',
    },
    { id:'open-project', label:'Open a project', wired:true, target:{ view:'projects' }, detail:'The projects you already have.' },
    { id:'new-project', label:'Start a new project', wired:true, target:{ view:'projects', focus:'projectName' }, detail:'A project owns its own chats, memory, files and tools.' },
    {
      id:'clone-repository', label:'Clone a repository', wired:false, target:null,
      detail:'Waiting on the backbone. Cloning writes a working tree, and writing one needs the executor that holds it — nothing on this layer may write to disk.',
    },
    {
      id:'import-archive', label:'Import an archive', wired:false, target:null,
      detail:'Waiting on the backbone, for the same reason. Restoring a WORKSPACE backup is a different act and already exists in Settings → Storage.',
    },
    {
      id:'connect-remote', label:'Connect a remote repository', wired:false, target:null,
      detail:'Waiting on the backbone and on the search gate: a remote is a way out to the network, and this build has nothing that classifies what goes through it.',
    },
  ];
}

/**
 * The ten quick actions · UI-061.
 *
 * Phrased as goals, because the Intent Frame starts from a goal — the wording is the
 * criterion, not decoration. They are held here rather than in the markup so that the
 * count is a property of the code: "ten" is checkable, and a list in HTML is a list nobody
 * counts until it is nine.
 *
 * What they do today is honest and small: they open a conversation with the goal as its
 * opening text. The Intent Frame that would turn a goal into a Plan is backbone work, and
 * the surface says so rather than implying the goal has been understood.
 */
export const QUICK_ACTIONS = Object.freeze([
  { id:'analyse-repository', goal:'Analyse this repository and tell me how it is put together' },
  { id:'find-fix-bug',       goal:'Find a bug and fix it' },
  { id:'implement-feature',  goal:'Implement a feature' },
  { id:'write-missing-tests',goal:'Generate the tests that are missing' },
  { id:'check-security',     goal:'Check the security of this code' },
  { id:'update-dependencies',goal:'Update the dependencies' },
  { id:'explain-architecture',goal:'Explain the architecture' },
  { id:'improve-performance',goal:'Improve the performance' },
  { id:'prepare-release',    goal:'Prepare a release' },
  { id:'review-my-changes',  goal:'Review my changes' },
]);

export function buildHomeOverview({
  health, mayReadHealthDetail, tools, toolsPermitted, providers, providersPermitted,
  localModel, runtimePermitted, tasks, tasksPermitted, lastSession, generatedAt,
}) {
  // No zone travels in this payload on purpose. The browser already resolves the effective
  // zone through the five-tier settings route, and a second answer to the same question,
  // computed somewhere else, is how two parts of one screen come to disagree about what
  // time it is.
  return {
    generatedAt,
    entryActions:entryActions({ lastSession }),
    quickActions:QUICK_ACTIONS.map((action) => ({ ...action })),
    // Stated in the payload, not left for the reader to count: how many of the six entry
    // actions can actually do something on this installation. The same declaration the
    // bench status line makes about its twelve fields.
    entryActionsWired:entryActions({ lastSession }).filter((action) => action.wired).length,
    services:summariseServices({ health, mayReadDetail:mayReadHealthDetail }),
    tools:describeTools({ tools, permitted:toolsPermitted }),
    models:describeModels({ providers, localModel, providersPermitted, runtimePermitted }),
    tasks:tasksPermitted
      ? { visible:true, items:Array.isArray(tasks) ? tasks : [] }
      : withheld('workspace.read', 'Tasks are part of the workspace.'),
  };
}

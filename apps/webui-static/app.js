// SPDX-License-Identifier: AGPL-3.0-or-later
import { initI18n, t } from './i18n.js';
import { PAGE_HELP } from './page-help.js';
import { qrSvg } from './qr.js';
import { parseHex, contrast, deriveReadable, formatRatio } from './colour.js';
import { isZonelessInstant, splitTasks, zonedWallClockToUtcIso } from './schedule.js';
// The coding agent's slash commands. The SAME file the terminal shell imports off disk — one
// registry, two shells, so the two vocabularies cannot drift the way `PANEL_NAMES` did.
import {
  AGENT_COMMANDS, matchCommands, parseCommandPrompt, resolveCommand,
  menuFor, groupMenu, hiddenNote, accountFromUser, ROUTE_ACCESS, SECTION_ACCESS,
} from '../shared/coden/agent-commands.js';
// What a session LOOKS like, and what a typed line MEANS — phase 2 put it where both shells
// read it. This page drives the same `planTurn` the terminal drives, over its own transport;
// that is what "la WebUI È la TUI" has to mean in code rather than in prose.
import {
  createView, say, planTurn, callResult, reasoningSummary, frequencySummary,
  divergenceLines, divergenceSummary, CLEARED_NOTE, addressEntries, matchAddresses, menuFrame, menuEntriesFor, promptKeys,
} from './coden-view-model.js';
const $=(selector)=>document.querySelector(selector);const $$=(selector)=>[...document.querySelectorAll(selector)];
// Phase 6 (`D-0312`): the reasoning chip of the `.coden-bar` status row. One writer, so a
// second caller cannot start phrasing the degradation its own way. `title` carries every
// reason in full — the chip has room for one sentence, an operator deciding what to do needs
// them all, and truncating without saying so would be its own small silence.
// Phase 7 (`CE-010`): the divergence profile, rendered BESIDE the diff as four signals with
// their level. Never a number: `divergence-profile.mjs` refuses to produce a score and this is
// where one would most plausibly reappear, as an average that reads like rigour.
function renderDivergence(divergence){
  const host=$('#codenDivergence');
  if(!host)return;
  const lines=divergenceLines(divergence);
  if(!lines.length){host.textContent='';host.classList.add('hidden');return;}
  host.classList.remove('hidden');
  host.textContent='';
  const head=document.createElement('div');
  head.className='divergence-head';
  head.textContent=`divergence — ${divergenceSummary(divergence)}`;
  host.append(head);
  for(const line of lines){
    const row=document.createElement('div');
    row.className=`divergence-signal level-${line.level}`;
    const id=document.createElement('span');id.className='divergence-id';id.textContent=line.id;
    const level=document.createElement('span');level.className='divergence-level';level.textContent=line.level;
    const note=document.createElement('span');note.className='divergence-note';note.textContent=line.note;
    row.append(id,level,note);
    host.append(row);
  }
}
function updateReasoningChip(reasoning){
  const chip=$('#codenReasoningChip');
  if(!chip)return;
  const text=reasoningSummary(reasoning);
  chip.textContent=`reasoning ${text}`;
  chip.classList.toggle('warn',Boolean(reasoning?.degraded));
  // `D-0312` asks for the frequency as well as the state, so it lives in the tooltip of the
  // chip that already shows the state — one place, not a second widget nobody opens. The
  // terminal puts the same string in its transcript note, from the same shaper.
  const state=reasoning?.degraded
    ?`ATOM was asked for and could not be reached. The reference provider answered instead.\n\n${(reasoning.reasons??[]).join('\n')}`
    :'Which provider answered this session: atom when the chain worked, reference when ATOM could not be reached.';
  chip.title=`${state}\n\nHow often ATOM has fallen: ${frequencySummary(reasoning?.frequency)}`;
}

// --- theme, applied before anything else ------------------------------------
// This runs at the top of the module on purpose. A theme applied later — after the first
// paint, or inside an init function — shows the default for a frame and then swaps, which
// is the flash every themed interface is judged by. There is nothing to fetch: the choice
// lives on this device.
const THEMES=[
  {id:'midnight',label:'Midnight',hint:'the default'},
  {id:'slate',label:'Slate',hint:'cooler neutrals'},
  {id:'graphite',label:'Graphite',hint:'warmer neutrals'},
  {id:'indigo',label:'Indigo',hint:'the reference accent'},
  {id:'teal',label:'Teal',hint:'green-blue accent'},
  {id:'amber',label:'Amber',hint:'warm accent'},
  {id:'violet',label:'Violet',hint:'purple accent'},
  {id:'daylight',label:'Daylight',hint:'light'},
  {id:'contrast',label:'High contrast',hint:'maximum separation'},
];
const THEME_KEY='noesar.theme';
const ACCENT_KEY='noesar.accent';
// The accent is a FAMILY, not one value: a fill carries a gradient, a wash carries an
// alpha, and a link has to be readable as text. Choosing one hue moves all of them
// together, which is what lets "any colour you like" survive the contrast requirement.
const ACCENT_TOKENS=['accent-fill-from','accent-fill-to','accent-link','accent-brand','accent-eyebrow','blue'];
function readTheme(){try{const value=localStorage.getItem(THEME_KEY);return THEMES.some((theme)=>theme.id===value)?value:'midnight';}catch{return 'midnight';}}
function readAccent(){try{const value=localStorage.getItem(ACCENT_KEY);return parseHex(value)?value:'';}catch{return '';}}
function tokenValue(name){return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();}
// `D-0416`, and it is here rather than beside the functions that use it for exactly the reason
// that decision exists. `applyTheme()` runs during `initAppearance()`, near the START of the boot
// sequence, and it now tells the embedded terminal about the change — which reads this binding.
// A `let` declared further down the file would be in the temporal dead zone at that moment and
// would throw `Cannot access 'codenTerminal' before initialization`, killing the whole module.
// That defect shipped once (slice 3) and cost the entire WebUI; `webui-boot-order.test.mjs`
// pins the invariant so it cannot ship twice.
let codenTerminal=null;
const CODEN_TERMINAL_STATUS={idle:'Not connected.',connecting:'Connecting to the session…',live:'Attached.',reconnecting:'Reconnecting…',refused:'Not permitted to attach.',failed:'This terminal could not start.'};
function applyTheme(id){
  document.documentElement.dataset.theme=id;
  try{localStorage.setItem(THEME_KEY,id);}catch{}
  // D-0418: the emulator lives in another document and cannot see this attribute change.
  // Told rather than left to guess — a terminal that keeps the old palette after a theme
  // change is the divergence this project spends its parity rules on.
  codenTerminalTheme?.();
}
function applyAccent(hex){
  const root=document.documentElement;
  for(const token of ACCENT_TOKENS)root.style.removeProperty(`--${token}`);
  if(!hex||!parseHex(hex))return;
  // Measured against the ACTIVE theme's own surface, so the derivation answers the question
  // that matters here rather than one about whichever theme happened to be default.
  const background=tokenValue('surface-card')||'#0a121f';
  const readable=deriveReadable(hex,background,4.5);
  root.style.setProperty('--accent-fill-from',hex);
  root.style.setProperty('--accent-fill-to',hex);
  root.style.setProperty('--blue',hex);
  // UI-024: the FILL keeps the chosen hue; everything that has to be READ uses the derived
  // relative. Refusing the colour outright would tell someone their choice is forbidden,
  // when what is actually true is that this one pairing is not readable.
  for(const token of ['accent-link','accent-brand','accent-eyebrow'])root.style.setProperty(`--${token}`,readable?readable.hex:hex);
}
applyTheme(readTheme());
applyAccent(readAccent());
// The CSRF token is a double-submit value: the server sets `noesar_csrf` as a
// deliberately NON-HttpOnly cookie so that this script can read it back and echo it in
// the x-noesar-csrf header. It used to be captured only from the login response into a
// module variable, and a page reload resets that to ''. The session cookie survives the
// reload, so the app still looked signed in while api() silently stopped sending the
// header and EVERY write returned 403 "CSRF validation failed" — which is what "clicking
// does nothing" was. Reproduced in a real browser: create a project right after login
// (succeeds), press F5, create another (403). Reading the cookie back is what makes a
// refreshed tab, a second tab and a bookmarked URL work at all.
function readCsrfCookie(){
  const entry=document.cookie.split(';').map((part)=>part.trim()).find((part)=>part.startsWith('noesar_csrf='));
  return entry?decodeURIComponent(entry.slice('noesar_csrf='.length)):'';
}
let csrfToken=readCsrfCookie();let currentUser=null;let setupChallenge='';let loginChallenge='';let codenMode='NORMAL';let currentPathPlan=null;let activeRunId=null;let currentMode='ASK';
// Reported by the server for this account's role, never derived here — restating the
// permission matrix in the browser is one refactor away from disagreeing with the
// server that enforces it.
let currentPermissions=[];
let mfaReplacement=null;
let passkeyRemoveId=null;
const state={projects:[],conversations:[],branches:[],memories:[],artifacts:[],sources:[],providers:[],providerCatalog:[],tools:[],agents:[],agentRuns:[],workspaceActionRuns:[],activeProjectId:null,activeConversationId:null,activeBranchId:null};
const escapeHtml=(value)=>String(value??'').replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
// WebAuthn moves binary (challenge, credential IDs, signatures) as ArrayBuffer on the
// browser side and base64url over the wire — there is no npm dependency in this
// project to do that conversion, so it is done by hand, once, here.
function base64urlToBytes(value){
  const normalized=String(value??'').replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-(normalized.length%4))%4);
  const binary=atob(padded);
  const bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);
  return bytes;
}
function bytesToBase64url(buffer){
  const bytes=new Uint8Array(buffer);
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function setStatus(message,error=false){$('#statusMessage').textContent=message;$('#statusMessage').classList.toggle('error',error);}

// --- user-visible feedback -------------------------------------------------
// Every action must end in a visible outcome. A silent failure is indistinguishable
// from a dead button, which is how a working page gets reported as "nothing happens".
function toast(message,{kind='info',correlationId=null}={}){
  const host=$('#toastHost');if(!host)return setStatus(message,kind==='error');
  const node=document.createElement('div');
  node.className=`toast toast-${kind}`;
  node.setAttribute('role',kind==='error'?'alert':'status');
  node.innerHTML=`<span>${escapeHtml(message)}</span>`;
  if(correlationId){
    const tag=document.createElement('code');
    tag.className='toast-correlation';tag.textContent=correlationId;
    tag.title='Correlation ID — quote this when reporting the problem';
    node.appendChild(tag);
  }
  const close=document.createElement('button');
  close.className='toast-close';close.type='button';close.textContent='×';
  close.setAttribute('aria-label','Dismiss');
  close.addEventListener('click',()=>node.remove());
  node.appendChild(close);
  host.appendChild(node);
  setStatus(message,kind==='error');
  if(kind!=='error')setTimeout(()=>node.remove(),6000);
}
// Errors are reported with their message and correlation ID, never a stack trace.
function reportError(error,context=''){
  const message=error?.status===403&&/csrf/i.test(error?.message??'')
    ?'Your session security token expired. Reload the page and try again.'
    :(error?.message||'Something went wrong.');
  toast(context?`${context}: ${message}`:message,{kind:'error',correlationId:error?.correlationId??null});
}
// A button that fires a request must not stay clickable while it is in flight, and
// must come back even when the request throws.
export async function withBusy(button,work,{busyLabel='Working…'}={}){
  if(!button)return work();
  const original=button.textContent;const wasDisabled=button.disabled;
  button.disabled=true;button.dataset.busy='true';button.textContent=busyLabel;
  try{return await work();}
  finally{button.disabled=wasDisabled;delete button.dataset.busy;button.textContent=original;}
}
async function api(path,options={}){
  // Re-read the cookie on every call rather than trusting the captured value: the
  // session (and its CSRF token) can be reissued by the server at any point, and a
  // stale in-memory copy is exactly the failure this whole comment block exists for.
  if(!csrfToken)csrfToken=readCsrfCookie();
  const headers={...(options.body?{'content-type':'application/json'}:{}),...(csrfToken?{'x-noesar-csrf':csrfToken}:{}),...(options.headers??{})};
  const response=await fetch(path,{credentials:'same-origin',...options,headers});
  const correlationId=response.headers.get('x-correlation-id')??null;
  const text=await response.text();
  let value={};try{value=text?JSON.parse(text):{};}catch{value={error:text||'Invalid response'};}
  if(!response.ok){
    // A 403 on a write with a token that came from the cookie means the cookie went
    // stale, not that the user did something wrong. Refresh it once and say so plainly.
    if(response.status===403&&/csrf/i.test(value.error??'')){
      const fresh=readCsrfCookie();
      if(fresh&&fresh!==csrfToken){csrfToken=fresh;return api(path,options);}
    }
    throw Object.assign(new Error(value.error??'Request failed'),{value,status:response.status,correlationId});
  }
  return value;
}
function showOnly(form){['#setupForm','#setupMfaForm','#loginForm','#loginMfaForm','#recoveryStartForm','#recoveryFinishForm'].forEach((selector)=>$(selector).classList.toggle('hidden',selector!==form));}
function authError(message=''){$('#authError').textContent=message;}
// --- routing ---------------------------------------------------------------
// Views used to be toggled by a click handler alone, so the URL never changed: a
// refresh always landed on Home, the browser Back button left the app entirely, and
// no view could be linked to. The hash is now the source of truth.
// Only routes that have a real, wired page. Adding a name here before its page loads
// data turns a 404 into something worse: a blank panel that looks like a broken app.
// TWELVE destinations, down from twenty-three. A destination is a place you decide to go
// to; everything else is a section you arrive at. The fifteen entries that used to sit in
// the sidebar did not disappear — they changed rank and live inside the single Settings
// destination, or inside the working surface that actually uses them.
const ROUTES=new Set(['home','chat','coden','coden-tui','tools','projects','documents','knowledge','memory','agents','workflows','models','research','settings']);
// The Settings destination's own menu: menu inside the menu, in three groups. The order
// here is the order rendered, and it is the source of truth for which section a hash may
// name — the markup is checked against it at boot rather than being trusted.
const SETTINGS_SECTIONS=['sessions','appearance','language','about','licence','privacy','people','security','skills','models-hardware','storage','audit','health','updates','modules','remote-targets'];
// Which section a bare "#/settings" lands on. It is the menu's first entry again: the
// exception existed only because Sessions was ranked and not built, and a landing surface
// saying "not built" reads as a broken product. Sessions is built, so the reason is gone
// and the special case goes with it.
const DEFAULT_SECTION='sessions';
// Where a demoted page went. Every address that used to work still works: a deep link, a
// bookmark or an old note lands on the section that now owns it instead of on a 404.
// Removing a page from the sidebar is a change of rank, not a change of address.
const LEGACY_ROUTES={
  tasks:'home',tools:'coden',
  approvals:'settings/audit',providers:'settings/privacy',hardware:'settings/models-hardware',
  users:'settings/people',security:'settings/security',health:'settings/health',
  logs:'settings/health',updates:'settings/updates',backups:'settings/storage',
  about:'settings/about',
};
// --- the addresses inside CodeN Evolution ----------------------------------
// UI-030…UI-037 gave the bench eleven panels and the agent column five, and not one of
// them had an address: they could be clicked, and never linked to, reloaded, bookmarked
// or reached by typing. They are now two regions of one address space —
// `#/coden/bench/diff`, `#/coden/agent/plan` — carried by the same three hash segments
// Settings and Sessions already use rather than by a fourth invented for them.
//
// The panel NAMES are deliberately absent from this file. They are read from the markup's
// own data-bench-panel/data-agent-panel attributes, because a list of destinations kept
// by hand beside the markup is exactly how the sidebar came to advertise the TUI as "not
// built" for as long as the TUI had been working: two copies of one fact, one of them
// maintained. There is one copy of this fact, and it is the markup.
//
// An address names what you jumped TO, not the whole screen. The bench and the agent
// column are visible at the same time, so naming one leaves the other where it was —
// that is what a jump-to-address is. A full layout snapshot is a different mechanism.
// Phase 3 removed the switchers these regions used to carry: the eleven bench tabs, the
// five-entry agent menu, and the Navigator column whose nine groups are bench panels now.
// What is left is the address space itself — a region is a set of panels with one of them
// showing, chosen by name. Nothing that was reachable stopped being reachable; what stopped
// existing is three separate widgets for choosing, all standing open at once.
const CODEN_REGIONS={
  bench:{panelAttr:'data-bench-panel'},
  agent:{panelAttr:'data-agent-panel'},
};
const attrSelect=(attr,value)=>value===undefined?`[${attr}]`:`[${attr}="${value}"]`;
// What a panel does the moment it opens. This used to live in the tab's click handler,
// which made an address a second-class citizen: `#/coden/bench/closure` would have shown
// an empty Closure panel, because only a click ever loaded it.
const CODEN_PANEL_ON_OPEN={
  bench:{
    terminal:()=>$('#benchTerminal')?.scrollIntoView({block:'nearest'}),
    closure:()=>loadClosures(),
  },
  // Point 4b: opening Plan loads the runs no chat owns. It belongs here rather than in the
  // chat's Work column on purpose — a run started from the terminal has no conversation by
  // construction, and showing it beside a conversation is precisely the false attribution the
  // Owner's decision rules out. Declared and visible, just not filed under someone.
  agent:{plan:()=>renderUnattachedRuns()},
};
// The panel each region ships as active in the markup — what a bare `#/coden` means.
// Captured once at boot, before any click or address has moved one.
const codenDefaults={};
function codenPanelNames(region){
  const spec=CODEN_REGIONS[region];
  return spec?$$(`#view-coden ${attrSelect(spec.panelAttr)}`).map((node)=>node.getAttribute(spec.panelAttr)).filter(Boolean):[];
}
// Shows one region's panel and returns the panel actually shown: an unknown name falls
// back to the region's own default rather than leaving every panel of that region
// hidden — the same rule activateSection() applies to an unknown Settings section.
function activateCodenPanel(region,requested){
  const spec=CODEN_REGIONS[region];if(!spec)return'';
  const wanted=codenPanelNames(region).includes(requested)?requested:codenDefaults[region];
  if(!wanted)return'';
  // PHASE 3c — ONE panel is open, across BOTH regions. Two regions each showing a panel is a
  // dashboard however few panels each of them holds, and `16` §4b.2 draws no side column at
  // all: the canonical form is status line, transcript, prompt. An address names ONE place, so
  // opening one now closes the other region's rather than leaving it standing beside it.
  Object.entries(CODEN_REGIONS).forEach(([other,otherSpec])=>{
    if(other===region)return;
    $$(`#view-coden ${attrSelect(otherSpec.panelAttr)}`).forEach((node)=>node.classList.remove('active'));
  });
  // The bench is HIDDEN until an address opens something in it. A bare `#/coden` is the four
  // regions and nothing else — "nessun pannello fisso", which is what the phase-3 contract
  // asks for in the line that says what must be true afterwards.
  $('#view-coden')?.setAttribute('data-panel-open','yes');
  $$(`#view-coden ${attrSelect(spec.panelAttr)}`).forEach((node)=>node.classList.toggle('active',node.getAttribute(spec.panelAttr)===wanted));
  // The breadcrumb is the one place left on this page that says which panel is open, now
  // that no tab is sitting there looking selected. It names the bench panel: the agent
  // column's panel carries its own heading, in view, beside it.
  if(region==='bench'){
    const heading=$(`#view-coden ${attrSelect(spec.panelAttr,wanted)}`)?.querySelector('h3')?.textContent?.trim();
    const slot=$('#benchWhereName');if(slot&&heading)slot.textContent=heading;
  }
  return wanted;
}
// The two things a change of address owes an assistive technology: the document title and
// the live region. A panel whose arrival only a sighted user can perceive is not a
// destination, and a tab click reaching its address without passing through activate()
// would have skipped both.
function announceCodenPanel(region,name){
  const spec=CODEN_REGIONS[region];if(!spec)return;
  const panel=$(`#view-coden ${attrSelect(spec.panelAttr,name)}`);
  const heading=panel?.querySelector('h3')?.textContent?.trim();
  if(!heading)return;
  document.title=`${heading} · NOESAR Evolution`;
  const live=$('#routeAnnouncer');if(live){live.setAttribute('translate','no');live.textContent=`${heading} ${t('panel')}`;}
}
// What a page needs before it is worth offering at all. `ROUTE_ACCESS` and `SECTION_ACCESS`
// are IMPORTED from `agent-commands.js` since phase 3a, not defined here. They were this
// page's private tables, which was right while only this page had destinations to hide; the
// `/` menu now offers the same destinations in the terminal, and a gate one shell can read
// and the other cannot is a gate the other silently does not apply. Moving beat copying:
// `CE-036` wants the two menus to be the SAME set, and two tables agree only until one is
// edited. None of this is enforcement — every request is still checked by the server.
function allows(rule){
  if(!rule)return true;
  if(rule.role&&currentUser?.role!==rule.role)return false;
  if(rule.permission&&!currentPermissions.includes(rule.permission))return false;
  return true;
}
function may(view){return allows(ROUTE_ACCESS[view]);}
function maySection(section){return allows(SECTION_ACCESS[section]);}
// The hash carries up to three segments: the destination, the section inside it (Settings
// only), and — for Sessions — which of its three places you are looking at. The third
// segment exists so that the Archive and the Bin are addressable: UI-004 calls the Archive
// a page of its own, and a "page" you cannot link to, reload or come back to with the
// browser's own button is a panel wearing the word.
function routeFromHash(){
  const raw=(location.hash||'').replace(/^#\/?/,'').split('?')[0].trim().toLowerCase();
  const [first='',second='',third='']=raw.split('/').filter(Boolean);
  if(!first)return{view:'home',section:'',place:''};
  const legacy=LEGACY_ROUTES[first];
  if(legacy){const [lv,ls='']=legacy.split('/');return{view:lv,section:ls,place:'',redirected:true};}
  return{view:first,section:second,place:third};
}
// Which of the three places the address names. An unknown third segment falls back to the
// working list rather than to an empty page.
function sessionPlaceFromHash(){
  const {place}=routeFromHash();
  return ['archived','bin'].includes(place)?place:'active';
}
function viewFromHash(){return routeFromHash().view;}
function activate(view,{updateHash=true,section='',place=''}={}){
  const known=ROUTES.has(view)&&document.querySelector(`#view-${view}`);
  // A page the account may not reach is shown as access-denied, not as a panel that
  // sits on "Loading…" while every one of its fetches answers 403.
  const permitted=Boolean(known)&&may(view);
  const target=!known?'not-found':permitted?view:'access-denied';
  if(!known)renderNotFound(view);
  else if(!permitted)renderAccessDenied(view);
  $$('.nav').forEach((node)=>node.classList.toggle('active',node.dataset.view===view));
  $$('.view').forEach((node)=>node.classList.toggle('active',node.id===`view-${target}`));
  // PHASE 3c · which destination is open, on the shell — so the top address box can leave the
  // ONE destination that has a prompt of its own. `16` §4b.4 rule 1: "un terminale non ha una
  // barra degli indirizzi, e tenerla significherebbe di nuovo due gesti per la stessa cosa".
  //
  // It leaves CodeN, and not the product. The other twelve destinations have no prompt to
  // absorb it, and `17` fixes the scope of this phase in a line: "cambia la destinazione CodeN
  // Evolution. Chat resta Chat, Impostazioni restano Impostazioni". Removing it everywhere
  // would take navigation away from twelve pages to satisfy a rule written about one.
  const shell=$('#appShell');if(shell)shell.dataset.view=target;
  let activeSection='';
  if(target==='settings')activeSection=activateSection(section);
  // Sections belong to Settings alone. Leaving the destination clears them, otherwise a
  // section would still be marked active behind a page that no longer contains it.
  else $$('.settings-section').forEach((node)=>node.classList.remove('active'));
  // CodeN reads the same two segments Settings reads: the second names the region, the
  // third the panel inside it. A bare `#/coden` names no region and moves nothing — the
  // panels keep whatever they were showing, which is what makes the sidebar entry a way
  // back to the work rather than a reset of it.
  // D-0404 slice 3. The terminal attaches when CodeN becomes the visible destination and
  // detaches when it stops being one. Not at boot: a socket held open by a background view
  // spends one of the account's viewport slots on a screen nobody is looking at, and the
  // bridge caps those at eight. Not on every activation either — `mountCodenTerminal` is
  // idempotent here because `codenTerminal` is only null when nothing is attached.
  if(target==='coden')attachCodenTerminal();else detachCodenTerminal();
  let codenAddress='';
  if(target==='coden'&&CODEN_REGIONS[section]){
    const shown=activateCodenPanel(section,place);
    if(shown){codenAddress=`${section}/${shown}`;CODEN_PANEL_ON_OPEN[section]?.[shown]?.();}
  }
  // The address keeps naming what was asked for. Rewriting it to #/access-denied would
  // make a reload land on a route that does not exist, turning a 403 into a 404.
  // The place is part of the address, so switching to the Archive and reloading lands on
  // the Archive. Only Sessions has one; every other section normalises it away.
  const wantedPlace=activeSection==='sessions'&&['archived','bin'].includes(place)?`/${place}`:'';
  let want=known?view:target;
  if(known&&target==='settings'&&activeSection)want=`${view}/${activeSection}${wantedPlace}`;
  // The panel stays in the address on a full activation too. Without this a deep link to
  // `#/coden/bench/diff` would be rewritten to `#/coden` — and because that rewrite goes
  // through `location.hash=`, it would fire hashchange and activate the page a second
  // time: a deep link that both loses its panel and costs two rounds of fetches.
  if(known&&codenAddress)want=`${view}/${codenAddress}`;
  // PHASE 3c. A bare `#/coden` used to be COMPLETED to whichever panel happened to be
  // showing, because a panel was always showing — which is what made this a dashboard rather
  // than a place with things you go to. `16` §4b.3: the panels "smettono di essere riquadri
  // sempre presenti e restano posti dove si va".
  //
  // So a bare `#/coden` now names no panel and opens none: the four regions, and nothing
  // below them. The address stays short because it is honest — there is nowhere further in
  // until you go somewhere. Nothing became unreachable; every one of the twenty-five is an
  // address the prompt opens, measured one by one in 3c-1 before this line was written.
  let completing=false;
  if(known&&target==='coden'&&!codenAddress){
    $$('#view-coden [data-bench-panel].active,#view-coden [data-agent-panel].active')
      .forEach((node)=>node.classList.remove('active'));
    $('#view-coden')?.removeAttribute('data-panel-open');
  }
  // A panel that was asked for and does not exist is corrected the same way. Without this
  // the screen falls back to the default while the ADDRESS keeps naming the panel nobody
  // has — the bar saying one thing and the page showing another, which is the confusion the
  // fallback existed to prevent.
  if(known&&codenAddress&&place&&codenAddress!==`${section}/${place}`)completing=true;
  const currentHash=(location.hash||'').replace(/^#\/?/,'').split('?')[0].trim().toLowerCase();
  // Two acts, and only one of them is a navigation.
  //
  // Completing or correcting an address names the SAME place properly, so it is written with
  // replaceState: that fires nothing, leaves no redundant entry in the Back button's way,
  // and does not re-enter this function. `location.hash=` would fire hashchange and activate
  // the page a second time — and this page's loader refetches the bench on every activation.
  // (Settings normalises through the hash and pays exactly that price; having no view loader,
  // what it pays is a class flip rather than a round of requests.)
  //
  // A correction is deliberately NOT gated on `updateHash`. That flag stops this function
  // from navigating on behalf of a caller who did not ask it to, and `goToHash` passes it as
  // false for everything except a legacy redirect — so gating the correction on it made the
  // correction dead code for every address a person can actually type. Found by driving a
  // real browser; eleven structural tests could not see it.
  if(currentHash!==want){
    if(completing)history.replaceState(null,'',`#/${want}`);
    else if(updateHash)location.hash=`#/${want}`;
  }
  const scope=activeSection?document.querySelector(`.settings-section[data-section="${activeSection}"]`):document.querySelector(`#view-${target}`);
  const heading=(scope&&scope.querySelector('h1,h2.page-title'))||document.querySelector(`#view-${target} h1`);
  document.title=heading?`${heading.textContent.trim()} · NOESAR Evolution`:'NOESAR Evolution';
  // Announce the change for assistive technology, which does not observe a class flip.
  const live=$('#routeAnnouncer');if(live){live.setAttribute('translate','no');live.textContent=`${heading?heading.textContent.trim():target} ${t('view')}`;}
  // An address that names a panel is announced as that panel, not as the page containing
  // it: "Diff panel", not "CodeN Evolution view" for eleven different addresses.
  if(codenAddress)announceCodenPanel(section,codenAddress.split('/')[1]);
  applyPanelRank(view);
  if(permitted&&typeof VIEW_LOADERS[view]==='function')VIEW_LOADERS[view]();
  // A section this account may not open must not fetch. Running the loader anyway fired
  // four requests that all answered 403 for a page the person was being refused — the
  // gate would have been enforced on screen and abandoned on the wire.
  if(activeSection&&maySection(activeSection)&&typeof SECTION_LOADERS[activeSection]==='function')SECTION_LOADERS[activeSection]();
}
// Returns the section actually shown, which is not always the one asked for: an unknown
// name falls back to the first, and one this account may not open renders as denied
// rather than as a section whose every fetch answers 403.
function activateSection(requested){
  const wanted=SETTINGS_SECTIONS.includes(requested)?requested:DEFAULT_SECTION;
  const permitted=maySection(wanted);
  const shown=permitted?wanted:'';
  $$('.settings-section').forEach((node)=>node.classList.toggle('active',node.dataset.section===shown));
  $$('.settings-nav').forEach((node)=>{
    node.classList.toggle('active',node.dataset.section===wanted);
    node.setAttribute('aria-current',node.dataset.section===wanted?'page':'false');
  });
  const denial=$('#settingsDenied');
  if(denial){
    denial.classList.toggle('hidden',permitted);
    if(!permitted){
      const rule=SECTION_ACCESS[wanted]??{};
      const requirement=rule.role?`the ${rule.role} role`:rule.permission?`the "${rule.permission}" permission`:'a permission you do not hold';
      denial.textContent=`"${wanted}" requires ${requirement}. You are signed in as ${currentUser?.role??'an unknown role'}.`;
    }
  }
  return wanted;
}
function renderNotFound(view){
  const panel=$('#view-not-found');if(!panel)return;
  const slot=$('#notFoundDetail');
  if(slot)slot.textContent=view?`No page is registered for "${view}".`:'That page does not exist.';
}
function renderAccessDenied(view){
  const slot=$('#accessDeniedDetail');if(!slot)return;
  const rule=ROUTE_ACCESS[view]??{};
  const requirement=rule.role?`the ${rule.role} role`:rule.permission?`the "${rule.permission}" permission`:'a permission you do not hold';
  slot.textContent=`"${view}" requires ${requirement}. You are signed in as ${currentUser?.role??'an unknown role'}.`;
}
// Nav entries for pages this account cannot open are removed rather than shown and
// rejected. Recomputed on sign-in, because the role is not known before then. The same
// now applies one level down: a Settings section the account cannot open is removed from
// the Settings menu, so demoting a page did not turn its gate into decoration.
function applyNavAccess(){
  $$('.nav').forEach((button)=>{
    const view=button.dataset.view;
    button.hidden=Boolean(view)&&!may(view);
  });
  $$('.settings-nav').forEach((button)=>{
    const section=button.dataset.section;
    button.hidden=Boolean(section)&&!maySection(section);
  });
}
// Populated further down, once each section's loader is defined. A view with no
// loader is static markup and needs no fetch.
const VIEW_LOADERS={};
// Sections carry the loaders their pages carried before the demotion. A page that used to
// fetch on activation must still fetch on activation, or a demoted page becomes a panel
// that is permanently on "Loading…".
const SECTION_LOADERS={};
function goToHash(){
  const {view,section,place,redirected}=routeFromHash();
  // A legacy address is rewritten so the bar shows where you actually are — otherwise a
  // reload would keep resolving the old name and the redirect would be invisible.
  activate(view,{updateHash:Boolean(redirected),section,place});
}
// Card D (s313/s317 addendum): a cold load at a real path (typed in the browser bar, or a
// bookmarked/shared link — server.mjs now answers it with this same shell instead of 404)
// has to land on the panel the in-page `/` box would open for the same address. Turn the
// path into the hash this router already knows how to read, before goToHash() ever runs.
// replaceState, not `location.hash=`: the latter fires hashchange and would activate the
// page a second time, the exact double-fetch this file's own correction logic elsewhere
// (activate()) already goes out of its way to avoid. Only on a hash-less load — once a
// hash exists it stays the single source of truth for every other function here.
function bootstrapPathIntoHash(){
  if(location.hash)return;
  const path=location.pathname.replace(/^\/+/,'');
  if(!path)return;
  history.replaceState(null,'',`/#/${path}${location.search}`);
}
function initRouter(){
  bootstrapPathIntoHash();
  window.addEventListener('hashchange',goToHash);
  goToHash();
  initSidebarRank();
  initContextPanelRank();
  initSettingsMenu();
}
// --- rank of the sidebar: full · icons · away -------------------------------
// `[` collapses one step and `]` expands one step. The choice is remembered, and a visible
// control in the top bar cycles the same three states: a keyboard shortcut is the fast
// path, never the only path — a sidebar that can only be brought back by knowing a key is
// a sidebar a mouse user has lost.
const SIDEBAR_RANKS=['hidden','icons','full'];
const SIDEBAR_KEY='noesar.sidebar.rank';
function readSidebarRank(){
  try{const stored=localStorage.getItem(SIDEBAR_KEY);return SIDEBAR_RANKS.includes(stored)?stored:'full';}catch{return 'full';}
}
function applySidebarRank(rank){
  const shell=$('#appShell');if(!shell)return;
  shell.dataset.sidebar=rank;
  const control=$('#sidebarRank');
  if(control){
    control.setAttribute('aria-expanded',String(rank==='full'));
    const label=$('#sidebarRankLabel');if(label)label.textContent=`Sidebar: ${rank}`;
  }
  // In icon rank the label is hidden visually but stays in the accessible name, so a
  // screen reader still hears "Projects" rather than a glyph with no name.
  try{localStorage.setItem(SIDEBAR_KEY,rank);}catch{}
}
function stepSidebarRank(direction){
  const current=$('#appShell')?.dataset.sidebar??'full';
  const index=Math.max(0,SIDEBAR_RANKS.indexOf(current));
  applySidebarRank(SIDEBAR_RANKS[Math.min(SIDEBAR_RANKS.length-1,Math.max(0,index+direction))]);
}
// A shortcut that fires while someone is typing a "[" into a message is a defect, not a
// shortcut. Anything that takes text keeps its keystroke.
function isTyping(target){
  if(!target)return false;
  if(target.isContentEditable)return true;
  return ['INPUT','TEXTAREA','SELECT'].includes(target.tagName);
}
function initSidebarRank(){
  applySidebarRank(readSidebarRank());
  $('#sidebarRank')?.addEventListener('click',()=>{
    const current=$('#appShell')?.dataset.sidebar??'full';
    applySidebarRank(SIDEBAR_RANKS[(SIDEBAR_RANKS.indexOf(current)+1)%SIDEBAR_RANKS.length]);
  });
  window.addEventListener('keydown',(event)=>{
    if(event.ctrlKey||event.metaKey||event.altKey||isTyping(event.target))return;
    if(event.key==='[')stepSidebarRank(-1);
    else if(event.key===']')stepSidebarRank(1);
  });
}
// --- rank of the context panel: docked · floating · away ---------------------
// Remembered PER DESTINATION. The panel is not equally wanted everywhere, and one global
// setting means every destination is wrong for someone: docking it for the workbench used
// to mean docking it on Home too.
const PANEL_RANKS=['docked','floating','hidden'];
const PANEL_KEY='noesar.panel.rank';
let panelRanks={};
let currentPanelView='home';
function readPanelRanks(){
  try{const parsed=JSON.parse(localStorage.getItem(PANEL_KEY)??'{}');return parsed&&typeof parsed==='object'?parsed:{};}catch{return {};}
}
// Floating position, remembered PER DESTINATION like the rank itself. Owner: "float
// doesn't let me move it" — it did float, just to one fixed spot with no way to drag it
// anywhere else. left/top are stored in px, clamped to the viewport at apply time in
// case the window shrank since the position was saved.
const PANEL_POS_KEY='noesar.panel.pos';
let panelPositions={};
function readPanelPositions(){
  try{const parsed=JSON.parse(localStorage.getItem(PANEL_POS_KEY)??'{}');return parsed&&typeof parsed==='object'?parsed:{};}catch{return {};}
}
function clampPanelPosition(panel,left,top){
  const maxLeft=Math.max(8,window.innerWidth-panel.offsetWidth-8);
  const maxTop=Math.max(8,window.innerHeight-panel.offsetHeight-8);
  return {left:Math.min(Math.max(left,8),maxLeft),top:Math.min(Math.max(top,8),maxTop)};
}
function applyPanelPosition(view){
  const panel=$('#contextPanel');if(!panel)return;
  const saved=panelPositions[view];
  if(saved&&Number.isFinite(saved.left)&&Number.isFinite(saved.top)){
    // `inset-block-start`/`inset-inline-end` and `top`/`left` are the same physical
    // properties in this shell's (LTR, horizontal) writing mode — setting both on an
    // inline style means whichever is assigned LAST wins, silently discarding the other.
    // The logical ones must be cleared FIRST, or clearing them after overwrites the
    // pixel position that was just set (found live: top landed at 0, not the dragged
    // value, because the old code cleared insetBlockStart after setting top).
    const {left,top}=clampPanelPosition(panel,saved.left,saved.top);
    panel.style.insetInlineEnd='auto';panel.style.insetBlockStart='auto';
    panel.style.left=`${left}px`;panel.style.top=`${top}px`;
  }else{
    // No saved position for this destination: fall back to the CSS default corner.
    panel.style.left='';panel.style.top='';panel.style.insetInlineEnd='';panel.style.insetBlockStart='';
  }
}
function applyPanelRank(view){
  currentPanelView=view;
  const shell=$('#appShell');if(!shell)return;
  // Owner: the panel should open deactivated and only turn on if clicked — a destination
  // with no remembered choice yet defaults to 'hidden', not 'docked'. Once a choice is
  // made for that destination it is remembered (above), so this fallback only matters the
  // first time a destination is visited.
  const rank=PANEL_RANKS.includes(panelRanks[view])?panelRanks[view]:'hidden';
  shell.dataset.panel=rank;
  const control=$('#panelRank');
  if(control){
    control.setAttribute('aria-expanded',String(rank!=='hidden'));
    const label=$('#panelRankLabel');if(label)label.textContent=`Panel: ${rank}`;
  }
  $$('[data-panel-rank]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.panelRank===rank)));
  const title=$('#contextPanelTitle');
  // The label comes from the nav entry's own label span, not from its whole textContent
  // with the strings it might also carry deleted afterwards: that was a workaround for one
  // literal flag ("not built"), and it would have gone on silently pasting the next one
  // into a panel title. `.nav-count` and `.nav-flag` are the two spans that are not the
  // label, the same distinction the icons-only sidebar rank already makes in CSS.
  if(title){
    const nav=$$('.nav').find((node)=>node.dataset.view===view);
    const label=nav?.querySelector('span:not(.nav-count):not(.nav-flag)')?.textContent?.trim();
    title.setAttribute('translate','no');title.textContent=label?`${t('Context')} · ${label}`:t('Context');
  }
  if(rank==='floating')applyPanelPosition(view);
}
function setPanelRank(rank){
  if(!PANEL_RANKS.includes(rank))return;
  panelRanks={...panelRanks,[currentPanelView]:rank};
  try{localStorage.setItem(PANEL_KEY,JSON.stringify(panelRanks));}catch{}
  applyPanelRank(currentPanelView);
}
function initPanelDrag(){
  const handle=$('#contextPanelTitle');const panel=$('#contextPanel');
  if(!handle||!panel)return;
  let dragging=null;
  handle.addEventListener('pointerdown',(event)=>{
    if($('#appShell')?.dataset.panel!=='floating')return;
    const rect=panel.getBoundingClientRect();
    dragging={startX:event.clientX,startY:event.clientY,startLeft:rect.left,startTop:rect.top};
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove',(event)=>{
    if(!dragging)return;
    const {left,top}=clampPanelPosition(panel,dragging.startLeft+(event.clientX-dragging.startX),dragging.startTop+(event.clientY-dragging.startY));
    panel.style.insetInlineEnd='auto';panel.style.insetBlockStart='auto';
    panel.style.left=`${left}px`;panel.style.top=`${top}px`;
  });
  const stopDrag=(event)=>{
    if(!dragging)return;
    handle.classList.remove('dragging');
    try{handle.releasePointerCapture(event.pointerId);}catch{}
    const rect=panel.getBoundingClientRect();
    panelPositions={...panelPositions,[currentPanelView]:{left:rect.left,top:rect.top}};
    try{localStorage.setItem(PANEL_POS_KEY,JSON.stringify(panelPositions));}catch{}
    dragging=null;
  };
  handle.addEventListener('pointerup',stopDrag);
  handle.addEventListener('pointercancel',stopDrag);
  window.addEventListener('resize',()=>{if($('#appShell')?.dataset.panel==='floating')applyPanelPosition(currentPanelView);});
}
function initContextPanelRank(){
  panelRanks=readPanelRanks();
  panelPositions=readPanelPositions();
  initPanelDrag();
  $$('[data-panel-rank]').forEach((button)=>button.addEventListener('click',()=>setPanelRank(button.dataset.panelRank)));
  $('#panelRank')?.addEventListener('click',()=>{
    const current=$('#appShell')?.dataset.panel??'docked';
    setPanelRank(PANEL_RANKS[(PANEL_RANKS.indexOf(current)+1)%PANEL_RANKS.length]);
  });
  applyPanelRank(viewFromHash());
}
function initSettingsMenu(){
  $$('.settings-nav').forEach((button)=>button.addEventListener('click',()=>activate('settings',{section:button.dataset.section})));
}
function optionList(items,{empty='None',label=(item)=>item.name,value=(item)=>item.id,selected=null}={}){return `<option value="">${escapeHtml(empty)}</option>${items.map((item)=>`<option value="${escapeHtml(value(item))}" ${value(item)===selected?'selected':''}>${escapeHtml(label(item))}</option>`).join('')}`;}
// The server tells us whether a sign-in started on THIS connection can complete. It can: the
// two listeners share one request handler, so the answer is per-connection and cannot be
// guessed from the page alone -- `location.protocol` would be right here only by coincidence,
// and wrong the moment TLS is terminated in front of the product.
function showTransportWarning(status){const box=$('#authTransportWarning');if(!box)return;if(status?.browserSignInPossible===false){box.classList.remove('hidden');const link=$('#authSecureLink');if(link&&status.secureAddress){link.href=status.secureAddress;link.textContent=status.secureAddress;link.classList.remove('hidden');}}else{box.classList.add('hidden');}}
async function initializeAuth(){const status=await api('/api/v1/auth/status');showTransportWarning(status);if(!status.initialized){$('#authTitle').textContent=status.pendingSetup?'Complete Owner setup':'Initialize NOESAR securely';showOnly('#setupForm');return;}try{const me=await api('/api/v1/auth/me');currentUser=me.user;currentPermissions=me.permissions??[];await enterApplication();}catch{showOnly('#loginForm');}}
async function enterApplication(){$('#authGate').classList.add('hidden');$('#userAvatar').textContent=(currentUser?.displayName??currentUser?.username??'U').slice(0,1).toUpperCase();if(currentUser?.role!=='owner'){const bypass=$('[data-mode="OWNER_BYPASS"]');bypass.disabled=true;}
  // The router runs at boot, before the role is known, so every gated route resolved to
  // access-denied on a cold deep link — including for the Owner. Re-apply the nav and
  // re-activate the requested route now that we know who is signed in.
  applyNavAccess();
  goToHash();
  // The approval strip is permanent, so it is filled on sign-in rather than only when the
  // Approvals page is opened — a strip that says nothing until you visit the page it links
  // to cannot do the one job it exists for.
  // Owner modules join the same permanent-strip reasoning: an ACTIVE module must be
  // reachable from the sidebar on sign-in, not only after visiting Settings.
  // GET /api/v1/sector-modules/catalog is workspace.read, open to every account.
  await Promise.all([refreshPrivacy(),refreshHardware(),refreshWorkspace(),loadExtractorCapabilities(),refreshApprovals(),loadOwnerModules(),loadRemoteTargets()]);}
$('#setupForm').addEventListener('submit',async(event)=>{event.preventDefault();authError();try{const result=await api('/api/v1/auth/setup',{method:'POST',headers:{'x-noesar-setup-token':$('#setupToken').value},body:JSON.stringify({username:$('#setupUsername').value,displayName:$('#setupDisplayName').value,password:$('#setupPassword').value})});setupChallenge=result.challenge;$('#setupTotpSecret').textContent=result.totpSecret;renderSetupQr(result.otpauthUri);showOnly('#setupMfaForm');}catch(error){authError(error.message);}});
$('#setupMfaForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/setup/confirm',{method:'POST',body:JSON.stringify({challenge:setupChallenge,totpCode:$('#setupTotpCode').value})});csrfToken=result.csrfToken;currentUser=result.user;currentPermissions=result.permissions??[];showFirstRunRecoveryCodes(result.recoveryCodes);await enterApplication();}catch(error){authError(error.message);}});
$('#loginForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginUsername').value,password:$('#loginPassword').value})});loginChallenge=result.challenge;showOnly('#loginMfaForm');}catch(error){authError(error.message);}});
$('#loginMfaForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/login/mfa',{method:'POST',body:JSON.stringify({challenge:loginChallenge,totpCode:$('#loginTotpCode').value})});csrfToken=result.csrfToken;currentUser=result.user;currentPermissions=result.permissions??[];await enterApplication();}catch(error){authError(error.message);}});
/* Recupero (D-0369). Prima del recupero il prodotto aveva la FORMA di un recupero e nessuna
 * via d ingresso: i codici non li emetteva il setup, e nessuna rotta ne consumava uno. */
/* Il QR mancava nella schermata del setup, e solo li: qrSvg disegnava gia quello del
 * ricambio MFA, e beginSetup restituiva gia otpauthUri. Segnalato dall Owner in corso di
 * installazione. Il segreto in chiaro resta sotto: un dispositivo senza fotocamera esiste. */
function renderSetupQr(otpauthUri){
  const target=$('#setupQr');
  if(!target||!otpauthUri)return;
  // Un riquadro vuoto e indistinguibile da un guasto. Se l URI non entra nell encoder
  // (nomi utente molto lunghi, F4W-005) lo si DICE, e il segreto sotto resta la via.
  try{target.innerHTML=qrSvg(otpauthUri,{title:t('Authenticator setup code')});}
  catch{target.textContent=t('No QR for this username — type the secret below into your app instead.');}
}
let recoveryChallenge=null;
function showFirstRunRecoveryCodes(codes){
  if(!Array.isArray(codes)||!codes.length)return;
  const panel=$('#recoveryCodesPanel');const list=$('#recoveryCodesList');
  if(!panel||!list)return;
  list.textContent=codes.join('  ');
  panel.classList.remove('hidden');
}
$('#recoveryCodesAcknowledge')?.addEventListener('click',()=>{$('#recoveryCodesPanel').classList.add('hidden');});
$('#forgotCredentials')?.addEventListener('click',()=>{authError('');$('#recoveryUsername').value=$('#loginUsername').value;showOnly('#recoveryStartForm');});
$('#recoveryCancel')?.addEventListener('click',()=>{authError('');showOnly('#loginForm');});
$('#recoveryMintProof')?.addEventListener('click',async()=>{
  try{
    const minted=await api('/api/v1/auth/recovery/proof',{method:'POST',body:'{}'});
    // Il percorso e l impronta, mai il gettone: quello vive solo sul disco dell installazione.
    $('#recoveryProofPath').textContent=`${minted.path}  (${minted.fingerprint})`;
  }catch(error){authError(error.message);}
});
$('#recoveryStartForm')?.addEventListener('submit',async(event)=>{
  event.preventDefault();
  try{
    const started=await api('/api/v1/auth/recovery/begin',{method:'POST',body:JSON.stringify({
      username:$('#recoveryUsername').value,
      recoveryCode:$('#recoveryCode').value||undefined,
      proof:$('#recoveryProof').value||undefined,
    })});
    recoveryChallenge=started.challenge;
    const target=$('#recoveryQr');
    if(target){try{target.innerHTML=qrSvg(started.otpauthUri,{title:t('Authenticator setup code')});}catch{target.textContent=t('No QR for this username — type the secret below into your app instead.');}}
    $('#recoveryTotpSecret').textContent=started.totpSecret;
    authError('');showOnly('#recoveryFinishForm');
  }catch(error){authError(error.message);}
});
$('#recoveryFinishForm')?.addEventListener('submit',async(event)=>{
  event.preventDefault();
  try{
    const result=await api('/api/v1/auth/recovery/complete',{method:'POST',body:JSON.stringify({
      challenge:recoveryChallenge,password:$('#recoveryNewPassword').value,totpCode:$('#recoveryTotpCode').value,
    })});
    csrfToken=result.csrfToken;currentUser=result.user;currentPermissions=result.permissions??[];
    showFirstRunRecoveryCodes(result.recoveryCodes);
    await enterApplication();
  }catch(error){authError(error.message);}
});
$('#loginPasskeyButton').addEventListener('click',()=>withBusy($('#loginPasskeyButton'),async()=>{
  try{
    const options=await api('/api/v1/auth/login/passkey/options',{method:'POST',body:JSON.stringify({challenge:loginChallenge})});
    const credential=await navigator.credentials.get({publicKey:{
      challenge:base64urlToBytes(options.challenge),
      rpId:options.rpId,
      userVerification:options.userVerification,
      timeout:options.timeoutMs,
      allowCredentials:(options.allowCredentials??[]).map((entry)=>({type:entry.type,id:base64urlToBytes(entry.id)})),
    }});
    const result=await api('/api/v1/auth/login/passkey',{method:'POST',body:JSON.stringify({
      challenge:options.challenge,
      credentialId:bytesToBase64url(credential.rawId),
      clientDataJSON:bytesToBase64url(credential.response.clientDataJSON),
      authenticatorData:bytesToBase64url(credential.response.authenticatorData),
      signature:bytesToBase64url(credential.response.signature),
    })});
    csrfToken=result.csrfToken;currentUser=result.user;currentPermissions=result.permissions??[];
    await enterApplication();
  }catch(error){authError(error.message==='The operation either timed out or was not allowed.'?'Passkey sign-in was cancelled.':error.message);}
},{busyLabel:'Waiting for passkey…'}));
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/v1/auth/logout',{method:'POST',body:'{}'});}catch{}csrfToken='';currentUser=null;$('#authGate').classList.remove('hidden');showOnly('#loginForm');});
// One entry point for every in-app link, so a link written as "settings/audit" and a link
// written with a name that has since been demoted both land in the same place. In-page
// links were the easiest thing to leave pointing at a page that no longer exists.
function navigate(spec){
  if(!spec)return;
  const raw=String(spec).trim().toLowerCase();
  const [first,second='',third='']=raw.split('/').filter(Boolean);
  const legacy=LEGACY_ROUTES[first];
  if(legacy){const [lv,ls='']=legacy.split('/');activate(lv,{section:ls});return;}
  activate(first,{section:second,place:third});
}
$$('.nav').forEach((button)=>button.addEventListener('click',()=>navigate(button.dataset.view)));$$('[data-view-link]').forEach((button)=>button.addEventListener('click',()=>navigate(button.dataset.viewLink)));$$('[data-start-mode]').forEach((button)=>button.addEventListener('click',()=>{setMode(button.dataset.startMode);activate('chat');}));
function setMode(mode){currentMode=mode;$$('[data-chat-mode]').forEach((button)=>button.classList.toggle('selected',button.dataset.chatMode===mode));}
$$('[data-chat-mode]').forEach((button)=>button.addEventListener('click',()=>setMode(button.dataset.chatMode)));
// The banner asserts a privacy guarantee, so it must never assert one it has not just
// been told. The markup ships with "LOCAL-ONLY VERIFIED" as its initial text, and this
// used to swallow every error with an empty catch — meaning a failed or unreachable
// /api/v1/privacy left that claim on screen looking confirmed. It now says plainly that
// it could not confirm the state, and the amber `.external` styling (which existed in
// the stylesheet but was never applied by anything) is driven from the same answer.
async function refreshPrivacy(){
  // Was a full-width banner on the Home view only; the Owner asked for it as a permanent
  // compact footer line instead, so this now writes #footerPrivacy in the statusbar — same
  // three server-verified fields (headline/detail/state), same element structure
  // (strong/small/.verified), same 'external' class toggle, just relocated.
  const box=$('#footerPrivacy');if(!box)return;
  try{
    const {banner,state:privacyState,disclosures,telemetry}=await api('/api/v1/privacy');
    box.querySelector('strong').textContent=banner.headline;
    box.querySelector('small').textContent=banner.detail;
    box.querySelector('.verified').textContent=privacyState.replaceAll('_',' ');
    // banner.external is the server's own verdict. Comparing the state string here
    // would be a second, silently drifting copy of that rule — and the first attempt
    // at it tested for 'LOCAL_ONLY', a value this server never emits, which would have
    // left the banner permanently amber.
    box.classList.toggle('external',Boolean(banner.external));
    box.classList.toggle('status-good',!banner.external);
    renderPrivacyDisclosures(disclosures??[],telemetry);
    // The runtime chip reports the SAME derived state as the footer, because it is the
    // same claim shown twice. It used to be written from the provider dropdown: the footer
    // read "● Local-only verified" whenever a local model happened to be selected, whatever
    // the server thought — a privacy guarantee asserted by a <select>.
    setPrivacyChips(Boolean(banner.external));
  }catch(error){
    box.classList.add('external');
    box.classList.remove('status-good');
    box.querySelector('strong').textContent='Privacy state could not be confirmed.';
    box.querySelector('small').textContent='The server did not answer the privacy check, so this notice is not reporting a verified state.';
    box.querySelector('.verified').textContent='UNVERIFIED';
    // Same rule for the chips: an unanswered check is not a local-only guarantee.
    setPrivacyChips(false,true);
    renderPrivacyDisclosures([],null);
    if(window.__noesarDebug)console.error(error);
  }
}

function setPrivacyChips(external,unconfirmed=false){
  const runtime=$('#runtimeState');
  if(runtime)runtime.textContent=unconfirmed?'● Privacy state not confirmed':(external?'● External by consent':'● Local-first');
  const egress=$('#egressMetric');
  if(egress){egress.textContent=unconfirmed?'Unknown':(external?'Available by consent':'Blocked');egress.className=external||unconfirmed?'amber':'';}
}

// The eight elements 01_PRODUCT/12 requires, rendered from the server's disclosure record.
// Nothing here is computed locally: a second derivation in the browser is exactly how the
// invariant panel came to display five numbers that matched neither the code nor itself.
function renderPrivacyDisclosures(disclosures,telemetry){
  const panel=$('#privacyDisclosures');if(!panel)return;
  const list=$('#privacyDisclosureList');
  panel.classList.toggle('hidden',disclosures.length===0);
  if(telemetry&&$('#privacyTelemetry'))$('#privacyTelemetry').textContent=`Telemetry: ${telemetry.enabled?'ENABLED':'off'}. ${telemetry.detail??''}`;
  if(!disclosures.length){list.textContent='';return;}
  // The button follows the server's answer for THIS caller. A role that cannot revoke is
  // told so, rather than being shown a button that answers 403.
  const revokeButton=$('#privacyRevoke');
  const canRevoke=disclosures.every((item)=>item.revoke?.available!==false);
  if(revokeButton){
    revokeButton.disabled=!canRevoke;
    revokeButton.title=canRevoke?'':(disclosures[0]?.revoke?.unavailableReason??'');
    revokeButton.textContent=canRevoke?'Revoke all external access':'Revoke requires an administrator';
  }
  list.textContent='';
  for(const item of disclosures){
    const card=document.createElement('article');
    card.className='entity-card privacy-disclosure';
    const rows=[
      ['Destination',item.destination],
      ['Service identity',item.serviceIdentity],
      ['Data categories',(item.dataCategories??[]).join(', ')],
      ['Purpose',item.purpose],
      ['Duration',item.duration],
      ['Retention',`${item.retention?.atDestination??'unknown'} — ${item.retention?.note??''} Local retention: ${item.retention?.localRetentionDays??'unset'} days.`],
      ['Consent scope',`projects: ${Array.isArray(item.consentScope?.projects)?item.consentScope.projects.join(', '):item.consentScope?.projects}; data classes: ${(item.consentScope?.dataClasses??[]).join(', ')}; tool schemas: ${item.consentScope?.toolSchemas?'yes':'no'}; anonymised: ${item.consentScope?.anonymised?'yes':'no'}`],
      ['Revoke',`${item.revoke?.method} ${item.revoke?.path} — ${item.revoke?.effect??''}`],
    ];
    const heading=document.createElement('h3');
    heading.textContent=`${item.destination} · ${item.kind}`;
    card.append(heading);
    for(const [label,value] of rows){
      const row=document.createElement('p');
      const strong=document.createElement('strong');
      strong.textContent=`${label}: `;
      row.append(strong,document.createTextNode(String(value??'—')));
      card.append(row);
    }
    list.append(card);
  }
}
// s333 point 3b. The Owner: «mi sembrano tutte pagine statiche». Measured with
// `tools/measure-page-liveness.mjs`: seven destinations painted REAL data that was fetched
// exactly once, at sign-in, and never looked at again — full of true values and stale from the
// second minute onwards. That is how a page can be alive and read as dead, and it is a worse
// failure than an empty one, because a stale number looks like a current number.
//
// Split so opening a page can ask for fresh data WITHOUT the chat's side effects: dragging
// `selectConversation()` along would mean opening #/projects quietly changed which conversation
// you were in. One fetch, two callers, no second copy of the assignment.
async function refreshWorkspaceData(){const data=await api('/api/v1/ai/bootstrap');for(const key of ['projects','conversations','branches','memories','artifacts','sources','providers','tools','agents','agentRuns','tasks'])state[key]=data[key]??[];state.providerCatalog=data.providerCatalog??[];if(!state.activeProjectId&&state.projects.length)state.activeProjectId=state.projects[0].id;if(state.activeProjectId&&!state.projects.some((item)=>item.id===state.activeProjectId))state.activeProjectId=state.projects[0]?.id??null;renderAll();return data;}
async function refreshWorkspace(){await refreshWorkspaceData();if(!state.activeConversationId){const c=state.conversations.find((item)=>item.projectId===state.activeProjectId)??state.conversations[0];state.activeConversationId=c?.id??null;}renderAll();await loadChatNav();if(state.activeConversationId)await selectConversation(state.activeConversationId,false);}
function renderAll(){renderProjectOptions();renderHome();renderProjects();renderTasks();renderNotes();renderArtifacts();renderSources();renderProviders();renderAgents();updatePrivacyFromProvider();$('#retentionDays').value=state.settings?.retentionDays??365;}
function renderProjectOptions(){for(const id of ['#chatProject','#artifactProject','#sourceProject','#noteProject','#taskProject','#workflowProject']){const select=$(id);if(!select)continue;const selected=id==='#chatProject'?state.activeProjectId:select.value||state.activeProjectId;select.innerHTML=optionList(state.projects,{empty:'No project',selected});}$('#noteConversation').innerHTML=optionList(state.conversations.filter((item)=>!state.activeProjectId||item.projectId===state.activeProjectId),{empty:'Select conversation',label:(item)=>item.title,selected:state.activeConversationId});$('#projectChip').textContent=`Project: ${state.projects.find((item)=>item.id===state.activeProjectId)?.name??'none'}`;const conversations=state.conversations.filter((item)=>!state.activeProjectId||item.projectId===state.activeProjectId);$('#chatConversation').innerHTML=optionList(conversations,{empty:'No conversation',label:(item)=>item.title,selected:state.activeConversationId});}
function renderHome(){$('#homeProjects').innerHTML=state.projects.slice(0,5).map((item)=>`<article><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description||'No description')}</small></div></article>`).join('')||'No projects yet.';$('#homeConversations').innerHTML=state.conversations.slice(-5).reverse().map((item)=>`<article><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.mode)}</small></div></article>`).join('')||'No conversations yet.';}
// §3#9, OWNER_REVIEW_2026-08-21: created a project, no way to remove it. The backend already
// had the whole mechanism (`updateProject` accepts `archived`, `listProjects` already filters
// `!archived`) from the same non-destructive pattern D-0397 gave agents — CLAUDE10 §4 refuses a
// hard delete, and this project's own precedent is Archive, not Destroy. What was missing was
// only the button. Double confirmation, same shape D-0625 already proved for model removal
// (`findByData`/`openRemoveConfirm` below): typing the project's own name is the second act, and
// it is the only thing that arms the button — a second click is muscle memory, typing a name is not.
function renderProjects(){
  $('#projectCount').textContent=state.projects.length;
  $('#projectList').innerHTML=state.projects.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p><small>${escapeHtml(item.tags.join(' · '))}</small><div class="card-actions"><button data-select-project="${escapeHtml(item.id)}">${escapeHtml(t('Use project'))}</button> <button type="button" class="danger" data-delete-project="${escapeHtml(item.id)}">${escapeHtml(t('Delete'))}</button></div><div class="project-delete-confirm" data-delete-project-panel="${escapeHtml(item.id)}" hidden></div></article>`).join('')||t('No projects.');
  $$('[data-select-project]').forEach((button)=>button.addEventListener('click',async()=>{state.activeProjectId=button.dataset.selectProject;state.activeConversationId=null;renderProjectOptions();activate('chat');await refreshWorkspace();}));
}
function openProjectDeleteConfirm(id){
  const project=state.projects.find((item)=>item.id===id);
  const panel=findByData('delete-project-panel',id);
  if(!panel||!project)return;
  panel.hidden=false;
  panel.innerHTML=`<p class="model-advisory" role="note">⚠ ${escapeHtml(t('This removes the project from every list — chats and files already in it are not destroyed, only the record is kept.'))}</p>`
    +`<p>${escapeHtml(t('Second confirmation: type the project name to say which one.'))}</p>`
    +`<p><input type="text" data-delete-project-input="${escapeHtml(id)}" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(t('Type the project name to confirm'))}" placeholder="${escapeHtml(project.name)}"></p>`
    +`<p class="card-actions"><button type="button" class="danger" data-delete-project-commit="${escapeHtml(id)}" disabled>${escapeHtml(t('Delete project'))}</button> `
    +`<button type="button" data-delete-project-cancel="${escapeHtml(id)}">${escapeHtml(t('Cancel'))}</button></p>`;
}
function closeProjectDeleteConfirm(id){
  const panel=findByData('delete-project-panel',id);
  if(panel){panel.hidden=true;panel.innerHTML='';}
}
async function commitProjectDelete(id){
  try{
    await api(`/api/v1/projects/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({archived:true})});
    closeProjectDeleteConfirm(id);
    toast(t('Project deleted.'),{kind:'success'});
    if(state.activeProjectId===id)state.activeProjectId=null;
    await refreshWorkspace();
  }catch(error){
    toast(`${t('This project was not deleted:')} ${error.value?.error??error.message}`,{kind:'error',correlationId:error.correlationId});
  }
}
$('#projectList')?.addEventListener('click',(event)=>{
  const start=event.target?.closest?.('[data-delete-project]')?.dataset?.deleteProject;
  if(start)return openProjectDeleteConfirm(start);
  const commit=event.target?.closest?.('[data-delete-project-commit]')?.dataset?.deleteProjectCommit;
  if(commit)return commitProjectDelete(commit);
  const cancel=event.target?.closest?.('[data-delete-project-cancel]')?.dataset?.deleteProjectCancel;
  if(cancel)return closeProjectDeleteConfirm(cancel);
});
$('#projectList')?.addEventListener('input',(event)=>{
  const id=event.target?.dataset?.deleteProjectInput;
  if(!id)return;
  const project=state.projects.find((item)=>item.id===id);
  const button=findByData('delete-project-commit',id);
  if(button&&project)button.disabled=event.target.value.trim()!==project.name;
});
$('#projectForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const project=await api('/api/v1/projects',{method:'POST',body:JSON.stringify({name:$('#projectName').value,description:$('#projectDescription').value,instructions:$('#projectInstructions').value,tags:$('#projectTags').value.split(',').map((v)=>v.trim()).filter(Boolean),knowledgePolicy:{mode:$('#projectKnowledgeMode').value,limit:Number($('#projectKnowledgeLimit').value),maxCharacters:60000}})});state.activeProjectId=project.id;event.target.reset();await refreshWorkspace();setStatus('Project created.');}catch(error){setStatus(error.message,true);}});
$('#chatProject').addEventListener('change',async(event)=>{state.activeProjectId=event.target.value||null;state.activeConversationId=null;await refreshWorkspace();});
$('#chatConversation').addEventListener('change',async(event)=>selectConversation(event.target.value));
async function selectConversation(id,rerender=true){if(!id){state.activeConversationId=null;$('#messageList').textContent='Create or select a conversation.';return;}state.activeConversationId=id;const detail=await api(`/api/v1/conversations/${encodeURIComponent(id)}`);state.branches=state.branches.filter((item)=>item.conversationId!==id).concat(detail.branches);state.activeBranchId=detail.conversation.activeBranchId;currentMode=detail.conversation.mode;setMode(currentMode);$('#chatBranch').innerHTML=optionList(detail.branches,{empty:'No branch',label:(item)=>item.name,selected:state.activeBranchId});$('#chatProvider').innerHTML=optionList(state.providers,{empty:'Select provider',label:(item)=>`${item.name}${item.external?' · external':' · local'}`,selected:detail.conversation.providerId});$('#chatModel').value=detail.conversation.model??'';if(rerender)renderProjectOptions();
// Point 4b: BEFORE `refreshMessages()`, deliberately — that call can throw, and everything
// after it would then never run. The same ordering, for the same reason, that `loadChatNav()`
// is given in `refreshWorkspace` (`D-0329`); the test asserts the order, not the presence.
await renderChatPlan();
await refreshMessages();}
$('#newConversation').addEventListener('click',async()=>{
  // Owner, 2026-08-21: "se clicco nuova conversazione non la creo e non appare sulla
  // sidebar". Root cause was this line: no project meant a silent `setStatus` — a thin line
  // of text elsewhere on the page, easy to never see — and nothing else happened. A missing
  // project is the ordinary first-run state, not an error to report and stop at: send the
  // person to where a project is made, in the same gesture, instead of naming a problem they
  // then have to go solve themselves through a different button.
  if(!state.activeProjectId){
    if(state.projects.length){state.activeProjectId=state.projects[0].id;renderProjectOptions();}
    else{
      activate('projects');
      setStatus('Create a project first — the form is right here.',true);
      $('#projectName')?.focus();
      return;
    }
  }
  const title=prompt('Conversation title','New conversation');if(!title)return;try{const result=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId,title,mode:currentMode,providerId:$('#chatProvider').value||null,model:$('#chatModel').value||null})});state.activeConversationId=result.conversation.id;state.activeBranchId=result.branch.id;await refreshWorkspace();activate('chat');}catch(error){setStatus(error.message,true);}});
$('#chatBranch').addEventListener('change',async(event)=>{state.activeBranchId=event.target.value;await refreshMessages();});

/* §4#3 reopened, Owner 2026-08-24: the nine actions that used to sit permanently above the
   conversation now live behind this one disclosure. Closing rules are the page's existing ones
   (click outside, Escape) so it behaves like the help popovers rather than inventing a second
   idiom; focus returns to the button on Escape, which is what makes it usable without a mouse. */
function setChatMoreOpen(open){
  const menu=$('#chatMoreMenu');const button=$('#chatMore');
  if(!menu||!button)return;
  menu.classList.toggle('hidden',!open);
  button.setAttribute('aria-expanded',open?'true':'false');
}
$('#chatMore').addEventListener('click',(event)=>{event.stopPropagation();setChatMoreOpen($('#chatMoreMenu').classList.contains('hidden'));});
document.addEventListener('click',(event)=>{if(!event.target.closest?.('.chat-more'))setChatMoreOpen(false);});
document.addEventListener('keydown',(event)=>{
  if(event.key!=='Escape'||$('#chatMoreMenu')?.classList.contains('hidden'))return;
  setChatMoreOpen(false);$('#chatMore').focus();
});

/* Owner, 2026-08-24: «ho detto di mettere qualcosa per pulire intera chat e non è stata fatta».
   It had not been: the only clear that existed was the `/clear` COMMAND, whose declared contract
   is display-only and whose watermark lives in this browser's localStorage — undiscoverable from
   the interface, and invisible on a second device.
   This is the durable one, and it destroys nothing (`ContextGraph.clearConversation`): the thread
   on screen becomes empty because a new empty branch is opened, and every message stays readable
   on the branch it was written on. The confirmation says exactly that instead of the usual "this
   cannot be undone", because here it can — and a warning that lies about severity is how people
   learn to click through warnings. */
$('#clearConversation').addEventListener('click',async()=>{
  setChatMoreOpen(false);
  if(!state.activeConversationId)return setStatus(t('Open a conversation first.'),true);
  if(!confirm(t('Clear this conversation on screen? Nothing is deleted — the messages stay on their branch and you can reopen it from the branch list.')))return;
  try{
    const cleared=await api(`/api/v1/conversations/${state.activeConversationId}/clear`,{method:'POST',body:'{}'});
    state.activeBranchId=cleared.branch.id;
    await refreshWorkspace();
    // The count is what makes the promise checkable by the person: they are told how much was
    // set aside and where, not merely that something happened.
    setStatus(`${t('Conversation cleared.')} ${cleared.keptMessageCount} ${t('messages kept on the previous branch.')}`);
    announceEvent(`Conversation cleared, ${cleared.keptMessageCount} messages kept`);
  }catch(error){setStatus(error.message,true);}
});
// `/clear`'s own catalogue entry (agent-commands.js) declares it: "Clear the transcript on
// screen (the session keeps its state)" — display-only, nothing deleted. Owner-reported: it did
// neither. Every message, including `/clear`'s own line, is persisted on the branch (by design,
// so the command's result "survives refreshMessages() instead of vanishing under it" — see the
// comment above submitChatPrompt) and refreshMessages() renders the full persisted history
// unconditionally, so the screen never actually cleared. Fixed the way the declared contract
// asks for: a per-conversation-per-branch watermark, client-side only (survives a reload via
// localStorage, the same idiom THEME_KEY/SIDEBAR_KEY already use here — never sent to the
// server, never deletes a message), and refreshMessages() hides everything at or before it.
const CHAT_CLEARED_KEY='noesar.chat.clearedBefore';
function readChatClearedMap(){try{const parsed=JSON.parse(localStorage.getItem(CHAT_CLEARED_KEY)??'{}');return parsed&&typeof parsed==='object'?parsed:{};}catch{return {};}}
function chatClearedWatermark(conversationId,branchId){return readChatClearedMap()[`${conversationId}:${branchId}`]??null;}
function setChatClearedWatermark(conversationId,branchId,createdAt){const map=readChatClearedMap();map[`${conversationId}:${branchId}`]=createdAt;try{localStorage.setItem(CHAT_CLEARED_KEY,JSON.stringify(map));}catch{}}
async function refreshMessages(){if(!state.activeConversationId||!state.activeBranchId)return;const data=await api(`/api/v1/conversations/${state.activeConversationId}/messages?branchId=${state.activeBranchId}`);const watermark=chatClearedWatermark(state.activeConversationId,state.activeBranchId);const visible=watermark?data.messages.filter((message)=>message.createdAt>watermark):data.messages;renderMessages(visible);await inspectContext();}
function renderMessages(messages){$('#messageList').classList.remove('empty-state');$('#messageList').innerHTML=messages.map((message)=>`<article class="message ${escapeHtml(message.role)}" data-message-id="${message.id}"><div class="message-head"><b>${escapeHtml(message.role)}</b><small>${instantHtml(message.createdAt)}</small></div><div class="message-body">${escapeHtml(message.content).replaceAll('\n','<br>')}</div>${message.citations?.length?`<div class="citations">${message.citations.map((c)=>`Source ${escapeHtml(c.sourceId)} · ${escapeHtml(c.evidenceStatus??(c.verified?'retrieved':'attached'))} · claim ${escapeHtml(c.claimStatus??'unverified')}`).join('<br>')}</div>`:''}<div class="message-actions"><button data-edit-message="${message.id}">Edit</button><button data-fork-message="${message.id}">Fork here</button><button data-exclude-message="${message.id}">Remove from context</button>${message.role==='assistant'?`<button data-retry-message="${message.id}">Retry</button>`:''}</div></article>`).join('')||'<div class="empty-state">No messages.</div>';$('#messageList').scrollTop=$('#messageList').scrollHeight;bindMessageActions(messages);renderChatSources(messages);}
/**
 * Every source this conversation has cited, gathered where it stays put.
 *
 * The citations were already on the messages and already rendered under each one — which
 * means that once a conversation is twenty turns long, what the research turned up has
 * scrolled away. This is the Owner's point 4b («a chat that unites work and research») in
 * the half that needs nothing invented: same records, same wording, gathered into the
 * column that does not scroll.
 *
 * Deduplicated by source, because the same source cited in four turns is one source and a
 * list counting it four times would overstate how much was consulted. The turn count is
 * kept and shown, so the collapsing loses nothing.
 *
 * The wording is NOT re-derived: `evidenceStatus` and `claimStatus` print exactly as the
 * message carries them, with the same `verified ? retrieved : attached` fallback the
 * per-message line uses. A second phrasing of one fact is how two parts of a product start
 * disagreeing about what "verified" means.
 */
function chatSourceRollup(messages){
  const bySource=new Map();
  for(const message of messages??[]){
    for(const citation of message.citations??[]){
      const id=citation.sourceId??'—';
      const evidence=citation.evidenceStatus??(citation.verified?'retrieved':'attached');
      const claim=citation.claimStatus??'unverified';
      const seen=bySource.get(id);
      if(seen){seen.turns+=1;if(!seen.evidence.includes(evidence))seen.evidence.push(evidence);if(!seen.claim.includes(claim))seen.claim.push(claim);}
      else bySource.set(id,{id,turns:1,evidence:[evidence],claim:[claim]});
    }
  }
  return [...bySource.values()];
}
function renderChatSources(messages){
  const host=$('#chatSources');
  if(!host)return;
  const sources=chatSourceRollup(messages);
  $('#chatSourceCount').textContent=sources.length?String(sources.length):'';
  if(!sources.length){
    // Declared, not blank: "nothing has been cited" and "this panel is broken" must not look
    // the same, which is the posture the rest of this product already takes.
    host.innerHTML='<p class="declared-empty">No source has been cited in this chat yet.</p>';
    return;
  }
  host.innerHTML=sources.map((source)=>`<div class="work-source">
    <span class="work-source-id">${escapeHtml(source.id)}</span>
    <small>${escapeHtml(source.evidence.join(' · '))} · claim ${escapeHtml(source.claim.join(' · '))}${source.turns>1?` · cited in ${source.turns} turns`:''}</small>
  </div>`).join('');
}
/**
 * The work this chat owns — point 4b, second half, after the Owner settled the relation on
 * 2026-08-06: THE CHAT OWNS THE RUN.
 *
 * Asked of the engine, never assembled here. The browser sends a conversation id and renders
 * what comes back; it does not decide that the run it just created is "probably" this chat's,
 * which is the guess the panel refused to make while the relation did not exist. A chat with
 * no runs says so, and says it differently from a chat whose runs could not be fetched — those
 * are two different facts and looked identical in every earlier version of this panel.
 */
async function renderChatPlan(){
  const host=$('#chatPlan');
  if(!host)return;
  const count=$('#chatPlanCount');
  if(!state.activeConversationId){
    if(count)count.textContent='';
    host.innerHTML='<p class="declared-empty">No conversation is open.</p>';
    return;
  }
  let listing;
  try{
    listing=await api(`/api/v1/workspace-actions/runs?conversationId=${encodeURIComponent(state.activeConversationId)}`);
  }catch(error){
    if(count)count.textContent='';
    // Not an empty state. "This chat has no work" and "the product could not tell me" must not
    // render the same, or a broken route reads as a quiet chat forever.
    host.innerHTML=`<p class="declared-empty">The work for this chat could not be read: ${escapeHtml(error.value?.reason??error.message)}</p>`;
    return;
  }
  const runs=listing.runs??[];
  if(count)count.textContent=runs.length?String(runs.length):'';
  if(!runs.length){
    host.innerHTML='<p class="declared-empty">No work has been started from this chat yet.</p>';
    return;
  }
  host.innerHTML=workRunRows(listing);
}
/**
 * One rendering of a run list, used by both places that show one — the chat's Work column and
 * the unattached group under Plan. Two functions drawing the same object is the divergence this
 * project has already paid for twice (`PANEL_NAMES` 14 against 25, `D-0300`; the sessions list
 * nearly rebuilt in the sidebar, `D-0329`), so the second caller reuses this rather than its
 * own loop.
 */
function workRunRows(listing){
  return (listing.runs??[]).map((run)=>`<div class="work-run" data-run-id="${escapeHtml(run.runId)}">
    <span class="work-run-status">${escapeHtml(run.status)}</span>
    <span class="work-run-goal">${escapeHtml(run.request??'(no goal recorded)')}</span>
    <small>${run.fileCount} file${run.fileCount===1?'':'s'}${run.filePaths.length?` · ${escapeHtml(run.filePaths.slice(0,3).join(' · '))}${run.filePaths.length>3?` and ${run.filePaths.length-3} more`:''}`:''}${run.risk?` · risk ${escapeHtml(run.risk)}`:''}</small>
  </div>`).join('')
    // The engine declares that runs do not survive a restart; the panel repeats it rather than
    // presenting a list that looks like history. Removing the declaration would not make the
    // runs durable, only the loss silent.
    +(listing.persistence?.durable===false?`<p class="hint">${escapeHtml(listing.persistence.reason)} — this list is not history.</p>`:'');
}
/**
 * The runs no chat owns — every run started from the terminal, and any started from the Plan
 * form without attaching one. Point 4b: visible and labelled, never shown beside a conversation
 * that did not open them.
 */
async function renderUnattachedRuns(){
  const host=$('#unattachedRuns');
  if(!host)return;
  const count=$('#unattachedRunCount');
  let listing;
  try{
    listing=await api('/api/v1/workspace-actions/runs?scope=unattached');
  }catch(error){
    if(count)count.textContent='';
    host.innerHTML=`<p class="declared-empty">These runs could not be read: ${escapeHtml(error.value?.reason??error.message)}</p>`;
    return;
  }
  const runs=listing.runs??[];
  if(count)count.textContent=runs.length?String(runs.length):'';
  host.innerHTML=runs.length
    ?workRunRows(listing)
    :'<p class="declared-empty">Every run in this session belongs to a chat. Runs started from the terminal appear here.</p>';
}
function bindMessageActions(messages){$$('[data-edit-message]').forEach((button)=>button.addEventListener('click',async()=>{const message=messages.find((item)=>item.id===button.dataset.editMessage);const content=prompt('Edit message',message.content);if(content===null)return;await api(`/api/v1/messages/${message.id}`,{method:'PATCH',body:JSON.stringify({branchId:state.activeBranchId,content})});await refreshMessages();}));$$('[data-fork-message]').forEach((button)=>button.addEventListener('click',()=>forkAt(button.dataset.forkMessage)));$$('[data-exclude-message]').forEach((button)=>button.addEventListener('click',async()=>{await api(`/api/v1/messages/${button.dataset.excludeMessage}/exclude`,{method:'POST',body:JSON.stringify({branchId:state.activeBranchId,excluded:true})});await refreshMessages();}));$$('[data-retry-message]').forEach((button)=>button.addEventListener('click',async()=>{const index=messages.findIndex((item)=>item.id===button.dataset.retryMessage);const previous=[...messages.slice(0,index)].reverse().find((item)=>item.role==='user');if(previous){$('#chatInput').value=previous.content;await sendChat();}}));}
async function forkAt(messageId){const name=prompt('Branch name','alternative');if(!name)return;const branch=await api(`/api/v1/conversations/${state.activeConversationId}/fork`,{method:'POST',body:JSON.stringify({fromMessageId:messageId,name})});state.activeBranchId=branch.id;await selectConversation(state.activeConversationId);}
$('#forkBranch').addEventListener('click',async()=>{const data=await api(`/api/v1/conversations/${state.activeConversationId}/messages?branchId=${state.activeBranchId}`);const head=data.messages.at(-1);if(head)await forkAt(head.id);});
$('#undoHead').addEventListener('click',async()=>{if(!state.activeBranchId)return;await api(`/api/v1/branches/${state.activeBranchId}/undo`,{method:'POST',body:'{}'});await refreshMessages();});
$('#compareBranches').addEventListener('click',async()=>{const detail=await api(`/api/v1/conversations/${state.activeConversationId}`);if(detail.branches.length<2)return setStatus('Create a second branch first.',true);const other=detail.branches.find((item)=>item.id!==state.activeBranchId);const result=await api(`/api/v1/conversations/${state.activeConversationId}/compare?left=${state.activeBranchId}&right=${other.id}`);$('#contextInspector').textContent=JSON.stringify(result,null,2);});
$('#mergeBranch').addEventListener('click',async()=>{const detail=await api(`/api/v1/conversations/${state.activeConversationId}`);const other=detail.branches.find((item)=>item.id!==state.activeBranchId);if(!other)return setStatus('No branch available to merge.',true);await api(`/api/v1/conversations/${state.activeConversationId}/merge`,{method:'POST',body:JSON.stringify({sourceBranchId:other.id,targetBranchId:state.activeBranchId,note:`Merged branch ${other.name}`})});await refreshMessages();});
async function inspectContext(){if(!state.activeConversationId)return;const data=await api(`/api/v1/conversations/${state.activeConversationId}/context?branchId=${state.activeBranchId}`);$('#tokenEstimate').textContent=`≈ ${data.tokenEstimate} tokens`;$('#chatContextSummary').textContent=`${data.messages.length} messages · ${data.memories.length} memories · ${data.sources.length} sources · ${data.tools.length} tools`;$('#contextInspector').textContent=JSON.stringify({mode:data.conversation.mode,providerId:data.providerId,model:data.model,project:data.project?.name,included:data.included,tokenEstimate:data.tokenEstimate},null,2);}
$('#inspectContext').addEventListener('click',inspectContext);
// Point 4b: the one gesture that creates the link. It carries the chat to the Plan form that
// already exists rather than growing a second plan form inside the chat — two forms for one
// object is what `D-0300` cost this project, and the Owner's own point 2 is about there being
// fewer surfaces, not more.
$('#startWorkFromChat')?.addEventListener('click',()=>{
  if(!state.activeConversationId)return toast('Open a chat first.',{kind:'error'});
  const conversation=state.conversations.find((item)=>item.id===state.activeConversationId);
  chatWorkAttachment={id:state.activeConversationId,title:conversation?.title??state.activeConversationId};
  renderPlanAttachment();
  jumpTo('coden/agent/plan');
});
/**
 * One chat turn. Returns the assistant's text so a caller with its own plans for it does not
 * have to scrape it back out of the DOM.
 *
 * `signal` is the turn's own. It reaches the `fetch` AND, on abort, the server-side run: a
 * stream the browser stopped reading is not a run the model stopped producing, and leaving it
 * going would burn a GPU on an answer nobody will ever read.
 */
/**
 * Show that a tool is running, and then how it ended.
 *
 * Built with `textContent`, never with markup interpolation: the name comes from a tool record and
 * the detail from a provider's own answer, and neither is this page's text to trust.
 *
 * The state is carried by a word, not only by a colour or a glyph — "running", "done", "refused"
 * are readable to a screen reader and to someone who cannot distinguish the two icons.
 */
function renderToolActivity(article,data){
  if(!article)return null;
  let list=article.querySelector('.tool-activity');
  if(!list){
    list=document.createElement('ul');
    list.className='tool-activity';
    // `status`, not `alert`: a tool running is progress, and an assertive live region would
    // interrupt whatever the person is reading to say so.
    list.setAttribute('role','status');
    article.querySelector('.message-body').before(list);
  }
  const row=document.createElement('li');
  row.className='tool-activity-row running';
  const icon=document.createElement('span');icon.className='tool-activity-icon';icon.setAttribute('aria-hidden','true');icon.textContent='⟳';
  const name=document.createElement('span');name.className='tool-activity-name';name.textContent=data.name??t('unnamed tool');
  const state=document.createElement('span');state.className='tool-activity-state';state.textContent=t('running');
  row.append(icon,name,state);
  list.append(row);
  return row;
}

function resolveToolActivity(row,data){
  if(!row)return;
  row.classList.remove('running');
  row.classList.add(data.ok?'ok':'failed');
  row.querySelector('.tool-activity-icon').textContent=data.ok?'✓':'✗';
  // The reason travels with the failure. "Refused" on its own sends a person looking for a fault
  // that is not there — out-of-scope is the scope working, and a malformed call is the model's.
  row.querySelector('.tool-activity-state').textContent=data.ok?t('done'):`${t('not run')} — ${data.detail??t('failed')}`;
}

async function sendChat({signal=null,onDelta=null}={}){
  if(!state.activeConversationId){setStatus('Create a conversation first.',true);return '';}
  const content=$('#chatInput').value.trim();
  if(!content)return '';
  const providerId=$('#chatProvider').value||null;
  $('#chatInput').value='';
  $('#stopGeneration').classList.remove('hidden');
  $('#sendMessage').disabled=true;
  let assistantText='';
  let article=null;
  let agentCreatedName=null;
  let toolRow=null;
  try{
    const response=await fetch('/api/v1/chat/stream',{
      method:'POST',
      credentials:'same-origin',
      signal,
      headers:{'content-type':'application/json','x-noesar-csrf':csrfToken},
      body:JSON.stringify({
        conversationId:state.activeConversationId,
        branchId:state.activeBranchId,
        content,
        providerId,
        model:$('#chatModel').value.trim(),
        mode:currentMode
      })
    });
    if(!response.ok){
      const value=await response.json();
      throw new Error(value.error??'Chat request failed');
    }
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let buffer='';
    while(true){
      const{value,done}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
      let index;
      while((index=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,index);
        buffer=buffer.slice(index+2);
        const event=frame.match(/^event:\s*(.+)$/m)?.[1];
        const dataLine=frame.match(/^data:\s*(.+)$/m)?.[1];
        if(!dataLine)continue;
        const data=JSON.parse(dataLine);
        if(event==='run'){
          activeRunId=data.runId;
          await refreshMessages();
          article=document.createElement('article');
          article.className='message assistant streaming';
          article.innerHTML='<div class="message-head"><b>assistant</b><small>streaming</small></div><div class="message-body"></div>';
          $('#messageList').append(article);
        }else if(event==='delta'){
          assistantText+=data.text;
          // A caller that wants the answer as it is written passes `onDelta` and gets each
          // fragment as it lands. The ordinary path leaves it null and the reply still settles
          // once, in one place, exactly as UI-043 requires.
          if(onDelta)onDelta(data.text);
          // UI-043: deliberately NOT announced. A live region fed per delta reads the
          // whole answer aloud as it arrives and again when it settles.
          if(article)article.querySelector('.message-body').textContent=assistantText;
        }else if(event==='tool-call'){
          // A tool running is one of the operational states §76 requires be visible: without this
          // the page shows a stalled stream for as long as the tool takes, which reads as a hang.
          // The row is created here and RESOLVED by the matching `tool-result`, so a tool that
          // never answers still leaves a visible "running" rather than nothing at all.
          toolRow=renderToolActivity(article,data);
        }else if(event==='tool-result'){
          // Resolved in place, and deliberately NOT announced from here. UI-043 forbids the
          // streaming branch from announcing, and its own test caught this line: announcing
          // per-event is how the answer gets read aloud twice. The row lives in a `role="status"`
          // region, which is the mechanism that speaks a change without a second announcer.
          resolveToolActivity(toolRow,data);
        }else if(event==='error'){
          throw new Error(data.error);
        }else if(event==='stopped'){
          setStatus('Generation stopped.');
          announceEvent('Generation stopped');
        }else if(event==='complete'&&data.agentCreated){
          // §4#9 (D-0648): the model itself asked to create an agent, and the server already
          // did it — refreshWorkspace() below picks up the new row via renderAgents(); this
          // is only the confirmation a person would otherwise have gotten from the form.
          agentCreatedName=data.agentCreated.name;
        }
      }
    }
    await refreshWorkspace();
    setStatus(agentCreatedName?`Created the agent "${agentCreatedName}".`:'Response completed.');
    // One summary, once, when the event is over.
    announceEvent(`Reply complete, ${assistantText.length} characters`);
    // …and the reply itself, if the person asked for it. Here for the same reason the live
    // region is here: once, when the answer has settled. Reading per delta would read it twice.
    //
    return assistantText;
  }catch(error){
    if(error?.name==='AbortError'){
      // The person cut in. Stop the RUN as well, best effort and unsignalled — the whole point
      // is that this request survives the abort that caused it.
      const abandoned=activeRunId;
      if(abandoned)void api(`/api/v1/chat/runs/${abandoned}/stop`,{method:'POST',body:'{}'}).catch(()=>{});
      throw error;
    }
    setStatus(error.message,true);
    return assistantText;
  }finally{
    activeRunId=null;
    $('#stopGeneration').classList.add('hidden');
    $('#sendMessage').disabled=false;
  }
}
$('#sendMessage').addEventListener('click',()=>submitComposer());$('#stopGeneration').addEventListener('click',async()=>{if(activeRunId)await api(`/api/v1/chat/runs/${activeRunId}/stop`,{method:'POST',body:'{}'});});

// The slash commands, in the composer — the same gesture as the terminal shell, off the same
// list (`agent-commands.js`, imported by both). This is NOT the address box in the top bar:
// that is navigation, an application's Ctrl-K. This one is a command to the session, typed
// where you type the message, the way Codex and Claude Code work. Both exist; they are
// different gestures at different places, and running them off one registry is what keeps the
// two shells from drifting into two vocabularies.
let commandMenuIndex=0;
function commandMenuState(){
  const typed=$('#chatInput')?.value??'';
  const parsed=parseCommandPrompt(typed);
  // `menuEntriesFor`, not `codenOffered()`: the menu offers only what RUNS (Owner, 2026-08-26
  // — see the comment on `menuEntriesFor`), while `codenOffered()` stays the wider list that
  // `resolveCommand` is given, so an address typed in full still works. Routed through the
  // shared function rather than filtered here, so this shell and CodeN's cannot drift into two
  // answers about what a `/` menu contains — the divergence this pair keeps rediscovering.
  return parsed?{parsed,hits:matchCommands(parsed.word,menuEntriesFor(parsed.word,codenMenu().entries,[]))}:null;
}
function renderCommandMenu(){
  const box=$('#chatCommands');if(!box)return;
  const menu=commandMenuState();
  if(!menu){box.classList.add('hidden');box.innerHTML='';return;}
  if(commandMenuIndex>=menu.hits.length)commandMenuIndex=0;
  box.classList.remove('hidden');
  box.innerHTML=menu.hits.length
    // The name carries `translate="no"`: `/plan` is the token the parser reads, so a dictionary
    // that reached it would print an instruction to type a word the product does not accept. The
    // summary beside it IS prose and is translated — by the observer, from the one catalogue.
    ?menu.hits.map((command,index)=>`<button type="button" data-command="${escapeHtml(command.name)}" class="${index===commandMenuIndex?'active':''}"><b translate="no">/${escapeHtml(command.name)}</b><span>${escapeHtml(command.summary)}</span><small>${escapeHtml(command.argument)}</small></button>`).join('')
    :'<p>No command matches that.</p>';
  // Bound within the menu, not through a page-wide selector: a second container rendering the
  // same markup would otherwise double-bind and fire each click twice.
  box.querySelectorAll('[data-command]').forEach((button)=>button.addEventListener('click',()=>runOrCompleteCommand(button.dataset.command)));
  // Owner-reported: arrow-key navigation moved `commandMenuIndex` but never brought the newly
  // active row into view, so a list taller than the box required the scrollbar by hand. The
  // sibling menu (`setPaletteActive`, global search) already does this; this one never did.
  box.querySelector('.active')?.scrollIntoView({block:'nearest'});
}
function completeCommand(name){
  const command=AGENT_COMMANDS.find((entry)=>entry.name===name);
  if(!command)return;
  // Completes into the composer WITHOUT sending. Choosing and committing stay two acts, so a
  // click never becomes an action nobody meant to take.
  $('#chatInput').value=`/${command.name}${command.argument?' ':''}`;
  $('#chatInput').focus();
  renderCommandMenu();
}
// Owner-reported (2026-08-26): the two-act split above ("choosing and committing stay two
// acts") reads correctly for a command like `/plan <goal>` — clicking it has nowhere to put
// the goal but the composer — but for a command that takes no REQUIRED argument, the split
// bought nothing except a second, easy-to-forget Invio: choosing `/status` from the menu is
// already the whole decision. Split the two cases on the same field the menu already prints
// (`argument`, e.g. `<goal>` vs `[id]` vs `''`): a leading `<` marks a required argument
// nobody can supply by picking a row, so those still only complete; everything else — no
// argument, or an optional one this account can leave off (`/model`, `/status`, `/help`…) —
// runs the moment it is chosen, by a click OR by Enter on the highlighted row.
function runOrCompleteCommand(name){
  const command=AGENT_COMMANDS.find((entry)=>entry.name===name);
  if(!command)return;
  if(command.argument.startsWith('<'))return completeCommand(name);
  $('#chatCommands')?.classList.add('hidden');
  $('#chatInput').value='';
  void submitChatPrompt(`/${command.name}`);
}
$('#chatInput').addEventListener('input',()=>{commandMenuIndex=0;renderCommandMenu();});
// The composer has two ways to submit — Enter and the ➔ button — and only Enter used to
// route a `/` line through submitChatPrompt(); the button always called sendChat(), so
// clicking a command straight out of the menu (fill, then click Send instead of pressing
// Enter) sent it as ordinary prose. One shared function so both paths agree, the same fix
// already applied once for Enter alone.
function submitComposer(){
  $('#chatCommands')?.classList.add('hidden');
  const typed=$('#chatInput').value.trim();
  if(typed.startsWith('/')){$('#chatInput').value='';void submitChatPrompt(typed);}
  else sendChat();
}
$('#chatInput').addEventListener('keydown',(event)=>{
  const menu=commandMenuState();
  if(menu&&menu.hits.length){
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      commandMenuIndex=(commandMenuIndex+(event.key==='ArrowDown'?1:-1)+menu.hits.length)%menu.hits.length;
      return renderCommandMenu();
    }
    if(event.key==='Tab'){event.preventDefault();return completeCommand(menu.hits[commandMenuIndex].name);}
    if(event.key==='Escape'){event.preventDefault();$('#chatCommands')?.classList.add('hidden');return undefined;}
    // Owner-reported (2026-08-26): typing a prefix (`/m`) and pressing Enter — instead of
    // Tab or a click — reached submitComposer() with the raw prefix, which is not an exact
    // command name, so it always failed as `unknown`. Enter never looked at the highlighted
    // row the menu was already showing. Same completion Tab already does, only skipped when
    // what's typed is ALREADY an exact name — typing the full word and pressing Enter must
    // still run it immediately, not complete it into itself and wait for a second Enter.
    if(event.key==='Enter'&&!event.shiftKey&&!menu.hits.some((c)=>c.name===menu.parsed.word)){
      event.preventDefault();return runOrCompleteCommand(menu.hits[commandMenuIndex].name);
    }
  }
  if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();return submitComposer();}
  return undefined;
});
/**
 * A `/` line typed into the chat composer, run the same way CodeN's own prompt
 * runs one — `planTurn` off the same registry, `codenCall` for the transport — because a
 * second command engine for this shell is the exact duplication `16` §4b.2 exists to prevent.
 * Chat has no local transcript to write into (CodeN's `codenView` is a client-side scratch
 * pad); a command's line and its result are therefore persisted as real messages on the
 * active branch — a `tool`-role message, never claimed as something the model said — so they
 * survive the next `refreshMessages()` instead of vanishing under it.
 */
async function submitChatPrompt(typed){
  if(!state.activeConversationId){setStatus('Create a conversation first.',true);return;}
  const branchId=state.activeBranchId;
  const record=(role,content)=>api(`/api/v1/conversations/${state.activeConversationId}/messages`,{method:'POST',body:JSON.stringify({branchId,role,content})});
  const userMessage=await record('user',typed);
  const offered=codenOffered();
  const turn=planTurn(typed,{resolve:(text)=>resolveCommand(text,offered),parse:parseCommandPrompt,commands:offered,groups:groupMenu});
  if(turn.kind==='help'){await record('tool',turn.lines.join('\n'));return refreshMessages();}
  // The `/clear` line itself is the watermark: everything up to and including it is hidden,
  // nothing is deleted (see the comment above CHAT_CLEARED_KEY).
  if(turn.kind==='clear'){setChatClearedWatermark(state.activeConversationId,branchId,userMessage.createdAt);return refreshMessages();}
  if(turn.kind==='unknown'||turn.kind==='confirm'||turn.kind==='needs-argument'){await record('tool',turn.message);return refreshMessages();}
  if(turn.kind==='form'){await record('tool',`→ /${turn.command}. Opening the panel that runs it.`);await refreshMessages();jumpTo(turn.address);return undefined;}
  if(turn.kind==='session'){await record('tool','Ending the session…');await refreshMessages();return $('#logoutButton')?.click();}
  if(turn.kind==='navigate'){await record('tool',turn.because?`→ /${turn.command}. ${turn.because}`:`→ /${turn.command}`);await refreshMessages();jumpTo(turn.address);return undefined;}
  if(turn.kind!=='call')return refreshMessages();
  try{
    const result=await codenCall(turn.method,turn.params);
    const shown=callResult(turn.command,result);
    await record('tool',shown.lines?.length?`${shown.headline}\n${shown.lines.join('\n')}`:shown.headline);
  }catch(error){
    await record('tool',`/${turn.command} refused: ${error.value?.error?.reason??error.value?.error??error.message}`);
  }
  return refreshMessages();
}
// --- the agent shell, in the browser · phase 3a -------------------------------------------
//
// `16` §4b.2: the canonical form is the terminal's, and this renders it. Four regions — the
// `.coden-bar` chips (status), the transcript, the prompt, and the `/` menu — driven by the
// SAME `coden-view-model.js` the terminal drives. Not a second implementation that agrees:
// `planTurn` decides what a typed line means, in one file, and each shell only performs it.
//
// The bench below is untouched. Phase 3a is form, and form is reversible; 3b gives the
// seventeen CodeN addresses that have no terminal view a method and a view, and 3c removes
// the bench. Removing before the replacement is proven is the mistake rule 4 of the skill
// names, and it has already cost this project a phase.
const codenView=createView();
// `OPENING_NOTE` ("CodeN Evolution — attached to the live session...") is the right first line
// for a shell that IS the session — the terminal above now is that shell, and opens on the
// same words. Repeated verbatim in the box below it, a screenshot of the real page showed the
// two reading as one product rendered twice (Owner report, 2026-08-13) — this box's actual job
// is narrower: the command line that reaches the seventeen bench panels the terminal does not
// yet cover (`CE-034`, phase 3b). Overridden after construction, not inside `createView` — that
// factory's default is still correct for every OTHER caller, and `coden-view-model.test.mjs`
// pins IT, not this one call site. Keeps the literal words "CodeN Evolution" so the page-level
// check that the transcript opened with a real note and not silence still holds.
codenView.transcript = [{ kind: 'note', text:
  'CodeN Evolution — bench command line, same session as the terminal above. Type / to jump to a panel below.' }];
let codenMenuIndex=0;
// D-0456: whether `codenTerminalState` owes `#codenShell` a hide it deferred because the
// person was busy with it. Declared here, not beside `codenTerminalState` itself further
// down — `D-0416`'s guard: a module-level `let` after `initRouter()` starts is in the
// temporal dead zone for any boot call that reaches it, and the router's own activation path
// can reach `codenTerminalState` on the first tick.
let legacyHidePending=false;
// What this account may use — the same `menuFor` the terminal calls, on the same list, with
// the permission set the server reported for this session. Rebuilt on demand rather than
// cached at load: `currentPermissions` is filled during sign-in, and a menu built before that
// would be the unfiltered one for the rest of the session.
function codenMenu(){return menuFor(accountFromUser(currentUser&&{...currentUser,permissions:currentPermissions}));}
// Phase 3c · what `/` offers: the commands, plus the address space. `16` §4b.4 rule 1 — "una
// casella, tutto il prodotto" — and the reason the top box can be removed at all: it was the
// only gesture in this shell that opened the twenty-five CodeN panels. Measured before this
// existed: 0 of 25 resolved at either prompt.
//
// `addressBook()` reads the markup's own attributes and `addressEntries` shapes them, so this
// page writes no list of its own — the same rule that killed `PANEL_NAMES`. The terminal folds
// in the list it is SERVED, derived from this same markup, so the two prompts offer one set.
function codenOffered(){return [...codenMenu().entries,...addressEntries(addressBook())];}
// F-INTENT-001: exposed so an e2e check can hand `resolveUtterance` the SAME list this page
// hands it, instead of reassembling one by hand — a reassembled list drifted from this one
// (the address book was missing from it) and the check condemned the resolver for a gap that
// was actually in the check's own input. No new capability: every entry here is already in
// the accessible DOM, and the server enforces permissions regardless of what this offers.
window.__noesarCodenOffered=codenOffered;
// `sessions.list` and `coden.gitStatus` are `bridged:false` — this page reaches them through
// routes of its own, which is an exposure decision the policy table records, not a weaker
// gate (`GET /api/v1/sessions` asks the same `workspace.read`). Routing them here is what
// keeps `/sessions` and `/git` meaning the same thing in both shells instead of one shell
// answering UNKNOWN_METHOD; leaving them to the bridge would have made the parity claim false
// for two of the fourteen work commands.
// D-0590, CE-020: four more, for the same reason and by the same rule. Each of the six
// capabilities that gained a keyboard form is `bridged:false`, so without a route here the
// browser would answer UNKNOWN_METHOD to a command the terminal performs — the asymmetry this
// table exists to refuse. Every route below already existed and already asks the SAME permission
// the socket asks (`workspace.read`, `workspace.write`, `coden.plan`): nothing was widened to
// close CE-020, which is the only acceptable way to close it.
const CODEN_UNBRIDGED={
  'sessions.list':(params)=>api(`/api/v1/sessions?place=${encodeURIComponent(params?.filter||'active')}`),
  'coden.gitStatus':()=>api('/api/v1/coden/git-status'),
  'workspace.runs':(params)=>api(`/api/v1/workspace-actions/runs?scope=${encodeURIComponent(params?.scope||'all')}`),
  // `GET /api/v1/conversations/:id` is the same `contextGraph.getConversation` the socket's
  // `sessions.get` calls, gated on the same `workspace.read`. A session and a conversation are
  // one object under two names here; the route kept the older word.
  'sessions.get':(params)=>api(`/api/v1/conversations/${encodeURIComponent(params?.id||'')}`),
  'sessions.action':(params)=>api('/api/v1/sessions/actions',{method:'POST',body:JSON.stringify({action:params?.action,ids:params?.ids??[]})}),
  'coden.divergence':(params)=>api('/api/v1/coden/divergence',{method:'POST',body:JSON.stringify({paths:params?.paths??[]})}),
};
async function codenCall(method,params){
  const direct=CODEN_UNBRIDGED[method];
  if(direct)return direct(params);
  const response=await api('/api/v1/tui/command',{method:'POST',body:JSON.stringify({method,params})});
  return response.result;
}
function renderCodenTranscript(){
  const box=$('#codenTranscript');if(!box)return;
  const glyph={user:'›',agent:'⏺',tool:'⎿',error:'✕',note:'·'};
  box.innerHTML=codenView.transcript.map((entry)=>{
    const detail=(entry.detail??[]).length
      ?`<pre>${escapeHtml(entry.detail.join('\n'))}</pre>`:'';
    // The glyph is `aria-hidden` and the kind is carried as a word in the class AND as the
    // element's own label: `07_INTERFACCIA.md` §6 — colour is never the only signal, and a
    // screen reader must not be read a bullet character in place of "error".
    return `<div class="t-entry t-${entry.kind}"><span class="t-glyph" aria-hidden="true">${glyph[entry.kind]??'⏺'}</span><div><p>${escapeHtml(entry.text??'')}</p>${detail}</div></div>`;
  }).join('');
  box.scrollTop=box.scrollHeight;
}
// What the menu SHOWS for what is typed — one call, the same one the terminal makes, on the
// same two lists. Nothing about levels, scoping or filtering is decided in this file.
function codenFrame(parsed){return menuFrame(parsed,{commands:codenMenu().entries,addresses:addressBook()});}
// POINT 2a, THE FUNCTIONAL HALF — the status line says what the NEXT key does, and it changes
// with the context. `promptKeys` is shared with the terminal, so the legend cannot promise a key
// in one shell that means something else in the other. Terminal idiom: the same list, rendered
// as the menu's last row, because that shell's footer is already spent on git/model/reasoning.
function openCodenMenu(){
  const box=$('#codenPrompt');
  if(!box)return;
  if(!box.value.startsWith('/'))box.value=`/${box.value}`;
  box.focus();
  box.setSelectionRange(box.value.length,box.value.length);
  codenMenuIndex=0;renderCodenMenu();
}
function renderCodenPromptKeys(frame){
  const hint=$('#codenPromptHint');if(!hint)return;
  // Translated here, part by part, and the line marked `translate="no"`: the parts are joined
  // into a single text node, and one lookup of the joined line would miss in every language.
  const keys=promptKeys(frame,t);
  hint.setAttribute('translate','no');
  // The `/` stays a real control when the menu is closed — a keyboard shortcut is the fast path
  // and never the only path, which is why `D-0299` could remove the widgets in the first place.
  hint.innerHTML=frame
    ?keys.map((key)=>escapeHtml(key)).join(' · ')
    :`${escapeHtml(t('Enter sends'))} · <button type="button" class="hint-key" id="codenPromptOpenMenu" aria-controls="codenMenu" title="${escapeHtml(t('Open the menu — the same thing typing / does'))}">/</button> ${escapeHtml(t('opens the menu'))} · ${escapeHtml(t('Tab completes without sending'))}`;
  // No listener is attached here on purpose. The control is destroyed and rebuilt on every
  // keystroke now, and re-binding per repaint is a rule that has to keep being remembered —
  // mutation proved it: disabling the re-bind left every test green and the mouse path working
  // exactly until the first character was typed. The listener is DELEGATED once, on the region
  // that survives the repaint, so the failure mode does not exist rather than being watched for.
}
function renderCodenMenu(){
  const box=$('#codenMenu');if(!box)return;
  const parsed=parseCommandPrompt($('#codenPrompt')?.value??'');
  if(!parsed){box.classList.add('hidden');box.innerHTML='';renderCodenPromptKeys(null);return;}
  const menu=codenMenu();
  const frame=codenFrame(parsed);
  renderCodenPromptKeys(frame);
  box.classList.remove('hidden');
  // The note's words come from the shared registry. This used to be a second wording of the
  // terminal's, off the same two fields, and the two had already drifted: the terminal printed
  // nothing at all in the `accessFiltered:false` case that this shell disclosed.
  // `t` is handed in because the sentence is composed around a count and a list of permission
  // names, so the finished string can never be a catalogue key. `translate="no"` then keeps the
  // observer off the result: it is already translated, and a second lookup of the whole
  // composed sentence would be recorded as a coverage gap nothing could ever close.
  const note=`<p class="agent-menu-note" translate="no">${escapeHtml(hiddenNote(menu,t))}</p>`;
  // Flattened 2026-08-14 on direct Owner instruction: one ranked list, no group you have to
  // enter first — the same shape `commandMenuRows` now paints in the terminal. Unlike the
  // terminal this is a real scrollable element, so there is no window to compute: every hit
  // is in the DOM and the browser scrolls it, the same way any other list on this page does.
  const hits=frame.hits;
  if(codenMenuIndex>=hits.length)codenMenuIndex=0;
  if(!hits.length){box.innerHTML=`<p class="agent-menu-note">No entry matches that.</p>${note}`;return;}
  box.innerHTML=hits.map((entry,index)=>
    // `translate="no"` for the same reason as the chat menu, and with one more case: half of
    // these entries are ADDRESSES (`coden/bench/diff`), and an address translated word by word
    // is an address that resolves to nothing.
    `<button type="button" role="option" aria-selected="${index===codenMenuIndex}" class="${index===codenMenuIndex?'active':''}" data-coden-command="${escapeHtml(entry.name)}"><b translate="no">/${escapeHtml(entry.name)}</b><span>${escapeHtml(entry.summary)}</span><small>${escapeHtml(entry.argument??'')}</small></button>`
  ).join('')+note;
  box.querySelectorAll('[data-coden-command]').forEach((button)=>
    button.addEventListener('click',()=>completeCodenCommand(button.dataset.codenCommand)));
}
function completeCodenCommand(name){
  const entry=codenOffered().find((candidate)=>candidate.name===name);
  if(!entry)return;
  // Completes WITHOUT sending — choosing and committing stay two acts, the same rule the
  // terminal's Tab follows. A click that ran the command would make the menu a minefield.
  $('#codenPrompt').value=`/${entry.name}${entry.argument?' ':''}`;
  $('#codenPrompt').focus();
  renderCodenMenu();
}
async function submitCodenPrompt(){
  const box=$('#codenPrompt');if(!box)return;
  const typed=box.value.trim();
  box.value='';codenMenuIndex=0;renderCodenMenu();maybeApplyLegacyHide();
  if(!typed)return;
  const offered=codenOffered();
  say(codenView,'user',typed);renderCodenTranscript();
  const turn=planTurn(typed,{
    resolve:(text)=>resolveCommand(text,offered),
    parse:parseCommandPrompt,commands:offered,groups:groupMenu,
  });
  if(turn.kind==='help'){say(codenView,'agent','Menu:',turn.lines);return renderCodenTranscript();}
  if(turn.kind==='clear'){codenView.transcript=[{kind:'note',text:CLEARED_NOTE}];return renderCodenTranscript();}
  if(turn.kind==='unknown'){say(codenView,'error',turn.message);return renderCodenTranscript();}
  if(turn.kind==='confirm'){say(codenView,'note',turn.message);return renderCodenTranscript();}
  // s333 point 2: a command that needs a subject and was given none states what is missing
  // and runs nothing. It used to fire the call anyway and surface the server's refusal.
  if(turn.kind==='needs-argument'){say(codenView,'note',turn.message);return renderCodenTranscript();}
  if(turn.kind==='form'){
    // The same capability, in this shell's idiom. The closure panel already IS this form, so
    // `/closure` opens it and puts the run into it rather than re-asking three questions one
    // at a time at a prompt that has a perfectly good form just below it. The terminal walks
    // the fields because it has no panel to open — `16` §4b.2: one form, two renditions.
    say(codenView,'tool',`→ /${turn.command}`);renderCodenTranscript();
    // Through `jumpTo` for the same reason as the navigate branch below: the closure panel is
    // a panel of THIS page, so opening it is an in-page move and writing the hash by hand
    // refetched the bench to arrive where it already was.
    jumpTo(turn.address);
    const run=$('#closureRun');if(run&&turn.argument)run.value=turn.argument;
    $('#closureSummary')?.focus();
    return undefined;
  }
  if(turn.kind==='session'){
    say(codenView,'note','Ending the session…');renderCodenTranscript();
    return $('#logoutButton')?.click();
  }
  if(turn.kind==='navigate'){
    // A destination in a browser is a route change, which is what this shell owns; the
    // terminal renders the same address into its transcript, off the same shared table.
    //
    // PHASE 3c — through `jumpTo`, not `location.hash=`. `jumpTo` already knows the one thing
    // that matters here: moving between panels of the page you are ALREADY on is an in-page
    // move (pushState, silent), while anything else is a real navigation. Writing the hash
    // by hand fired hashchange every time, and this page's loader refetches the bench on
    // every activation — measured the moment the prompt became the only way in, because until
    // then the box was doing it correctly and the prompt only ever left the page: 28 → 32
    // requests for a move that should cost none. One function that knows how to go somewhere.
    say(codenView,'tool',`→ /${turn.command}`);
    // Why it moved, when it moved for a reason the person did not state. Silence here is
    // the same complaint from the other side.
    if(turn.because)say(codenView,'note',turn.because);
    renderCodenTranscript();
    jumpTo(turn.address);
    return undefined;
  }
  if(turn.kind!=='call')return renderCodenTranscript();
  say(codenView,'tool',turn.label);renderCodenTranscript();
  try{
    const result=await codenCall(turn.method,turn.params);
    // `D-0579`, `F-AUTH-UI-001`. Same shaper as the other two shells: a plan that wrote nothing
    // said `— ok` here too, and the reason was at line 88 of a 126-line answer this printed ten
    // lines of.
    const shown=callResult(turn.command,result);
    say(codenView,'agent',shown.headline,shown.lines);
  }catch(error){
    say(codenView,'error',`${turn.command} refused: ${error.value?.error?.reason??error.value?.error??error.message}`);
  }
  return renderCodenTranscript();
}
function wireCodenShell(){
  const box=$('#codenPrompt');if(!box)return;
  renderCodenTranscript();
  box.addEventListener('input',()=>{codenMenuIndex=0;renderCodenMenu();maybeApplyLegacyHide();});
  // D-0456: the terminal may have gone `live` while this box had focus or held unsent text —
  // `codenTerminalState` deferred its hide rather than cut the person off mid-thought. Looking
  // away is the third and last way a busy spell can end (the other two: submitting, emptying
  // the box), so it gets the same retry.
  box.addEventListener('blur',()=>{maybeApplyLegacyHide();});
  box.addEventListener('keydown',(event)=>{
    const parsed=parseCommandPrompt(box.value);
    const frame=parsed?codenFrame(parsed):null;
    const hits=frame?.hits??[];
    if(hits.length){
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();
        codenMenuIndex=(codenMenuIndex+(event.key==='ArrowDown'?1:-1)+hits.length)%hits.length;
        return renderCodenMenu();
      }
      if(event.key==='Tab'){event.preventDefault();return completeCodenCommand(hits[codenMenuIndex].name);}
      if(event.key==='Escape'){event.preventDefault();$('#codenMenu')?.classList.add('hidden');return undefined;}
    }
    if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void submitCodenPrompt();}
    return undefined;
  });
}
wireCodenShell();

// Active and scheduled work, in one place and each task in exactly one group · UI-062.
// The grouping itself lives in schedule.js so that it is unit-tested rather than asserted
// by looking at the screen.
function taskCard(item,{showRule=false}={}){
  const rule=String(item.recurrence??'').trim();
  return `<article class="entity-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><small>${escapeHtml(item.status)} · ${escapeHtml(item.priority)}${item.scheduledAt?` · starts ${scheduleInstantHtml(item.scheduledAt)}`:''}${item.dueAt?` · due ${scheduleInstantHtml(item.dueAt)}`:''}</small>${showRule&&rule
    // The rule is shown verbatim. It is free text or an RRULE, and rendering "every
    // Monday" for a string this product has never parsed would be inventing a reading
    // of it — the one thing a schedule must not do.
    ?`<p class="schedule-rule"><span class="rule-label">Rule</span> <code>${escapeHtml(rule)}</code></p>`
    :''}<button data-task-status="${item.id}:running">Start</button><button data-task-status="${item.id}:completed">Complete</button><button data-task-status="${item.id}:blocked">Block</button></article>`;
}
function renderTasks(){
  const {active,scheduled}=splitTasks(state.tasks,Date.now());
  $('#taskList').innerHTML=active.map((item)=>taskCard(item,{showRule:false})).join('')||'No active tasks.';
  $('#taskList').classList.toggle('empty-state',active.length===0);
  const scheduledList=$('#taskScheduledList');
  if(scheduledList){
    scheduledList.innerHTML=scheduled.map((item)=>taskCard(item,{showRule:true})).join('')||'Nothing scheduled.';
    scheduledList.classList.toggle('empty-state',scheduled.length===0);
  }
  const activeCount=$('#taskActiveCount');if(activeCount)activeCount.textContent=String(active.length);
  const scheduledCount=$('#taskScheduledCount');if(scheduledCount)scheduledCount.textContent=String(scheduled.length);
  // The zone is named once, on the panel, because every instant below it is rendered in
  // that zone: repeating it on each row is noise, omitting it entirely is the defect.
  const chip=$('#taskZoneChip');if(chip)chip.textContent=`Times in ${zoneName()}`;
  // The same zone, said again where the times are TYPED. A field that never names the zone
  // it will be understood in asks a person to guess, and they find out afterwards — which
  // is exactly the disagreement this phase repaired underneath.
  const formZone=$('#taskFormZone');
  if(formZone)formZone.textContent=`Schedule and Due are read in ${zoneName()}, and stored as an instant.`;
  $$('[data-task-status]').forEach((button)=>button.addEventListener('click',async()=>{const[id,status]=button.dataset.taskStatus.split(':');await api(`/api/v1/tasks/${id}`,{method:'PATCH',body:JSON.stringify({status})});await refreshWorkspace();}));
}
// A stored value with no zone cannot be rendered as if it were precise. It is shown and
// marked, rather than silently resolved against whichever clock happens to be reading it.
function scheduleInstantHtml(value){
  if(isZonelessInstant(value)){
    return `<span class="zoneless" title="Recorded before the interface resolved wall clocks against a zone. Its true instant cannot be recovered.">${escapeHtml(value)} · recorded without a zone</span>`;
  }
  return instantHtml(value);
}
// A `datetime-local` field yields a wall clock with no zone. Sending it as-is let the
// control plane resolve it against ITS OWN clock — the container's, which runs UTC — so a
// person scheduling 09:30 in Europe/Rome stored 09:30Z and the panel then showed them
// 11:30. The wall clock is resolved here, against the effective zone, and an instant is
// sent. If the zone is somehow not one Intl knows, the browser's own zone is used and the
// fallback is visible in the console rather than silent.
function scheduledInstantFromField(value){
  if(!value)return null;
  try{return zonedWallClockToUtcIso(value,zoneName());}
  catch(error){
    // The typed value travels as an ARGUMENT, never inside the message. A console format
    // string built from user input consumes the arguments after it when the input happens
    // to contain %s or %d, and the line that was meant to explain a failure becomes a
    // second failure to explain. (semgrep unsafe-formatstring, and it was right.)
    console.warn('Could not resolve a scheduled wall clock in the effective zone; using this device zone instead.',{value,zone:zoneName(),error});
    try{return zonedWallClockToUtcIso(value,Intl.DateTimeFormat().resolvedOptions().timeZone);}
    catch{return null;}
  }
}
$('#taskForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/tasks',{method:'POST',body:JSON.stringify({projectId:$('#taskProject').value||null,title:$('#taskTitle').value,description:$('#taskDescription').value,priority:$('#taskPriority').value,status:$('#taskScheduledAt').value?'scheduled':'planned',scheduledAt:scheduledInstantFromField($('#taskScheduledAt').value),dueAt:scheduledInstantFromField($('#taskDueAt').value),recurrence:$('#taskRecurrence').value||null})});event.target.reset();await refreshWorkspace();});
function renderNotes(){$('#noteList').innerHTML=state.memories.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p><small>${escapeHtml(item.scope)} · ${escapeHtml(item.tags.join(', '))}</small><button data-edit-note="${item.id}">Edit</button><button class="danger" data-delete-note="${item.id}">Delete</button></article>`).join('')||'No notes yet — pin one to a project or conversation above.';$$('[data-edit-note]').forEach((button)=>button.addEventListener('click',async()=>{const item=state.memories.find((m)=>m.id===button.dataset.editNote);const content=prompt('Edit note',item.content);if(content!==null){await api(`/api/v1/memories/${item.id}`,{method:'PATCH',body:JSON.stringify({content})});await refreshWorkspace();}}));$$('[data-delete-note]').forEach((button)=>button.addEventListener('click',async()=>{if(confirm('Delete this note?')){await api(`/api/v1/memories/${button.dataset.deleteNote}`,{method:'DELETE',body:'{}'});await refreshWorkspace();}}));}
$('#noteForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/memories',{method:'POST',body:JSON.stringify({projectId:$('#noteProject').value||null,conversationId:$('#noteScope').value==='conversation'?($('#noteConversation').value||state.activeConversationId):null,scope:$('#noteScope').value,title:$('#noteTitle').value,content:$('#noteContent').value,tags:$('#noteTags').value.split(',').map((v)=>v.trim()).filter(Boolean)})});event.target.reset();await refreshWorkspace();});
function renderArtifacts(){$('#artifactList').innerHTML=state.artifacts.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.title)}</h3><small>${escapeHtml(item.type)} · version ${item.versions.length}</small><pre>${escapeHtml(item.versions.at(-1)?.content??'')}</pre><button data-edit-artifact="${item.id}">New version</button></article>`).join('')||'No documents.';$$('[data-edit-artifact]').forEach((button)=>button.addEventListener('click',async()=>{const item=state.artifacts.find((a)=>a.id===button.dataset.editArtifact);const content=prompt('New artifact version',item.versions.at(-1)?.content??'');if(content!==null){await api(`/api/v1/artifacts/${item.id}`,{method:'PATCH',body:JSON.stringify({content})});await refreshWorkspace();}}));}
$('#artifactForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/artifacts',{method:'POST',body:JSON.stringify({projectId:$('#artifactProject').value||null,type:$('#artifactType').value,title:$('#artifactTitle').value,content:$('#artifactContent').value})});event.target.reset();await refreshWorkspace();});
function renderSources(){$('#sourceList').innerHTML=state.sources.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.mimeType)}</p><small>${escapeHtml(item.extractionStatus)} · ${item.byteLength} bytes</small><button data-preview-source="${item.id}">Preview passages</button></article>`).join('')||'No sources indexed yet — add a file or paste text to make it searchable.';$$('[data-preview-source]').forEach((button)=>button.addEventListener('click',async()=>{const item=await api(`/api/v1/sources/${button.dataset.previewSource}`);$('#knowledgeResults').innerHTML=item.passages?.map((passage)=>`<article class="entity-card"><h3>Passage ${passage.index}</h3><p>${escapeHtml(passage.text)}</p></article>`).join('')||'<p>No extracted passages.</p>';}));}
function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(file);});}
$('#sourceBinary').addEventListener('change',()=>{const file=$('#sourceBinary').files[0];if(file){$('#sourceName').value=file.name;$('#sourceMime').value=file.type||'application/octet-stream';}});
$('#sourceForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const file=$('#sourceBinary').files[0];if(file){setStatus(`Extracting ${file.name} locally…`);await api('/api/v1/sources/upload',{method:'POST',body:JSON.stringify({projectId:$('#sourceProject').value||null,name:file.name,mimeType:file.type||$('#sourceMime').value,bytesBase64:await fileToBase64(file)})});}else{await api('/api/v1/sources',{method:'POST',body:JSON.stringify({projectId:$('#sourceProject').value||null,name:$('#sourceName').value,mimeType:$('#sourceMime').value,text:$('#sourceText').value})});}event.target.reset();$('#sourceMime').value='text/plain';await refreshWorkspace();setStatus('Source ingested and indexed.');}catch(error){setStatus(error.message,true);}});
$('#knowledgeSearch').addEventListener('click',async()=>{const result=await api(`/api/v1/knowledge/search?q=${encodeURIComponent($('#knowledgeQuery').value)}&projectId=${encodeURIComponent(state.activeProjectId??'')}`);$('#knowledgeResults').innerHTML=result.results.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.source?.name??item.sourceId)}</h3><p>${escapeHtml(item.text)}</p><small>score ${item.score.toFixed(3)} · passage ${item.index}</small></article>`).join('')||'No results.';});
function renderProviders(){
  $('#providerType').innerHTML=state.providerCatalog.map((item)=>`<option value="${escapeHtml(item.type)}">${escapeHtml(item.name)}</option>`).join('');syncProviderDefaults();
  // s341: the running local model appears in this list because it is genuinely one of the
  // providers that can answer — but it is DERIVED from the runtime, not stored, so every
  // control on an ordinary card would be a gesture the server answers 409 to. A card that
  // offers a button which cannot work is the placeholder this project refuses to ship, so
  // this one states what it is and where it is changed instead.
  const runtimeProviderCard=(item)=>`<article class="entity-card provider-card"><h3>${escapeHtml(item.name)}</h3>`
    +`<p>${escapeHtml(item.type)} · ${escapeHtml(item.baseUrl)}</p>`
    +`<small>Local · Answering now · derived from the local model runtime, not a stored profile</small>`
    +`<p class="hint">This is the model chosen with <code>/model</code>. Change it by choosing another model — it has no credential and reaches nothing outside this machine.</p></article>`;
  $('#providerList').innerHTML=state.providers.map((item)=>item.virtual?runtimeProviderCard(item):`<article class="entity-card provider-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.type)} · ${escapeHtml(item.baseUrl)}</p><small>${item.external?'External':'Local'} · ${item.enabled?'Enabled':'Disabled'} · credential ${item.credentialConfigured?'configured':'missing'} · priority ${item.priority??100}</small><div class="inline-form"><input type="password" data-provider-key="${item.id}" placeholder="API key"><select data-provider-persistence="${item.id}"><option value="ephemeral">Session only</option><option value="encrypted">Encrypted on disk</option></select><button data-save-key="${item.id}">Save key</button><button data-probe-provider="${item.id}">Health check</button></div><div class="inline-form"><label class="check"><input type="checkbox" data-provider-consent="${item.id}" ${item.consent?.granted?'checked':''}> Explicit external consent</label><label class="check"><input type="checkbox" data-provider-anonymize="${item.id}" ${item.consent?.anonymize!==false?'checked':''}> Redaction/anonymization</label><label class="check" title="Lets this provider caption an uploaded image when OCR finds no text in it"><input type="checkbox" data-provider-vision="${item.id}" ${item.visionCapable?'checked':''}> Vision-capable (image captioning)</label><button data-toggle-provider="${item.id}">${item.enabled?'Disable':'Enable'}</button></div><label>Fallback providers<select multiple data-provider-fallbacks="${item.id}">${state.providers.filter((other)=>other.id!==item.id&&!other.virtual).map((other)=>`<option value="${other.id}" ${(item.fallbackProviderIds??[]).includes(other.id)?'selected':''}>${escapeHtml(other.name)}</option>`).join('')}</select></label><button data-save-routing="${item.id}">Save routing</button><pre data-provider-health-result="${item.id}" class="hidden"></pre></article>`).join('')||'No providers configured.';
  const selectedProvider=$('#chatProvider').value;$('#chatProvider').innerHTML=optionList(state.providers,{empty:'Automatic route',label:(item)=>`${item.name}${item.external?' · external':' · local'}`,selected:selectedProvider});$('#comparisonProviders').innerHTML=state.providers.filter((item)=>item.enabled).map((item)=>`<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');bindProviderActions();
}
function syncProviderDefaults(){const descriptor=state.providerCatalog.find((item)=>item.type===$('#providerType').value)??state.providerCatalog[0];if(!descriptor)return;$('#providerName').value=descriptor.name;$('#providerBaseUrl').value=descriptor.baseUrl??'';}
$('#providerType').addEventListener('change',syncProviderDefaults);$('#providerForm').addEventListener('submit',async(event)=>{event.preventDefault();const descriptor=state.providerCatalog.find((item)=>item.type===$('#providerType').value);await api('/api/v1/providers',{method:'POST',body:JSON.stringify({type:descriptor.type,name:$('#providerName').value,baseUrl:$('#providerBaseUrl').value,defaultModel:$('#providerModel').value,priority:Number($('#providerPriority').value),modes:[...$('#providerModes').selectedOptions].map((o)=>o.value),external:descriptor.external,apiStyle:descriptor.apiStyle})});await refreshWorkspace();});
function bindProviderActions(){$$('[data-save-key]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.saveKey;const input=$(`[data-provider-key="${id}"]`);await api(`/api/v1/providers/${id}/credential`,{method:'PUT',body:JSON.stringify({apiKey:input.value,persistence:$(`[data-provider-persistence="${id}"]`).value})});input.value='';await refreshWorkspace();}));$$('[data-provider-consent]').forEach((checkbox)=>checkbox.addEventListener('change',async()=>{const id=checkbox.dataset.providerConsent;await api(`/api/v1/providers/${id}/consent`,{method:'PUT',body:JSON.stringify({granted:checkbox.checked,projectIds:state.activeProjectId?[state.activeProjectId]:[],dataClasses:['prompt','selected messages','project instructions','selected memory','selected sources'],allowTools:true,anonymize:$(`[data-provider-anonymize="${id}"]`).checked})});await refreshWorkspace();}));$$('[data-provider-vision]').forEach((checkbox)=>checkbox.addEventListener('change',async()=>{const id=checkbox.dataset.providerVision;await api(`/api/v1/providers/${id}`,{method:'PATCH',body:JSON.stringify({visionCapable:checkbox.checked})});await refreshWorkspace();}));$$('[data-toggle-provider]').forEach((button)=>button.addEventListener('click',async()=>{const item=state.providers.find((p)=>p.id===button.dataset.toggleProvider);if(item.external&&!item.consent?.granted&&!item.enabled)return setStatus('Grant explicit external consent first.',true);await api(`/api/v1/providers/${item.id}`,{method:'PATCH',body:JSON.stringify({enabled:!item.enabled})});await refreshWorkspace();}));bindProviderRoutingActions();}
function bindProviderRoutingActions(){$$('[data-save-routing]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.saveRouting;const select=$(`[data-provider-fallbacks="${id}"]`);await api(`/api/v1/providers/${id}`,{method:'PATCH',body:JSON.stringify({fallbackProviderIds:[...select.selectedOptions].map((o)=>o.value)})});await refreshWorkspace();}));$$('[data-probe-provider]').forEach((button)=>button.addEventListener('click',async()=>{const result=$(`[data-provider-health-result="${button.dataset.probeProvider}"]`);result.classList.remove('hidden');result.textContent='Checking…';try{result.textContent=JSON.stringify(await api(`/api/v1/providers/${button.dataset.probeProvider}/health`),null,2);}catch(error){result.textContent=error.message;}}));}
// Selecting a provider in a dropdown is an intention, not a privacy fact, and this
// function used to conflate the two: it wrote the banner, the footer and the runtime chip
// directly from the <select>, including the literal string "● Local-only verified" for
// any local selection — regardless of what was actually enabled and consented on the
// server. That is the WebUI asserting a guarantee nothing verified, the same defect shape
// as the five hardcoded invariants. It now shows the selected model, which is genuinely
// local UI state, and asks the server to re-derive everything else.
function updatePrivacyFromProvider(){
  const selected=state.providers.find((item)=>item.id===$('#chatProvider').value);
  $('#modelChip').textContent=`Model: ${$('#chatModel').value||selected?.defaultModel||'none'}`;
  refreshPrivacy();
}
$('#chatProvider').addEventListener('change',updatePrivacyFromProvider);$('#chatModel').addEventListener('input',updatePrivacyFromProvider);
// The revoke control the disclosure advertises. Wiring it here rather than only naming it
// in the disclosure text is the whole point: a control a panel describes and no button
// performs is a claim, not a control.
$('#privacyRevoke')?.addEventListener('click',async()=>{
  try{
    await api('/api/v1/privacy/revoke',{method:'POST',body:JSON.stringify({})});
    await refreshWorkspace();
    await refreshPrivacy();
    toast('External provider and connector consent withdrawn.',{kind:'success'});
  }catch(error){toast(error.message,{kind:'error'});}
});
$('#compareModels').addEventListener('click',async()=>{if(!state.activeConversationId)return setStatus('Create a conversation first.',true);const providerIds=[...$('#comparisonProviders').selectedOptions].map((item)=>item.value);if(providerIds.length<2){activate('models');return setStatus('Select at least two enabled providers for comparison.',true);}const content=$('#chatInput').value.trim()||prompt('Prompt to compare');if(!content)return;try{const result=await api('/api/v1/models/compare',{method:'POST',body:JSON.stringify({conversationId:state.activeConversationId,branchId:state.activeBranchId,content,providerIds,model:$('#chatModel').value.trim()||null,mode:currentMode})});$('#comparisonResults').textContent=JSON.stringify(result,null,2);activate('models');setStatus('Model comparison completed.');}catch(error){setStatus(error.message,true);}});
async function loadExtractorCapabilities(){try{const c=await api('/api/v1/sources/capabilities');$('#extractorStatus').textContent=`Local extractors: PDF ${c.pdf?'ready':'missing'} · OCR ${c.ocr?'ready':'missing'} · Office/ZIP ${c.archives?'ready':'missing'} · media metadata ${c.mediaMetadata?'ready':'missing'}. Audio/video transcription uses a configured local tool or approved multimodal provider.`;}catch{}}
async function capturedBlobToInput(blob,name){const file=new File([blob],name,{type:blob.type||'application/octet-stream'});const dt=new DataTransfer();dt.items.add(file);$('#sourceBinary').files=dt.files;$('#sourceName').value=name;$('#sourceMime').value=file.type;activate('knowledge');}
$('#captureCamera').addEventListener('click',async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});const video=document.createElement('video');video.srcObject=stream;await video.play();await new Promise((r)=>setTimeout(r,500));const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);stream.getTracks().forEach((track)=>track.stop());canvas.toBlob((blob)=>capturedBlobToInput(blob,`camera-${Date.now()}.png`),'image/png');}catch(error){setStatus(error.message,true);}});
$('#captureScreen').addEventListener('click',async()=>{try{const stream=await navigator.mediaDevices.getDisplayMedia({video:true});const video=document.createElement('video');video.srcObject=stream;await video.play();await new Promise((r)=>setTimeout(r,500));const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);stream.getTracks().forEach((track)=>track.stop());canvas.toBlob((blob)=>capturedBlobToInput(blob,`screen-${Date.now()}.png`),'image/png');}catch(error){setStatus(error.message,true);}});
// §3#11, OWNER_REVIEW_2026-08-21: «non si capisce se sono davvero attivi/funzionanti». Archive
// already removes an agent from every surface (D-0397, `!item.archived` filtered server-side) —
// that half of the report was already answered before this session; what the card never showed
// is whether an agent DOES anything. Derived from `state.agentRuns`, the same record `Test` and
// `Plan run` already write — not a new field invented for the badge, so it cannot say something
// the rest of the page disagrees with.
function agentStatusBadge(agentId){
  const runs=(state.agentRuns??[]).filter((run)=>run.agentId===agentId);
  if(!runs.length)return `<p><span class="badge">${escapeHtml(t('Not yet run'))}</span></p>`;
  const last=runs.reduce((latest,run)=>!latest||run.createdAt>latest.createdAt?run:latest,null);
  if(last.status==='completed')return `<p><span class="badge badge-on">${escapeHtml(t('Working — last run succeeded'))}</span></p>`;
  if(last.status==='failed')return `<p><span class="badge badge-off">${escapeHtml(t('Failing — last run errored'))}</span></p>`;
  return `<p><span class="badge">${escapeHtml(t('Run in progress'))}</span></p>`;
}
function renderAgents(){
  $('#agentTools').innerHTML=state.tools.map((item)=>`<option value="${item.id}" translate="no">${escapeHtml(item.name)}${item.mutative?' · mutative':''}</option>`).join('');
  $('#runAgent').innerHTML=optionList(state.agents,{empty:'Select agent'});
  // P3: a built-in engine tool has no endpoint and no `config.command` — it has a METHOD, run in
  // this process. Reading `config.method` here is what stops twenty of them rendering as "not
  // configured", which would read as broken and is the opposite of true. No credential input and
  // no consent button either: there is nothing to authenticate to and no third party to consent
  // about, and a password box that cannot mean anything is a control that teaches distrust.
  const toolWhere=(tool)=>tool.endpoint??tool.config?.method??tool.config?.command??'not configured';
  // `translate="no"` on the three nodes that carry DATA — the tool's name, where it points, and
  // the permission identifiers. This is `i18n.js`'s own prescription for text a catalogue can
  // never close (its comment names an untranslated project name as the case that makes the
  // measurement lie), and it was missing here: every operator-registered tool name has always
  // been counted as an untranslated interface string, and P3's twenty engine tools would have
  // added twenty more. `engine_repoMap_search` is a function name a model calls — translating it
  // would break the call, so it is not a gap and must not be measured as one. The prose around
  // them is untouched and still measured.
  $('#toolList').innerHTML=state.tools.map((tool)=>`<article class="entity-card"><h3 translate="no">${escapeHtml(tool.name)}</h3><p translate="no">${escapeHtml(tool.transport)} · ${escapeHtml(toolWhere(tool))}</p><small>${tool.builtin?'Built-in':tool.external?'External':'Local'} · ${tool.mutative?'Mutative':'Read-only'}${tool.builtin?'':` · consent ${tool.consent?.granted?'granted':'not granted'}`}</small>${tool.builtin&&tool.permissions?.length?`<small class="hint" translate="no">${escapeHtml(tool.permissions.join(', '))}</small>`:''}${tool.builtin?'':`<div class="inline-form"><input type="password" data-tool-key="${tool.id}" placeholder="Optional API/OAuth token"><button data-save-tool-key="${tool.id}">Save encrypted key</button>${tool.external?`<button data-tool-consent="${tool.id}">${tool.consent?.granted?'Revoke consent':'Grant for active project'}</button>`:''}</div>`}</article>`).join('')||'No tools.';
  // The agent list itself. Agents used to exist only as `<option>`s in two selectors: there was
  // no surface on which one could be looked at, tried or removed, which is exactly how an agent
  // created by mistake became permanent.
  $('#agentList').innerHTML=(state.agents??[]).map((agent)=>{
    const tools=state.tools.filter((tool)=>(agent.toolIds??[]).includes(tool.id));
    const instructions=(agent.instructions??'').trim();
    return `<article class="entity-card"><h3>${escapeHtml(agent.name)}</h3>${agentStatusBadge(agent.id)}<p>${instructions?escapeHtml(instructions.length>240?`${instructions.slice(0,240)}…`:instructions):'No instructions of its own — this agent is told to answer directly and to declare what it cannot know.'}</p><small>${tools.length?tools.map((tool)=>`${escapeHtml(tool.name)}${tool.mutative?' · mutative':''}`).join(' · '):'No tool'}</small><div class="inline-form"><input data-agent-goal="${agent.id}" placeholder="One sentence to test this agent with" aria-label="One sentence to test this agent with" title="Sent to the model as the goal of a single, non-mutative turn."><button data-test-agent="${agent.id}" title="Runs one turn now: this agent's instructions plus this sentence. No tool is called and nothing is written.">Test</button><button data-archive-agent="${agent.id}" title="Removes this agent from the list and from Plan run. The record is kept, not destroyed.">Archive agent</button></div><div data-agent-answer="${agent.id}"></div></article>`;
  }).join('')||'No agent yet. Create one on the left — it needs a name and nothing else.';
  // `step.toolId` is no longer required to offer Execute: a step without a tool is answered by
  // the model (`D-0397`). While that condition stood, the `Analyze goal` step this very screen
  // creates had no control at all, and every run it made was unfinishable.
  $('#runList').innerHTML=(state.agentRuns??[]).map((run)=>`<article class="entity-card"><h3>${escapeHtml(run.goal)}</h3><small>${escapeHtml(run.status)}</small>${run.steps.map((step)=>`<div class="step"><span>${step.index+1}. ${escapeHtml(step.title)}</span><b>${escapeHtml(step.status)}</b>${step.status==='awaiting_approval'?`<button data-approve-step="${run.id}:${step.id}">Approve</button>`:''}${step.status==='pending'?`<button data-execute-step="${run.id}:${step.id}">${step.toolId?'Execute':'Ask the model'}</button>`:''}</div>${step.output?(step.output.kind==='reasoning'?`<pre>${escapeHtml(step.output.text??'')}</pre><small>${escapeHtml(step.output.provider?.name??'provider')}${step.output.model?` · ${escapeHtml(step.output.model)}`:''}</small>`:`<pre>${escapeHtml(JSON.stringify(step.output,null,2))}</pre>`):''}${step.error?`<p class="error">${escapeHtml(step.error)}</p>`:''}`).join('')}</article>`).join('')||'No run yet. Press Test on an agent for a single turn, or use Plan run for an approval-aware one.';
  $$('[data-test-agent]').forEach((button)=>button.addEventListener('click',()=>testAgent(button.dataset.testAgent)));
  $$('[data-archive-agent]').forEach((button)=>button.addEventListener('click',()=>archiveAgent(button.dataset.archiveAgent)));
  $$('[data-approve-step]').forEach((button)=>button.addEventListener('click',async()=>{const[runId,stepId]=button.dataset.approveStep.split(':');await api(`/api/v1/agent-runs/${runId}/steps/${stepId}/approve`,{method:'POST',body:'{}'});await refreshWorkspace();}));
  $$('[data-execute-step]').forEach((button)=>button.addEventListener('click',async()=>{const[runId,stepId]=button.dataset.executeStep.split(':');try{await api(`/api/v1/agent-runs/${runId}/steps/${stepId}/execute`,{method:'POST',body:JSON.stringify({input:{}})});await refreshWorkspace();}catch(error){setStatus(error.message,true);}}));
  $$('[data-save-tool-key]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.saveToolKey;const input=$(`[data-tool-key="${id}"]`);await api(`/api/v1/tools/${id}/credential`,{method:'PUT',body:JSON.stringify({apiKey:input.value,persistence:'encrypted'})});input.value='';setStatus('Tool credential encrypted.');}));
  $$('[data-tool-consent]').forEach((button)=>button.addEventListener('click',async()=>{const tool=state.tools.find((item)=>item.id===button.dataset.toolConsent);await api(`/api/v1/tools/${tool.id}/consent`,{method:'PUT',body:JSON.stringify({granted:!tool.consent?.granted,projectIds:state.activeProjectId?[state.activeProjectId]:[]})});await refreshWorkspace();}));
}
// A test is a REAL run with one non-mutative step, executed at once — the same object the Runs
// panel shows, not a private path that would prove nothing about the real one. No tool is
// called: a step with no toolId is answered by the model, and nothing is written anywhere.
async function testAgent(agentId){
  const field=$(`[data-agent-goal="${agentId}"]`);
  const goal=(field?.value??'').trim();
  if(!goal){setStatus('A test needs one sentence to work towards.',true);field?.focus();return;}
  const host=$(`[data-agent-answer="${agentId}"]`);
  if(host)host.innerHTML='<p class="hint">Waiting for the model…</p>';
  try{
    const run=await api('/api/v1/agent-runs',{method:'POST',body:JSON.stringify({agentId,projectId:state.activeProjectId,goal,steps:[{title:'Answer the goal',mutative:false}]})});
    const executed=await api(`/api/v1/agent-runs/${run.id}/steps/${run.steps[0].id}/execute`,{method:'POST',body:JSON.stringify({input:{}})});
    const step=executed.steps[0];
    // The refresh redraws this card, so the answer is written AFTER it, into the new node —
    // writing it before would put the text into an element about to be replaced.
    await refreshWorkspace();
    const redrawn=$(`[data-agent-answer="${agentId}"]`);
    if(redrawn)redrawn.innerHTML=step.output?.text?`<pre>${escapeHtml(step.output.text)}</pre><small>${escapeHtml(step.output.provider?.name??'provider')}${step.output.model?` · ${escapeHtml(step.output.model)}`:''}</small>`:`<p class="error">${escapeHtml(step.error??'The step completed without returning any text.')}</p>`;
  }catch(error){
    await refreshWorkspace();
    const redrawn=$(`[data-agent-answer="${agentId}"]`);
    if(redrawn)redrawn.innerHTML=`<p class="error">${escapeHtml(error.message)}</p>`;
    setStatus(error.message,true);
  }
}
// Archive, not delete: the agent leaves every surface, the record stays. What it removes is
// stated in the confirmation, so nobody has to guess whether their runs go with it.
async function archiveAgent(agentId){
  const agent=state.agents.find((item)=>item.id===agentId);
  if(!agent)return;
  if(!confirm(`Archive “${agent.name}”?\n\nIt leaves this list and the Plan run selector. Nothing is destroyed: the record is kept and its runs stay where they are.`))return;
  try{await api(`/api/v1/agents/${agentId}`,{method:'PATCH',body:JSON.stringify({archived:true})});setStatus(`Agent “${agent.name}” archived.`);await refreshWorkspace();}
  catch(error){setStatus(error.message,true);}
}
$('#toolForm').addEventListener('submit',async(event)=>{event.preventDefault();const transport=$('#toolTransport').value;await api('/api/v1/tools',{method:'POST',body:JSON.stringify({name:$('#toolName').value,description:$('#toolDescription').value,transport,endpoint:transport==='mcp-stdio'?null:$('#toolEndpoint').value,config:transport==='mcp-stdio'?{command:$('#toolEndpoint').value,remoteToolName:$('#toolRemoteName').value}:{remoteToolName:$('#toolRemoteName').value},external:$('#toolExternal').checked,mutative:$('#toolMutative').checked,requiresApproval:true})});event.target.reset();await refreshWorkspace();});
$('#agentForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/agents',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId,name:$('#agentName').value,instructions:$('#agentInstructions').value,toolIds:[...$('#agentTools').selectedOptions].map((o)=>o.value)})});event.target.reset();await refreshWorkspace();});
// The two guards are not decoration: with no agent selected this read `agent.id` off
// `undefined` and died with a TypeError nothing showed the operator, and an empty goal reached
// the server only to come back as `Agent goal is required.`
$('#runForm').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const agent=state.agents.find((item)=>item.id===$('#runAgent').value);
  if(!agent){setStatus('Pick an agent first — create one on the left if the list is empty.',true);return;}
  const goal=$('#runGoal').value.trim();
  if(!goal){setStatus('A run needs one sentence to work towards.',true);$('#runGoal').focus();return;}
  const tool=state.tools.find((item)=>agent.toolIds?.includes(item.id));
  try{
    await api('/api/v1/agent-runs',{method:'POST',body:JSON.stringify({agentId:agent.id,projectId:state.activeProjectId,goal,steps:[{title:'Analyze goal',mutative:false},{title:tool?`Use ${tool.name}`:'Produce result',toolId:tool?.id??null,mutative:Boolean(tool?.mutative)}]})});
    event.target.reset();
    await refreshWorkspace();
  }catch(error){setStatus(error.message,true);}
});
async function exportData(){const bundle=await api('/api/v1/data/export');const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`noesar-export-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);}
$('#saveRetention').addEventListener('click',async()=>{await api('/api/v1/data/retention',{method:'PUT',body:JSON.stringify({days:Number($('#retentionDays').value)})});await refreshWorkspace();setStatus('Retention policy saved.');});$('#applyRetention').addEventListener('click',async()=>{const result=await api('/api/v1/data/retention/apply',{method:'POST',body:'{}'});await refreshWorkspace();setStatus(`Retention applied: ${JSON.stringify(result.counts)}`);});$('#exportData').addEventListener('click',exportData);$('#rightExportData').addEventListener('click',exportData);$('#purgeProject').addEventListener('click',async()=>{if(!state.activeProjectId||!confirm('Permanently delete the active project data?'))return;await api('/api/v1/data/purge',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId})});state.activeProjectId=null;state.activeConversationId=null;await refreshWorkspace();});
// --- one box: go to an address, or search what is inside the addresses ------
// The Owner's objection to this workbench was "too many menus", and the answer accepted in
// s313 is a single jump-to-address mechanism on `/`. The obvious build is a command palette
// overlay — and it would have been the wrong one: this product ALREADY has a box in the top
// bar, on Ctrl K, and a second summonable one beside it would have raised the count of
// navigation widgets while the complaint was about the count. The mechanism goes where the
// box already is. `/` and Ctrl K both reach it; the difference is only which key you know.
//
// It answers with two kinds of thing, and never conflates them: ADDRESSES (every place in
// the product, matched here, instantly, with no network) and CONTENT (what the existing
// /api/v1/search finds inside them, debounced). Addresses appear on the first keystroke
// because a jump that waits for a round trip is not a jump.
//
// The address list is BUILT FROM THE INTERFACE, never written out: the sidebar's own
// buttons, the Settings menu's own entries, and the bench and agent panels' own attributes.
// That is the same single-copy rule phase 1 established, and it buys two things beyond
// staleness — a destination hidden from this account by applyNavAccess() is `hidden` in the
// DOM and therefore simply absent here, so the box can never offer a page that answers 403;
// and phase 3 can retire the Navigator column without touching a line of this code.
const CONTENT_HOME={project:'projects',conversation:'chat',message:'chat',memory:'memory',artifact:'documents',source:'knowledge',tool:'coden',task:'home'};
function addressBook(){
  const entries=[];
  const add=(address,kind,label)=>{if(label)entries.push({address,kind,label});};
  $$('.nav').forEach((node)=>{
    if(node.hidden)return;
    add(node.dataset.view,'Page',node.querySelector('span:not(.nav-count):not(.nav-flag)')?.textContent?.trim());
  });
  $$('.settings-nav').forEach((node)=>{
    if(node.hidden||!node.dataset.section)return;
    add(`settings/${node.dataset.section}`,'Settings',node.textContent.trim());
  });
  // UI-004 calls the Archive a page of its own, and phase 1 left both it and the Bin
  // addressable; they have no menu entry of their own, so they are named here.
  if(!$('.settings-nav[data-section="sessions"]')?.hidden){
    add('settings/sessions/archived','Settings','Sessions · Archive');
    add('settings/sessions/bin','Settings','Sessions · Bin');
  }
  Object.entries(CODEN_REGIONS).forEach(([region,spec])=>{
    $$(`#view-coden ${attrSelect(spec.panelAttr)}`).forEach((panel)=>{
      add(`coden/${region}/${panel.getAttribute(spec.panelAttr)}`,region==='bench'?'Bench':'Agent',
        panel.querySelector('h3')?.textContent?.trim());
    });
  });
  return entries;
}
// Phase 3c: the three-rank ranking used to be written out HERE and again in
// `tui-client.mjs`, whose copy carried a comment naming this one — a documented duplicate,
// which is still a duplicate. It lives in the shared view model now, so the two shells cannot
// rank one query two ways. This wrapper only supplies the list, which is the part that really
// does differ: this shell reads the DOM, the other is served it.
function matchLocalAddresses(query){return matchAddresses(addressBook(),query);}
const palette={options:[],active:-1};
function paletteOpen(){return !$('#globalSearchResults').classList.contains('hidden');}
function renderPalette(addresses,contentHtml){
  const box=$('#globalSearchResults');
  const rows=addresses.map((entry)=>`<button type="button" data-jump="${escapeHtml(entry.address)}" role="option" aria-selected="false"><b>${escapeHtml(entry.kind)}</b><span>${escapeHtml(entry.label)}</span><small>/${escapeHtml(entry.address)}</small></button>`).join('');
  const empty=!rows&&!contentHtml?'<p>Nothing matches that.</p>':'';
  box.innerHTML=`${rows?`<p class="palette-group">Go to</p>${rows}`:''}${contentHtml}${empty}`;
  box.classList.remove('hidden');
  $('#globalSearch').setAttribute('aria-expanded','true');
  palette.options=[...box.querySelectorAll('button')];
  setPaletteActive(palette.options.length?0:-1);
}
// The highlighted row is announced through aria-activedescendant rather than by moving
// focus: focus must stay in the input, or every arrow key would take the caret with it and
// the next character typed would land nowhere.
function setPaletteActive(index){
  palette.active=index;
  palette.options.forEach((node,position)=>{
    const active=position===index;
    node.classList.toggle('active',active);
    node.setAttribute('aria-selected',String(active));
    if(active){node.id=node.id||`paletteOption${position}`;node.scrollIntoView({block:'nearest'});}
  });
  const current=palette.options[index];
  $('#globalSearch').setAttribute('aria-activedescendant',current?current.id:'');
}
function closePalette(){
  $('#globalSearchResults').classList.add('hidden');
  $('#globalSearch').setAttribute('aria-expanded','false');
  $('#globalSearch').setAttribute('aria-activedescendant','');
  palette.options=[];palette.active=-1;
}
function openPalette(){
  if($('#authGate')&&!$('#authGate').classList.contains('hidden'))return;
  const input=$('#globalSearch');
  input.focus();input.select();
  renderPalette(matchLocalAddresses(input.value),'');
}
// Going to an address. Already inside the workbench, a panel is reached with the phase-1
// in-page move (no refetch); anything else is a real navigation, written straight to the
// hash so the router activates ONCE — navigate() would activate here and then again on the
// hashchange its own rewrite fires.
function jumpTo(address){
  closePalette();
  $('#globalSearch').blur();
  const [view,second,third]=address.split('/');
  if(view==='coden'&&CODEN_REGIONS[second]&&third&&$('#view-coden')?.classList.contains('active')){
    goToCodenPanel(second,third);
    return;
  }
  const want=`#/${address}`;
  if(location.hash===want)goToHash();
  else location.hash=want;
}
let searchTimer;
$('#globalSearch').addEventListener('input',()=>{
  const raw=$('#globalSearch').value;
  // Addresses are local, so they are drawn on this keystroke rather than after the debounce
  // the network needs.
  renderPalette(matchLocalAddresses(raw),'');
  clearTimeout(searchTimer);
  const q=raw.trim();
  if(!q)return;
  searchTimer=setTimeout(async()=>{
    const data=await api(`/api/v1/search?q=${encodeURIComponent(q)}&projectId=${encodeURIComponent(state.activeProjectId??'')}`);
    // These rows used to be rendered as <button> with no handler on them at all: eight kinds
    // of result, every one of them a control that did nothing when clicked. They lead
    // somewhere now — to the destination that OWNS that kind of thing, which is as far as
    // this product can honestly take you: nothing here has a per-item address yet, so the
    // row says which page it opens instead of implying it will select the item.
    const rows=data.results.map((item)=>{
      const home=CONTENT_HOME[item.type];
      const text=String(item.item.title??item.item.name??item.item.content??item.id).slice(0,180);
      const opens=home?` data-jump="${escapeHtml(home)}" title="Opens ${escapeHtml(home)}"`:' disabled title="This kind of result has no page of its own yet."';
      return `<button type="button" role="option" aria-selected="false"${opens}><b>${escapeHtml(item.type)}</b><span>${escapeHtml(text)}</span><small>${item.score.toFixed(3)}</small></button>`;
    }).join('');
    if($('#globalSearch').value!==raw)return;
    renderPalette(matchLocalAddresses(raw),rows?`<p class="palette-group">In your workspace</p>${rows}`:'');
  },250);
});
$('#globalSearch').addEventListener('focus',()=>{if(!paletteOpen())renderPalette(matchLocalAddresses($('#globalSearch').value),'');});
$('#globalSearch').addEventListener('keydown',(event)=>{
  if(event.key==='Escape'){closePalette();$('#globalSearch').blur();return;}
  if(!paletteOpen()||!palette.options.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();
    const step=event.key==='ArrowDown'?1:-1;
    const count=palette.options.length;
    setPaletteActive((palette.active+step+count)%count);
    return;
  }
  if(event.key==='Enter'){
    const option=palette.options[palette.active];
    if(option&&!option.disabled){event.preventDefault();option.click();}
  }
});
// mousedown, not click: the button is inside a popover that closes on blur, and by the time
// a click event fires the blur has already hidden what was being clicked.
$('#globalSearchResults').addEventListener('mousedown',(event)=>{event.preventDefault();});
$('#globalSearchResults').addEventListener('click',(event)=>{
  const option=event.target.closest('button[data-jump]');
  if(option)jumpTo(option.dataset.jump);
});
$('#globalSearch').addEventListener('blur',()=>{setTimeout(()=>{if(document.activeElement!==$('#globalSearch'))closePalette();},0);});
// The two keys that reach the box. Ctrl K is kept as it was — a shortcut people have
// already learned is not taken away because a better one arrived — and `/` is the new one,
// so it is the one guarded against firing mid-sentence: isTyping() is the same guard `[`
// and `]` use for the sidebar rank, not a second opinion about what counts as typing.
document.addEventListener('keydown',(event)=>{
  if(event.isComposing)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openPalette();return;}
  // D-0406: the bare ` / ` no longer opens the jump box. `16` §4b.4 decided «nel prompt
  // comanda: c'e una / sola» on 2026-08-05 and nothing enforced it, so two gestures kept the
  // same key: navigation here, and the agent's command menu inside CodeN. Ctrl-K opens this
  // box — which the placeholder has advertised all along — and ` / ` now belongs to the prompt
  // on every destination, including the terminal that lives in one.
});
async function refreshHardware(){$('#hardwareOutput').textContent='Running read-only discovery…';try{$('#hardwareOutput').textContent=JSON.stringify(await api('/api/v1/hardware'),null,2);}catch(error){$('#hardwareOutput').textContent=error.message;}}
$('#refreshHardware').addEventListener('click',refreshHardware);$('#recommendRuntime').addEventListener('click',async()=>{try{$('#runtimeOutput').textContent=JSON.stringify(await api('/api/v1/runtime/recommendation',{method:'POST',body:JSON.stringify({modelBillions:Number($('#modelSize').value),quantizationBits:Number($('#quantBits').value),profile:'Automatic'})}),null,2);}catch(error){setStatus(error.message,true);}});
$$('[data-mode]').forEach((button)=>button.addEventListener('click',()=>{if(button.disabled)return;codenMode=button.dataset.mode;$$('[data-mode]').forEach((item)=>item.classList.toggle('selected',item===button));$('#modeLabel').textContent=`${codenMode.replace('_',' ')} MODE`;$('#ownerReauth').classList.toggle('hidden',codenMode!=='OWNER_BYPASS');}));
$('#analyzePath').addEventListener('click',async()=>{try{currentPathPlan=await api('/api/v1/coden/path-plan',{method:'POST',body:JSON.stringify({path:$('#pathInput').value,operation:$('#operation').value,recursive:$('#recursive').checked,mode:codenMode,dependencies:[],commands:[]})});$('#pathResult').textContent=JSON.stringify(currentPathPlan,null,2);$('#approvalControls').classList.remove('hidden');}catch(error){$('#pathResult').textContent=JSON.stringify(error.value??{error:error.message},null,2);}});
$('#reauthButton').addEventListener('click',async()=>{try{const result=await api('/api/v1/auth/reauth',{method:'POST',body:JSON.stringify({password:$('#reauthPassword').value,totpCode:$('#reauthTotp').value})});$('#pathResult').textContent=`Owner scope unlocked until ${result.expiresAt}`;}catch(error){setStatus(error.message,true);}});$('#authorizePlan').addEventListener('click',async()=>{if(!currentPathPlan)return;try{$('#pathResult').textContent=JSON.stringify(await api('/api/v1/coden/authorize',{method:'POST',body:JSON.stringify({plan:currentPathPlan,consentScope:$('#consentScope').value,durationMinutes:Number($('#duration').value)})}),null,2);}catch(error){setStatus(error.message,true);}});
// --- global error boundary -------------------------------------------------
// Nothing may fail silently. Anything that escapes a handler surfaces here as a
// message with a correlation ID, never as a stack trace, and never as a console-only
// event the operator will not see.
window.addEventListener('error',(event)=>{
  toast('Unexpected interface error. The action did not complete.',{kind:'error'});
  if(window.__noesarDebug)console.error(event.error??event.message);
});
window.addEventListener('unhandledrejection',(event)=>{
  const error=event.reason;
  if(error?.status===401){
    // The session ended underneath us. Say so instead of failing mutely.
    toast('Your session ended. Please sign in again.',{kind:'error'});
    currentUser=null;csrfToken='';$('#authGate').classList.remove('hidden');showOnly('#loginForm');
    event.preventDefault();return;
  }
  reportError(error,'Unexpected error');
  if(window.__noesarDebug)console.error(error);
  event.preventDefault();
});

// ===========================================================================
// Settings · Security · Users · System Health · Updates · Logs · Backups · About
//
// Each section owns a loader registered in VIEW_LOADERS, so a page fetches its own
// data when it is opened. Nothing here is added to ROUTES before its loader works: a
// nav entry whose panel sits on "Loading…" is worse than no entry at all, and is the
// defect this work exists to remove.
// ===========================================================================
const UNSET='—';
function shown(value,fallback=UNSET){
  return value===null||value===undefined||value===''?fallback:String(value);
}
function isoToLocal(value){
  if(!value)return UNSET;
  const parsed=Date.parse(value);
  return Number.isNaN(parsed)?String(value):formatInstant(new Date(parsed));
}
function metrics(node,entries){
  node.innerHTML=entries
    .map(([label,value,tone])=>`<div class="metric"><span>${escapeHtml(label)}</span><b class="${escapeHtml(tone??'')}">${escapeHtml(shown(value))}</b></div>`)
    .join('');
}
function badge(node,label,kind='off'){
  if(!node)return;
  node.className=`badge badge-${kind}`;
  node.textContent=label;
}
// A panel that cannot load says why, in the panel. Leaving "Loading…" on screen is
// exactly the failure this phase is fixing, so no loader is allowed to fail silently.
async function panel(node,label,work){
  try{return await work();}
  catch(error){
    if(node)node.textContent=`Could not load ${label}: ${error.message}`;
    reportError(error,label);
    return null;
  }
}

// --- settings --------------------------------------------------------------
function timezoneChoices(){
  try{
    const zones=Intl.supportedValuesOf?.('timeZone');
    if(Array.isArray(zones)&&zones.length)return zones;
  }catch{/* engine without supportedValuesOf; fall through to the short list */}
  return ['UTC','Europe/London','Europe/Berlin','Europe/Rome','Europe/Madrid','America/New_York','America/Chicago','America/Los_Angeles','Asia/Tokyo','Asia/Singapore','Australia/Sydney'];
}
function fillZoneSelect(select,selected,{inherit=null}={}){
  if(!select)return;
  const zones=timezoneChoices();
  const listed=selected&&!zones.includes(selected)?[selected,...zones]:zones;
  select.innerHTML=(inherit?`<option value="">${escapeHtml(inherit)}</option>`:'')
    +listed.map((zone)=>`<option value="${escapeHtml(zone)}" ${zone===selected?'selected':''}>${escapeHtml(zone)}</option>`).join('');
}
async function loadSettings(){
  const summary=$('#settingsTimezoneSummary');
  await panel(summary,'time zone',async()=>{
    let browserZone='';
    try{browserZone=Intl.DateTimeFormat().resolvedOptions().timeZone??'';}catch{browserZone='';}
    const tz=await api(`/api/v1/settings/timezone?browserTimezone=${encodeURIComponent(browserZone)}`);
    summary.textContent=[
      `effective       ${shown(tz.effective)}`,
      `resolved from   ${shown(tz.source)}`,
      `server default  ${shown(tz.serverDefault)}`,
      `browser reports ${shown(tz.browserReported)}`,
      `offset          ${shown(tz.offsetMinutes)} minutes`,
      `sample          ${shown(tz.sample)}`,
      `utc now         ${shown(tz.utcNow)}`,
      tz.mismatch?'note            your browser zone differs from the effective zone':'',
      tz.warning?`warning         ${tz.warning}`:'',
    ].filter(Boolean).join('\n');
    badge($('#settingsTimezoneTier'),shown(tz.source),tz.warning?'warn':'on');
    fillZoneSelect($('#settingsTimezone'),tz.effective,{inherit:'Use server default'});
    const ownerRow=$('#settingsServerRow');
    ownerRow.classList.toggle('hidden',currentUser?.role!=='owner');
    if(currentUser?.role==='owner')fillZoneSelect($('#settingsServerTimezone'),tz.serverDefault);
  });
  const localeBox=$('#settingsLocaleSummary');
  await panel(localeBox,'locale',async()=>{
    const locale=await api('/api/v1/settings/locale');
    localeBox.textContent=[
      `effective  ${shown(locale.effective)}`,
      `source     ${shown(locale.source)}`,
      `supported  ${(locale.supported??[]).join(', ')||UNSET}`,
    ].join('\n');
    $('#settingsLocale').value=locale.effective??'';
  });
}
$('#settingsTimezoneSave').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  const zone=$('#settingsTimezone').value;
  if(!zone)return toast('Choose a time zone, or use "Use server default".',{kind:'error'});
  try{
    await api('/api/v1/settings/timezone',{method:'PUT',body:JSON.stringify({timezone:zone})});
    toast('Time zone saved.',{kind:'success'});
    await loadSettings();
  }catch(error){reportError(error,'Save time zone');}
}));
$('#settingsTimezoneClear').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/settings/timezone',{method:'PUT',body:JSON.stringify({timezone:null})});
    toast('Your override was removed. The server default now applies.',{kind:'success'});
    await loadSettings();
  }catch(error){reportError(error,'Clear time zone');}
}));
$('#settingsServerSave').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/settings/timezone',{method:'PUT',body:JSON.stringify({scope:'server',timezone:$('#settingsServerTimezone').value})});
    toast('Server default time zone saved.',{kind:'success'});
    await loadSettings();
  }catch(error){reportError(error,'Save server time zone');}
}));
$('#settingsLocaleSave').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/settings/locale',{method:'PUT',body:JSON.stringify({locale:$('#settingsLocale').value.trim()})});
    toast('Locale saved.',{kind:'success'});
    await loadSettings();
  }catch(error){reportError(error,'Save locale');}
}));

// --- security --------------------------------------------------------------
function renderSessions(sessions){
  const host=$('#sessionList');
  if(!sessions.length){host.className='card-list empty-state';host.textContent='No active sessions.';return;}
  host.className='card-list';
  host.innerHTML=sessions.map((session)=>`<article class="entity-card">
      <h3>${session.current?'This session':'Other session'} ${session.elevated?'<span class="badge badge-warn">elevated</span>':''}</h3>
      <p>Started ${escapeHtml(isoToLocal(session.createdAt))} · last seen ${escapeHtml(isoToLocal(session.lastSeenAt))}</p>
      <small>Expires ${escapeHtml(isoToLocal(session.expiresAt))} · MFA ${session.mfa?'verified':'not verified'}</small>
      ${session.current?'':`<div class="inline-form"><button data-revoke-session="${escapeHtml(session.id)}">Sign out this session</button></div>`}
    </article>`).join('');
  $$('[data-revoke-session]').forEach((button)=>button.addEventListener('click',()=>withBusy(button,async()=>{
    try{
      await api('/api/v1/auth/sessions/revoke',{method:'POST',body:JSON.stringify({sessionId:button.dataset.revokeSession})});
      toast('Session signed out.',{kind:'success'});
      await loadSecurity();
    }catch(error){reportError(error,'Sign out session');}
  })));
}
function renderPasskeys(passkeys){
  $('#passkeyCount').textContent=passkeys.length;
  const host=$('#passkeyList');
  if(!passkeys.length){host.className='card-list empty-state';host.textContent='No passkeys added yet.';return;}
  host.className='card-list';
  host.innerHTML=passkeys.map((passkey)=>`<article class="entity-card">
      <h3>${escapeHtml(passkey.name)}</h3>
      <p>Added ${escapeHtml(isoToLocal(passkey.createdAt))}</p>
      <small>Last used ${passkey.lastUsedAt?escapeHtml(isoToLocal(passkey.lastUsedAt)):'never'}</small>
      <div class="inline-form"><button data-remove-passkey="${escapeHtml(passkey.id)}" data-passkey-name="${escapeHtml(passkey.name)}">Remove</button></div>
    </article>`).join('');
  $$('[data-remove-passkey]').forEach((button)=>button.addEventListener('click',()=>{
    passkeyRemoveId=button.dataset.removePasskey;
    $('#passkeyRemoveName').textContent=button.dataset.passkeyName;
    $('#passkeyRemoveForm').classList.remove('hidden');
    $('#passkeyRemoveForm').scrollIntoView({behavior:'smooth',block:'nearest'});
  }));
}
async function loadSecurity(){
  const overview=$('#securityOverview');
  await panel(overview,'account security',async()=>{
    const data=await api('/api/v1/auth/security');
    metrics(overview,[
      ['Username',data.username],['Display name',data.displayName],['Role',data.role],
      ['Authenticator',data.mfaEnabled?'enrolled':'not enrolled',data.mfaEnabled?'green':'red'],
      ['Authenticator changed',isoToLocal(data.mfaUpdatedAt)],
      ['Password changed',isoToLocal(data.passwordUpdatedAt)],
      ['Recovery codes left',data.recoveryCodesRemaining,Number(data.recoveryCodesRemaining)>0?'':'amber'],
      ['Active sessions',data.sessionCount],
      ['Failed sign-ins',data.failedLoginCount],
      ['Account',data.locked?`locked until ${isoToLocal(data.lockedUntil)}`:'active',data.locked?'red':'green'],
      ['Passkeys',(data.passkeys??[]).length],
    ]);
    badge($('#securityMfaBadge'),data.mfaEnabled?'MFA enrolled':'MFA missing',data.mfaEnabled?'on':'danger');
    renderSessions(data.sessions??[]);
    renderPasskeys(data.passkeys??[]);
  });
}
function showRecoveryCodes(node,codes,heading){
  node.classList.remove('hidden');
  node.innerHTML=`<div class="token-reveal"><b>${escapeHtml(heading)}</b>
      <p class="hint">Shown once. They are stored only as digests and cannot be displayed again.</p>
      <div class="recovery-codes">${codes.map((code)=>`<code>${escapeHtml(code)}</code>`).join('')}</div></div>`;
}
$('#securityPasswordForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const form=event.currentTarget;const submit=form.querySelector('button');
  return withBusy(submit,async()=>{
    try{
      const result=await api('/api/v1/auth/password',{method:'POST',body:JSON.stringify({
        currentPassword:$('#secCurrentPassword').value,totpCode:$('#secTotpCode').value,
        newPassword:$('#secNewPassword').value,revokeOtherSessions:$('#secRevokeOthers').checked,
      })});
      form.reset();$('#secRevokeOthers').checked=true;
      toast(`Password changed. ${result.revokedSessions??0} other session(s) signed out.`,{kind:'success'});
      await loadSecurity();
    }catch(error){reportError(error,'Change password');}
  });
});
$('#recoveryForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const submit=event.currentTarget.querySelector('button');
  return withBusy(submit,async()=>{
    try{
      const result=await api('/api/v1/auth/recovery-codes',{method:'POST',body:JSON.stringify({
        password:$('#recoveryPassword').value,totpCode:$('#recoveryTotp').value,
      })});
      $('#recoveryPassword').value='';$('#recoveryTotp').value='';
      showRecoveryCodes($('#recoveryCodesBox'),result.codes??[],'Your new recovery codes');
      toast('New recovery codes issued. The previous ones no longer work.',{kind:'success'});
      await loadSecurity();
    }catch(error){reportError(error,'Regenerate recovery codes');}
  });
});
function renderMfaEnrolment(challenge){
  mfaReplacement=challenge;
  $('#mfaEnrolBox').classList.remove('hidden');
  badge($('#mfaReplaceState'),'Awaiting confirmation','warn');
  $('#mfaManualKey').textContent=challenge.secret??'';
  const target=$('#mfaQr');
  try{
    target.innerHTML=qrSvg(challenge.otpauthUri,{title:'Authenticator enrolment QR code'});
  }catch(error){
    // The encoder refuses versions it has not been proven to produce correctly. Saying
    // so and falling back to the typed key is honest; drawing a symbol that may not
    // decode is the failure mode this project has a standing rule against.
    target.replaceChildren();
    target.textContent='QR unavailable — use the key';
    toast(`QR code not rendered: ${error.message} Enter the key by hand instead.`,{kind:'error'});
  }
}
$('#mfaReplaceForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const submit=event.currentTarget.querySelector('button');
  return withBusy(submit,async()=>{
    try{
      const challenge=await api('/api/v1/auth/mfa/replace',{method:'POST',body:JSON.stringify({
        password:$('#mfaPassword').value,totpCode:$('#mfaTotp').value,
      })});
      $('#mfaPassword').value='';$('#mfaTotp').value='';
      renderMfaEnrolment(challenge);
      toast('Scan the code, then confirm with two consecutive codes. Your current authenticator still works until you do.',{kind:'success'});
    }catch(error){reportError(error,'Begin authenticator replacement');}
  });
});
$('#mfaConfirmForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const submit=event.currentTarget.querySelector('button');
  return withBusy(submit,async()=>{
    if(!mfaReplacement)return toast('Start the replacement first.',{kind:'error'});
    try{
      const result=await api('/api/v1/auth/mfa/replace/confirm',{method:'POST',body:JSON.stringify({
        challenge:mfaReplacement.challenge,firstCode:$('#mfaFirstCode').value,secondCode:$('#mfaSecondCode').value,
      })});
      $('#mfaFirstCode').value='';$('#mfaSecondCode').value='';
      $('#mfaQr').replaceChildren();$('#mfaManualKey').textContent='';
      $('#mfaEnrolBox').classList.add('hidden');
      mfaReplacement=null;
      badge($('#mfaReplaceState'),'Replaced','on');
      showRecoveryCodes($('#recoveryCodesBox'),result.recoveryCodes??[],'Recovery codes for your new authenticator');
      navigate('security');
      toast(`Authenticator replaced. ${result.revokedSessions??0} other session(s) signed out.`,{kind:'success'});
      await loadSecurity();
    }catch(error){reportError(error,'Confirm authenticator replacement');}
  });
});
$('#mfaCancel').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/auth/mfa/replace/cancel',{method:'POST',body:'{}'});
    mfaReplacement=null;
    $('#mfaEnrolBox').classList.add('hidden');
    $('#mfaQr').replaceChildren();$('#mfaManualKey').textContent='';
    badge($('#mfaReplaceState'),'Not started','off');
    toast('Replacement cancelled. Your existing authenticator is unchanged.',{kind:'success'});
  }catch(error){reportError(error,'Cancel authenticator replacement');}
}));
$('#revokeOthers').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    const result=await api('/api/v1/auth/sessions/revoke-others',{method:'POST',body:'{}'});
    toast(`${result.revoked??0} other session(s) signed out.`,{kind:'success'});
    await loadSecurity();
  }catch(error){reportError(error,'Sign out other sessions');}
}));
$('#passkeyAddForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const form=event.currentTarget;const submit=form.querySelector('button');
  return withBusy(submit,async()=>{
    try{
      const options=await api('/api/v1/auth/passkeys/register',{method:'POST',body:JSON.stringify({
        password:$('#passkeyPassword').value,totpCode:$('#passkeyTotp').value,
      })});
      const credential=await navigator.credentials.create({publicKey:{
        challenge:base64urlToBytes(options.challenge),
        rp:{id:options.rpId,name:options.rpName},
        user:{id:base64urlToBytes(options.userHandle),name:options.username,displayName:options.displayName},
        pubKeyCredParams:options.pubKeyCredParams,
        attestation:options.attestation,
        authenticatorSelection:{userVerification:options.userVerification},
        excludeCredentials:(options.excludeCredentials??[]).map((entry)=>({type:entry.type,id:base64urlToBytes(entry.id)})),
        timeout:60000,
      }});
      const result=await api('/api/v1/auth/passkeys/register/confirm',{method:'POST',body:JSON.stringify({
        challenge:options.challenge,
        credentialId:bytesToBase64url(credential.rawId),
        clientDataJSON:bytesToBase64url(credential.response.clientDataJSON),
        attestationObject:bytesToBase64url(credential.response.attestationObject),
        name:$('#passkeyName').value,
      })});
      form.reset();
      toast(`Passkey "${result.passkey.name}" added.`,{kind:'success'});
      await loadSecurity();
    }catch(error){reportError(error,'Add passkey');}
  });
});
$('#passkeyRemoveForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const form=event.currentTarget;const submit=form.querySelector('button');
  return withBusy(submit,async()=>{
    if(!passkeyRemoveId)return toast('Choose a passkey to remove first.',{kind:'error'});
    try{
      await api('/api/v1/auth/passkeys/remove',{method:'POST',body:JSON.stringify({
        password:$('#passkeyRemovePassword').value,totpCode:$('#passkeyRemoveTotp').value,credentialId:passkeyRemoveId,
      })});
      form.reset();
      form.classList.add('hidden');
      passkeyRemoveId=null;
      toast('Passkey removed.',{kind:'success'});
      await loadSecurity();
    }catch(error){reportError(error,'Remove passkey');}
  });
});
$('#passkeyRemoveCancel').addEventListener('click',()=>{
  passkeyRemoveId=null;
  $('#passkeyRemoveForm').reset();
  $('#passkeyRemoveForm').classList.add('hidden');
});

// --- users -----------------------------------------------------------------
async function loadUsers(){
  const list=$('#usersList');
  await panel(list,'accounts',async()=>{
    const data=await api('/api/v1/admin/users');
    const roles=data.roles??[];
    const select=$('#inviteRole');
    const chosen=select.value;
    select.innerHTML=roles
      .filter((entry)=>entry.role!=='owner')
      .map((entry)=>`<option value="${escapeHtml(entry.role)}" ${entry.role===chosen?'selected':''}>${escapeHtml(entry.role)}${entry.mfaRequired?' · MFA required':''}</option>`)
      .join('');
    const users=data.users??[];
    $('#userCount').textContent=String(users.length);
    if(!users.length){list.className='card-list empty-state';list.textContent='No accounts.';return;}
    list.className='card-list';
    list.innerHTML=users.map((user)=>{
      const disabled=user.status!=='active';
      return `<article class="entity-card">
        <h3>${escapeHtml(user.displayName)} <span class="badge ${disabled?'badge-warn':'badge-on'}">${escapeHtml(user.status)}</span></h3>
        <p>${escapeHtml(user.username)} · ${escapeHtml(user.role)}${user.mfaEnabled?' · MFA enrolled':user.mfaRequired?' · MFA REQUIRED, not enrolled':''}</p>
        <small>Created ${escapeHtml(isoToLocal(user.createdAt))} · last sign-in ${escapeHtml(isoToLocal(user.lastLoginAt))}${user.disabledReason?` · ${escapeHtml(user.disabledReason)}`:''}</small>
        <div class="inline-form">
          ${user.role==='owner'?'<small>The owner account cannot be changed from here.</small>':`
            <select data-role-for="${escapeHtml(user.id)}">${roles.map((entry)=>`<option value="${escapeHtml(entry.role)}" ${entry.role===user.role?'selected':''}>${escapeHtml(entry.role)}</option>`).join('')}</select>
            <button data-set-role="${escapeHtml(user.id)}">Change role</button>
            ${disabled
              ? `<button data-reinstate="${escapeHtml(user.id)}">Reinstate</button>`
              : `<button class="danger" data-disable="${escapeHtml(user.id)}">Disable</button>`}
            <button data-revoke-user="${escapeHtml(user.id)}">Revoke sessions</button>`}
        </div>
      </article>`;
    }).join('');
    const act=async(button,path,body,message)=>withBusy(button,async()=>{
      try{
        await api(path,{method:'POST',body:JSON.stringify(body)});
        toast(message,{kind:'success'});
        await loadUsers();
      }catch(error){reportError(error,message);}
    });
    $$('[data-set-role]').forEach((button)=>button.addEventListener('click',()=>{
      const id=button.dataset.setRole;
      act(button,`/api/v1/admin/users/${id}/role`,{role:$(`[data-role-for="${id}"]`).value},'Role changed');
    }));
    $$('[data-disable]').forEach((button)=>button.addEventListener('click',()=>
      act(button,`/api/v1/admin/users/${button.dataset.disable}/disable`,{reason:'Disabled from the Users page'},'Account disabled')));
    $$('[data-reinstate]').forEach((button)=>button.addEventListener('click',()=>
      act(button,`/api/v1/admin/users/${button.dataset.reinstate}/reinstate`,{},'Account reinstated')));
    $$('[data-revoke-user]').forEach((button)=>button.addEventListener('click',()=>
      act(button,`/api/v1/admin/users/${button.dataset.revokeUser}/revoke`,{},'Sessions revoked')));
  });
  const invitations=$('#invitationList');
  await panel(invitations,'invitations',async()=>{
    const data=await api('/api/v1/admin/invitations');
    const open=data.invitations??[];
    $('#invitationCount').textContent=String(open.filter((item)=>item.state==='open').length);
    if(!open.length){invitations.className='card-list empty-state';invitations.textContent='No invitations.';return;}
    invitations.className='card-list';
    invitations.innerHTML=open.map((item)=>`<article class="entity-card">
        <h3>${escapeHtml(item.displayName)} <span class="badge ${item.state==='open'?'badge-on':'badge-off'}">${escapeHtml(item.state)}</span></h3>
        <p>${escapeHtml(item.username)} · ${escapeHtml(item.role)}</p>
        <small>Created ${escapeHtml(isoToLocal(item.createdAt))} · expires ${escapeHtml(isoToLocal(item.expiresAt))}</small>
        ${item.state==='open'?`<div class="inline-form"><button class="danger" data-revoke-invitation="${escapeHtml(item.id)}">Revoke</button></div>`:''}
      </article>`).join('');
    $$('[data-revoke-invitation]').forEach((button)=>button.addEventListener('click',()=>withBusy(button,async()=>{
      try{
        await api(`/api/v1/admin/invitations/${button.dataset.revokeInvitation}`,{method:'DELETE'});
        toast('Invitation revoked.',{kind:'success'});
        await loadUsers();
      }catch(error){reportError(error,'Revoke invitation');}
    })));
  });
}
$('#invitationForm').addEventListener('submit',(event)=>{
  event.preventDefault();
  const submit=event.currentTarget.querySelector('button');
  return withBusy(submit,async()=>{
    try{
      const created=await api('/api/v1/admin/invitations',{method:'POST',body:JSON.stringify({
        username:$('#inviteUsername').value.trim(),displayName:$('#inviteDisplayName').value.trim(),role:$('#inviteRole').value,
      })});
      $('#inviteUsername').value='';$('#inviteDisplayName').value='';
      const box=$('#invitationTokenBox');
      box.classList.remove('hidden');
      box.innerHTML=`<div class="token-reveal"><b>Invitation token for ${escapeHtml(created.invitation.username)}</b>
          <p class="hint">${escapeHtml(created.note??'Shown once.')} Give it to the invitee over a channel you trust — they choose their own password.</p>
          <code>${escapeHtml(created.token)}</code></div>`;
      toast('Invitation created. The token is shown once.',{kind:'success'});
      await loadUsers();
    }catch(error){reportError(error,'Create invitation');}
  });
});

// --- system health ---------------------------------------------------------
async function loadHealth(){
  const components=$('#healthComponents');
  await panel(components,'health',async()=>{
    const health=await api('/healthz');
    const list=Array.isArray(health.components)?health.components:[];
    const degraded=list.filter((item)=>item.status&&item.status!=='healthy');
    metrics(components,[
      ['Overall',health.status,health.status==='healthy'?'green':'amber'],
      ['Components',list.length],
      ['Degraded',degraded.length,degraded.length?'amber':'green'],
      ['Version',health.version??health.product?.version],
      ['Uptime seconds',health.uptimeSeconds],
      ...list.map((item)=>[item.name??'component',item.status,item.status==='healthy'?'green':'amber']),
    ]);
    badge($('#healthBadge'),shown(health.status),health.status==='healthy'?'on':'warn');
  });
  const watchdogBox=$('#watchdogReport');
  await panel(watchdogBox,'watchdog',async()=>{
    const report=await api('/api/v1/watchdog');
    watchdogBox.textContent=[
      `safe mode          ${report.safeMode}`,
      `crash loop         ${report.crashLoop}`,
      `restarts in window ${report.restartsInWindow}`,
      `essential failures ${(report.essentialFailures??[]).join(', ')||'none'}`,
      '',
      'subjects:',
      ...(report.subjects??[]).map((subject)=>`  ${subject.name}  healthy=${subject.healthy}  essential=${subject.essential}`),
      '',
      'recent escalations:',
      ...((report.escalations??[]).slice(-5).map((item)=>`  ${JSON.stringify(item)}`)),
    ].join('\n');
    $('#leaveSafeMode').classList.toggle('hidden',!report.safeMode);
  });
  const database=$('#databaseStatus');
  await panel(database,'data plane',async()=>{
    const status=await api('/api/v1/database/status');
    database.textContent=JSON.stringify(status,null,2);
  });
}
$('#runWatchdog').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/watchdog/run',{method:'POST',body:'{}'});
    toast('Watchdog check completed.',{kind:'success'});
    await loadHealth();
  }catch(error){reportError(error,'Run watchdog check');}
}));
$('#leaveSafeMode').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/watchdog/safe-mode/leave',{method:'POST',body:'{}'});
    toast('Left safe mode.',{kind:'success'});
    await loadHealth();
  }catch(error){reportError(error,'Leave safe mode');}
}));

// --- updates ---------------------------------------------------------------
async function loadUpdates(){
  const box=$('#updatesStatus');
  await panel(box,'update status',async()=>{
    const status=await api('/api/v1/updates/status');
    metrics(box,[
      ['Channel',status.channel],
      ['Installed version',status.installedVersion],
      ['Highest ever installed',status.highestEverInstalled],
      ['Previous version',status.previousVersion],
      ['Last check',isoToLocal(status.lastCheckUtc)],
      ['Staged',status.staged?'yes':'no',status.staged?'amber':''],
      ['Owner approval required',status.ownerApprovalRequired?'yes':'no'],
      ['Automatic install',status.automaticInstall?'yes':'no'],
      ['Portal configured',status.portalConfigured?'yes':'no'],
      ['Pinned channel keys',(status.pinnedChannelKeys??[]).join(', ')||'none',(status.pinnedChannelKeys??[]).length?'':'amber'],
    ]);
    badge($('#updatesBadge'),status.staged?'Update staged':'Up to date',status.staged?'warn':'on');
    const select=$('#updateChannel');
    select.innerHTML=(status.channels??[]).map((channel)=>`<option value="${escapeHtml(channel)}" ${channel===status.channel?'selected':''}>${escapeHtml(channel)}</option>`).join('');
  });
  const history=$('#updatesHistory');
  await panel(history,'update history',async()=>{
    const data=await api('/api/v1/updates/history');
    const entries=data.history??data.entries??(Array.isArray(data)?data:[]);
    if(!entries.length){history.className='card-list empty-state';history.textContent='No update has been applied on this installation.';return;}
    history.className='card-list';
    history.innerHTML=entries.map((entry)=>`<article class="entity-card">
        <h3>${escapeHtml(shown(entry.version))}</h3>
        <small>${escapeHtml(shown(entry.result??entry.action))} · ${escapeHtml(isoToLocal(entry.utcTimestamp??entry.at))}</small>
      </article>`).join('');
  });
}
const updateAction=(button,path,body,label)=>withBusy(button,async()=>{
  try{
    await api(path,{method:'POST',body:JSON.stringify(body??{})});
    toast(`${label} completed.`,{kind:'success'});
    await loadUpdates();
  }catch(error){reportError(error,label);}
});
$('#checkUpdates').addEventListener('click',(event)=>updateAction(event.currentTarget,'/api/v1/updates/check',{},'Update check'));
$('#applyChannel').addEventListener('click',(event)=>updateAction(event.currentTarget,'/api/v1/updates/channel',{channel:$('#updateChannel').value},'Channel change'));
$('#approveUpdate').addEventListener('click',(event)=>updateAction(event.currentTarget,'/api/v1/updates/approve',{},'Approval'));
$('#applyUpdate').addEventListener('click',(event)=>updateAction(event.currentTarget,'/api/v1/updates/apply',{},'Apply'));
$('#rollbackUpdate').addEventListener('click',(event)=>updateAction(event.currentTarget,'/api/v1/updates/rollback',{},'Rollback'));

// --- owner modules (D-0277, reauth removed D-0278) ---------------------------
// GET /api/v1/sector-modules/catalog merges the fixed NOESAR catalog with live
// install/activate status — the SAME payload drives both the sidebar link and the
// Settings > Modules cards, so there is exactly one source of truth for "is this
// module reachable right now", never two lists that can disagree. Install/activate
// need only the NOESAR owner session (D-0278) — no separate step-up prompt.
function renderModulesNav(modules){
  const nav=$('#navModules');
  if(!nav)return;
  nav.innerHTML=modules.filter((item)=>item.status==='active').map((item)=>
    `<a class="nav" href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener noreferrer">▣ <span>${escapeHtml(item.name)} ↗</span></a>`
  ).join('');
}
// Card C (s313/s317 addendum): CodeN's own Tools/Plugins panel became a second window onto
// this SAME catalogue — "non un elenco nuovo da inventare" — so the render logic is shared
// and only the target container differs. Binding is scoped to the container just rendered
// (`list.querySelectorAll`, not the page-wide `$$`): calling this twice, once per container,
// over the page-wide selector would rebind a second listener onto whichever container
// rendered first, and every click there would fire the action twice.
function renderModuleCatalog(containerId,modules){
  const list=$(containerId);
  if(!list)return;
  list.className=modules.length?'card-list module-grid':'card-list empty-state';
  list.innerHTML=modules.map((item)=>{
    const badge=item.status==='active'?'badge-on':'badge-off';
    const label=item.status==='active'?'Active':item.status==='installed'?'Installed':'Not installed';
    const action=item.status==='not-installed'?'install':item.status==='installed'?'activate':'deactivate';
    const actionLabel=action==='install'?'Install':action==='activate'?'Activate':'Deactivate';
    const actionClass=action==='deactivate'?'danger':'primary';
    const initial=escapeHtml((item.name||'?').trim().charAt(0).toUpperCase());
    const sectors=(item.sector??[]).map((s)=>`<span class="tag">${escapeHtml(s)}</span>`).join('');
    return `<article class="entity-card module-card" data-owner-module-card="${item.id}">
      <div class="module-head">
        <div class="module-icon" aria-hidden="true">${initial}</div>
        <div class="module-head-text">
          <h3>${escapeHtml(item.name)}</h3>
          <div class="module-meta">
            <span class="tag trust-official">${escapeHtml(item.trustLevel??'')}</span>
            <span>v${escapeHtml(item.version??'—')}</span>
            <span>·</span>
            <span>${escapeHtml(item.publisher??'—')}</span>
          </div>
        </div>
        <span class="badge ${badge} module-status">${label}</span>
      </div>
      <p>${escapeHtml(item.description)}</p>
      ${sectors?`<div class="module-tags">${sectors}</div>`:''}
      <div class="module-actions">
        ${item.status==='active'?`<a class="text-button" href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener noreferrer">Open ↗</a>`:''}
        ${item.id==='debug-evolution'&&item.status==='active'?'<button class="secondary" data-debug-evolution-triage type="button">Triage findings</button>':''}
        ${item.status==='not-installed'?'':`<button class="text-button danger" data-module-action="uninstall" data-module-id="${item.id}" type="button">Uninstall</button>`}
        <button class="${actionClass}" data-module-action="${action}" data-module-id="${item.id}" type="button">${actionLabel}</button>
      </div>
    </article>`;
  }).join('')||'No Owner modules known.';
  list.querySelectorAll('[data-module-action]').forEach((button)=>button.addEventListener('click',()=>runModuleAction(button.dataset.moduleAction,button.dataset.moduleId,button)));
  list.querySelectorAll('[data-debug-evolution-triage]').forEach((button)=>button.addEventListener('click',()=>runDebugEvolutionTriage(button)));
}
function renderOwnerModules(modules){renderModuleCatalog('#ownerModulesList',modules);}
// D-0284: Phase 2, first slice (discovery+skeptic) — manual trigger, same posture as the
// module lifecycle actions above: cost/latency per finding not yet measured on this
// deployment, so this stays a deliberate click rather than something that fires on its own.
async function runDebugEvolutionTriage(button){
  await withBusy(button,async()=>{
    try{
      const result=await api('/api/v1/debug-evolution/triage',{method:'POST',body:'{}'});
      toast(`Triage: ${result.succeeded}/${result.triaged} findings updated.`,{kind:'success'});
    }catch(error){
      reportError(error,'debug evolution triage');
    }
  });
}
// D-0286: Debug Evolution Phase 3 — remote targets over SSH. Two states rendered
// differently: `awaiting-key` (host verified, no credential yet — the Owner confirms the
// fingerprint out of band and pastes a private key) and `active` (usable, Fetch & Scan
// available). The credential itself is never displayed back — only whether one is
// configured, same as every other credentialled entity in this product.
function renderRemoteTargets(targets){
  const list=$('#remoteTargetsList');
  if(!list)return;
  list.className=targets.length?'card-list':'card-list empty-state';
  list.innerHTML=targets.map((target)=>{
    const lastFetch=target.lastFetch?(target.lastFetch.ok?`Last fetch: ${escapeHtml(new Date(target.lastFetch.at).toLocaleString())} — OK`:`Last fetch failed: ${escapeHtml(target.lastFetch.error??'unknown error')}`):'Never fetched.';
    if(target.status==='awaiting-key'){
      return `<article class="entity-card" data-remote-target-card="${target.id}">
        <h3>${escapeHtml(target.name)}</h3>
        <p>${escapeHtml(target.username)}@${escapeHtml(target.host)}:${escapeHtml(String(target.port))} — <code>${escapeHtml(target.remotePath)}</code></p>
        <p class="hint">Host key fingerprint — confirm this matches what you already know about this host before pasting a key:<br><code>${escapeHtml(target.fingerprint)}</code></p>
        <label>Private key (PEM)<textarea data-remote-target-key="${target.id}" rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea></label>
        <div class="inline-form">
          <button class="primary" data-remote-target-activate="${target.id}" type="button">Activate</button>
          <button class="text-button danger" data-remote-target-remove="${target.id}" type="button">Discard</button>
        </div>
      </article>`;
    }
    return `<article class="entity-card" data-remote-target-card="${target.id}">
      <h3>${escapeHtml(target.name)} <span class="badge badge-on">Active</span></h3>
      <p>${escapeHtml(target.username)}@${escapeHtml(target.host)}:${escapeHtml(String(target.port))} — <code>${escapeHtml(target.remotePath)}</code></p>
      <small>${lastFetch}</small>
      <div class="inline-form">
        <button class="primary" data-remote-target-fetch="${target.id}" type="button">Fetch &amp; scan</button>
        <button class="text-button danger" data-remote-target-remove="${target.id}" type="button">Remove</button>
      </div>
    </article>`;
  }).join('')||'No remote targets registered.';
  $$('[data-remote-target-activate]').forEach((button)=>button.addEventListener('click',()=>activateRemoteTarget(button.dataset.remoteTargetActivate,button)));
  $$('[data-remote-target-fetch]').forEach((button)=>button.addEventListener('click',()=>fetchAndScanRemoteTarget(button.dataset.remoteTargetFetch,button)));
  $$('[data-remote-target-remove]').forEach((button)=>button.addEventListener('click',()=>removeRemoteTarget(button.dataset.remoteTargetRemove,button)));
}
async function loadRemoteTargets(){
  const data=await api('/api/v1/debug-evolution/remote-targets');
  renderRemoteTargets(data.targets??[]);
}
async function registerRemoteTarget(){
  const button=$('#registerRemoteTarget');
  await withBusy(button,async()=>{
    try{
      const payload={
        name:$('#remoteTargetName').value.trim(),
        host:$('#remoteTargetHost').value.trim(),
        port:Number($('#remoteTargetPort').value)||22,
        username:$('#remoteTargetUsername').value.trim(),
        remotePath:$('#remoteTargetPath').value.trim(),
      };
      await api('/api/v1/debug-evolution/remote-targets',{method:'POST',body:JSON.stringify(payload)});
      toast('Host key captured — confirm the fingerprint, then paste a key to activate.',{kind:'success'});
      for(const id of ['remoteTargetName','remoteTargetHost','remoteTargetUsername','remoteTargetPath'])$(`#${id}`).value='';
      $('#remoteTargetPort').value='22';
      await loadRemoteTargets();
    }catch(error){
      reportError(error,'register remote target');
    }
  });
}
async function activateRemoteTarget(id,button){
  const privateKey=$(`[data-remote-target-key="${id}"]`)?.value.trim();
  if(!privateKey){toast('Paste the private key first.',{kind:'error'});return;}
  await withBusy(button,async()=>{
    try{
      await api(`/api/v1/debug-evolution/remote-targets/${id}/activate`,{method:'POST',body:JSON.stringify({privateKey})});
      toast('Remote target activated.',{kind:'success'});
      await loadRemoteTargets();
    }catch(error){
      reportError(error,'activate remote target');
    }
  });
}
async function fetchAndScanRemoteTarget(id,button){
  await withBusy(button,async()=>{
    try{
      const result=await api(`/api/v1/debug-evolution/remote-targets/${id}/fetch-and-scan`,{method:'POST',body:'{}'});
      toast(`Fetched and scanned — ${result.findingCount ?? 0} finding(s).`,{kind:'success'});
      await loadRemoteTargets();
    }catch(error){
      reportError(error,'fetch and scan remote target');
    }
  });
}
async function removeRemoteTarget(id,button){
  if(!confirm('Remove this remote target? Its stored key is deleted with it — this cannot be undone.'))return;
  await withBusy(button,async()=>{
    try{
      await api(`/api/v1/debug-evolution/remote-targets/${id}`,{method:'DELETE',body:'{}'});
      toast('Remote target removed.',{kind:'success'});
      await loadRemoteTargets();
    }catch(error){
      reportError(error,'remove remote target');
    }
  });
}
$('#registerRemoteTarget').addEventListener('click',registerRemoteTarget);
async function loadOwnerModules(){
  // Both catalogue containers start as "Loading…" in the markup. A fetch that throws must
  // still resolve that state one way or the other — an uncaught rejection here left it
  // reading "Loading…" forever (found rendering the CodeN copy for Card C: the failure was
  // real before, just never observed, because nothing previously checked this container for
  // being stuck). This also keeps the failure from propagating into the Promise.all() this
  // is called from, which would otherwise cancel every unrelated fetch bundled with it.
  let modules=[];
  try{
    const data=await api('/api/v1/sector-modules/catalog');
    modules=data.modules??[];
  }catch(error){
    reportError(error,'load module catalogue');
  }
  renderOwnerModules(modules);
  renderModulesNav(modules);
}
// D-0283: uninstall is the one module action that takes capability AWAY from a running
// installation (its tools stop working, its console port closes, its credential is
// revoked), so it is the one that asks first — the same posture as purging a project.
const MODULE_ACTION_DONE={install:'installed',activate:'activated',deactivate:'deactivated',uninstall:'uninstalled'};
async function runModuleAction(action,id,button){
  if(action==='uninstall'&&!confirm('Uninstall this module? Its tools stop working, its console closes, and its credential is revoked. NOESAR itself is unaffected, and you can install it again.'))return;
  await withBusy(button,async()=>{
    try{
      await api(`/api/v1/sector-modules/catalog/${id}/${action}`,{method:'POST',body:'{}'});
      toast(`Module ${MODULE_ACTION_DONE[action]??`${action}d`}.`,{kind:'success'});
      await loadOwnerModules();
    }catch(error){
      reportError(error,`module ${action}`);
    }
  });
}

// --- logs and debug mode ---------------------------------------------------
async function loadLogs(){
  const results=$('#logResults');
  await panel(results,'logs',async()=>{
    const query=new URLSearchParams();
    const put=(key,value)=>{if(value)query.set(key,value);};
    put('level',$('#logLevel').value);put('component',$('#logComponent').value.trim());
    put('correlationId',$('#logCorrelation').value.trim());put('event',$('#logEvent').value.trim());
    put('q',$('#logQuery').value.trim());put('limit',$('#logLimit').value);
    const data=await api(`/api/v1/logs?${query.toString()}`);
    const entries=data.entries??[];
    if(!entries.length){results.className='card-list empty-state';results.textContent='No log records match this filter.';return;}
    results.className='card-list';
    results.innerHTML=entries.map((entry)=>`<div class="log-row">
        <time>${escapeHtml(shown(entry.ts))}</time>
        <b class="level-${escapeHtml(shown(entry.level,'INFO'))}">${escapeHtml(shown(entry.level))}</b>
        <div class="log-msg">${escapeHtml(shown(entry.event))} — ${escapeHtml(shown(entry.component))}
          ${entry.correlation_id?`<code>${escapeHtml(entry.correlation_id)}</code>`:''}
          ${entry.error?`<br>${escapeHtml(String(entry.error))}`:''}</div>
      </div>`).join('');
    setStatus(`${entries.length} record(s)${data.truncated?' — truncated at the limit':''}, ${data.scannedFiles??0} file(s) scanned.`);
  });
  const debugBox=$('#debugStatus');
  await panel(debugBox,'debug mode',async()=>{
    const status=await api('/api/v1/debug/status');
    debugBox.textContent=[
      `enabled           ${status.enabled}`,
      `incident id       ${shown(status.incidentId)}`,
      `expires at        ${shown(status.expiresAt)}`,
      `remaining seconds ${shown(status.remainingSeconds)}`,
      `scopes            ${(status.scopes??[]).join(', ')||'none'}`,
      `available scopes  ${(status.availableScopes??[]).join(', ')}`,
      `max ttl minutes   ${shown(status.maxTtlMinutes)}`,
    ].join('\n');
    badge($('#debugBadge'),status.enabled?'Debug on':'Debug off',status.enabled?'warn':'off');
  });
}
$('#logSearch').addEventListener('click',(event)=>withBusy(event.currentTarget,()=>loadLogs()));
$('#debugEnable').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/debug/enable',{method:'POST',body:JSON.stringify({ttlMinutes:30})});
    toast('Debug mode enabled for 30 minutes. It switches itself off.',{kind:'success'});
    await loadLogs();
  }catch(error){reportError(error,'Enable debug mode');}
}));
$('#debugDisable').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/debug/disable',{method:'POST',body:'{}'});
    toast('Debug mode disabled.',{kind:'success'});
    await loadLogs();
  }catch(error){reportError(error,'Disable debug mode');}
}));
$('#debugBundle').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    const bundle=await api('/api/v1/debug/bundle');
    downloadJson(bundle,`noesar-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
    toast('Diagnostic bundle downloaded.',{kind:'success'});
  }catch(error){reportError(error,'Download diagnostic bundle');}
}));

// --- backups ---------------------------------------------------------------
function downloadJson(value,filename){
  const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  // Revoking immediately can cancel the download in some engines; one turn is enough.
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
async function loadBackups(){
  const badgeNode=$('#backupsDbBadge');
  await panel($('#backupResult'),'database status',async()=>{
    const status=await api('/api/v1/database/status');
    const engine=status.postgresql?.version??status.postgresql?.engine??null;
    badge(badgeNode,engine?`PostgreSQL ${engine}`:`mode: ${shown(status.mode)}`,engine?'on':'off');
    $('#createBackup').disabled=!status.postgresql;
    if(!status.postgresql){
      $('#backupResult').textContent='No PostgreSQL data plane is active on this installation, so there is no database archive to create. The workspace export beside this panel still works.';
    }
  });
  $('#retentionDaysSetting').value=state.settings?.retentionDays??365;
}
$('#createBackup').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    const result=await api('/api/v1/database/backup',{method:'POST',body:JSON.stringify({label:$('#backupLabel').value.trim()||null})});
    $('#backupResult').textContent=JSON.stringify(result,null,2);
    toast('Database archive created with a checksum sidecar.',{kind:'success'});
  }catch(error){reportError(error,'Create backup');}
}));
$('#backupsExportData').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    const data=await api('/api/v1/data/export');
    downloadJson(data,`noesar-workspace-${new Date().toISOString().slice(0,10)}.json`);
    toast('Workspace exported.',{kind:'success'});
  }catch(error){reportError(error,'Export workspace');}
}));
$('#saveRetentionSetting').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    await api('/api/v1/data/retention',{method:'PUT',body:JSON.stringify({retentionDays:Number($('#retentionDaysSetting').value)})});
    toast('Retention saved.',{kind:'success'});
  }catch(error){reportError(error,'Save retention');}
}));
$('#applyRetentionSetting').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  try{
    const result=await api('/api/v1/data/retention/apply',{method:'POST',body:'{}'});
    toast(`Retention applied. ${JSON.stringify(result)}`,{kind:'success'});
  }catch(error){reportError(error,'Apply retention');}
}));

// --- about -----------------------------------------------------------------
async function loadAbout(){
  const box=$('#aboutProduct');
  await panel(box,'product information',async()=>{
    const data=await api('/api/v1/bootstrap');
    metrics(box,[
      ['Product',data.product?.name],['Edition',data.product?.edition],['Version',data.product?.version],
      ['Signed in as',`${shown(data.user?.displayName)} (${shown(data.user?.role)})`],
      ['Data plane',data.dataPlane?.mode??data.dataPlane],
      ['Authority',data.authority?.mode??data.authority?.state??shown(data.authority?.transport)],
      ['CodeN execution',data.coden?.executionEnabled?'enabled':'planning and scoped authorization only'],
    ]);
    badge($('#aboutVersion'),shown(data.product?.version),'on');
    const features=$('#aboutFeatures');
    features.className='chip-list';
    features.innerHTML=(data.features??[]).map((feature)=>`<span>${escapeHtml(feature)}</span>`).join('')||'No capabilities reported.';
    $('#aboutPrivacy').textContent=[
      `privacy state  ${shown(data.privacy?.state)}`,
      `headline       ${shown(data.privacy?.banner?.headline)}`,
      `detail         ${shown(data.privacy?.banner?.detail)}`,
      `coden note     ${shown(data.coden?.explanation)}`,
    ].join('\n');
  });
}

// SEC-003. The invariant panel used to be five hardcoded list items, which matched
// neither the seven the planner declares nor each other. A claim the interface makes on
// its own can drift away from the code silently, and this one had. It is now rendered
// from the server's own enforcement declaration, and each entry says whether this layer
// enforces it or names the layer that does.
async function loadCoden(){
  const list=$('#invariantList');
  if(!list)return;
  try{
    const data=await api('/api/v1/bootstrap');
    const invariants=data.coden?.invariants??[];
    list.innerHTML=invariants.map((entry)=>{
      const name=escapeHtml(String(entry.id??'').replace(/_/g,' '));
      const active=entry.status==='ACTIVE';
      const where=escapeHtml(String(entry.enforcedBy??''));
      return `<li title="${where}">${name}<span class="invariant-status ${active?'on':'off'}">${active?'enforced here':'enforced elsewhere'}</span></li>`;
    }).join('')||'<li>No invariant declaration was returned.</li>';
  }catch(error){
    list.innerHTML=`<li>${escapeHtml(error.message)}</li>`;
  }
}

// --- workspace actions: Plan -> Simulate -> Approve/Reject -> Diff ---------
// D-0190/D-0191 made the backend execute a real plan into a shadow and promote it on
// success (executesPlans=true, executorWiredToProductActions=true) — this panel used to
// be the last place still telling the reader the opposite. The reference provider takes
// the files to touch verbatim (it has no model to invent a target from prose alone), so
// the form asks for exact paths and contents, the same shape workspace-actions.mjs::plan()
// requires.
let currentWorkspaceRun=null;
let currentSimulation=null;
let currentApproveResult=null;
// `D-0567`. What `measure()` returned for the run on screen: the diff and the comparison the
// approval is answered against. Cleared with the run, like every other per-run holder here.
let currentMeasurement=null;
let currentWorkspaceRunFiles=[];
function planFileRowHtml(){
  return `<div class="plan-file-row"><div class="inline-form"><input class="plan-file-path" placeholder="path/to/file.txt"><button type="button" class="text-button plan-file-remove">Remove</button></div><textarea class="plan-file-contents" placeholder="New contents"></textarea></div>`;
}
function bindPlanFileRow(row){
  row.querySelector('.plan-file-remove').addEventListener('click',()=>{
    const rows=$('#planFileRows');
    if(rows.children.length>1)row.remove();
    else{row.querySelector('.plan-file-path').value='';row.querySelector('.plan-file-contents').value='';}
  });
}
function addPlanFileRow(){
  const rows=$('#planFileRows');if(!rows)return;
  rows.insertAdjacentHTML('beforeend',planFileRowHtml());
  bindPlanFileRow(rows.lastElementChild);
}
function planFiles(){
  return $$('#planFileRows .plan-file-row').map((row)=>({
    path:row.querySelector('.plan-file-path').value.trim(),
    contents:row.querySelector('.plan-file-contents').value,
  })).filter((file)=>file.path);
}
// `D-0569`, `CE-008`: MEASURED is the state where the person is looking at the real diff and
// has not answered yet. A status the map does not know renders as its raw enum name, which is
// legible but says nothing about what to do next.
const PLAN_STATUS_LABEL={PENDING_APPROVAL:'pending approval',MEASURED:'measured — nothing changed yet',PROMOTED:'promoted',REFUSED:'refused',REJECTED:'rejected',RESTORED:'restored'};
function provenanceSummary(entries){
  return Array.isArray(entries)&&entries.length?[...new Set(entries.map((entry)=>entry.provider))].join(', '):'—';
}
function renderPlanActions(){
  const box=$('#planActions');if(!box)return;
  const has=Boolean(currentWorkspaceRun);
  box.classList.toggle('hidden',!has);
  if(!has)return;
  const status=currentWorkspaceRun.status;
  // `D-0567`, `CE-008`. Two states are undecided now, not one: PENDING_APPROVAL (measure it)
  // and MEASURED (approve or reject what you were shown). Approve is present in both so the
  // sequence is legible, and DISABLED until there is a measured result behind it — a button
  // that vanishes teaches nothing, a disabled one with a reason teaches the rule.
  const undecided=status==='PENDING_APPROVAL'||status==='MEASURED';
  $('#planSimulateBtn').classList.toggle('hidden',status!=='PENDING_APPROVAL');
  $('#planMeasureBtn')?.classList.toggle('hidden',status!=='PENDING_APPROVAL');
  $('#planApproveBtn').classList.toggle('hidden',!undecided);
  $('#planApproveBtn').disabled=status!=='MEASURED';
  $('#planApproveBtn').title=status==='MEASURED'
    ?'Promotes exactly the shadow you were shown'
    :'Measure the plan first — an approval without a measured result is what CE-008 forbids';
  $('#planRejectBtn').classList.toggle('hidden',!undecided);
  $('#planRestoreBtn').classList.toggle('hidden',status!=='PROMOTED');
}
function renderPlanResult(){
  const result=$('#planResult');const badge=$('#planRunBadge');
  if(!result||!badge)return;
  if(!currentWorkspaceRun){
    result.textContent="No plan object exists yet. The Plan is the backbone's first object: nothing changes except by executing an authorised one.";
    result.classList.add('empty');
    badge.textContent='No plan yet';
    renderPlanActions();return;
  }
  const run=currentWorkspaceRun;
  result.classList.remove('empty');
  badge.textContent=`${run.runId.slice(0,8)} · ${PLAN_STATUS_LABEL[run.status]??run.status}`;
  const files=run.plan?.steps?.[0]?.files??[];
  result.textContent=[
    `runId: ${run.runId}`,
    `status: ${run.status}`,
    `goal: ${run.intent?.goal??'—'}`,
    `risk: ${run.risk?.overall??'—'}`,
    `confidence: ${typeof run.confidence?.value==='number'?run.confidence.value.toFixed(2):'—'}`,
    `provider: ${provenanceSummary(run.provenance)}`,
    `files: ${files.join(', ')||'—'}`,
  ].join('\n');
  renderPlanActions();
}
// Shadow run and Diff read from the same in-session state as Plan: one run, shown from
// three angles. Both fall back to the honest declared-empty text this file shipped with
// when nothing has been planned yet — the fix is that the fallback no longer claims the
// backbone has no execution surface, because it does (D-0190/D-0191).
function renderShadowContent(){
  const box=$('#shadowRunContent');if(!box)return;
  if(!currentWorkspaceRun){
    box.innerHTML=`<p class="declared-empty">No plan exists in this session yet. Create one in the Plan panel — a result is shown here after it has already run on a copy-on-write copy of the workspace: the diff and the time are facts before anyone is asked to approve them, which is why Approve promotes rather than merely allows.</p>`;
    return;
  }
  const parts=[`<div class="metric"><span>Run</span><b>${escapeHtml(currentWorkspaceRun.runId)}</b></div>`,
    `<div class="metric"><span>Status</span><b>${escapeHtml(PLAN_STATUS_LABEL[currentWorkspaceRun.status]??currentWorkspaceRun.status)}</b></div>`];
  if(currentSimulation){
    const sim=currentSimulation.simulation??{};
    parts.push(`<div class="metric"><span>Simulated</span><b>${sim.supported?`${(sim.predictedDiff??[]).length} predicted path(s)`:'not supported by this provider'}</b></div>`);
    if(!sim.supported)parts.push(`<p class="declared-empty">The provider that answered (${escapeHtml(provenanceSummary(currentSimulation.provenance))}) declared \`supported: false\` rather than invent a prediction — a real answer, not an empty one dressed as a miss.</p>`);
  }
  if(currentApproveResult){
    const {result,promoted,coverage}=currentApproveResult;
    parts.push(`<div class="metric"><span>Executed</span><b>${result?.ok?'ok':'not ok'} · ${result?.performed??0} performed, ${result?.refused??0} refused</b></div>`);
    parts.push(`<div class="metric"><span>Comparison</span><b>${result?.surprise?.clean?'clean':'surprised'}</b></div>`);
    parts.push(`<div class="metric"><span>Promoted</span><b>${promoted?'yes':'no'}</b></div>`);
    if(coverage)parts.push(`<div class="metric"><span>Claims recomputed</span><b>${coverage.recomputed}/${coverage.total} · ${coverage.contradicted?.length??0} contradicted</b></div>`);
  }
  box.innerHTML=parts.join('');
}
function renderDiffContent(){
  const box=$('#diffContent');if(!box)return;
  const entries=currentApproveResult?.diff??[];
  if(!entries.length){
    box.innerHTML=`<p class="declared-empty">No change to compare yet. A diff here is computed against the shadow copy after Approve runs it, never against the text of a reply — a reply describing a change is not the change.</p>`;
    return;
  }
  box.innerHTML=`<div class="card-list">${entries.map((entry)=>`<article class="entity-card"><h3>${escapeHtml(entry.path)} <b>${escapeHtml(entry.status)}</b></h3>${entry.diffAvailable?`<pre>${escapeHtml(String(entry.before??'').slice(0,2000))}\n---\n${escapeHtml(String(entry.after??'').slice(0,2000))}</pre>`:'<p class="declared-empty">Content too large to show inline.</p>'}</article>`).join('')}</div>`;
}
// Editor: a VIEW of the files the current run proposes or promoted, never a second write
// path. Every real change still goes only through Plan -> Approve; a live edit box here
// would let a byte reach the workspace without a plan, a token or a shadow comparison —
// exactly the chain the rest of this page exists to enforce.
function renderEditorContent(){
  const box=$('#editorContent');if(!box)return;
  if(!currentWorkspaceRun){
    box.innerHTML=`<p class="declared-empty">Nothing is open. The editor shows the files a plan proposes or promotes — a view, never a second write path: every change to the real workspace still goes through Plan → Approve, so a raw edit box here would bypass the capability and shadow chain the rest of this page enforces.</p>`;
    return;
  }
  const promotedDiff=currentApproveResult?.diff;
  const source=promotedDiff?promotedDiff.map((entry)=>({path:entry.path,contents:entry.after})):currentWorkspaceRunFiles;
  const label=promotedDiff?'promoted content':'proposed content, before Approve';
  box.innerHTML=`<p class="hint">Showing ${escapeHtml(label)} for run ${escapeHtml(currentWorkspaceRun.runId.slice(0,8))}.</p>`
    +`<div class="card-list">${source.length?source.map((file)=>`<article class="entity-card"><h3>${escapeHtml(file.path)}</h3><pre>${escapeHtml(String(file.contents??'').slice(0,4000))}</pre></article>`).join(''):'<p class="declared-empty">No files.</p>'}</div>`;
}
// Preview: the same promoted content, rendered where that means something. An HTML file is
// shown in a sandboxed, srcdoc iframe — sandbox="" strips scripts and same-origin access, so
// this is a rendered artefact, never executable content from the workspace. Everything else
// falls back to the same text view Editor uses; there is nothing to invent beyond that.
function renderPreviewContent(){
  const box=$('#previewContent');if(!box)return;
  const entries=(currentApproveResult?.diff??[]).filter((entry)=>entry.diffAvailable);
  if(!entries.length){
    box.innerHTML=`<p class="declared-empty">Nothing to preview. A preview renders an artefact the work produced — approve a plan whose files have viewable content first.</p>`;
    return;
  }
  box.innerHTML=entries.map((entry)=>{
    const ext=(entry.path.split('.').pop()||'').toLowerCase();
    if(ext==='html'||ext==='htm'){
      return `<h3>${escapeHtml(entry.path)}</h3><iframe class="preview-frame" sandbox="" srcdoc="${escapeHtml(String(entry.after??''))}"></iframe>`;
    }
    return `<h3>${escapeHtml(entry.path)}</h3><pre>${escapeHtml(String(entry.after??'').slice(0,4000))}</pre>`;
  }).join('');
}
// Problems: nothing new is fetched — refused steps, an unclean shadow comparison and
// contradicted claims already arrive on run/approve; this panel only had never rendered them.
function renderProblemsContent(){
  const box=$('#problemsContent');if(!box)return;
  if(!currentWorkspaceRun){
    box.innerHTML=`<p class="declared-empty">No problems reported for this piece of work. This is not "no problems exist": nothing has run.</p>`;
    return;
  }
  const items=[];
  if(currentApproveResult){
    const {result,coverage}=currentApproveResult;
    for(const refusal of (result?.outcomes??[]).filter((outcome)=>!outcome.performed))items.push({kind:'refused step',detail:JSON.stringify(refusal)});
    if(result?.surprise&&result.surprise.clean===false)items.push({kind:'unexpected filesystem change',detail:JSON.stringify(result.surprise.unexpected??result.surprise)});
    for(const contradiction of coverage?.contradicted??[])items.push({kind:'claim contradicted',detail:JSON.stringify(contradiction)});
  }
  if(!items.length){
    box.innerHTML=`<p class="declared-empty">${currentApproveResult?'Nothing to report — the run was clean.':'No run yet for this plan; nothing to report until Approve runs it.'}</p>`;
    return;
  }
  box.innerHTML=`<div class="card-list">${items.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.kind)}</h3><pre>${escapeHtml(item.detail)}</pre></article>`).join('')}</div>`;
}
// Logs (of this piece of work): the causal event trail for the current run, from the new
// read-only GET /api/v1/events/:correlationId (D-0230) — the ledger already carried this,
// nothing but the route was missing.
async function renderWorkLogsContent(){
  const box=$('#workLogsContent');if(!box)return;
  if(!currentWorkspaceRun){
    box.innerHTML=`<p class="declared-empty">The product's own logs live in Settings → Health and logs. This panel is for the causal event trail of <b>this</b> piece of work, which needs a run to have any.</p><button class="text-button" data-view-link="settings/health">Open the product's logs</button>`;
    box.querySelector('[data-view-link]')?.addEventListener('click',(event)=>navigate(event.currentTarget.dataset.viewLink));
    return;
  }
  try{
    const trail=await api(`/api/v1/events/${currentWorkspaceRun.runId}`);
    const events=trail.events??[];
    box.innerHTML=events.length
      ?`<div class="card-list">${events.map((event)=>`<article class="entity-card"><h3>${escapeHtml(event.action)}</h3><small>${escapeHtml(isoToLocal(new Date(event.recordedAtUnix*1000).toISOString()))}</small><p>${escapeHtml(event.actor||'—')}</p></article>`).join('')}</div>`
      :`<p class="declared-empty">No event recorded yet for this run.</p>`;
  }catch(error){
    box.innerHTML=`<p class="declared-empty">${escapeHtml(error.message)}</p>`;
  }
}
async function renderWorkspaceRun(){
  renderPlanResult();renderShadowContent();renderDiffContent();
  renderEditorContent();renderPreviewContent();renderProblemsContent();
  await renderWorkLogsContent();
}
function trackWorkspaceRunForClosure(run){
  const existing=state.workspaceActionRuns.find((item)=>item.id===run.runId);
  const label=`Workspace action · ${run.intent?.goal??run.runId}`;
  if(existing)existing.label=label;else state.workspaceActionRuns.push({id:run.runId,label});
}
// Point 4b: the chat a plan created from this form will belong to. `null` unless the operator
// came here through "Start work from this chat" — an explicit gesture, not the conversation
// that happens to be open. Attaching implicitly is the same class of guess as rendering the
// link in the browser: it would file terminal-shaped work under whatever chat was last read.
let chatWorkAttachment=null;
function renderPlanAttachment(){
  const host=$('#planAttachment');
  if(!host)return;
  if(!chatWorkAttachment){
    host.textContent='This run will belong to no chat. Start one from a chat’s Work column to attach it.';
    return;
  }
  // Named, and detachable in the same breath. An attachment that survives out of sight is how
  // a later run gets filed under a chat nobody meant — so it is stated on the form that creates
  // the run, next to the control that undoes it, rather than remembered by the operator.
  host.innerHTML=`This run will belong to the chat “${escapeHtml(chatWorkAttachment.title)}”. <button class="text-button" type="button" id="planAttachmentClear">Detach</button>`;
  $('#planAttachmentClear')?.addEventListener('click',()=>{chatWorkAttachment=null;renderPlanAttachment();});
}
async function submitPlanForm(event){
  event.preventDefault();
  const files=planFiles();
  if(!files.length){toast('At least one file with a path is required.',{kind:'error'});return;}
  try{
    const planned=await api('/api/v1/workspace-actions/plan',{method:'POST',body:JSON.stringify({
      request:$('#planGoal').value,files,mode:'safe',policy:'restrictive',
      // Sent, never assumed on the way back: the panel reads `planned.conversationId` off the
      // engine's answer below, so a link the engine declined to keep cannot go on being drawn.
      conversationId:chatWorkAttachment?.id??null,
    })});
    // The run as the engine returned it. This used to stitch `status:'PENDING_APPROVAL'` on
    // by hand because `plan()` did not return one, and the terminal shell printed the same
    // constant for the same reason — two clients reporting, as the engine's word, a state the
    // engine had never said. Phase 5 made the engine return it; nothing is added here.
    currentWorkspaceRun=planned;
    currentSimulation=null;currentApproveResult=null;currentMeasurement=null;currentWorkspaceRunFiles=files;
    trackWorkspaceRunForClosure(currentWorkspaceRun);
    await renderWorkspaceRun();
    // Phase 6 (`D-0312`): the same fact, from the same field of the same answer, through the
    // SAME shaper the terminal uses. Two shells deriving "degraded" from one response in two
    // files is how they stop agreeing; `reasoningSummary` is imported, not reimplemented.
    updateReasoningChip(planned.reasoning);
    renderDivergence(planned.divergence);
    if(planned.reasoning?.degraded){
      // Not only the chip. A chip is a state you can miss; falling back to a weaker provider
      // is news, and news is told once, plainly, when it happens.
      toast(`ATOM did not answer — the reference provider answered instead. ${(planned.reasoning.reasons??[]).join(' · ')}`,{kind:'error'});
    }
    // The chat's Work column, refreshed from the engine — not patched with the run this
    // function is holding. `planned.conversationId` is what the run actually carries.
    if(planned.conversationId&&planned.conversationId===state.activeConversationId)await renderChatPlan();
    if(!planned.conversationId)await renderUnattachedRuns();
    toast(planned.conversationId?'Plan created — pending approval, attached to this chat.':'Plan created — pending approval.');
  }catch(error){
    if(error.status===503)toast(`Reasoning unavailable: ${error.value?.reason??error.message}`,{kind:'error'});
    else toast(error.value?.reason??error.message,{kind:'error'});
  }
}
async function runWorkspaceAction(kind,opts={}){
  if(!currentWorkspaceRun)return;
  const runId=currentWorkspaceRun.runId;
  try{
    if(kind==='simulate'){
      currentSimulation=await api(`/api/v1/workspace-actions/${runId}/simulate`,{method:'POST',body:JSON.stringify({})});
      toast('Simulated.');
    }else if(kind==='measure'){
      // `D-0567`, `CE-008`. Nothing reaches the workspace here; what comes back is the diff
      // and the comparison the approval will be answered against.
      currentMeasurement=await api(`/api/v1/workspace-actions/${runId}/measure`,{method:'POST',body:JSON.stringify({})});
      currentWorkspaceRun.status='MEASURED';
      currentApproveResult=currentMeasurement;
      toast(currentMeasurement.clean?'Measured in the shadow — clean. Nothing has changed yet.':'Measured in the shadow — NOT clean. Approving will promote nothing.',{kind:currentMeasurement.clean?'info':'warn'});
    }else if(kind==='approve'){
      currentApproveResult=await api(`/api/v1/workspace-actions/${runId}/approve`,{method:'POST',body:JSON.stringify({})});
      currentWorkspaceRun.status=currentApproveResult.promoted?'PROMOTED':'REFUSED';
      toast(currentApproveResult.promoted?'Approved and promoted.':'Approved, but not promoted — see Shadow run.');
    }else if(kind==='reject'){
      // 'reason' in opts distinguishes "caller supplied one, even null" — a caller that has
      // already decided, and for which a blocking native prompt() would be wrong — from
      // "no opts at all" (the button's own click handler, which still asks — reject
      // is the one action here a person is expected to explain).
      const reason='reason' in opts?opts.reason:(prompt('Reason for rejecting this plan (optional):')??null);
      await api(`/api/v1/workspace-actions/${runId}/reject`,{method:'POST',body:JSON.stringify({reason})});
      currentWorkspaceRun.status='REJECTED';
      toast('Rejected.');
    }else if(kind==='restore'){
      await api(`/api/v1/workspace-actions/${runId}/restore`,{method:'POST',body:JSON.stringify({})});
      currentWorkspaceRun.status='RESTORED';
      toast('Restored — the promoted files were reverted.');
    }
    trackWorkspaceRunForClosure(currentWorkspaceRun);
    await renderWorkspaceRun();
  }catch(error){
    toast(error.value?.reason??error.message,{kind:'error'});
  }
}

function initWorkspaceActions(){
  addPlanFileRow();
  $('#planAddFile')?.addEventListener('click',addPlanFileRow);
  $('#planForm')?.addEventListener('submit',submitPlanForm);
  // Rendered once at wiring time, so the form states where a run will be filed even before
  // anybody has touched a chat. An empty line here would read as "no opinion", which is the
  // one thing this field must never mean.
  renderPlanAttachment();
  $('#planSimulateBtn')?.addEventListener('click',()=>runWorkspaceAction('simulate'));
  $('#planMeasureBtn')?.addEventListener('click',()=>runWorkspaceAction('measure'));
  $('#planApproveBtn')?.addEventListener('click',()=>runWorkspaceAction('approve'));
  $('#planRejectBtn')?.addEventListener('click',()=>runWorkspaceAction('reject'));
  $('#planRestoreBtn')?.addEventListener('click',()=>runWorkspaceAction('restore'));
  renderWorkspaceRun();
}

// The Map panel: read-only repository understanding (languages, manifests, entry points,
// symbol index, dependency map) via /api/v1/repo-map/scan + /search — both already built and
// tested (phase 1 step 7), never consumed by any page before now. Not per-run: it scopes to
// the whole workspace, on demand, since building it is not free (a real filesystem walk).
let currentRepoMap=null;
function repoMapSummaryHtml(map){
  const langs=(map.languages?.languages??[]).slice(0,8).map((entry)=>`${escapeHtml(entry.language)} (${entry.files})`).join(', ')||'none detected';
  const manifests=(map.manifests??[]).map((entry)=>escapeHtml(entry.path)).join(', ')||'none';
  const entryPoints=(map.entryPoints??[]).slice(0,10).map((entry)=>escapeHtml(entry.path??entry.command??'?')).join(', ')||'none declared';
  return `<div class="metric"><span>Files scanned</span><b>${map.filesScanned}${map.truncated?' (truncated)':''}</b></div>`
    +`<div class="metric"><span>Languages</span><b>${langs}</b></div>`
    +`<div class="metric"><span>Manifests</span><b>${manifests}</b></div>`
    +`<div class="metric"><span>Entry points</span><b>${entryPoints}</b></div>`
    +`<div class="metric"><span>Symbols indexed</span><b>${map.symbolIndex?.symbols?.length??0}${map.symbolIndex?.truncated?' (truncated)':''}</b></div>`
    +`<div class="metric"><span>Declared dependencies</span><b>${map.dependencyMap?.declared?.length??0}</b></div>`
    +`<div class="metric"><span>Internal imports found</span><b>${map.dependencyMap?.internalImports?.length??0}${map.dependencyMap?.truncated?' (truncated)':''}</b></div>`
    +`<form class="inline-form" id="mapSearchForm"><input id="mapSearchQuery" placeholder="literal search, e.g. workspaceActions"><button class="secondary" type="submit">Search</button></form>`
    +`<div id="mapSearchResults"></div>`;
}
async function runRepoMapScan(){
  const box=$('#mapContent');if(!box)return;
  box.innerHTML='<p class="declared-empty">Scanning…</p>';
  try{
    currentRepoMap=await api('/api/v1/repo-map/scan',{method:'POST',body:JSON.stringify({})});
    box.innerHTML=repoMapSummaryHtml(currentRepoMap);
    $('#mapSearchForm')?.addEventListener('submit',runRepoMapSearch);
  }catch(error){
    box.innerHTML=`<p class="declared-empty">${escapeHtml(error.value?.reason??error.message)}</p><button class="primary" type="button" id="mapScanBtn">Scan this workspace</button>`;
    $('#mapScanBtn')?.addEventListener('click',runRepoMapScan);
  }
}
async function runRepoMapSearch(event){
  event.preventDefault();
  const query=$('#mapSearchQuery').value.trim();
  const results=$('#mapSearchResults');
  if(!query||!results)return;
  try{
    const found=await api(`/api/v1/repo-map/search?q=${encodeURIComponent(query)}`);
    results.innerHTML=found.matches.length
      ?`<div class="card-list">${found.matches.slice(0,50).map((match)=>`<article class="entity-card"><h3>${escapeHtml(match.path)}:${match.line}</h3><pre>${escapeHtml(match.text)}</pre></article>`).join('')}</div>${found.truncated?'<p class="declared-empty">Results truncated.</p>':''}`
      :'<p class="declared-empty">No match.</p>';
  }catch(error){
    results.innerHTML=`<p class="declared-empty">${escapeHtml(error.value?.reason??error.message)}</p>`;
  }
}
function initMapPanel(){
  $('#mapScanBtn')?.addEventListener('click',runRepoMapScan);
}

// --- workflows -------------------------------------------------------------
// WP-2. The step vocabulary is rendered from what the server reports, not from a copy
// kept here. A hardcoded list in this file is exactly how the invariant panel came to
// declare five invariants that matched neither the seven in the code nor each other.
function workflowRunCard(run){
  const tone=run.status==='completed'?'green':['failed','compensation_failed','rejected'].includes(run.status)?'red':'';
  const steps=run.steps.map((step)=>{
    const attempts=step.attempts.length>1?` ×${step.attempts.length}`:'';
    const compensated=step.compensation?.status==='compensated'?' · compensated':step.compensation?.status==='failed'?' · compensation failed':'';
    return `<li>${escapeHtml(step.key)} — ${escapeHtml(step.status)}${attempts}${compensated}</li>`;
  }).join('');
  const actions=[
    ['failed','completed','cancelled','rejected','compensation_failed'].includes(run.status)
      ? `<button class="text-button" data-workflow-replay="${escapeHtml(run.id)}" type="button">Replay</button>` : '',
    ['pending','running','awaiting_approval','cancelling','rejecting'].includes(run.status)
      ? `<button class="text-button" data-workflow-cancel="${escapeHtml(run.id)}" type="button">Cancel</button>` : '',
  ].join('');
  return `<article class="card"><h3>${escapeHtml(run.definition?.name??'Workflow run')} <b class="${tone}">${escapeHtml(run.status)}</b></h3>`
    +`<p>Version ${escapeHtml(String(run.definition?.version??'?'))}${run.replayOf?' · replay':''}${run.idempotencyKey?` · key ${escapeHtml(run.idempotencyKey)}`:''}</p>`
    +`<ul class="invariants">${steps}</ul>`
    +(run.error?`<p class="status-bad">${escapeHtml(run.error)}</p>`:'')
    +`<p>${escapeHtml(String(run.evidence?.length??0))} evidence records</p>${actions}</article>`;
}
async function loadWorkflows(){
  const list=$('#workflowList');
  await panel(list,'workflows',async()=>{
    const payload=await api('/api/v1/workflows');
    const types=payload.stepTypes??[];
    const hint=$('#workflowStepTypes');
    if(hint){
      hint.textContent=types.length
        ?`Step types: ${types.map((type)=>`${type.type}${type.executable?'':' (declared, not executable in this build)'}`).join(' · ')}`
        :'The server reported no step types.';
    }
    const workflows=payload.workflows??[];
    $('#workflowCount').textContent=String(workflows.length);
    list.classList.toggle('empty-state',workflows.length===0);
    list.innerHTML=workflows.length?workflows.map((workflow)=>
      `<article class="card"><h3>${escapeHtml(workflow.name)} <b>v${escapeHtml(String(workflow.version))}</b></h3>`
      +`<p>${escapeHtml(workflow.description||'No description.')}</p>`
      +`<p>${workflow.steps.map((step)=>escapeHtml(`${step.key}:${step.type}`)).join(' → ')}</p>`
      +`<button class="text-button" data-workflow-run="${escapeHtml(workflow.id)}" type="button">Start run</button></article>`).join('')
      :'No workflows.';
    bindWorkflowActions();
  });
  const runs=$('#workflowRunList');
  await panel(runs,'workflow runs',async()=>{
    const payload=await api('/api/v1/workflow-runs');
    const list=payload.runs??[];
    runs.classList.toggle('empty-state',list.length===0);
    runs.innerHTML=list.length?list.slice(-25).reverse().map(workflowRunCard).join(''):'No runs.';
    bindWorkflowActions();
  });
}
function bindWorkflowActions(){
  $$('[data-workflow-run]').forEach((button)=>{button.onclick=async()=>{
    try{await api(`/api/v1/workflows/${button.dataset.workflowRun}/runs`,{method:'POST',body:JSON.stringify({})});toast('Run started.');await loadWorkflows();await refreshApprovals();}
    catch(error){toast(error.message,{kind:'error'});}
  };});
  $$('[data-workflow-cancel]').forEach((button)=>{button.onclick=async()=>{
    try{await api(`/api/v1/workflow-runs/${button.dataset.workflowCancel}/cancel`,{method:'POST',body:JSON.stringify({reason:'cancelled from the interface'})});toast('Run cancelled.');await loadWorkflows();await refreshApprovals();}
    catch(error){toast(error.message,{kind:'error'});}
  };});
  $$('[data-workflow-replay]').forEach((button)=>{button.onclick=async()=>{
    try{await api(`/api/v1/workflow-runs/${button.dataset.workflowReplay}/replay`,{method:'POST',body:JSON.stringify({})});toast('Replay started.');await loadWorkflows();}
    catch(error){toast(error.message,{kind:'error'});}
  };});
}
const workflowForm=$('#workflowForm');
if(workflowForm)workflowForm.addEventListener('submit',async(event)=>{
  event.preventDefault();
  let steps=null;
  // A malformed step list is reported as such. Sending it anyway would surface the
  // server's parse failure as an opaque 400 with no hint about which field was wrong.
  try{steps=JSON.parse($('#workflowSteps').value||'[]');}
  catch(error){toast(`Steps must be valid JSON: ${error.message}`,{kind:'error'});return;}
  try{
    await api('/api/v1/workflows',{method:'POST',body:JSON.stringify({
      name:$('#workflowName').value,
      description:$('#workflowDescription').value,
      projectId:$('#workflowProject').value||null,
      steps,
    })});
    toast('Workflow created.');
    $('#workflowName').value='';$('#workflowDescription').value='';$('#workflowSteps').value='';
    await loadWorkflows();
  }catch(error){toast(error.message,{kind:'error'});}
});

// --- the approval queue and the bottom strip -------------------------------
// The strip is permanent and states the count even at zero: a strip that only appears
// when something is pending gives an operator no way to distinguish "nothing waiting"
// from "this stopped working".
function approvalCard(item){
  const effects=item.effects?.length?` · ${item.effects.map((effect)=>escapeHtml(effect)).join(', ')}`:'';
  const owner=item.ownerOnly?' · Owner only':'';
  return `<article class="card"><h3>${escapeHtml(item.title)} <b>${escapeHtml(item.kind)}</b></h3>`
    +`<p>${escapeHtml(item.summary)}</p>`
    +`<p>Requested ${escapeHtml(isoToLocal(item.requestedAt))}${effects}${owner}</p>`
    +`<p>Requires ${escapeHtml(item.requiredPermission)}</p>`
    +`<div class="inline-form"><button class="primary" data-approve="${escapeHtml(item.id)}" type="button">Approve</button>`
    +`<button class="danger" data-reject="${escapeHtml(item.id)}" type="button">Reject</button></div></article>`;
}
// The queue is read from more than one place that can run at the same time — the boot
// sequence's refreshWorkspace() and the Approvals section's own loader, for instance —
// and since D-0265 one of its four sources (memory candidates) is a real network round
// trip rather than an instant in-memory read, two overlapping calls can now resolve out
// of order. Without a guard, an OLDER response landing after a NEWER one replaces
// #approvalList with stale content and rebinds fresh click handlers onto nodes a test
// (or a person) may already be mid-click on — found live as a real, reproducible
// "Node is detached from document" failure in the browser E2E suite. Each call is
// stamped with an incrementing token; only the most recently STARTED call is allowed to
// touch the DOM, so a slow, stale response is discarded instead of undoing a fresher one.
let approvalsRefreshToken=0;
async function refreshApprovals(){
  const token=++approvalsRefreshToken;
  const strip=$('#approvalStripState');
  const detail=$('#approvalStripDetail');
  const navCount=$('#navApprovalCount');
  try{
    const payload=await api('/api/v1/approvals');
    if(token!==approvalsRefreshToken)return payload.approvals??[];
    const items=payload.approvals??[];
    const total=payload.counts?.total??items.length;
    if(strip){
      strip.textContent=`Approvals: ${total}`;
      strip.className=`approval-strip-state ${total>0?'status-warn':'status-good'}`;
    }
    if(detail){
      detail.textContent=total===0
        ?'Nothing is waiting for a decision.'
        :items.slice(0,2).map((item)=>item.title).join(' · ')+(total>2?` and ${total-2} more`:'');
    }
    if(navCount){navCount.textContent=String(total);navCount.classList.toggle('hidden',total===0);}
    const list=$('#approvalList');
    if(list){
      list.classList.toggle('empty-state',items.length===0);
      list.innerHTML=items.length?items.map(approvalCard).join(''):'Nothing is waiting for a decision.';
      bindApprovalActions();
    }
    const count=$('#approvalCount');
    if(count)badge(count,String(total),total>0?'warn':'on');
    return items;
  }catch(error){
    if(token!==approvalsRefreshToken)throw error;
    // A queue that cannot be read says so. Showing "0 waiting" on a failed fetch would
    // be a false all-clear on the one surface whose job is to raise the alarm.
    if(strip){strip.textContent='Approvals: unavailable';strip.className='approval-strip-state status-bad';}
    if(detail)detail.textContent=error.message;
    if(navCount)navCount.classList.add('hidden');
    return null;
  }
}
function bindApprovalActions(){
  const decide=async(id,decision)=>{
    const reason=decision==='reject'?window.prompt('Reason for rejecting:')??'':'';
    try{
      await api(`/api/v1/approvals/${encodeURIComponent(id)}/decision`,{method:'POST',body:JSON.stringify({decision,reason:reason||null})});
      toast(decision==='approve'?'Approved.':'Rejected.');
      await refreshApprovals();
      if(ROUTES.has('workflows'))await loadWorkflows();
    }catch(error){toast(error.message,{kind:'error'});}
  };
  $$('[data-approve]').forEach((button)=>{button.onclick=()=>decide(button.dataset.approve,'approve');});
  $$('[data-reject]').forEach((button)=>{button.onclick=()=>decide(button.dataset.reject,'reject');});
}
const refreshApprovalsButton=$('#refreshApprovals');
if(refreshApprovalsButton)refreshApprovalsButton.addEventListener('click',()=>{refreshApprovals();});

// Registered last, once every loader above exists. This object is what makes a nav
// entry mean something: `activate()` calls the loader for the view being opened.
// --- Appearance -------------------------------------------------------------
// The seven semantic states, in one place. They are rendered from this list rather than
// written into the markup so the legend cannot fall out of step with what the interface
// actually uses — a legend that describes a vocabulary the product no longer speaks is
// worse than no legend.
const SEMANTIC_STATES=[
  {key:'ok',word:'Verified',meaning:'checked and holding'},
  {key:'active',word:'Active',meaning:'running now'},
  {key:'waiting',word:'Waiting',meaning:'needs a human decision'},
  {key:'info',word:'Note',meaning:'context, not a problem'},
  {key:'warning',word:'Warning',meaning:'works, but not as intended'},
  {key:'critical',word:'Critical',meaning:'stopped or unsafe'},
  {key:'off',word:'Off',meaning:'not configured'},
];
// A theme's real values, read from the stylesheet rule that defines it. A swatch painted
// from the CURRENT theme would show nine identical cards and tell you nothing.
function themeTokens(id){
  const wanted=id==='midnight'?':root':`:root[data-theme="${id}"]`;
  const found={};
  for(const sheet of document.styleSheets){
    let rules;try{rules=sheet.cssRules;}catch{continue;}
    for(const rule of rules??[]){
      if(rule.selectorText!==wanted)continue;
      for(const token of ['surface-root','surface-card','accent-fill-from','text-primary','green','amber','red']){
        const value=rule.style.getPropertyValue(`--${token}`).trim();
        if(value)found[token]=value;
      }
    }
  }
  return found;
}
function paintSwatches(root){
  for(const node of (root??document).querySelectorAll('[data-swatch]')){
    node.style.background=node.dataset.swatch;
  }
}
function renderThemeGrid(){
  const grid=$('#themeGrid');if(!grid)return;
  const current=document.documentElement.dataset.theme??'midnight';
  const base=themeTokens('midnight');
  grid.innerHTML=THEMES.map((theme)=>{
    const tokens={...base,...themeTokens(theme.id)};
    const swatches=['surface-root','surface-card','accent-fill-from','text-primary']
      .map((token)=>`<span data-swatch="${escapeHtml(tokens[token]??'transparent')}"></span>`).join('');
    return `<button class="theme-card" type="button" data-theme-id="${escapeHtml(theme.id)}" aria-pressed="${theme.id===current}">
      <b>${escapeHtml(theme.label)}${theme.id===current?' <span class="state state-ok"></span>':''}</b>
      <div class="theme-swatches">${swatches}</div>
      <small>${escapeHtml(theme.hint)}</small></button>`;
  }).join('');
  $$('[data-theme-id]').forEach((button)=>button.addEventListener('click',()=>{
    applyTheme(button.dataset.themeId);
    // The accent is re-derived against the new theme's background: the same hue can be
    // readable on one theme and not on the next, and the stored choice is the HUE, not the
    // colour it resolved to last time.
    applyAccent(readAccent());
    renderAppearance();
    toast({title:'Theme changed',body:`${button.querySelector('b').textContent.trim()} is now in use on this device.`,kind:'success'});
  }));
  paintSwatches(grid);
  const label=$(`#themeCurrent`);
  if(label){label.textContent=THEMES.find((theme)=>theme.id===current)?.label??current;label.className='badge badge-on';}
}
function renderAccentReadout(hex){
  const box=$('#accentReadout');if(!box)return;
  const colour=parseHex(hex);
  if(!colour){box.innerHTML='<div><b>—</b><small>Not a colour this field understands. Use a hex value such as <code>#5b8cff</code>.</small></div>';return;}
  const surface=tokenValue('surface-card')||'#0a121f';
  const onFill=contrast(colour,parseHex('#ffffff'));
  const asText=contrast(colour,parseHex(surface));
  const readable=deriveReadable(hex,surface,4.5);
  const verdict=(ratio,threshold)=>ratio>=threshold
    ? `<span class="state state-ok">passes ${threshold}:1</span>`
    : `<span class="state state-warning">below ${threshold}:1</span>`;
  box.innerHTML=`
    <div><b>${escapeHtml(formatRatio(onFill))}</b><small>White text on this colour as a fill. ${verdict(onFill,4.5)}</small>
      <span class="swatch-line"><i data-swatch="${escapeHtml(hex)}"></i><span>the colour you chose</span></span></div>
    <div><b>${escapeHtml(formatRatio(asText))}</b><small>This colour used AS TEXT on a panel. ${verdict(asText,4.5)}</small></div>
    <div><b>${escapeHtml(formatRatio(readable?.ratio??0))}</b><small>${readable&&readable.derived
      ? 'Derived text variant — the hue is kept and only its lightness moved, until it reads.'
      : 'No derivation needed: the colour you chose already reads as text.'}${readable&&readable.met===false
      ? ' <span class="state state-warning">4.5:1 could not be reached from this hue</span>' : ''}</small>
      <span class="swatch-line"><i data-swatch="${escapeHtml(readable?.hex??hex)}"></i><span>used for links and labels</span></span></div>`;
  paintSwatches(box);
}
function renderAppearance(){
  renderThemeGrid();
  const stored=readAccent();
  const active=stored||tokenValue('accent-fill-from')||'#5b8cff';
  const picker=$('#accentPicker');const field=$('#accentHex');
  if(picker)picker.value=/^#[0-9a-fA-F]{6}$/.test(active)?active:'#5b8cff';
  if(field)field.value=active;
  renderAccentReadout(active);
  const legend=$('#stateLegend');
  if(legend){
    legend.innerHTML=SEMANTIC_STATES.map((state)=>
      `<div><span class="state state-${escapeHtml(state.key)}">${escapeHtml(state.word)}</span><small>${escapeHtml(state.meaning)}</small></div>`).join('');
  }
}
function initAppearance(){
  const picker=$('#accentPicker');const field=$('#accentHex');
  const choose=(value,{persist=true}={})=>{
    if(!parseHex(value)){renderAccentReadout(value);return;}
    if(persist){try{localStorage.setItem(ACCENT_KEY,value);}catch{}}
    applyAccent(value);
    renderAppearance();
  };
  picker?.addEventListener('input',()=>{if(field)field.value=picker.value;renderAccentReadout(picker.value);});
  picker?.addEventListener('change',()=>choose(picker.value));
  // Typed input is read as it is typed, so the figures move with the value — that is what
  // "measured while you choose" means. It is only stored once it is a colour.
  field?.addEventListener('input',()=>{
    renderAccentReadout(field.value.trim());
    if(parseHex(field.value.trim())&&picker&&/^#[0-9a-fA-F]{6}$/.test(field.value.trim()))picker.value=field.value.trim();
  });
  field?.addEventListener('change',()=>choose(field.value.trim()));
  $('#accentReset')?.addEventListener('click',()=>{
    try{localStorage.removeItem(ACCENT_KEY);}catch{}
    applyAccent('');
    renderAppearance();
    toast({title:'Accent reset',body:"The theme's own accent is in use again.",kind:'success'});
  });
}

// ---------------------------------------------------------------------------
// Reading, motion and instants · UI-040…UI-045
// ---------------------------------------------------------------------------

const TEXT_STEPS=[1,1.15,1.3,1.5];
const TEXT_KEY='noesar.textScale';const ZOOM_KEY='noesar.uiZoom';const MOTION_KEY='noesar.reduceMotion';
function readStep(){const value=Number(localStorage.getItem(TEXT_KEY));return TEXT_STEPS.includes(value)?TEXT_STEPS.indexOf(value)+1:1;}
function applyTextStep(step){
  const index=Math.min(Math.max(Number(step)||1,1),TEXT_STEPS.length);
  document.documentElement.style.setProperty('--text-scale',String(TEXT_STEPS[index-1]));
  codenTerminalTheme?.();
  $$('[data-text-step]').forEach((button)=>button.setAttribute('aria-pressed',String(Number(button.dataset.textStep)===index)));
  try{localStorage.setItem(TEXT_KEY,String(TEXT_STEPS[index-1]));}catch{}
  return index;
}
function applyZoom(percent){
  const value=Math.min(Math.max(Number(percent)||100,80),150);
  document.documentElement.style.setProperty('--ui-zoom',String(value/100));
  const range=$('#zoomRange');if(range)range.value=String(value);
  const output=$('#zoomValue');if(output)output.textContent=`${value}%`;
  try{localStorage.setItem(ZOOM_KEY,String(value));}catch{}
  return value;
}
function applyMotion(reduced){
  document.documentElement.dataset.motion=reduced?'reduced':'full';
  const box=$('#reduceMotion');if(box)box.checked=Boolean(reduced);
  try{localStorage.setItem(MOTION_KEY,reduced?'1':'0');}catch{}
}
function initReadingControls(){
  applyTextStep(readStep());
  applyZoom(Number(localStorage.getItem(ZOOM_KEY))||100);
  // The system preference is the default, and the setting overrides it in both
  // directions: "my OS says nothing" is not "I do not mind movement".
  const stored=localStorage.getItem(MOTION_KEY);
  const system=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches??false;
  applyMotion(stored===null?system:stored==='1');
  const hint=$('#motionSystemHint');
  if(hint)hint.textContent=system
    ?'Your system asks for reduced motion, and that is already honoured. This setting can override it.'
    :'Your system does not ask for reduced motion. This setting applies anyway.';
  $$('[data-text-step]').forEach((button)=>button.addEventListener('click',()=>{
    applyTextStep(button.dataset.textStep);
    announceEvent(`Text size ${button.textContent.trim()}`);
  }));
  $('#zoomRange')?.addEventListener('input',()=>applyZoom($('#zoomRange').value));
  $('#zoomIn')?.addEventListener('click',()=>applyZoom(Number($('#zoomRange').value)+5));
  $('#zoomOut')?.addEventListener('click',()=>applyZoom(Number($('#zoomRange').value)-5));
  $('#zoomReset')?.addEventListener('click',()=>{applyZoom(100);announceEvent('Interface zoom reset to 100 per cent');});
  $('#reduceMotion')?.addEventListener('change',()=>{
    applyMotion($('#reduceMotion').checked);
    announceEvent($('#reduceMotion').checked?'Motion reduced':'Motion restored');
  });
}

// UI-043. One summary per event. Never called from a stream: a region fed token by token
// reads the same answer twice and makes the assistive technology unusable.
function announceEvent(summary){
  const region=$('#eventAnnouncer');
  if(!region||!summary)return;
  region.textContent='';
  // A region whose text is replaced with a similar string may not be re-announced; the
  // empty write in between is what makes two consecutive identical events audible.
  setTimeout(()=>{region.textContent=String(summary);},30);
}

// UI-045. Instants are UTC underneath and are shown in a named IANA zone, because
// "12:15" without a zone is not a time — it is a time in someone's head.
let effectiveZone='';
function zoneName(){
  return effectiveZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
}
function formatInstant(value,{withZone=true}={}){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return '—';
  const zone=zoneName();
  const text=new Intl.DateTimeFormat(document.documentElement.lang||undefined,
    {dateStyle:'medium',timeStyle:'short',timeZone:zone}).format(date);
  return withZone?`${text} · ${zone}`:text;
}
function instantHtml(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '—';
  return `<time datetime="${escapeHtml(date.toISOString())}" title="${escapeHtml(date.toISOString())} (UTC)">${escapeHtml(formatInstant(date))}</time>`;
}
async function loadEffectiveZone(){
  try{
    const browserTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const settings=await api(`/api/v1/settings/timezone?browserTimezone=${encodeURIComponent(browserTimezone??'')}`);
    effectiveZone=settings.effective||browserTimezone||'UTC';
  }catch{effectiveZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}
  const chip=$('#timezoneChip');
  if(chip)chip.textContent=`Zone: ${effectiveZone}`;
  return effectiveZone;
}

// ---------------------------------------------------------------------------
// The confirmation · UI-008, UI-009, UI-010, UI-052 — three of them Critical
// ---------------------------------------------------------------------------

let confirmResolve=null;
function closeConfirm(result){
  const scrim=$('#confirmScrim');if(!scrim)return;
  scrim.classList.add('hidden');
  const resolve=confirmResolve;confirmResolve=null;
  if(resolve)resolve(result);
}
/**
 * Asks before every destructive or moving action. It states what happens and to how
 * many; for several it names them and truncates with "and N more"; nothing is
 * preselected, so a stray Enter cannot destroy anything by inheriting focus.
 */
function confirmAction({title,body,names=[],consequence='',confirmLabel='Confirm',dangerous=true}){
  const scrim=$('#confirmScrim');
  if(!scrim)return Promise.resolve(false);
  $('#confirmTitle').textContent=title;
  $('#confirmBody').textContent=body;
  const shown=names.slice(0,5);
  $('#confirmNames').innerHTML=names.length
    ?`${shown.map((name)=>`<li>${escapeHtml(name)}</li>`).join('')}${names.length>shown.length?`<li>and ${names.length-shown.length} more</li>`:''}`
    :'';
  $('#confirmConsequence').textContent=consequence;
  const accept=$('#confirmAccept');
  accept.textContent=confirmLabel;
  accept.classList.toggle('danger',dangerous);
  accept.classList.toggle('primary',!dangerous);
  scrim.classList.remove('hidden');
  // Focus lands on the dialog itself, not on a button. UI-010 forbids preselecting the
  // dangerous one, and focusing Cancel instead would make Enter cancel — contradicting
  // UI-052, which says Enter confirms. Focusing neither satisfies both.
  const card=scrim.querySelector('.confirm-card');
  card.tabIndex=-1;card.focus();
  return new Promise((resolve)=>{confirmResolve=resolve;});
}
// ---------------------------------------------------------------------------
// Terminal attach code · D-0337
//
// The browser's half of "one authentication, not two". The terminal's half is a prompt in
// tools/tui-client.mjs; there is no terminal counterpart to THIS, and cannot be — a code
// only means anything as evidence that some session authenticated elsewhere.
//
// The countdown is not decoration. This credential's entire perimeter is time and single
// use (it cannot be bound to the caller's address: it is born here and spent on a unix
// socket), so a code sitting on screen with no visible clock would be the one thing the
// design refuses — an access convenience that quietly turns into standing authority. When
// it runs out the value is removed from the DOM, not merely greyed out.
// ---------------------------------------------------------------------------
let attachCodeTimer=null;
function clearAttachCode(message){
  if(attachCodeTimer){clearInterval(attachCodeTimer);attachCodeTimer=null;}
  const value=$('#attachCodeValue');
  if(value){value.textContent='';value.classList.add('hidden');}
  const status=$('#attachCodeStatus');
  if(status)status.textContent=message??'';
}
async function mintAttachCode(){
  const button=$('#attachCodeMint');
  const value=$('#attachCodeValue');
  const status=$('#attachCodeStatus');
  if(!button||!value||!status)return;
  clearAttachCode('');
  button.disabled=true;
  status.textContent='Minting…';
  try{
    const minted=await api('/api/v1/auth/attach-code',{method:'POST'});
    value.textContent=minted.code;
    value.classList.remove('hidden');
    // Counted down from the server's own expiry rather than from a local start time, so a
    // slow response shortens the displayed window instead of overstating it.
    const expiresAt=Date.parse(minted.expiresAt);
    const tick=()=>{
      const left=Math.max(0,Math.round((expiresAt-Date.now())/1000));
      if(left===0){clearAttachCode('That code expired. Mint another.');return;}
      status.textContent=`Type it at the terminal within ${left}s`;
    };
    tick();
    attachCodeTimer=setInterval(tick,1000);
  }catch(error){
    clearAttachCode(error.message??'Could not mint a code.');
  }finally{
    button.disabled=false;
  }
}
function initAttachCode(){
  $('#attachCodeMint')?.addEventListener('click',()=>{mintAttachCode();});
}

function initConfirm(){
  $('#confirmCancel')?.addEventListener('click',()=>closeConfirm(false));
  $('#confirmAccept')?.addEventListener('click',()=>closeConfirm(true));
  $('#confirmScrim')?.addEventListener('mousedown',(event)=>{if(event.target===$('#confirmScrim'))closeConfirm(false);});
  document.addEventListener('keydown',(event)=>{
    if($('#confirmScrim')?.classList.contains('hidden'))return;
    if(event.key==='Escape'){event.preventDefault();closeConfirm(false);}
    // Enter confirms (UI-052) — unless a button already holds focus, where Enter must
    // mean 'press this button' and pressing Cancel must cancel.
    else if(event.key==='Enter'&&event.target?.tagName!=='BUTTON'){event.preventDefault();closeConfirm(true);}
    else if(event.key==='Tab'){
      // The dialog is modal: focus must not walk out of it and start operating the page
      // behind a question that has not been answered.
      const focusable=[...$('#confirmScrim').querySelectorAll('button')];
      const first=focusable[0];const last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      else if(document.activeElement===$('#confirmScrim').querySelector('.confirm-card')){event.preventDefault();first.focus();}
    }
  });
}

// ---------------------------------------------------------------------------
// Work sessions · UI-001…UI-012, UI-050…UI-053
//
// NOTE ON THE WORD. "Session" is overloaded in this product: Settings → Security lists
// SIGN-IN sessions, and this lists sessions of WORK — conversations, seen from the
// operator side. They are different objects with different lifetimes, so the identifiers
// here say workSessions and nothing shadows the other renderer.
// ---------------------------------------------------------------------------

const PLACE_TITLES={active:'Working list',archived:'Archive',bin:'Bin'};
const workSessions={place:'active',page:1,data:null,selected:new Set(),focus:0};
function sessionPageSize(){return workSessions.place==='active'?50:10;}
function sessionRows(){return [...document.querySelectorAll('#section-sessions .session-row')];}
function sessionRowHtml(item,index){
  const when=instantHtml(item.lastActivityAt);
  const expiry=item.purgeAfter?` · removed after ${escapeHtml(formatInstant(item.purgeAfter,{withZone:false}))}`:'';
  const actions=workSessions.place==='bin'
    ?`<button data-session-restore="${item.id}">Restore</button><button class="danger" data-session-purge="${item.id}">Delete for good…</button>`
    :workSessions.place==='archived'
      ?`<button data-session-restore="${item.id}">Restore</button><button class="danger" data-session-bin="${item.id}">Delete…</button>`
      :`<button data-session-archive="${item.id}">Archive…</button><button class="danger" data-session-bin="${item.id}">Delete…</button>`;
  return `<div class="session-row" data-session-id="${item.id}" data-index="${index}" tabindex="-1">
    <input type="checkbox" data-session-select="${item.id}" aria-label="Select ${escapeHtml(item.title)}" ${workSessions.selected.has(item.id)?'checked':''}>
    <div><span class="session-title">${escapeHtml(item.title)}</span><small>${item.messageCount} message${item.messageCount===1?'':'s'} · ${when}${expiry}</small></div>
    <div class="session-actions">${actions}</div>
  </div>`;
}
function renderWorkSessions(){
  const data=workSessions.data;
  if(!data)return;
  $('#sessionsPlaceTitle').textContent=PLACE_TITLES[workSessions.place];
  $('#sessionsTotal').textContent=`${data.total} session${data.total===1?'':'s'}`;
  $$('#section-sessions .place').forEach((button)=>{
    const active=button.dataset.place===workSessions.place;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  });
  $('#sessionsReturn').classList.toggle('hidden',workSessions.place==='active');
  const empty=$('#sessionsEmpty');
  empty.classList.toggle('hidden',data.items.length>0);
  if(!data.items.length){
    empty.textContent=workSessions.place==='bin'
      ?`Nothing in the bin. A deleted session stays here for ${data.binRetentionDays} days.`
      :workSessions.place==='archived'?'Nothing archived.':'No sessions yet.';
  }
  // UI-001 and UI-002: five laid out, and from the sixth a scroller whose count is stated
  // ABOVE it rather than left to be discovered by scrolling.
  const first=data.items.slice(0,5);const rest=data.items.slice(5);
  $('#sessionsRecent').innerHTML=first.map((item,index)=>sessionRowHtml(item,index)).join('');
  $('#sessionsOverflowBox').classList.toggle('hidden',rest.length===0);
  $('#sessionsOverflowCount').textContent=rest.length?`${rest.length} more on this page, ${data.total} in total`:'';
  $('#sessionsOverflow').innerHTML=rest.map((item,index)=>sessionRowHtml(item,index+5)).join('');
  // UI-005: the range in words, from the same numbers that produced the slice.
  $('#sessionsRange').textContent=data.total?`${data.from}–${data.to} of ${data.total}`:'0 of 0';
  $('#sessionsPrev').disabled=data.page<=1;
  $('#sessionsNext').disabled=data.page>=data.pageCount;
  const onPage=data.items.filter((item)=>workSessions.selected.has(item.id)).length;
  $('#sessionsSelectedCount').textContent=`${workSessions.selected.size} selected`;
  $('#sessionsSelectPage').checked=Boolean(data.items.length)&&onPage===data.items.length;
  $('#sessionsDeleteSelected').disabled=workSessions.selected.size===0;
  const restoreSelected=$('#sessionsRestoreSelected');
  restoreSelected.classList.toggle('hidden',workSessions.place==='active');
  restoreSelected.disabled=workSessions.selected.size===0;
  $('#sessionsDeleteSelected').textContent=workSessions.place==='bin'?'Delete selected for good…':'Delete selected…';
  bindSessionRows();
}
function bindSessionRows(){
  $$('[data-session-select]').forEach((box)=>box.addEventListener('change',()=>{
    const id=box.dataset.sessionSelect;
    if(box.checked)workSessions.selected.add(id);else workSessions.selected.delete(id);
    renderWorkSessions();
  }));
  $$('[data-session-archive]').forEach((button)=>button.addEventListener('click',()=>sessionAction('archive',[button.dataset.sessionArchive])));
  $$('[data-session-bin]').forEach((button)=>button.addEventListener('click',()=>sessionAction('bin',[button.dataset.sessionBin])));
  $$('[data-session-restore]').forEach((button)=>button.addEventListener('click',()=>sessionAction('restore',[button.dataset.sessionRestore])));
  $$('[data-session-purge]').forEach((button)=>button.addEventListener('click',()=>sessionAction('purge',[button.dataset.sessionPurge])));
}
function sessionTitles(ids){
  const known=new Map((workSessions.data?.items??[]).map((item)=>[item.id,item.title]));
  return ids.map((id)=>known.get(id)??id);
}
const SESSION_WORDS={
  archive:{verb:'Archive',consequence:'Archiving moves the session. Nothing is deleted and it comes back whole.'},
  unarchive:{verb:'Restore',consequence:'The session returns to the working list.'},
  restore:{verb:'Restore',consequence:'The session returns to the working list.'},
  bin:{verb:'Delete',consequence:'It goes to the bin and stays recoverable for 30 days.'},
  purge:{verb:'Delete for good',consequence:'This cannot be undone. The session, its branches and its messages are destroyed.'},
};
async function sessionAction(action,ids){
  if(!ids.length)return;
  const words=SESSION_WORDS[action];
  const titles=sessionTitles(ids);
  // UI-008: every destructive or moving action asks. No exception, including archive,
  // which moves rather than destroys — the criterion says every.
  const accepted=await confirmAction({
    title:`${words.verb} ${ids.length} session${ids.length===1?'':'s'}?`,
    body:ids.length===1
      ?`${words.verb} “${titles[0]}”.`
      :`${words.verb} ${ids.length} sessions:`,
    names:ids.length===1?[]:titles,
    consequence:words.consequence,
    confirmLabel:words.verb,
    dangerous:action==='bin'||action==='purge',
  });
  if(!accepted)return;
  const result=await api('/api/v1/sessions/actions',{method:'POST',body:JSON.stringify({action,ids})});
  for(const id of ids)workSessions.selected.delete(id);
  const refused=result.refused?.length??0;
  announceEvent(`${words.verb}: ${result.applied?.length??0} session${(result.applied?.length??0)===1?'':'s'}${refused?`, ${refused} refused`:''}`);
  if(refused)toast({title:'Some sessions were not moved',body:result.refused.map((item)=>item.reason).join(' · '),kind:'warning'});
  await loadWorkSessions();
  // The sidebar reads the same records, so it has to be refreshed by the same action that
  // changed them — otherwise archiving a chat in Settings leaves the sidebar still offering
  // it. That refresh rides on `refreshWorkspace()` below, which every mutation already
  // calls, rather than a second fetch here.
  await refreshWorkspace();
}
async function loadWorkSessions(place=workSessions.place,page=workSessions.page){
  workSessions.place=place;workSessions.page=page;
  const query=new URLSearchParams({place,page:String(page),pageSize:String(sessionPageSize())});
  workSessions.data=await api(`/api/v1/sessions?${query}`);
  workSessions.page=workSessions.data.page;
  renderWorkSessions();
}
function focusSessionRow(index){
  const rows=sessionRows();
  if(!rows.length)return;
  workSessions.focus=Math.min(Math.max(index,0),rows.length-1);
  rows.forEach((row,position)=>row.classList.toggle('focused',position===workSessions.focus));
  rows[workSessions.focus].focus();
}

// ---------------------------------------------------------------------------
// The chat list in the sidebar — the same records as Settings › Sessions, rendered where
// the work actually happens.
//
// What is SHARED with the management surface, deliberately: `sessionAction()` and therefore
// `confirmAction()` (so `UI-008`/`UI-009`/`UI-010` cannot drift apart — one popup, one set of
// words, one rule about which button is dangerous), the `/api/v1/sessions` route, and the
// archive page itself, which this only links to.
//
// What is its OWN, and why that is not a duplicate: this list is always the ACTIVE place,
// while Settings can be looking at the archive or the bin. Sharing `workSessions.place`
// would empty the sidebar the moment someone opened the archive in Settings. So the state
// here is a page of data and nothing else — no second notion of what archiving means.
const chatNav={data:null,open:true};

function chatNavRowHtml(item){
  const when=instantHtml(item.lastActivityAt);
  const current=item.id===state.activeConversationId;
  return `<div class="chat-nav-row${current?' current':''}" data-chat-nav-id="${item.id}">
    <button class="chat-nav-open" type="button" data-chat-open="${item.id}" ${current?'aria-current="true"':''}>
      <span class="chat-nav-title">${escapeHtml(item.title)}</span>
      <small>${item.messageCount} message${item.messageCount===1?'':'s'} · ${when}</small>
    </button>
    <span class="chat-nav-actions">
      <button type="button" title="Archive" aria-label="Archive ${escapeHtml(item.title)}" data-session-archive="${item.id}">⊟</button>
      <button type="button" class="danger" title="Delete" aria-label="Delete ${escapeHtml(item.title)}" data-session-bin="${item.id}">✕</button>
    </span>
  </div>`;
}

function renderChatNav(){
  const host=$('#chatNavRecent');
  if(!host)return;
  const items=chatNav.data?.items??[];
  const total=chatNav.data?.total??0;
  $('#chatNavCount').textContent=total?String(total):'';
  $('#chatNavEmpty').classList.toggle('hidden',items.length>0);
  // UI-001 and UI-002: five laid out, the rest behind a scroller whose count is stated above
  // it — the same split the management surface makes, from the same numbers.
  const first=items.slice(0,5);const rest=items.slice(5);
  host.innerHTML=first.map(chatNavRowHtml).join('');
  $('#chatNavOverflowBox').classList.toggle('hidden',rest.length===0);
  $('#chatNavOverflowCount').textContent=rest.length?`${rest.length} more${total>items.length?` of ${total}`:''}`:'';
  $('#chatNavOverflow').innerHTML=rest.map(chatNavRowHtml).join('');
  bindChatNavRows();
}

function bindChatNavRows(){
  $$('#chatNav [data-chat-open]').forEach((button)=>button.addEventListener('click',async()=>{
    activate('chat');
    await selectConversation(button.dataset.chatOpen);
    renderChatNav();
  }));
  // The row actions are NOT reimplemented here: they call the one function that asks first.
  $$('#chatNav [data-session-archive]').forEach((button)=>button.addEventListener('click',()=>sessionAction('archive',[button.dataset.sessionArchive])));
  $$('#chatNav [data-session-bin]').forEach((button)=>button.addEventListener('click',()=>sessionAction('bin',[button.dataset.sessionBin])));
}

async function loadChatNav(){
  const host=$('#chatNavRecent');
  if(!host)return;
  try{
    // Always the active place. `pageSize` is the working list's own size, so "more" here
    // means the same thing it means in Settings rather than a second, quieter cap.
    const query=new URLSearchParams({place:'active',page:'1',pageSize:'50'});
    chatNav.data=await api(`/api/v1/sessions?${query}`);
  }catch(error){
    // A sidebar that silently shows nothing is indistinguishable from having no chats.
    chatNav.data={items:[],total:0};
    $('#chatNavEmpty').textContent=`Chats unavailable: ${error.message}`;
  }
  renderChatNav();
}

function initChatNav(){
  const toggle=$('#chatNavToggle');
  toggle?.addEventListener('click',()=>{
    chatNav.open=!chatNav.open;
    toggle.setAttribute('aria-expanded',String(chatNav.open));
    $('#chatNavBody').classList.toggle('hidden',!chatNav.open);
    $('.chat-nav-caret').textContent=chatNav.open?'▾':'▸';
  });
  // UI-004: the archive is a page, and it is the page that already exists — ten per page,
  // select-all, restore and delete, every one of them asking first.
  $('#chatNavArchive')?.addEventListener('click',()=>{
    workSessions.selected.clear();
    navigate('settings/sessions/archived');
    loadWorkSessions('archived',1);
  });
}
function initSessions(){
  $$('#section-sessions .place').forEach((button)=>button.addEventListener('click',()=>{
    workSessions.selected.clear();
    navigate(`settings/sessions/${button.dataset.place==='active'?'':button.dataset.place}`);
    loadWorkSessions(button.dataset.place,1);
  }));
  $('#sessionsReturn')?.addEventListener('click',()=>{
    workSessions.selected.clear();
    navigate('settings/sessions');
    loadWorkSessions('active',1);
  });
  $('#sessionsPrev')?.addEventListener('click',()=>loadWorkSessions(workSessions.place,workSessions.page-1));
  $('#sessionsNext')?.addEventListener('click',()=>loadWorkSessions(workSessions.place,workSessions.page+1));
  $('#sessionsSelectPage')?.addEventListener('change',()=>{
    const items=workSessions.data?.items??[];
    if($('#sessionsSelectPage').checked)for(const item of items)workSessions.selected.add(item.id);
    else for(const item of items)workSessions.selected.delete(item.id);
    renderWorkSessions();
  });
  $('#sessionsDeleteSelected')?.addEventListener('click',()=>sessionAction(workSessions.place==='bin'?'purge':'bin',[...workSessions.selected]));
  $('#sessionsRestoreSelected')?.addEventListener('click',()=>sessionAction('restore',[...workSessions.selected]));
  document.addEventListener('keydown',(event)=>{
    if(!$('#section-sessions')?.classList.contains('active'))return;
    if(!$('#confirmScrim').classList.contains('hidden'))return;
    if(isTyping(event.target))return;
    const rows=sessionRows();
    const current=rows[workSessions.focus];
    const id=current?.dataset.sessionId;
    // UI-053: in a right-to-left language "forward" is the left arrow. The pager follows
    // the language rather than the physical key.
    const rtl=getComputedStyle(document.documentElement).direction==='rtl';
    const forward=rtl?'ArrowLeft':'ArrowRight';
    const back=rtl?'ArrowRight':'ArrowLeft';
    if(event.key==='ArrowDown'){event.preventDefault();focusSessionRow(workSessions.focus+1);}
    else if(event.key==='ArrowUp'){event.preventDefault();focusSessionRow(workSessions.focus-1);}
    else if(event.key===forward&&!$('#sessionsNext').disabled){event.preventDefault();loadWorkSessions(workSessions.place,workSessions.page+1);}
    else if(event.key===back&&!$('#sessionsPrev').disabled){event.preventDefault();loadWorkSessions(workSessions.place,workSessions.page-1);}
    else if(event.key===' '&&id){
      event.preventDefault();
      if(workSessions.selected.has(id))workSessions.selected.delete(id);else workSessions.selected.add(id);
      const index=workSessions.focus;renderWorkSessions();focusSessionRow(index);
    }
    else if(event.key==='a'&&id&&workSessions.place==='active'){event.preventDefault();sessionAction('archive',[id]);}
    else if(event.key==='r'&&id&&workSessions.place!=='active'){event.preventDefault();sessionAction('restore',[id]);}
    // UI-051, Critical: Delete OPENS the confirmation. It never deletes on its own, so a
    // keyboard cannot destroy anything in one keystroke.
    else if(event.key==='Delete'&&id){event.preventDefault();sessionAction(workSessions.place==='bin'?'purge':'bin',[id]);}
    else if(event.key==='Enter'&&id){event.preventDefault();openSession(id);}
    else if(event.key==='a'&&(event.ctrlKey||event.metaKey)){
      event.preventDefault();
      for(const item of workSessions.data?.items??[])workSessions.selected.add(item.id);
      renderWorkSessions();
    }
  });
}
async function openSession(id){
  if(workSessions.place!=='active'){
    toast({title:'Restore it first',body:'A session outside the working list is opened by restoring it.',kind:'info'});
    return;
  }
  state.activeConversationId=id;
  activate('chat');
  await selectConversation(id);
}

// ---------------------------------------------------------------------------
// The product's metric · UI-070…UI-072
// ---------------------------------------------------------------------------

function humanDuration(totalSeconds){
  if(totalSeconds===null||totalSeconds===undefined)return '—';
  const value=Number(totalSeconds);
  if(value<60)return `${value}s`;
  if(value<3600)return `${Math.floor(value/60)}m ${value%60}s`;
  return `${Math.floor(value/3600)}h ${Math.floor((value%3600)/60)}m`;
}
async function loadReviewMetric(){
  let summary;
  // A silent `catch{return;}` used to live here, and it was the failure mode this panel is
  // least able to survive: if the route stops answering, every figure keeps its em-dash and
  // the page is indistinguishable from an installation that has simply decided nothing yet.
  // "No data" and "the metric is unreachable" are different facts about a product, and a
  // dashboard that renders them identically is the "decorative element hiding an unfinished
  // function" the design rules forbid.
  try{summary=await api('/api/v1/metrics/review-time');}
  catch(error){
    $('#metricWindow').textContent='unavailable';
    for(const id of ['#metricMedian','#metricDecided','#metricRejected'])$(id).textContent='—';
    $('#metricTrend').innerHTML='';
    $('#metricTrend').setAttribute('aria-label','The review-time metric could not be read');
    $('#metricDefinition').textContent=`The product metric could not be read: ${error?.message||'the request failed'}. This is not "no reviews yet" — the figure is unknown.`;
    return;
  }
  $('#metricWindow').textContent=`last ${summary.windowDays} days`;
  $('#metricMedian').textContent=humanDuration(summary.medianSeconds);
  $('#metricDecided').textContent=String(summary.decided);
  $('#metricRejected').textContent=String(summary.rejected.count);
  const peak=Math.max(...summary.trend.map((point)=>point.medianSeconds??0),1);
  $('#metricTrend').innerHTML=summary.trend.length
    ?summary.trend.map((point)=>`<i style="height:${Math.max(Math.round((point.medianSeconds/peak)*100),4)}%" title="${escapeHtml(point.day)}: ${escapeHtml(humanDuration(point.medianSeconds))} across ${point.decided} decision${point.decided===1?'':'s'}"></i>`).join('')
    :'';
  $('#metricTrend').setAttribute('aria-label',summary.trend.length
    ?`Daily median review time across ${summary.trend.length} days`
    :'No decisions in this window');
  // The definition travels with the figure. A number whose left edge is explained
  // somewhere else is a number that will be quoted without it.
  $('#metricDefinition').textContent=`Measured in ${summary.unit}. Rejected changes are counted, not excluded (UI-072). Interval starts at: ${summary.readyDefinition}.`;
  return summary;
}

// ---------------------------------------------------------------------------
// The initial screen · UI-060…UI-063
// ---------------------------------------------------------------------------

// A block the server withheld. It states the permission, because a panel that goes quiet
// when you are not allowed to see it is indistinguishable from a panel with nothing in it,
// and one of those two is a fact about you rather than about the product.
function withheldHtml(block,what){
  return `<p class="declared-empty withheld">${escapeHtml(what)} are not shown to this account. It would need <code>${escapeHtml(block.requires)}</code>. ${escapeHtml(block.detail??'')}</p>`;
}
function renderEntryActions(payload){
  const host=$('#homeEntryActions');if(!host)return;
  const actions=payload.entryActions??[];
  // `aria-disabled`, NOT the `disabled` attribute. A disabled button is removed from the
  // tab order, and these three exist entirely to explain what is missing — so disabling
  // them would hide that explanation from exactly the people who cannot see the dimmed
  // styling. They stay reachable and announced as unavailable; nothing is bound to them,
  // so pressing one does nothing. The audit's own exclusion note is what surfaced this:
  // it reported skipping disabled controls, and three of them were mine.
  host.innerHTML=actions.map((action)=>`<button class="entry-action${action.wired?'':' entry-waiting'}" data-entry-action="${escapeHtml(action.id)}"${action.wired?'':' aria-disabled="true"'}><b>${escapeHtml(action.label)}</b><span>${escapeHtml(action.detail)}</span></button>`).join('');
  // Declared rather than left to be counted, the same way the bench states how many of its
  // status fields have a source: two of six acting is the honest headline of this screen.
  const chip=$('#homeEntryWired');
  if(chip)chip.textContent=`${payload.entryActionsWired} of ${actions.length} can act on this build`;
  for(const button of host.querySelectorAll('[data-entry-action]')){
    const action=actions.find((item)=>item.id===button.dataset.entryAction);
    if(!action?.wired||!action.target)continue;
    button.addEventListener('click',async()=>{
      if(action.target.sessionId){activate('chat');await selectConversation(action.target.sessionId);return;}
      activate(action.target.view);
      if(action.target.focus){const field=$(`#${action.target.focus}`);if(field)field.focus();}
    });
  }
}
function renderQuickActions(payload){
  const host=$('#homeGoalActions');if(!host)return;
  const actions=payload.quickActions??[];
  host.innerHTML=actions.map((action)=>`<button class="goal-action" data-goal-action="${escapeHtml(action.id)}">${escapeHtml(action.goal)}</button>`).join('');
  const count=$('#homeGoalCount');if(count)count.textContent=`${actions.length} goals`;
  for(const button of host.querySelectorAll('[data-goal-action]')){
    const action=actions.find((item)=>item.id===button.dataset.goalAction);
    button.addEventListener('click',()=>{
      // ACT, because every one of these ten asks for something to be done rather than
      // explained. The goal lands in the composer and is NOT sent: a screen that fires a
      // request off the back of one click decides for the person what they meant.
      setMode('ACT');
      activate('chat');
      const composer=$('#chatInput');
      if(composer){composer.value=action.goal;composer.focus();}
    });
  }
}
function renderServices(payload){
  const host=$('#homeServices');if(!host)return;
  const block=payload.services??{};
  const chip=$('#homeServicesStatus');
  if(chip){chip.textContent=block.status??'—';chip.className=`badge ${block.status==='healthy'?'badge-on':'badge-off'}`;}
  const safe=block.safeMode?.active
    ?`<p class="notice">Safe mode is active${block.safeMode.since?` since ${instantHtml(block.safeMode.since)}`:''}. Mutations are refused; reads still answer.</p>`
    :'';
  const detail=block.detailVisible
    ?`<ul class="service-list">${(block.components??[]).map((component)=>`<li><span class="dot ${component.healthy?'ok':'bad'}" aria-hidden="true"></span><b>${escapeHtml(component.name)}</b>${component.essential?' <span class="tag">essential</span>':''}<small translate="no">${escapeHtml(component.detailSummary??'')}</small></li>`).join('')}</ul>`
    // The count without the names. Enough to know the installation is well, not enough to
    // enumerate it — the detail belongs to the owner-only Health section and this screen
    // must not become the way around that gate.
    :`<p class="declared-empty">${block.componentCount} components checked, ${block.degradedCount} degraded. The component detail is owner-only and lives in Settings → Health.</p>`;
  host.classList.remove('empty-state');
  host.innerHTML=`${safe}${detail}<p class="hint">Checked ${instantHtml(block.checkedAt)}.</p>`;
}
function renderTools(payload){
  const host=$('#homeTools');if(!host)return;
  const block=payload.tools??{};
  host.classList.remove('empty-state');
  if(block.visible===false){host.innerHTML=withheldHtml(block,'Installed tools');return;}
  if(!block.count){
    host.innerHTML='<p class="declared-empty">No tool is registered. This is empty because nothing has been installed, not because something is hidden — a tool is registered disabled by policy and enabled deliberately.</p>';
    return;
  }
  // `translate="no"` on the name and the transport: both are DATA — an operator's own tool name,
  // or an engine method identifier a model calls by that exact spelling. `i18n.js` prescribes this
  // for text a catalogue can never close, and its absence here is what put twenty engine tool
  // names into the runtime language gap (P3).
  //
  // The second line branches on `builtin` because "no consent · no credential" is true of a
  // built-in and says nothing useful about it: there is no third party to consent to and nothing
  // to authenticate to. What it needs is a PERMISSION, which is the fact an operator actually
  // wants — and it is a description, never the gate (the gate is `can`, inside the dispatch).
  host.innerHTML=`<ul class="provenance-list">${block.items.map((tool)=>`<li><b translate="no">${escapeHtml(tool.name)}</b> <span class="tag" translate="no">${escapeHtml(tool.transport)}</span>${tool.mutative?' <span class="tag tag-warn">mutative</span>':''}
    <small>Reaches ${escapeHtml(tool.origin.reach.replace('-',' '))}${tool.origin.host?` · ${escapeHtml(tool.origin.host)}`:''}${tool.origin.declaredExternal?' · declares itself external':''}</small>
    <small>${tool.builtin?'part of this product':`${tool.consentGranted?'consent granted':'no consent'} · ${tool.credentialConfigured?'credential configured':'no credential'}`} · registered ${tool.registeredAt?instantHtml(tool.registeredAt):'—'}</small>${tool.builtin&&tool.permissions?.length?`<small translate="no">${escapeHtml(tool.permissions.join(', '))}</small>`:''}</li>`).join('')}</ul>
    ${block.count>block.shown?`<p class="hint">Showing ${block.shown} of ${block.count} registered tools.</p>`:''}
    <p class="hint">Provenance here is where a tool points, not who added it: the record carries no registrar. That name is in the audit log under <code>tool.registered</code>.</p>`;
}
function renderModels(payload){
  const host=$('#homeModels');if(!host)return;
  const block=payload.models??{};
  host.classList.remove('empty-state');
  const providers=block.providers?.visible===false
    ?withheldHtml(block.providers,'Providers')
    :block.providers.count
      ?`<ul class="provenance-list">${block.providers.items.map((profile)=>`<li><b>${escapeHtml(profile.name)}</b> <span class="tag">${escapeHtml(profile.type)}</span>
        <small>${escapeHtml(profile.reach.replace('-',' '))}${profile.baseUrl?` · ${escapeHtml(profile.baseUrl)}`:''}</small>
        <small>${profile.consentGranted?'consent granted':'no consent'} · ${profile.credentialConfigured?'credential configured':'no credential'}</small></li>`).join('')}</ul>`
      :'<p class="declared-empty">No provider is configured.</p>';
  const runtime=block.localRuntime?.visible===false
    ?withheldHtml(block.localRuntime,'The local runtime')
    :`<p class="runtime-line"><b>Local runtime</b> <small>${escapeHtml(block.localRuntime.mode??'not configured')}${block.localRuntime.model?` · ${escapeHtml(block.localRuntime.model)}`:''}${block.localRuntime.endpoint?` · ${escapeHtml(block.localRuntime.endpoint)}`:''}</small>
      <small>${block.localRuntime.launchedHere?'launched by this installation':'attached, not launched here'}${block.localRuntime.overriddenByEnvironment?' · overridden by the environment':''}</small></p>`;
  host.innerHTML=`${providers}${runtime}<p class="hint">${escapeHtml(block.trustState?.reason??'')}</p>`;
}
async function loadHome(){
  // The metric has its own route and its own failure mode; keeping it separate means a
  // metric that cannot be read does not blank the rest of the screen.
  loadReviewMetric();
  let payload;
  try{payload=await api('/api/v1/home');}
  catch(error){
    for(const id of ['#homeEntryActions','#homeGoalActions','#homeServices','#homeTools','#homeModels']){
      const host=$(id);
      // Named, not left on "Loading…". A panel that never resolves is the defect this
      // product has already shipped once and does not intend to ship again.
      if(host)host.innerHTML=`<p class="declared-empty">This panel could not load: ${escapeHtml(error.message)}</p>`;
    }
    return;
  }
  renderEntryActions(payload);
  renderQuickActions(payload);
  renderServices(payload);
  renderTools(payload);
  renderModels(payload);
  return payload;
}

// ---------------------------------------------------------------------------
// The workbench · UI-030…UI-037, and the closure · UI-036
// ---------------------------------------------------------------------------

const terminals={items:[{id:1,name:'Terminal 1',history:[]}],active:1,next:2};
// D-0230: the session protocol's HTTP bridge (/api/v1/tui/command) reaches the exact same
// engine instances the unix socket transport does — "the same live session as the
// workbench", not a second client with its own state (index.html's own words, now true).
// This is NOT a shell: every command below maps to one of the product's own already-guarded
// operations. Plans are created in the Plan panel, not typed here — this terminal reaches
// the same run, it does not start a second way to make one.
const TERMINAL_HELP = 'Commands: status | get <runId> | events <runId> | map [path] | search <query> | simulate <runId> | approve <runId> | reject <runId> [reason] | restore <runId> | help\nPlans are created in the Plan panel; this terminal reaches the same live session, not a second one.';
async function runTerminalCommand(term, line){
  term.history.push({ kind:'command', text:line });
  const [command,...rest]=line.trim().split(/\s+/);
  const arg=rest.join(' ');
  let method=null;let params={};
  switch(command){
    case '':return;
    case 'help':term.history.push({kind:'info',text:TERMINAL_HELP});return;
    case 'status':method='status';break;
    case 'get':method='workspace.get';params={runId:arg};break;
    case 'events':method='events.correlation';params={correlationId:arg};break;
    case 'map':method='repoMap.scan';params={path:arg||undefined};break;
    case 'search':method='repoMap.search';params={q:arg};break;
    case 'simulate':method='workspace.simulate';params={runId:arg};break;
    case 'measure':method='workspace.measure';params={runId:arg};break;
    case 'approve':method='workspace.approve';params={runId:arg};break;
    case 'reject':{const [runId,...reasonParts]=rest;method='workspace.reject';params={runId,reason:reasonParts.join(' ')||null};break;}
    case 'restore':method='workspace.restore';params={runId:arg};break;
    default:term.history.push({kind:'error',text:`Unknown command \`${command}\`. Type \`help\`.`});return;
  }
  try{
    const response=await api('/api/v1/tui/command',{method:'POST',body:JSON.stringify({method,params})});
    term.history.push({kind:'result',text:JSON.stringify(response.result,null,2)});
  }catch(error){
    term.history.push({kind:'error',text:error.value?.error?.reason??error.value?.error??error.message});
  }
}
function renderTerminals(){
  $('#terminalTabs').innerHTML=terminals.items.map((item)=>
    `<button type="button" role="tab" aria-selected="${item.id===terminals.active}" class="${item.id===terminals.active?'active':''}" data-terminal="${item.id}">${escapeHtml(item.name)}</button>`).join('');
  $$('[data-terminal]').forEach((button)=>button.addEventListener('click',()=>{
    terminals.active=Number(button.dataset.terminal);renderTerminals();
  }));
  const term=terminals.items.find((item)=>item.id===terminals.active);
  const lines=(term?.history??[]).map((entry)=>entry.kind==='command'?`coden-evolution> ${entry.text}`:entry.text);
  const scrollback=lines.length?escapeHtml(lines.join('\n\n')):"Attached to the same live session as the workbench (D-0230's session protocol, HTTP bridge). Type `help` below.";
  $('#terminalBody').innerHTML=`<pre class="result terminal-scrollback" id="terminalScrollback">${scrollback}</pre><form class="inline-form" id="terminalCommandForm"><input id="terminalCommandInput" placeholder="type a command — help for the list" autocomplete="off"><button class="secondary" type="submit">Run</button></form>`;
  const scrollbackNode=$('#terminalScrollback');if(scrollbackNode)scrollbackNode.scrollTop=scrollbackNode.scrollHeight;
  $('#terminalCommandForm')?.addEventListener('submit',async(event)=>{
    event.preventDefault();
    const input=$('#terminalCommandInput');
    const line=input.value;input.value='';
    if(!term||!line.trim())return;
    await runTerminalCommand(term,line);
    renderTerminals();
    $('#terminalCommandInput')?.focus();
  });
}
// Goes to a panel's address. A click and an address are now the same act, which is the
// whole point: the switcher no longer owns the panel state, it just names where to go.
//
// pushState rather than `location.hash=`: assigning the hash fires hashchange, and this
// page's own loader (VIEW_LOADERS.coden) refetches the bench on every activation — so
// every tab click would have cost a round of requests. pushState is silent, and the Back
// button still fires hashchange when it traverses between two different hashes, so the
// history stays real without a fetch per click.
function goToCodenPanel(region,name){
  const shown=activateCodenPanel(region,name);
  if(!shown)return;
  CODEN_PANEL_ON_OPEN[region]?.[shown]?.();
  const want=`#/coden/${region}/${shown}`;
  if(location.hash!==want)history.pushState(null,'',want);
  announceCodenPanel(region,shown);
}
function initBench(){
  // The markup's own initially-active panel becomes the region's default, read before any
  // click or address has moved one — so the default cannot drift from what ships.
  Object.entries(CODEN_REGIONS).forEach(([region,spec])=>{
    const active=$(`#view-coden ${attrSelect(spec.panelAttr)}.active`);
    codenDefaults[region]=active?active.getAttribute(spec.panelAttr):'';
  });
  // PHASE 3c. The breadcrumb used to be a button that opened the top address box prefixed to
  // this page — and it existed for a rule this product does keep: a keyboard shortcut is the
  // fast path, never the ONLY path. Removing the box and the breadcrumb together would have
  // left the panels reachable by typing and by nothing else.
  //
  // So the mouse path moves to where the one `/` now lives, WITHOUT adding a widget: the hint
  // under the prompt already reads "`/` opens the menu", and that `/` is made operable. It was
  // on screen either way; what changed is that clicking it does what it already said.
  //
  // DELEGATED onto the shell, which outlives every repaint of the hint line, rather than bound
  // to the button — point 2a rebuilds that button on every keystroke (the legend changes with
  // the context), so a direct listener is thrown away by the first character typed. Found by
  // mutation: disabling the per-repaint re-bind broke nothing that any test could see.
  $('#codenShell')?.addEventListener('click',(event)=>{
    if(event.target.closest('#codenPromptOpenMenu'))openCodenMenu();
  });
  // One delegated listener for the nine list panels, because their rows are re-rendered
  // whenever the workspace refreshes and per-row listeners would be re-attached, or lost,
  // on every one of those renders.
  $('#view-coden .bench-panels')?.addEventListener('click',(event)=>{
    const row=event.target.closest('.bench-nav-list button[data-jump]');
    if(row)jumpTo(row.dataset.jump);
  });
  $('#terminalAdd')?.addEventListener('click',()=>{
    terminals.items.push({id:terminals.next,name:`Terminal ${terminals.next}`,history:[]});
    terminals.active=terminals.next;terminals.next+=1;renderTerminals();
  });
  $('#terminalToggle')?.addEventListener('click',()=>{
    const collapsed=$('#benchTerminal').classList.toggle('collapsed');
    $('#terminalToggle').textContent=collapsed?'Expand':'Collapse';
    $('#terminalToggle').setAttribute('aria-expanded',String(!collapsed));
  });
  renderTerminals();
  $('#closureForm')?.addEventListener('submit',submitClosure);
  initWorkspaceActions();
  initMapPanel();
}
// The nine groups the Navigator column used to hold, now nine bench panels reached by
// address. Same ids, same lists, same cap of six — the column went, its contents did not.
//
// Their entries used to be `<button>` with no handler on them either, exactly like the
// search rows phase 2 found: seven lists of up to six controls, none of which did anything
// when clicked. They open the destination that owns that kind of thing, and say so, which
// is as far as this product can honestly take you while nothing has a per-item address.
function renderBenchNavigator(){
  const list=(items,label,empty,destination)=>items.length
    ?items.slice(0,6).map((item)=>`<button type="button" translate="no" data-jump="${escapeHtml(destination)}" title="${escapeHtml(label(item))} — opens ${escapeHtml(destination)}">${escapeHtml(label(item))}</button>`).join('')
    :`<span>${escapeHtml(empty)}</span>`;
  $('#navProjects').innerHTML=list(state.projects,(item)=>item.name,'No project yet.','projects');
  $('#navRecent').innerHTML=list(state.artifacts??[],(item)=>item.title,'Nothing opened recently.','documents');
  $('#navSessions').innerHTML=list(state.conversations,(item)=>item.title,'No session yet.','chat');
  $('#navTasks').innerHTML=list(state.tasks??[],(item)=>item.title,'No task.','home');
  $('#navAgents').innerHTML=list(state.agents??[],(item)=>item.name,'No agent.','agents');
  $('#navHistory').innerHTML=list(state.agentRuns??[],(item)=>`${item.goal??'run'} · ${item.status??''}`,'No run has happened.','agents');
  for(const id of ['#navProjects','#navRecent','#navSessions','#navTasks','#navAgents','#navHistory']){
    const node=$(id);if(node)node.classList.toggle('empty-state',node.querySelector('span')!==null);
  }
}
// UI-035. Twelve fields, and the line states how many of them have a source in this
// build. A status line that fills its gaps with plausible numbers is worse than one that
// admits them: the reader cannot tell which half to believe.
async function renderBenchStatus(){
  const sourced=new Set();
  const set=(id,value,has)=>{const node=$(id);if(!node)return;node.textContent=value;if(has)sourced.add(id);};
  // Six of these read "—" not because the facts were unavailable but because nothing here had
  // gone and got them, which is a different failure from an unsourceable field — and calling
  // both "honest" hid it. `tests` is declared by the engine's own workspace-actions status,
  // and `remote` is the git state THIS FUNCTION ALREADY FETCHES below for the git chip and
  // then threw away. What is still "—" after this is genuinely absent: `stage` (the sixteen
  // stage cycle is the engine gap, not a display gap), `files`/`warnings` (no run is open on
  // this page), `processes` (nothing tracks live children in this build).
  set('#statusStage','—',false);
  set('#statusFiles','—',false);
  set('#statusWarnings','—',false);
  set('#statusProcesses','—',false);
  // Fetched once per page load, not per activation. `workspaceActionsStatus()` returns a
  // frozen capability declaration — the same constants on every call — so asking again each
  // time this view opens buys nothing and costs a request on a path the browser suite
  // measures precisely because it must not grow (`jumping to a panel does not refetch it`).
  if(codenActionStatus===undefined){
    try{codenActionStatus=await api('/api/v1/workspace-actions');}
    catch{codenActionStatus=null;}
  }
  const actionStatus=codenActionStatus;
  // "No tests ran, and here is why" is a fact. "—" reports the same screen as a build where
  // the answer is merely unknown.
  set('#statusTests',
    actionStatus?.testExecution===false?'none (EXECUTE refused)':'—',
    actionStatus?.testExecution===false);
  set('#statusElapsed',humanDuration(Math.round((Date.now()-benchOpenedAt)/1000)),true);
  set('#statusNetwork',$('#footerPrivacy')?.textContent?.includes('Local-only')?'local only':'see privacy state',true);
  set('#statusSandbox',codenMode==='OWNER_BYPASS'?'owner bypass':'normal',true);

  // CodeN top-bar parity with the addendum §1 mockup (project/model/sandbox chips) — sourced
  // from state already loaded for the product-wide topbar chips, not a second fetch of the
  // same fact. Hardware's accelerator name is real discovery output (nvidia-smi etc, see
  // hardware.mjs) when the endpoint is reachable; left off rather than guessed otherwise.
  const projectChip=$('#codenProjectChip');
  if(projectChip)projectChip.textContent=`project ${state.projects.find((item)=>item.id===state.activeProjectId)?.name??'none'}`;
  const modelChip=$('#codenModelChip');
  if(modelChip){
    // The installation's own answer to "which model is loaded" (`/api/v1/models/active`,
    // `active-model.mjs`) — not `#chatModel`, which is a per-conversation text field that stays
    // empty on a fresh CodeN session and said `model none` even with a model resident and
    // answering both the Author and ATOM. Four distinct outcomes, never flattened into one:
    // a provider-declared free-text override still wins when set, because it names what THIS
    // conversation will actually use, which can differ from the installation's resident model.
    let label=$('#chatModel')?.value||'';
    if(!label){
      try{
        const active=await api('/api/v1/models/active');
        label=active?.state==='loaded'?(active.id||'loaded'):
          active?.state==='unreachable'?'unreachable':
          active?.state==='none-served'?'no model served':
          'none configured';
      }catch{ label='—'; }
    }
    try{
      const hardware=await api('/api/v1/hardware');
      const accelerator=hardware?.accelerators?.[0]?.name;
      if(accelerator)label=`${label} · ${accelerator}`;
    }catch{ /* leave without an accelerator suffix */ }
    // s336: the label is its own element now — the chip also carries the button that opens the
    // model chooser, and writing `textContent` on the chip would delete that button the first
    // time this line ran.
    ($('#codenModelChipLabel')??modelChip).textContent=`model ${label}`;
  }
  const sandboxChip=$('#codenSandboxChip');
  if(sandboxChip)sandboxChip.textContent=`sandbox ${codenMode==='OWNER_BYPASS'?'owner bypass':'normal'}`;

  // Tokens/cost/ctx% — s317. `usage` comes from the streaming pipeline (provider-gateway.mjs
  // now asks for it and chat-orchestrator.mjs stores it on the assistant message); it is
  // real telemetry, not a count kept by this page. A conversation with no assistant turn
  // yet, or a provider that never reported usage, leaves these "—" rather than a plausible
  // zero — the same rule every other field on this line already follows.
  let totalTokens=null,latestUsage=null,provider=null,conversationMessages=null;
  if(state.activeConversationId&&state.activeBranchId){
    try{
      const detail=await api(`/api/v1/conversations/${state.activeConversationId}/messages?branchId=${state.activeBranchId}`);
      conversationMessages=detail.messages??[];
      const withUsage=(detail.messages??[]).filter((message)=>message.role==='assistant'&&message.metadata?.usage?.totalTokens!=null);
      if(withUsage.length){
        totalTokens=withUsage.reduce((sum,message)=>sum+message.metadata.usage.totalTokens,0);
        latestUsage=withUsage.at(-1).metadata.usage;
        provider=state.providers?.find((item)=>item.id===withUsage.at(-1).metadata.providerId)??null;
      }
    }catch{ /* leave unsourced */ }
  }
  set('#statusTokens',totalTokens!=null?String(totalTokens):'—',totalTokens!=null);
  set('#statusCost',provider?(provider.external?'—':'€0.00 (local)'):'—',Boolean(provider));
  const ctxChip=$('#codenCtxChip');
  if(ctxChip){
    ctxChip.textContent=latestUsage?.totalTokens!=null&&provider?.contextWindow
      ?`ctx ${Math.min(100,Math.round((latestUsage.totalTokens/provider.contextWindow)*100))}%`
      :'ctx —';
  }

  // Addendum §1: the agent column's Conversation panel showed only a stub pointing at
  // Chat, unlike the mockup's inline turn preview. It is the SAME conversation (no second
  // chat state, per the panel's own declared-empty text) — this reuses the messages
  // already fetched above for tokens/cost rather than a second request for one fact.
  const preview=$('#codenConversationPreview'),empty=$('#codenConversationEmpty');
  if(preview&&empty){
    if(conversationMessages?.length){
      preview.classList.remove('hidden');empty.classList.add('hidden');
      preview.innerHTML=conversationMessages.slice(-4).map((message)=>
        `<p class="coden-conversation-turn"><b>${message.role==='user'?'You':escapeHtml(message.role)}</b> ${escapeHtml(message.content.length>140?`${message.content.slice(0,140)}…`:message.content)}</p>`
      ).join('');
    }else{
      preview.classList.add('hidden');preview.innerHTML='';empty.classList.remove('hidden');
    }
  }

  const gitChip=$('#codenGitChip');
  // One fetch, two readers: the chip says which branch, the status line's `remote` field says
  // how far it has diverged. This response was already being fetched for the chip and then
  // discarded, while `remote` a few lines above reported "—" for a fact sitting in this very
  // variable. The terminal shell reads the identical state over `coden.gitStatus`.
  let gitState=null;
  try{gitState=await api('/api/v1/coden/git-status');}catch{gitState=null;}
  if(gitChip){
    if(!gitState?.available)gitChip.textContent='git —';
    else if(gitState.detached)gitChip.textContent='git detached';
    else{
      const parts=[gitState.branch];
      if(gitState.hasUpstream){
        if(gitState.ahead)parts.push(`↑${gitState.ahead}`);
        if(gitState.behind)parts.push(`↓${gitState.behind}`);
      }
      gitChip.textContent=parts.join(' ');
    }
  }
  if(gitState?.available){
    const parts=[gitState.detached?'detached':gitState.branch];
    if(!gitState.hasUpstream)parts.push('(no upstream)');
    else if(gitState.ahead||gitState.behind){
      if(gitState.ahead)parts.push(`↑${gitState.ahead}`);
      if(gitState.behind)parts.push(`↓${gitState.behind}`);
    }else parts.push('in sync');
    set('#statusRemote',parts.filter(Boolean).join(' '),true);
  }else set('#statusRemote','—',false);

  let live=null;
  try{live=await api('/api/v1/coden/authorisations');}catch{live=null;}
  set('#statusAuthority',live?String(live.count):'—',Boolean(live));
  if(live){
    $('#liveAuthorityCount').textContent=String(live.count);
    $('#liveAuthorityList').classList.toggle('empty-state',live.count===0);
    $('#liveAuthorityList').innerHTML=live.count
      ?live.live.map((item)=>`<div class="metric"><span>${escapeHtml(item.operation)} · ${escapeHtml(item.canonicalPath)}</span><b>${escapeHtml(humanDuration(item.secondsRemaining))} left</b></div>`).join('')
      :'Nothing is granted right now.';
  }
  $('#statusSourced').textContent=`${sourced.size} of 12 fields have a source in this build`;
}
let benchOpenedAt=Date.now();
// `undefined` = never asked; `null` = asked and the request failed. Distinguished so a failed
// fetch is not retried on every activation while a successful one is cached — and so a build
// where the route is gone reads as unsourced rather than as a silent retry loop.
let codenActionStatus;
async function loadClosures(){
  const runs=[...(state.agentRuns??[]).map((run)=>({id:run.id,label:`Agent run · ${run.goal??run.id}`})),
    ...(state.workflowRuns??[]).map((run)=>({id:run.id,label:`Workflow run · ${run.id}`})),
    ...(state.workspaceActionRuns??[])];
  const select=$('#closureRun');
  if(select){
    select.innerHTML=runs.length
      ?runs.map((run)=>`<option value="${escapeHtml(run.id)}">${escapeHtml(run.label)}</option>`).join('')
      :'<option value="">No piece of work has run yet</option>';
    select.disabled=runs.length===0;
  }
  const metric=await loadReviewMetric();
  $('#closureReviewTime').textContent=metric?humanDuration(metric.medianSeconds):'—';
  try{
    const {closures}=await api('/api/v1/closures');
    $('#closureCount').textContent=String(closures.length);
    $('#closureList').classList.toggle('empty-state',closures.length===0);
    $('#closureList').innerHTML=closures.length?closures.map((item)=>`
      <article class="entity-card">
        <h3>${escapeHtml(item.runId)}</h3>
        <p>${escapeHtml(item.summary||'No summary given.')}</p>
        <div class="metric"><span>NOT DONE</span><b>${item.nothingLeftUndone?'declared: nothing left undone':`${item.notDone.length} item${item.notDone.length===1?'':'s'}`}</b></div>
        ${item.notDone.length?`<ul>${item.notDone.map((entry)=>`<li>${escapeHtml(entry)}</li>`).join('')}</ul>`:''}
        <div class="metric"><span>Residual risk</span><b>${escapeHtml(item.residualRisk)}</b></div>
        <small>${instantHtml(item.closedAt)}</small>
      </article>`).join(''):'Nothing closed yet.';
  }catch{/* the list is a view of the register; a failure to read it is reported by api() */}
}
async function submitClosure(event){
  event.preventDefault();
  const refusal=$('#closureRefusal');
  const notDone=$('#closureNotDone').value.split('\n').map((line)=>line.trim()).filter(Boolean);
  const nothing=$('#closureNothing').checked;
  // The rule is enforced by the server; refusing here as well means the person is told
  // why before a request goes out, not that the browser is trusted to hold the line.
  if(!notDone.length&&!nothing){
    refusal.classList.remove('hidden');
    refusal.textContent='The NOT DONE box is empty. Either name what was left undone, or state that nothing was — an empty box that says nothing is the one thing a closure may not do.';
    $('#closureNotDone').focus();
    return;
  }
  refusal.classList.add('hidden');
  try{
    await api('/api/v1/closures',{method:'POST',body:JSON.stringify({
      runId:$('#closureRun').value||'unattached',
      summary:$('#closureSummary').value,
      notDone,nothingLeftUndone:nothing,
      residualRisk:$('#closureRisk').value,
    })});
    announceEvent('Piece of work closed');
    $('#closureNotDone').value='';$('#closureSummary').value='';$('#closureRisk').value='';$('#closureNothing').checked=false;
    await loadClosures();
  }catch(error){
    refusal.classList.remove('hidden');
    refusal.textContent=error.message;
  }
}

// --- Memory (14_MEMORIA_A_CUBI.md, CUBE-009) --------------------------------
//
// The one destination for the memory the product writes for you at the end of a session
// (D-0263). Three gestures, per §11: search (the query box), browse (the same box left
// empty, or a topic filter), approve (Keep/Discard on anything new). The words a person
// reads here are plain — "Decision", "Fact", "New", "Kept" — never the schema's own
// vocabulary (`cube`, `promotion_state`, `contamination`), which stays inside the
// <details> a person has to open on purpose. Not to be confused with the "Notes" panel
// inside Knowledge (`notes-block`) — that is hand-written and pinned by a person;
// this destination is written automatically and is never edited by hand (§11: "Non si
// scrive mai una memoria a mano").
const MEMORY_CATEGORY_LABELS={
  decisione:'Decision',procedura:'How-to',convenzione:'Convention',vincolo:'Constraint',
  fatto:'Fact',difetto:'Issue',preferenza:'Preference',riferimento:'Reference',lezione:'Lesson',
};
function memoryCategoryLabel(category){return MEMORY_CATEGORY_LABELS[category]??category;}
function memoryStatusBadge(promotionState){
  if(promotionState==='project-candidate'||promotionState==='global-candidate')return '<span class="badge badge-warn">New</span>';
  if(promotionState==='project'||promotionState==='global')return '<span class="badge badge-on">Kept</span>';
  return '';
}
function memoryResultCard(item){
  const isCandidate=item.promotionState==='project-candidate'||item.promotionState==='global-candidate';
  const idPart=`${item.cube}:${item.signature}`;
  const actions=isCandidate
    ?`<div class="inline-form"><button class="primary" data-memory-keep="${escapeHtml(idPart)}" type="button">Keep</button><button class="danger" data-memory-discard="${escapeHtml(idPart)}" type="button">Discard</button></div>`
    :'';
  return `<article class="entity-card"><h3>${escapeHtml(memoryCategoryLabel(item.category))} ${memoryStatusBadge(item.promotionState)}</h3>`
    +`<p>${escapeHtml(item.content)}</p>`
    +`<small>${escapeHtml(isoToLocal(item.observedAt))}</small>`
    // Progressive disclosure (§11): provenance/contamination/promotion state are one
    // click away, never in front by default.
    +`<details><summary class="text-button">Show details</summary><p class="hint">Signature: ${escapeHtml(item.signature)}<br>Contamination: ${escapeHtml(item.contamination)}<br>Status: ${escapeHtml(item.promotionState)}</p></details>`
    +actions+`</article>`;
}
async function memoryDecide(idPart,decision){
  try{
    await api(`/api/v1/approvals/${encodeURIComponent(`memory-candidate:${idPart}`)}/decision`,{method:'POST',body:JSON.stringify({decision,reason:null})});
    toast(decision==='approve'?'Kept.':'Discarded.');
    await loadMemoryDestination();
    await refreshApprovals();
  }catch(error){toast(error.message,{kind:'error'});}
}
function bindMemoryActions(){
  $$('[data-memory-keep]').forEach((button)=>button.addEventListener('click',()=>memoryDecide(button.dataset.memoryKeep,'approve')));
  $$('[data-memory-discard]').forEach((button)=>button.addEventListener('click',()=>memoryDecide(button.dataset.memoryDiscard,'reject')));
}
async function runMemorySearch(){
  const query=$('#memorySearchQuery').value.trim();
  const category=$('#memoryTopicFilter').value;
  const params=new URLSearchParams({limit:'30'});
  if(query)params.set('query',query);
  if(category)params.set('category',category);
  const list=$('#memoryResultsList');
  const hint=$('#memoryNotFoundHint');
  try{
    const result=await api(`/api/v1/memory/recall?${params.toString()}`);
    const items=result.items??[];
    list.classList.toggle('empty-state',items.length===0);
    list.innerHTML=items.length?items.map(memoryResultCard).join(''):'Nothing found yet — try a broader topic, or leave the search empty to browse everything.';
    hint.textContent=(result.notFound?.length)?`Nothing matched: ${result.notFound.join(', ')}.`:'';
    bindMemoryActions();
  }catch(error){
    list.classList.remove('empty-state');
    list.innerHTML=`<p class="hint">${escapeHtml(error.message)}</p>`;
    hint.textContent='';
  }
}
async function loadMemoryPending(){
  const list=$('#memoryPendingList');
  const count=$('#memoryPendingCount');
  try{
    const payload=await api('/api/v1/approvals');
    const items=(payload.approvals??[]).filter((item)=>item.kind==='memory-candidate');
    count.textContent=`${items.length} waiting`;
    list.classList.toggle('empty-state',items.length===0);
    list.innerHTML=items.length?items.map((item)=>{
      const match=/^memory-candidate:([^:]+):(.+)$/.exec(item.id)||[];
      return memoryResultCard({
        category:item.title,content:item.summary,observedAt:item.requestedAt,
        promotionState:item.promotionState,contamination:item.contamination,
        cube:match[1],signature:match[2],
      });
    }).join(''):'Nothing waiting.';
    bindMemoryActions();
  }catch(error){
    list.innerHTML=`<p class="hint">${escapeHtml(error.message)}</p>`;
  }
}
function populateMemoryTopicFilter(){
  const select=$('#memoryTopicFilter');
  if(select.dataset.populated)return;
  select.dataset.populated='1';
  for(const [value,label] of Object.entries(MEMORY_CATEGORY_LABELS)){
    select.insertAdjacentHTML('beforeend',`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
  }
}
async function loadMemoryDestination(){
  populateMemoryTopicFilter();
  await Promise.all([runMemorySearch(),loadMemoryPending()]);
}
$('#memorySearchButton').addEventListener('click',runMemorySearch);
$('#memorySearchQuery').addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();runMemorySearch();}});
$('#memoryTopicFilter').addEventListener('change',runMemorySearch);

// --- Research (UI-080…096) --------------------------------------------------
//
// The one destination that reaches the open web, and only through a provider the operator
// configures and consents to (`research.mjs`'s own module comment: the SAME tools/consent
// mechanism every other connector uses, reused rather than duplicated — which is also why
// UI-089's "declared egress" needs no code here: `privacy.mjs` already discloses a consented
// external tool). Two gates stand between a goal and a report — outcomes are PROCEED (a
// report), ASK (more detail needed) or REFUSE (named category, contestable) — and this file
// never invents a fourth.
const RESEARCH_CATEGORY_LABELS={
  'physical-harm':'Instructions for physical harm',
  'animal-harm':'Instructions to harm an animal',
  'self-harm':'Self-harm',
  'legal-evasion':'Evading a legal control',
};
function researchCategoryLabel(category){return RESEARCH_CATEGORY_LABELS[category]??category;}
let researchCriteria=[];
let researchLastRefusalId=null;
function researchReportIdFromHash(){
  const query=(location.hash||'').split('?')[1]||'';
  return new URLSearchParams(query).get('report');
}
function renderResearchCriteriaChips(){
  const box=$('#researchCriteriaChips');
  box.innerHTML=researchCriteria.map((value,index)=>`<span class="chip">${escapeHtml(value)} <button type="button" data-remove-criterion="${index}" aria-label="Remove ${escapeHtml(value)}">×</button></span>`).join('');
  $$('[data-remove-criterion]').forEach((button)=>button.addEventListener('click',()=>{researchCriteria.splice(Number(button.dataset.removeCriterion),1);renderResearchCriteriaChips();}));
}
$('#researchCriterionInput').addEventListener('keydown',(event)=>{
  if(event.key!=='Enter')return;
  event.preventDefault();
  const value=$('#researchCriterionInput').value.trim();
  if(value&&!researchCriteria.includes(value)){researchCriteria.push(value);renderResearchCriteriaChips();}
  $('#researchCriterionInput').value='';
});
async function loadResearchProviderStatus(){
  const status=$('#researchProviderStatus');
  const picker=$('#researchProviderPicker');
  try{
    const info=await api('/api/v1/settings/research');
    status.textContent=info.consented?t('Configured and consented'):info.configured?t('Configured, awaiting consent'):t('Not configured');
    status.className=`badge ${info.consented?'badge-on':'badge-off'}`;
    if(currentPermissions.includes('provider.manage')){
      picker.classList.remove('hidden');
      const select=$('#researchProviderSelect');
      // §4#8, OWNER_REVIEW_2026-08-21: «nessun fornitore di ricerca configurabile». The picker
      // was always here — what was missing sat one page away: a research provider IS an
      // external tool (Agents → Tools), and an empty catalogue left this select showing an
      // unclickable placeholder OPTION as its only word on the subject. A person reading this
      // panel alone had no way to tell "go register one" from "this is broken".
      if(info.eligibleTools.length){
        select.disabled=false;
        select.innerHTML=info.eligibleTools.map((tool)=>`<option value="${escapeHtml(tool.id)}" ${tool.id===info.toolId?'selected':''}>${escapeHtml(tool.name)}${tool.consented?'':` (${escapeHtml(t('not yet consented'))})`}</option>`).join('');
      }else{
        select.disabled=true;
        select.innerHTML=`<option value="">${escapeHtml(t('No external tools registered yet'))}</option>`;
      }
      const hint=$('#researchProviderRegisterHint');
      if(hint)hint.hidden=info.eligibleTools.length>0;
    }else picker.classList.add('hidden');
  }catch{
    status.textContent=t('Could not read provider status');status.className='badge badge-off';
  }
}
$('#researchProviderSave').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  const toolId=$('#researchProviderSelect').value||null;
  try{await api('/api/v1/settings/research',{method:'PUT',body:JSON.stringify({toolId})});toast('Research provider updated.');await loadResearchProviderStatus();}
  catch(error){reportError(error,'Setting the research provider');}
}));
function researchCandidateRow(candidate){
  if(candidate.excluded)return `<article class="entity-card"><h3>${escapeHtml(candidate.name)} <span class="badge badge-off">Excluded</span></h3><p class="hint">${escapeHtml(candidate.excludedReason)}</p></article>`;
  const evidence=candidate.evidence.map((row)=>`<li><b>${escapeHtml(row.kind.replaceAll('_',' '))}</b> — ${escapeHtml(row.statement)}</li>`).join('');
  const q=candidate.evidenceQuality;
  const quality=[`${q.reviewCount} reviews`,q.timeSpanDays!=null?`over ${q.timeSpanDays} days`:null,q.verifiedPurchaseShare!=null?`${Math.round(q.verifiedPurchaseShare*100)}% verified purchase`:null].filter(Boolean).join(' · ');
  return `<article class="entity-card"><h3>${escapeHtml(candidate.name)}${candidate.sponsored?' <span class="badge badge-warn">Sponsored — not an affiliate link</span>':''}</h3>`
    +(candidate.volatileObservedAt?`<small>Observed ${escapeHtml(isoToLocal(candidate.volatileObservedAt))}</small>`:'')
    +`<ul>${evidence}</ul><p class="hint">Evidence quality: ${escapeHtml(quality)}${q.anomalyFlag?` · <b>${escapeHtml(q.anomalyNote)}</b>`:''}</p></article>`;
}
function researchReportLink(reportId){return `${location.origin}${location.pathname}#/research?report=${encodeURIComponent(reportId)}`;}
async function renderResearchReport(reportId){
  const panel=$('#researchOutcomePanel');
  panel.classList.remove('hidden');
  panel.innerHTML='<p class="hint">Loading the report…</p>';
  try{
    const report=await api(`/api/v1/research/report/${encodeURIComponent(reportId)}`);
    panel.innerHTML=`<div class="panel-title"><h2>Report</h2><span class="badge badge-on">Expires ${escapeHtml(isoToLocal(report.expiresAt))}</span></div>`
      +`<p class="hint">Link (requires a session on this installation — UI-082): <code>${escapeHtml(researchReportLink(report.id))}</code></p>`
      +`<p class="hint">The exact string sent to the provider: <code>${escapeHtml(report.queryEcho)}</code></p>`
      +report.candidates.map(researchCandidateRow).join('')
      +'<button id="researchRevokeButton" type="button" class="danger">Revoke this link now</button>';
    $('#researchRevokeButton').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
      try{await api(`/api/v1/research/report/${encodeURIComponent(report.id)}/revoke`,{method:'POST',body:'{}'});toast('Revoked.');panel.innerHTML='<p class="hint">This report has been revoked.</p>';}
      catch(error){reportError(error,'Revoking the report');}
    }));
  }catch(error){panel.innerHTML=`<p class="hint">${escapeHtml(error.message)}</p>`;}
}
function renderResearchOutcome(outcome){
  const panel=$('#researchOutcomePanel');
  panel.classList.remove('hidden');
  if(outcome.outcome==='REFUSE'){
    researchLastRefusalId=outcome.refusalId;
    panel.innerHTML=`<div class="panel-title"><h2>Refused</h2><span class="badge badge-off">${escapeHtml(outcome.stage)} check</span></div>`
      +`<p>${escapeHtml(researchCategoryLabel(outcome.category))}. Legislation, history, prevention and remediation about this topic remain reachable — what is refused is operational instructions.</p>`
      +'<button id="researchContestButton" type="button">This wasn’t right — contest this decision</button>';
    $('#researchContestButton').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
      const note=prompt('Why should this be reconsidered?');
      if(note===null)return;
      try{await api('/api/v1/research/gate/contest',{method:'POST',body:JSON.stringify({refusalId:researchLastRefusalId,note})});toast('Recorded for review.');}
      catch(error){reportError(error,'Contesting the refusal');}
    }));
    return;
  }
  if(outcome.outcome==='ASK'){
    panel.innerHTML='<div class="panel-title"><h2>The gate needs more detail</h2></div><p>Add what you actually need to the goal above — for example licensing requirements or authorised sellers — then run it again.</p>';
    return;
  }
  renderResearchReport(outcome.reportId);
}
$('#researchRunButton').addEventListener('click',(event)=>withBusy(event.currentTarget,async()=>{
  const objective=$('#researchObjective').value.trim();
  if(!objective){toast('A goal is required.',{kind:'error'});return;}
  $('#researchOutcomePanel').classList.add('hidden');
  try{renderResearchOutcome(await api('/api/v1/research/report',{method:'POST',body:JSON.stringify({objective,criteria:researchCriteria})}));}
  catch(error){reportError(error,'Running research');}
}));
async function loadResearchDestination(){
  renderResearchCriteriaChips();
  await loadResearchProviderStatus();
  const reportId=researchReportIdFromHash();
  if(reportId)await renderResearchReport(reportId);
}


// ── The model catalogue · s333 point 5 ────────────────────────────────────────────────────
//
// Owner, s318 and again in s333: «su #/models deve esserci un menu con i modelli e i modelli
// scaricati e installati devono sempre visualizzarsi per primi». Designed in s320 in
// `docs/MODEL_CATALOG_DESIGN.md`, whose first line said nothing in it was implemented — and
// that stayed true for thirteen sessions while this destination showed one panel about
// comparing providers.
//
// Every decision about lanes, grouping, filtering and refusal is made in `model-catalog.mjs`
// on the server and simply rendered here. That is not tidiness: the terminal shell reaches the
// same route, and a browser that computed its own lanes would be a second answer to the same
// question — which is the shape this project has paid for twice (`D-0300`, `D-0302`).
let modelCatalogPage=1;
// §4#1, OWNER_REVIEW_2026-08-21: an explicit escape hatch from the 6-per-page grid (D-0628),
// not a new default. Off on every load — the compact grid the Owner asked for stays what a
// person sees first.
let modelShowAll=false;
const MODEL_SHOW_ALL_PAGE_SIZE=500;
function modelFilterQuery(){
  const params=new URLSearchParams();
  const type=$('#modelFilterType')?.value??'';
  const fn=$('#modelFilterFunction')?.value??'';
  const text=($('#modelFilterText')?.value??'').trim();
  if(type)params.set('type',type);
  if(fn)params.set('fn',fn);
  if(text)params.set('q',text);
  params.set('page',String(modelCatalogPage));
  if(modelShowAll)params.set('pageSize',String(MODEL_SHOW_ALL_PAGE_SIZE));
  return params.toString();
}
const MODEL_LANE_TITLE={'in-use':'In use','downloaded':'Downloaded','unverified':'On disk, not verified'};
// The verb differs per lane, and that is the whole reason they are lanes: replace costs a
// runtime restart, use costs seconds and no network, acquire costs network, disk and time.
const MODEL_LANE_VERB={'in-use':'Replace','downloaded':'Use','unverified':'Cannot start'};
const MODEL_LANE_NOTE={
  'in-use':'What is answering right now.',
  'downloaded':'Present on disk and matching the digest its publisher declared.',
  'unverified':'Present on disk and NOT matching the declared digest, so it cannot be started. A file that was downloaded and not verified is not a model you have.',
};
// D-0520. The `available` lane is the only one whose verb is *acquire*, so it is the only one
// that grows a button — and the button is DRAWN AND DISABLED with its reason when the gesture is
// unavailable (MC-006), never removed. A missing control teaches nothing; a stopped one with a
// sentence attached teaches where it turns on.
// D-0521. Who signed this descriptor, on every card and in every lane — not only where a button
// is. A model already on disk whose publisher key has since been revoked must say so, and the
// place a person looks is the card, not a log.
function authenticityLine(item){
  const authenticity=item.authenticity;
  if(!authenticity)return '';
  if(authenticity.verified){
    return `<p class="card-actions"><span class="badge badge-on">${escapeHtml(t('Signed by'))} ${escapeHtml(authenticity.signedBy??'—')}</span>`
      +(authenticity.trustLevel?`<small translate="no">${escapeHtml(t('trust level'))} ${escapeHtml(authenticity.trustLevel)}</small>`:'')+'</p>';
  }
  return `<p class="card-actions"><span class="badge badge-off">${escapeHtml(t('Unsigned'))}</span>`
    +`<small translate="no">${escapeHtml(authenticity.reason??t('This descriptor has not been verified against a registered publisher.'))}</small></p>`;
}
function acquireControl(item,context){
  if(item.lane!=='available')return '';
  const blocked=!context.acquireOffered
    ?context.acquireReason||t('Acquiring is switched off on this installation.')
    :!context.egressConsented
      ?t('Model downloads are not allowed yet. Turn them on above — downloading is egress.')
      :item.authenticity&&!item.authenticity.verified
        ?t('Nobody registered here signed this descriptor, so the source and the digest it declares are not attested.')
        :null;
  const busy=context.busy?.has?.(item.id)?t('Acquiring…'):null;
  const label=busy??t('Acquire');
  return `<p class="card-actions"><button type="button" data-acquire="${escapeHtml(item.id)}"`
    +`${blocked||busy?' disabled':''}${blocked?` title="${escapeHtml(blocked)}"`:''}>${escapeHtml(label)}</button>`
    +(blocked?`<small translate="no">${escapeHtml(blocked)}</small>`:'')+'</p>';
}
// D-0625. «Su tutti i modelli sempre descrizione.» A missing description is rendered as a
// SENTENCE and never as a blank: a blank reads as a rendering fault, "nessuna descrizione
// dichiarata" reads as a fact about what the publisher said.
function modelDescription(item){
  return item.description
    ?`<p class="model-description">${escapeHtml(item.description)}</p>`
    :`<p class="model-description hint"><em>${escapeHtml(t('No description declared by the publisher.'))}</em></p>`;
}
// A licence with conditions is the thing a person needs told BEFORE downloading, not after.
function modelAdvisories(item){
  if(!Array.isArray(item.advisories)||item.advisories.length===0)return '';
  return `<p class="model-advisory" role="note">⚠ ${item.advisories.map((a)=>escapeHtml(a)).join(' ')}</p>`;
}
// D-0625, the Owner's requirement: «pulsante elimina, tutto con doppia conferma prima di fare
// qualcosa». Two acts that cannot both be muscle memory — press Elimina, then type the model id.
// The button is only drawn where there is something to delete; the server refuses anyway
// (`model-removal.mjs`), because a guard that lives only in the browser is not a guard.
function removeControl(item){
  if(item.lane!=='downloaded'&&item.lane!=='unverified')return '';
  return `<p class="card-actions"><button type="button" class="danger" data-remove="${escapeHtml(item.id)}">`
    +`${escapeHtml(t('Delete'))}</button></p>`
    +`<div class="model-remove-confirm" data-remove-panel="${escapeHtml(item.id)}" hidden></div>`;
}
// §3#3, OWNER_REVIEW_2026-08-21: «manca il pulsante "carica in VRAM" e la richiesta di
// conferma». The `downloaded` lane's own note already named the verb — `MODEL_LANE_VERB.
// downloaded === 'Use'` — but nothing on the card ever performed it; the chip picker
// (`createModelPicker`, chat/CodeN) was the only door to `POST /api/v1/models/activate`. Same
// route, same confirm-before-mutate shape this file already uses everywhere else (`archiveAgent`,
// project delete): one question, because loading a model REPLACES what is answering now.
function loadControl(item){
  if(item.lane!=='downloaded')return '';
  return `<p class="card-actions"><button type="button" data-load-model="${escapeHtml(item.id)}">`
    +`${escapeHtml(t('Load into memory'))}</button></p>`;
}
function modelCard(item,context={}){
  const declared=(value)=>value==='undeclared'||value===null||value===undefined
    ?'<em>undeclared</em>':escapeHtml(String(value));
  const outside=item.outsideFilter
    ?'<small>in use &middot; outside the current filter, and shown anyway — a product that hides what it is executing is one you cannot stop</small>':'';
  const source=item.sourceUrl
    ?` &middot; <a href="${escapeHtml(item.sourceUrl)}" rel="noreferrer noopener" target="_blank">${escapeHtml(t('source'))}</a>`:'';
  const size=item.parameters?` &middot; ${escapeHtml(item.parameters)}`:'';
  // Il nome di un modello e `org/nome`: l'organizzazione e gia nella riga sotto, quindi il
  // titolo mostra la parte che distingue e non ripete l'altra. Il titolo intero resta nel
  // `title` per chi ne ha bisogno.
  const shortName=String(item.id).includes('/')?String(item.id).split('/').slice(1).join('/'):item.id;
  const badges=item.functions.filter((f)=>f!=='undeclared')
    .map((f)=>`<span class="model-badge">${escapeHtml(modelCategoryTitle(f))}</span>`).join('');
  return `<article class="entity-card model-tile" translate="no">`
    +`<header class="model-tile-head"><h3 title="${escapeHtml(item.id)}">${escapeHtml(shortName)}</h3>`
    +`<div class="model-badges">${badges}</div></header>`
    +`<small>${declared(item.publisherName??item.publisher)}${size}</small>`
    +modelDescription(item)
    +`<dl class="model-facts">`
    +`<div><dt>${escapeHtml(t('Licence'))}</dt><dd>${escapeHtml(item.license??'—')}</dd></div>`
    +`<div><dt>${escapeHtml(t('Type'))}</dt><dd>${declared(item.type)}</dd></div>`
    +`<div><dt>${escapeHtml(t('Context'))}</dt><dd>${item.contextWindow?escapeHtml(String(item.contextWindow)):'<em>undeclared</em>'}</dd></div>`
    +`</dl>`
    +modelAdvisories(item)
    +outside+authenticityLine(item)
    +`<footer class="model-tile-foot">${acquireControl(item,context)}${loadControl(item)}${removeControl(item)}`
    +(item.sourceUrl?`<p class="model-source">${source.replace(' &middot; ','')}</p>`:'')+`</footer></article>`;
}
let modelCategories=[];
function modelCategoryTitle(id){
  return modelCategories.find((c)=>c.id===id)?.title??id;
}
function renderCategoryChips(catalog){
  const host=$('#modelCategoryChips');
  if(!host)return;
  const counts=catalog.grouping?.byFunction??{};
  const current=$('#modelFilterFunction')?.value??'';
  const titles=new Map((catalog.categories??modelCategories).map((c)=>[c.id,c.title]));
  const total=catalog.available.total+catalog.foreground.reduce((n,l)=>n+l.items.length,0);
  const chip=(id,label,count,active)=>
    `<button type="button" class="model-chip${active?' selected':''}" data-category="${escapeHtml(id)}"`
    +` aria-pressed="${active?'true':'false'}">${escapeHtml(label)}`
    +`<span class="model-chip-count" translate="no">${count}</span></button>`;
  host.innerHTML=chip('',t('All'),total,current==='')
    +Object.entries(counts).filter(([id])=>id!=='undeclared')
      .map(([id,count])=>chip(id,titles.get(id)??id,count,current===id)).join('');
}
function renderModelLanes(catalog){
  if(Array.isArray(catalog.categories))modelCategories=catalog.categories;
  renderCategoryChips(catalog);
  const foreground=$('#modelForegroundLanes');
  if(foreground){
    const total=catalog.foreground.reduce((sum,entry)=>sum+entry.items.length,0);
    $('#modelForegroundCount').setAttribute('translate','no');$('#modelForegroundCount').textContent=`${total} ${t('on this installation')}`;
    foreground.classList.toggle('empty-state',total===0);
    foreground.innerHTML=total===0
      ?escapeHtml(t('No model is running and none is on disk. Nothing is hidden here — this installation has none.'))
      :catalog.foreground.filter((entry)=>entry.items.length>0).map((entry)=>
        `<h4 translate="no">${escapeHtml(t(MODEL_LANE_TITLE[entry.lane]??entry.lane))} &middot; ${entry.items.length}</h4>`
        +`<p class="hint" translate="no">${escapeHtml(t(MODEL_LANE_NOTE[entry.lane]??''))} ${escapeHtml(t('Action:'))} ${escapeHtml(t(MODEL_LANE_VERB[entry.lane]??''))}.</p>`
        +`<div class="card-list model-grid">${entry.items.map(modelCard).join('')}</div>`).join('');
  }
  const list=$('#modelAvailableList');
  if(list){
    $('#modelAvailableCount').setAttribute('translate','no');$('#modelAvailableCount').textContent=`${catalog.available.total} ${t('known')}`;
    list.classList.toggle('empty-state',catalog.available.items.length===0);
    list.innerHTML=catalog.available.items.length===0
      ?escapeHtml(t('No publisher registered on this installation has declared a model that is not already here. This is the live registry, not an empty list standing in for one.'))
      :`<div class="card-list model-grid">${catalog.available.items.map((item)=>modelCard(item,{
        acquireOffered:catalog.acquisition.offered,
        acquireReason:catalog.acquisition.reason,
        egressConsented:modelEgress.consented,
        busy:acquiringModelIds(),
      })).join('')}</div>`;
    $('#modelPageLabel').setAttribute('translate','no');$('#modelPageLabel').textContent=`${t('Page')} ${catalog.available.page} ${t('of')} ${catalog.available.pages}`;
    $('#modelPagePrev').disabled=modelShowAll||catalog.available.page<=1;
    $('#modelPageNext').disabled=modelShowAll||catalog.available.page>=catalog.available.pages;
    $('#modelPageLabel').classList.toggle('hidden',modelShowAll);
  }
  // MC-006. The gesture is drawn and switched OFF with its reason, never removed: a missing
  // button teaches nothing, a stopped one teaches where it starts.
  const badge=$('#modelAcquireState');
  if(badge){
    badge.textContent=catalog.acquisition.offered?'Acquire available':'Acquire unavailable';
    badge.className=catalog.acquisition.offered?'badge badge-on':'badge badge-off';
  }
  const reason=$('#modelAcquireReason');
  if(reason)reason.setAttribute('translate','no');
  if(reason)reason.textContent=catalog.acquisition.offered
    ?t('This installation can fetch and start a model of a registered publisher. Acquiring is egress, and each acquisition is authorised on its own.')
    :`${t('Acquiring is switched off:')} ${catalog.acquisition.reason}`;
  // The declared-grouping counts, `undeclared` included as a row rather than dropped. Rebuilt
  // from the live catalogue so a type nobody publishes stops being offered as a filter.
  for(const [id,counts] of [['#modelFilterType',catalog.grouping.byType],['#modelFilterFunction',catalog.grouping.byFunction]]){
    const select=$(id);if(!select)continue;
    const chosen=select.value;
    const any=id==='#modelFilterType'?t('Any type'):t('Any function');
    select.setAttribute('translate','no');
    select.innerHTML=`<option value="">${escapeHtml(any)}</option>`
      +Object.entries(counts).sort(([a],[b])=>a.localeCompare(b))
        .map(([key,count])=>`<option value="${escapeHtml(key)}">${escapeHtml(key)} (${count})</option>`).join('');
    select.value=chosen;
  }
}
async function loadModelCatalogue(){
  const foreground=$('#modelForegroundLanes');
  if(!foreground)return;
  try{
    renderModelLanes(await api(`/api/v1/models/catalog?${modelFilterQuery()}`));
  }catch(error){
    // Declared, not blank: an unreadable catalogue is a different statement from an empty one,
    // and rendering the second when the first happened is how a page lies quietly.
    foreground.classList.add('empty-state');
    foreground.setAttribute('translate','no');
    foreground.textContent=`${t('The catalogue could not be read:')} ${error.value?.error??error.message}. ${t('This is not the same as having no models.')}`;
  }
}
// ── D-0520 · acquiring a model: the consent, the job, and what it is doing ────────────────
//
// Three things had to become visible at once for the button to be honest. Whether this
// installation is ALLOWED to fetch at all (egress, off by default, its own consent — not
// inherited from having consented to some remote provider). What a running download is doing,
// because several gigabytes is a job and not a request. And why one failed, including the digest
// that did not match: a download that vanishes silently is indistinguishable from a button that
// does nothing.
let modelEgress={consented:false,canManage:true};
let modelAcquisitions=[];
let acquisitionPoll=null;
const ACQUISITION_ACTIVE=['queued','downloading','verifying'];
const acquiringModelIds=()=>new Set(modelAcquisitions
  .filter((job)=>ACQUISITION_ACTIVE.includes(job.state)).map((job)=>job.modelId));
const ACQUISITION_STATE_LABEL={
  queued:'Queued',downloading:'Downloading',verifying:'Verifying',
  completed:'Verified and on disk',failed:'Failed',cancelled:'Cancelled',
};
/** Bytes as a person reads them. Never a percentage when the total was never declared. */
function humanBytes(value){
  if(!Number.isFinite(value))return '—';
  const units=['B','KB','MB','GB','TB'];
  let size=value,unit=0;
  while(size>=1024&&unit<units.length-1){size/=1024;unit+=1;}
  return `${size>=100||unit===0?Math.round(size):size.toFixed(1)} ${units[unit]}`;
}
function acquisitionProgress(job){
  if(!ACQUISITION_ACTIVE.includes(job.state))return '';
  const received=humanBytes(job.receivedBytes);
  // A percentage is shown only when the server declared a total. Inventing a denominator to
  // make a progress bar move is the same class of lie as inventing a field on a card.
  const share=Number.isFinite(job.totalBytes)&&job.totalBytes>0
    ? ` · ${Math.min(100,Math.floor((job.receivedBytes/job.totalBytes)*100))}%`:'';
  return `<progress${Number.isFinite(job.totalBytes)&&job.totalBytes>0
    ? ` value="${job.receivedBytes}" max="${job.totalBytes}"`:''}></progress>`
    +`<small translate="no">${escapeHtml(received)}${job.totalBytes?` / ${escapeHtml(humanBytes(job.totalBytes))}`:''}${escapeHtml(share)}</small>`;
}
function acquisitionRow(job){
  const active=ACQUISITION_ACTIVE.includes(job.state);
  const badge=job.state==='completed'?'badge-on':active?'badge':'badge-off';
  const failure=job.reason
    ?`<p class="hint" translate="no">${escapeHtml(job.reason)}</p>`:'';
  // The two digests, side by side, when they disagreed. This is the single most useful thing a
  // person can be shown here and the one a generic "download failed" throws away.
  const digests=job.kind==='DIGEST_MISMATCH'&&job.digest
    ?`<p class="hint" translate="no">${escapeHtml(t('Declared:'))} ${escapeHtml(job.expectedSha256??'—')}<br>`
      +`${escapeHtml(t('Received:'))} ${escapeHtml(job.digest)}</p>`:'';
  const quarantined=job.quarantinedAs
    ?`<p class="hint">${escapeHtml(t('Kept aside, not deleted and not startable.'))}</p>`:'';
  const cancel=active
    ?`<button type="button" class="secondary" data-acquire-cancel="${escapeHtml(job.id)}">${escapeHtml(t('Cancel'))}</button>`:'';
  return `<article class="entity-card" translate="no"><h3>${escapeHtml(job.modelId)}</h3>`
    +`<p><span class="badge ${badge}">${escapeHtml(t(ACQUISITION_STATE_LABEL[job.state]??job.state))}</span> ${cancel}</p>`
    +acquisitionProgress(job)+failure+digests+quarantined+'</article>';
}
function renderAcquisitions(){
  const list=$('#modelAcquisitionList');
  if(!list)return;
  const count=$('#modelAcquisitionCount');
  if(count){count.setAttribute('translate','no');count.textContent=`${modelAcquisitions.length} ${t('recorded')}`;}
  list.classList.toggle('empty-state',modelAcquisitions.length===0);
  list.innerHTML=modelAcquisitions.length===0
    ?escapeHtml(t('No acquisition has been started on this installation.'))
    :`<div class="card-list">${modelAcquisitions.map(acquisitionRow).join('')}</div>`;
}
/**
 * Poll while something is in flight, and stop when nothing is. A timer that keeps running after
 * the last job ended is a page that costs battery for ever; one that stops too early is a
 * download that looks stuck. The condition below is the same one the rows are drawn from.
 */
async function refreshAcquisitions({schedule=true}={}){
  try{
    const before=acquiringModelIds();
    const payload=await api('/api/v1/models/acquisitions');
    modelAcquisitions=payload.acquisitions??[];
    renderAcquisitions();
    const after=acquiringModelIds();
    // Something finished: the catalogue's lanes changed, so it is re-read once rather than on
    // every tick — the lane a model sits in is the whole point of finishing.
    if([...before].some((id)=>!after.has(id)))await loadModelCatalogue();
  }catch{/* the panel keeps what it last knew rather than blanking on one failed poll */}
  clearTimeout(acquisitionPoll);
  if(schedule&&acquiringModelIds().size>0)acquisitionPoll=setTimeout(()=>refreshAcquisitions(),1500);
}
async function loadModelEgress(){
  try{
    const payload=await api('/api/v1/settings/model-egress');
    modelEgress={consented:Boolean(payload.consented),canManage:payload.canManage!==false};
  }catch{modelEgress={consented:false,canManage:false};}
  renderModelEgress();
}
function renderModelEgress(){
  const badge=$('#modelEgressState');
  if(badge){
    badge.textContent=modelEgress.consented?t('Downloads allowed'):t('Downloads not allowed');
    badge.className=modelEgress.consented?'badge badge-on':'badge badge-off';
  }
  const button=$('#modelEgressToggle');
  if(button){
    // A switch this account cannot throw is shown STOPPED with its reason, not shown live and
    // then refused by the server — the same posture the acquire button takes one panel below.
    button.disabled=!modelEgress.canManage;
    button.title=modelEgress.canManage?'':t('Changing this needs the permission to manage providers.');
    button.textContent=modelEgress.consented?t('Stop allowing model downloads'):t('Allow model downloads');
  }
  const reason=$('#modelEgressReason');
  if(reason)reason.textContent=modelEgress.consented
    ?t('Acquiring a model may reach the publisher named in its descriptor. What leaves this installation is the request for that artefact — never a conversation, a file or a credential.')
    :t('Downloading is egress, so it is off until you allow it. Nothing leaves this installation while this is off.');
}
async function toggleModelEgress(){
  const next=!modelEgress.consented;
  try{
    const payload=await api('/api/v1/settings/model-egress',{method:'PUT',body:JSON.stringify({consented:next})});
    modelEgress={...modelEgress,consented:Boolean(payload.consented)};
    renderModelEgress();
    await loadModelCatalogue();
    toast(next?t('Model downloads are now allowed.'):t('Model downloads are no longer allowed.'),{kind:'info'});
  }catch(error){
    toast(`${t('The setting could not be changed:')} ${error.value?.error??error.message}`,{kind:'error',correlationId:error.correlationId});
  }
}
async function acquireModel(id){
  try{
    const payload=await api('/api/v1/models/acquire',{method:'POST',body:JSON.stringify({id})});
    if(payload.job)modelAcquisitions=[payload.job,...modelAcquisitions.filter((job)=>job.id!==payload.job.id)];
    renderAcquisitions();
    await loadModelCatalogue();
    refreshAcquisitions();
  }catch(error){
    // The server's own refusal, verbatim. Each one names a rule — no consent, publisher not
    // registered, publisher revoked, no declared digest, runtime disabled, already on disk —
    // and replacing them with "could not start" would throw the only useful part away.
    toast(`${t('This model was not acquired:')} ${error.value?.error??error.message}`,{kind:'error',correlationId:error.correlationId});
  }
}
// ── D-0625 · eliminare un modello, con la doppia conferma ─────────────────────────────────────
//
// First act: press Delete. The panel then asks the server what would actually go — how many
// bytes, and whether it can go at all — so the question is answered against a fact and not
// against a name. Second act: type the model id. Only then is the commit button armed.
//
// Neither act is trusted: `model-removal.mjs` re-checks both server-side, because a
// confirmation that lives only in the browser is a confirmation an HTTP client skips.
function findByData(attribute,id){
  for(const node of document.querySelectorAll(`[data-${attribute}]`)){
    if(node.dataset[attribute.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]===id)return node;
  }
  return null;
}
function closeRemoveConfirm(id){
  const panel=findByData('remove-panel',id);
  if(panel){panel.hidden=true;panel.innerHTML='';}
}
async function loadModel(id){
  if(!confirm(t('Loading a model into memory replaces whatever is answering now and takes a moment. Load this one?')))return;
  const button=findByData('load-model',id);
  if(button)button.disabled=true;
  try{
    await api('/api/v1/models/activate',{method:'POST',body:JSON.stringify({id})});
    toast(t('Loaded — this is what answers now.'),{kind:'success'});
    await loadModelCatalogue();
    await refreshCodenModelChip();
  }catch(error){
    toast(`${t('This model could not be loaded:')} ${error.value?.error??error.message}`,{kind:'error',correlationId:error.correlationId});
    if(button)button.disabled=false;
  }
}
async function openRemoveConfirm(id){
  const panel=findByData('remove-panel',id);
  if(!panel)return;
  panel.hidden=false;
  panel.innerHTML=`<p class="hint">${escapeHtml(t('Checking what would be removed…'))}</p>`;
  try{
    const preview=await api(`/api/v1/models/removal-preview/${encodeURIComponent(id)}`);
    if(!preview.removable){
      // Refused BEFORE asking for a confirmation. Asking someone to type an id and then telling
      // them it was never possible is a worse experience than saying so first.
      panel.innerHTML=`<p class="model-advisory" role="note">⚠ ${escapeHtml(preview.reason??t('This model cannot be removed.'))}</p>`
        +`<p class="card-actions"><button type="button" data-remove-cancel="${escapeHtml(id)}">${escapeHtml(t('Close'))}</button></p>`;
      return;
    }
    const mb=(preview.bytes/(1024*1024)).toFixed(1);
    panel.innerHTML=`<p class="model-advisory" role="note">⚠ ${escapeHtml(t('This deletes bytes that do not come back.'))} `
      +`${escapeHtml(t('It will free'))} <strong translate="no">${escapeHtml(mb)} MB</strong>.</p>`
      +`<p>${escapeHtml(t('Second confirmation: type the model id to say which one.'))}</p>`
      +`<p><input type="text" data-remove-input="${escapeHtml(id)}" autocomplete="off" spellcheck="false" `
      +`aria-label="${escapeHtml(t('Type the model id to confirm'))}" placeholder="${escapeHtml(id)}"></p>`
      +`<p class="card-actions">`
      +`<button type="button" class="danger" data-remove-commit="${escapeHtml(id)}" disabled>${escapeHtml(t('Delete permanently'))}</button> `
      +`<button type="button" data-remove-cancel="${escapeHtml(id)}">${escapeHtml(t('Cancel'))}</button></p>`;
  }catch(error){
    panel.innerHTML=`<p class="model-advisory" role="note">⚠ ${escapeHtml(error.value?.error??error.message)}</p>`
      +`<p class="card-actions"><button type="button" data-remove-cancel="${escapeHtml(id)}">${escapeHtml(t('Close'))}</button></p>`;
  }
}
async function commitRemove(id){
  const typed=findByData('remove-input',id)?.value?.trim();
  try{
    const result=await api(`/api/v1/models/remove/${encodeURIComponent(id)}`,{
      method:'POST',
      body:JSON.stringify({confirm:true,confirmId:typed??null}),
    });
    closeRemoveConfirm(id);
    toast(`${t('Model removed:')} ${id} — ${(result.bytesFreed/(1024*1024)).toFixed(1)} MB`,{kind:'success'});
    await loadModelCatalogue();
  }catch(error){
    // The server's refusal verbatim, for the same reason acquireModel keeps it: each one names
    // which rule stopped it, and "could not delete" throws that away.
    toast(`${t('This model was not removed:')} ${error.value?.error??error.message}`,{kind:'error',correlationId:error.correlationId});
  }
}
async function cancelAcquisition(jobId){
  try{
    await api(`/api/v1/models/acquisitions/${encodeURIComponent(jobId)}/cancel`,{method:'POST',body:'{}'});
  }catch(error){
    toast(`${t('The acquisition was not cancelled:')} ${error.value?.error??error.message}`,{kind:'error',correlationId:error.correlationId});
  }
  await refreshAcquisitions();
  await loadModelCatalogue();
}
/**
 * D-0521 · import a descriptor, by either door.
 *
 * The refusal is shown verbatim, because each one names a different thing that is wrong —
 * unsigned, edited since signing, a key this installation never registered, a key that has been
 * revoked — and "import failed" would throw away the only part worth reading.
 */
async function importDescriptor(payload){
  try{
    const result=await api('/api/v1/models/descriptors/import',{method:'POST',body:JSON.stringify(payload)});
    toast(`${t('Descriptor accepted, signed by')} ${result.authenticity?.signedBy??'—'}`,{kind:'info'});
    const paste=$('#modelDescriptorPaste');if(paste)paste.value='';
    const urlField=$('#modelDescriptorUrl');if(urlField)urlField.value='';
    await loadModelCatalogue();
  }catch(error){
    toast(`${t('This descriptor was refused:')} ${error.value?.error??error.message}`,{kind:'error',correlationId:error.correlationId});
  }
}
function wireModelCatalogue(){
  $('#modelEgressToggle')?.addEventListener('click',toggleModelEgress);
  $('#modelDescriptorPasteImport')?.addEventListener('click',()=>{
    const raw=$('#modelDescriptorPaste')?.value?.trim();
    if(!raw)return toast(t('Paste the descriptor first.'),{kind:'error'});
    let parsed;
    // Parsed here so a typo is answered instantly and locally, rather than travelling to the
    // server to come back as a 422 that says the same thing more slowly.
    try{parsed=JSON.parse(raw);}catch{return toast(t('That is not valid JSON.'),{kind:'error'});}
    importDescriptor({descriptor:parsed});
  });
  $('#modelDescriptorFetch')?.addEventListener('click',()=>{
    const source=$('#modelDescriptorUrl')?.value?.trim();
    if(!source)return toast(t('Give the address to fetch it from.'),{kind:'error'});
    importDescriptor({source});
  });
  // Delegated: the cards are rebuilt on every filter change and on every completed download, so
  // a listener per button would be a listener per render.
  $('#modelAvailableList')?.addEventListener('click',(event)=>{
    const id=event.target?.closest?.('[data-acquire]')?.dataset?.acquire;
    if(id)acquireModel(id);
  });
  $('#modelCategoryChips')?.addEventListener('click',(event)=>{
    const node=event.target?.closest?.('[data-category]');
    if(!node)return;
    // Scrive nel filtro che esiste gia invece di tenere un secondo stato: due posti che dicono
    // "quale categoria" e come si finisce con la pagina e la tendina che non sono d'accordo.
    const select=$('#modelFilterFunction');
    if(select)select.value=node.dataset.category??'';
    modelCatalogPage=1;
    loadModelCatalogue();
  });
  $('#modelAcquisitionList')?.addEventListener('click',(event)=>{
    const jobId=event.target?.closest?.('[data-acquire-cancel]')?.dataset?.acquireCancel;
    if(jobId)cancelAcquisition(jobId);
  });
  // D-0625. The delete gesture lives on the foreground lanes, because only a model that is on
  // disk has bytes to remove. Delegated for the same reason as the acquire handler above.
  $('#modelForegroundLanes')?.addEventListener('click',(event)=>{
    const load=event.target?.closest?.('[data-load-model]')?.dataset?.loadModel;
    if(load)return loadModel(load);
    const start=event.target?.closest?.('[data-remove]')?.dataset?.remove;
    if(start)return openRemoveConfirm(start);
    const commit=event.target?.closest?.('[data-remove-commit]')?.dataset?.removeCommit;
    if(commit)return commitRemove(commit);
    const cancel=event.target?.closest?.('[data-remove-cancel]')?.dataset?.removeCancel;
    if(cancel)return closeRemoveConfirm(cancel);
  });
  $('#modelForegroundLanes')?.addEventListener('input',(event)=>{
    const id=event.target?.dataset?.removeInput;
    if(!id)return;
    // The second confirmation is only ARMED when the typed id matches. Enabling it on any input
    // would make it a second click, which is the thing this is here to not be.
    const button=findByData('remove-commit',id);
    if(button)button.disabled=event.target.value.trim()!==id;
  });
  for(const id of ['#modelFilterType','#modelFilterFunction']){
    $(id)?.addEventListener('change',()=>{modelCatalogPage=1;loadModelCatalogue();});
  }
  let typing;
  $('#modelFilterText')?.addEventListener('input',()=>{
    clearTimeout(typing);typing=setTimeout(()=>{modelCatalogPage=1;loadModelCatalogue();},250);
  });
  $('#modelFilterClear')?.addEventListener('click',()=>{
    for(const id of ['#modelFilterType','#modelFilterFunction','#modelFilterText']){const node=$(id);if(node)node.value='';}
    modelCatalogPage=1;loadModelCatalogue();
  });
  $('#modelPagePrev')?.addEventListener('click',()=>{modelCatalogPage=Math.max(1,modelCatalogPage-1);loadModelCatalogue();});
  $('#modelPageNext')?.addEventListener('click',()=>{modelCatalogPage+=1;loadModelCatalogue();});
  $('#modelShowAll')?.addEventListener('change',(event)=>{
    modelShowAll=Boolean(event.target.checked);
    modelCatalogPage=1;
    loadModelCatalogue();
  });
  // §4#2. A <details>-shaped disclosure driven by hand rather than <details> itself, so the
  // panel-title layout (h2 + badge on one line) does not have to change shape to hold it.
  $('#modelCatalogInfo')?.addEventListener('click',()=>{
    const button=$('#modelCatalogInfo');const help=$('#modelCatalogHelp');
    if(!button||!help)return;
    const open=help.hidden;
    help.hidden=!open;
    button.setAttribute('aria-expanded',String(open));
  });
}

// ── s336 · the model chooser on the CodeN page ────────────────────────────────────────────
//
// Owner, 2026-08-17: «crei in #/coden un piccolo menu che fa visualizzare i modelli scaricati e
// fa scegliere quale usare».
//
// It asks `GET /api/v1/models/installed`, which is the SAME decision `/model` with no id answers
// in either shell (`installedModelList` in `server.mjs`, built on `loadableModels`). A chooser
// that filtered a catalogue itself would eventually offer a model the terminal refuses to start,
// and the person would be looking at two products.
//
// What it deliberately does NOT do: acquire, delete, or browse what exists elsewhere. Those live
// on `#/models`, which the footer links to. A small menu that grows a second copy of a big page
// is how two pages start disagreeing.
// s341 — the sentence this chooser was missing: a model that STARTED is not yet a model that
// ANSWERS. The panel showed "In use" beside a row while chat could still be served by
// something else entirely, and nothing on the page said so. The field is computed once, in
// `server.mjs`, from the same call the router makes, so this line and `/model` over `ssh`
// cannot disagree — and when chat does not use the model, the reason is shown rather than
// the absence being left to be noticed.
function codenChatAnswerMarkup(chat){
  if(!chat)return '';
  if(chat.answers){
    return `<p class="model-picker-chat"><span class="badge badge-on">${escapeHtml(t('Chat answers from'))} `
      +`<span translate="no">${escapeHtml(chat.model??'—')}</span></span></p>`;
  }
  return `<p class="model-picker-chat"><span class="badge badge-off">${escapeHtml(t('Chat is not answering from a local model'))}</span> `
    +`<small translate="no">${escapeHtml(chat.reason??'')}</small></p>`;
}
/** The chip above the terminal, re-read from the installation after an activation — never
 *  written from the activation's own reply, which would make the chip say "loaded" while the
 *  next read of `models/active` still names the model before it. Shared by every picker
 *  instance: which model is active is one fact for the whole installation, not one per view. */
async function refreshCodenModelChip(){
  const label=$('#codenModelChipLabel');if(!label)return;
  try{
    const active=await api('/api/v1/models/active');
    label.textContent=`model ${active?.state==='loaded'?(active.id||'loaded')
      :active?.state==='unreachable'?'unreachable'
      :active?.state==='none-served'?'no model served':'none configured'}`;
  }catch{ label.textContent='model —'; }
}
/**
 * The model picker, as a factory rather than a page-bound singleton.
 *
 * Owner, 2026-08-21, on the chat composer: "devi mettere una finestra con i modelli che sono
 * scaricati in modo da poter caricare e cambiare subito" — the same request s336 already made
 * for #/coden. Building a second, chat-only copy of the list/render/activate logic would be
 * exactly the defect this component's own comments already warn about twice (D-0300, D-0302,
 * and s336's "a chooser that filtered a catalogue itself... would show a person a model the
 * terminal would refuse to start"): two places computing the same thing, free to disagree.
 * One factory, two instances — #/coden's chip-anchored picker and the chat composer's — each
 * with its own open/closed and pending-confirmation state, both reading and writing through
 * the identical `GET /api/v1/models/installed` / `POST /api/v1/models/activate` pair.
 */
function createModelPicker({panelId,openId,closeId,countId,listId}){
  let pending=null;
  let snapshot=null;
  function rowMarkup(entry,activeId){
    const inUse=entry.lane==='in-use'||(activeId!=null&&entry.id===activeId);
    const declared=(value)=>value==null||value===''||value==='undeclared'
      ?`<em>${escapeHtml(t('undeclared'))}</em>`:escapeHtml(String(value));
    const facts=[
      declared(entry.publisher),
      `${escapeHtml(t('type'))} ${declared(entry.type)}`,
      entry.contextWindow?`${escapeHtml(t('context'))} ${escapeHtml(String(entry.contextWindow))}`
        :`${escapeHtml(t('context'))} <em>${escapeHtml(t('undeclared'))}</em>`,
    ].join(' &middot; ');
    // D-0535. Who says this is this — on the surface that STARTS a model, not only on the page
    // that lists them. Three states, and the third is not a warning: `SYNTHESISED` means this
    // installation wrote the record from its own runtime, so there is no signature to look for
    // and its absence says nothing. Rendering that as "unsigned" would be a false alarm about
    // the model the product is running.
    const authenticity=entry.authenticity;
    const provenance=!authenticity
      ?''
      :authenticity.verified
        ?`<span class="badge badge-on">${escapeHtml(t('Signed by'))} ${escapeHtml(authenticity.signedBy??'—')}</span>`
        :authenticity.kind==='SYNTHESISED'
          ?`<span class="badge" title="${escapeHtml(authenticity.reason??'')}">${escapeHtml(t('Provenance unknown'))}</span>`
          :`<span class="badge badge-off" title="${escapeHtml(authenticity.reason??'')}">${escapeHtml(t('Unsigned'))}</span>`;
    // A model whose descriptor does not verify is not startable, so the gesture that would start
    // it is drawn STOPPED with its reason rather than removed — MC-006's posture, and it is what
    // the server would answer anyway (403).
    const unattested=Boolean(authenticity)&&!authenticity.verified&&authenticity.kind!=='SYNTHESISED';
    const action=inUse
      ?`<span class="badge badge-on">${escapeHtml(t('In use'))}</span>`
      :unattested
        ?`<button type="button" class="secondary" disabled title="${escapeHtml(authenticity.reason??'')}">${escapeHtml(t('Use'))}</button>`
        :`<button type="button" class="secondary" data-model-use="${escapeHtml(entry.id)}">${escapeHtml(t('Use'))}</button>`;
    // The confirmation takes the row's own space rather than opening a dialog over it: what is
    // being confirmed stays visible, in place, which a second layer does not give.
    const confirming=pending===entry.id
      ?`<div class="model-row-confirm"><span>${escapeHtml(t('Starting this stops the model that is answering now.'))}</span>`
        +`<button type="button" class="primary" data-model-confirm="${escapeHtml(entry.id)}">${escapeHtml(t('Start it'))}</button>`
        +`<button type="button" class="text-button" data-model-cancel="1">${escapeHtml(t('Cancel'))}</button></div>`
      :'';
    return `<div class="model-row${inUse?' active':''}" role="listitem" data-model-id="${escapeHtml(entry.id)}">`
      +`<div><b translate="no">${escapeHtml(entry.id)}</b><small translate="no">${facts}</small>${provenance}</div>`
      +`<div>${action}</div>${confirming}</div>`;
  }
  function render(data,{loading=false,error=null}={}){
    const list=$(listId);if(!list)return;
    const count=$(countId);
    list.setAttribute('aria-busy',loading?'true':'false');
    const say=(text)=>{list.innerHTML=`<p class="empty-state">${escapeHtml(text)}</p>`;};
    if(loading){if(count)count.textContent='—';return say(t('Reading what is present…'));}
    if(error){
      // Declared, never blank: an unreadable list and an empty one are different statements,
      // and rendering the second when the first happened is how a page lies quietly.
      if(count)count.textContent='—';
      return say(`${t('The list could not be read:')} ${error} ${t('This is not the same as having no models.')}`);
    }
    const models=data?.models??[];
    const activeId=data?.activeId??null;
    if(count){count.setAttribute('translate','no');count.textContent=`${models.length} ${t('startable')}`;}
    if(!models.length){
      // The "who answers" line survives an empty list on purpose: a runtime attached to a model
      // no descriptor describes IS answering chat while nothing here is startable, and a panel
      // that went blank in that state would hide the one fact the operator came for.
      list.innerHTML=codenChatAnswerMarkup(data?.chat)
        +`<p class="empty-state">${escapeHtml(t('No model on this installation can be started. Nothing is hidden here: a model present but not matching the digest its publisher declared cannot be started, and one that declares no launch command cannot either — both are shown, with their reason, under All models.'))}</p>`;
      return undefined;
    }
    list.innerHTML=codenChatAnswerMarkup(data?.chat)+models.map((entry)=>rowMarkup(entry,activeId)).join('');
  }
  /** Re-paint for a choice that changed nothing on the server — from the payload already held,
   *  never from the DOM. Reading the rows back to rebuild them would make the page its own data
   *  source, and every fact the server declared (`undeclared` included) would have to survive a
   *  round trip through markup to stay true. No request either: opening a confirmation must not
   *  be something the network can slow down or disagree with. */
  function repaint(){ if(snapshot)render(snapshot); }
  async function load(){
    const list=$(listId);if(!list)return;
    render(null,{loading:true});
    try{
      snapshot=await api('/api/v1/models/installed');
      render(snapshot);
    }catch(error){
      snapshot=null;
      render(null,{error:error.value?.error??error.message});
    }
  }
  async function activate(id){
    const list=$(listId);if(!list)return;
    const row=[...list.querySelectorAll('[data-model-id]')].find((node)=>node.dataset.modelId===id);
    for(const button of row?.querySelectorAll('button')??[])button.disabled=true;
    try{
      await api('/api/v1/models/activate',{method:'POST',body:JSON.stringify({id})});
      pending=null;
      await load();
      await refreshCodenModelChip();
    }catch(error){
      // The server's own refusal, in the row that asked for it — 404 unknown, 409 present but
      // unverified, 422 no launch command. Replacing it with "activation failed" would throw
      // away the only part of the answer that says what to do next.
      pending=null;
      if(row){
        for(const button of row.querySelectorAll('button'))button.disabled=false;
        const note=document.createElement('p');
        note.className='model-row-note';
        note.setAttribute('role','status');
        note.textContent=`${t('Refused:')} ${error.value?.error??error.message}`;
        row.append(note);
      }
    }
  }
  function wire(){
    const picker=$(panelId);
    const open=$(openId);
    if(!picker||!open)return;
    const setOpen=(shown)=>{
      picker.classList.toggle('hidden',!shown);
      open.setAttribute('aria-expanded',shown?'true':'false');
      if(shown)load();else pending=null;
    };
    open.addEventListener('click',()=>setOpen(picker.classList.contains('hidden')));
    $(closeId)?.addEventListener('click',()=>{setOpen(false);open.focus();});
    // Escape closes it and returns focus to the control that opened it — the same contract
    // every other overlay on this page keeps.
    picker.addEventListener('keydown',(event)=>{if(event.key==='Escape'){setOpen(false);open.focus();}});
    $(listId)?.addEventListener('click',(event)=>{
      const use=event.target.closest('[data-model-use]');
      const confirm=event.target.closest('[data-model-confirm]');
      const cancel=event.target.closest('[data-model-cancel]');
      if(use){pending=use.dataset.modelUse;return repaint();}
      if(cancel){pending=null;return repaint();}
      if(confirm)return activate(confirm.dataset.modelConfirm);
    });
  }
  return {wire};
}
const codenModelPicker=createModelPicker({
  panelId:'#codenModelPicker',openId:'#codenModelPickerOpen',closeId:'#codenModelPickerClose',
  countId:'#codenModelPickerCount',listId:'#codenModelPickerList',
});
const chatModelPicker=createModelPicker({
  panelId:'#chatModelPicker',openId:'#chatModelPickerOpen',closeId:'#chatModelPickerClose',
  countId:'#chatModelPickerCount',listId:'#chatModelPickerList',
});


// ── The information buttons · s333 point 3c ───────────────────────────────────────────────
//
// Owner: «vanno messi i tasti `i` di informazione che cliccando danno suggerimenti».
//
// One mechanism, not thirty-three edits to the markup. A missing help button is invisible —
// the panel simply looks like every other panel — so the way to make "every page has one" true
// is to derive it rather than to remember it. The button is placed into each page's own
// header, from the same address the router uses, and `page-help.test.mjs` fails when a page
// has no entry AND when an entry names a page that does not exist. Neither half can rot alone.
//
// The panel is one element reused, not one per page: thirty-three popovers would be
// thirty-three things to keep in sync with the language, the theme and the focus ring.
function helpAddressOf(section){
  const id=section.id??'';
  if(id.startsWith('view-')&&!section.dataset.section)return id.slice(5);
  const owner=section.dataset.section??id.replace(/^(view|section)-/,'');
  return section.classList.contains('view')?id.slice(5):`settings/${owner}`;
}
function closeHelp(){
  const panel=$('#pageHelp');
  if(!panel)return;
  panel.classList.add('hidden');
  $$('.help-button[aria-expanded="true"]').forEach((node)=>node.setAttribute('aria-expanded','false'));
}
function openHelp(button,address){
  const entry=PAGE_HELP[address];
  const panel=$('#pageHelp');
  if(!panel)return;
  // A page with no entry says so rather than opening an empty box. An empty explanation reads
  // as "there is nothing to know here", which is a claim, and a false one.
  panel.innerHTML=entry
    ?`<h3>${escapeHtml(t('What this is'))}</h3><p>${escapeHtml(t(entry.what))}</p><h3>${escapeHtml(t('What is worth doing here'))}</h3><p>${escapeHtml(t(entry.howto))}</p><p class="hint">${escapeHtml(t('Press Escape to close.'))}</p>`
    :`<p>${escapeHtml(t('No help has been written for this page yet.'))}</p>`;
  panel.setAttribute('translate','no');
  panel.classList.remove('hidden');
  button.setAttribute('aria-expanded','true');
  panel.focus();
}
function installHelpButtons(){
  try{installHelpButtonsUnsafely();}catch(error){
    // Reported, not swallowed: an information button that silently fails to appear is exactly
    // the invisible omission this whole mechanism exists to prevent.
    console.error('help buttons could not be installed',error);
    document.body.dataset.helpError=String(error?.message??error);
  }
}
function installHelpButtonsUnsafely(){
  if(!$('#pageHelp')){
    const panel=document.createElement('div');
    panel.id='pageHelp';
    panel.className='help-panel hidden';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','Page information');
    panel.tabIndex=-1;
    document.body.append(panel);
  }
  // Anchored on the SECTION and not on `.section-header`, because four pages do not have one:
  // Home opens with a `.hero`, and chat, coden and models-hardware have neither. Anchoring on
  // the header would have shipped those four without a button, looking exactly like the pages
  // that have one — which is the invisible omission this whole mechanism exists to prevent,
  // reproduced by the mechanism itself. A page with no header gets a strip that holds only this.
  for(const section of $$('.view,.settings-section,.settings-sub')){
    let header=section.querySelector(':scope > .section-header, :scope > .hero');
    if(!header){
      header=document.createElement('div');
      header.className='section-header help-anchor';
      section.prepend(header);
    }
    if(header.querySelector('.help-button'))continue;
    const address=helpAddressOf(section);
    const button=document.createElement('button');
    button.type='button';
    button.className='help-button';
    button.dataset.help=address;
    button.setAttribute('aria-expanded','false');
    button.setAttribute('aria-controls','pageHelp');
    // The label carries the page, so a screen reader is not read "i" thirty-three times.
    button.setAttribute('aria-label',`Information about ${address}`);
    button.textContent='i';
    header.append(button);
  }
}
document.addEventListener('click',(event)=>{
  const button=event.target.closest?.('.help-button');
  if(button){
    const open=button.getAttribute('aria-expanded')==='true';
    closeHelp();
    if(!open)openHelp(button,button.dataset.help);
    return;
  }
  if(!event.target.closest?.('#pageHelp'))closeHelp();
});
document.addEventListener('keydown',(event)=>{if(event.key==='Escape')closeHelp();});

Object.assign(VIEW_LOADERS,{
  memory:loadMemoryDestination,
  research:loadResearchDestination,
  workflows:loadWorkflows,
  coden:()=>{benchOpenedAt=benchOpenedAt||Date.now();loadCoden();renderBenchNavigator();renderBenchStatus();renderTerminals();},
  home:loadHome,
  // D-0520: the consent is read BEFORE the catalogue, because the Acquire button on every card
  // is drawn from it — reading it after would draw the whole page in the wrong state first.
  models:async()=>{await loadModelEgress();await loadModelCatalogue();await refreshAcquisitions();},
  // s333 point 3b — the seven that were painted once at sign-in and never again. They all read
  // the SAME fetch, so they share the one loader: seven copies would be seven places to forget
  // one, which is the shape D-0300 and D-0302 were both about.
  chat:refreshWorkspaceData,
  tools:refreshWorkspaceData,
  projects:refreshWorkspaceData,
  documents:refreshWorkspaceData,
  knowledge:refreshWorkspaceData,
  agents:refreshWorkspaceData,
});
// The loaders of the demoted pages, keyed by the section that now owns them. "Health and
// logs" is one section holding two former pages, so it runs both: merging two entries in
// the menu must not silently drop one of their fetches.
// `/skills`. Renders the at-rest posture from the live registry rather than a claim: the
// count, what a session is carrying in context right now, and — when something is adopted —
// what each one costs. Never a skill body: the route it reads has no field that carries one.
async function loadSkillCatalog(){
  const target=$('#skillCatalogStatus');
  if(!target)return;
  try{
    const status=await api('/api/v1/skill-catalog');
    const rows=(status.adoptedSkills??[]).map((skill)=>`<li><strong>${escapeHtml(skill.name)}</strong> &middot; ${skill.instructionBytes} bytes of context${skill.permanent?' &middot; permanent':''}</li>`).join('');
    target.classList.toggle('empty-state',status.atRest);
    target.innerHTML=status.atRest
      ? '<p>Nothing adopted. This installation carries <strong>no skills at rest</strong> and spends <strong>0 bytes</strong> of context on them. Searching the catalogue returns what a skill is and what adopting it would cost &mdash; never its instructions.</p>'
      : `<p><strong>${status.adoptedSkillCount}</strong> adopted, costing <strong>${status.contextBytes}</strong> bytes of context.</p><ul>${rows}</ul>`;
  }catch(error){
    // Declared, never blank: a section that fails silently reads as "there are no skills",
    // which is the one thing this surface must not say when it does not know.
    target.classList.add('empty-state');
    target.textContent=`The skill catalogue could not be read: ${error.message}`;
  }
}
Object.assign(SECTION_LOADERS,{
  skills:loadSkillCatalog,
  sessions:()=>loadWorkSessions(sessionPlaceFromHash(),1),
  appearance:renderAppearance,
  language:loadSettings,
  security:loadSecurity,
  people:loadUsers,
  health:()=>{loadHealth();loadLogs();},
  updates:loadUpdates,
  storage:loadBackups,
  about:loadAbout,
  audit:refreshApprovals,
  modules:loadOwnerModules,
  // s333 point 3b. Both of these already had a working loader and no way to reach it by
  // arriving: the hardware probe ran only if you pressed Refresh, and the remote-target list
  // only after you acted on it. A page whose content appears solely after you press something
  // is indistinguishable from a page with no content.
  'models-hardware':refreshHardware,
  'remote-targets':loadRemoteTargets,
  privacy:refreshWorkspaceData,
});

wireModelCatalogue();
codenModelPicker.wire();
chatModelPicker.wire();
// Owner, 2026-08-21: "su coden evolution fai come chat per poter mettere i modelli
// velocemente" — the picker already existed here (s336), reachable only from a small "▾" on
// the model chip up in `.coden-bar`. Not a second picker: a second door onto the SAME one,
// right where the prompt is, matching the icon the chat composer now has for the identical
// gesture. Delegates to the existing open button rather than wiring `codenModelPicker` a
// second time — one picker, one `wire()` call, two ways in.
$('#codenPromptModelOpen')?.addEventListener('click',()=>$('#codenModelPickerOpen')?.click());
installHelpButtons();
initI18n();
initAppearance();
// Reading preferences are applied BEFORE the router paints anything: applying them after
// would show the interface at one size and then move it, which is exactly the flash a
// person who needs larger type does not need to see twice.
initReadingControls();
initConfirm();
initAttachCode();
initSessions();
initChatNav();
initBench();
// --- D-0404 slice 3 · attaching the CodeN terminal ------------------------------------------
//
// Dynamic import, and the reason is measured rather than stylistic: `xterm.mjs` is 345 KB, and
// a static import would put it on the critical path of EVERY destination — Chat, Settings,
// Home — for a surface most loads never open. Imported on first attach, cached by the module
// system afterwards, so the cost is paid once and only by someone who went to CodeN.
//
// **The binding this comment used to introduce now lives at the TOP of the module** (`D-0416`),
// because the boot path reaches it earlier than this line: `initAppearance()` calls
// `applyTheme()`, which tells the embedded terminal about the theme, which reads `codenTerminal`.
// `attachCodenTerminal`/`detachCodenTerminal` are function declarations and hoist, so they are
// callable long before their text; a `let` is not, and a read of one before its declaration line
// throws `Cannot access 'codenTerminal' before initialization` — an uncaught module error that
// killed the WHOLE WebUI at boot when slice 3 shipped it, auth gate included. Anything the boot
// sequence can reach is declared above the first line of that sequence.
initRouter();
initializeAuth()
  .then(()=>loadEffectiveZone())
  .catch((error)=>authError(error.message));

// `D-0418` · the emulator lives in its OWN document, embedded here.
//
// It used to be imported straight into this page, and that could not work: xterm.js injects three
// <style> elements and writes a `style` attribute per painted cell, all refused by
// `style-src 'self'` — 72 refusals, measured in a browser, with the terminal attached and unable
// to paint. A nonce cannot cover style attributes and hashes cannot cover per-cell values, so the
// relaxation is unavoidable; giving it to THIS document, where every form, session and piece of
// operator data lives, is not. `coden-terminal.html` gets it instead, and it contains one
// element and one module.
//
// What crosses the boundary is deliberately narrow: state OUT (so the visible status line, the
// live region and `data-terminal-state` stay on this side, where the rest of the interface and
// the accessibility tree can see them), theme IN. Keystrokes, geometry and the socket never
// cross — they belong to the document the emulator is in, which is why there is no input
// protocol here to get wrong.
// Found 2026-08-15 (D-0456) driving `#codenPrompt` in the browser e2e suite: the hide below
// used to fire unconditionally, mid-keystroke if the terminal's async attach happened to land
// there. A script driving the box synthetically just gets its Enter silently swallowed by a
// box that stopped being rendered; a PERSON typing into it gets their words vanish under a
// surface change they never asked for and were given no notice of — the same defect, worse for
// a human because there is no error to read, only a box that is suddenly gone. `legacyPromptBusy`
// and `maybeApplyLegacyHide` defer the hide until the person is done with the box (submits,
// clears it, or looks away) instead of cutting them off. `legacyHidePending` is intentionally
// visible file scope, not a closure inside `codenTerminalState`: the three places that can end a
// busy spell (`submitCodenPrompt`, the input listener, a new blur listener, all in `wireCodenShell`)
// need to ask the SAME question `codenTerminalState` asked when it deferred. The flag itself
// (`legacyHidePending`) is declared near `codenMenuIndex`, before `initRouter()` — `D-0416`'s
// own guard: a module-level `let` declared after the router starts is in the temporal dead
// zone for any boot call that reaches it, and `attachCodenTerminal()`/`detachCodenTerminal()`
// (called from the router's own activation path) can reach `codenTerminalState` on the very
// first tick.
function legacyPromptBusy(){
  const box=$('#codenPrompt');
  return Boolean(box)&&(document.activeElement===box||box.value.trim()!=='');
}
function applyLegacyHide(){
  const legacyShell=$('#codenShell');const legacyHeading=$('#codenShellHeading');
  legacyShell?.classList.add('hidden');legacyHeading?.classList.add('hidden');
  legacyHidePending=false;
}
function maybeApplyLegacyHide(){
  if(legacyHidePending&&!legacyPromptBusy())applyLegacyHide();
}
function codenTerminalState(state,detail){
  const host=$('#codenTerminalHost');const statusEl=$('#codenTerminalStatus');
  if(host)host.dataset.terminalState=state;
  if(statusEl){statusEl.dataset.state=state;statusEl.textContent=detail||CODEN_TERMINAL_STATUS[state]||state;}
  // Owner instruction, 2026-08-13: `#/coden` shows ONE chat, the emulated TUI — not the TUI
  // AND the legacy prompt/transcript/menu stacked under it. The legacy shell (`#codenShell`)
  // stays in the DOM (rule 12: nothing here is deleted) and stays the fallback for a browser
  // or a bridge that cannot attach the emulator (`CLAUDE10.md` §63-64: a limitation on one
  // installation is a fact about a category of host, degraded to, never a reason to remove the
  // capability everywhere). Hidden the moment the terminal is actually live AND the person is
  // not in the middle of using it (D-0456: deferred, not skipped, while they are); restored the
  // moment the terminal is not.
  const legacyShell=$('#codenShell');
  if(legacyShell){
    const hide=state==='live';
    const show=state==='failed'||state==='refused'||state==='idle';
    if(hide){if(legacyPromptBusy())legacyHidePending=true;else applyLegacyHide();}
    else if(show){legacyShell.classList.remove('hidden');$('#codenShellHeading')?.classList.remove('hidden');legacyHidePending=false;}
  }
}
function codenTerminalTheme(){
  // Sent on ready and on every appearance change: the child derives its palette from the same
  // tokens this document uses, so the emulator follows all nine themes instead of being a tenth.
  const frame=codenTerminal?.contentWindow;
  if(!frame)return;
  frame.postMessage({channel:'coden-terminal',type:'theme',
    theme:document.documentElement.dataset.theme??'midnight',
    textScale:getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim()},window.location.origin);
}
window.addEventListener('message',(event)=>{
  // Same origin AND the window we framed. Anything else is dropped: a page that acts on
  // whatever posts to it has handed its interface to whoever wrote the message.
  if(event.origin!==window.location.origin)return;
  if(!codenTerminal||event.source!==codenTerminal.contentWindow)return;
  const data=event.data;
  if(!data||data.channel!=='coden-terminal')return;
  if(data.type==='ready'){codenTerminalTheme();return;}
  if(data.type==='state')codenTerminalState(data.state,data.detail);
});
function attachCodenTerminal(){
  if(codenTerminal)return;
  const host=$('#codenTerminalHost');
  if(!host)return;
  codenTerminalState('connecting');
  const frame=document.createElement('iframe');
  frame.className='coden-terminal-embed';
  frame.src='./coden-terminal.html';
  // Named for assistive technology and for anyone reading the DOM. The region's own
  // `role="application"`, name and live-region status stay on the parent element around it.
  frame.title='CodeN Evolution terminal';
  // Nothing this document does not already allow: same-origin (the session cookie must reach
  // `WS /ws/coden`), scripts, and nothing else — no forms, no popups, no top-level navigation.
  frame.setAttribute('sandbox','allow-scripts allow-same-origin');
  frame.addEventListener('error',()=>codenTerminalState('failed','This terminal could not start.'));
  host.appendChild(frame);
  codenTerminal=frame;
}
function detachCodenTerminal(){
  if(!codenTerminal)return;
  // Removing the iframe destroys the document inside it, and with it the socket, the
  // ResizeObserver and the reconnect timer. That is the whole disposal — there is nothing left
  // on this side to leak, which is a property of the boundary rather than of remembering to
  // call `dispose()`.
  codenTerminal.remove();
  codenTerminal=null;
  codenTerminalState('idle','Not connected.');
}

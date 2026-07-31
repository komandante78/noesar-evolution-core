// SPDX-License-Identifier: AGPL-3.0-or-later
import { initI18n, applyTranslations } from './i18n.js';
import { qrSvg } from './qr.js';
import { parseHex, contrast, deriveReadable, formatRatio } from './colour.js';
import { isZonelessInstant, splitTasks, zonedWallClockToUtcIso } from './schedule.js';
const $=(selector)=>document.querySelector(selector);const $$=(selector)=>[...document.querySelectorAll(selector)];

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
function applyTheme(id){
  document.documentElement.dataset.theme=id;
  try{localStorage.setItem(THEME_KEY,id);}catch{}
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
const state={projects:[],conversations:[],branches:[],memories:[],artifacts:[],sources:[],providers:[],providerCatalog:[],tools:[],agents:[],agentRuns:[],workspaceActionRuns:[],activeProjectId:null,activeConversationId:null,activeBranchId:null};
const escapeHtml=(value)=>String(value??'').replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
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
function showOnly(form){['#setupForm','#setupMfaForm','#loginForm','#loginMfaForm'].forEach((selector)=>$(selector).classList.toggle('hidden',selector!==form));}
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
const ROUTES=new Set(['home','chat','coden','coden-tui','projects','documents','knowledge','memory','agents','workflows','models','research','settings']);
// The Settings destination's own menu: menu inside the menu, in three groups. The order
// here is the order rendered, and it is the source of truth for which section a hash may
// name — the markup is checked against it at boot rather than being trusted.
const SETTINGS_SECTIONS=['sessions','appearance','language','about','licence','privacy','people','security','models-hardware','storage','audit','health','updates'];
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
// What a page needs before it is worth offering at all. `role` mirrors the routes the
// server guards with requireOwner — a literal role check, not a permission — and
// `permission` is tested against the set the server itself reports for this account,
// so the two cannot drift apart. An entry absent from this table is open to any signed-in
// session. None of this is enforcement: every request is still checked by the server.
// The gates moved with the pages they guard: they are now section gates, and losing one
// in the move would have turned a restructure into a privilege escalation.
const ROUTE_ACCESS={};
const SECTION_ACCESS={
  people:{permission:'user.manage'},
  storage:{permission:'data.manage'},
  health:{role:'owner'},
  updates:{role:'owner'},
};
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
  let activeSection='';
  if(target==='settings')activeSection=activateSection(section);
  // Sections belong to Settings alone. Leaving the destination clears them, otherwise a
  // section would still be marked active behind a page that no longer contains it.
  else $$('.settings-section').forEach((node)=>node.classList.remove('active'));
  // The address keeps naming what was asked for. Rewriting it to #/access-denied would
  // make a reload land on a route that does not exist, turning a 403 into a 404.
  // The place is part of the address, so switching to the Archive and reloading lands on
  // the Archive. Only Sessions has one; every other section normalises it away.
  const wantedPlace=activeSection==='sessions'&&['archived','bin'].includes(place)?`/${place}`:'';
  const want=known?(target==='settings'&&activeSection?`${view}/${activeSection}${wantedPlace}`:view):target;
  const currentHash=(location.hash||'').replace(/^#\/?/,'').split('?')[0].trim().toLowerCase();
  if(updateHash&&currentHash!==want)location.hash=`#/${want}`;
  const scope=activeSection?document.querySelector(`.settings-section[data-section="${activeSection}"]`):document.querySelector(`#view-${target}`);
  const heading=(scope&&scope.querySelector('h1,h2.page-title'))||document.querySelector(`#view-${target} h1`);
  document.title=heading?`${heading.textContent.trim()} · NOESAR Evolution`:'NOESAR Evolution';
  // Announce the change for assistive technology, which does not observe a class flip.
  const live=$('#routeAnnouncer');if(live)live.textContent=`${heading?heading.textContent.trim():target} view`;
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
function initRouter(){
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
  if(title){const nav=$$('.nav').find((node)=>node.dataset.view===view);title.textContent=nav?`Context · ${nav.textContent.replace('not built','').trim()}`:'Context';}
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
async function initializeAuth(){const status=await api('/api/v1/auth/status');if(!status.initialized){$('#authTitle').textContent=status.pendingSetup?'Complete Owner setup':'Initialize NOESAR securely';showOnly('#setupForm');return;}try{const me=await api('/api/v1/auth/me');currentUser=me.user;currentPermissions=me.permissions??[];await enterApplication();}catch{showOnly('#loginForm');}}
async function enterApplication(){$('#authGate').classList.add('hidden');$('#userAvatar').textContent=(currentUser?.displayName??currentUser?.username??'U').slice(0,1).toUpperCase();if(currentUser?.role!=='owner'){const bypass=$('[data-mode="OWNER_BYPASS"]');bypass.disabled=true;}
  // The router runs at boot, before the role is known, so every gated route resolved to
  // access-denied on a cold deep link — including for the Owner. Re-apply the nav and
  // re-activate the requested route now that we know who is signed in.
  applyNavAccess();
  goToHash();
  // The approval strip is permanent, so it is filled on sign-in rather than only when the
  // Approvals page is opened — a strip that says nothing until you visit the page it links
  // to cannot do the one job it exists for.
  await Promise.all([refreshPrivacy(),refreshHardware(),refreshWorkspace(),loadExtractorCapabilities(),refreshApprovals()]);}
$('#setupForm').addEventListener('submit',async(event)=>{event.preventDefault();authError();try{const result=await api('/api/v1/auth/setup',{method:'POST',headers:{'x-noesar-setup-token':$('#setupToken').value},body:JSON.stringify({username:$('#setupUsername').value,displayName:$('#setupDisplayName').value,password:$('#setupPassword').value})});setupChallenge=result.challenge;$('#setupTotpSecret').textContent=result.totpSecret;showOnly('#setupMfaForm');}catch(error){authError(error.message);}});
$('#setupMfaForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/setup/confirm',{method:'POST',body:JSON.stringify({challenge:setupChallenge,totpCode:$('#setupTotpCode').value})});csrfToken=result.csrfToken;currentUser=result.user;currentPermissions=result.permissions??[];await enterApplication();}catch(error){authError(error.message);}});
$('#loginForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginUsername').value,password:$('#loginPassword').value})});loginChallenge=result.challenge;showOnly('#loginMfaForm');}catch(error){authError(error.message);}});
$('#loginMfaForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/login/mfa',{method:'POST',body:JSON.stringify({challenge:loginChallenge,totpCode:$('#loginTotpCode').value})});csrfToken=result.csrfToken;currentUser=result.user;currentPermissions=result.permissions??[];await enterApplication();}catch(error){authError(error.message);}});
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
async function refreshWorkspace(){const data=await api('/api/v1/ai/bootstrap');for(const key of ['projects','conversations','branches','memories','artifacts','sources','providers','tools','agents','agentRuns','tasks'])state[key]=data[key]??[];state.providerCatalog=data.providerCatalog??[];if(!state.activeProjectId&&state.projects.length)state.activeProjectId=state.projects[0].id;if(state.activeProjectId&&!state.projects.some((item)=>item.id===state.activeProjectId))state.activeProjectId=state.projects[0]?.id??null;if(!state.activeConversationId){const c=state.conversations.find((item)=>item.projectId===state.activeProjectId)??state.conversations[0];state.activeConversationId=c?.id??null;}renderAll();if(state.activeConversationId)await selectConversation(state.activeConversationId,false);}
function renderAll(){renderProjectOptions();renderHome();renderProjects();renderTasks();renderMemories();renderArtifacts();renderSources();renderProviders();renderAgents();updatePrivacyFromProvider();$('#retentionDays').value=state.settings?.retentionDays??365;applyTranslations();}
function renderProjectOptions(){for(const id of ['#chatProject','#artifactProject','#sourceProject','#memoryProject','#taskProject','#workflowProject']){const select=$(id);if(!select)continue;const selected=id==='#chatProject'?state.activeProjectId:select.value||state.activeProjectId;select.innerHTML=optionList(state.projects,{empty:'No project',selected});}$('#memoryConversation').innerHTML=optionList(state.conversations.filter((item)=>!state.activeProjectId||item.projectId===state.activeProjectId),{empty:'Select conversation',label:(item)=>item.title,selected:state.activeConversationId});$('#projectChip').textContent=`Project: ${state.projects.find((item)=>item.id===state.activeProjectId)?.name??'none'}`;const conversations=state.conversations.filter((item)=>!state.activeProjectId||item.projectId===state.activeProjectId);$('#chatConversation').innerHTML=optionList(conversations,{empty:'No conversation',label:(item)=>item.title,selected:state.activeConversationId});}
function renderHome(){$('#homeProjects').innerHTML=state.projects.slice(0,5).map((item)=>`<article><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description||'No description')}</small></div></article>`).join('')||'No projects yet.';$('#homeConversations').innerHTML=state.conversations.slice(-5).reverse().map((item)=>`<article><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.mode)}</small></div></article>`).join('')||'No conversations yet.';}
function renderProjects(){$('#projectCount').textContent=state.projects.length;$('#projectList').innerHTML=state.projects.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p><small>${escapeHtml(item.tags.join(' · '))}</small><button data-select-project="${item.id}">Use project</button></article>`).join('')||'No projects.';$$('[data-select-project]').forEach((button)=>button.addEventListener('click',async()=>{state.activeProjectId=button.dataset.selectProject;state.activeConversationId=null;renderProjectOptions();activate('chat');await refreshWorkspace();}));}
$('#projectForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const project=await api('/api/v1/projects',{method:'POST',body:JSON.stringify({name:$('#projectName').value,description:$('#projectDescription').value,instructions:$('#projectInstructions').value,tags:$('#projectTags').value.split(',').map((v)=>v.trim()).filter(Boolean),knowledgePolicy:{mode:$('#projectKnowledgeMode').value,limit:Number($('#projectKnowledgeLimit').value),maxCharacters:60000}})});state.activeProjectId=project.id;event.target.reset();await refreshWorkspace();setStatus('Project created.');}catch(error){setStatus(error.message,true);}});
$('#chatProject').addEventListener('change',async(event)=>{state.activeProjectId=event.target.value||null;state.activeConversationId=null;await refreshWorkspace();});
$('#chatConversation').addEventListener('change',async(event)=>selectConversation(event.target.value));
async function selectConversation(id,rerender=true){if(!id){state.activeConversationId=null;$('#messageList').textContent='Create or select a conversation.';return;}state.activeConversationId=id;const detail=await api(`/api/v1/conversations/${encodeURIComponent(id)}`);state.branches=state.branches.filter((item)=>item.conversationId!==id).concat(detail.branches);state.activeBranchId=detail.conversation.activeBranchId;currentMode=detail.conversation.mode;setMode(currentMode);$('#chatBranch').innerHTML=optionList(detail.branches,{empty:'No branch',label:(item)=>item.name,selected:state.activeBranchId});$('#chatProvider').innerHTML=optionList(state.providers,{empty:'Select provider',label:(item)=>`${item.name}${item.external?' · external':' · local'}`,selected:detail.conversation.providerId});$('#chatModel').value=detail.conversation.model??'';if(rerender)renderProjectOptions();await refreshMessages();}
$('#newConversation').addEventListener('click',async()=>{if(!state.activeProjectId)return setStatus('Create or select a project first.',true);const title=prompt('Conversation title','New conversation');if(!title)return;try{const result=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId,title,mode:currentMode,providerId:$('#chatProvider').value||null,model:$('#chatModel').value||null})});state.activeConversationId=result.conversation.id;state.activeBranchId=result.branch.id;await refreshWorkspace();activate('chat');}catch(error){setStatus(error.message,true);}});
$('#chatBranch').addEventListener('change',async(event)=>{state.activeBranchId=event.target.value;await refreshMessages();});
async function refreshMessages(){if(!state.activeConversationId||!state.activeBranchId)return;const data=await api(`/api/v1/conversations/${state.activeConversationId}/messages?branchId=${state.activeBranchId}`);renderMessages(data.messages);await inspectContext();}
function renderMessages(messages){$('#messageList').classList.remove('empty-state');$('#messageList').innerHTML=messages.map((message)=>`<article class="message ${escapeHtml(message.role)}" data-message-id="${message.id}"><div class="message-head"><b>${escapeHtml(message.role)}</b><small>${instantHtml(message.createdAt)}</small></div><div class="message-body">${escapeHtml(message.content).replaceAll('\n','<br>')}</div>${message.citations?.length?`<div class="citations">${message.citations.map((c)=>`Source ${escapeHtml(c.sourceId)} · ${escapeHtml(c.evidenceStatus??(c.verified?'retrieved':'attached'))} · claim ${escapeHtml(c.claimStatus??'unverified')}`).join('<br>')}</div>`:''}<div class="message-actions"><button data-edit-message="${message.id}">Edit</button><button data-fork-message="${message.id}">Fork here</button><button data-exclude-message="${message.id}">Remove from context</button>${message.role==='assistant'?`<button data-retry-message="${message.id}">Retry</button>`:''}</div></article>`).join('')||'<div class="empty-state">No messages.</div>';$('#messageList').scrollTop=$('#messageList').scrollHeight;bindMessageActions(messages);}
function bindMessageActions(messages){$$('[data-edit-message]').forEach((button)=>button.addEventListener('click',async()=>{const message=messages.find((item)=>item.id===button.dataset.editMessage);const content=prompt('Edit message',message.content);if(content===null)return;await api(`/api/v1/messages/${message.id}`,{method:'PATCH',body:JSON.stringify({branchId:state.activeBranchId,content})});await refreshMessages();}));$$('[data-fork-message]').forEach((button)=>button.addEventListener('click',()=>forkAt(button.dataset.forkMessage)));$$('[data-exclude-message]').forEach((button)=>button.addEventListener('click',async()=>{await api(`/api/v1/messages/${button.dataset.excludeMessage}/exclude`,{method:'POST',body:JSON.stringify({branchId:state.activeBranchId,excluded:true})});await refreshMessages();}));$$('[data-retry-message]').forEach((button)=>button.addEventListener('click',async()=>{const index=messages.findIndex((item)=>item.id===button.dataset.retryMessage);const previous=[...messages.slice(0,index)].reverse().find((item)=>item.role==='user');if(previous){$('#chatInput').value=previous.content;await sendChat();}}));}
async function forkAt(messageId){const name=prompt('Branch name','alternative');if(!name)return;const branch=await api(`/api/v1/conversations/${state.activeConversationId}/fork`,{method:'POST',body:JSON.stringify({fromMessageId:messageId,name})});state.activeBranchId=branch.id;await selectConversation(state.activeConversationId);}
$('#forkBranch').addEventListener('click',async()=>{const data=await api(`/api/v1/conversations/${state.activeConversationId}/messages?branchId=${state.activeBranchId}`);const head=data.messages.at(-1);if(head)await forkAt(head.id);});
$('#undoHead').addEventListener('click',async()=>{if(!state.activeBranchId)return;await api(`/api/v1/branches/${state.activeBranchId}/undo`,{method:'POST',body:'{}'});await refreshMessages();});
$('#compareBranches').addEventListener('click',async()=>{const detail=await api(`/api/v1/conversations/${state.activeConversationId}`);if(detail.branches.length<2)return setStatus('Create a second branch first.',true);const other=detail.branches.find((item)=>item.id!==state.activeBranchId);const result=await api(`/api/v1/conversations/${state.activeConversationId}/compare?left=${state.activeBranchId}&right=${other.id}`);$('#contextInspector').textContent=JSON.stringify(result,null,2);});
$('#mergeBranch').addEventListener('click',async()=>{const detail=await api(`/api/v1/conversations/${state.activeConversationId}`);const other=detail.branches.find((item)=>item.id!==state.activeBranchId);if(!other)return setStatus('No branch available to merge.',true);await api(`/api/v1/conversations/${state.activeConversationId}/merge`,{method:'POST',body:JSON.stringify({sourceBranchId:other.id,targetBranchId:state.activeBranchId,note:`Merged branch ${other.name}`})});await refreshMessages();});
async function inspectContext(){if(!state.activeConversationId)return;const data=await api(`/api/v1/conversations/${state.activeConversationId}/context?branchId=${state.activeBranchId}`);$('#tokenEstimate').textContent=`≈ ${data.tokenEstimate} tokens`;$('#chatContextSummary').textContent=`${data.messages.length} messages · ${data.memories.length} memories · ${data.sources.length} sources · ${data.tools.length} tools`;$('#contextInspector').textContent=JSON.stringify({mode:data.conversation.mode,providerId:data.providerId,model:data.model,project:data.project?.name,included:data.included,tokenEstimate:data.tokenEstimate},null,2);}
$('#inspectContext').addEventListener('click',inspectContext);
async function sendChat(){
  if(!state.activeConversationId)return setStatus('Create a conversation first.',true);
  const content=$('#chatInput').value.trim();
  if(!content)return;
  const providerId=$('#chatProvider').value||null;
  $('#chatInput').value='';
  $('#stopGeneration').classList.remove('hidden');
  $('#sendMessage').disabled=true;
  let assistantText='';
  let article=null;
  try{
    const response=await fetch('/api/v1/chat/stream',{
      method:'POST',
      credentials:'same-origin',
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
          // UI-043: deliberately NOT announced. A live region fed per delta reads the
          // whole answer aloud as it arrives and again when it settles.
          if(article)article.querySelector('.message-body').textContent=assistantText;
        }else if(event==='error'){
          throw new Error(data.error);
        }else if(event==='stopped'){
          setStatus('Generation stopped.');
          announceEvent('Generation stopped');
        }
      }
    }
    await refreshWorkspace();
    setStatus('Response completed.');
    // One summary, once, when the event is over.
    announceEvent(`Reply complete, ${assistantText.length} characters`);
  }catch(error){
    setStatus(error.message,true);
  }finally{
    activeRunId=null;
    $('#stopGeneration').classList.add('hidden');
    $('#sendMessage').disabled=false;
  }
}
$('#sendMessage').addEventListener('click',sendChat);$('#chatInput').addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat();}});$('#stopGeneration').addEventListener('click',async()=>{if(activeRunId)await api(`/api/v1/chat/runs/${activeRunId}/stop`,{method:'POST',body:'{}'});});
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
function renderMemories(){$('#memoryList').innerHTML=state.memories.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p><small>${escapeHtml(item.scope)} · ${escapeHtml(item.tags.join(', '))}</small><button data-edit-memory="${item.id}">Edit</button><button class="danger" data-delete-memory="${item.id}">Delete</button></article>`).join('')||'No memory.';$$('[data-edit-memory]').forEach((button)=>button.addEventListener('click',async()=>{const item=state.memories.find((m)=>m.id===button.dataset.editMemory);const content=prompt('Edit memory',item.content);if(content!==null){await api(`/api/v1/memories/${item.id}`,{method:'PATCH',body:JSON.stringify({content})});await refreshWorkspace();}}));$$('[data-delete-memory]').forEach((button)=>button.addEventListener('click',async()=>{if(confirm('Delete this memory?')){await api(`/api/v1/memories/${button.dataset.deleteMemory}`,{method:'DELETE',body:'{}'});await refreshWorkspace();}}));}
$('#memoryForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/memories',{method:'POST',body:JSON.stringify({projectId:$('#memoryProject').value||null,conversationId:$('#memoryScope').value==='conversation'?($('#memoryConversation').value||state.activeConversationId):null,scope:$('#memoryScope').value,title:$('#memoryTitle').value,content:$('#memoryContent').value,tags:$('#memoryTags').value.split(',').map((v)=>v.trim()).filter(Boolean)})});event.target.reset();await refreshWorkspace();});
function renderArtifacts(){$('#artifactList').innerHTML=state.artifacts.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.title)}</h3><small>${escapeHtml(item.type)} · version ${item.versions.length}</small><pre>${escapeHtml(item.versions.at(-1)?.content??'')}</pre><button data-edit-artifact="${item.id}">New version</button></article>`).join('')||'No artifacts.';$$('[data-edit-artifact]').forEach((button)=>button.addEventListener('click',async()=>{const item=state.artifacts.find((a)=>a.id===button.dataset.editArtifact);const content=prompt('New artifact version',item.versions.at(-1)?.content??'');if(content!==null){await api(`/api/v1/artifacts/${item.id}`,{method:'PATCH',body:JSON.stringify({content})});await refreshWorkspace();}}));}
$('#artifactForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/artifacts',{method:'POST',body:JSON.stringify({projectId:$('#artifactProject').value||null,type:$('#artifactType').value,title:$('#artifactTitle').value,content:$('#artifactContent').value})});event.target.reset();await refreshWorkspace();});
function renderSources(){$('#sourceList').innerHTML=state.sources.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.mimeType)}</p><small>${escapeHtml(item.extractionStatus)} · ${item.byteLength} bytes</small><button data-preview-source="${item.id}">Preview passages</button></article>`).join('')||'No sources.';$$('[data-preview-source]').forEach((button)=>button.addEventListener('click',async()=>{const item=await api(`/api/v1/sources/${button.dataset.previewSource}`);$('#knowledgeResults').innerHTML=item.passages?.map((passage)=>`<article class="entity-card"><h3>Passage ${passage.index}</h3><p>${escapeHtml(passage.text)}</p></article>`).join('')||'<p>No extracted passages.</p>';}));}
function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(file);});}
$('#sourceBinary').addEventListener('change',()=>{const file=$('#sourceBinary').files[0];if(file){$('#sourceName').value=file.name;$('#sourceMime').value=file.type||'application/octet-stream';}});
$('#sourceForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const file=$('#sourceBinary').files[0];if(file){setStatus(`Extracting ${file.name} locally…`);await api('/api/v1/sources/upload',{method:'POST',body:JSON.stringify({projectId:$('#sourceProject').value||null,name:file.name,mimeType:file.type||$('#sourceMime').value,bytesBase64:await fileToBase64(file)})});}else{await api('/api/v1/sources',{method:'POST',body:JSON.stringify({projectId:$('#sourceProject').value||null,name:$('#sourceName').value,mimeType:$('#sourceMime').value,text:$('#sourceText').value})});}event.target.reset();$('#sourceMime').value='text/plain';await refreshWorkspace();setStatus('Source ingested and indexed.');}catch(error){setStatus(error.message,true);}});
$('#knowledgeSearch').addEventListener('click',async()=>{const result=await api(`/api/v1/knowledge/search?q=${encodeURIComponent($('#knowledgeQuery').value)}&projectId=${encodeURIComponent(state.activeProjectId??'')}`);$('#knowledgeResults').innerHTML=result.results.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.source?.name??item.sourceId)}</h3><p>${escapeHtml(item.text)}</p><small>score ${item.score.toFixed(3)} · passage ${item.index}</small></article>`).join('')||'No results.';});
function renderProviders(){
  $('#providerType').innerHTML=state.providerCatalog.map((item)=>`<option value="${escapeHtml(item.type)}">${escapeHtml(item.name)}</option>`).join('');syncProviderDefaults();
  $('#providerList').innerHTML=state.providers.map((item)=>`<article class="entity-card provider-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.type)} · ${escapeHtml(item.baseUrl)}</p><small>${item.external?'External':'Local'} · ${item.enabled?'Enabled':'Disabled'} · credential ${item.credentialConfigured?'configured':'missing'} · priority ${item.priority??100}</small><div class="inline-form"><input type="password" data-provider-key="${item.id}" placeholder="API key"><select data-provider-persistence="${item.id}"><option value="ephemeral">Session only</option><option value="encrypted">Encrypted on disk</option></select><button data-save-key="${item.id}">Save key</button><button data-probe-provider="${item.id}">Health check</button></div><div class="inline-form"><label class="check"><input type="checkbox" data-provider-consent="${item.id}" ${item.consent?.granted?'checked':''}> Explicit external consent</label><label class="check"><input type="checkbox" data-provider-anonymize="${item.id}" ${item.consent?.anonymize!==false?'checked':''}> Redaction/anonymization</label><button data-toggle-provider="${item.id}">${item.enabled?'Disable':'Enable'}</button></div><label>Fallback providers<select multiple data-provider-fallbacks="${item.id}">${state.providers.filter((other)=>other.id!==item.id).map((other)=>`<option value="${other.id}" ${(item.fallbackProviderIds??[]).includes(other.id)?'selected':''}>${escapeHtml(other.name)}</option>`).join('')}</select></label><button data-save-routing="${item.id}">Save routing</button><pre data-provider-health-result="${item.id}" class="hidden"></pre></article>`).join('')||'No providers configured.';
  const selectedProvider=$('#chatProvider').value;$('#chatProvider').innerHTML=optionList(state.providers,{empty:'Automatic route',label:(item)=>`${item.name}${item.external?' · external':' · local'}`,selected:selectedProvider});$('#comparisonProviders').innerHTML=state.providers.filter((item)=>item.enabled).map((item)=>`<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');bindProviderActions();
}
function syncProviderDefaults(){const descriptor=state.providerCatalog.find((item)=>item.type===$('#providerType').value)??state.providerCatalog[0];if(!descriptor)return;$('#providerName').value=descriptor.name;$('#providerBaseUrl').value=descriptor.baseUrl??'';}
$('#providerType').addEventListener('change',syncProviderDefaults);$('#providerForm').addEventListener('submit',async(event)=>{event.preventDefault();const descriptor=state.providerCatalog.find((item)=>item.type===$('#providerType').value);await api('/api/v1/providers',{method:'POST',body:JSON.stringify({type:descriptor.type,name:$('#providerName').value,baseUrl:$('#providerBaseUrl').value,defaultModel:$('#providerModel').value,priority:Number($('#providerPriority').value),modes:[...$('#providerModes').selectedOptions].map((o)=>o.value),external:descriptor.external,apiStyle:descriptor.apiStyle})});await refreshWorkspace();});
function bindProviderActions(){$$('[data-save-key]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.saveKey;const input=$(`[data-provider-key="${id}"]`);await api(`/api/v1/providers/${id}/credential`,{method:'PUT',body:JSON.stringify({apiKey:input.value,persistence:$(`[data-provider-persistence="${id}"]`).value})});input.value='';await refreshWorkspace();}));$$('[data-provider-consent]').forEach((checkbox)=>checkbox.addEventListener('change',async()=>{const id=checkbox.dataset.providerConsent;await api(`/api/v1/providers/${id}/consent`,{method:'PUT',body:JSON.stringify({granted:checkbox.checked,projectIds:state.activeProjectId?[state.activeProjectId]:[],dataClasses:['prompt','selected messages','project instructions','selected memory','selected sources'],allowTools:true,anonymize:$(`[data-provider-anonymize="${id}"]`).checked})});await refreshWorkspace();}));$$('[data-toggle-provider]').forEach((button)=>button.addEventListener('click',async()=>{const item=state.providers.find((p)=>p.id===button.dataset.toggleProvider);if(item.external&&!item.consent?.granted&&!item.enabled)return setStatus('Grant explicit external consent first.',true);await api(`/api/v1/providers/${item.id}`,{method:'PATCH',body:JSON.stringify({enabled:!item.enabled})});await refreshWorkspace();}));bindProviderRoutingActions();}
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
let voiceRecorder=null;let voiceChunks=[];$('#recordAudio').addEventListener('click',async()=>{try{if(voiceRecorder?.state==='recording'){voiceRecorder.stop();$('#recordAudio').textContent='Record voice';return;}const stream=await navigator.mediaDevices.getUserMedia({audio:true});voiceChunks=[];voiceRecorder=new MediaRecorder(stream);voiceRecorder.ondataavailable=(event)=>voiceChunks.push(event.data);voiceRecorder.onstop=async()=>{stream.getTracks().forEach((track)=>track.stop());await capturedBlobToInput(new Blob(voiceChunks,{type:voiceRecorder.mimeType}),`voice-${Date.now()}.webm`);};voiceRecorder.start();$('#recordAudio').textContent='Stop recording';}catch(error){setStatus(error.message,true);}});
function renderAgents(){
  $('#agentTools').innerHTML=state.tools.map((item)=>`<option value="${item.id}">${escapeHtml(item.name)}${item.mutative?' · mutative':''}</option>`).join('');
  $('#runAgent').innerHTML=optionList(state.agents,{empty:'Select agent'});
  $('#toolList').innerHTML=state.tools.map((tool)=>`<article class="entity-card"><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.transport)} · ${escapeHtml(tool.endpoint??tool.config?.command??'not configured')}</p><small>${tool.external?'External':'Local'} · ${tool.mutative?'Mutative':'Read-only'} · consent ${tool.consent?.granted?'granted':'not granted'}</small><div class="inline-form"><input type="password" data-tool-key="${tool.id}" placeholder="Optional API/OAuth token"><button data-save-tool-key="${tool.id}">Save encrypted key</button>${tool.external?`<button data-tool-consent="${tool.id}">${tool.consent?.granted?'Revoke consent':'Grant for active project'}</button>`:''}</div></article>`).join('')||'No tools.';
  $('#runList').innerHTML=(state.agentRuns??[]).map((run)=>`<article class="entity-card"><h3>${escapeHtml(run.goal)}</h3><small>${escapeHtml(run.status)}</small>${run.steps.map((step)=>`<div class="step"><span>${step.index+1}. ${escapeHtml(step.title)}</span><b>${escapeHtml(step.status)}</b>${step.status==='awaiting_approval'?`<button data-approve-step="${run.id}:${step.id}">Approve</button>`:''}${step.status==='pending'&&step.toolId?`<button data-execute-step="${run.id}:${step.id}">Execute</button>`:''}</div>${step.output?`<pre>${escapeHtml(JSON.stringify(step.output,null,2))}</pre>`:''}${step.error?`<p class="error">${escapeHtml(step.error)}</p>`:''}`).join('')}</article>`).join('')||'No runs.';
  $$('[data-approve-step]').forEach((button)=>button.addEventListener('click',async()=>{const[runId,stepId]=button.dataset.approveStep.split(':');await api(`/api/v1/agent-runs/${runId}/steps/${stepId}/approve`,{method:'POST',body:'{}'});await refreshWorkspace();}));
  $$('[data-execute-step]').forEach((button)=>button.addEventListener('click',async()=>{const[runId,stepId]=button.dataset.executeStep.split(':');try{await api(`/api/v1/agent-runs/${runId}/steps/${stepId}/execute`,{method:'POST',body:JSON.stringify({input:{}})});await refreshWorkspace();}catch(error){setStatus(error.message,true);}}));
  $$('[data-save-tool-key]').forEach((button)=>button.addEventListener('click',async()=>{const id=button.dataset.saveToolKey;const input=$(`[data-tool-key="${id}"]`);await api(`/api/v1/tools/${id}/credential`,{method:'PUT',body:JSON.stringify({apiKey:input.value,persistence:'encrypted'})});input.value='';setStatus('Tool credential encrypted.');}));
  $$('[data-tool-consent]').forEach((button)=>button.addEventListener('click',async()=>{const tool=state.tools.find((item)=>item.id===button.dataset.toolConsent);await api(`/api/v1/tools/${tool.id}/consent`,{method:'PUT',body:JSON.stringify({granted:!tool.consent?.granted,projectIds:state.activeProjectId?[state.activeProjectId]:[]})});await refreshWorkspace();}));
}
$('#toolForm').addEventListener('submit',async(event)=>{event.preventDefault();const transport=$('#toolTransport').value;await api('/api/v1/tools',{method:'POST',body:JSON.stringify({name:$('#toolName').value,description:$('#toolDescription').value,transport,endpoint:transport==='mcp-stdio'?null:$('#toolEndpoint').value,config:transport==='mcp-stdio'?{command:$('#toolEndpoint').value,remoteToolName:$('#toolRemoteName').value}:{remoteToolName:$('#toolRemoteName').value},external:$('#toolExternal').checked,mutative:$('#toolMutative').checked,requiresApproval:true})});event.target.reset();await refreshWorkspace();});
$('#agentForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/agents',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId,name:$('#agentName').value,instructions:$('#agentInstructions').value,toolIds:[...$('#agentTools').selectedOptions].map((o)=>o.value)})});event.target.reset();await refreshWorkspace();});
$('#runForm').addEventListener('submit',async(event)=>{event.preventDefault();const agent=state.agents.find((item)=>item.id===$('#runAgent').value);const tool=state.tools.find((item)=>agent?.toolIds.includes(item.id));await api('/api/v1/agent-runs',{method:'POST',body:JSON.stringify({agentId:agent.id,projectId:state.activeProjectId,goal:$('#runGoal').value,steps:[{title:'Analyze goal',mutative:false},{title:tool?`Use ${tool.name}`:'Produce result',toolId:tool?.id,mutative:Boolean(tool?.mutative)}]})});event.target.reset();await refreshWorkspace();});
async function exportData(){const bundle=await api('/api/v1/data/export');const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`noesar-export-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);}
$('#saveRetention').addEventListener('click',async()=>{await api('/api/v1/data/retention',{method:'PUT',body:JSON.stringify({days:Number($('#retentionDays').value)})});await refreshWorkspace();setStatus('Retention policy saved.');});$('#applyRetention').addEventListener('click',async()=>{const result=await api('/api/v1/data/retention/apply',{method:'POST',body:'{}'});await refreshWorkspace();setStatus(`Retention applied: ${JSON.stringify(result.counts)}`);});$('#exportData').addEventListener('click',exportData);$('#rightExportData').addEventListener('click',exportData);$('#purgeProject').addEventListener('click',async()=>{if(!state.activeProjectId||!confirm('Permanently delete the active project data?'))return;await api('/api/v1/data/purge',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId})});state.activeProjectId=null;state.activeConversationId=null;await refreshWorkspace();});
let searchTimer;$('#globalSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{const q=$('#globalSearch').value.trim();if(!q)return $('#globalSearchResults').classList.add('hidden');const data=await api(`/api/v1/search?q=${encodeURIComponent(q)}&projectId=${encodeURIComponent(state.activeProjectId??'')}`);$('#globalSearchResults').innerHTML=data.results.map((item)=>`<button><b>${escapeHtml(item.type)}</b><span>${escapeHtml(item.item.title??item.item.name??item.item.content??item.id).slice(0,180)}</span><small>${item.score.toFixed(3)}</small></button>`).join('')||'<p>No results</p>';$('#globalSearchResults').classList.remove('hidden');},250);});document.addEventListener('keydown',(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#globalSearch').focus();}});
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
      ['Passkeys',data.passkeySupported?'supported':'not supported in this build'],
    ]);
    badge($('#securityMfaBadge'),data.mfaEnabled?'MFA enrolled':'MFA missing',data.mfaEnabled?'on':'danger');
    renderSessions(data.sessions??[]);
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
  const submit=event.currentTarget.querySelector('button');
  return withBusy(submit,async()=>{
    try{
      const result=await api('/api/v1/auth/password',{method:'POST',body:JSON.stringify({
        currentPassword:$('#secCurrentPassword').value,totpCode:$('#secTotpCode').value,
        newPassword:$('#secNewPassword').value,revokeOtherSessions:$('#secRevokeOthers').checked,
      })});
      event.currentTarget.reset();$('#secRevokeOthers').checked=true;
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
const PLAN_STATUS_LABEL={PENDING_APPROVAL:'pending approval',PROMOTED:'promoted',REFUSED:'refused',REJECTED:'rejected',RESTORED:'restored'};
function provenanceSummary(entries){
  return Array.isArray(entries)&&entries.length?[...new Set(entries.map((entry)=>entry.provider))].join(', '):'—';
}
function renderPlanActions(){
  const box=$('#planActions');if(!box)return;
  const has=Boolean(currentWorkspaceRun);
  box.classList.toggle('hidden',!has);
  if(!has)return;
  const status=currentWorkspaceRun.status;
  $('#planSimulateBtn').classList.toggle('hidden',status!=='PENDING_APPROVAL');
  $('#planApproveBtn').classList.toggle('hidden',status!=='PENDING_APPROVAL');
  $('#planRejectBtn').classList.toggle('hidden',status!=='PENDING_APPROVAL');
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
async function submitPlanForm(event){
  event.preventDefault();
  const files=planFiles();
  if(!files.length){toast('At least one file with a path is required.',{kind:'error'});return;}
  try{
    const planned=await api('/api/v1/workspace-actions/plan',{method:'POST',body:JSON.stringify({
      request:$('#planGoal').value,files,mode:'safe',policy:'restrictive',
    })});
    currentWorkspaceRun={...planned,status:'PENDING_APPROVAL'};
    currentSimulation=null;currentApproveResult=null;currentWorkspaceRunFiles=files;
    trackWorkspaceRunForClosure(currentWorkspaceRun);
    await renderWorkspaceRun();
    toast('Plan created — pending approval.');
  }catch(error){
    if(error.status===503)toast(`Reasoning unavailable: ${error.value?.reason??error.message}`,{kind:'error'});
    else toast(error.value?.reason??error.message,{kind:'error'});
  }
}
async function runWorkspaceAction(kind){
  if(!currentWorkspaceRun)return;
  const runId=currentWorkspaceRun.runId;
  try{
    if(kind==='simulate'){
      currentSimulation=await api(`/api/v1/workspace-actions/${runId}/simulate`,{method:'POST',body:JSON.stringify({})});
      toast('Simulated.');
    }else if(kind==='approve'){
      currentApproveResult=await api(`/api/v1/workspace-actions/${runId}/approve`,{method:'POST',body:JSON.stringify({})});
      currentWorkspaceRun.status=currentApproveResult.promoted?'PROMOTED':'REFUSED';
      toast(currentApproveResult.promoted?'Approved and promoted.':'Approved, but not promoted — see Shadow run.');
    }else if(kind==='reject'){
      const reason=prompt('Reason for rejecting this plan (optional):')??null;
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
  $('#planSimulateBtn')?.addEventListener('click',()=>runWorkspaceAction('simulate'));
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
  try{summary=await api('/api/v1/metrics/review-time');}catch{return;}
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
    ?`<ul class="service-list">${(block.components??[]).map((component)=>`<li><span class="dot ${component.healthy?'ok':'bad'}" aria-hidden="true"></span><b>${escapeHtml(component.name)}</b>${component.essential?' <span class="tag">essential</span>':''}<small>${escapeHtml(component.detail??'')}</small></li>`).join('')}</ul>`
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
  host.innerHTML=`<ul class="provenance-list">${block.items.map((tool)=>`<li><b>${escapeHtml(tool.name)}</b> <span class="tag">${escapeHtml(tool.transport)}</span>${tool.mutative?' <span class="tag tag-warn">mutative</span>':''}
    <small>Reaches ${escapeHtml(tool.origin.reach.replace('-',' '))}${tool.origin.host?` · ${escapeHtml(tool.origin.host)}`:''}${tool.origin.declaredExternal?' · declares itself external':''}</small>
    <small>${tool.consentGranted?'consent granted':'no consent'} · ${tool.credentialConfigured?'credential configured':'no credential'} · registered ${tool.registeredAt?instantHtml(tool.registeredAt):'—'}</small></li>`).join('')}</ul>
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
function initBench(){
  $$('[data-bench-tab]').forEach((tab)=>tab.addEventListener('click',()=>{
    const name=tab.dataset.benchTab;
    $$('[data-bench-tab]').forEach((node)=>{
      const active=node===tab;
      node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));
    });
    $$('[data-bench-panel]').forEach((panel)=>panel.classList.toggle('active',panel.dataset.benchPanel===name));
    if(name==='terminal')$('#benchTerminal').scrollIntoView({block:'nearest'});
    if(name==='closure')loadClosures();
  }));
  // The agent column menu: one panel visible at a time instead of all five stacked, so
  // the column's height stops being the sum of every panel and the gap below the
  // (much shorter) bench disappears. Same pattern as the bench tabs above, a second
  // instance rather than a shared one because the two switch different panel sets.
  $$('[data-agent-menu]').forEach((item)=>item.addEventListener('click',()=>{
    const name=item.dataset.agentMenu;
    $$('[data-agent-menu]').forEach((node)=>{
      const active=node===item;
      node.classList.toggle('active',active);node.setAttribute('aria-selected',String(active));
    });
    $$('[data-agent-panel]').forEach((panel)=>panel.classList.toggle('active',panel.dataset.agentPanel===name));
  }));
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
function renderBenchNavigator(){
  const list=(items,label,empty)=>items.length
    ?items.slice(0,6).map((item)=>`<button type="button" title="${escapeHtml(label(item))}">${escapeHtml(label(item))}</button>`).join('')
    :`<span>${escapeHtml(empty)}</span>`;
  $('#navProjects').innerHTML=list(state.projects,(item)=>item.name,'No project yet.');
  $('#navRecent').innerHTML=list(state.artifacts??[],(item)=>item.title,'Nothing opened recently.');
  $('#navSessions').innerHTML=list(state.conversations,(item)=>item.title,'No session yet.');
  $('#navTasks').innerHTML=list(state.tasks??[],(item)=>item.title,'No task.');
  $('#navAgents').innerHTML=list(state.agents??[],(item)=>item.name,'No agent.');
  $('#navTools').innerHTML=list(state.tools??[],(item)=>item.name,'No tool registered.');
  $('#navHistory').innerHTML=list(state.agentRuns??[],(item)=>`${item.goal??'run'} · ${item.status??''}`,'No run has happened.');
  for(const id of ['#navProjects','#navRecent','#navSessions','#navTasks','#navAgents','#navTools','#navHistory']){
    const node=$(id);if(node)node.classList.toggle('empty-state',node.querySelector('span')!==null);
  }
}
// UI-035. Twelve fields, and the line states how many of them have a source in this
// build. A status line that fills its gaps with plausible numbers is worse than one that
// admits them: the reader cannot tell which half to believe.
async function renderBenchStatus(){
  const sourced=new Set();
  const set=(id,value,has)=>{const node=$(id);if(!node)return;node.textContent=value;if(has)sourced.add(id);};
  set('#statusStage','—',false);
  set('#statusFiles','—',false);
  set('#statusTests','—',false);
  set('#statusWarnings','—',false);
  set('#statusProcesses','—',false);
  set('#statusRemote','—',false);
  set('#statusTokens','—',false);
  set('#statusCost','—',false);
  set('#statusElapsed',humanDuration(Math.round((Date.now()-benchOpenedAt)/1000)),true);
  set('#statusNetwork',$('#footerPrivacy')?.textContent?.includes('Local-only')?'local only':'see privacy state',true);
  set('#statusSandbox',codenMode==='OWNER_BYPASS'?'owner bypass':'normal',true);
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
// inside Knowledge (`memory-notes-block`) — that is hand-written and pinned by a person;
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
    list.innerHTML=items.length?items.map(memoryResultCard).join(''):'Nothing found yet.';
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
    status.textContent=info.consented?'Configured and consented':info.configured?'Configured, awaiting consent':'Not configured';
    status.className=`badge ${info.consented?'badge-on':'badge-off'}`;
    if(currentPermissions.includes('provider.manage')){
      picker.classList.remove('hidden');
      $('#researchProviderSelect').innerHTML=info.eligibleTools.length
        ?info.eligibleTools.map((tool)=>`<option value="${escapeHtml(tool.id)}" ${tool.id===info.toolId?'selected':''}>${escapeHtml(tool.name)}${tool.consented?'':' (not yet consented)'}</option>`).join('')
        :'<option value="">No external tools registered yet — register one in Agents</option>';
    }else picker.classList.add('hidden');
  }catch{
    status.textContent='Could not read provider status';status.className='badge badge-off';
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

Object.assign(VIEW_LOADERS,{
  memory:loadMemoryDestination,
  research:loadResearchDestination,
  workflows:loadWorkflows,
  coden:()=>{benchOpenedAt=benchOpenedAt||Date.now();loadCoden();renderBenchNavigator();renderBenchStatus();renderTerminals();},
  home:loadHome,
});
// The loaders of the demoted pages, keyed by the section that now owns them. "Health and
// logs" is one section holding two former pages, so it runs both: merging two entries in
// the menu must not silently drop one of their fetches.
Object.assign(SECTION_LOADERS,{
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
});

initI18n();
initAppearance();
// Reading preferences are applied BEFORE the router paints anything: applying them after
// would show the interface at one size and then move it, which is exactly the flash a
// person who needs larger type does not need to see twice.
initReadingControls();
initConfirm();
initSessions();
initBench();
initRouter();
initializeAuth()
  .then(()=>loadEffectiveZone())
  .catch((error)=>authError(error.message));

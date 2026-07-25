// SPDX-License-Identifier: AGPL-3.0-or-later
import { initI18n, applyTranslations } from './i18n.js';
const $=(selector)=>document.querySelector(selector);const $$=(selector)=>[...document.querySelectorAll(selector)];
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
const state={projects:[],conversations:[],branches:[],memories:[],artifacts:[],sources:[],providers:[],providerCatalog:[],tools:[],agents:[],agentRuns:[],activeProjectId:null,activeConversationId:null,activeBranchId:null};
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
const ROUTES=new Set(['home','chat','projects','tasks','documents','agents','knowledge','memory','models','coden','hardware']);
function viewFromHash(){
  const raw=(location.hash||'').replace(/^#\/?/,'').split('?')[0].trim().toLowerCase();
  return raw||'home';
}
function activate(view,{updateHash=true}={}){
  const known=ROUTES.has(view)&&document.querySelector(`#view-${view}`);
  const target=known?view:'not-found';
  if(!known)renderNotFound(view);
  $$('.nav').forEach((node)=>node.classList.toggle('active',node.dataset.view===target));
  $$('.view').forEach((node)=>node.classList.toggle('active',node.id===`view-${target}`));
  if(updateHash&&viewFromHash()!==target)location.hash=`#/${target}`;
  const heading=document.querySelector(`#view-${target} h1`);
  document.title=heading?`${heading.textContent.trim()} · NOESAR Evolution`:'NOESAR Evolution';
  // Announce the change for assistive technology, which does not observe a class flip.
  const live=$('#routeAnnouncer');if(live)live.textContent=`${heading?heading.textContent.trim():target} view`;
  if(known&&typeof VIEW_LOADERS[view]==='function')VIEW_LOADERS[view]();
}
function renderNotFound(view){
  const panel=$('#view-not-found');if(!panel)return;
  const slot=$('#notFoundDetail');
  if(slot)slot.textContent=view?`No page is registered for "${view}".`:'That page does not exist.';
}
// Populated further down, once each section's loader is defined. A view with no
// loader is static markup and needs no fetch.
const VIEW_LOADERS={};
function initRouter(){
  window.addEventListener('hashchange',()=>activate(viewFromHash(),{updateHash:false}));
  activate(viewFromHash(),{updateHash:false});
}
function optionList(items,{empty='None',label=(item)=>item.name,value=(item)=>item.id,selected=null}={}){return `<option value="">${escapeHtml(empty)}</option>${items.map((item)=>`<option value="${escapeHtml(value(item))}" ${value(item)===selected?'selected':''}>${escapeHtml(label(item))}</option>`).join('')}`;}
async function initializeAuth(){const status=await api('/api/v1/auth/status');if(!status.initialized){$('#authTitle').textContent=status.pendingSetup?'Complete Owner setup':'Initialize NOESAR securely';showOnly('#setupForm');return;}try{const me=await api('/api/v1/auth/me');currentUser=me.user;await enterApplication();}catch{showOnly('#loginForm');}}
async function enterApplication(){$('#authGate').classList.add('hidden');$('#userAvatar').textContent=(currentUser?.displayName??currentUser?.username??'U').slice(0,1).toUpperCase();if(currentUser?.role!=='owner'){const bypass=$('[data-mode="OWNER_BYPASS"]');bypass.disabled=true;}await Promise.all([refreshPrivacy(),refreshHardware(),refreshWorkspace(),loadExtractorCapabilities()]);}
$('#setupForm').addEventListener('submit',async(event)=>{event.preventDefault();authError();try{const result=await api('/api/v1/auth/setup',{method:'POST',headers:{'x-noesar-setup-token':$('#setupToken').value},body:JSON.stringify({username:$('#setupUsername').value,displayName:$('#setupDisplayName').value,password:$('#setupPassword').value})});setupChallenge=result.challenge;$('#setupTotpSecret').textContent=result.totpSecret;showOnly('#setupMfaForm');}catch(error){authError(error.message);}});
$('#setupMfaForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/setup/confirm',{method:'POST',body:JSON.stringify({challenge:setupChallenge,totpCode:$('#setupTotpCode').value})});csrfToken=result.csrfToken;currentUser=result.user;await enterApplication();}catch(error){authError(error.message);}});
$('#loginForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginUsername').value,password:$('#loginPassword').value})});loginChallenge=result.challenge;showOnly('#loginMfaForm');}catch(error){authError(error.message);}});
$('#loginMfaForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const result=await api('/api/v1/auth/login/mfa',{method:'POST',body:JSON.stringify({challenge:loginChallenge,totpCode:$('#loginTotpCode').value})});csrfToken=result.csrfToken;currentUser=result.user;await enterApplication();}catch(error){authError(error.message);}});
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/v1/auth/logout',{method:'POST',body:'{}'});}catch{}csrfToken='';currentUser=null;$('#authGate').classList.remove('hidden');showOnly('#loginForm');});
$$('.nav').forEach((button)=>button.addEventListener('click',()=>activate(button.dataset.view)));$$('[data-view-link]').forEach((button)=>button.addEventListener('click',()=>activate(button.dataset.viewLink)));$$('[data-start-mode]').forEach((button)=>button.addEventListener('click',()=>{setMode(button.dataset.startMode);activate('chat');}));
function setMode(mode){currentMode=mode;$$('[data-chat-mode]').forEach((button)=>button.classList.toggle('selected',button.dataset.chatMode===mode));}
$$('[data-chat-mode]').forEach((button)=>button.addEventListener('click',()=>setMode(button.dataset.chatMode)));
async function refreshPrivacy(){try{const {banner,state:privacyState}=await api('/api/v1/privacy');const box=$('#privacyBanner');box.querySelector('strong').textContent=banner.headline;box.querySelector('small').textContent=banner.detail;box.querySelector('.verified').textContent=privacyState.replaceAll('_',' ');}catch{}}
async function refreshWorkspace(){const data=await api('/api/v1/ai/bootstrap');for(const key of ['projects','conversations','branches','memories','artifacts','sources','providers','tools','agents','agentRuns','tasks'])state[key]=data[key]??[];state.providerCatalog=data.providerCatalog??[];if(!state.activeProjectId&&state.projects.length)state.activeProjectId=state.projects[0].id;if(state.activeProjectId&&!state.projects.some((item)=>item.id===state.activeProjectId))state.activeProjectId=state.projects[0]?.id??null;if(!state.activeConversationId){const c=state.conversations.find((item)=>item.projectId===state.activeProjectId)??state.conversations[0];state.activeConversationId=c?.id??null;}renderAll();if(state.activeConversationId)await selectConversation(state.activeConversationId,false);}
function renderAll(){renderProjectOptions();renderHome();renderProjects();renderTasks();renderMemories();renderArtifacts();renderSources();renderProviders();renderAgents();updatePrivacyFromProvider();$('#retentionDays').value=state.settings?.retentionDays??365;applyTranslations();}
function renderProjectOptions(){for(const id of ['#chatProject','#artifactProject','#sourceProject','#memoryProject','#taskProject']){const select=$(id);const selected=id==='#chatProject'?state.activeProjectId:select.value||state.activeProjectId;select.innerHTML=optionList(state.projects,{empty:'No project',selected});}$('#memoryConversation').innerHTML=optionList(state.conversations.filter((item)=>!state.activeProjectId||item.projectId===state.activeProjectId),{empty:'Select conversation',label:(item)=>item.title,selected:state.activeConversationId});$('#projectChip').textContent=`Project: ${state.projects.find((item)=>item.id===state.activeProjectId)?.name??'none'}`;const conversations=state.conversations.filter((item)=>!state.activeProjectId||item.projectId===state.activeProjectId);$('#chatConversation').innerHTML=optionList(conversations,{empty:'No conversation',label:(item)=>item.title,selected:state.activeConversationId});}
function renderHome(){$('#homeProjects').innerHTML=state.projects.slice(0,5).map((item)=>`<article><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description||'No description')}</small></div></article>`).join('')||'No projects yet.';$('#homeConversations').innerHTML=state.conversations.slice(-5).reverse().map((item)=>`<article><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.mode)}</small></div></article>`).join('')||'No conversations yet.';}
function renderProjects(){$('#projectCount').textContent=state.projects.length;$('#projectList').innerHTML=state.projects.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p><small>${escapeHtml(item.tags.join(' · '))}</small><button data-select-project="${item.id}">Use project</button></article>`).join('')||'No projects.';$$('[data-select-project]').forEach((button)=>button.addEventListener('click',async()=>{state.activeProjectId=button.dataset.selectProject;state.activeConversationId=null;renderProjectOptions();activate('chat');await refreshWorkspace();}));}
$('#projectForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const project=await api('/api/v1/projects',{method:'POST',body:JSON.stringify({name:$('#projectName').value,description:$('#projectDescription').value,instructions:$('#projectInstructions').value,tags:$('#projectTags').value.split(',').map((v)=>v.trim()).filter(Boolean),knowledgePolicy:{mode:$('#projectKnowledgeMode').value,limit:Number($('#projectKnowledgeLimit').value),maxCharacters:60000}})});state.activeProjectId=project.id;event.target.reset();await refreshWorkspace();setStatus('Project created.');}catch(error){setStatus(error.message,true);}});
$('#chatProject').addEventListener('change',async(event)=>{state.activeProjectId=event.target.value||null;state.activeConversationId=null;await refreshWorkspace();});
$('#chatConversation').addEventListener('change',async(event)=>selectConversation(event.target.value));
async function selectConversation(id,rerender=true){if(!id){state.activeConversationId=null;$('#messageList').textContent='Create or select a conversation.';return;}state.activeConversationId=id;const detail=await api(`/api/v1/conversations/${encodeURIComponent(id)}`);state.branches=state.branches.filter((item)=>item.conversationId!==id).concat(detail.branches);state.activeBranchId=detail.conversation.activeBranchId;currentMode=detail.conversation.mode;setMode(currentMode);$('#chatBranch').innerHTML=optionList(detail.branches,{empty:'No branch',label:(item)=>item.name,selected:state.activeBranchId});$('#chatProvider').innerHTML=optionList(state.providers,{empty:'Select provider',label:(item)=>`${item.name}${item.external?' · external':' · local'}`,selected:detail.conversation.providerId});$('#chatModel').value=detail.conversation.model??'';if(rerender)renderProjectOptions();await refreshMessages();}
$('#newConversation').addEventListener('click',async()=>{if(!state.activeProjectId)return setStatus('Create or select a project first.',true);const title=prompt('Conversation title','New conversation');if(!title)return;try{const result=await api('/api/v1/conversations',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId,title,mode:currentMode,providerId:$('#chatProvider').value||null,model:$('#chatModel').value||null})});state.activeConversationId=result.conversation.id;state.activeBranchId=result.branch.id;await refreshWorkspace();activate('chat');}catch(error){setStatus(error.message,true);}});
$('#chatBranch').addEventListener('change',async(event)=>{state.activeBranchId=event.target.value;await refreshMessages();});
async function refreshMessages(){if(!state.activeConversationId||!state.activeBranchId)return;const data=await api(`/api/v1/conversations/${state.activeConversationId}/messages?branchId=${state.activeBranchId}`);renderMessages(data.messages);await inspectContext();}
function renderMessages(messages){$('#messageList').classList.remove('empty-state');$('#messageList').innerHTML=messages.map((message)=>`<article class="message ${escapeHtml(message.role)}" data-message-id="${message.id}"><div class="message-head"><b>${escapeHtml(message.role)}</b><small>${new Date(message.createdAt).toLocaleString()}</small></div><div class="message-body">${escapeHtml(message.content).replaceAll('\n','<br>')}</div>${message.citations?.length?`<div class="citations">${message.citations.map((c)=>`Source ${escapeHtml(c.sourceId)} · ${escapeHtml(c.evidenceStatus??(c.verified?'retrieved':'attached'))} · claim ${escapeHtml(c.claimStatus??'unverified')}`).join('<br>')}</div>`:''}<div class="message-actions"><button data-edit-message="${message.id}">Edit</button><button data-fork-message="${message.id}">Fork here</button><button data-exclude-message="${message.id}">Remove from context</button>${message.role==='assistant'?`<button data-retry-message="${message.id}">Retry</button>`:''}</div></article>`).join('')||'<div class="empty-state">No messages.</div>';$('#messageList').scrollTop=$('#messageList').scrollHeight;bindMessageActions(messages);}
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
          if(article)article.querySelector('.message-body').textContent=assistantText;
        }else if(event==='error'){
          throw new Error(data.error);
        }else if(event==='stopped'){
          setStatus('Generation stopped.');
        }
      }
    }
    await refreshWorkspace();
    setStatus('Response completed.');
  }catch(error){
    setStatus(error.message,true);
  }finally{
    activeRunId=null;
    $('#stopGeneration').classList.add('hidden');
    $('#sendMessage').disabled=false;
  }
}
$('#sendMessage').addEventListener('click',sendChat);$('#chatInput').addEventListener('keydown',(event)=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();sendChat();}});$('#stopGeneration').addEventListener('click',async()=>{if(activeRunId)await api(`/api/v1/chat/runs/${activeRunId}/stop`,{method:'POST',body:'{}'});});
function renderTasks(){$('#taskList').innerHTML=state.tasks.map((item)=>`<article class="entity-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><small>${escapeHtml(item.status)} · ${escapeHtml(item.priority)}${item.scheduledAt?` · ${new Date(item.scheduledAt).toLocaleString()}`:''}</small><button data-task-status="${item.id}:running">Start</button><button data-task-status="${item.id}:completed">Complete</button><button data-task-status="${item.id}:blocked">Block</button></article>`).join('')||'No tasks.';$$('[data-task-status]').forEach((button)=>button.addEventListener('click',async()=>{const[id,status]=button.dataset.taskStatus.split(':');await api(`/api/v1/tasks/${id}`,{method:'PATCH',body:JSON.stringify({status})});await refreshWorkspace();}));}
$('#taskForm').addEventListener('submit',async(event)=>{event.preventDefault();await api('/api/v1/tasks',{method:'POST',body:JSON.stringify({projectId:$('#taskProject').value||null,title:$('#taskTitle').value,description:$('#taskDescription').value,priority:$('#taskPriority').value,status:$('#taskScheduledAt').value?'scheduled':'planned',scheduledAt:$('#taskScheduledAt').value||null,dueAt:$('#taskDueAt').value||null,recurrence:$('#taskRecurrence').value||null})});event.target.reset();await refreshWorkspace();});
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
function updatePrivacyFromProvider(){const selected=state.providers.find((item)=>item.id===$('#chatProvider').value);const externalEnabled=state.providers.some((item)=>item.external&&item.enabled);$('#egressMetric').textContent=externalEnabled?'Available by consent':'Blocked';$('#egressMetric').className=externalEnabled?'amber':'';if(selected?.external){$('#privacyBanner').querySelector('strong').textContent='External model selected.';$('#privacyBanner').querySelector('small').textContent=`Requests may be sent to ${selected.baseUrl} within the approved data scope.`;$('#privacyBanner').querySelector('.verified').textContent='EXPLICIT CONSENT REQUIRED';$('#footerPrivacy').textContent='● External provider selected';$('#runtimeState').textContent='● External by consent';}else{refreshPrivacy();$('#footerPrivacy').textContent='● Local-only verified';$('#runtimeState').textContent='● Local-first';}$('#modelChip').textContent=`Model: ${$('#chatModel').value||selected?.defaultModel||'none'}`;}
$('#chatProvider').addEventListener('change',updatePrivacyFromProvider);$('#chatModel').addEventListener('input',updatePrivacyFromProvider);
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

initI18n();
initRouter();
initializeAuth().catch((error)=>authError(error.message));

/* LedgerMail v4: explicit state machines, local per-account history, explainable candidate review. */
'use strict';
const SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const E=window.LedgerEngine, Store=window.LedgerStore;
if(!E||!Store)throw new Error('LedgerMail finance dependencies missing. Reload the app.');
const state={phase:'DISCONNECTED',email:null,token:null,expiresAt:0,controller:null,generation:0,
 messages:[],payments:[],bills:[],pageToken:null,mailQuery:'in:anywhere newer_than:90d',
 mailBusy:false,mailPhase:'IDLE',route:'dashboard',backupPhase:'IDLE',syncPhase:'IDLE',storagePhase:'BOOTING',lastSync:null,persistPending:0,storageError:null};
const el=id=>document.getElementById(id);
const money=(amount,currency='USD')=>{try{return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount)}catch{return String(amount)+' '+currency}};
const monthKey=d=>{const date=new Date(d);return isNaN(date)?'unknown':date.toISOString().slice(0,7)};
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=s=>{const node=el('toast');node.textContent=s;node.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>node.style.display='none',3500)};
const getClientId=()=>localStorage.getItem('ledgermail.clientId')||'';
function setPhase(phase){
 state.phase=E.transition('auth',state.phase,phase);
 const status={
 DISCONNECTED:state.email?'Saved history: '+state.email+' · reconnect to sync':'Not connected',
 CONNECTING:'Opening Google account chooser…',VERIFYING:'Verifying Gmail identity…',
 CONNECTED:'Connected: '+(state.email||'Gmail'),EXPIRED:'Gmail access expired · saved history remains',
 ERROR:'Google connection failed · saved history remains'
 };
 el('authStatus').textContent=status[phase]||phase;
 el('connect').disabled=phase==='CONNECTING'||phase==='VERIFYING';
 el('connect').textContent=phase==='CONNECTED'?'Switch Gmail account':state.email?'Reconnect Gmail':'Connect Gmail';
 el('sync').disabled=phase!=='CONNECTED'||state.syncPhase==='RUNNING';
 document.body.dataset.gmail=phase==='CONNECTED'?'connected':'offline';
 updateStorageBanner();
}
function setSyncPhase(next){
 state.syncPhase=E.transition('sync',state.syncPhase,next);
 el('sync').disabled=state.phase!=='CONNECTED'||state.syncPhase==='RUNNING';
}
function setMailPhase(next){state.mailPhase=E.transition('inbox',state.mailPhase,next);state.mailBusy=next==='LOADING'}
function setBackupPhase(next){state.backupPhase=E.transition('backup',state.backupPhase,next)}
function setStoragePhase(next){state.storagePhase=E.transition('storage',state.storagePhase,next);updateStorageBanner()}
function updateStorageBanner(){
 const id=state.email;
 const online=state.phase==='CONNECTED';
 el('accountBanner').textContent=id?(online?'Live Gmail: ':'Saved history: ')+id:'Connect Gmail to start';
 el('lastSynced').textContent=state.lastSync?'Last financial scan: '+new Date(state.lastSync).toLocaleString():'No previous financial scan saved';
 el('localSaveStatus').textContent=state.storagePhase==='ERROR'
   ?'Local storage unavailable. History may be lost after closing.'
   :state.storagePhase==='SAVING'?'Saving changes on this device…'
   :state.storagePhase==='LOADING'||state.storagePhase==='BOOTING'?'Loading saved history…'
   :id?'Financial history stays here after closing the app':'Ready to save history on this device';
}
/* Explicit navigation transition: one active screen, one selected tab, and one noninteractive burst. */
const prefersLessMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
function route(name,event){
  const target=el(name);
  if(!target||!target.classList.contains('screen'))return;
  if(state.route===name)return;
  state.route=E.transition('navigation',state.route,name);
  document.querySelectorAll('.screen').forEach(screen=>{
    const selected=screen===target;
    screen.classList.toggle('active',selected);
    screen.setAttribute('aria-hidden',String(!selected));
  });
  const tabs=[...document.querySelectorAll('nav .nav')];
  tabs.forEach(tab=>{
    const selected=tab.dataset.route===name;
    tab.classList.toggle('active',selected);
    if(selected)tab.setAttribute('aria-current','page');
    else tab.removeAttribute('aria-current');
  });
  document.querySelector('nav').style.setProperty('--nav-index',String(Math.max(0,tabs.findIndex(t=>t.dataset.route===name))));
  document.body.dataset.section=name;
  window.scrollTo(0,0);
  if(!prefersLessMotion.matches){
    const burst=el('transitionSplash');
    const rect=event?.currentTarget?.getBoundingClientRect();
    const x=rect?rect.left+rect.width/2:window.innerWidth/2;
    const y=rect?rect.top+rect.height/2:window.innerHeight*.82;
    burst.style.setProperty('--burst-x',(x/window.innerWidth*100).toFixed(1)+'%');
    burst.style.setProperty('--burst-y',(y/window.innerHeight*100).toFixed(1)+'%');
    burst.classList.remove('burst');
    void burst.offsetWidth;
    burst.classList.add('burst');
  }
}
document.querySelectorAll('[data-route]').forEach(b=>b.addEventListener('click',e=>route(b.dataset.route,e)));
/* Reduced-motion aware scroll parallax + pointer tilt; no gyroscope access requested. */
const heroPanel=document.querySelector('.hero');
if(heroPanel){
  heroPanel.addEventListener('pointermove',e=>{
    if(prefersLessMotion.matches||e.pointerType==='touch')return;
    const rect=heroPanel.getBoundingClientRect();
    const dx=((e.clientX-rect.left)/rect.width-.5)*5;
    const dy=((e.clientY-rect.top)/rect.height-.5)*-4;
    heroPanel.style.setProperty('--hero-tilt-x',dy.toFixed(2)+'deg');
    heroPanel.style.setProperty('--hero-tilt-y',dx.toFixed(2)+'deg');
  },{passive:true});
  heroPanel.addEventListener('pointerleave',()=>{
    heroPanel.style.setProperty('--hero-tilt-x','0deg');
    heroPanel.style.setProperty('--hero-tilt-y','0deg');
  });
}
let scrollFramePending=false;
window.addEventListener('scroll',()=>{
  if(prefersLessMotion.matches||scrollFramePending)return;
  scrollFramePending=true;
  requestAnimationFrame(()=>{
    document.documentElement.style.setProperty('--scroll-parallax',Math.min(90,window.scrollY*.14).toFixed(1)+'px');
    scrollFramePending=false;
  });
},{passive:true});
el('settingsShortcut').onclick=()=>route('settings');
function resetSession({clearView=false}={}){
 state.generation++;
 state.controller?.abort();state.controller=null;
 state.token=null;state.expiresAt=0;state.pageToken=null;if(state.mailPhase!=='IDLE')setMailPhase('IDLE');state.mailBusy=false;
 if(state.syncPhase!=='IDLE')setSyncPhase('IDLE');
 if(clearView){state.messages=[];state.payments=[];state.bills=[];state.lastSync=null;state.email=null}
 setPhase('DISCONNECTED');render();
}
function disconnect(){resetSession();toast('Gmail disconnected. Your saved history remains on this device.')}
function getAccountRecord(){return {email:state.email,messages:state.messages,payments:state.payments,bills:state.bills,lastSync:state.lastSync}}
async function saveHistory(){
 if(!state.email || state.storagePhase==='ERROR'||state.storagePhase==='BOOTING'||state.storagePhase==='LOADING')return;
 const copy=getAccountRecord();state.persistPending++;
 if(state.storagePhase==='READY')setStoragePhase('SAVING');
 try {await Store.write(copy)}
 catch(err){state.storageError=err;state.persistPending=0;setStoragePhase('ERROR');toast('Cannot save data: '+err.message);return}
 state.persistPending=Math.max(0,state.persistPending-1);
 if(state.persistPending===0&&state.storagePhase==='SAVING')setStoragePhase('READY');
}
function applyAccount(record,email){
 const normalized=String(email||'').toLowerCase();
 const x=record&&record.email===normalized?record:null;
 state.email=normalized||null;
 state.messages=Array.isArray(x?.messages)?x.messages:[];
 state.payments=Array.isArray(x?.payments)?x.payments.map(c=>({...c,status:E.normalizeStatus(c.status)})):[];
 state.bills=Array.isArray(x?.bills)?x.bills.map(c=>({...c,status:E.normalizeStatus(c.status)})):[];
 state.lastSync=x?.lastSync||null;state.pageToken=null;
 render();updateStorageBanner();
}
async function loadAccount(email,generation){
 const record=await Store.read(email);
 if(generation!==state.generation)return false;
 applyAccount(record,email);
 await Store.setLastEmail(email);
 return true;
}
function connect(){
 if(state.storagePhase==='LOADING'||state.storagePhase==='BOOTING'){toast('Opening saved history. Try again.');return}
 const client_id=getClientId().trim();
 if(!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(client_id)){
   toast('Save your Google Web OAuth client ID first');route('settings');return;
 }
 if(!window.google?.accounts?.oauth2?.initTokenClient){toast('Google sign-in has not loaded. Check your connection.');return}
 const previousEmail=state.email;
 if(state.phase==='CONNECTED')state.token=null;
 const generation=++state.generation;state.controller?.abort();state.controller=null;
 if(state.mailPhase!=='IDLE')setMailPhase('IDLE');
 if(state.syncPhase!=='IDLE')setSyncPhase('IDLE');
 setPhase('CONNECTING');
 const client=google.accounts.oauth2.initTokenClient({client_id,scope:SCOPE,
 callback:async r=>{
   if(generation!==state.generation)return;
   if(r.error||!r.access_token){setPhase('ERROR');toast(r.error_description||r.error||'Google authorization cancelled');return}
   if(google.accounts.oauth2.hasGrantedAllScopes&&!google.accounts.oauth2.hasGrantedAllScopes(r,SCOPE)){
     setPhase('ERROR');toast('Gmail read-only permission was not granted');return;
   }
   state.token=r.access_token;
   state.expiresAt=Date.now()+(Math.max(60,Number(r.expires_in)||3600)-30)*1000;
   setPhase('VERIFYING');
   try {
     const profile=await api('profile');
     if(generation!==state.generation)return;
     const email=String(profile.emailAddress||'').toLowerCase();
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Google did not return a valid Gmail address');
     if(email!==previousEmail){
       // Prevent mixing financial records from separate Gmail accounts.
       state.messages=[];state.payments=[];state.bills=[];state.lastSync=null;render();
       if(state.storagePhase!=='ERROR')await loadAccount(email,generation);
       else applyAccount(null,email);
     }else state.email=email;
     if(generation!==state.generation)return;
     setPhase('CONNECTED');toast('Connected to '+email);
     syncFinancial().catch(err=>toast(err.message));
   }catch(err){
     if(generation!==state.generation)return;
     state.token=null;setPhase('ERROR');toast('Gmail connection failed: '+err.message);
   }
 },
 error_callback:e=>{if(generation!==state.generation)return;setPhase('ERROR');toast(e.type||'Google sign-in failed')}
 });
 try {client.requestAccessToken({prompt:previousEmail?'select_account':''})}
 catch(err){setPhase('ERROR');toast('Cannot open Google account chooser: '+err.message)}
}

function requireToken(){if(!state.token||Date.now()>=state.expiresAt){state.token=null;setPhase('EXPIRED');throw new Error('Google session expired. Connect again.')}return state.token}
async function api(path,signal){const token=requireToken();const res=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+token},signal});if(res.status===401){state.token=null;setPhase('EXPIRED');throw new Error('Gmail authorization expired. Reconnect.')};if(!res.ok){let detail='';try{detail=(await res.json()).error?.message||''}catch{}throw new Error('Gmail request failed ('+res.status+'): '+detail)}return res.json()}
const headers=m=>Object.fromEntries((m.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
function parseMessage(raw){const h=headers(raw);return{id:raw.id,threadId:raw.threadId,subject:h.subject||'(no subject)',sender:h.from||'Unknown sender',date:new Date(Number(raw.internalDate)||Date.now()).toISOString(),snippet:raw.snippet||'',labelIds:raw.labelIds||[]}}
/* Receipt and bill detection lives in the audited, deterministic finance engine. */
function rebuildCandidates(){
 const unique=[...new Map(state.messages.map(m=>[m.id,m])).values()];
 const parsed=unique.map(E.parseEmail).filter(Boolean);
 const old=[...state.payments,...state.bills];
 const combined=E.mergeCandidates(old,parsed);
 state.payments=combined.filter(c=>c.kind==='PAYMENT');
 state.bills=combined.filter(c=>c.kind==='BILL');
}
async function syncFinancial(){
 if(state.syncPhase==='RUNNING')return;
 if(state.phase!=='CONNECTED'){toast('Reconnect Gmail to check for new transactions');return}
 requireToken();
 setSyncPhase('RUNNING');
 const generation=state.generation,email=state.email;
 const ctrl=new AbortController();
 state.controller=ctrl;
 let total=0,next=null,failed=0;
 const scanned=[];
 el('syncStatus').textContent='Scanning recent financial emails…';
 try{
   do{
     const query='(receipt OR payment OR statement OR "amount due" OR "order confirmed" OR transaction OR invoice OR "bill due") newer_than:90d';
     let url='messages?maxResults=100&q='+encodeURIComponent(query);
     if(next)url+='&pageToken='+encodeURIComponent(next);
     const page=await api(url,ctrl.signal);
     if(generation!==state.generation||state.email!==email)return;
     const ids=(page.messages||[]).map(m=>m.id);
     for(let i=0;i<ids.length;i+=8){
       const results=await Promise.allSettled(ids.slice(i,i+8).map(id=>api('messages/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date',ctrl.signal)));
       if(generation!==state.generation||state.email!==email)return;
       for(const row of results){if(row.status==='fulfilled')scanned.push(parseMessage(row.value));else failed++}
       total+=results.length;
       el('syncStatus').textContent='Scanned '+total+' emails…';
     }
     next=page.nextPageToken||null;
   }while(next&&total<300);
   if(generation!==state.generation||state.email!==email)return;
   state.messages=[...new Map([...state.messages,...scanned].map(m=>[m.id,m])).values()].slice(-2500);
   rebuildCandidates();
   state.lastSync=new Date().toISOString();
   setSyncPhase(failed?'PARTIAL':'COMPLETE');
   el('syncStatus').textContent='Processed '+total+' emails'+(failed?' ('+failed+' unavailable)':'')+'. Review statuses before treating amounts as paid or due.';
   render();await saveHistory();
   toast('History updated and saved on this device');
 }catch(err){
   if(generation!==state.generation)return;
   if(err.name!=='AbortError'){
     setSyncPhase('ERROR');el('syncStatus').textContent=err.message;
     toast(err.message);
   }
 }finally{
   if(generation===state.generation){state.controller=null;el('sync').disabled=state.phase!=='CONNECTED'}
 }
}

async function loadMail(append=false){
 if(state.mailPhase==='LOADING')return;
 if(state.phase!=='CONNECTED'){toast('Reconnect Gmail to search new messages');return}
 if(append&&!state.pageToken)return;
 setMailPhase('LOADING');
 const generation=state.generation, ctrl=new AbortController();
 try{
   const query=state.mailQuery;
   let path='messages?maxResults=25&q='+encodeURIComponent(query);
   if(append)path+='&pageToken='+encodeURIComponent(state.pageToken);
   const page=await api(path,ctrl.signal);
   const data=await Promise.allSettled((page.messages||[]).map(m=>
     api('messages/'+encodeURIComponent(m.id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date',ctrl.signal)));
   if(generation!==state.generation)return;
   const parsed=data.filter(x=>x.status==='fulfilled').map(x=>parseMessage(x.value));
   state.messages=[...new Map([...state.messages,...parsed].map(m=>[m.id,m])).values()].slice(-2500);
   state.pageToken=page.nextPageToken||null;
   renderMail(parsed,append);
   setMailPhase('READY');
 }catch(err){
   if(generation!==state.generation)return;
   setMailPhase(err.name==='AbortError'?'IDLE':'ERROR');
   if(err.name!=='AbortError')toast(err.message);
 }finally{
   if(generation===state.generation && state.mailPhase==='LOADING')setMailPhase('IDLE');
 }
}
function renderMail(items,append){const node=el('mailList');if(!append)node.replaceChildren();if(!items.length&&!append){node.className='empty';node.textContent='No matching emails.'}else{node.className='';for(const m of items){const d=document.createElement('div');d.className='item';d.innerHTML='<div class="itemTop"><strong>'+escapeHTML(m.subject)+'</strong><small>'+escapeHTML(new Date(m.date).toLocaleDateString())+'</small></div><p>'+escapeHTML(m.sender)+'</p><p>'+escapeHTML(m.snippet)+'</p>';d.onclick=()=>showMail(m);node.append(d)}}el('loadMore').hidden=!state.pageToken}
function showMail(m){el('dialogTitle').textContent=m.subject;el('dialogMeta').textContent=m.sender+' • '+new Date(m.date).toLocaleString();el('dialogText').textContent=m.snippet+'\n\nFor full message contents, open Gmail.';el('mailDialog').showModal()}
function statusLabel(status){
 return ({REVIEW:'Needs review',PAID:'Paid (you confirmed)',DUE:'Due / unpaid (you marked)',IGNORED:'Ignored'})[E.normalizeStatus(status)]||'Needs review';
}
function reviewCandidate(c,next){
 try{c.status=E.reviewTransition(E.normalizeStatus(c.status),next)}
 catch(err){toast(err.message);return}
 c.reviewedAt=new Date().toISOString();
 render();saveHistory();
}
function itemCard(c){
 const node=document.createElement('article');
 node.className='item';node.dataset.review=E.normalizeStatus(c.status);
 const evidence=c.reviewSuggestion||c.evidence||'Email-derived candidate — verify against original statement';
 const suggestion=({LIKELY_PAID:'Email suggests paid',POSSIBLY_DUE:'Email suggests due',STATEMENT_ONLY:'Statement: status unknown',PURCHASE_UNVERIFIED:'Purchase: payment unverified'})[c.suggestedStatus]||null;
 const label=statusLabel(c.status);
 const subtitle=String(c.date).slice(0,10)+(c.dueDate?' · Due '+c.dueDate:'')+' · '+(c.category||'Other');
 node.innerHTML='<div class="detail-row"><span class="detail-title">'+escapeHTML(c.merchant)+'</span><strong>'+money(c.amount,c.currency)+'</strong></div>'+
   '<div class="detail-sub">'+escapeHTML(c.subject)+'</div>'+
   '<div class="detail-sub">'+escapeHTML(subtitle)+'</div>'+
   '<div class="review-head"><span class="review-pill '+E.normalizeStatus(c.status).toLowerCase()+'">'+escapeHTML(label)+'</span>'+
   (c.possibleDuplicateOf?'<span class="review-pill">Possible duplicate · verify</span>':'')+
   (E.normalizeStatus(c.status)==='REVIEW'&&suggestion?'<span class="review-pill suggestion">'+escapeHTML(suggestion)+'</span>':'')+'</div>'+
   '<div class="detail-sub">'+escapeHTML(evidence)+'</div>';
 const actions=document.createElement('div');actions.className='actions';
 for(const [next,text] of [['PAID','Mark paid'],['DUE','Due / unpaid'],['IGNORED','Ignore'],['REVIEW','Reset review']]){
   if(E.normalizeStatus(c.status)===next)continue;
   const btn=document.createElement('button');btn.className='secondary';btn.type='button';btn.textContent=text;btn.onclick=()=>reviewCandidate(c,next);actions.append(btn);
 }
 const link=document.createElement('button');link.className='secondary';link.type='button';link.textContent='Open email';
 link.onclick=()=>{
   const authuser=encodeURIComponent(state.email||'');
   window.open('https://mail.google.com/mail/?authuser='+authuser+'#all/'+encodeURIComponent(c.messageId),'_blank','noopener,noreferrer');
 };
 actions.append(link);node.append(actions);return node;
}
function allCandidates(){return [...state.payments,...state.bills]}
function moneyList(candidates,status){
 const totals={};
 for(const item of candidates.filter(x=>E.normalizeStatus(x.status)===status)){
   totals[item.currency||'USD']=(totals[item.currency||'USD']||0)+item.amount;
 }
 return Object.entries(totals).map(([curr,value])=>money(value,curr)).join(' + ')||'None';
}
function render(){
 const today=new Date(),current=monthKey(today),S=E.summary(state.payments,current);
 const currencies=Object.entries(S.groups);
 const fmt=key=>currencies.map(([curr,g])=>money(g[key],curr)).join(' + ')||'$0.00';
 el('monthTotal').textContent=fmt('detected');
 el('paidHint').textContent='You confirmed paid: '+fmt('paid');
 el('monthLabel').textContent=today.toLocaleDateString('en-US',{month:'long',year:'numeric'})+
   ' · '+S.reviewCount+' need review'+(S.possibleDuplicateCount?' · '+S.possibleDuplicateCount+' possible duplicates excluded':'');
 el('paymentCount').textContent=state.payments.filter(c=>E.normalizeStatus(c.status)!=='IGNORED').length;
 el('billCount').textContent=state.bills.filter(c=>E.normalizeStatus(c.status)!=='IGNORED').length;
 const recent=el('recent');recent.replaceChildren();
 const latest=state.payments.filter(c=>E.normalizeStatus(c.status)!=='IGNORED').slice(0,4);
 if(!latest.length){recent.className='empty';recent.textContent=state.email?'No detected payment candidates yet':'Connect Gmail to look for receipts and payments'}
 else{recent.className='';latest.forEach(c=>recent.append(itemCard(c)))}
 const select=el('monthSelect'),previous=select.value;
 const months=[...new Set(state.payments.map(x=>monthKey(x.date)))].sort().reverse();
 select.replaceChildren(new Option('All months','all'));
 months.forEach(m=>select.add(new Option(m,m)));select.value=months.includes(previous)?previous:'all';
 renderPayments();
 renderBills();
 const due=E.billSummary(state.bills);
 el('dueSummary').textContent=due.count?due.count+' bills marked due / unpaid · '+moneyList(due.due,'DUE')+
   (due.overdue.length?' · '+due.overdue.length+' past the extracted due date':''):
   'No bills have been marked unpaid yet. '+due.review+' still need review.';
 updateStorageBanner();
}
function renderBills(){
 const selected=el('billStatusFilter')?.value||'all';
 const b=el('billList');b.replaceChildren();
 const rank={DUE:0,REVIEW:1,PAID:2,IGNORED:3};
 const bills=state.bills.filter(c=>selected==='all'||E.normalizeStatus(c.status)===selected)
   .sort((a,b)=>(rank[E.normalizeStatus(a.status)]??9)-(rank[E.normalizeStatus(b.status)]??9)||b.date.localeCompare(a.date));
 if(!bills.length){b.className='empty';b.textContent='No bills match this status'}
 else{b.className='';bills.forEach(c=>b.append(itemCard(c)))}
}
function renderPayments(){
 const q=el('paymentSearch').value.toLowerCase(),month=el('monthSelect').value;
 const status=el('paymentStatusFilter')?.value||'all';
 const list=state.payments.filter(x=>(month==='all'||monthKey(x.date)===month)&&
   (status==='all'||E.normalizeStatus(x.status)===status)&&
   (x.merchant+' '+x.subject).toLowerCase().includes(q));
 el('confirmedTotal').textContent=moneyList(list,'PAID');
 const n=el('paymentList');n.replaceChildren();
 if(!list.length){n.className='empty';n.textContent='No payment candidates match'}
 else{n.className='';list.forEach(c=>n.append(itemCard(c)))}
}
function openBreakdown(){
 const month=monthKey(new Date()),S=E.summary(state.payments,month);
 el('breakdownTitle').textContent='Spending breakdown · '+month;
 el('breakdownCaption').textContent='These are candidate amounts from email, not bank-verified spending. Only entries marked Paid have been reviewed by you.';
 const metrics=el('breakdownMetrics');metrics.replaceChildren();
 for(const [currency,g] of Object.entries(S.groups)){
   for(const [label,key] of [['Detected','detected'],['Confirmed paid','paid'],['Marked due','due'],['Needs review','review']]){
     const tile=document.createElement('div');tile.className='breakdown-tile';
     const a=document.createElement('span');a.textContent=currency+' · '+label;
     const b=document.createElement('strong');b.textContent=money(g[key],currency);
     tile.append(a,b);metrics.append(tile);
   }
 }
 if(!S.items.length){metrics.textContent='No payment candidates this month'}
 const totals=new Map();
 for(const c of S.items){
   const key=c.category+'|'+c.currency;
   totals.set(key,(totals.get(key)||0)+c.amount);
 }
 const cats=el('breakdownCategories');cats.replaceChildren();
 const max=Math.max(1,...totals.values());
 for(const [key,value] of [...totals].sort((a,b)=>b[1]-a[1])){
   const [category,currency]=key.split('|');
   const row=document.createElement('div');row.className='breakdown-category';
   const head=document.createElement('div');head.className='category-label';
   const left=document.createElement('span');left.textContent=category;
   const right=document.createElement('strong');right.textContent=money(value,currency);
   head.append(left,right);
   const bar=document.createElement('div');bar.className='breakdown-bar';
   const fill=document.createElement('div');fill.style.width=Math.max(3,value/max*100).toFixed(1)+'%';bar.append(fill);
   row.append(head,bar);cats.append(row);
 }
 if(!totals.size)cats.textContent='No categories available yet';
 const items=el('breakdownItems');items.replaceChildren();
 for(const c of S.items){
   const row=document.createElement('div');row.className='breakdown-item';
   const left=document.createElement('div');const title=document.createElement('strong');
   title.textContent=c.merchant;const sub=document.createElement('small');sub.textContent=String(c.date).slice(0,10)+' · '+statusLabel(c.status);
   left.append(title,sub);const amt=document.createElement('strong');amt.textContent=money(c.amount,c.currency);
   row.append(left,amt);items.append(row);
 }
 if(!S.items.length)items.textContent='No included transactions';
 el('breakdownFooter').textContent=S.possibleDuplicateCount?
   S.possibleDuplicateCount+' potentially duplicate emails excluded until you explicitly confirm them.': 
   'Review items in Payments to change the totals. All financial estimates are local to the selected account.';
 el('breakdownDialog').showModal();
}

el('paymentSearch').oninput=renderPayments;
el('monthSelect').onchange=renderPayments;
el('paymentStatusFilter').onchange=renderPayments;
el('billStatusFilter').onchange=renderBills;
el('spendingHero').onclick=openBreakdown;
el('spendingHero').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openBreakdown()}};
el('closeBreakdown').onclick=()=>el('breakdownDialog').close();
el('saveClient').onclick=()=>{
 const v=el('clientId').value.trim();
 if(!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(v)){toast('Invalid Web OAuth client ID');return}
 localStorage.setItem('ledgermail.clientId',v);toast('Public client ID saved');
};
el('connect').onclick=connect;el('disconnect').onclick=disconnect;el('disconnectLocal').onclick=disconnect;
el('clear').onclick=async()=>{
 if(!state.email){toast('No saved account selected');return}
 if(!confirm('Delete saved financial history for '+state.email+' from this device? This cannot be undone.'))return;
 const account=state.email;
 try{
   await Store.remove(account);
   state.messages=[];state.payments=[];state.bills=[];state.lastSync=null;
   render();toast('Saved history deleted for '+account);
 }catch(err){toast('Cannot delete saved history: '+err.message)}
};
el('sync').onclick=syncFinancial;
el('searchMail').onclick=()=>{state.mailQuery=el('mailSearch').value.trim()||'in:anywhere newer_than:90d';state.pageToken=null;loadMail(false)};
el('mailSearch').onkeydown=e=>{if(e.key==='Enter')el('searchMail').click()};
el('loadMore').onclick=()=>loadMail(true);
el('closeDialog').onclick=()=>el('mailDialog').close();
el('exportBackup').onclick=()=>{
 if(!state.email){toast('No selected Gmail history to export');return}
 const json=JSON.stringify({...Store.snapshot(getAccountRecord()),backupType:'LedgerMail-v4'});
 const blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;
 link.download='LedgerMail-'+state.email.replace(/[^a-z0-9.-]/gi,'_')+'-'+new Date().toISOString().slice(0,10)+'.json';
 link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
 toast('Backup contains sensitive transaction details. Store privately.');
};
el('importBackup').onclick=()=>el('backupFile').click();
el('backupFile').onchange=async()=>{
 const file=el('backupFile').files?.[0];el('backupFile').value='';
 if(!file)return;if(file.size>12_000_000){toast('Backup is too large');return}
 try{
   const raw=JSON.parse(await file.text());
   if(raw.version!==4||!raw.email)throw Error('Not a LedgerMail v4 backup');
   const record=Store.snapshot(raw);
   if(!confirm('Restore financial history for '+record.email+'? Existing saved data for that account will be replaced.'))return;
   if(state.phase==='CONNECTED')disconnect();
   await Store.write(record);await Store.setLastEmail(record.email);
   applyAccount(record,record.email);
   setPhase('DISCONNECTED');toast('Backup restored. Reconnect Gmail to sync newer emails.');
 }catch(err){toast('Backup restore failed: '+err.message)}
};
el('clientId').value=getClientId();
document.body.dataset.section='dashboard';document.querySelector('.nav.active')?.setAttribute('aria-current','page');
setPhase('DISCONNECTED');render();
async function initializeLocalHistory(){
 try{
   setStoragePhase('LOADING');
   const generation=state.generation;
   const last=await Store.getLastEmail();
   if(generation!==state.generation)return;
   if(last){
     const saved=await Store.read(last);
     if(generation!==state.generation)return;
     applyAccount(saved,last);
     el('syncStatus').textContent='Showing saved history. Reconnect Gmail to check for newer emails.';
   }
   setStoragePhase('READY');
   setPhase('DISCONNECTED');render();
 }catch(err){
   state.storageError=err;setStoragePhase('ERROR');
   el('localSaveStatus').textContent='Local storage unavailable: '+err.message;
   toast('Local saving is unavailable. Check Safari privacy settings.');
 }
}
initializeLocalHistory();
if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});

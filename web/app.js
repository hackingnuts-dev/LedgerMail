/* LedgerMail v4: explicit state machines, local per-account history, explainable candidate review. */
'use strict';
const APP_BUILD=18;
const MAIL_BACKEND='/.netlify/functions/mail';
let backendAvailable=false,backgroundBusy=false;
const SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const LOGIN_SCOPE=SCOPE+' openid email';
const E=window.LedgerEngine, Store=window.LedgerStore, Strict=window.LedgerStrict;
if(!E||!Store||!Strict)throw new Error('LedgerMail finance dependencies missing. Reload the app.');
const state={phase:'DISCONNECTED',email:null,token:null,expiresAt:0,controller:null,generation:0,
 messages:[],payments:[],bills:[],pageToken:null,mailQuery:'',
 mailBusy:false,mailPhase:'IDLE',route:'dashboard',backupPhase:'IDLE',syncPhase:'IDLE',storagePhase:'BOOTING',lastSync:null,persistPending:0,storageError:null,legacy:[],scanStats:null,selectedMonth:null,coverage:{},includeUpdates:false};
const el=id=>document.getElementById(id);
const money=(amount,currency='USD')=>{try{return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount)}catch{return String(amount)+' '+currency}};
const monthKey=d=>Strict.dateKey(d).slice(0,7);
state.selectedMonth=monthKey(new Date());
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
function setMailPhase(next){
 state.mailPhase=E.transition('inbox',state.mailPhase,next);
 state.mailBusy=next==='LOADING';
 el('searchMail').disabled=state.mailBusy;
 el('loadMore').disabled=state.mailBusy;
}
function setBackupPhase(next){
 state.backupPhase=E.transition('backup',state.backupPhase,next);
 const busy=['READING','VALIDATING','WRITING','EXPORTING'].includes(next);
 el('exportBackup').disabled=busy;el('importBackup').disabled=busy;
}
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
 if(clearView){state.messages=[];state.payments=[];state.bills=[];state.legacy=[];state.scanStats=null;state.coverage={};state.includeUpdates=false;state.selectedMonth=monthKey(new Date());state.lastSync=null;state.email=null}
 setPhase('DISCONNECTED');render();
}
async function disconnect(){if(backendAvailable){try{const r=await fetch(MAIL_BACKEND+'?action=disconnect',{method:'POST',credentials:'same-origin'});if(!r.ok)throw Error('Server disconnect failed')}catch(e){toast(e.message);return}}resetSession();toast('Gmail disconnected. Your saved history remains on this device.')}
function getAccountRecord(){return {email:state.email,messages:state.messages,payments:state.payments,bills:state.bills,legacy:state.legacy,lastSync:state.lastSync,coverage:state.coverage,selectedMonth:state.selectedMonth,includeUpdates:state.includeUpdates}}
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
 const normalized=String(email||'').trim().toLowerCase();
 const x=record&&record.email===normalized?record:null;
 state.email=normalized||null;
 const payments=Array.isArray(x?.payments)?x.payments:[];
 const bills=Array.isArray(x?.bills)?x.bills:[];
 const valid=c=>Number(c?.analysisVersion)===5&&['PRIMARY_FULL','UPDATES_FULL'].includes(c.evidenceLevel);
 state.legacy=[...(x?.legacy||[]),...payments.filter(c=>!valid(c)),...bills.filter(c=>!valid(c))]
   .filter(Boolean).slice(-500);
 state.messages=(Array.isArray(x?.messages)?x.messages:[]).filter(m=>Strict.isPrimary(m.labelIds)||(x?.includeUpdates&&Strict.isFinancialUpdate(m.labelIds)));
 state.payments=Strict.reconcileDuplicates(payments.filter(valid).map(c=>({...c,status:E.normalizeStatus(c.status)})));
 state.bills=bills.filter(valid).map(c=>({...c,status:E.normalizeStatus(c.status)}));
 state.lastSync=Number(x?.version)>=5?x?.lastSync||null:null;
 state.scanStats=null;state.pageToken=null;state.coverage=Object.fromEntries(Object.entries(x?.coverage||{}).filter(([k,v])=>[14,15,17].includes(v.build)));state.includeUpdates=x?.includeUpdates===true;state.selectedMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(x?.selectedMonth||'')?x.selectedMonth:monthKey(new Date());
 render();updateStorageBanner();
}

async function loadAccount(email,generation){
 const record=await Store.read(email);
 if(generation!==state.generation)return false;
 applyAccount(record,email);
 await Store.setLastEmail(email);
 return true;
}
function connect(){if(backendAvailable){location.assign(MAIL_BACKEND+'?action=start');return}
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
 const client=google.accounts.oauth2.initTokenClient({client_id,scope:LOGIN_SCOPE,
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
     const profile=await verifyGoogleIdentity(r.access_token,generation);
     if(generation!==state.generation)return;
     const email=String(profile.email||'').toLowerCase();
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Google did not return a valid Gmail address');
     if(email!==previousEmail){
       // Prevent mixing financial records from separate Gmail accounts.
       state.messages=[];state.payments=[];state.bills=[];state.legacy=[];state.scanStats=null;state.coverage={};state.lastSync=null;render();
       if(state.storagePhase!=='ERROR')await loadAccount(email,generation);
       else applyAccount(null,email);
     }else state.email=email;
     if(generation!==state.generation)return;
     setPhase('CONNECTED');toast('Connected to '+email);
     el('syncStatus').textContent='Connected. Select a month and tap Scan month to update your finances.';
   }catch(err){
     if(generation!==state.generation)return;
     state.token=null;setPhase('ERROR');if(err.code==='GMAIL_RATE_LIMIT')el('authStatus').textContent='Google temporarily rate-limited Gmail verification. Saved history remains; reconnect after cooldown.';toast('Gmail connection: '+err.message);
   }
 },
 error_callback:e=>{if(generation!==state.generation)return;setPhase('ERROR');toast(e.type||'Google sign-in failed')}
 });
 try {client.requestAccessToken({prompt:previousEmail?'select_account':''})}
 catch(err){setPhase('ERROR');toast('Cannot open Google account chooser: '+err.message)}
}

async function verifyGoogleIdentity(token,generation){
 const response=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(generation!==state.generation||state.token!==token)throw new DOMException('Account changed','AbortError');
 if(!response.ok)throw Error('Google identity verification failed ('+response.status+'). Reconnect and allow email access.');
 const profile=await response.json();
 if(profile.email_verified!==true||typeof profile.email!=='string')throw Error('Google did not verify the account email. Reconnect and allow email access.');
 return profile;
}
function requireToken(){if(backendAvailable&&state.phase==='CONNECTED')return 'SERVER_SESSION';if(!state.token||Date.now()>=state.expiresAt){state.token=null;setPhase('EXPIRED');throw new Error('Google session expired. Connect again.')}return state.token}
// Shared, conservative request pacing; retries never switch accounts or reuse a stale token.
let gmailTail=Promise.resolve(),gmailNext=0,gmailBlockedGeneration=-1;
const Q=window.LedgerQuota;
const budgetMemory=new Map();
const quotaKey=email=>'ledgermail.gmailCooldown.'+String(email||'').toLowerCase();
function readCooldown(email){try{return Number(localStorage.getItem(quotaKey(email)))||0}catch{return 0}}
function writeCooldown(email,until){try{localStorage.setItem(quotaKey(email),String(until))}catch{}}
const abortError=()=>new DOMException('Gmail request cancelled','AbortError');
function gmailWait(ms,signal){
 if(signal?.aborted)return Promise.reject(abortError());
 return new Promise((resolve,reject)=>{
   const done=()=>{signal?.removeEventListener('abort',cancel);resolve()};
   const timer=setTimeout(done,Math.max(0,ms));
   function cancel(){clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(abortError())}
   signal?.addEventListener('abort',cancel,{once:true});
 });
}
function quotaDelay(res,attempt,now=Date.now()){
 const retry=res.headers?.get?.('Retry-After');const seconds=retry==null?NaN:Number(retry);
 const wait=Number.isFinite(seconds)?seconds*1000:retry?Date.parse(retry)-now:0;
 return Math.max(65000,Number.isFinite(wait)?wait:0,Math.min(120000,65000*Math.pow(1.3,attempt)));
}
const ledgerKey=email=>'ledgermail.quotaBudget.'+String(email||'').toLowerCase();
async function reserveGmail(account,path,signal,check){
 const key=ledgerKey(account);
 const reserveOnce=()=>{
   check();
   let entries=budgetMemory.get(key)||[];
   try{const raw=localStorage.getItem(key);if(raw)entries=JSON.parse(raw)}catch{}
   const decision=Q.reserve(entries,Q.cost(path),Date.now());
   if(!decision.wait){
     budgetMemory.set(key,decision.entries);
     try{localStorage.setItem(key,JSON.stringify(decision.entries))}catch{}
   }
   return decision;
 };
 for(;;){
   check();
   const result=navigator.locks?.request?await navigator.locks.request(key,{mode:'exclusive',...(signal?{signal}:{})},reserveOnce):reserveOnce();
   if(!result.wait)return;
   if(state.syncPhase==='RUNNING'){el('syncStatus').textContent='Quota budget cooldown · scan will resume automatically';el('monthCoverage').textContent=el('syncStatus').textContent}
   await gmailWait(result.wait,signal);
 }
}
async function api(path,signal){if(backendAvailable){const r=await fetch(MAIL_BACKEND+'?action=gmail&path='+encodeURIComponent(path),{credentials:'same-origin',cache:'no-store',signal});if(r.status===401){setPhase('EXPIRED');throw Error('Server Gmail session expired')}if(!r.ok)throw Error('Gmail server error '+r.status);return r.json()}
 const generation=state.generation,token=requireToken(),account=state.email;
 const check=()=>{if(signal?.aborted||generation!==state.generation||state.token!==token)throw abortError();requireToken()};
 const task=async()=>{
   for(let attempt=0;attempt<3;attempt++){
     check();
     if(gmailBlockedGeneration===generation&&Date.now()<readCooldown(account)){const error=Error('Gmail cooldown active. Saved history is retained.');error.code='GMAIL_RATE_LIMIT';throw error;}
     await gmailWait(Math.max(0,gmailNext-Date.now(),readCooldown(account)-Date.now()),signal);check();
     await reserveGmail(account,path,signal,check);check();
     gmailNext=Date.now()+2100;
     const res=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+token},signal});
     check();
     if(res.ok)return res.json();
     let detail='',reasons='';
     try{const err=(await res.json()).error||{};detail=err.message||'';reasons=JSON.stringify(err.errors||err.details||[])}catch{}
     if(res.status===401){state.token=null;setPhase('EXPIRED');throw Error('Gmail authorization expired. Reconnect.')}
     const errorType=Q.classify(res.status,detail,reasons);
     const limited=errorType==='quota';
     if(errorType==='temporary'&&attempt<2){await gmailWait(1000*Math.pow(2,attempt),signal);continue}
     if(limited){
       const delay=quotaDelay(res,attempt);writeCooldown(account,Math.max(readCooldown(account),Date.now()+delay));
       const notice='Build '+APP_BUILD+': Gmail quota cooldown. Retrying automatically; your account remains connected and saved history is safe.';
       if(state.phase==='VERIFYING')el('authStatus').textContent=notice;
       if(state.syncPhase==='RUNNING'){el('syncStatus').textContent=notice;el('monthCoverage').textContent=notice}
       if(attempt<2)continue;
       gmailBlockedGeneration=generation;
       const error=Error('Gmail rate limit persists. Saved history is retained. Retry after the cooldown.');error.code='GMAIL_RATE_LIMIT';throw error;
     }
     if(errorType==='configuration'){const error=Error('Google Cloud API configuration or permission error: '+detail);error.code='GMAIL_CONFIGURATION';throw error}
     throw Error('Gmail request failed ('+res.status+'): '+detail);
   }
 };
 const queued=gmailTail.then(task,task);gmailTail=queued.catch(()=>{});return queued;
}

const headers=m=>Object.fromEntries((m.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
function parseMessage(raw){const h=headers(raw);return{id:raw.id,threadId:raw.threadId,subject:h.subject||'(no subject)',sender:h.from||'Unknown sender',date:new Date(Number(raw.internalDate)||Date.now()).toISOString(),snippet:raw.snippet||'',labelIds:raw.labelIds||[]}}
/* Financial candidate creation only occurs from Strict.parseGmailFull + Strict.classifyFullMail. */
async function syncFinancial(){
 if(state.syncPhase==='RUNNING')return;
 if(state.phase!=='CONNECTED'){toast('Reconnect Gmail to scan this month');route('settings');return}
 requireToken();
 const month=state.selectedMonth,includeUpdates=state.includeUpdates;
 setSyncPhase('RUNNING');render();el('syncStatus').textContent='Searching Gmail for the selected month…';el('monthCoverage').textContent=el('syncStatus').textContent;
 const generation=state.generation,email=state.email,ctrl=new AbortController();
 state.controller=ctrl;
 let scanned=0,failed=0,skipped=0,unreadable=0,retrieved=0,cached=0,broadUsed=false;
 const reasons={};const note=r=>{reasons[r]=(reasons[r]||0)+1};
 const prior=state.coverage[month];
 const incremental=prior?.build===17&&prior.includeUpdates===includeUpdates;
 const previousIds=incremental?(prior.checkedIds||[]):[];
 const accepted=incremental?[...state.payments,...state.bills].filter(c=>monthKey(c.date)===month&&(includeUpdates||c.evidenceLevel!=='UPDATES_FULL')):[],summaries=[],seen=new Set(previousIds),startedAt=Date.now();
 const valid=()=>generation===state.generation&&state.email===email;
 const active=()=>valid()&&state.selectedMonth===month&&state.includeUpdates===includeUpdates;
 try{
   if(await checkRelease(false))return;
   if(!active())return;
   for(const broad of [false,true]){
     if(broad&&retrieved>0)break;
     if(broad)broadUsed=true;
     const updates=includeUpdates;
     let next=null;const pages=new Set();
     do{
       if(!active())return;
       let path='messages?maxResults=100&q='+encodeURIComponent(Strict.monthlyQuery(month,updates,broad));
       if(next)path+='&pageToken='+encodeURIComponent(next);
       const page=await api(path,ctrl.signal);
       if(!active())return;
       const listed=[...new Set((page.messages||[]).map(m=>m.id))];retrieved+=listed.length;cached+=listed.filter(id=>seen.has(id)).length;
       const ids=listed.filter(id=>!seen.has(id));
       for(let i=0;i<ids.length;i+=(backendAvailable?4:1)){
         const result=await Promise.allSettled(ids.slice(i,i+(backendAvailable?4:1)).map(id=>(async()=>{if(broad){const meta=await api('messages/'+encodeURIComponent(id)+'?format=minimal',ctrl.signal);if(!(Strict.isPrimary(meta.labelIds)||(includeUpdates&&Strict.isFinancialUpdate(meta.labelIds))))return meta;}return api('messages/'+encodeURIComponent(id)+'?format=full',ctrl.signal)})()));
         if(!active())return;
         for(const row of result){
           scanned++;
           if(row.status!=='fulfilled'){failed++;note(row.reason?.code==='GMAIL_RATE_LIMIT'?'Gmail rate limit':'Gmail fetch error');throw row.reason}
           const raw=row.value;
           if(!(Strict.isPrimary(raw.labelIds)||(includeUpdates&&Strict.isFinancialUpdate(raw.labelIds)))){skipped++;note('Excluded category');seen.add(raw.id);continue}
           if(seen.has(raw.id))continue;
           const m=Strict.parseGmailFull(raw,includeUpdates);
           if(!m){unreadable++;note('No readable message body');continue}
           if(monthKey(m.date)!==month){skipped++;note('Outside selected month');seen.add(raw.id);continue}
           seen.add(raw.id);
           const result=Strict.inspectEvidence(m,includeUpdates);
           let c=Strict.structuredReceipt(m,includeUpdates)||Strict.classifyFullMail(m,includeUpdates);
           if(!c||c.confidence!=='HIGH'){
             if(result.candidate&&(!c||result.candidate.confidence==='HIGH'))c=result.candidate;
             if(m.alternateBody&&(!c||c.confidence!=='HIGH')){
               const alternative={...m,body:m.alternateBody,alternateBody:null};
               const alt=Strict.inspectEvidence(alternative,includeUpdates);
               const strictAlt=Strict.structuredReceipt(alternative,includeUpdates)||Strict.classifyFullMail(alternative,includeUpdates);
               const best=strictAlt?.confidence==='HIGH'?strictAlt:alt.candidate||strictAlt;
               if(best&&(!c||best.confidence==='HIGH'))c=best;
             }
           }
           if(!c){skipped++;note(result.reason);continue}
           note(c.confidence==='HIGH'?'Strong financial evidence':'Needs review');
           accepted.push(c);summaries.push({id:m.id,threadId:m.threadId,subject:m.subject,sender:m.sender,date:m.date,snippet:'Financial email analyzed locally',labelIds:m.labels});
         }
         if(scanned%5===0||i+(backendAvailable?4:1)>=ids.length){
           if(!active())return;
           state.payments=Strict.mergeMonth(state.payments,accepted.filter(c=>c.kind==='PAYMENT'),month,false);
           state.bills=Strict.mergeMonth(state.bills,accepted.filter(c=>c.kind==='BILL'),month,false);
           state.messages=[...new Map([...state.messages,...summaries].map(m=>[m.id,m])).values()].slice(-2500);
           state.coverage={...state.coverage,[month]:{build:17,retrieved,cached,broadUsed,checkedIds:[...seen].slice(-10000),complete:false,scanned,accepted:accepted.length,skipped,unreadable,failed,reasons,updatedAt:new Date().toISOString(),includeUpdates}};
           await saveHistory();
         }
         el('syncStatus').textContent='Checked '+scanned+' emails for '+month+' · '+accepted.length+' financial matches';
         el('monthCoverage').textContent=el('syncStatus').textContent;
       }
       next=page.nextPageToken||null;
       if(next&&pages.has(next))throw Error('Repeated Gmail pagination token');
       if(next)pages.add(next);
     }while(next);
   }
   if(!active())return;
   const complete=failed===0&&unreadable===0&&retrieved>0;
   const retainUpdates=items=>items;
   const oldUpdatePayments=includeUpdates?[]:state.payments.filter(c=>c.evidenceLevel==='UPDATES_FULL'&&monthKey(c.date)===month);
   state.payments=Strict.mergeMonth(retainUpdates(state.payments),accepted.filter(c=>c.kind==='PAYMENT'),month,false);
   if(oldUpdatePayments.length)state.payments=Strict.mergePrimary(state.payments,oldUpdatePayments,'',false);
   const oldUpdateBills=includeUpdates?[]:state.bills.filter(c=>c.evidenceLevel==='UPDATES_FULL'&&monthKey(c.date)===month);
   state.bills=Strict.mergeMonth(retainUpdates(state.bills),accepted.filter(c=>c.kind==='BILL'),month,false);
   if(oldUpdateBills.length)state.bills=Strict.mergePrimary(state.bills,oldUpdateBills,'',false);
   state.messages=[...new Map([...state.messages,...summaries].map(m=>[m.id,m])).values()].slice(-2500);
   state.lastSync=new Date().toISOString();
   state.coverage={...state.coverage,[month]:{build:17,retrieved,cached,broadUsed,checkedIds:[...seen].slice(-10000),complete,scanned,accepted:accepted.length,skipped,unreadable,failed,reasons,updatedAt:state.lastSync,includeUpdates}};
   state.scanStats={scanned,accepted:accepted.length,skipped,unreadable,failed,reasons,completed:complete,month,elapsedMs:Date.now()-startedAt};
   setSyncPhase(complete?'COMPLETE':'PARTIAL');
   el('syncStatus').textContent=(complete?'Primary scan complete':'Partial scan')+' · '+month+' · '+retrieved+' emails retrieved · '+cached+' previously checked · '+accepted.length+' financial emails found';
   render();await saveHistory();toast('Month updated: '+accepted.length+' financial emails');
 }catch(err){
   if(!valid())return;
   if(err.name!=='AbortError'){if(active()){state.payments=Strict.mergeMonth(state.payments,accepted.filter(c=>c.kind==='PAYMENT'),month,false);state.bills=Strict.mergeMonth(state.bills,accepted.filter(c=>c.kind==='BILL'),month,false);state.coverage={...state.coverage,[month]:{build:17,retrieved,cached,broadUsed,checkedIds:[...seen].slice(-10000),complete:false,scanned,accepted:accepted.length,skipped,unreadable,failed,reasons,updatedAt:new Date().toISOString(),includeUpdates}};setSyncPhase('PARTIAL');render();await saveHistory();toast(err.message);return}setSyncPhase('ERROR');el('syncStatus').textContent=err.message;render();el('monthCoverage').textContent='Scan failed. Saved results retained. '+err.message;toast('Month scan failed: '+err.message)}
 }finally{
   if(valid()){state.controller=null;el('sync').disabled=state.phase!=='CONNECTED';render()}
 }
}
async function loadMail(append=false){
 if(state.mailPhase==='LOADING')return;
 if(state.phase!=='CONNECTED'){toast('Reconnect Gmail to search new messages');return}
 if(append&&!state.pageToken)return;
 setMailPhase('LOADING');
 const generation=state.generation, ctrl=new AbortController();
 try{
   const query='category:primary -category:promotions -category:social -category:updates -category:forums '+state.mailQuery;
   let path='messages?maxResults=25&q='+encodeURIComponent(query);
   if(append)path+='&pageToken='+encodeURIComponent(state.pageToken);
   const page=await api(path,ctrl.signal);
   const data=await Promise.allSettled((page.messages||[]).map(m=>
     api('messages/'+encodeURIComponent(m.id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date',ctrl.signal)));
   if(generation!==state.generation)return;
   const parsed=data.filter(x=>x.status==='fulfilled').map(x=>parseMessage(x.value)).filter(m=>Strict.isPrimary(m.labelIds));
   // Inbox search results are ephemeral: do not persist previews or unrelated Primary emails.
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
async function showMail(m){
 if(state.phase!=='CONNECTED'){toast('Reconnect Gmail to view full message');return}
 el('dialogTitle').textContent=m.subject;
 el('dialogMeta').textContent=m.sender+' · '+new Date(m.date).toLocaleString();
 el('dialogText').textContent='Reading full message…';
 el('mailDialog').showModal();
 try{
   const raw=await api('messages/'+encodeURIComponent(m.id)+'?format=full');
   const full=Strict.parseGmailFull(raw);
   el('dialogText').textContent=full?full.body.slice(0,45000):'This email is not available in Primary or has no readable text body.';
 }catch(err){el('dialogText').textContent='Unable to open message: '+err.message}
}
function statusLabel(status){
 return ({REVIEW:'Needs review',PAID:'Paid (you confirmed)',DUE:'Due / unpaid (you marked)',IGNORED:'Ignored'})[E.normalizeStatus(status)]||'Needs review';
}
function reviewCandidate(c,next){
 try{c.status=E.reviewTransition(E.normalizeStatus(c.status),next)}
 catch(err){toast(err.message);return}
 c.reviewedAt=new Date().toISOString();
 state.payments=Strict.reconcileDuplicates(state.payments);state.bills=Strict.reconcileDuplicates(state.bills);render();saveHistory();
}
function itemCard(c){
 const node=document.createElement('details');
 node.className='transaction-row';node.dataset.review=E.normalizeStatus(c.status);
 const status=E.normalizeStatus(c.status);
 const statusText=status==='PAID'?'You marked paid':status==='DUE'?'You marked due':
   status==='IGNORED'?'Ignored':c.kind==='BILL'?'Bill notice':
   c.possibleDuplicateOf?'Duplicate · not counted':c.confidence==='HIGH'?'Email reports completed':'Needs review';
 const top=document.createElement('summary');
 const title=document.createElement('div');title.className='transaction-title';
 const merchant=document.createElement('strong');merchant.textContent=c.merchant;
 const meta=document.createElement('small');meta.textContent=(c.kind==='BILL'?(c.dueDate?'Due '+c.dueDate:'Due date unknown'):(c.transactionDate||Strict.dateKey(c.date)))+' · '+(c.category||'Other');
 title.append(merchant,meta);
 const right=document.createElement('div');right.className='transaction-number';
 const amount=document.createElement('strong');amount.textContent=money(c.amount,c.currency);
 const label=document.createElement('small');label.textContent=statusText;
 if(status==='DUE')label.className='badge-warn';
 right.append(amount,label);top.append(title,right);
 const body=document.createElement('div');body.className='expanded-details';
 const explanation=document.createElement('p');
 explanation.textContent=c.reviewSuggestion||c.evidence||'Email-based estimate: verify in your account';
 const proof=document.createElement('p');
 proof.textContent='Why this was included: '+(c.evidence||'Full email content')+'. Evidence: '+(c.source||'Not available');
 const subject=document.createElement('p');subject.textContent='Email: '+c.subject;
 body.append(explanation,proof,subject);
 if(c.dueDate){const due=document.createElement('p');due.textContent='Due date mentioned: '+c.dueDate;body.append(due)}
 if(c.possibleDuplicateOf){
   const other=state.payments.find(x=>x.key===c.possibleDuplicateOf)||state.bills.find(x=>x.key===c.possibleDuplicateOf);
   const dup=document.createElement('p');dup.textContent=(c.duplicateConfirmed==='yes'?'Confirmed duplicate of ':'Possible duplicate of ')+(other?.merchant||'another payment')+' · '+money(c.amount,c.currency)+'. '+(c.duplicateReason||'Matching payment evidence')+'. Counted once until you decide.';body.append(dup);
   if(other){const pairActions=document.createElement('div');pairActions.className='actions';
     for(const [decision,text] of [['same','Same payment — keep one'],['distinct','Separate payments — count both']]){
       const btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent=text;btn.onclick=()=>{
         c.duplicateDecision=decision+'|'+[c.key,other.key].sort().join('|');
         state.payments=Strict.reconcileDuplicates(state.payments);state.bills=Strict.reconcileDuplicates(state.bills);
         render();saveHistory();toast(decision==='same'?'Duplicate confirmed. Counted once.':'Both payments will be counted.');
       };pairActions.append(btn);
     }
     const source=document.createElement('button');source.type='button';source.className='secondary';source.textContent='Open matching email';source.onclick=()=>window.open('https://mail.google.com/mail/?authuser='+encodeURIComponent(state.email||'')+'#all/'+encodeURIComponent(other.messageId),'_blank','noopener,noreferrer');pairActions.append(source);body.append(pairActions);
   }
 }
 const actions=document.createElement('div');actions.className='actions';
 if(c.duplicateDecision){const undo=document.createElement('button');undo.type='button';undo.className='secondary';undo.textContent='Reset duplicate decision';undo.onclick=()=>{c.duplicateDecision=null;state.payments=Strict.reconcileDuplicates(state.payments);state.bills=Strict.reconcileDuplicates(state.bills);render();saveHistory()};actions.append(undo)}
 for(const [next,text] of [['PAID','I paid this'],['DUE','Still due / unpaid'],['IGNORED','Not mine / ignore'],['REVIEW','Undo my decision']]){
   if(status===next)continue;
   const btn=document.createElement('button');btn.className='secondary';btn.type='button';btn.textContent=text;
   btn.onclick=()=>reviewCandidate(c,next);actions.append(btn);
 }
 const link=document.createElement('button');link.className='secondary';link.type='button';link.textContent='Open original email';
 link.onclick=()=>window.open('https://mail.google.com/mail/?authuser='+
    encodeURIComponent(state.email||'')+'#all/'+encodeURIComponent(c.messageId),'_blank','noopener,noreferrer');
 actions.append(link);body.append(actions);node.append(top,body);
 return node;
}
function paymentEligible(c){
 return Number(c.analysisVersion)===5&&c.kind==='PAYMENT'&&c.signal!=='CARD_REPAYMENT'&&
 (c.confidence==='HIGH'||E.normalizeStatus(c.status)==='PAID')&&
 !['IGNORED','DUE'].includes(E.normalizeStatus(c.status))&&!c.possibleDuplicateOf;
}
function compactRow(c){
 const node=document.createElement('button');node.type='button';node.className='clean-row';
 const left=document.createElement('span');left.className='clean-main';
 const merchant=document.createElement('strong');merchant.textContent=c.merchant;
 const meta=document.createElement('small');meta.textContent=new Date(c.date).toLocaleDateString()+' · Receipt evidence';
 left.append(merchant,meta);
 const right=document.createElement('span');
 const amt=document.createElement('div');amt.className='clean-amount';amt.textContent=money(c.amount,c.currency);
 const badge=document.createElement('div');badge.className='clean-badge';badge.textContent=E.normalizeStatus(c.status)==='PAID'?'You confirmed paid':'Email reports completed';
 right.append(amt,badge);node.append(left,right);
 node.onclick=()=>{el('paymentStatusFilter').value='clear';route('payments')};
 return node;
}

function moneyList(items,status){
 const sums={};
 for(const item of items.filter(c=>E.normalizeStatus(c.status)===status)){
   sums[item.currency||'USD']=(sums[item.currency||'USD']||0)+item.amount;
 }
 return Object.entries(sums).map(([currency,total])=>money(total,currency)).join(' + ')||'$0.00';
}
let timelineFilter='ALL';
function model(){return Strict.monthlyModel(state.payments.filter(c=>state.includeUpdates||c.evidenceLevel!=='UPDATES_FULL'),state.bills.filter(c=>state.includeUpdates||c.evidenceLevel!=='UPDATES_FULL'),state.selectedMonth,Strict.dateKey(new Date()))}
function sumItems(items){const totals={};for(const c of items)totals[c.currency]=(totals[c.currency]||0)+c.amount;return Object.entries(totals).map(([cur,n])=>money(n,cur)).join(' + ')||'$0.00'}
function timeline(node,entries,filter='ALL'){
 node.replaceChildren();
 const list=entries.filter(c=>filter==='ALL'||c.bucket===filter);
 if(!list.length){node.className='empty';node.textContent='No matching records for this month.';return}
 node.className='month-timeline';
 const groups=new Map();for(const c of list){if(!groups.has(c.timelineDate))groups.set(c.timelineDate,[]);groups.get(c.timelineDate).push(c)}
 for(const [date,rows] of groups){
   const section=document.createElement('section');section.className='timeline-day';
   const title=document.createElement('div');title.className='timeline-date';
   const day=document.createElement('strong');day.textContent=date?new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}):'Date unknown';
   const sub=document.createElement('small');sub.textContent=[['MADE','Made'],['DUE','Due'],['EXPECTED','Expected']].filter(([k])=>rows.some(c=>c.bucket===k)).map(([k,label])=>label+' '+sumItems(rows.filter(c=>c.bucket===k))).join(' · ');title.append(day,sub);section.append(title);
   for(const c of rows){
     const card=document.createElement('details');card.className='timeline-record clean-row';card.dataset.bucket=c.bucket;
     const head=document.createElement('summary');const left=document.createElement('span');left.className='clean-main';
     const merchant=document.createElement('strong');merchant.textContent=c.merchant;const tag=document.createElement('small');
     tag.textContent=c.bucket==='MADE'?'Made · email evidence':c.bucket==='DUE'?(c.dueDate?(c.dueDate<Strict.dateKey(new Date())?'Past due date · verify':'Due · check status'):'Bill · date unknown'):'Expected · estimate';
     left.append(merchant,tag);const amt=document.createElement('strong');amt.className='clean-amount';amt.textContent=money(c.amount,c.currency);head.append(left,amt);card.append(head);
     const body=document.createElement('div');body.className='expanded-details';
     const evidence=document.createElement('p');evidence.textContent=c.forecast?c.evidence:(c.subject||'')+' · '+(c.reviewSuggestion||c.evidence||'Check original email');
     body.append(evidence);
     if(c.forecast){const p=document.createElement('p');p.textContent='Based on previous monthly receipts. Not an invoice or a confirmed obligation.';body.append(p)}
     else {const original=[...state.payments,...state.bills].find(x=>x.key===c.key);if(original)body.append(itemCard(original))}
     card.append(body);section.append(card);
   }node.append(section);
 }
}
function render(){
 const m=model(),current=state.selectedMonth;
 el('dashboardMonth').value=current;el('dashboardMonth').max=monthKey(new Date());
 el('dashboardMonth').disabled=state.syncPhase==='RUNNING';el('includeUpdates').checked=state.includeUpdates;el('includeUpdates').disabled=state.syncPhase==='RUNNING';
 el('scanMonth').disabled=state.syncPhase==='RUNNING';
 el('monthTotal').textContent=sumItems(m.made);el('dueTotal').textContent=sumItems(m.due);el('expectedTotal').textContent=sumItems(m.expected);
 el('paidHint').textContent=m.made.length+' payment receipts · not bank verified';
 el('monthLabel').textContent=new Date(current+'-01T12:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'});
 el('paymentCount').textContent=String(m.made.length);el('billCount').textContent=m.due.length+' notices to check';el('expectedCount').textContent=m.expected.length+' estimates';
 const coverage=state.coverage[current];
 el('scanOutcome').textContent=coverage?.retrieved===0?'Gmail returned no messages for this month, even with date-only discovery. Check the connected account and month.':coverage?.cached>0&&coverage.scanned===0?'No new emails to read. Previously checked emails and saved financial results remain.':coverage&&coverage.scanned>0&&coverage.accepted===0?'Emails were retrieved, but none qualified as payment evidence. Open the scan explanation.':'';
 const audit=el('scanAudit');audit.hidden=!coverage?.reasons;const reasonNode=el('scanReasons');reasonNode.replaceChildren();
 for(const [reason,count] of Object.entries(coverage?.reasons||{}).sort((a,b)=>b[1]-a[1])){const row=document.createElement('p');row.textContent=reason+' · '+count;reasonNode.append(row)}
 if(state.syncPhase!=='RUNNING')el('monthCoverage').textContent=coverage&&coverage.includeUpdates===state.includeUpdates?(coverage.complete?'Scan complete':'Partial scan')+' · '+(coverage.retrieved??coverage.scanned)+' emails found · '+(coverage.cached||0)+' previously checked · '+coverage.scanned+' newly checked · '+(coverage.accepted??0)+' financial matches · '+(coverage.skipped??0)+' excluded · '+new Date(coverage.updatedAt).toLocaleDateString()+(coverage.includeUpdates?' · Primary + financial Updates':' · Primary only'):'This month has not been fully scanned. Tap Scan month.';
 const uncertain=[...state.payments,...state.bills].filter(c=>(state.includeUpdates||c.evidenceLevel!=='UPDATES_FULL')&&monthKey(c.date)===current&&c.status==='REVIEW'&&(c.confidence!=='HIGH'||(c.possibleDuplicateOf&&c.duplicateConfirmed!=='yes')));
 el('reviewNudge').hidden=!uncertain.length;el('reviewNudgeCount').textContent=String(uncertain.length);
 timeline(el('recent'),m.entries,timelineFilter);
 const select=el('monthSelect');select.replaceChildren(new Option(el('monthLabel').textContent,current));select.value=current;
 renderPayments();renderBills();
 el('dueSummary').textContent=m.due.length?sumItems(m.due)+' · '+m.due.length+' notices (verify unpaid status)':'No pending notices for this month.';
 const notice=el('legacyNotice');
 notice.hidden=!state.legacy.length;
 if(state.legacy.length)notice.textContent=state.legacy.length+' old subject-only matches are hidden for accuracy. Reconnect and scan Primary again.';
 const info=el('scanDetails');
 if(state.scanStats){
   const st=state.scanStats;
   info.textContent='Full email analysis · '+st.scanned+' candidate emails checked · '+st.skipped+' unrelated excluded'+
     (st.failed||st.unreadable?' · '+(st.failed+st.unreadable)+' not fully read':'')+
     '';
 }else info.textContent=state.lastSync?'Last scan saved; only Primary full-email matches are shown.':'Primary-only · full email text analyzed locally · no attachments';
 updateStorageBanner();
}
function renderBills(){
 const selected=el('billStatusFilter')?.value||'pending';
 const node=el('billList');node.replaceChildren();
 const items=[...state.bills.filter(c=>state.includeUpdates||c.evidenceLevel!=='UPDATES_FULL'),...state.payments.filter(c=>c.status==='DUE')].filter(c=>(c.dueDate?c.dueDate.slice(0,7):monthKey(c.date))===state.selectedMonth);
 if(selected==='pending'){
   const now=new Date();const today=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
   const groups=Strict.pendingGroups(items,today);
   for(const [key,label] of [['overdue','Past due date · check payment'],['upcoming','Upcoming due dates'],['unknown','Due date unknown']]){
     if(!groups[key].length)continue;
     const heading=document.createElement('h3');heading.className='pending-heading';heading.textContent=label+' ('+groups[key].length+')';node.append(heading);
     groups[key].forEach(c=>node.append(itemCard(c)));
   }
 }else items.filter(c=>selected==='all'||E.normalizeStatus(c.status)===selected).sort((a,b)=>b.date.localeCompare(a.date)).forEach(c=>node.append(itemCard(c)));
 node.className=node.children.length?'':'empty';
 if(!node.children.length)node.textContent='No matching payment notices from Primary.';
}
function renderPayments(){
 const query=el('paymentSearch').value.toLowerCase(),month=el('monthSelect').value;
 const status=el('paymentStatusFilter')?.value||'clear';
 const source=status==='needs-attention'?[...state.payments,...state.bills]:state.payments;
 const list=source.filter(c=>(state.includeUpdates||c.evidenceLevel!=='UPDATES_FULL')&&(month==='all'||(c.transactionDate||Strict.dateKey(c.date)).slice(0,7)===month)&&
   (c.merchant+' '+c.subject).toLowerCase().includes(query)&&
   (status==='clear'?paymentEligible(c):
     status==='needs-attention'?E.normalizeStatus(c.status)==='REVIEW'&&(c.confidence!=='HIGH'||(c.possibleDuplicateOf&&c.duplicateConfirmed!=='yes')):
     status==='duplicates'?Boolean(c.possibleDuplicateOf||c.duplicateDecision):status==='repayment'?c.signal==='CARD_REPAYMENT':status==='all'?true:E.normalizeStatus(c.status)===status));
 el('confirmedTotal').textContent=moneyList(state.payments.filter(c=>c.analysisVersion===5&&!c.possibleDuplicateOf),'PAID');
 const node=el('paymentList');node.replaceChildren();
 if(!list.length){
   node.className='empty';node.textContent=status==='clear'?'No clear payment receipts in this view. Uncertain emails are kept separately.':
     status==='needs-attention'?'Nothing uncertain needs your attention.':'No transactions match this selection.';
 }else{node.className='';let last='';for(const c of list){const day=Strict.dateKey(c.date);if(day!==last){const heading=document.createElement('h3');heading.className='pending-heading';heading.textContent=day;node.append(heading);last=day}node.append(itemCard(c))}}
}

function openBreakdown(filter='ALL'){
 const m=model();el('breakdownTitle').textContent='Monthly breakdown · '+el('monthLabel').textContent;
 el('breakdownCaption').textContent='Made is email evidence; due is a notice to check; expected is an estimate, not a confirmed bill.';
 const metrics=el('breakdownMetrics');metrics.replaceChildren();
 for(const [name,list] of [['Made',m.made],['Due',m.due],['Expected',m.expected]]){
  const tile=document.createElement('div');tile.className='breakdown-tile';const label=document.createElement('span');label.textContent=name;const value=document.createElement('strong');value.textContent=sumItems(list);tile.append(label,value);metrics.append(tile);
 }
 const cats=el('breakdownCategories');cats.replaceChildren();
 const totals=new Map();for(const c of m.made){const key=c.category+'|'+c.currency;totals.set(key,(totals.get(key)||0)+c.amount)}
 for(const [key,n] of [...totals].sort((a,b)=>b[1]-a[1])){const row=document.createElement('div');row.className='breakdown-item';const label=document.createElement('span');const [cat,cur]=key.split('|');label.textContent=cat;const value=document.createElement('strong');value.textContent=money(n,cur);row.append(label,value);cats.append(row)}
 if(!totals.size)cats.textContent='No completed payment categories yet.';
 timeline(el('breakdownItems'),m.entries,typeof filter==='string'?filter:'ALL');
 el('breakdownFooter').textContent='Datewise amounts are grouped by receipt date, bill due date or estimated recurring date. Check source emails before relying on totals.';
 if(!el('breakdownDialog').open)el('breakdownDialog').showModal();
}
el('dashboardMonth').onchange=()=>{if(state.syncPhase==='RUNNING')return;const month=el('dashboardMonth').value;try{Strict.monthBounds(month)}catch{return}state.selectedMonth=month;timelineFilter='ALL';render();saveHistory()};
el('includeUpdates').onchange=()=>{if(state.syncPhase==='RUNNING')return;state.includeUpdates=el('includeUpdates').checked;render();saveHistory();if(backendAvailable&&state.email){localStorage.removeItem('ledgermail.bgCursor.'+state.email);pullBackgroundMail()}};
el('scanMonth').onclick=syncFinancial;
el('dueTile').onclick=()=>openBreakdown('DUE');
el('expectedTile').onclick=()=>openBreakdown('EXPECTED');
el('timelineAll').onclick=()=>openBreakdown('ALL');
document.querySelectorAll('[data-timeline]').forEach(b=>b.onclick=()=>{timelineFilter=b.dataset.timeline;document.querySelectorAll('[data-timeline]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));timeline(el('recent'),model().entries,timelineFilter)});
el('reviewNudge').onclick=()=>{el('paymentStatusFilter').value='needs-attention';renderPayments();route('payments')};
el('paymentSearch').oninput=renderPayments;
el('monthSelect').onchange=renderPayments;
el('paymentStatusFilter').onchange=renderPayments;
el('billStatusFilter').onchange=renderBills;
el('spendingHero').onclick=()=>openBreakdown('MADE');
el('spendingHero').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openBreakdown('MADE')}};
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
 state.generation++;state.controller?.abort();state.controller=null;
 if(state.syncPhase!=='IDLE')setSyncPhase('IDLE');
 if(state.mailPhase!=='IDLE')setMailPhase('IDLE');
 try{
   await Store.remove(account);
   state.messages=[];state.payments=[];state.bills=[];state.legacy=[];state.scanStats=null;state.coverage={};state.lastSync=null;
   render();toast('Saved history deleted for '+account);
 }catch(err){toast('Cannot delete saved history: '+err.message)}
};
el('sync').onclick=syncFinancial;
el('rescanMonth').onclick=()=>{if(state.syncPhase==='RUNNING'){toast('A scan is already running');return}if(state.phase!=='CONNECTED'){toast('Connect Gmail first');return}delete state.coverage[state.selectedMonth];syncFinancial().catch(err=>toast(err.message))};
el('searchMail').onclick=()=>{state.mailQuery=el('mailSearch').value.trim();state.pageToken=null;loadMail(false)};
el('mailSearch').onkeydown=e=>{if(e.key==='Enter')el('searchMail').click()};
el('loadMore').onclick=()=>loadMail(true);
el('closeDialog').onclick=()=>el('mailDialog').close();
el('exportBackup').onclick=()=>{
 if(!state.email){toast('No selected Gmail history to export');return}
 setBackupPhase('EXPORTING');
 try{
   const json=JSON.stringify({...Store.snapshot(getAccountRecord()),backupType:'LedgerMail-v4'});
   const blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob);
   const link=document.createElement('a');link.href=url;
   link.download='LedgerMail-'+state.email.replace(/[^a-z0-9.-]/gi,'_')+'-'+new Date().toISOString().slice(0,10)+'.json';
   link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
   setBackupPhase('DONE');
   toast('Backup includes sensitive financial details. Keep it private.');
 }catch(err){setBackupPhase('ERROR');toast('Export failed: '+err.message)}
};
el('importBackup').onclick=()=>el('backupFile').click();
el('backupFile').onchange=async()=>{
 const file=el('backupFile').files?.[0];el('backupFile').value='';
 if(!file)return;
 if(file.size>12_000_000){toast('Backup exceeds 12 MB limit');return}
 setBackupPhase('READING');
 try{
   const raw=JSON.parse(await file.text());
   setBackupPhase('VALIDATING');
   if(![4,5].includes(Number(raw.version))||!raw.email)throw Error('Not a LedgerMail v4 or v5 backup');
   const record=Store.snapshot(raw);
   if(!confirm('Restore financial history for '+record.email+'? It will replace saved records for that account.')){
     setBackupPhase('IDLE');return;
   }
   setBackupPhase('WRITING');
   if(state.phase==='CONNECTED')disconnect();
   await Store.write(record);await Store.setLastEmail(record.email);
   applyAccount(record,record.email);setPhase('DISCONNECTED');
   setBackupPhase('DONE');toast('Local history restored. Reconnect Gmail for new messages.');
 }catch(err){setBackupPhase('ERROR');toast('Backup restore failed: '+err.message)}
};
el('clientId').value=getClientId();
document.body.dataset.section='dashboard';document.querySelector('.nav.active')?.setAttribute('aria-current','page');
setPhase('DISCONNECTED');render();

async function refreshBackendSession(){
 let res;try{res=await fetch(MAIL_BACKEND+'?action=session',{credentials:'same-origin',cache:'no-store'})}catch{return}
 if(res.status===503){backendAvailable=false;return}
 backendAvailable=true;if(res.status===401)return;if(!res.ok)return;
 const session=await res.json(),email=String(session.email||'').toLowerCase();if(!email)return;
 if(state.phase==='CONNECTED'&&state.email===email){await pullBackgroundMail();return}
 const g=++state.generation;state.controller?.abort();state.controller=null;
 if(state.phase==='CONNECTED')setPhase('DISCONNECTED');
 setPhase('CONNECTING');setPhase('VERIFYING');
 if(state.email!==email){if(state.storagePhase!=='ERROR')await loadAccount(email,g);else applyAccount(null,email)}
 if(g!==state.generation)return;
 state.email=email;state.token='SERVER_SESSION';state.expiresAt=Number.MAX_SAFE_INTEGER;
 setPhase('CONNECTED');el('syncStatus').textContent='Gmail background sync connected';
 await pullBackgroundMail();
}
async function pullBackgroundMail(){
 if(!backendAvailable||state.phase!=='CONNECTED'||state.syncPhase==='RUNNING'||backgroundBusy)return;
 backgroundBusy=true;const email=state.email,g=state.generation,key='ledgermail.bgCursor.'+email;
 try{
  const cursor=localStorage.getItem(key)||'';
  const r=await fetch(MAIL_BACKEND+'?action=changes&limit=25'+(cursor?'&since='+encodeURIComponent(cursor):''),{credentials:'same-origin',cache:'no-store'});
  if(!r.ok)throw Error('Background results temporarily unavailable');
  const data=await r.json();if(email!==state.email||g!==state.generation)return;
  const payments=[],bills=[],summaries=[];let maxSeq=Number(cursor)||0;
  for(const raw of data.messages||[]){
   maxSeq=Math.max(maxSeq,Number(raw._lmSeq)||0);
   if(!(Strict.isPrimary(raw.labelIds)||(state.includeUpdates&&Strict.isFinancialUpdate(raw.labelIds))))continue;
   const m=Strict.parseGmailFull(raw,state.includeUpdates);if(!m)continue;
   const inspected=Strict.inspectEvidence(m,state.includeUpdates);
   const c=Strict.structuredReceipt(m,state.includeUpdates)||Strict.classifyFullMail(m,state.includeUpdates)||inspected.candidate;
   if(!c||c.confidence!=='HIGH')continue;
   if(c.kind==='PAYMENT')payments.push(c);else if(c.kind==='BILL')bills.push(c);
   summaries.push({id:m.id,threadId:m.threadId,subject:m.subject,sender:m.sender,date:m.date,snippet:'Financial email analyzed locally',labelIds:m.labels});
  }
  state.payments=Strict.mergePrimary(state.payments,payments,'',false);
  state.bills=Strict.mergePrimary(state.bills,bills,'',false);
  state.messages=[...new Map([...state.messages,...summaries].map(m=>[m.id,m])).values()].slice(-2500);
  if(summaries.length){state.lastSync=new Date().toISOString();await saveHistory();render()}
  if(state.storagePhase!=='ERROR'&&maxSeq>Number(cursor))localStorage.setItem(key,String(maxSeq));
  if(data.hasMore)setTimeout(()=>pullBackgroundMail(),1500);
  el('syncStatus').textContent=data.lastError?'Background sync issue: '+data.lastError:'Background sync active'+(data.lastSync?' · last checked '+new Date(data.lastSync).toLocaleString():'');
 }catch(e){el('syncStatus').textContent='Automatic sync retries: '+e.message}
 finally{backgroundBusy=false}
}

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
initializeLocalHistory().then(()=>refreshBackendSession());
setInterval(()=>{if(!document.hidden)pullBackgroundMail()},90000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshBackendSession()});
let updatingRelease=false;
async function checkRelease(manual=false){
 if(updatingRelease)return true;
 if(!('serviceWorker' in navigator)||location.protocol!=='https:')return false;
 const label=el('runtimeBuild');
 try{
   const result=await fetch('./release.json?ts='+Date.now(),{cache:'no-store'});
   if(!result.ok)throw Error('Release check unavailable');
   const release=await result.json();
   if(Number(release.build)>APP_BUILD){
     updatingRelease=true;
     if(label)label.textContent='Updating to Build '+release.build+'…';
     // Bypass old navigation cache with a new URL; do not erase account data.
     const registrations=await navigator.serviceWorker.getRegistrations();
     await Promise.allSettled(registrations.map(r=>r.update()));
     await saveHistory();
     location.replace('./?build='+release.build);
     return true;
   }
   if(label)label.textContent='Running Build '+APP_BUILD+' · latest version confirmed';
   if(manual)toast('LedgerMail is up to date: Build '+APP_BUILD);
 }catch{
   if(label)label.textContent='Running Build '+APP_BUILD+' · online version check unavailable';
   if(manual)toast('Could not check for updates. Saved history remains.');
 }
 return false;
}
el('checkUpdate').onclick=()=>{if(state.syncPhase==='RUNNING'){toast('Finish the current scan before updating');return}checkRelease(true)};
if('serviceWorker'in navigator&&location.protocol==='https:'){
 navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});
 navigator.serviceWorker.addEventListener('message',event=>{
   if(event.data?.type==='LEDGERMAIL_RELEASE'&&Number(event.data.build)>APP_BUILD&&state.syncPhase!=='RUNNING')checkRelease(false);
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.syncPhase!=='RUNNING')checkRelease(false)});
 window.addEventListener('pageshow',()=>{if(state.syncPhase!=='RUNNING')checkRelease(false)});
}


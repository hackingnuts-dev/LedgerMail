/* LedgerMail local-first storage. Gmail credentials are NEVER persisted.
   Origin-scoped IndexedDB stores one account's financial message summaries per record. */
(function(root){
'use strict';
const DB_NAME='ledgermail-local-v4',SCHEMA=1,ACCOUNTS='accounts',META='meta';
let dbPromise=null,writeTail=Promise.resolve();
function normalizedEmail(email){const e=String(email||'').trim().toLowerCase();if(e.length>254||!e.includes('@')||e.includes(' '))throw new Error('Invalid Gmail account identifier');return e}
function snapshot(data){
 if(!data||typeof data!=='object')throw new Error('Invalid history data');
 const email=normalizedEmail(data.email);
 const cleanMessage=m=>({
   id:String(m.id||'').slice(0,150),threadId:String(m.threadId||'').slice(0,150),
   subject:String(m.subject||'').slice(0,400),sender:String(m.sender||'').slice(0,250),
   date:String(m.date||'').slice(0,35),snippet:String(m.snippet||'').slice(0,650),labelIds:(Array.isArray(m.labelIds)?m.labelIds:[]).slice(0,18).map(String)
 });
 const cleanCandidate=c=>{
   const x={};
   for(const key of ['key','messageId','merchant','subject','date','transactionDate','currency','category','kind','status','evidence','source','dueDate','possibleDuplicateOf','reviewedAt','suggestedStatus','reviewSuggestion','signal','evidenceLevel','reference','confidence','why']){
     const value=c[key];x[key]=value==null?null:String(value).slice(0,key==='source'?650:450);
   }
   x.analysisVersion=Number(c.analysisVersion)||0;
   x.amount=Number(c.amount)||0;
   if(!Number.isFinite(x.amount)||x.amount<0||x.amount>1e9)throw new Error('Invalid amount in history data');
   return x;
 };
 const messages=(Array.isArray(data.messages)?data.messages:[]).slice(-2500).filter(m=>m&&m.id).map(cleanMessage);
 const payments=(Array.isArray(data.payments)?data.payments:[]).filter(c=>c&&c.key).map(cleanCandidate);
 const bills=(Array.isArray(data.bills)?data.bills:[]).filter(c=>c&&c.key).map(cleanCandidate);
 const legacy=(Array.isArray(data.legacy)?data.legacy:[]).slice(0,500).map(cleanCandidate);
 return {version:5,email,updatedAt:new Date().toISOString(),lastSync:String(data.lastSync||'').slice(0,35),
    messages,payments,bills,legacy,selectedMonth:/^\d{4}-(0[1-9]|1[0-2])$/.test(data.selectedMonth||'')?data.selectedMonth:null,includeUpdates:data.includeUpdates===true,coverage:Object.fromEntries(Object.entries(data.coverage||{}).filter(([k,v])=>/^\d{4}-(0[1-9]|1[0-2])$/.test(k)&&v&&typeof v==='object').map(([k,v])=>[k,{build:Number(v.build)||0,complete:v.complete===true,scanned:Number(v.scanned)||0,accepted:Number(v.accepted)||0,skipped:Number(v.skipped)||0,unreadable:Number(v.unreadable)||0,failed:Number(v.failed)||0,reasons:Object.fromEntries(Object.entries(v.reasons||{}).filter(([k,n])=>typeof n==='number'&&Number.isFinite(n)).slice(0,30)),updatedAt:String(v.updatedAt||'').slice(0,35),includeUpdates:v.includeUpdates===true}]))};
}
function db(){
 if(dbPromise)return dbPromise;
 if(!('indexedDB' in root))return Promise.reject(new Error('IndexedDB is unavailable. Private browsing may prevent saved history.'));
 dbPromise=new Promise((resolve,reject)=>{
   const req=indexedDB.open(DB_NAME,SCHEMA);
   req.onupgradeneeded=()=>{
     const instance=req.result;
     if(!instance.objectStoreNames.contains(ACCOUNTS))instance.createObjectStore(ACCOUNTS,{keyPath:'email'});
     if(!instance.objectStoreNames.contains(META))instance.createObjectStore(META);
   };
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error||new Error('Cannot open local history storage'));
   req.onblocked=()=>reject(new Error('Another LedgerMail tab is blocking storage updates'));
 }).catch(err=>{dbPromise=null;throw err});
 return dbPromise;
}
async function read(email){
 const instance=await db(),id=normalizedEmail(email);
 return new Promise((resolve,reject)=>{
   const t=instance.transaction(ACCOUNTS,'readonly');
   const q=t.objectStore(ACCOUNTS).get(id);
   q.onsuccess=()=>resolve(q.result||null);
   q.onerror=()=>reject(q.error||new Error('Cannot read saved account'));
 });
}
async function write(input){
 const record=snapshot(input);
 writeTail=writeTail.catch(()=>{}).then(async()=>{
   const instance=await db();
   return new Promise((resolve,reject)=>{
     const tx=instance.transaction(ACCOUNTS,'readwrite');
     tx.objectStore(ACCOUNTS).put(record);
     tx.oncomplete=()=>resolve(record);
     tx.onerror=()=>reject(tx.error||new Error('Cannot save financial history'));
     tx.onabort=()=>reject(tx.error||new Error('Financial history storage aborted'));
   });
 });
 return writeTail;
}
async function remove(email){
 await writeTail.catch(()=>{});
 const instance=await db(),id=normalizedEmail(email);
 return new Promise((resolve,reject)=>{
   const tx=instance.transaction(ACCOUNTS,'readwrite');
   tx.objectStore(ACCOUNTS).delete(id);
   tx.oncomplete=()=>resolve();
   tx.onerror=()=>reject(tx.error||new Error('Cannot delete local history'));
 });
}
async function getLastEmail(){
 const instance=await db();
 return new Promise((resolve,reject)=>{
   const t=instance.transaction(META,'readonly'),q=t.objectStore(META).get('lastEmail');
   q.onsuccess=()=>resolve(q.result||null);
   q.onerror=()=>reject(q.error||new Error('Cannot read last account'));
 });
}
async function setLastEmail(email){
 const instance=await db();
 return new Promise((resolve,reject)=>{
   const t=instance.transaction(META,'readwrite');
   if(email)t.objectStore(META).put(normalizedEmail(email),'lastEmail');
   else t.objectStore(META).delete('lastEmail');
   t.oncomplete=()=>resolve();
   t.onerror=()=>reject(t.error||new Error('Cannot remember selected account'));
 });
}
const API={snapshot,read,write,remove,getLastEmail,setLastEmail};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
root.LedgerStore=API;
})(typeof window!=='undefined'?window:globalThis);

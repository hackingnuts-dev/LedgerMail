import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';

const html=fs.readFileSync('web/index.html','utf8');
const scripts=['strict.js','engine.js','store.js','quota.js','app.js'].map(f=>fs.readFileSync('web/'+f,'utf8')).map(code=>code.replace('gmailNext=Date.now()+2100','gmailNext=Date.now()+1').replace('Math.max(65000,Number.isFinite(wait)?wait:0,Math.min(120000,65000*Math.pow(1.3,attempt)))','Math.max(10,Number.isFinite(wait)?wait:0)'));
const b64=s=>Buffer.from(s,'utf8').toString('base64url');
const full=(id,subject,body,labels=['INBOX','CATEGORY_PERSONAL'])=>({
 id,threadId:id,labelIds:labels,internalDate:String(Date.now()),
 payload:{mimeType:'text/plain',headers:[
  {name:'Subject',value:subject},
  {name:'From',value:'Acme Billing <billing@acme.example>'},
  {name:'To',value:'qa@gmail.com'}
 ],body:{data:b64(body),size:body.length}}
});
const messages={
 fallback:full('fallback','Bank account transaction','Your account has been debited by Rs. 1,500.00'),
 update:full('update','Your Example Legal receipt [#1018-8509]','Receipt number 1018-8509\nPayment method: Visa ending 4242\nTotal: 42.00 USD',['CATEGORY_UPDATES']),
 receipt:full('receipt','Your purchase receipt','Your card was charged $285.00. Payment completed.'),
 ad:full('ad','Limited time sale $999','Payment completed for promotional example. Save up to $999.00. Shop now. Unsubscribe.',['CATEGORY_PROMOTIONS']),
 otp:full('otp','OTP for your credit card transaction','Your transaction OTP 123123 for an amount of $899.00. Do not share it.'),
 bill:full('bill','Monthly statement available','Amount due: $160.25\nPayment due date: '+new Date().toLocaleDateString('en-US')+''),
 junk:full('junk','Save $100 today','Use coupon SAVE100 to get $100.00 off your next purchase')
};
const dom=new JSDOM(html,{url:'https://ledgermail-finance.netlify.app/',runScripts:'outside-only'});
const w=dom.window;
w.matchMedia=()=>({matches:true,addListener:()=>{},removeListener:()=>{}});
w.indexedDB=indexedDB;w.scrollTo=()=>{};w.confirm=()=>true;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.localStorage.setItem('ledgermail.clientId','123456-example.apps.googleusercontent.com');
const calls=[];let profileAttempts=0,searchAttempts=0;
w.fetch=async(url,opts)=>{
 const u=new URL(url);calls.push(u.toString());
 if(u.hostname==='openidconnect.googleapis.com'){profileAttempts++;return {ok:true,json:async()=>({email:'qa@gmail.com',email_verified:true})}}
 if(u.pathname.endsWith('/profile'))throw new Error('Login must not use Gmail quota');
 if(u.pathname.endsWith('/messages')){
   searchAttempts++;if(searchAttempts===1)return {ok:false,status:403,headers:{get:()=>null},json:async()=>({error:{message:'Quota exceeded for Units per minute per user'}})};
   assert.equal(u.searchParams.get('labelIds'),null);
   const combined=u.searchParams.get('q').includes('category:updates');
   assert(u.searchParams.get('q').includes('category:primary'));
   assert(!u.searchParams.get('q').includes('in:anywhere'));
   assert(u.searchParams.get('q').includes('after:'));assert(u.searchParams.get('q').includes('before:'));
   return {ok:true,json:async()=>u.searchParams.get('pageToken')?({messages:['bill','junk'].map(id=>({id}))}):({messages:['receipt','ad','otp','fallback',...(combined?['update']:[])].map(id=>({id})),nextPageToken:'page2'})};
 }
 const id=u.pathname.match(/\/messages\/([^/]+)$/)?.[1];
 assert.equal(u.searchParams.get('format'),'full','all financial parsing must inspect full message body');
 if(!id||!messages[id])throw new Error('Unexpected Gmail call '+u);
 return {ok:true,json:async()=>messages[id]};
};
w.google={accounts:{oauth2:{
 initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'test-scope-token',expires_in:3500})}),
 hasGrantedAllScopes:()=>true
}}};
for(const code of scripts)w.eval(code);
const wait=()=>new Promise(r=>setTimeout(r,35));
for(let i=0;i<20;i++){await wait();if(w.document.getElementById('localSaveStatus').textContent.includes('Ready to save'))break}
w.document.getElementById('connect').click();
for(let i=0;i<30;i++){await wait();if(w.document.getElementById('authStatus').textContent.includes('Connected:'))break}
assert.equal(searchAttempts,0,'no automatic Gmail scan during login');
w.document.getElementById('scanMonth').click();
for(let i=0;i<95;i++){await wait();const t=w.document.getElementById('syncStatus').textContent;if(t.includes('Primary scan complete')||t.includes('Partial scan'))break}
const d=w.document;
assert.equal(profileAttempts,1,'identity verified outside Gmail quota');
assert(searchAttempts>=3,'quota-limited search retried');
assert(d.getElementById('syncStatus').textContent.includes('Primary scan complete'),d.getElementById('syncStatus').textContent);
assert(d.getElementById('monthTotal').textContent.includes('$285.00'),'clear Primary USD purchase counted');
assert(d.getElementById('monthTotal').textContent.includes('1,500'),'localized amount recovered');
assert.equal(d.getElementById('paymentCount').textContent,'2');
assert.equal(d.getElementById('billCount').textContent,'1 notices to check');
assert(!d.getElementById('recent').textContent.includes('$899.00'),'OTP excluded');
assert(!d.getElementById('recent').textContent.includes('$999.00'),'promotion excluded');
assert(calls.some(x=>x.includes('pageToken=page2')));
assert(calls.some(x=>x.includes('format=full')),'Gmail full-format API used');
assert(calls.every(x=>!x.includes('format=metadata')),'finance scan must not use metadata mode');
await new Promise(r=>setTimeout(r,140));
const saved=await w.LedgerStore.read('qa@gmail.com');
assert.equal(saved.payments.length,2);
assert(Object.keys(saved.coverage)[0]);
assert(Object.values(saved.coverage)[0].reasons['Strong financial evidence']>=2);
assert.equal(saved.bills.length,1);
assert(!JSON.stringify(saved).includes('test-scope-token'),'OAuth tokens never persisted');
assert(!JSON.stringify(saved).includes('Your card was charged $285.00. Payment completed.'),'entire body not persisted');
d.getElementById('includeUpdates').checked=true;d.getElementById('includeUpdates').dispatchEvent(new w.Event('change',{bubbles:true}));
d.getElementById('scanMonth').click();
for(let i=0;i<95;i++){await wait();if(d.getElementById('monthTotal').textContent.includes('$327.00'))break}
assert(d.getElementById('monthTotal').textContent.includes('$327.00'),'opt-in Updates receipt included');
dom.window.close();
console.log('Full-format Primary-only scan integration passed; promotion/OTP excluded, bill separated, private snapshot saved.');

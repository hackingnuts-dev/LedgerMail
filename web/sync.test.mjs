import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';

const html=fs.readFileSync('web/index.html','utf8');
const scripts=['strict.js','engine.js','store.js','app.js'].map(f=>fs.readFileSync('web/'+f,'utf8'));
const b64=s=>Buffer.from(s,'utf8').toString('base64url');
const full=(id,subject,body,labels=['CATEGORY_PRIMARY'])=>({
 id,threadId:id,labelIds:labels,internalDate:String(Date.now()),
 payload:{mimeType:'text/plain',headers:[
  {name:'Subject',value:subject},
  {name:'From',value:'Acme Billing <billing@acme.example>'},
  {name:'To',value:'qa@gmail.com'}
 ],body:{data:b64(body),size:body.length}}
});
const messages={
 receipt:full('receipt','Your purchase receipt','Your card was charged $285.00. Payment completed.'),
 ad:full('ad','Limited time sale $999','Payment completed for promotional example. Save up to $999.00. Shop now. Unsubscribe.',['CATEGORY_PROMOTIONS']),
 otp:full('otp','OTP for your credit card transaction','Your transaction OTP 123123 for an amount of $899.00. Do not share it.'),
 bill:full('bill','Monthly statement available','Amount due: $160.25\nPayment due date: 12/15/2026'),
 junk:full('junk','Save $100 today','Use coupon SAVE100 to get $100.00 off your next purchase')
};
const dom=new JSDOM(html,{url:'https://ledgermail-finance.netlify.app/',runScripts:'outside-only'});
const w=dom.window;
w.matchMedia=()=>({matches:true,addListener:()=>{},removeListener:()=>{}});
w.indexedDB=indexedDB;w.scrollTo=()=>{};w.confirm=()=>true;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.localStorage.setItem('ledgermail.clientId','123456-example.apps.googleusercontent.com');
const calls=[];
w.fetch=async(url,opts)=>{
 const u=new URL(url);calls.push(u.toString());
 if(u.pathname.endsWith('/profile'))return {ok:true,json:async()=>({emailAddress:'qa@gmail.com'})};
 if(u.pathname.endsWith('/messages')){
   assert.equal(u.searchParams.get('labelIds'),'CATEGORY_PRIMARY');
   assert(u.searchParams.get('q').includes('category:primary'));
   assert(!u.searchParams.get('q').includes('in:anywhere'));
   return {ok:true,json:async()=>({messages:Object.keys(messages).map(id=>({id}))})};
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
for(let i=0;i<95;i++){await wait();const t=w.document.getElementById('syncStatus').textContent;if(t.includes('Primary scan complete')||t.includes('Partial scan'))break}
const d=w.document;
assert(d.getElementById('syncStatus').textContent.includes('Primary scan complete'),d.getElementById('syncStatus').textContent);
assert.equal(d.getElementById('monthTotal').textContent,'$285.00','only clear Primary purchase is counted');
assert.equal(d.getElementById('paymentCount').textContent,'1');
assert.equal(d.getElementById('billCount').textContent,'1');
assert(!d.getElementById('recent').textContent.includes('$899.00'),'OTP excluded');
assert(!d.getElementById('recent').textContent.includes('$999.00'),'promotion excluded');
assert(calls.some(x=>x.includes('format=full')),'Gmail full-format API used');
assert(calls.every(x=>!x.includes('format=metadata')),'finance scan must not use metadata mode');
await new Promise(r=>setTimeout(r,140));
const saved=await w.LedgerStore.read('qa@gmail.com');
assert.equal(saved.payments.length,1);
assert.equal(saved.bills.length,1);
assert(!JSON.stringify(saved).includes('test-scope-token'),'OAuth tokens never persisted');
assert(!JSON.stringify(saved).includes('Your card was charged $285.00. Payment completed.'),'entire body not persisted');
dom.window.close();
console.log('Full-format Primary-only scan integration passed; promotion/OTP excluded, bill separated, private snapshot saved.');

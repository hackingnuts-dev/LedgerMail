import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';

const html=fs.readFileSync('web/index.html','utf8');
const code=['engine.js','store.js','app.js'].map(f=>fs.readFileSync('web/'+f,'utf8'));
const wait=()=>new Promise(r=>setTimeout(r,45));
function openApp(){
 const dom=new JSDOM(html,{url:'https://ledgermail-finance.netlify.app/',runScripts:'outside-only'});
 const w=dom.window;
 w.matchMedia=()=>({matches:true,addListener:()=>{},removeListener:()=>{}});
 w.indexedDB=indexedDB;
 w.scrollTo=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.confirm=()=>true;
 for(const script of code)w.eval(script);
 return dom;
}
async function test(){
 let first=openApp();await wait();
 const s=first.window.LedgerStore;
 assert.equal(first.window.document.getElementById('localSaveStatus').textContent.includes('Ready to save'),true);
 const example={email:'qa-one@gmail.com',lastSync:'2026-11-23T18:00:00Z',messages:[
   {id:'m1',threadId:'t1',subject:'Receipt for November',sender:'Sharma Law Associates',date:'2026-11-08T14:00:00Z',snippet:'Paid $285.00'}
 ],payments:[{key:'m1',messageId:'m1',merchant:'Sharma Law Associates LLC',subject:'Payment receipt',date:'2026-11-08T14:00:00Z',
 amount:285,currency:'USD',category:'Other',kind:'PAYMENT',status:'REVIEW',evidence:'Payment receipt',source:'Paid $285.00'}],bills:[]};
 await s.write(example);await s.setLastEmail('qa-one@gmail.com');
 first.window.close();
 let second=openApp();await wait();
 let doc=second.window.document;
 assert.equal(doc.getElementById('monthTotal').textContent,'$285.00','reloaded candidate amount must persist');
 assert.equal(doc.getElementById('paymentCount').textContent,'1','reloaded payment must persist');
 assert.ok(doc.getElementById('accountBanner').textContent.includes('qa-one@gmail.com'),'must display account-specific saved history');
 doc.getElementById('spendingHero').click();
 assert.equal(doc.getElementById('breakdownDialog').open,true,'monthly amount opens breakdown');
 assert.ok(doc.getElementById('breakdownItems').textContent.includes('Sharma Law'),'breakdown explains amount');
 doc.getElementById('closeBreakdown').click();
 const mark=[...doc.querySelectorAll('#recent button')].find(x=>x.textContent==='Mark paid');
 assert(mark,'mark paid button should be present');
 mark.click();await wait();
 assert.ok(doc.getElementById('paidHint').textContent.includes('$285.00'),'paid total should update');
 const paymentsTab=doc.querySelector('nav [data-route="payments"]');
 paymentsTab.click();
 assert.equal(doc.getElementById('payments').classList.contains('active'),true,'payments route must be active');
 const paymentFilter=doc.getElementById('paymentStatusFilter');
 paymentFilter.value='PAID';paymentFilter.dispatchEvent(new second.window.Event('change',{bubbles:true}));
 assert.ok(doc.getElementById('paymentList').textContent.includes('Sharma Law'),'paid filter should show reviewed paid candidate');
 paymentFilter.value='DUE';paymentFilter.dispatchEvent(new second.window.Event('change',{bubbles:true}));
 assert.ok(doc.getElementById('paymentList').textContent.includes('No payment candidates match'),'due filter must not show paid candidates');
 doc.querySelector('nav [data-route="bills"]').click();
 assert.ok(doc.getElementById('bills').classList.contains('active'),'bills navigation must work');
 doc.getElementById('billStatusFilter').value='DUE';
 doc.getElementById('billStatusFilter').dispatchEvent(new second.window.Event('change',{bubbles:true}));
 assert.ok(doc.getElementById('billList').textContent.includes('No bills match'),'due bill filter works when empty');
 doc.querySelector('nav [data-route="dashboard"]').click();
 assert.ok(doc.getElementById('dashboard').classList.contains('active'));
 const saved=await second.window.LedgerStore.read('qa-one@gmail.com');
 assert.equal(saved.payments[0].status,'PAID','review status must persist to IndexedDB');
 second.window.close();
 const third=openApp();await wait();
 doc=third.window.document;
 assert.ok(doc.getElementById('paidHint').textContent.includes('$285.00'),'paid status must survive relaunch');
 assert.ok(doc.getElementById('authStatus').textContent.includes('Saved history'),'saved records visible while disconnected');
 await third.window.LedgerStore.write({...example,email:'qa-two@gmail.com',payments:[{...example.payments[0],key:'other',messageId:'other',amount:44}]});
 await third.window.LedgerStore.setLastEmail('qa-two@gmail.com');
 third.window.close();
 const fourth=openApp();await wait();
 doc=fourth.window.document;
 assert.equal(doc.getElementById('monthTotal').textContent,'$44.00','account snapshots must remain separate');
 assert.ok(!doc.getElementById('accountBanner').textContent.includes('qa-one@gmail.com'));
 fourth.window.close();
 console.log('Passed PWA relaunch, account isolation, monthly drilldown, paid review persistence and offline history integration tests.');
}
await test();

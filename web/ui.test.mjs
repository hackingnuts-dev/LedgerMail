import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';

const html=fs.readFileSync('web/index.html','utf8');
const code=['strict.js','engine.js','store.js','quota.js','app.js'].map(f=>fs.readFileSync('web/'+f,'utf8'));
const wait=()=>new Promise(r=>setTimeout(r,65));
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
const now=new Date().toISOString(),month=now.slice(0,7);
const receipt={key:'real1',messageId:'real1',merchant:'Sharma Law Associates LLC',
 subject:'Payment receipt',date:now,amount:285,currency:'USD',category:'Other',
 kind:'PAYMENT',status:'REVIEW',confidence:'HIGH',signal:'COMPLETION_EMAIL',evidenceLevel:'PRIMARY_FULL',
 analysisVersion:5,evidence:'Payment amount tied to completed wording',
 reviewSuggestion:'Email reports completed',source:'Total paid $285',dueDate:null};
const uncertain={...receipt,key:'uncertain1',messageId:'uncertain1',amount:90,confidence:'REVIEW',source:'Possible receipt'};
const legacy={...receipt,key:'old-noise',messageId:'old-noise',amount:20000,analysisVersion:4,evidenceLevel:null,confidence:null};
async function go(){
 const first=openApp();await wait();
 const store=first.window.LedgerStore;
 await store.write({email:'one@gmail.com',messages:[],payments:[receipt,uncertain,legacy],bills:[],lastSync:now});
 await store.setLastEmail('one@gmail.com');first.window.close();
 const second=openApp();await wait();
 let d=second.window.document;
 assert.equal(d.getElementById('monthTotal').textContent,'$285.00','main dashboard counts only high-confidence full-message receipts');
 assert.equal(d.getElementById('paymentCount').textContent,'1','do not count weak or old matches');
 assert.ok(d.getElementById('legacyNotice').textContent.includes('1 old'),'old noise hidden and explained');
 assert.ok(d.getElementById('reviewNudge').textContent.includes('1'),'uncertain items separated');
 assert.equal(d.querySelectorAll('#recent .clean-row').length,1,'dashboard has short clean feed');
 d.getElementById('spendingHero').click();
 assert(d.getElementById('breakdownDialog').open);
 assert(d.getElementById('breakdownItems').textContent.includes('Sharma Law'));
 assert(!d.getElementById('breakdownItems').textContent.includes('$90.00'),'uncertain amount not included in breakdown');
 d.getElementById('closeBreakdown').click();
 d.querySelector('nav [data-route="payments"]').click();
 assert.equal(d.getElementById('paymentStatusFilter').value,'clear');
 assert.equal(d.querySelectorAll('#paymentList details').length,1,'only one clear payment shown');
 const item=d.querySelector('#paymentList details');item.querySelector('summary').click();
 const mark=[...item.querySelectorAll('button')].find(b=>b.textContent==='I paid this');
 assert(mark);
 mark.click();await wait();
 const saved=await second.window.LedgerStore.read('one@gmail.com');
 assert.equal(saved.payments.find(c=>c.key==='real1').status,'PAID');
 assert.equal(saved.legacy.length,1,'archive noisy prior records');
 d.getElementById('paymentStatusFilter').value='needs-attention';
 d.getElementById('paymentStatusFilter').dispatchEvent(new second.window.Event('change',{bubbles:true}));
 assert.equal(d.querySelectorAll('#paymentList details').length,1,'uncertain item available when requested');
 assert(d.getElementById('paymentList').textContent.includes('$90.00'));
 second.window.close();
 const third=openApp();await wait();d=third.window.document;
 assert.equal(d.getElementById('monthTotal').textContent,'$285.00','strong transaction remains after app relaunch');
 assert(d.getElementById('authStatus').textContent.includes('Saved history'));
 await third.window.LedgerStore.write({email:'two@gmail.com',payments:[{...receipt,key:'acct2',amount:44}],bills:[],messages:[]});
 await third.window.LedgerStore.setLastEmail('two@gmail.com');
 third.window.close();
 const fourth=openApp();await wait();
 assert.equal(fourth.window.document.getElementById('monthTotal').textContent,'$44.00','accounts stay isolated');
 fourth.window.close();
 console.log('Calm dashboard, old-noise quarantine, full-body totals, review filtering, and relaunch persistence passed');
}
await go();

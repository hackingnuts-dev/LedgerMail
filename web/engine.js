/* LedgerMail v4 finance engine: deterministic, side-effect-free functions and explicit state guards. */
(function(root){
'use strict';
const STATES=Object.freeze({
 auth:{DISCONNECTED:['CONNECTING','DISCONNECTED'],CONNECTING:['VERIFYING','ERROR','DISCONNECTED'],VERIFYING:['CONNECTED','ERROR','DISCONNECTED','EXPIRED'],CONNECTED:['EXPIRED','DISCONNECTED','CONNECTING'],EXPIRED:['CONNECTING','DISCONNECTED','ERROR'],ERROR:['CONNECTING','DISCONNECTED']},
 sync:{IDLE:['RUNNING','IDLE'],RUNNING:['COMPLETE','PARTIAL','ERROR','IDLE'],COMPLETE:['RUNNING','IDLE'],PARTIAL:['RUNNING','IDLE'],ERROR:['RUNNING','IDLE']},
 storage:{BOOTING:['LOADING','ERROR'],LOADING:['READY','ERROR'],READY:['LOADING','SAVING','ERROR'],SAVING:['READY','ERROR','SAVING'],ERROR:['LOADING','ERROR']},
 navigation:Object.fromEntries(['dashboard','payments','bills','inbox','settings'].map(k=>[k,['dashboard','payments','bills','inbox','settings']])),
 inbox:{IDLE:['LOADING','IDLE'],LOADING:['READY','ERROR','IDLE'],READY:['LOADING','IDLE'],ERROR:['LOADING','IDLE']},
 backup:{IDLE:['EXPORTING','READING','IDLE'],EXPORTING:['DONE','ERROR'],READING:['VALIDATING','ERROR'],VALIDATING:['WRITING','ERROR'],WRITING:['DONE','ERROR'],DONE:['IDLE','READING','EXPORTING'],ERROR:['IDLE','READING','EXPORTING']}
});
const REVIEW_STATES=['REVIEW','PAID','DUE','IGNORED'];
const REVIEW_TRANSITIONS={
 REVIEW:['PAID','DUE','IGNORED','REVIEW'],
 PAID:['REVIEW','DUE','IGNORED','PAID'],
 DUE:['PAID','REVIEW','IGNORED','DUE'],
 IGNORED:['REVIEW','PAID','DUE','IGNORED']
};
function transition(kind,from,to){
 const allowed=STATES[kind]?.[from];
 if(!allowed || !allowed.includes(to))throw new Error('Illegal '+kind+' transition: '+from+' -> '+to);
 return to;
}
function reviewTransition(from,to){
 if(!REVIEW_TRANSITIONS[from]?.includes(to))throw new Error('Illegal review transition: '+from+' -> '+to);
 return to;
}
function normalizeStatus(value){
 return ({CONFIRMED:'PAID',UNPAID:'DUE',UNREVIEWED:'REVIEW',PAID:'PAID',DUE:'DUE',IGNORED:'IGNORED',REVIEW:'REVIEW'})[value]||'REVIEW';
}
const BLOCKED=/\b(otp|one[- ]time (password|passcode|code)|verification code|security code|verify your (identity|login)|login attempt|sign[- ]in code|password reset|fraud alert|transaction alert verification)\b/i;
const BILL=/(statement (available|ready|is here)|billing statement|bill (available|ready|due)|amount due|minimum (payment|due)|payment due|due date|total due|upcoming payment|payment reminder|invoice due|outstanding balance)/i;
const CONFIRMED_PAYMENT=/(payment (received|successful|completed|processed|confirmed|made)|you (paid|spent|sent)|paid (successfully|in full)|autopay (processed|complete)|receipt (for|from|#)|purchase (confirmed|completed)|order (paid|completed)|card (charged|debited)|account (debited|charged)|transfer (completed|sent)|charge (posted|confirmed))/i;
const RECEIPT=/(payment|purchase|receipt|paid|charged|debited|spent|order confirmed|transaction completed|transfer complete)/i;
const PAID_PROOF=/\b(payment (received|successful|completed|processed|confirmed)|paid successfully|we received your payment|thank you for (your )?payment|card was charged|purchase was completed)\b/i;
const DUE_SIGNAL=/\b(amount due|minimum (amount )?(payment|due)|payment due|total due|outstanding balance|payment reminder)\b/i;
const AMOUNT=/(?:USD\s*|US\$\s*|\$\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/gi;
const INR=/(?:INR\s*|₹\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/gi;
const GBP=/(?:GBP\s*|£\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/gi;
function hits(text,regex,currency){
 const copy=new RegExp(regex.source,regex.flags);return [...String(text).matchAll(copy)].map(m=>({amount:Number(m[1].replaceAll(',','')),currency,pos:m.index??0})).filter(x=>x.amount>0&&Number.isFinite(x.amount)&&x.amount<1e9);
}
function moneyHit(text,kind){
 const all=[...hits(text,AMOUNT,'USD'),...hits(text,INR,'INR'),...hits(text,GBP,'GBP')].sort((a,b)=>a.pos-b.pos);
 if(!all.length)return null;
 const contextual=kind==='BILL' ? /(amount due|minimum due|total due|payment due|bill due)/i : /(payment (of|received|successful|completed)|total paid|paid|charged|purchase (of|total)|order total|amount (debited|paid))/i;
 for(const h of all){
   const vicinity=text.slice(Math.max(0,h.pos-57),h.pos);
   if(contextual.test(vicinity))return h;
 }
 return all[0];
}
function category(text){
 const t=String(text).toLowerCase();
 if(/restaurant|doordash|ubereats|grubhub|coffee|grocery|walmart|costco|whole foods|instacart/.test(t))return'Food & groceries';
 if(/uber|lyft|transit|parking|fuel|gas station|airline|flight/.test(t))return'Transport';
 if(/netflix|spotify|youtube premium|subscription|apple\.com\/bill|prime membership/.test(t))return'Subscriptions';
 if(/electric|utility|internet|wireless|water bill|rent|mortgage/.test(t))return'Utilities & home';
 if(/amazon|target|best buy|order confirmed/.test(t))return'Shopping';
 return'Other';
}
function dueDate(text,yearHint){
 const match=String(text).match(/(?:payment )?due(?: date)?(?: is|:| on| by)?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?)/i);
 if(!match)return null;
 const candidate=match[1];
 let d=new Date(candidate);
 if(!Number.isFinite(d.getTime()))return null;
 if(!/\d{4}/.test(candidate)&&Number.isInteger(yearHint)){
   d=new Date(d);d.setFullYear(yearHint);
 }
 return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;
}
function parseEmail(m){
 if(!m?.id)return null;
 const text=(m.subject||'')+' '+(m.snippet||'');
 if(BLOCKED.test(text))return null;
 const bill=BILL.test(text);
 const payment=CONFIRMED_PAYMENT.test(text)||(!bill&&RECEIPT.test(text));
 if(!bill&&!payment)return null;
 const kind=bill?'BILL':'PAYMENT';
 const hit=moneyHit(text,kind);
 if(!hit)return null;
 const date=new Date(m.date||0);
 if(!Number.isFinite(date.getTime()))return null;
 const amount=Math.round(hit.amount*100)/100;
 return {
   key:String(m.id),messageId:String(m.id),
   merchant:String(m.sender||'Unknown').split('<')[0].trim().slice(0,70)||'Unknown sender',
   subject:String(m.subject||'(No subject)'),date:date.toISOString(),
   amount,currency:hit.currency,category:category(text),kind,
   status:'REVIEW',suggestedStatus:kind==='BILL'?(DUE_SIGNAL.test(text)?'POSSIBLY_DUE':'STATEMENT_ONLY'):(PAID_PROOF.test(text)?'LIKELY_PAID':'PURCHASE_UNVERIFIED'),
   reviewSuggestion:kind==='BILL'?(DUE_SIGNAL.test(text)?'Email mentions an amount due. Check whether a later payment settled it.':'Statement received. Payment status unknown.'):
     (PAID_PROOF.test(text)?'Email claims payment completed. Confirm against your account.':'A purchase or receipt was detected. Check whether it settled.'),
   evidence:kind==='BILL'?'Bill/statement email — payment status unverified':
       PAID_PROOF.test(text)?'Payment-confirmation wording detected':'Possible purchase or receipt',
   source:String(m.snippet||'').slice(0,650),
   dueDate:kind==='BILL'?dueDate(text,date.getUTCFullYear()):null
 };
}
function dedupe(candidates){
 const seen=new Map();
 return candidates.map(c=>{
   const day=String(c.date).slice(0,10);
   const key=[c.kind,c.merchant.toLowerCase().replace(/\W/g,''),c.currency,c.amount,day].join('|');
   const first=seen.get(key);
   if(!first)seen.set(key,c.key);
   return {...c,possibleDuplicateOf:first&&first!==c.key?first:null};
 });
}
function mergeCandidates(old,parsed){
 const existing=new Map((old||[]).map(c=>[c.key,c]));
 const map=new Map();
 for(const c of [...(old||[]),...(parsed||[])]){
   const prior=existing.get(c.key);
   const status=prior?normalizeStatus(prior.status):normalizeStatus(c.status);
   map.set(c.key,{...c,status,reviewedAt:prior?.reviewedAt||null});
 }
 return dedupe([...map.values()].sort((a,b)=>b.date.localeCompare(a.date)));
}
function summary(candidates,month){
 const filtered=(candidates||[]).filter(c=>c.kind==='PAYMENT'&&String(c.date).slice(0,7)===month&&normalizeStatus(c.status)!=='IGNORED');
 const unique=filtered.filter(c=>!c.possibleDuplicateOf||normalizeStatus(c.status)==='PAID');
 const grouped={};
 for(const c of unique){
   const currency=c.currency||'USD';
   if(!grouped[currency])grouped[currency]={detected:0,paid:0,due:0,review:0,count:0};
   const g=grouped[currency];
   g.detected+=c.amount;g.count++;
   const status=normalizeStatus(c.status);
   if(status==='PAID')g.paid+=c.amount;
   else if(status==='DUE')g.due+=c.amount;
   else g.review+=c.amount;
 }
 return {month,groups:grouped,items:unique,possibleDuplicateCount:filtered.length-unique.length,
   all:filtered,reviewCount:unique.filter(c=>normalizeStatus(c.status)==='REVIEW').length};
}
function billSummary(bills){
 const due=(bills||[]).filter(c=>normalizeStatus(c.status)==='DUE');
 const overdue=due.filter(c=>c.dueDate && c.dueDate<new Date().toISOString().slice(0,10));
 return {due,overdue,count:due.length,review:(bills||[]).filter(c=>normalizeStatus(c.status)==='REVIEW').length};
}
const API={STATES,REVIEW_STATES,transition,reviewTransition,normalizeStatus,parseEmail,dedupe,mergeCandidates,summary,billSummary,category};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
root.LedgerEngine=API;
})(typeof window!=='undefined'?window:globalThis);

/* LedgerMail transaction evidence classifier v5.
 * Process user-authorized Gmail Primary messages only. Full MIME body in memory;
 * persist only concise explanations, never the entire body or OAuth tokens. */
(function(root){
'use strict';
// Primary is selected by Gmail search; some Primary messages have no category label.
const CATEGORY_EXCLUDED=new Set(['CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','CATEGORY_UPDATES','CATEGORY_FORUMS','SPAM','TRASH','DRAFT','SENT']);
const PRIMARY_QUERY='category:primary newer_than:90d {receipt "payment" "debited" "charged" "purchase" "order" "statement" "bill" "transaction" "invoice"} -category:promotions -category:social -category:updates -category:forums -in:spam -in:trash';
function isPrimary(labels){
 const set=new Set(Array.isArray(labels)?labels:[]);
 return Array.isArray(labels)&&![...set].some(x=>CATEGORY_EXCLUDED.has(x));
}
function decodeData(data){
 if(!data)return '';
 const base=String(data).replace(/-/g,'+').replace(/_/g,'/').replace(/\s/g,'');
 const padded=base+'='.repeat((4-base.length%4)%4);
 try{
   const binary=(typeof atob==='function'?atob(padded):Buffer.from(padded,'base64').toString('binary'));
   const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   if(typeof TextDecoder!=='undefined')return new TextDecoder('utf-8',{fatal:false}).decode(bytes);
   if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('utf8');
   return binary;
 }catch{return ''}
}
function htmlToText(html){
 const clean=String(html).replace(/<(script|style|noscript|svg|head|iframe|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
 .replace(/<\s*br\s*\/?\s*>/gi,'\n')
 .replace(/<\/?\s*(?:div|p|tr|table|section|article|h[1-6]|li)\b[^>]*>/gi,'\n').replace(/<\/?\s*(?:td|th)\b[^>]*>/gi,' ');
 if(typeof DOMParser!=='undefined'){
   const doc=new DOMParser().parseFromString(clean,'text/html');
   return doc.body?.textContent||'';
 }
 return clean.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function mimeBodies(part,collection){
 if(!part||collection.depth>20)return;
 collection.depth++;
 const mime=String(part.mimeType||'').toLowerCase();
 const headers=Object.fromEntries((part.headers||[]).map(h=>[String(h.name).toLowerCase(),String(h.value)]));
 const attached=Boolean(part.filename)||/attachment/i.test(headers['content-disposition']||'');
 if(!attached&&part.body?.data){
   if(mime==='text/plain')collection.plain.push(decodeData(part.body.data));
   else if(mime==='text/html')collection.html.push(decodeData(part.body.data));
 }
 for(const child of part.parts||[])mimeBodies(child,collection);
 collection.depth--;
}
function parseGmailFull(raw){
 if(!raw?.id||!isPrimary(raw.labelIds))return null;
 const h=Object.fromEntries((raw.payload?.headers||[]).map(x=>[String(x.name||'').toLowerCase(),String(x.value||'')]));
 const bucket={plain:[],html:[],depth:0};
 mimeBodies(raw.payload,bucket);
 const plain=bucket.plain.filter(Boolean).join('\n').trim();
 const body=plain||htmlToText(bucket.html.join('\n')).trim();
 // Fail closed: snippet is never used as a substitute for the full body.
 if(!body)return null;
 const dateValue=Number(raw.internalDate);
 const d=new Date(Number.isFinite(dateValue)&&dateValue>0?dateValue:Date.parse(h.date||''));
 if(!Number.isFinite(d.getTime()))return null;
 return {
   id:String(raw.id),threadId:String(raw.threadId||raw.id),
   date:d.toISOString(),sender:h.from||'Unknown sender',
   recipient:h.to||'',subject:h.subject||'(No subject)',
   body,labels:raw.labelIds||[],headers:h
 };
}
function currencyAmounts(text){
 const re=/(USD\s*|US\$\s*|\$\s*|INR\s*|₹\s*|GBP\s*|£\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?!\d)/gi;
 const a=[];
 for(const m of String(text).matchAll(re)){
   const currency=/₹|INR/i.test(m[1])?'INR':/£|GBP/i.test(m[1])?'GBP':'USD';
   const amount=Number(m[2].replace(/,/g,''));
   if(amount>0&&Number.isFinite(amount)&&amount<1e8)a.push({amount,currency,start:m.index,end:(m.index||0)+m[0].length});
 }
 return a;
}
const OTP=/\b(otp|one[- ]time (passcode|password|code)|verification code|security code|transaction otp|your code to|authorize (the|your) transaction|verify (the|your) transaction|card verification|password reset)\b/i;
const PROMO_SUBJECT=/\b(offer|offers|coupon|deal|deals|sale|savings|cashback offer|shop now|save (up to|big|\d)|extra \d+%|discount|newsletter|black friday|promotion|reward points|special promotion|advertisement|sponsored|limited time)\b/i;
const PROMO_BODY=/\b(unlock (an? )?offer|shop now|claim your|exclusive offer|limited[- ]time|save (up to|\d+\s*%)|use (this )?promo code|coupon code|buy now|offer ends|apply now to get|pre[- ]approved offer)\b/i;
const INCOMING=/\b(refund (issued|processed|received)|credit (posted|received)|cashback earned|you received|you have received|deposit received|funds (added|received)|rewards earned)\b/i;
const TRANSFER=/\b(transfer between your accounts|internal transfer|moved money between|credit card payment received|payment (to|towards) (your )?credit card|autopay for your (credit )?card)\b/i;
const COMPLETED=/\b(payment (received|successful|completed|processed|confirmed)|transaction (successful|completed|approved)|charge (posted|confirmed)|purchase (completed|approved)|order (paid|completed)|you (paid|spent|were charged)|we (charged|debited) (your|the)|card (was|has been) (charged|debited)|account (was|has been) debited|we received your payment|thank you for your (payment|purchase)|amount (has been )?(debited|charged)|paid (in full|successfully))\b/i;
const BILL=/\b(statement (ready|available|is ready|is available)|bill (due|ready|available)|billing statement|amount due|total due|minimum payment due|payment due date|due date|outstanding balance|invoice due|payment reminder|bill for)\b/i;
const SUBJECT_RECEIPT=/\b(receipt|payment confirmation|paid invoice|purchase confirmation|order confirmation|transaction completed)\b/i;
const AMOUNT_CONTEXT=/\b(total (paid|charged|debited|amount|due)|grand total|order total|receipt total|transaction amount|purchase amount|payment amount|amount (paid|charged|debited|deducted|due)|you (paid|spent)|was charged|card charged|charged to|payment of|paid:|paid on|purchase total)\b/i;
const BILL_CONTEXT=/\b(amount due|total due|balance due|minimum (amount )?due|minimum payment|payment due|bill amount|total outstanding|invoice amount)\b/i;
const DISCOUNT_CONTEXT=/\b(discount|save|savings|cashback|reward|points|coupon|off (your|on|today)|offer|credit limit|available credit|bonus|promo)\b/i;
const HEADER_MARKETING=/list[- ]unsubscribe|marketing/i;
function trimQuoted(body){
 // Restrict classification to the fresh message, not old quoted thread history.
 const cutoff=/\n\s*(?:On .{4,90} wrote:|-----Original Message-----|Begin forwarded message:|From:\s+.{3,90}\nSent:|Unsubscribe(?: here)?\s*(?:\n|$))/i;
 const m=cutoff.exec(body);
 return (m?body.slice(0,m.index):body).replace(/\r/g,'').replace(/[\t ]+/g,' ').trim();
}
function contextAt(text,position){
 const start=Math.max(0,position-95),end=Math.min(text.length,position+95);
 return text.slice(start,end).replace(/\s+/g,' ').trim();
}
function transactionReference(text){
 const m=String(text).match(/\b(?:transaction (?:id|ref(?:erence)?)|order (?:number|no\.?|#)|receipt (?:number|no\.?|#)|confirmation (?:number|#))\s*[:#-]?\s*([A-Z0-9-]{5,32})\b/i);
 return m?.[1]?.toUpperCase()||null;
}
function classifyFullMail(email){
 if(!email||!isPrimary(email.labels)||!email.body)return null;
 const subject=String(email.subject||'').trim(),body=trimQuoted(email.body),lead=body.slice(0,1300);
 const intro=(subject+'\n'+lead);
 if(OTP.test(subject)||OTP.test(lead.slice(0,650)))return null;
 if(PROMO_SUBJECT.test(subject))return null;
 const hasStrong=COMPLETED.test(subject+' '+body.slice(0,4500));
 const bill=BILL.test(subject+' '+body.slice(0,4500));
 if(!hasStrong&&!bill&&!SUBJECT_RECEIPT.test(subject))return null;
 if(PROMO_BODY.test(lead)&&(!SUBJECT_RECEIPT.test(subject)||!hasStrong||Boolean(email.headers?.['list-unsubscribe'])))return null;
 if(INCOMING.test(subject+' '+lead)&&!/(purchase|payment (made|completed)|you paid)/i.test(intro))return null;
 if(TRANSFER.test(intro))return null;
 if(HEADER_MARKETING.test(email.headers?.['list-unsubscribe']?'list-unsubscribe':'')&&PROMO_BODY.test(lead)&&!hasStrong)return null;
 const kind=bill&&(!hasStrong||BILL_CONTEXT.test(lead))?'BILL':'PAYMENT';
 const money=currencyAmounts(body);
 if(!money.length)return null;
 const candidates=[];
 for(const m of money){
   const ctx=contextAt(body,m.start);
   // Score the amount's own line first. Nearby subtotal/discount rows are not payment totals.
   const start=body.lastIndexOf('\n',m.start)+1, endAt=body.indexOf('\n',m.end);
   const line=body.slice(start,endAt<0?body.length:endAt).trim();
   const pre=body.slice(Math.max(start,m.start-82),m.start);
   const near=body.slice(Math.max(start,m.start-82),Math.min(line.length+start,m.end+30));
   const direct=kind==='BILL'?BILL_CONTEXT.test(pre+' '+line):AMOUNT_CONTEXT.test(pre+' '+line);
   const event=kind==='BILL'?BILL.test(line):COMPLETED.test(line);
   const discount=DISCOUNT_CONTEXT.test(line);
   let score=(direct?6:0)+(event?3:0)+(kind==='PAYMENT'&&SUBJECT_RECEIPT.test(subject)?2:0);
   if(/\b(total paid|grand total|total charged|amount paid|payment amount|amount debited|amount due|balance due)\b/i.test(pre))score+=5;
   if(/\b(subtotal|estimated|tax|shipping|item total)\b/i.test(pre))score-=9;
   if(discount)score-=9;
   if(m.start>12000)score-=2;
   if(score>0)candidates.push({...m,score,ctx,direct,event});
 }
 if(!candidates.length)return null;
 candidates.sort((a,b)=>b.score-a.score||a.start-b.start);
 const hit=candidates[0];
 if(hit.score<5)return null; // Abstain rather than invent a transaction from an amount.
 const strong=hit.score>=7 && hit.direct && (hasStrong||kind==='BILL'||/\b(total paid|amount paid|amount charged|amount debited|payment successful|payment completed)\b/i.test(hit.ctx));
 const merchant=String(email.sender).split('<')[0].replace(/^["']|["']$/g,'').trim().slice(0,65)||'Unknown sender';
 let date=new Date(email.date);if(!Number.isFinite(date.getTime()))return null;
 const due=kind==='BILL'?String(body.match(/\b(?:due date|payment due|pay by)\s*[:\-]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i)?.[1]||''):null;
 return {
   key:email.id,messageId:email.id,merchant,subject,date:date.toISOString(),
   amount:Math.round(hit.amount*100)/100,currency:hit.currency,
   category:root.LedgerEngine?.category(subject+' '+merchant)||'Other',
   kind,status:'REVIEW',confidence:strong?'HIGH':'REVIEW',
   signal:kind==='BILL'?'BILL_NOTICE':strong?'COMPLETION_EMAIL':'POSSIBLE_RECEIPT',
   evidenceLevel:'PRIMARY_FULL',analysisVersion:5,
   reference:transactionReference(subject+' '+lead),
   dueDate:due?(!Number.isNaN(Date.parse(due))?new Date(due).toISOString().slice(0,10):null):null,
   evidence:strong?(kind==='BILL'?'Bill amount found in full email':'Payment amount tied to completion wording'):'Review required: payment evidence is incomplete',
   source:(()=>{const x=hit.ctx.replace(/\b(?:\d[ -]?){13,19}\b/g,'[masked number]');return x.slice(0,Math.min(160,Math.max(1,Math.floor(x.length*.78))))})(),reviewSuggestion:kind==='BILL'?'Statement or amount-due notice; verify whether already settled':strong?'Email reports a completed payment; bank settlement not verified':'Ambiguous receipt: check the original email',
   suggestedStatus:kind==='BILL'?'POSSIBLY_DUE':strong?'LIKELY_PAID':'PURCHASE_UNVERIFIED'
 };
}
function mergePrimary(oldItems,newItems,cutoffDate,fullyScanned){
 const old=new Map((oldItems||[]).filter(x=>x.analysisVersion===5).map(x=>[x.key,x]));
 const fresh=(newItems||[]).map(x=>{
   const prev=old.get(x.key);
   return {...x,status:prev?.status||x.status,reviewedAt:prev?.reviewedAt||null};
 });
 const merged=new Map();
 for(const item of old.values()){
   if(!fullyScanned || String(item.date)<cutoffDate)merged.set(item.key,item);
 }
 for(const item of fresh)merged.set(item.key,item);
 const refs=new Map();
 return [...merged.values()].sort((a,b)=>b.date.localeCompare(a.date)).map(item=>{
   const key=item.reference ? item.kind+'|'+item.merchant.toLowerCase()+'|'+item.reference+'|'+item.currency+'|'+item.amount : null;
   const dup=key?refs.get(key):null;
   if(key&&!dup)refs.set(key,item.key);
   return {...item,possibleDuplicateOf:dup||null};
 });
}
function pendingGroups(items,today){
 const groups={overdue:[],upcoming:[],unknown:[],paid:[]};
 for(const c of items||[]){
   if(c.status==='IGNORED'||c.possibleDuplicateOf)continue;
   if(c.status==='PAID'){groups.paid.push(c);continue}
   if(c.kind!=='BILL'&&c.status!=='DUE')continue;
   if(c.dueDate&&c.dueDate<today)groups.overdue.push(c);
   else if(c.dueDate)groups.upcoming.push(c);
   else groups.unknown.push(c);
 }
 for(const list of Object.values(groups))list.sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||b.date.localeCompare(a.date));
 return groups;
}
function visiblePayments(items,month){
 return (items||[]).filter(x=>x.kind==='PAYMENT'&&x.analysisVersion===5&&
   x.confidence==='HIGH'&&String(x.date).slice(0,7)===month&&!['IGNORED','DUE'].includes(x.status)&&!x.possibleDuplicateOf);
}
const API={pendingGroups,PRIMARY_QUERY,isPrimary,decodeData,htmlToText,parseGmailFull,classifyFullMail,mergePrimary,visiblePayments,currencyAmounts,trimQuoted};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
root.LedgerStrict=API;
})(typeof window!=='undefined'?window:globalThis);

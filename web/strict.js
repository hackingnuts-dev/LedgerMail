/* LedgerMail transaction evidence classifier v5.
 * Process user-authorized Gmail Primary messages only. Full MIME body in memory;
 * persist only concise explanations, never the entire body or OAuth tokens. */
(function(root){
'use strict';
// Primary is selected by Gmail search; some Primary messages have no category label.
const CATEGORY_EXCLUDED=new Set(['CATEGORY_PROMOTIONS','CATEGORY_SOCIAL','CATEGORY_UPDATES','CATEGORY_FORUMS','SPAM','TRASH','DRAFT','SENT']);
const PRIMARY_QUERY='category:primary newer_than:90d {receipt "payment" "debited" "charged" "purchase" "order" "statement" "bill" "transaction" "invoice"} -category:promotions -category:social -category:updates -category:forums -in:spam -in:trash';
function isFinancialUpdate(labels){return Array.isArray(labels)&&labels.includes('CATEGORY_UPDATES')&&!labels.some(x=>x!=='CATEGORY_UPDATES'&&CATEGORY_EXCLUDED.has(x))}
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
function parseGmailFull(raw,allowUpdates=false){
 if(!raw?.id||!(isPrimary(raw.labelIds)||(allowUpdates&&isFinancialUpdate(raw.labelIds))))return null;
 const h=Object.fromEntries((raw.payload?.headers||[]).map(x=>[String(x.name||'').toLowerCase(),String(x.value||'')]));
 const bucket={plain:[],html:[],depth:0};
 mimeBodies(raw.payload,bucket);
 const plain=normalizeFinanceText(bucket.plain.filter(Boolean).join('\n')).trim();
 const htmlText=normalizeFinanceText(htmlToText(bucket.html.join('\n'))).trim();
 const body=(!plain||(!currencyAmounts(plain).length&&currencyAmounts(htmlText).length))?htmlText:plain;
 // Fail closed: snippet is never used as a substitute for the full body.
 if(!body)return null;
 const dateValue=Number(raw.internalDate);
 const d=new Date(Number.isFinite(dateValue)&&dateValue>0?dateValue:Date.parse(h.date||''));
 if(!Number.isFinite(d.getTime()))return null;
 return {
   id:String(raw.id),threadId:String(raw.threadId||raw.id),
   date:d.toISOString(),sender:h.from||'Unknown sender',
   recipient:h.to||'',subject:h.subject||'(No subject)',
   body,alternateBody:htmlText&&htmlText!==body?htmlText:null,labels:raw.labelIds||[],headers:h
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
 for(const m of String(text).matchAll(/\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(USD|INR|GBP|EUR|CAD|AUD)\b/gi)){
   const amount=Number(m[1].replace(/,/g,'')),start=m.index,end=start+m[0].length;
   if(amount>0&&amount<1e8&&!a.some(x=>start<x.end&&end>x.start))a.push({amount,currency:m[2].toUpperCase(),start,end});
 }
 return a.sort((x,y)=>x.start-y.start);
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
 const m=String(text).match(/\b(?:transaction (?:id|ref(?:erence)?)|order (?:number|no\.?|#)|receipt\s*(?:number|no\.?|\[?#)|confirmation (?:number|#))\s*[:#-]?\s*([A-Z0-9-]{5,32})\b/i);
 return m?.[1]?.toUpperCase()||null;
}
function normalizeFinanceText(value){
 return String(value||'').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').replace(/[\u00a0\u202f]/g,' ').replace(/\r\n?/g,'\n');
}
function structuredReceipt(email,allowUpdates=false){
 if(!email||!(isPrimary(email.labels)||(allowUpdates&&isFinancialUpdate(email.labels))))return null;
 const subject=normalizeFinanceText(email.subject),body=normalizeFinanceText(trimQuoted(email.body));
 if(OTP.test(subject)||OTP.test(body.slice(0,300))||PROMO_SUBJECT.test(subject)||/\b(payment failed|payment declined|transaction declined|refund issued|refund processed)\b/i.test(subject))return null;
 const lines=body.split('\n').map(x=>x.trim()).filter(Boolean);
 const fields=[];
 for(let i=0;i<lines.length;i++){
   const line=lines[i];
   const match=line.match(/^(total amount due|total due|amount due|balance due|statement balance|amount paid|total paid|amount charged|amount debited|payment amount|minimum amount due|minimum payment|total|grand total)\b\s*[:\-]?\s*(.*)$/i);
   if(!match)continue;
   const value=match[2].trim()||lines[i+1]||'';
   const amount=currencyAmounts(value)[0]||(()=>{const m=value.match(/^Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i);return m?{amount:Number(m[1].replace(/,/g,'')),currency:'INR'}:null})();
   if(amount&&amount.amount>0)fields.push({...amount,label:match[1].toLowerCase()});
 }
 const isReceipt=/\b(receipt|tickets?|booking confirmation|payment successful|repayment successful|payment confirmation)\b/i.test(subject)||/\b(?:receipt #|booking id|payment method|paid via|payment type|amount charged)\b/i.test(body);
 const matchContext=Array.from(new Set((body.match(/\b(?:calendly|consultation|appointment|meeting|booking|subscription|repayment|toll|ticket)\b/gi)||[]).map(x=>x.toLowerCase()))).join(' ');
 const paid=fields.find(x=>/^(amount paid|total paid|amount charged|amount debited)$/.test(x.label));
 const due=fields.find(x=>/^(total amount due|total due|statement balance|amount due|balance due)$/.test(x.label));
 const repayment=/\b(?:credit card bill payment|repayment successful|repayment is successful|payment of.{0,70}towards.{0,70}credit card)\b/i.test(subject+' '+body.slice(0,800));
 const hit=paid||due;
 if(PROMO_BODY.test(body.slice(0,900))&&!isReceipt)return null;
 if(!hit||(!due&&!isReceipt&&!/\b(?:payment successful|payment completed|transaction successful)\b/i.test(subject+' '+body)))return null;
 const kind=paid?'PAYMENT':'BILL';
 const date=new Date(email.date);if(!Number.isFinite(date.getTime()))return null;
 const paidDate=(body.match(/\b(?:date paid|paid on|payment time|booking date(?: & time)?)\s*[:\-]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i)||[])[1];
 const dueDate=(body.match(/\b(?:due date|pay by|payment due date)\s*[:\-]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})/i)||[])[1];
 const parseDay=x=>x&&!Number.isNaN(Date.parse(x))?dateKey(new Date(x)):null;
 const txDate=kind==='PAYMENT'?parseDay(paidDate):null;
 const merchant=String(email.sender||'Unknown sender').split('<')[0].replace(/^["']|["']$/g,'').trim().slice(0,65)||'Unknown sender';
 return {key:email.id,messageId:email.id,merchant,subject,date:date.toISOString(),transactionDate:txDate,matchContext,amount:hit.amount,currency:hit.currency,
 category:root.LedgerEngine?.category(subject+' '+merchant)||'Other',kind,status:'REVIEW',confidence:'HIGH',signal:repayment?'CARD_REPAYMENT':kind==='BILL'?'BILL_NOTICE':'COMPLETION_EMAIL',
 evidenceLevel:isFinancialUpdate(email.labels)?'UPDATES_FULL':'PRIMARY_FULL',analysisVersion:5,reference:transactionReference(subject+' '+body),dueDate:parseDay(dueDate),
 evidence:'Explicit '+hit.label+' field in full email',source:hit.label+': '+hit.currency+' '+hit.amount.toFixed(2),reviewSuggestion:repayment?'Credit card repayment; tracked separately from purchases.':'Check original email and account before relying on the amount.',suggestedStatus:kind==='BILL'?'POSSIBLY_DUE':'LIKELY_PAID'};
}
function inspectEvidence(email,allowUpdates=false){
 const reject=reason=>({candidate:null,reason});
 if(!email||!(isPrimary(email.labels)||(allowUpdates&&isFinancialUpdate(email.labels))))return reject('category');
 const subject=normalizeFinanceText(email.subject),body=normalizeFinanceText(trimQuoted(email.body));
 const text=subject+'\n'+body;
 if(!body.trim())return reject('no readable body');
 if(OTP.test(subject)||OTP.test(body.slice(0,650)))return reject('security / OTP');
 if(PROMO_SUBJECT.test(subject)||PROMO_BODY.test(body.slice(0,900)))return reject('marketing');
 if((INCOMING.test(subject)||/\b(refund (?:issued|processed|received)|deposit received|funds received|you received)\b/i.test(body.slice(0,250)))&&!/\b(statement|amount due|bill due)\b/i.test(subject+' '+body.slice(0,500)))return reject('incoming / transfer');
 if(TRANSFER.test(subject+' '+body.slice(0,1000)))return reject('incoming / transfer');
 if(/\b(payment (?:failed|declined|cancelled|canceled|reversed)|transaction (?:declined|failed|reversed)|not (?:paid|charged)|no payment (?:was )?made)\b/i.test(text))return reject('failed / reversed');
 const receipt=/\b(receipt|payment confirmation|paid invoice|tax invoice|order confirmation|transaction alert|purchase alert|payment successful|payment received|card transaction)\b/i.test(subject);
 const completed=/\b(?:paid|debited|charged|payment (?:received|successful|completed|processed)|transaction (?:successful|completed|approved)|purchase (?:completed|approved)|thank you for your (?:payment|purchase)|status\s*[:\-]?\s*(?:paid|succeeded|successful))\b/i.test(body);
 const receiptDetail=/\b(?:receipt (?:number|date|#)|payment (?:method|details|date)|transaction (?:id|date|reference)|card ending|invoice (?:number|#))\b/i.test(body);
 const bill=/\b(?:amount due|total due|balance due|payment due|due date|pay by|bill amount|outstanding balance|statement balance|minimum payment|payment reminder)\b/i.test(text);
 const scheduled=/\b(?:scheduled payment|upcoming payment|will be charged|will be debited|automatic payment scheduled|autopay scheduled)\b/i.test(text);
 const relevant=receipt||completed||bill||scheduled||/\b(?:invoice|statement|payment|transaction|purchase|order|subscription|renewal)\b/i.test(subject);
 if(!relevant)return reject('not financial');
 // Read all explicitly formatted amounts, plus localized Rupee prefix.
 const amounts=currencyAmounts(body);
 for(const m of body.matchAll(/\b(?:Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi)){
   const amount=Number(m[1].replace(/,/g,''));if(amount>0&&amount<1e8&&!amounts.some(x=>x.start===m.index))amounts.push({amount,currency:'INR',start:m.index,end:m.index+m[0].length});
 }
 if(!amounts.length)return reject('financial wording, no readable currency amount');
 const ranked=amounts.map(x=>{
   const start=body.lastIndexOf('\n',x.start)+1,end=body.indexOf('\n',x.end);
   const line=body.slice(start,end<0?body.length:end);
   const prev=body.slice(Math.max(0,start-100),start).trim().split('\n').at(-1)||'';
   const pre=body.slice(start,x.start).trim(),after=body.slice(x.end,end<0?body.length:end);
   const label=(pre||prev).trim();
   const explicitDue=/\b(?:amount due|total due|balance due|statement balance|outstanding balance|bill amount|payment due)\b/i.test(label+' '+after);
   const explicitPaid=/\b(?:amount paid|total paid|amount charged|amount debited|payment amount|transaction amount|charged|debited|paid)\b/i.test(label+' '+after);
   const total=/^(?:total|grand total|total amount|amount|payment total|invoice total)\s*[:\-]?$/i.test(label);
   const negative=/\b(?:subtotal|tax|shipping|discount|savings|reward|cashback|available credit|credit limit|minimum payment|minimum due)\b/i.test(line);
   const score=negative?-20:(explicitDue||explicitPaid?12:total?9:amounts.length===1?4:0);
   return {...x,score,explicitDue,explicitPaid,total};
 }).sort((a,b)=>b.score-a.score||a.start-b.start);
 const hit=ranked[0];
 if(!hit||hit.score<0)return reject('only non-payment amounts');
 const kind=bill&&!completed||hit.explicitDue?'BILL':'PAYMENT';
 const confident=kind==='BILL'?(hit.explicitDue&&!scheduled):(!scheduled&&(completed&&(hit.explicitPaid||hit.total||amounts.length===1)||receipt&&receiptDetail&&hit.total));
 const date=new Date(email.date);
 if(!Number.isFinite(date.getTime()))return reject('invalid date');
 const merchant=String(email.sender||'Unknown sender').split('<')[0].replace(/^["']|["']$/g,'').trim().slice(0,65)||'Unknown sender';
 const dueMatch=text.match(/\b(?:due date|payment due|pay by|scheduled (?:for|on))\s*[:\-]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})/i);
 const dueDate=dueMatch&&!Number.isNaN(Date.parse(dueMatch[1]))?new Date(dueMatch[1]).toISOString().slice(0,10):null;
 return {reason:confident?'structured payment evidence':'financial email needs review',candidate:{
   key:email.id,messageId:email.id,merchant,subject,date:date.toISOString(),amount:Math.round(hit.amount*100)/100,currency:hit.currency,
   category:root.LedgerEngine?.category(subject+' '+merchant)||'Other',kind,status:'REVIEW',confidence:confident?'HIGH':'REVIEW',
   signal:kind==='BILL'?'BILL_NOTICE':confident?'COMPLETION_EMAIL':'POSSIBLE_RECEIPT',
   evidenceLevel:isFinancialUpdate(email.labels)?'UPDATES_FULL':'PRIMARY_FULL',analysisVersion:5,reference:transactionReference(text),dueDate,
   evidence:confident?'Structured amount and transaction context found':'Possible financial email; review before counting',
   source:'Amount identified: '+hit.currency+' '+hit.amount.toFixed(2),
   reviewSuggestion:confident?'Email evidence only; verify against your account.':'Confirm the amount and status using the original email.',
   suggestedStatus:kind==='BILL'?'POSSIBLY_DUE':confident?'LIKELY_PAID':'PURCHASE_UNVERIFIED'
 }};
}
function classifyFullMail(email,allowUpdates=false){
 if(!email||!(isPrimary(email.labels)||(allowUpdates&&isFinancialUpdate(email.labels)))||!email.body)return null;
 const subject=normalizeFinanceText(email.subject).trim(),body=normalizeFinanceText(trimQuoted(email.body)),lead=body.slice(0,1300);
 const intro=(subject+'\n'+lead);
 if(OTP.test(subject)||OTP.test(lead.slice(0,650)))return null;
 if(/\b(payment (?:failed|declined|cancelled|canceled|reversed)|transaction (?:declined|failed|reversed)|not (?:paid|charged))\b/i.test(subject+' '+lead))return null;
 if(PROMO_SUBJECT.test(subject))return null;
 const receiptSubject=/\b(receipt|paid invoice|payment confirmation)\b/i.test(subject);
 const paidBody=COMPLETED.test(body)||/\b(payment status\s*[:\-]?\s*paid|status\s*[:\-]?\s*(paid|succeeded)|paid with|paid via|amount paid|total paid|charged on)\b/i.test(body);
 const receiptBody=receiptSubject&&/\b(receipt (?:number|date|#)|payment method|paid|charged|thank you for your payment|payment details|transaction (?:id|date)|card ending|payment date)\b/i.test(body);
 const hasStrong=paidBody||receiptBody;
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
   const prevLine=body.slice(Math.max(0,start-90),start).trim().split('\n').at(-1)||'';
   const label=pre.trim()||prevLine;
   const receiptTotal=kind==='PAYMENT'&&receiptSubject&&hasStrong&&/^(?:total|amount|total amount|payment total|amount paid|total paid)\s*[:\-]?\s*$/i.test(label);
   const direct=kind==='BILL'?BILL_CONTEXT.test(pre+' '+line+' '+prevLine):AMOUNT_CONTEXT.test(pre+' '+line+' '+prevLine)||receiptTotal;

   const event=kind==='BILL'?BILL.test(line):COMPLETED.test(line);
   const discount=DISCOUNT_CONTEXT.test(line);
   let score=(direct?6:0)+(event?3:0)+(kind==='PAYMENT'&&SUBJECT_RECEIPT.test(subject)?2:0);
   if(/\b(total paid|grand total|total charged|amount paid|payment amount|amount debited|amount due|balance due)\b/i.test(pre))score+=5;
   if(/\b(subtotal|estimated|tax|shipping|item total)\b/i.test(pre))score-=9;
   if(discount)score-=9;
   if(receiptTotal)score+=6;
   if(/\b(minimum payment|minimum due)\b/i.test(pre)&&kind==='BILL')score-=3;
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
   evidenceLevel:isFinancialUpdate(email.labels)?'UPDATES_FULL':'PRIMARY_FULL',analysisVersion:5,
   reference:transactionReference(subject+' '+lead),
   dueDate:due?(!Number.isNaN(Date.parse(due))?new Date(due).toISOString().slice(0,10):null):null,
   evidence:strong?(kind==='BILL'?'Bill amount found in full email':'Payment amount tied to completion wording'):'Review required: payment evidence is incomplete',
   source:(()=>{const x=hit.ctx.replace(/\b(?:\d[ -]?){13,19}\b/g,'[masked number]');return x.slice(0,Math.min(160,Math.max(1,Math.floor(x.length*.78))))})(),reviewSuggestion:kind==='BILL'?'Statement or amount-due notice; verify whether already settled':strong?'Email reports a completed payment; bank settlement not verified':'Ambiguous receipt: check the original email',
   suggestedStatus:kind==='BILL'?'POSSIBLY_DUE':strong?'LIKELY_PAID':'PURCHASE_UNVERIFIED'
 };
}
function duplicatePair(a,b){
 if(a.kind!==b.kind||a.currency!==b.currency||Math.round(a.amount*100)!==Math.round(b.amount*100))return null;
 if(a.key===b.key||a.status==='IGNORED'||b.status==='IGNORED')return null;
 if((a.signal==='CARD_REPAYMENT')!== (b.signal==='CARD_REPAYMENT'))return null;
 const pair=[a.key,b.key].sort().join('|');
 const decisions=[a,b].map(x=>String(x.duplicateDecision||'')).filter(x=>x.endsWith('|'+pair));
 if(decisions.some(x=>x.startsWith('distinct|')))return null;
 if(decisions.some(x=>x.startsWith('same|')))return {pair,score:100,reason:'You confirmed these emails describe the same payment'};
 const day=x=>x.transactionDate||dateKey(x.date);
 const sameDay=day(a)===day(b);
 const minutes=Math.abs(Date.parse(a.date)-Date.parse(b.date))/60000;
 const normalize=x=>String(x||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>=4&&!['receipt','payment','confirmation','your','from','with','company','limited','incorporated','calendly','stripe','transaction','meeting','minute','minutes','paid','successful','order'].includes(w));
 const tokens=x=>new Set(normalize(x.merchant+' '+x.subject+' '+(x.matchContext||'')));
 const ta=tokens(a),tb=tokens(b),common=[...ta].filter(t=>tb.has(t));
 const cross=/calendly|booking|appointment|consultation|meeting/i.test(a.subject+' '+a.merchant+' '+a.matchContext+' '+b.subject+' '+b.merchant+' '+b.matchContext);
 const sharedRef=a.reference&&b.reference&&a.reference===b.reference;
 if(sharedRef&&(sameDay||minutes<1440))return {pair,score:95,reason:'Matching transaction reference and amount'};
 if(!sameDay&&!(minutes<=30))return null;
 // Two equal purchases alone are not evidence of duplication. Require temporal proximity plus a link, or ask.
 if(a.signal==='CARD_REPAYMENT'&&b.signal==='CARD_REPAYMENT'&&minutes<=5)return {pair,score:85,reason:'Two repayment confirmations close together'};
 if(common.length&&cross&&(minutes<=60||sameDay))return {pair,score:80,reason:'Matching amount/date and shared merchant or appointment wording'};
 if(minutes<=15&&cross)return {pair,score:70,reason:'Matching amount within 15 minutes, with appointment or booking evidence'};
 if(common.length&&minutes<=15)return {pair,score:65,reason:'Matching amount, nearby email times and shared merchant wording'};
 if(minutes<=5)return {pair,score:60,reason:'Same amount and currency within five minutes; please confirm'};
 return null;
}
function reconcileDuplicates(items){
 const list=items.map(c=>({...c,possibleDuplicateOf:null,duplicateReason:null,duplicatePair:null}));
 // Prefer a direct receipt with explicit settlement evidence over a booking notification.
 const quality=c=>(c.confidence==='HIGH'?20:0)+(/\breceipt\b/i.test(c.subject)?15:0)+(/explicit (?:amount paid|amount charged|total paid)/i.test(c.evidence||'')?10:0)-(/via calendly|booking confirmation|confirmed:|appointment/i.test(c.subject+' '+c.merchant)?8:0);
 const groups=new Map();
 for(const c of list){const key=c.kind+'|'+c.currency+'|'+Math.round(c.amount*100);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c)}
 for(const group of groups.values()){
   group.sort((a,b)=>quality(b)-quality(a)||a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
   const anchors=[];
   for(const c of group){
     const matches=anchors.map(anchor=>({anchor,match:duplicatePair(anchor,c)})).filter(x=>x.match).sort((a,b)=>b.match.score-a.match.score);
     const best=matches[0];
     if(best){c.possibleDuplicateOf=best.anchor.key;c.duplicateReason=best.match.reason;c.duplicatePair=best.match.pair;c.duplicateConfirmed=best.match.score===100?'yes':null}
     else{c.duplicateConfirmed=null;anchors.push(c)}
   }
 }
 return list.sort((a,b)=>b.date.localeCompare(a.date));
}
function mergePrimary(oldItems,newItems,cutoffDate,fullyScanned){
 const old=new Map((oldItems||[]).filter(x=>x.analysisVersion===5).map(x=>[x.key,x]));
 const fresh=(newItems||[]).map(x=>{
   const prev=old.get(x.key);
   return {...x,status:prev?.status||x.status,reviewedAt:prev?.reviewedAt||null,duplicateDecision:prev?.duplicateDecision||x.duplicateDecision||null};
 });
 const merged=new Map();
 for(const item of old.values()){
   if(!fullyScanned || String(item.date)<cutoffDate)merged.set(item.key,item);
 }
 for(const item of fresh)merged.set(item.key,item);
 return reconcileDuplicates([...merged.values()]);
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
function monthBounds(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid month');
 const [y,m]=month.split('-').map(Number);
 return {start:new Date(y,m-1,1),end:new Date(y,m,1)};
}
function dateKey(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'):''}
function monthlyQuery(month,updates=false){
 const b=monthBounds(month);
 return (updates?'{category:primary category:updates}':'category:primary')+' after:'+Math.floor(b.start.getTime()/1000)+' before:'+Math.floor(b.end.getTime()/1000)+' -in:spam -in:trash {receipt invoice payment paid charged debited transaction statement bill purchase order booking tickets repayment autopay subscription renewal amount toll refund}';
}
function merchantKey(c){return String(c.merchant||'').toLowerCase().trim()+'|'+c.currency}
function monthlyModel(payments,bills,month,today){
 const current=c=>(c.transactionDate||dateKey(c.date)).slice(0,7)===month;
 const clean=c=>c&&!c.possibleDuplicateOf&&!['IGNORED'].includes(c.status);
 const paid=c=>clean(c)&&c.kind==='PAYMENT'&&c.signal!=='CARD_REPAYMENT'&&c.status!=='DUE'&&(c.status==='PAID'||c.confidence==='HIGH');
 const made=payments.filter(c=>paid(c)&&current(c)).map(c=>({...c,bucket:'MADE',timelineDate:c.transactionDate||dateKey(c.date)}));
 const due=[...bills,...payments.filter(c=>c.status==='DUE')].filter(c=>clean(c)&&c.status!=='PAID'&&(c.confidence==='HIGH'||c.status==='DUE')&&(current(c)||c.dueDate?.slice(0,7)===month)).map(c=>({...c,bucket:'DUE',timelineDate:c.dueDate||dateKey(c.date)}));
 const observed=new Set([...made,...due].map(merchantKey));
 const history=new Map();
 for(const c of payments.filter(paid)){
   const day=dateKey(c.date),m=day.slice(0,7);if(m>=month||!m)continue;
   if(!/subscription|membership|rent|utility|internet|insurance|monthly|autopay|recurring|netflix|spotify/i.test([c.subject,c.merchant,c.category].join(' ')))continue;
   const key=merchantKey(c);
   if(!history.has(key))history.set(key,new Map());
   const group=history.get(key);if(!group.has(m))group.set(m,[]);group.get(m).push(c);
 }
 const expected=[];
 for(const [key,group] of history){
   if(observed.has(key))continue;
   const months=[...group.keys()].sort();
   if(months.length<2)continue;
   const last=months.at(-1),prev=months.at(-2);
   const serial=m=>Number(m.slice(0,4))*12+Number(m.slice(5,7));
   if(serial(last)-serial(prev)!==1||serial(month)-serial(last)!==1)continue;
   if(group.get(last).length!==1||group.get(prev).length!==1)continue;
   const x=group.get(last)[0],y=group.get(prev)[0];
   if(Math.abs(x.amount-y.amount)>Math.max(1,x.amount*.1))continue;
   const b=monthBounds(month),end=new Date(b.end.getFullYear(),b.end.getMonth(),0).getDate();
   const date=month+'-'+String(Math.min(end,Number(dateKey(x.date).slice(8)))).padStart(2,'0');
   if(month<today.slice(0,7))continue;
   expected.push({...x,key:'forecast:'+key+':'+month,bucket:'EXPECTED',timelineDate:date,amount:x.amount,forecast:true,evidence:'Estimate from two consecutive monthly receipts; not a confirmed bill.'});
 }
 const entries=[...made,...due,...expected].sort((a,b)=>a.timelineDate.localeCompare(b.timelineDate)||a.merchant.localeCompare(b.merchant));
 return {made,due,expected,entries};
}
function mergeMonth(old,fresh,month,complete){
 const prior=new Map(old.map(c=>[c.key,c]));
 const keep=old.filter(c=>!complete||dateKey(c.date).slice(0,7)!==month);
 const map=new Map(keep.map(c=>[c.key,c]));
 for(const c of fresh){const p=prior.get(c.key);map.set(c.key,{...c,status:p?.status||c.status,reviewedAt:p?.reviewedAt||null,duplicateDecision:p?.duplicateDecision||c.duplicateDecision||null});}
 return mergePrimary([], [...map.values()], '',false);
}
function visiblePayments(items,month){
 return (items||[]).filter(x=>x.kind==='PAYMENT'&&x.analysisVersion===5&&
   x.confidence==='HIGH'&&String(x.date).slice(0,7)===month&&!['IGNORED','DUE'].includes(x.status)&&!x.possibleDuplicateOf);
}
const API={duplicatePair,reconcileDuplicates,structuredReceipt,inspectEvidence,normalizeFinanceText,isFinancialUpdate,monthBounds,dateKey,monthlyQuery,monthlyModel,mergeMonth,pendingGroups,PRIMARY_QUERY,isPrimary,decodeData,htmlToText,parseGmailFull,classifyFullMail,mergePrimary,visiblePayments,currencyAmounts,trimQuoted};
if(typeof module!=='undefined'&&module.exports)module.exports=API;
root.LedgerStrict=API;
})(typeof window!=='undefined'?window:globalThis);

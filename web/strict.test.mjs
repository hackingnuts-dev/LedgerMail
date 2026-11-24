import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const R=createRequire(import.meta.url);
const S=R('./strict.js');
const E=R('./engine.js');
const b64=str=>Buffer.from(str,'utf8').toString('base64url');
function msg(id,subject,body,labels=['CATEGORY_PERSONAL'],mime='text/plain',extra=[]){
 return {id,threadId:id,internalDate:String(Date.parse('2026-11-20T15:00:00Z')),labelIds:labels,
   payload:{mimeType:mime,headers:[{name:'Subject',value:subject},{name:'From',value:'Acme Store <billing@acme.example>'},{name:'To',value:'test@gmail.com'},...extra],
   body:{size:body.length,data:b64(body)}}};
}
function extracted(raw){const m=S.parseGmailFull(raw);return m&&S.classifyFullMail(m)}
assert(S.PRIMARY_QUERY.includes('category:primary'));
assert(S.isPrimary(['CATEGORY_PERSONAL','INBOX']));
for(const category of ['CATEGORY_PROMOTIONS','CATEGORY_UPDATES','CATEGORY_SOCIAL','CATEGORY_FORUMS','TRASH','SPAM'])
 assert(!S.isPrimary(['CATEGORY_PERSONAL',category]),category+' excluded');
assert.equal(S.parseGmailFull(msg('pm','Payment successful','Your card was charged $21.00',['CATEGORY_PROMOTIONS'])),null);
assert.equal(extracted(msg('ad','Limited time offer: save $285 today','Receipt? Save $285.00 with code SAVE285. Unsubscribe')),null);
assert.equal(extracted(msg('otp','OTP for your Federal Scapia Credit Card transaction','Use OTP 209111 for your transaction of $285.00')),null);
assert.equal(extracted(msg('news','Your monthly cashback newsletter','Shop now and enjoy savings of $45.00')),null);
assert.equal(extracted(msg('false','Order our new card','Earn $200 cashback when you apply now.')),null);
assert.equal(extracted(msg('refund','Refund issued','Refund processed for $45.00 to your account.')),null);
assert.equal(extracted(msg('income','Deposit received','You received $830.00 from John')),null);
assert.equal(extracted(msg('transfer','Credit card payment received','Your credit card payment received $150.00')),null);
assert.equal(extracted(msg('subject','Payment of $1,200 successful','Here are your benefits.')),null,'must not trust amount only in subject');
assert.equal(extracted(msg('invoice-only','Your payment of $285 is required','Please make a payment of $285.00 next week.')),null,'amount due but no completed payment evidence');
assert.equal(extracted(msg('coupon','Your receipt promo code','Your next purchase of $30.00 gets $5 off with this limited-time offer')),null,'promotional offer excluded');

const purchase=extracted(msg('a','Your payment receipt #20345','Thank you for your payment. Total paid: $285.00. Payment completed.'));
assert(purchase&&purchase.kind==='PAYMENT'&&purchase.amount===285&&purchase.confidence==='HIGH',JSON.stringify(purchase));
const debit=extracted(msg('b','Card purchase completed','Your card was charged $48.72 at EXAMPLE MARKET. Transaction completed.'));
assert(debit&&debit.amount===48.72&&debit.confidence==='HIGH');
const multiline=extracted(msg('c','Your order payment confirmed', 'Subtotal $50.00\nTax $5.00\nTotal paid $55.00\nPayment successful'));
assert(multiline&&multiline.amount===55,'must choose paid total not subtotal');
const bill=extracted(msg('d','Your November statement is ready','Current statement\nAmount due: $410.34\nPayment due date: 12/15/2026'));
assert(bill&&bill.kind==='BILL'&&bill.amount===410.34&&bill.dueDate==='2026-12-15');
const nested=msg('e','Payment receipt','');
nested.payload={mimeType:'multipart/alternative',headers:nested.payload.headers,parts:[{
 mimeType:'text/plain',body:{data:b64('Your card was charged $89.60. Payment completed.')},
 headers:[{name:'Content-Type',value:'text/plain;charset=utf-8'}]
},{mimeType:'text/html',body:{data:b64('<html><body><script>evil()</script><p>Pay $999.00</p></body></html>')}}]};
const multipart=extracted(nested);
assert(multipart&&multipart.amount===89.60,'prefer plain text and ignore html alternative');
const html=msg('f','Receipt for payment','<html><head><style>h1{color:red}</style></head><body><p>Payment received</p><p>Total paid: $32.25</p><script>alert(1)</script></body></html>', ['CATEGORY_PERSONAL'],'text/html');
const htmlOut=extracted(html);
assert(htmlOut&&htmlOut.amount===32.25,'HTML-only body parsed');
const newlineRef=extracted(msg('g','Payment receipt','Payment successful. Amount paid: $61.00\nTransaction ID: XYZZY12345'));
assert(newlineRef&&newlineRef.reference==='XYZZY12345');
const legacy={...purchase,analysisVersion:4,key:'old',amount:99999};
const full=[purchase,{...purchase,key:'a2',date:'2026-11-19T15:00:00Z',amount:12}];
const merged=S.mergePrimary([legacy,{...purchase,status:'PAID'}],full,'2026-08-20',true);
assert.equal(merged.some(x=>x.key==='old'),false,'old noise not carried forward');
assert.equal(merged.find(x=>x.key==='a').status,'PAID','manual review survives');
assert.equal(merged.find(x=>x.key==='a2').possibleDuplicateOf,null,'different purchases not merged on merchant/date');
const remove=S.mergePrimary([purchase],[],'2026-08-20',true);
assert.equal(remove.length,0,'non-primary/missing candidate removed on complete rescan');
assert(S.visiblePayments([purchase], '2026-11').length===1);
assert(S.visiblePayments([{...purchase,confidence:'REVIEW'}], '2026-11').length===0);
console.log('Strict Primary-only full MIME filtering and transaction evidence regression tests passed');

assert(S.isPrimary(['INBOX']));assert(!S.isPrimary(['INBOX','CATEGORY_UPDATES']));
const pending=S.pendingGroups([{kind:'BILL',status:'REVIEW',dueDate:'2026-11-01',date:'2026-10-01'},{kind:'BILL',status:'REVIEW',dueDate:'2026-12-01',date:'2026-11-01'},{kind:'BILL',status:'PAID',date:'2026-11-01'},{kind:'BILL',status:'REVIEW',date:'2026-11-01'}],'2026-11-23');assert.equal(pending.overdue.length,1);assert.equal(pending.upcoming.length,1);assert.equal(pending.unknown.length,1);assert.equal(pending.paid.length,1);

const nov='2026-11',nowDay='2026-11-23';
const mk=(key,day,amount,extra={})=>({key,merchant:'Netflix',currency:'USD',amount,date:day+'T12:00:00',kind:'PAYMENT',status:'REVIEW',confidence:'HIGH',analysisVersion:5,subject:'Monthly subscription',...extra});
const historical=[mk('sept','2026-09-28',15.99),mk('oct','2026-10-28',15.99)];
const m1=S.monthlyModel(historical,[mk('bill','2026-11-01',100,{kind:'BILL',merchant:'Internet',dueDate:'2026-11-25'})],nov,nowDay);
assert.equal(m1.expected.length,1);assert.equal(m1.expected[0].timelineDate,'2026-11-28');assert.equal(m1.due.length,1);assert.equal(m1.made.length,0);
const m2=S.monthlyModel([...historical,mk('nov','2026-11-10',15.99)],[],nov,nowDay);assert.equal(m2.expected.length,0);assert.equal(m2.made.length,1);
const m3=S.mergeMonth(historical,[mk('new','2026-11-10',22)],nov,true);assert.equal(m3.length,3);
assert(S.monthlyQuery(nov).includes('category:primary'));assert(S.monthlyQuery(nov,true).includes('category:updates'));assert(!S.monthlyQuery(nov).includes('newer_than'));
assert(S.isFinancialUpdate(['INBOX','CATEGORY_UPDATES']));assert(!S.isFinancialUpdate(['CATEGORY_UPDATES','CATEGORY_PROMOTIONS']));
console.log('Month boundaries, forecast suppression, and month-preserving merge passed');

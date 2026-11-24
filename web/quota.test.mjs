import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const Q=createRequire(import.meta.url)('./quota.js');
assert.equal(Q.cost('messages?maxResults=100'),5);
assert.equal(Q.cost('messages/id?format=full'),60);
assert.equal(Q.cost('messages/id?format=metadata'),20);
assert.equal(Q.cost('messages/id/attachments/att'),20);
assert.equal(Q.cost('profile'),1);
let entries=[];let now=100000;
for(let i=0;i<30;i++){const r=Q.reserve(entries,60,now+i);assert.equal(r.wait,0);entries=r.entries;}
const stop=Q.reserve(entries,60,now+30);assert(stop.wait>59000);assert.equal(stop.entries.length,30);
assert.equal(Q.reserve(entries,60,now+60001).wait,0);
assert.equal(Q.classify(403,'Quota exceeded for Units per minute per user',''),'quota');
assert.equal(Q.classify(403,'Daily Limit Exceeded','dailyLimitExceeded'),'configuration');
assert.equal(Q.classify(403,'Insufficient permissions',''),'configuration');
assert.equal(Q.classify(401,'Invalid token',''),'auth');
assert.equal(Q.classify(429,'Too many requests',''),'quota');
assert.equal(Q.classify(503,'Unavailable',''),'temporary');
console.log('Quota costs, rolling window, and error classification passed');

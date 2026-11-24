(function(root){
'use strict';
const WINDOW=60000,BUDGET=1800;
function cost(path){
 const [route,query='']=String(path).split('?'),format=new URLSearchParams(query).get('format');
 if(route==='profile')return 1;
 if(route==='messages')return 5;
 if(/^messages\/[^/]+\/attachments\//.test(route))return 20;
 if(/^messages\/[^/]+$/.test(route))return ['minimal','metadata'].includes(format)?20:60;
 if(route==='threads')return 10;
 if(/^threads\/[^/]+$/.test(route))return format==='minimal'||format==='metadata'?40:120;
 if(route==='history')return 2;
 if(route==='labels'||route.startsWith('labels/'))return 1;
 return 120;
}
function reserve(entries,units,now,budget=BUDGET,windowMs=WINDOW){
 const recent=(Array.isArray(entries)?entries:[]).filter(x=>Array.isArray(x)&&Number.isFinite(x[0])&&Number.isFinite(x[1])&&x[1]>0&&x[0]>now-windowMs&&x[0]<=now).sort((a,b)=>a[0]-b[0]);
 let used=recent.reduce((n,x)=>n+x[1],0);
 if(units>budget)throw Error('Single request exceeds local quota budget');
 if(used+units<=budget)return {entries:[...recent,[now,units]],wait:0,used:used+units};
 for(const x of recent){used-=x[1];if(used+units<=budget)return {entries:recent,wait:Math.max(1,x[0]+windowMs-now+1),used};}
 return {entries:recent,wait:windowMs,used};
}
function classify(status,message,reasons){
 const text=String(message||'')+' '+String(reasons||'');
 if(status===401)return 'auth';
 if(status===403&&/units per minute per user|total query cost|user.?rate.?limit.?exceeded/i.test(text))return 'quota';
 if(status===403&&/daily.?limit|daily quota|billing|service.disabled|access.not.configured|insufficient.permissions/i.test(text))return 'configuration';
 if(status===429||status===403&&/quota|rate.?limit|resource.exhausted|too many requests/i.test(text))return 'quota';
 if(status>=500)return 'temporary';
 return 'other';
}
const api={WINDOW,BUDGET,cost,reserve,classify};root.LedgerQuota=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

const BUILD=17,CACHE='ledgermail-v'+BUILD;
const CORE=['./index.html','./styles.css?v=17','./quota.js?v=17','./app.js?v=17','./strict.js?v=17','./engine.js?v=17','./store.js?v=17'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
   const cache=await caches.open(CACHE);
   await Promise.allSettled(CORE.map(async path=>{
     const request=new Request(new URL(path,self.registration.scope),{cache:'reload'});
     const response=await fetch(request);
     if(response.ok)await cache.put(request,response);
   }));
   // A missing optional resource or a temporary network error must not strand the old worker.
   await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
   await Promise.all((await caches.keys()).filter(k=>k.startsWith('ledgermail-')&&k!==CACHE).map(k=>caches.delete(k)));
   await self.clients.claim();
   for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'LEDGERMAIL_RELEASE',build:BUILD});
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 // Version probes are never served from cache, even when offline.
 if(url.pathname.endsWith('/release.json')){event.respondWith(fetch(request,{cache:'no-store'}));return}
 if(request.mode==='navigate'){
   event.respondWith((async()=>{
     try{const response=await fetch(request,{cache:'no-store'});
       if(response.ok){const cache=await caches.open(CACHE);await cache.put(new URL('./index.html',self.registration.scope),response.clone());}
       return response;
     }catch{
       return (await caches.match(new URL('./index.html',self.registration.scope)))||new Response('LedgerMail is offline. Reconnect to update.',{status:503,headers:{'Content-Type':'text/plain'}});
     }
   })());return;
 }
 event.respondWith((async()=>{
   try{
     const response=await fetch(request,{cache:'no-store'});
     if(response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}
     return response;
   }catch{return (await caches.match(request))||new Response('Offline',{status:503})}
 })());
});

const C='foodos-alpha-v022';
const A=['./','./index.html','./config.js','./src/app.js','./src/barcode.js','./vendor/zxing-browser-0.1.5.min.js','./manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('foodos-alpha-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
  e.respondWith(fetch(e.request).then(response=>{
    if(response.ok&&A.some(asset=>new URL(asset,self.location.href).href===url.href)){
      const copy=response.clone();e.waitUntil(caches.open(C).then(cache=>cache.put(e.request,copy)));
    }
    return response;
  }).catch(()=>caches.match(e.request).then(cached=>{if(cached)return cached;throw new Error('Offline and not cached');})));
});

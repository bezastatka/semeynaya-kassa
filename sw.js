/* Семейная касса — офлайн-кэш оболочки приложения.
   Свои файлы: сначала сеть (чтобы обновления приходили сразу), без сети — из кэша.
   Шрифты и библиотеки с CDN: из кэша. Запросы к базе не кэшируются. */
const VERSION="kassa-v1";
const SHELL=["./","index.html","app.css","js/config.js","js/backend.js","js/app.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-32.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);
  if(/supabase\.co$/.test(u.hostname))return;
  if(u.origin===location.origin){e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(VERSION).then(x=>x.put(r,c))}return res}).catch(()=>caches.match(r).then(m=>m||caches.match("index.html"))));return}
  if(/(jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname))
    e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{if(res.ok||res.type==="opaque"){const c=res.clone();caches.open(VERSION).then(x=>x.put(r,c))}return res})))});

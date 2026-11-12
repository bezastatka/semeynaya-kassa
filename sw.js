/* Семейная касса — офлайн-кэш оболочки приложения.
   Свои файлы: сначала сеть (чтобы обновления приходили сразу); без сети или если сеть
   не ответила за 4 секунды — из кэша. Шрифты и библиотеки лежат в самом приложении. Запросы к базе не кэшируются здесь (их кэширует приложение). */
const VERSION="kassa-v17";
const SHELL=["./","index.html","app.css","css/fonts.css","js/theme.js","js/i18n.js","js/i18n-en.js","js/vendor/supabase.js","js/config.js","js/backend.js","js/native.js","js/app.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-32.png",
  "fonts/golos-text-cyrillic-400-normal.woff2","fonts/golos-text-cyrillic-500-normal.woff2","fonts/golos-text-cyrillic-600-normal.woff2","fonts/golos-text-latin-400-normal.woff2","fonts/golos-text-latin-500-normal.woff2","fonts/golos-text-latin-600-normal.woff2","fonts/unbounded-cyrillic-500-normal.woff2","fonts/unbounded-cyrillic-700-normal.woff2","fonts/unbounded-latin-500-normal.woff2","fonts/unbounded-latin-700-normal.woff2"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:"no-cache"})))).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const fromCache=r=>caches.match(r,{ignoreSearch:r.mode==="navigate"}).then(m=>m||(r.mode==="navigate"?caches.match("index.html"):undefined));
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);
  if(/supabase\.co$/.test(u.hostname))return;
  if(u.origin===location.origin){
    /* no-cache: always ask the server (a cheap 304 when unchanged), so a new release never mixes with files the browser kept for 10 minutes */
    const net=fetch(r.url,{cache:"no-cache",credentials:"same-origin"}).then(res=>{if(res.ok){const c=res.clone();caches.open(VERSION).then(x=>x.put(r,c))}return res});
    e.respondWith(new Promise(resolve=>{let done=false;const give=v=>{if(!done&&v){done=true;resolve(v)}};
      const t=setTimeout(()=>fromCache(r).then(give),4000);
      net.then(res=>{clearTimeout(t);give(res)},()=>{clearTimeout(t);fromCache(r).then(m=>{if(m)give(m);else{done=true;resolve(Response.error())}})})}));
    return}});

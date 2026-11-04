/* Семейная касса — слой данных поверх Supabase.
   Даёт приложению тот же интерфейс, что был на claude.ai (claude.use("db"|"user"|"downloads")),
   поэтому основной код приложения почти не менялся. */
(function(){
  const CFG=window.KASSA_CONFIG||{};
  const ready=!!(CFG.supabaseUrl&&CFG.supabaseKey&&window.supabase);
  /* a request that hangs on a bad connection is cut after 20 s and treated as "no network" */
  const tfetch=(u,o)=>{o=o||{};if(o.signal)return fetch(u,o);const c=new AbortController(),t=setTimeout(()=>c.abort(),20000);return fetch(u,{...o,signal:c.signal}).finally(()=>clearTimeout(t))};
  const sb=ready?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:tfetch}}):null;
  window.KASSA={sb,ready};
  let session=null,uid=null;

  /* ---------- errors in the shape the app expects ---------- */
  function err(e){if(e&&e.code&&typeof e.code==="string"&&/^(invalid_argument|unavailable|quota_exceeded|denied|not_found)$/.test(e.code))return e;
    const msg=String((e&&(e.message||e.error_description))||e||"");
    let code="unavailable";
    if(/too_many_attempts/.test(msg))code="rate_limited";
    else if(e&&(e.code==="42501"||/row-level security|permission denied/i.test(msg)))code="denied";
    else if(e&&(e.code==="P0002"||/not_found/.test(msg)))code="not_found";
    else if(e&&(e.code==="23514"||e.code==="22P02"||e.code==="23505"))code="invalid_argument_data";
    return {code,message:msg}}

  /* ---------- paths ---------- */
  const SEG=/^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  function check(path,even){const p=String(path).split("/");if(!p.every(s=>SEG.test(s)&&s!=="."&&s!==".."))throw new TypeError(T("Неверный путь: ")+path);
    if((p.length%2===0)!==even)throw new TypeError(T("Неверное число сегментов: ")+path);return p}
  const parentOf=path=>path.split("/").slice(0,-1).join("/");
  const rid=()=>{const a="abcdefghijklmnopqrstuvwxyz0123456789",r=new Uint32Array(20);crypto.getRandomValues(r);let s="";for(const x of r)s+=a[x%a.length];return s};

  /* ---------- live updates: one channel, many listeners ---------- */
  /* while the live channel works, data is re-read only on changes; polling is a fallback for when it is down.
     A change event carries the changed record itself, so open lists apply it in place instead of re-reading. */
  const listeners=new Set();let channel=null,live=false,wasLive=false,hiddenAt=0;
  const hitAll=()=>{for(const l of listeners)l.hit("",null)};
  function changeOf(payload){const ev=payload.eventType,nw=payload.new&&payload.new.path?payload.new:null,old=payload.old&&payload.old.path?payload.old:null;
    const path=(nw||old||{}).path||"";if(!path)return {path:"",ch:null};
    if(payload.errors&&payload.errors.length)return {path,ch:null};
    if(ev==="DELETE")return {path,ch:{path,data:undefined}};
    if((ev==="INSERT"||ev==="UPDATE")&&nw&&nw.data&&typeof nw.data==="object")return {path,ch:{path,data:nw.data}};
    return {path,ch:null}}
  function ensureChannel(){if(channel||!sb)return;
    channel=sb.channel("docs-live").on("postgres_changes",{event:"*",schema:"public",table:"docs"},payload=>{
      const {path,ch}=changeOf(payload);for(const l of listeners)l.hit(path,ch)}).subscribe(st=>{const now=st==="SUBSCRIBED";if(now&&wasLive&&!live)hitAll();live=now;if(now)wasLive=true})}
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){hiddenAt=Date.now();return}
    if(hiddenAt&&Date.now()-hiddenAt>30000)hitAll();hiddenAt=0});
  /* apply(change) returns true when the change was handled in place; otherwise the list is re-read */
  function listen(match,refetch,apply){let t=null,at=Date.now();const run=()=>{at=Date.now();refetch()};
    const l={hit:(path,ch)=>{if(path&&!match(path))return;if(path&&ch&&apply&&apply(ch))return;clearTimeout(t);t=setTimeout(run,150)}};listeners.add(l);ensureChannel();
    const iv=setInterval(()=>{if(document.visibilityState==="visible"&&Date.now()-at>(live?300000:55000))run()},60000);
    return ()=>{listeners.delete(l);clearTimeout(t);clearInterval(iv)}}
  /* the same text comparison the database does on data->>field */
  const txt=v=>v==null?null:typeof v==="object"?null:String(v);
  function rowMatches(row,filters){const d=row.data||{};
    for(const [f,op,v] of filters){const raw=d[f],t=txt(raw);
      if(op==="array-contains"){if(!Array.isArray(raw)||!raw.some(x=>x===v))return false;continue}
      if(t===null)return false;
      if(op==="=="&&!(t===String(v)))return false;if(op==="!="&&!(t!==String(v)))return false;
      if(op==="in"&&!(v||[]).map(String).includes(t))return false;if(op==="not-in"&&(v||[]).map(String).includes(t))return false;
      if(op==="<"&&!(t<String(v)))return false;if(op==="<="&&!(t<=String(v)))return false;if(op===">"&&!(t>String(v)))return false;if(op===">="&&!(t>=String(v)))return false}
    return true}
  const plain=v=>v==null||/^[\x20-\x7e]*$/.test(v);

  /* ---------- offline ----------
     Every list and document read is kept on the device (IndexedDB), so the app opens without a network.
     Operations and debts written without a network go to an outbox (localStorage) and are sent in order
     once the connection is back; until then they are shown as if saved. Other changes need the network. */
  const NETRX=/Failed to fetch|NetworkError|Load failed|network|fetch failed|abort|ERR_INTERNET|ERR_NETWORK|timed? ?out/i;
  const offlineErr=()=>{const e=new Error("offline");e.code="offline";return e};
  const isNet=(error,status)=>navigator.onLine===false||status===0&&!(error&&error.code)||!!error&&!error.code&&NETRX.test(String(error.message||error));
  const fail=(error,status)=>isNet(error,status)?offlineErr():err(error);
  const idb=(()=>{let p=null;const open=()=>p||(p=new Promise((res,rej)=>{if(!window.indexedDB)return rej(new Error("no idb"));const r=indexedDB.open("kassa",1);
      r.onupgradeneeded=()=>r.result.createObjectStore("q");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}));
    const tx=(mode,fn)=>open().then(d=>new Promise(res=>{const t=d.transaction("q",mode),q=fn(t.objectStore("q"));t.oncomplete=()=>res(q&&q.result);t.onerror=t.onabort=()=>res(undefined)})).catch(()=>undefined);
    return {get:k=>tx("readonly",s=>s.get(k)),put:(k,v)=>tx("readwrite",s=>s.put(v,k)),clear:()=>tx("readwrite",s=>s.clear())}})();
  const ckey=k=>uid+"|"+k;
  const queueable=path=>/\/(expenses|debts)\/[^/]+$/.test(path);
  const known=new Map();
  let outbox=[],flushing=false,lastSync=null;
  const obKey=()=>"fk.outbox."+uid;
  function loadOutbox(){try{outbox=JSON.parse(localStorage.getItem(obKey())||"[]");if(!Array.isArray(outbox))outbox=[]}catch(e){outbox=[]}}
  function saveOutbox(){try{if(outbox.length)localStorage.setItem(obKey(),JSON.stringify(outbox));else localStorage.removeItem(obKey())}catch(e){}syncEvt()}
  function syncEvt(){try{window.dispatchEvent(new CustomEvent("kassa:sync",{detail:{pending:outbox.length,online:navigator.onLine!==false,flushing,last:lastSync}}))}catch(e){}}
  function enqueue(e){e.at=Date.now();if(e.op==="update")e.full=known.has(e.path)?{...known.get(e.path),...e.data}:null;
    if(e.op==="set")known.set(e.path,e.data);else if(e.op==="update"&&e.full)known.set(e.path,e.full);else if(e.op==="delete")known.delete(e.path);
    outbox.push(e);saveOutbox();
    const ch={path:e.path,data:e.op==="delete"?undefined:e.op==="set"?e.data:e.full};
    for(const l of listeners)l.hit(e.path,ch.data===null?null:ch);
    setTimeout(flush,0);return {queued:true}}
  /* the outbox laid over a list read from the database or the device */
  function overlayRows(col,rows,filters,order,max){if(!outbox.length)return rows;let out=null;
    for(const e of outbox){if(parentOf(e.path)!==col)continue;out=out||rows.slice();const i=out.findIndex(r=>r.path===e.path);
      const base=i>=0?out[i].data:null,data=e.op==="delete"?null:e.op==="set"?e.data:base?{...base,...e.data}:e.full;
      if(i>=0)out.splice(i,1);if(data&&rowMatches({data},filters))out.push({path:e.path,data})}
    if(!out)return rows;sortBy(out,order);return out.slice(0,max)}
  function overlayDoc(path,data){for(const e of outbox){if(e.path!==path)continue;data=e.op==="delete"?undefined:e.op==="set"?e.data:data!==undefined?{...data,...e.data}:e.full||undefined}return data}
  async function flush(){if(flushing||!outbox.length||!uid||navigator.onLine===false)return;flushing=true;syncEvt();let sent=0,dropped=0;
    try{while(outbox.length){const e=outbox[0];let r;
        try{if(e.op==="set")r=await sb.from("docs").upsert({path:e.path,parent:parentOf(e.path),data:e.data,updated_at:new Date().toISOString()},{onConflict:"path"});
          else if(e.op==="update")r=await sb.rpc("doc_update",{p_path:e.path,p_patch:e.data});
          else r=await sb.from("docs").delete().eq("path",e.path)}catch(x){r={error:x,status:0}}
        if(r.error){if(isNet(r.error,r.status))break;dropped++}else sent++;
        outbox.shift();saveOutbox()}}
    finally{flushing=false}
    if(sent||dropped){lastSync={sent,dropped,at:Date.now()};hitAll()}syncEvt()}
  addEventListener("online",()=>{syncEvt();flush();hitAll()});addEventListener("offline",syncEvt);
  setInterval(()=>{if(outbox.length&&document.visibilityState==="visible")flush()},15000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")flush()});

  /* ---------- documents ---------- */
  let noCAS=false; /* the database has no doc_update_if yet (schema not updated): plain updates */
  const snap=(id,data)=>({id,exists:data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
  function docRef(path){const p=check(path,true);return {id:p[p.length-1],path,
    async get(){let v;const k=ckey("doc:"+path);
      try{const {data,error,status}=await sb.from("docs").select("data").eq("path",path).maybeSingle();if(error)throw fail(error,status);v=data?data.data:undefined;
        if(v!==undefined)known.set(path,v);idb.put(k,v===undefined?null:v);if(outbox.length)setTimeout(flush,0)}
      catch(e){if(e.code!=="offline")throw e;const c=await idb.get(k);if(c===undefined)throw e;v=c===null?undefined:c}
      return snap(p[p.length-1],overlayDoc(path,v))},
    async set(d){if(queueable(path)&&(outbox.length||navigator.onLine===false))return enqueue({op:"set",path,data:d});
      const {error,status}=await sb.from("docs").upsert({path,parent:parentOf(path),data:d,updated_at:new Date().toISOString()},{onConflict:"path"});
      if(error){if(queueable(path)&&isNet(error,status))return enqueue({op:"set",path,data:d});throw fail(error,status)}known.set(path,d)},
    async update(d){if(queueable(path)&&(outbox.length||navigator.onLine===false))return enqueue({op:"update",path,data:d});
      const {error,status}=await sb.rpc("doc_update",{p_path:path,p_patch:d});
      if(error){if(queueable(path)&&isNet(error,status))return enqueue({op:"update",path,data:d});const e=fail(error,status);if(e.code==="not_found")e.code="invalid_argument";throw e}
      if(known.has(path))known.set(path,{...known.get(path),...d})},
    /* applies the patch only if the listed fields still hold the expected values; false = someone changed them */
    async updateIf(d,expect){if(noCAS){await this.update(d);return true}
      const {data,error,status}=await sb.rpc("doc_update_if",{p_path:path,p_patch:d,p_expect:expect});
      if(error){if(isNet(error,status))throw offlineErr();if(/PGRST202|42883|doc_update_if/.test(String(error.code)+" "+String(error.message))){noCAS=true;await this.update(d);return true}
        const e=err(error);if(e.code==="not_found")e.code="invalid_argument";throw e}
      return data===true},
    async delete(){if(queueable(path)&&(outbox.length||navigator.onLine===false))return enqueue({op:"delete",path});
      const {error,status}=await sb.from("docs").delete().eq("path",path);
      if(error){if(queueable(path)&&isNet(error,status))return enqueue({op:"delete",path});throw fail(error,status)}known.delete(path)},
    onSnapshot(next,onErr){let dead=false,busy=false,again=false,ready=false;
      const run=()=>{if(busy){again=true;return}busy=true;again=false;
        this.get().then(s=>{busy=false;if(dead)return;ready=true;if(again)return run();next(s)},e=>{busy=false;if(again)return run();if(!dead&&onErr&&e.code!=="unavailable")onErr(e)})};
      const apply=ch=>{if(busy){again=true;return true}if(!ready)return false;if(!dead){next(snap(p[p.length-1],overlayDoc(path,ch.data)));idb.put(ckey("doc:"+path),ch.data===undefined?null:ch.data)}return true};
      run();const off=listen(x=>x===path,run,apply);return ()=>{dead=true;off()}},
    collection(sub){return colRef(path+"/"+sub)}}}
  const result=data=>{const docs=data.map(r=>snap(r.path.split("/").pop(),r.data));return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}};
  /* database order: by data->>field (nulls last ascending, first descending) or by path */
  function sortBy(list,order){if(!order){list.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return}
    const f=order[0],desc=order[1]==="desc";
    list.sort((a,b)=>{const x=txt(a.data&&a.data[f]),y=txt(b.data&&b.data[f]);
      if(x===y)return 0;if(x===null)return desc?-1:1;if(y===null)return desc?1:-1;return (x<y?-1:1)*(desc?-1:1)})}
  function query(col,filters,order,lim){const max=Math.min(lim||1000,1000),qkey="q:"+col+"|"+JSON.stringify(filters)+"|"+JSON.stringify(order)+"|"+max;
    const build=()=>{let q=sb.from("docs").select("path,data").eq("parent",col);
      for(const [f,op,v] of filters){const k="data->>"+f;
        if(op==="==")q=q.eq(k,String(v));else if(op==="!=")q=q.neq(k,String(v));
        else if(op==="in")q=q.in(k,(v||[]).map(String));else if(op==="not-in")q=q.not(k,"in","("+(v||[]).map(x=>'"'+String(x).replace(/"/g,'')+'"').join(",")+")");
        else if(op==="<")q=q.lt(k,String(v));else if(op==="<=")q=q.lte(k,String(v));else if(op===">")q=q.gt(k,String(v));else if(op===">=")q=q.gte(k,String(v));
        else if(op==="array-contains")q=q.contains("data->"+f,JSON.stringify([v]));}
      if(order)q=q.order("data->>"+order[0],{ascending:order[1]!=="desc"});else q=q.order("path",{ascending:true});
      return q.limit(Math.min(lim||1000,1000))};
    const api={
      where(f,op,v){return query(col,[...filters,[f,op,v]],order,lim)},
      orderBy(f,dir){return query(col,filters,[f,dir||"asc"],lim)},
      limit(n){return query(col,filters,order,n)},
      async rows(){let r;try{r=await build()}catch(x){throw offlineErr()}const {data,error,status}=r;if(error)throw fail(error,status);
        for(const x of data)known.set(x.path,x.data);idb.put(ckey(qkey),data);if(outbox.length)setTimeout(flush,0);return data},
      /* from the database, or from the device when there is no network */
      async rowsOr(){try{return await api.rows()}catch(e){if(e.code!=="offline")throw e;const c=await idb.get(ckey(qkey));if(!c)throw e;return c}},
      async get(){return result(overlayRows(col,await api.rowsOr(),filters,order,max))},
      /* keeps the last result and applies change events to it; falls back to a re-read when the outcome is uncertain */
      onSnapshot(next,onErr){let dead=false,busy=false,again=false,rows=null,emitT=null;
        const out=()=>result(overlayRows(col,rows,filters,order,max));
        const emit=()=>{clearTimeout(emitT);emitT=setTimeout(()=>{if(!dead&&rows){next(out());idb.put(ckey(qkey),rows)}},20)};
        const run=()=>{if(busy){again=true;return}busy=true;again=false;
          api.rowsOr().then(r=>{busy=false;if(dead)return;rows=r;if(again)return run();clearTimeout(emitT);next(out())},
            e=>{busy=false;if(again)return run();if(!dead&&onErr&&e.code!=="unavailable")onErr(e)})};
        const apply=ch=>{if(ch.data!==undefined)known.set(ch.path,ch.data);if(busy){again=true;return true}if(!rows)return false;if(!order&&rows.length>=max)return false;
          const i=rows.findIndex(r=>r.path===ch.path),hit=ch.data!==undefined&&rowMatches({data:ch.data},filters);
          if(i<0&&!hit)return true;
          if(i>=0&&!hit&&rows.length>=max)return false;
          const next2=rows.filter(r=>r.path!==ch.path);
          if(hit){const v=order?txt(ch.data[order[0]]):ch.path;if(!plain(v))return false;next2.push({path:ch.path,data:ch.data})}
          sortRows(next2);if(next2.length>max){if(next2[max].path===ch.path)return true;next2.length=max}
          else if(i>=0&&hit&&next2.length>=max&&next2[max-1].path===ch.path)return false; /* moved to the end of a full list: a row beyond it may now rank higher */
          rows=next2;emit();return true};
        run();const off=listen(x=>parentOf(x)===col,run,apply);return ()=>{dead=true;clearTimeout(emitT);off()}}};
    const sortRows=list=>sortBy(list,order);
    return api}
  function colRef(path){check(path,false);const q=query(path,[],null,null);return {...q,path,
    doc(id){return docRef(path+"/"+(id||rid()))},
    async deleteAll(){const {error}=await sb.from("docs").delete().eq("parent",path);if(error)throw err(error)},
    /* every change in this collection, as {id,data} (data undefined = deleted); null when the change itself is unknown */
    watch(cb){return listen(x=>parentOf(x)===path,()=>cb(null),ch=>{cb({id:ch.path.split("/").pop(),data:ch.data});return true})},
    async add(d){const r=docRef(path+"/"+rid());await r.set(d);return r}}}
  const db={doc:docRef,collection:colRef,
    async joinByCode(code){const {data,error}=await sb.rpc("join_account",{p_code:code});if(error)throw err(error);return data||null},
    async usage(){const {data,error}=await sb.rpc("my_usage");if(error)throw err(error);return data}};

  /* ---------- people ---------- */
  const nameCache={};
  const user={
    async id(){return uid},async isOwner(){return true},async canEdit(){return true},async can(){return true},
    async me(){return {id:uid,name:nameCache[uid]||"",avatarUrl:"",color:"#888",email:session&&session.user.email||null,isOwner:true,canEdit:true}},
    async profiles(ids){ids=[...new Set([].concat(ids||[]))].filter(Boolean);const need=ids.filter(i=>!(i in nameCache)&&/^[0-9a-f-]{36}$/.test(i));
      if(need.length){const {data}=await sb.from("profiles").select("id,name").in("id",need);for(const i of need)nameCache[i]="";for(const r of data||[])nameCache[r.id]=r.name||""}
      return Object.fromEntries(ids.map(i=>[i,{id:i,name:nameCache[i]||"",avatarUrl:"",color:"#888",email:null,isMe:i===uid,guest:false}]))}};

  /* ---------- files to the viewer ---------- */
  const downloads={async save({filename,data}){const blob=data instanceof Blob?data:new Blob([data],{type:/\.csv$/.test(filename)?"text/csv;charset=utf-8":/\.json$/.test(filename)?"application/json":"application/octet-stream"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);return {status:"saved"}}};

  /* ---------- sign-in screen ---------- */
  let signedIn=null;const whenSignedIn=new Promise(r=>signedIn=r);
  function setSession(s){session=s;uid=s&&s.user?s.user.id:null;if(uid){loadOutbox();setTimeout(flush,1500);document.getElementById("authScreen").hidden=true;document.body.classList.remove("auth");signedIn()}}
  async function saveName(name){if(!uid||!name)return;nameCache[uid]=name;await sb.from("profiles").upsert({id:uid,name:name.slice(0,60),updated_at:new Date().toISOString()})}
  function showAuth(){const box=document.getElementById("authScreen");box.hidden=false;document.body.classList.add("auth");
    const $=id=>document.getElementById(id),say=(id,t,bad)=>{$(id).textContent=t||"";$(id).classList.toggle("bad",!!bad)},msg=(t,bad)=>say("auMsg",t,bad);
    let mode="in",codeType="signup",codeEmail="",cool=0,coolT=null;
    const setMode=m=>{mode=m;$("auNameRow").hidden=m!=="up";$("auPassRow").hidden=m==="code";
      $("auPass").autocomplete=m==="up"?"new-password":"current-password";
      $("auGo").textContent=m==="up"?T("Создать аккаунт"):m==="code"?T("Прислать код"):T("Войти");
      for(const b of document.querySelectorAll("#auTabs button"))b.setAttribute("aria-checked",String(b.dataset.m===m));msg("")};
    for(const b of document.querySelectorAll("#auTabs button"))b.onclick=()=>setMode(b.dataset.m);
    const tick=()=>{const b=$("auResend");if(cool>0){b.disabled=true;b.textContent=T("Отправить ещё раз через ")+cool+T(" с");cool--;coolT=setTimeout(tick,1000)}else{b.disabled=false;b.textContent=T("Отправить код ещё раз")}};
    const startCool=()=>{clearTimeout(coolT);cool=60;tick()};
    const showCode=(email,type,text)=>{codeEmail=email;codeType=type;$("auForm").hidden=true;$("auTabs").hidden=true;$("auCodeStep").hidden=false;
      $("auCodeText").textContent=text||(T("Мы отправили код на ")+email+T(". Введите его, чтобы продолжить."));say("auCodeMsg","");$("auCode").value="";startCool();setTimeout(()=>$("auCode").focus(),50)};
    const hideCode=()=>{$("auCodeStep").hidden=true;$("auForm").hidden=false;$("auTabs").hidden=false;clearTimeout(coolT)};
    const human=t=>/Invalid login/i.test(t)?T("Неверная почта или пароль."):/already registered/i.test(t)?T("Такой аккаунт уже есть — войдите с паролем."):
      /rate limit|security purposes|only request this after/i.test(t)?T("Слишком часто. Подождите минуту и попробуйте снова."):/expired|invalid/i.test(t)?T("Код неверный или устарел. Проверьте письмо или запросите новый код."):
      /Signups not allowed|not found/i.test(t)?T("Аккаунта с такой почтой нет. Откройте «Регистрация»."):/sending.*email|smtp/i.test(t)?T("Не удалось отправить письмо. Проверьте настройки почты в Supabase."):T("Не получилось: ")+t;
    $("auForm").onsubmit=async ev=>{ev.preventDefault();const email=$("auEmail").value.trim().toLowerCase(),pass=$("auPass").value,name=$("auName").value.trim();
      if(!/^\S+@\S+\.\S+$/.test(email))return msg(T("Введите адрес почты."),true);
      if(mode!=="code"&&pass.length<6)return msg(T("Пароль — не короче 6 символов."),true);
      if(mode==="up"&&!name)return msg(T("Как вас называть? Это имя увидят участники общих счетов."),true);
      $("auGo").disabled=true;msg(T("Подождите…"));
      try{if(mode==="code"){const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false}});if(error)throw error;msg("");showCode(email,"email")}
        else if(mode==="up"){const {data,error}=await sb.auth.signUp({email,password:pass,options:{data:{name}}});if(error)throw error;
          if(data.session){setSession(data.session);await saveName(name)}
          else if(data.user&&Array.isArray(data.user.identities)&&!data.user.identities.length)msg(T("Такой аккаунт уже есть — войдите с паролем."),true);
          else{msg("");showCode(email,"signup",T("Мы отправили код подтверждения на ")+email+T(". Введите его, чтобы закончить регистрацию."))}}
        else{const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
          if(error&&/not confirmed/i.test(error.message)){await sb.auth.resend({type:"signup",email}).catch(()=>{});msg("");showCode(email,"signup",T("Почта ещё не подтверждена. Мы отправили код на ")+email+T(" — введите его."));return}
          if(error)throw error;setSession(data.session)}}
      catch(e){msg(human(String(e.message||e)),true)}
      finally{$("auGo").disabled=false}};
    const verify=async()=>{const token=$("auCode").value.replace(/\D/g,"");
      if(token.length<6)return say("auCodeMsg",T("Введите код из письма — 6 цифр или больше."),true);
      $("auVerify").disabled=true;say("auCodeMsg",T("Проверяем…"));
      try{const {data,error}=await sb.auth.verifyOtp({email:codeEmail,token,type:codeType});if(error)throw error;
        say("auCodeMsg","");setSession(data.session);const n=data.user&&data.user.user_metadata&&data.user.user_metadata.name;if(n)await saveName(n)}
      catch(e){say("auCodeMsg",human(String(e.message||e)),true)}finally{$("auVerify").disabled=false}};
    $("auVerify").onclick=verify;
    $("auCode").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();verify()}});
    $("auCode").addEventListener("input",e=>{const v=e.target.value.replace(/\D/g,"");if(v!==e.target.value)e.target.value=v});
    $("auResend").onclick=async()=>{if(cool>0)return;say("auCodeMsg",T("Отправляем…"));
      try{const r=codeType==="signup"?await sb.auth.resend({type:"signup",email:codeEmail}):await sb.auth.signInWithOtp({email:codeEmail,options:{shouldCreateUser:false}});
        if(r.error)throw r.error;say("auCodeMsg",T("Новый код отправлен."));startCool()}catch(e){say("auCodeMsg",human(String(e.message||e)),true)}};
    $("auBack").onclick=()=>{hideCode();msg("")};
    setMode("in");
    if(new URLSearchParams(location.search).get("deleted")==="1"){msg(T("Аккаунт и ваши данные удалены. Спасибо, что пользовались «Семейной кассой»."));history.replaceState(null,"",location.pathname)}}
  async function boot(){if(!sb){document.getElementById("authScreen").hidden=false;document.getElementById("auForm").hidden=true;
      document.getElementById("auMsg").textContent=T("Приложение ещё не подключено к базе: заполните js/config.js.");return}
    const {data}=await sb.auth.getSession();
    sb.auth.onAuthStateChange((ev,s)=>{if(s&&s.user&&!uid){setSession(s);const n=s.user.user_metadata&&s.user.user_metadata.name;if(n)saveName(n)}
      if(ev==="SIGNED_OUT"){location.reload()}});
    if(data.session){setSession(data.session);const {data:p}=await sb.from("profiles").select("name").eq("id",uid).maybeSingle();
      if(!p){const n=data.session.user.user_metadata&&data.session.user.user_metadata.name;await saveName(n||String(data.session.user.email||"").split("@")[0])}else nameCache[uid]=p.name}
    else showAuth()}
  window.KASSA.deleteAccount=async()=>{const {error,status}=await sb.rpc("delete_my_account");if(error)throw fail(error,status);await idb.clear();
    try{for(const k of Object.keys(localStorage))if(k!=="fk.lang"&&(k.startsWith("fk.")||k.startsWith("sb-")))localStorage.removeItem(k)}catch(e){}
    location.replace(location.pathname+"?deleted=1")};
  window.KASSA.signOut=async()=>{await flush();try{localStorage.removeItem(obKey())}catch(e){}await idb.clear();await sb.auth.signOut();location.reload()};
  window.KASSA.sync={pending:()=>outbox.length,online:()=>navigator.onLine!==false,flush,last:()=>lastSync,has:id=>outbox.some(e=>e.path.endsWith("/"+id))};
  window.KASSA.email=()=>session&&session.user?session.user.email:"";
  window.KASSA.myName=()=>nameCache[uid]||"";
  window.KASSA.setName=saveName;

  /* ---------- the same entry point the app used on claude.ai ---------- */
  window.claude={async use(name){if(!sb)return null;await whenSignedIn;return name==="db"?db:name==="user"?user:name==="downloads"?downloads:null}};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();

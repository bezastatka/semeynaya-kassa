/* Семейная касса — слой данных поверх Supabase.
   Даёт приложению тот же интерфейс, что был на claude.ai (claude.use("db"|"user"|"downloads")),
   поэтому основной код приложения почти не менялся. */
(function(){
  const CFG=window.KASSA_CONFIG||{};
  const ready=!!(CFG.supabaseUrl&&CFG.supabaseKey&&window.supabase);
  const sb=ready?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
  window.KASSA={sb,ready};
  let session=null,uid=null;

  /* ---------- errors in the shape the app expects ---------- */
  function err(e){if(e&&e.code&&typeof e.code==="string"&&/^(invalid_argument|unavailable|quota_exceeded|denied|not_found)$/.test(e.code))return e;
    const msg=String((e&&(e.message||e.error_description))||e||"");
    let code="unavailable";
    if(e&&(e.code==="42501"||/row-level security|permission denied/i.test(msg)))code="denied";
    else if(e&&(e.code==="P0002"||/not_found/.test(msg)))code="not_found";
    else if(e&&(e.code==="23514"||e.code==="22P02"||e.code==="23505"))code="invalid_argument_data";
    return {code,message:msg}}

  /* ---------- paths ---------- */
  const SEG=/^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  function check(path,even){const p=String(path).split("/");if(!p.every(s=>SEG.test(s)&&s!=="."&&s!==".."))throw new TypeError("Неверный путь: "+path);
    if((p.length%2===0)!==even)throw new TypeError("Неверное число сегментов: "+path);return p}
  const parentOf=path=>path.split("/").slice(0,-1).join("/");
  const rid=()=>{const a="abcdefghijklmnopqrstuvwxyz0123456789",r=new Uint32Array(20);crypto.getRandomValues(r);let s="";for(const x of r)s+=a[x%a.length];return s};

  /* ---------- live updates: one channel, many listeners ---------- */
  const listeners=new Set();let channel=null;
  function ensureChannel(){if(channel||!sb)return;
    channel=sb.channel("docs-live").on("postgres_changes",{event:"*",schema:"public",table:"docs"},payload=>{
      const path=(payload.new&&payload.new.path)||(payload.old&&payload.old.path)||"";
      for(const l of listeners)l.hit(path)}).subscribe()}
  function listen(match,refetch){let t=null;const l={hit:path=>{if(path&&!match(path))return;clearTimeout(t);t=setTimeout(refetch,150)}};listeners.add(l);ensureChannel();
    const onVis=()=>{if(document.visibilityState==="visible")l.hit("")};document.addEventListener("visibilitychange",onVis);
    const iv=setInterval(()=>{if(document.visibilityState==="visible")refetch()},60000);
    return ()=>{listeners.delete(l);clearTimeout(t);clearInterval(iv);document.removeEventListener("visibilitychange",onVis)}}

  /* ---------- documents ---------- */
  const snap=(id,data)=>({id,exists:data!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
  function docRef(path){const p=check(path,true);return {id:p[p.length-1],path,
    async get(){const {data,error}=await sb.from("docs").select("data").eq("path",path).maybeSingle();if(error)throw err(error);return snap(p[p.length-1],data?data.data:undefined)},
    async set(d){const {error}=await sb.from("docs").upsert({path,parent:parentOf(path),data:d,updated_at:new Date().toISOString()},{onConflict:"path"});if(error)throw err(error)},
    async update(d){const {error}=await sb.rpc("doc_update",{p_path:path,p_patch:d});if(error){const e=err(error);if(e.code==="not_found")e.code="invalid_argument";throw e}},
    async delete(){const {error}=await sb.from("docs").delete().eq("path",path);if(error)throw err(error)},
    onSnapshot(next,onErr){let dead=false;const run=()=>this.get().then(s=>{if(!dead)next(s)},e=>{if(!dead&&onErr&&e.code!=="unavailable")onErr(e)});
      run();const off=listen(x=>x===path,run);return ()=>{dead=true;off()}},
    collection(sub){return colRef(path+"/"+sub)}}}
  function query(col,filters,order,lim){
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
      async get(){const {data,error}=await build();if(error)throw err(error);
        const docs=data.map(r=>snap(r.path.split("/").pop(),r.data));return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}},
      onSnapshot(next,onErr){let dead=false;const run=()=>api.get().then(s=>{if(!dead)next(s)},e=>{if(!dead&&onErr&&e.code!=="unavailable")onErr(e)});
        run();const off=listen(x=>parentOf(x)===col,run);return ()=>{dead=true;off()}}};
    return api}
  function colRef(path){check(path,false);const q=query(path,[],null,null);return {...q,path,
    doc(id){return docRef(path+"/"+(id||rid()))},
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
  function setSession(s){session=s;uid=s&&s.user?s.user.id:null;if(uid){document.getElementById("authScreen").hidden=true;document.body.classList.remove("auth");signedIn()}}
  async function saveName(name){if(!uid||!name)return;nameCache[uid]=name;await sb.from("profiles").upsert({id:uid,name:name.slice(0,60),updated_at:new Date().toISOString()})}
  function showAuth(){const box=document.getElementById("authScreen");box.hidden=false;document.body.classList.add("auth");
    const $=id=>document.getElementById(id),msg=(t,bad)=>{$("auMsg").textContent=t||"";$("auMsg").classList.toggle("bad",!!bad)};
    let mode="in";
    const setMode=m=>{mode=m;$("auNameRow").hidden=m!=="up";$("auPassRow").hidden=m==="link";$("auGo").textContent=m==="up"?"Создать аккаунт":m==="link"?"Прислать ссылку для входа":"Войти";
      for(const b of document.querySelectorAll("#auTabs button"))b.setAttribute("aria-checked",String(b.dataset.m===m));msg("")};
    for(const b of document.querySelectorAll("#auTabs button"))b.onclick=()=>setMode(b.dataset.m);
    setMode("in");
    $("auForm").onsubmit=async ev=>{ev.preventDefault();const email=$("auEmail").value.trim(),pass=$("auPass").value,name=$("auName").value.trim();
      if(!/^\S+@\S+\.\S+$/.test(email))return msg("Введите адрес почты.",true);
      if(mode!=="link"&&pass.length<6)return msg("Пароль — не короче 6 символов.",true);
      if(mode==="up"&&!name)return msg("Как вас называть? Это имя увидят участники общих счетов.",true);
      $("auGo").disabled=true;msg("Подождите…");
      try{const redirect=location.origin+location.pathname;
        if(mode==="link"){const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:redirect}});if(error)throw error;msg("Письмо отправлено. Откройте ссылку из него на этом устройстве.")}
        else if(mode==="up"){const {data,error}=await sb.auth.signUp({email,password:pass,options:{emailRedirectTo:redirect,data:{name}}});if(error)throw error;
          if(data.session){setSession(data.session);await saveName(name)}else msg("Мы отправили письмо для подтверждения. Откройте ссылку из него, затем войдите с паролем.")}
        else{const {data,error}=await sb.auth.signInWithPassword({email,password:pass});if(error)throw error;setSession(data.session)}}
      catch(e){const t=String(e.message||e);
        msg(/Invalid login/i.test(t)?"Неверная почта или пароль.":/not confirmed/i.test(t)?"Почта ещё не подтверждена — откройте письмо со ссылкой.":/already registered/i.test(t)?"Такой аккаунт уже есть — войдите с паролем.":/rate limit/i.test(t)?"Слишком много попыток. Подождите минуту.":"Не получилось: "+t,true)}
      finally{$("auGo").disabled=false}}}
  async function boot(){if(!sb){document.getElementById("authScreen").hidden=false;document.getElementById("auForm").hidden=true;
      document.getElementById("auMsg").textContent="Приложение ещё не подключено к базе: заполните js/config.js.";return}
    const {data}=await sb.auth.getSession();
    sb.auth.onAuthStateChange((ev,s)=>{if(s&&s.user&&!uid){setSession(s);const n=s.user.user_metadata&&s.user.user_metadata.name;if(n)saveName(n)}
      if(ev==="SIGNED_OUT"){location.reload()}});
    if(data.session){setSession(data.session);const {data:p}=await sb.from("profiles").select("name").eq("id",uid).maybeSingle();
      if(!p){const n=data.session.user.user_metadata&&data.session.user.user_metadata.name;await saveName(n||String(data.session.user.email||"").split("@")[0])}else nameCache[uid]=p.name}
    else showAuth()}
  window.KASSA.signOut=async()=>{await sb.auth.signOut();location.reload()};
  window.KASSA.email=()=>session&&session.user?session.user.email:"";
  window.KASSA.myName=()=>nameCache[uid]||"";
  window.KASSA.setName=saveName;

  /* ---------- the same entry point the app used on claude.ai ---------- */
  window.claude={async use(name){if(!sb)return null;await whenSignedIn;return name==="db"?db:name==="user"?user:name==="downloads"?downloads:null}};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();

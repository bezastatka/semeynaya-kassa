/* Семейная касса — возможности телефона в приложениях для iOS и Android (Capacitor).
   На сайте этот файл ничего не делает. Подключается после backend.js и до app.js. */
(function(){
const C=window.Capacitor;
const NATIVE=!!(C&&C.isNativePlatform&&C.isNativePlatform());
const kn=window.kassaNative={native:NATIVE,platform:NATIVE?C.getPlatform():"web",haptic(){},share:null,lockAvailable:false};
if(!NATIVE)return;
const root=document.documentElement;root.classList.add("native","native-"+kn.platform);
const plug={};const P=n=>{if(!plug[n])try{plug[n]=C.registerPlugin(n)}catch(e){plug[n]=null}return plug[n]};
const tt=s=>window.T?T(s):s;
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};

/* vibration feedback: light tap, success, warning */
kn.haptic=kind=>{const H=P("Haptics");if(!H)return;
  try{if(kind==="ok")H.notification({type:"SUCCESS"});else if(kind==="warn")H.notification({type:"WARNING"});else if(kind==="err")H.notification({type:"ERROR"});else H.impact({style:"LIGHT"})}catch(e){}};

/* files (CSV export, backup) go to the system share sheet: save to Files, send to a messenger, etc. */
const b64=async blob=>{const buf=new Uint8Array(await blob.arrayBuffer());let s="";for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s)};
const downloads={async save({filename,data}){const F=P("Filesystem"),S=P("Share");
  const blob=data instanceof Blob?data:new Blob([data]);const path=String(filename).replace(/[\\/:*?"<>|]/g," ").trim()||"file";
  const r=await F.writeFile({path,data:await b64(blob),directory:"CACHE"});
  try{await S.share({title:path,files:[r.uri],dialogTitle:tt("Сохранить или отправить файл")})}
  catch(e){if(!/cancel/i.test(String(e&&e.message||e)))throw e}
  return {status:"saved"}}};
if(window.claude&&window.claude.use){const use=window.claude.use.bind(window.claude);
  window.claude.use=async name=>name==="downloads"?(await use("user"),downloads):use(name)}

/* share text (invite code) */
kn.share=async(text,title)=>{const S=P("Share");try{await S.share({title:title||"",text});return true}catch(e){return /cancel/i.test(String(e&&e.message||e))}};

/* status bar follows the app's light or dark background */
const isDark=()=>{const m=getComputedStyle(document.body||root).backgroundColor.match(/\d+(\.\d+)?/g);if(!m)return matchMedia("(prefers-color-scheme: dark)").matches;
  const [r,g,b]=m.map(Number);return (0.2126*r+0.7152*g+0.0722*b)<128};
let lastDark=null;const syncBar=()=>{const d=isDark();if(d===lastDark)return;lastDark=d;const SB=P("StatusBar");if(!SB)return;
  try{SB.setStyle({style:d?"DARK":"LIGHT"})}catch(e){}};
const watchTheme=()=>{syncBar();new MutationObserver(()=>setTimeout(syncBar,30)).observe(root,{attributes:true,attributeFilter:["data-app-theme","data-accent","style","class"]});
  try{matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>setTimeout(syncBar,30))}catch(e){}};

/* Android back button: close the open sheet, then the settings screen, then go to the home screen */
const back=()=>{try{
  if(window.lockShown)return;
  if(typeof sheetOpen!=="undefined"&&sheetOpen){closeSheet();return}
  if(typeof view!=="undefined"&&view==="prefs"&&typeof prefSec!=="undefined"&&prefSec){document.getElementById("prefBackBtn").click();return}
  if(typeof view!=="undefined"&&view!=="spend"&&typeof acc!=="undefined"&&acc){setView("spend",true);return}
  P("App").minimizeApp()}catch(e){try{P("App").minimizeApp()}catch(x){}}};

/* app lock with Face ID / Touch ID / fingerprint (or the device passcode) */
const LOCK_KEY="fk.lock",AWAY_MS=60000;let lockEl=null,checking=false,hiddenAt=0;
const lockOn=()=>ls.get(LOCK_KEY)==="1";
const BIO_ANDROID=[3,4,5,7];/* fingerprint, face, iris, device PIN */
async function verify(){const B=P("NativeBiometric");
  await B.verifyIdentity({reason:tt("Откройте «Семейную кассу»"),title:tt("Семейная касса"),subtitle:tt("Подтвердите, что это вы"),
    negativeButtonText:tt("Отмена"),useFallback:true,maxAttempts:5,allowedBiometryTypes:BIO_ANDROID})}
function showLock(){if(lockEl)return;window.lockShown=true;
  lockEl=document.createElement("div");lockEl.id="lockScreen";lockEl.setAttribute("role","dialog");lockEl.setAttribute("aria-modal","true");
  lockEl.innerHTML='<div class="lockbox"><img src="icons/icon-192.png" alt="" width="72" height="72"><b></b><p></p><button type="button" class="primary"></button></div>';
  lockEl.querySelector("b").textContent=tt("Семейная касса");lockEl.querySelector("p").textContent=tt("Приложение заблокировано");
  const btn=lockEl.querySelector("button");btn.textContent=tt("Разблокировать");btn.onclick=()=>unlock();
  document.body.append(lockEl)}
function hideLock(){if(lockEl){lockEl.remove();lockEl=null}window.lockShown=false}
async function unlock(){if(checking)return;checking=true;
  try{await verify();hideLock()}catch(e){/* stays locked; the button tries again */}
  finally{checking=false}}
function lockNow(){if(!lockOn()||!kn.lockAvailable)return;showLock();unlock()}

async function setLock(on,msgEl){const say=(t,bad)=>{if(msgEl){msgEl.textContent=t;msgEl.classList.toggle("bad",!!bad)}};
  if(on){try{await verify()}catch(e){say(tt("Не получилось подтвердить — блокировка не включена."),true);renderLockPref();return}
    ls.set(LOCK_KEY,"1");say(tt("Блокировка включена."))}
  else{ls.set(LOCK_KEY,null);say(tt("Блокировка выключена."))}
  renderLockPref()}
function bioName(t){return t===2?"Face ID":t===1?"Touch ID":t===3?tt("отпечатку пальца"):t===4?tt("распознаванию лица"):tt("биометрии")}
let bioType=0;
function renderLockPref(){const sec=document.getElementById("prefApp");if(!sec||!kn.lockAvailable)return;
  let box=document.getElementById("lockPref");
  if(!box){box=document.createElement("div");box.id="lockPref";box.className="stack";box.style.gap="8px";
    const anchor=sec.querySelector(":scope > .hint:last-child");sec.insertBefore(box,anchor||null)}
  const on=lockOn();box.innerHTML="";
  const lab=document.createElement("span");lab.className="label";lab.style.margin="0";lab.textContent=tt("Блокировка приложения");
  const hint=document.createElement("div");hint.className="hint";hint.style.margin="0";
  hint.textContent=tt("Вход по ")+bioName(bioType)+tt(" или коду телефона при запуске и после минуты в фоне. Хранится только на этом устройстве.");
  const seg=document.createElement("div");seg.className="seg";seg.setAttribute("role","radiogroup");seg.setAttribute("aria-label",tt("Блокировка приложения"));
  const msg=document.createElement("div");msg.className="formmsg";msg.setAttribute("role","status");
  for(const [v,t] of [[false,tt("Выключена")],[true,tt("Включена")]]){const b=document.createElement("button");b.type="button";b.setAttribute("role","radio");
    b.setAttribute("aria-checked",String(v===on));b.textContent=t;b.onclick=()=>{if(v!==lockOn())setLock(v,msg)};seg.append(b)}
  box.append(lab,seg,hint,msg)}

async function init(){
  watchTheme();
  const A=P("App");
  if(A){A.addListener("backButton",back);
    A.addListener("pause",()=>{hiddenAt=Date.now()});
    A.addListener("resume",()=>{if(lockOn()&&kn.lockAvailable&&hiddenAt&&Date.now()-hiddenAt>AWAY_MS)lockNow();hiddenAt=0})}
  try{const B=P("NativeBiometric");const r=await B.isAvailable({useFallback:true});kn.lockAvailable=!!r.isAvailable;bioType=r.biometryType||0}catch(e){kn.lockAvailable=false}
  /* the lock was on, but the phone no longer has Face ID, a fingerprint or a passcode: never leave the app shut */
  if(lockOn()&&kn.lockAvailable)lockNow();else hideLock();
  renderLockPref();
  try{P("SplashScreen").hide({fadeOutDuration:200})}catch(e){}}
/* the lock covers the app before anything is drawn */
if(lockOn())document.addEventListener("DOMContentLoaded",()=>{if(lockOn())showLock()});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
kn.renderLockPref=renderLockPref;
})();

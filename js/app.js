const isInc=e=>e.kind==="income";
const TR={id:"transfer",name:"Перевод",c:"--c10",icon:"transfer"};
const isTr=e=>e.kind==="transfer";
const isExp=e=>e.kind!=="income"&&e.kind!=="transfer";
const catOf=e=>isTr(e)?TR:isInc(e)?(ICAT[e.cat]||ICAT.i_other):(CAT[e.cat]||CAT.other);
const accBudget=()=>!statAll&&subSel==="all"?Number(acc&&acc.budget)||0:0;
const CURS=[["₽","₽ — рубль"],["€","€ — евро"],["$","$ — доллар"],["₸","₸ — тенге"],["₴","₴ — гривна"],["Br","Br — белорусский рубль"]];
const MONTHS=["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MSHORT=["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
const WD=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const ACCENTS=[["emerald","Изумрудный","#0F6E5A"],["ocean","Синий","#1F5FBF"],["violet","Фиолетовый","#6A48C2"],["coral","Терракотовый","#B8452B"],["graphite","Графитовый","#2E3A38"]];
const CHARTS=[
  {id:"structure",name:"На что уходят деньги",types:[["donut","Кольцо"],["bars","Полосы"]],def:"donut"},
  {id:"flow",name:"Доходы и расходы",types:[["bars","Столбцы"],["net","Разница"]],def:"bars"},
  {id:"income",name:"Источники доходов",types:[["donut","Кольцо"],["bars","Полосы"]],def:"donut"},
  {id:"dynamics",name:"Расходы по дням",types:[["bars","Столбцы"],["line","Линия"],["cum","Накопительно"]],def:"bars"},
  {id:"compare",name:"Сравнение с прошлым периодом",types:[["cats","По категориям"],["total","Итог"]],def:"cats"},
  {id:"catmonths",name:"Категории по месяцам",types:[["sum","Суммы"],["share","Доли"]],def:"sum"},
  {id:"weekday",name:"Расходы по дням недели",types:[["sum","Сумма"],["avg","В среднем"]],def:"sum"},
  {id:"top",name:"Крупнейшие траты",types:[["5","5"],["10","10"]],def:"5"}];
const CHART=Object.fromEntries(CHARTS.map(c=>[c.id,c]));
const DEF_ON={flow:true,income:true,structure:true,dynamics:true,compare:true,catmonths:true,weekday:false,top:true};
const $=id=>document.getElementById(id);

let db=null,user=null,uid=null,readOnly=false;
let personal=[],shared=[],gotP=false,gotS=false;
let acc=null;
let expenses=[],loaded=false,unsub=null,subKey="";
let dangerConfirm=false,newType="personal",filledFor="",navTouched=false;
const names={},pendingNames=new Set();
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const today=()=>ymd(new Date());
let month=today().slice(0,7);
let curCat="food",curInc="i_salary",curKind="exp",subSel="all",formSub=null,trFrom=null,trTo=null,subDraft=[];

function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}

/* ---------- app preferences ---------- */
function defaultCharts(){return CHARTS.map(c=>({id:c.id,on:DEF_ON[c.id],type:c.def,group:"cat"}))}
function normPrefs(p){p=p&&typeof p==="object"?p:{};
  const out={theme:["system","light","dark"].includes(p.theme)?p.theme:"system",
    accent:ACCENTS.some(a=>a[0]===p.accent)?p.accent:"emerald",
    start:p.start==="stats"?"stats":"spend",cents:p.cents==="round"?"round":"show",
    period:["m","q","h","y"].includes(p.period)?p.period:"m",
    base:CURS.some(c=>c[0]===p.base)?p.base:"₽",scope:p.scope==="all"?"all":"acc",rates:{}};
  if(p.rates&&typeof p.rates==="object")for(const [k,v] of Object.entries(p.rates))if(CURS.some(c=>c[0]===k)&&Number(v)>0)out.rates[k]=Number(v);
  const seen=new Set(),list=[];
  for(const c of Array.isArray(p.charts)?p.charts:[]){if(!c||!CHART[c.id]||seen.has(c.id))continue;seen.add(c.id);
    const def=CHART[c.id];list.push({id:c.id,on:!!c.on,type:def.types.some(t=>t[0]===c.type)?c.type:def.def,group:c.group==="person"?"person":"cat"})}
  defaultCharts().forEach((c,i)=>{if(!seen.has(c.id))list.splice(Math.min(i,list.length),0,c)});
  out.charts=list;return out}
let prefs=normPrefs((()=>{try{return JSON.parse(lsGet("fk.prefs")||"{}")}catch(e){return {}}})());
let prefTimer=null,prefChain=Promise.resolve();
function savePrefs(){lsSet("fk.prefs",JSON.stringify(prefs));clearTimeout(prefTimer);
  prefTimer=setTimeout(()=>{if(!db||!uid||readOnly)return;const snap=JSON.parse(JSON.stringify(prefs));
    prefChain=prefChain.then(()=>db.doc("data/users/"+uid+"/prefs").set(snap)).catch(()=>{})},700)}
function applyTheme(){const r=document.documentElement;
  if(prefs.theme==="system")r.removeAttribute("data-app-theme");else r.setAttribute("data-app-theme",prefs.theme);
  if(prefs.accent==="emerald")r.removeAttribute("data-accent");else r.setAttribute("data-accent",prefs.accent)}

/* ---------- helpers ---------- */
function h(tag,attrs,...kids){const el=document.createElement(tag);
  for(const k in attrs||{}){const v=attrs[k]; if(v==null||v===false)continue;
    if(k==="class")el.className=v; else if(k==="style")el.style.cssText=v;
    else if(k.startsWith("on"))el.addEventListener(k.slice(2),v); else el.setAttribute(k,v===true?"":v)}
  for(const c of kids.flat()){if(c==null||c===false)continue; el.append(c.nodeType?c:document.createTextNode(String(c)))}
  return el}
const NS="http://www.w3.org/2000/svg";
function s(tag,attrs,...kids){const el=document.createElementNS(NS,tag);
  for(const k in attrs||{}){const v=attrs[k];if(v==null||v===false)continue;el.setAttribute(k,v)}
  for(const c of kids.flat()){if(c==null||c===false)continue;el.append(c.nodeType?c:document.createTextNode(String(c)))}return el}
let curOverride=null,statAll=false;
const cur=()=>curOverride||(acc&&acc.currency)||"₽";
function fmtC(n,c){n=Math.round(n*100)/100;const round=prefs.cents==="round";if(round)n=Math.round(n);
  return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:round||Number.isInteger(n)?0:2}).format(n)+"\u00a0"+c}
function conv(n,c){c=c||"₽";if(c===prefs.base)return n;const r=prefs.rates[c];return r>0?n*r:null}
function fmt(n){n=Math.round(n*100)/100;const round=prefs.cents==="round";if(round)n=Math.round(n);
  return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:round||Number.isInteger(n)?0:2}).format(n)+" "+cur()}
const compactF=new Intl.NumberFormat("ru-RU",{notation:"compact",maximumFractionDigits:1});
const compact=n=>compactF.format(n);
function parseNum(v){v=String(v||"").replace(/[\s ]/g,"").replace(",",".");const n=parseFloat(v);return Number.isFinite(n)?n:NaN}
function monthLabel(m){const [y,mm]=m.split("-").map(Number);return MONTHS[mm-1]+" "+y}
function shiftMonth(m,d){let [y,mm]=m.split("-").map(Number);mm+=d;while(mm<1){mm+=12;y--}while(mm>12){mm-=12;y++}return y+"-"+pad(mm)}
function daysIn(m){const [y,mm]=m.split("-").map(Number);return new Date(y,mm,0).getDate()}
function dayLabel(s){const [y,m,d]=s.split("-").map(Number);
  const t=new Intl.DateTimeFormat("ru-RU",{weekday:"short",day:"numeric",month:"long"}).format(new Date(y,m-1,d));
  return s===today()?"Сегодня, "+t:t.charAt(0).toUpperCase()+t.slice(1)}
const dayMonth=s=>{const [y,m,d]=s.split("-").map(Number);return new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long"}).format(new Date(y,m-1,d))};
function plural(n,f){const a=n%10,b=n%100;return a===1&&b!==11?f[0]:a>=2&&a<=4&&(b<10||b>=20)?f[1]:f[2]}
function toast(t){const el=h("div",{class:"toast",role:"status"},t);document.body.append(el);setTimeout(()=>el.remove(),2400)}
function notice(t,bad){const n=$("notice");n.textContent=t||"";n.hidden=!t;n.classList.toggle("bad",!!bad)}
function genCode(){const a="ABCDEFGHJKMNPQRSTUVWXYZ23456789";let s="";const r=new Uint32Array(6);crypto.getRandomValues(r);for(const x of r)s+=a[x%a.length];return s}
function fillCur(sel){sel.replaceChildren(...CURS.map(([v,t])=>h("option",{value:v},t)))}
fillCur($("newCur"));fillCur($("setCur"));
const sum=arr=>arr.reduce((t,e)=>t+(Number(e.amount)||0),0);
/* small segmented control */
function mseg(opts,value,onPick,label){return h("div",{class:"mseg",role:"radiogroup","aria-label":label||null},
  ...opts.map(([v,t])=>h("button",{type:"button",role:"radio","aria-checked":String(v===value),onclick:()=>onPick(v)},t)))}
function bigSeg(box,opts,value,onPick){box.replaceChildren(...opts.map(([v,t,sub])=>h("button",{type:"button",role:"radio","aria-checked":String(v===value),onclick:()=>onPick(v)},h("b",null,t),sub?h("span",null,sub):null)))}

/* ---------- icons and categories ---------- */
const ICONS={
  cart:'<path d="M3 4h2.5l2.2 10.5h10.3l2-7.5H6.3"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  dish:'<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21V3c-2.2 1.2-3 3.5-3 6v4h3"/>',
  cup:'<path d="M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2M11 3.5v2"/>',
  bus:'<rect x="4.5" y="3.5" width="15" height="14" rx="2.5"/><path d="M4.5 11h15M8 17.5v2.5M16 17.5v2.5"/><circle cx="8.5" cy="14.3" r=".9"/><circle cx="15.5" cy="14.3" r=".9"/>',
  car:'<path d="M4 16v-3.5l2-5.5h12l2 5.5V16z"/><path d="M4 12.5h16M6.5 16v2.5M17.5 16v2.5"/>',
  fuel:'<rect x="4.5" y="4" width="9" height="16" rx="1.5"/><path d="M4.5 10h9M13.5 8.5l3 2.5v6.5a1.5 1.5 0 0 0 3 0V9l-2.5-3"/>',
  plane:'<path d="M21 4 3 11l7 2.5L12.5 21z"/><path d="M10 13.5 21 4"/>',
  home:'<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10 20v-5h4v5"/>',
  bolt:'<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  drop:'<path d="M12 3.5c3.5 4.2 5.5 7.4 5.5 10a5.5 5.5 0 0 1-11 0c0-2.6 2-5.8 5.5-10z"/>',
  wifi:'<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.7a7.5 7.5 0 0 1 11 0M9.5 15.8a3.2 3.2 0 0 1 5 0"/><circle cx="12" cy="19" r=".9"/>',
  phone:'<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M10.5 17.5h3"/>',
  tools:'<path d="M15 4.5a4.5 4.5 0 0 0-4.3 5.8L4.5 16.5a2.1 2.1 0 0 0 3 3l6.2-6.2A4.5 4.5 0 0 0 19.5 9l-2.7 2.7-2.6-.6-.6-2.6 2.7-2.7a4.5 4.5 0 0 0-1.3-.3z"/>',
  heart:'<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  pill:'<rect x="3.6" y="8.6" width="16.8" height="6.8" rx="3.4" transform="rotate(-45 12 12)"/><path d="M9.6 9.6l4.8 4.8"/>',
  gym:'<path d="M3.5 12h17M6.5 8v8M9 9.5v5M17.5 8v8M15 9.5v5"/>',
  scissors:'<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.4 20 17M8.6 15.6 20 7"/>',
  bottle:'<path d="M9.5 3.5h5M10 3.5v3l-1.5 2v10.5a1.5 1.5 0 0 0 1.5 1.5h4a1.5 1.5 0 0 0 1.5-1.5V8.5L14 6.5v-3"/><path d="M8.5 12h7M8.5 15.5h7"/>',
  ball:'<circle cx="12" cy="12" r="8"/><path d="M4.5 9.5c5 1.5 10 1.5 15 0M6 17c3.5-3 8.5-3 12 0"/>',
  book:'<path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17z"/><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18"/>',
  shirt:'<path d="M8.5 4 4 6.5l1.8 4 2.2-1V20h8V9.5l2.2 1 1.8-4L15.5 4a3.5 3.5 0 0 1-7 0z"/>',
  ticket:'<path d="M4 7.5h16v3a1.8 1.8 0 0 0 0 3v3H4v-3a1.8 1.8 0 0 0 0-3z"/><path d="M14 8v1.5M14 11.3v1.4M14 14.5V16"/>',
  game:'<path d="M7.5 8h9a4 4 0 0 1 3.9 4.9l-.9 4a2 2 0 0 1-3.4.9L14.5 16h-5l-1.6 1.8a2 2 0 0 1-3.4-.9l-.9-4A4 4 0 0 1 7.5 8z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="15.5" cy="12" r=".8"/><circle cx="17" cy="13.5" r=".8"/>',
  music:'<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  film:'<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  paw:'<circle cx="7" cy="10" r="1.7"/><circle cx="10.3" cy="6.5" r="1.7"/><circle cx="13.7" cy="6.5" r="1.7"/><circle cx="17" cy="10" r="1.7"/><path d="M12 11.5c-2.5 0-5 3.5-5 5.5 0 1.8 1.6 2.6 3 2.2 1.3-.4 2.7-.4 4 0 1.4.4 3-.4 3-2.2 0-2-2.5-5.5-5-5.5z"/>',
  leaf:'<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19 14 10"/>',
  gift:'<rect x="4" y="8.5" width="16" height="4" rx="1"/><path d="M5.5 12.5V20h13v-7.5M12 8.5V20"/><path d="M12 8.5c-1-3-4.5-4-5-2s3 2 5 2c2 0 5.5 0 5-2s-4-1-5 2z"/>',
  star:'<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  card:'<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17M7 14.5h3"/>',
  bank:'<path d="M4 9.5 12 5l8 4.5z"/><path d="M6 10v7M10 10v7M14 10v7M18 10v7M4 19.5h16"/>',
  wallet:'<path d="M18 7.5V6a1.5 1.5 0 0 0-1.5-1.5H6A2 2 0 0 0 4 6.5v11A2 2 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 18 7.5H6"/><circle cx="16" cy="13.5" r="1"/>',
  briefcase:'<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17"/>',
  coins:'<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  piggy:'<path d="M5 11.5a6 5 0 0 1 11-2.8h2.5l-.6 2.4A5 5 0 0 1 19 13.5h1.5V16H18a6 6 0 0 1-2 2V20h-2.5v-1.2a7 7 0 0 1-3 0V20H8v-2a5.5 5.5 0 0 1-3-6.5z"/><circle cx="14.5" cy="11.5" r=".8"/>',
  refund:'<path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
  percent:'<path d="M18 6 6 18"/><circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/>',
  growth:'<path d="M4 19h16"/><path d="M5 15l4.5-4.5 3 3L19 7"/><path d="M15 7h4v4"/>',
  dots:'<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  transfer:'<path d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5"/>'};
const ICON_NAMES={cart:"Продукты",dish:"Еда",cup:"Кофе",bus:"Транспорт",car:"Машина",fuel:"Бензин",plane:"Путешествия",home:"Дом",bolt:"Электричество",drop:"Вода",wifi:"Интернет",phone:"Телефон",tools:"Ремонт",heart:"Здоровье",pill:"Лекарства",gym:"Спорт",scissors:"Красота",bottle:"Малыш",ball:"Игрушки",book:"Учёба",shirt:"Одежда",ticket:"Билеты",game:"Игры",music:"Музыка",film:"Кино",sun:"Отдых",paw:"Питомцы",leaf:"Сад",gift:"Подарок",star:"Звезда",card:"Карта",bank:"Банк",wallet:"Кошелёк",briefcase:"Работа",coins:"Монеты",piggy:"Копилка",refund:"Возврат",percent:"Проценты",growth:"Рост",dots:"Другое",transfer:"Перевод"};
const ICON_KEYS=Object.keys(ICONS).filter(k=>k!=="transfer");
const DEF_EXP=[{id:"food",name:"Продукты",c:"--c1",icon:"cart"},{id:"cafe",name:"Кафе",c:"--c2",icon:"cup"},{id:"transport",name:"Транспорт",c:"--c3",icon:"bus"},
  {id:"home",name:"Дом и ЖКУ",c:"--c4",icon:"home"},{id:"health",name:"Здоровье",c:"--c5",icon:"heart"},{id:"kids",name:"Дети",c:"--c6",icon:"ball"},
  {id:"clothes",name:"Одежда",c:"--c7",icon:"shirt"},{id:"fun",name:"Досуг",c:"--c8",icon:"ticket"},{id:"gifts",name:"Подарки",c:"--c9",icon:"gift"},
  {id:"other",name:"Другое",c:"--c10",icon:"dots"}];
const DEF_INC=[{id:"i_salary",name:"Зарплата",c:"--c1",icon:"wallet"},{id:"i_side",name:"Подработка",c:"--c2",icon:"briefcase"},{id:"i_gift",name:"Подарки",c:"--c3",icon:"gift"},
  {id:"i_refund",name:"Возвраты и кешбэк",c:"--c4",icon:"refund"},{id:"i_invest",name:"Проценты и инвестиции",c:"--c5",icon:"percent"},{id:"i_other",name:"Другое",c:"--c10",icon:"dots"}];
let CATS=DEF_EXP.map(x=>({...x,hidden:false})),INC_CATS=DEF_INC.map(x=>({...x,hidden:false})),CAT={},ICAT={};
function indexCats(){CAT=Object.fromEntries(CATS.map(c=>[c.id,c]));ICAT=Object.fromEntries(INC_CATS.map(c=>[c.id,c]))}
indexCats();
const isOtherCat=id=>id==="other"||id==="i_other";
function normCatList(raw,defs,otherId){const out=[],seen=new Set();
  for(const c of Array.isArray(raw)?raw:[]){if(!c||!c.id||seen.has(String(c.id)))continue;const id=String(c.id);seen.add(id);
    const d=defs.find(x=>x.id===id)||{};
    out.push({id,name:String(c.name||d.name||"Без названия").slice(0,30),c:/^--c([1-9]|10)$/.test(c.c)?c.c:(d.c||"--c10"),
      icon:typeof c.icon==="string"&&(Object.hasOwn(ICONS,c.icon)||/^img:[A-Za-z0-9_\-.~:@+]{1,200}$/.test(c.icon))?c.icon:(d.icon||"dots"),hidden:!!c.hidden&&id!==otherId})}
  if(!out.length)return defs.map(x=>({...x,hidden:false}));
  if(!seen.has(otherId))out.push({...defs.find(x=>x.id===otherId),hidden:false});
  return out}
function applyCats(){const raw=(acc&&acc.cats)||{};CATS=normCatList(raw.exp,DEF_EXP,"other");INC_CATS=normCatList(raw.inc,DEF_INC,"i_other");indexCats()}
const stripCat=x=>({id:x.id,name:x.name,c:x.c,icon:x.icon,hidden:!!x.hidden});
let iconData={},iconUnsub=null,iconKey="";
function catIcon(c,size){size=size||32;const box=h("span",{class:"cico",style:"--cc:var("+(c.c||"--c10")+");width:"+size+"px;height:"+size+"px","aria-hidden":"true"});
  if(c.icon&&String(c.icon).startsWith("img:")){const src=iconData[c.icon.slice(4)];if(src){box.classList.add("img");box.append(h("img",{src,alt:""}));return box}}
  box.innerHTML='<svg viewBox="0 0 24 24">'+(Object.hasOwn(ICONS,c.icon)?ICONS[c.icon]:ICONS.dots)+'</svg>';return box}
const iconCol=a=>a.type==="personal"?db.collection("data/users/"+uid+"/"+a.id+"/icons"):db.collection("accounts/"+a.id+"/icons");
const okIcon=v=>typeof v==="string"&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v);
function resubIcons(){if(!db||!acc)return;const key=acc.type+":"+acc.id;if(key===iconKey)return;
  iconKey=key;if(iconUnsub)iconUnsub();iconData={};const a=acc;
  iconUnsub=iconCol(a).onSnapshot(qs=>{if(iconKey!==key)return;const m={};for(const d of qs.docs){const v=d.data().data;if(okIcon(v))m[d.id]=v}iconData=m;
    renderCats();render();renderHistory();renderCatSet();renderTplSet()},()=>{})}
async function fileToIcon(file){if(!/^image\/(png|jpeg)$/.test(file.type))throw new Error("type");
  if(file.size>15*1024*1024)throw new Error("big");
  const url=URL.createObjectURL(file);
  try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("read"));i.src=url});
    const enc=size=>{const cv=document.createElement("canvas");cv.width=cv.height=size;const g=cv.getContext("2d");
      const sw=Math.min(img.naturalWidth,img.naturalHeight),sx=(img.naturalWidth-sw)/2,sy=(img.naturalHeight-sw)/2;
      g.imageSmoothingQuality="high";g.drawImage(img,sx,sy,sw,sw,0,0,size,size);
      return file.type==="image/png"?cv.toDataURL("image/png"):cv.toDataURL("image/jpeg",.86)};
    let d=enc(96);if(d.length>90000)d=enc(64);if(d.length>90000)d=enc(48);return d}
  finally{URL.revokeObjectURL(url)}}

/* category editor (settings) */
let catTab="exp",catEdit=null,catArm=false,iconArm=null,iconFor=null;
const catListOf=k=>k==="inc"?INC_CATS:CATS;
function catUseCount(kind,id){if(!archDone)return null;return histExp.filter(e=>(kind==="inc"?isInc(e):isExp(e))&&(e.cat||(kind==="inc"?"i_other":"other"))===id).length}
function renderCatSet(){if(!acc||view!=="prefs")return;
  $("catSetTitle").textContent="Категории счёта «"+(acc.name||"")+"»";
  $("catTabs").replaceChildren(mseg([["exp","Расходы"],["inc","Доходы"]],catTab,v=>{catTab=v;catEdit=null;renderCatSet()},"Тип категорий"));
  const list=catListOf(catTab);
  const rows=list.map((c,i)=>catEdit&&!catEdit.isNew&&catEdit.id===c.id?catEditor():h("div",{class:"catrow"+(c.hidden?" hid":"")},
    catIcon(c,32),h("div",{class:"n"},h("div",null,c.name),c.hidden?h("div",{class:"sub"},"скрыта"):null),
    readOnly?null:h("button",{type:"button",class:"icon-btn","aria-label":"Выше",disabled:i===0?true:null,onclick:()=>moveCat(i,-1)},"↑"),
    readOnly?null:h("button",{type:"button",class:"icon-btn","aria-label":"Ниже",disabled:i===list.length-1?true:null,onclick:()=>moveCat(i,1)},"↓"),
    readOnly?null:h("button",{type:"button",class:"ghost sm",onclick:()=>{catEdit={...c};catArm=false;iconArm=null;renderCatSet()}},"Изменить")));
  if(catEdit&&catEdit.isNew)rows.push(catEditor());
  $("catList").replaceChildren(...rows);$("addCatBtn").hidden=readOnly||!!(catEdit&&catEdit.isNew);
  const others=allAccounts().filter(a=>!sameAcc(a,acc));
  if(readOnly||!others.length){$("catCopy").replaceChildren();return}
  const sel=h("select",{class:"field",id:"catFrom",style:"flex:1;min-width:150px"},...others.map((a,i)=>h("option",{value:String(i)},"«"+(a.name||"")+"»")));
  $("catCopy").replaceChildren(h("div",{class:"stack",style:"gap:8px"},h("label",{class:"label",for:"catFrom",style:"margin:0"},"Взять категории из другого счёта"),
    h("div",{class:"inline"},sel,h("button",{type:"button",class:"ghost",onclick:ev=>importCats(others[+sel.value],ev.currentTarget)},"Добавить недостающие")),
    h("div",{class:"hint",style:"margin:0"},"Добавятся категории, которых здесь нет. Существующие и их операции не изменятся.")))}
async function importCats(a,btn){if(!a||!acc)return;if(btn)btn.disabled=true;
  const merge=(curL,add)=>{const out=curL.map(x=>({...x}));for(const c of add){if(out.some(x=>x.id===c.id||x.name.toLowerCase()===c.name.toLowerCase()))continue;
    const oi=out.findIndex(x=>isOtherCat(x.id));out.splice(oi<0?out.length:oi,0,{...c,hidden:false})}return out};
  const exp=merge(CATS,normCatList(a.cats&&a.cats.exp,DEF_EXP,"other")),inc=merge(INC_CATS,normCatList(a.cats&&a.cats.inc,DEF_INC,"i_other"));
  const added=exp.length-CATS.length+inc.length-INC_CATS.length;
  if(!added){toast("Все категории из «"+(a.name||"")+"» здесь уже есть");if(btn)btn.disabled=false;return}
  const ac=acc;
  try{for(const id of [...exp,...inc].map(c=>String(c.icon)).filter(i=>i.startsWith("img:")).map(i=>i.slice(4)).filter(id=>!iconData[id])){
      const d=await iconCol(a).doc(id).get();if(d.exists&&okIcon(d.data().data))await iconCol(ac).doc(id).set({data:d.data().data,createdAt:Date.now(),by:uid||""})}
    const next={exp:exp.map(stripCat),inc:inc.map(stripCat)};await accDoc(ac).update({cats:next});ac.cats=next;applyCats();renderCats();renderCatSet();render();
    toast("Добавлено "+added+" "+plural(added,["категория","категории","категорий"]))}
  catch(e){toast("Не получилось добавить категории");if(btn)btn.disabled=false}}
function catEditor(){const d=catEdit;
  const name=h("input",{class:"field",id:"ce-name",maxlength:"30",placeholder:"Например, «Бензин» или «Кружки»",value:d.name||"",oninput:e=>{d.name=e.target.value}});
  const colors=h("div",{class:"colors",role:"radiogroup","aria-label":"Цвет"},...Array.from({length:10},(_,i)=>{const v="--c"+(i+1);
    return h("button",{type:"button",role:"radio","aria-checked":String(d.c===v),"aria-label":"Цвет "+(i+1),style:"background:var("+v+")",onclick:()=>{d.c=v;renderCatSet()}})}));
  const ico=(key,label)=>h("button",{type:"button",class:"ico-btn",role:"radio","aria-checked":String(d.icon===key),title:label,"aria-label":label,onclick:()=>{d.icon=key;renderCatSet()}});
  const builtins=ICON_KEYS.map(k=>{const b=ico(k,ICON_NAMES[k]||k);b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[k]+'</svg>';return b});
  const customs=Object.entries(iconData).map(([id,src])=>{const b=ico("img:"+id,"Своя иконка");b.append(h("img",{src,alt:""}));
    return h("div",{class:"ico-wrap"},b,readOnly?null:h("button",{type:"button",class:"ico-del","aria-label":iconArm===id?"Подтвердить удаление иконки":"Удалить свою иконку",title:iconArm===id?"Нажмите ещё раз, чтобы удалить":"Удалить иконку",onclick:()=>delIcon(id)},iconArm===id?"✓":"×"))});
  const up=h("button",{type:"button",class:"ico-btn up",title:"Загрузить PNG или JPG","aria-label":"Загрузить свою иконку",onclick:()=>{iconFor=d;$("iconFile").value="";$("iconFile").click()}},"+");
  const n=d.isNew?0:catUseCount(catTab,d.id);
  const acts=[];
  if(!d.isNew&&!isOtherCat(d.id))acts.push(h("button",{type:"button",class:"danger",onclick:()=>toggleHideCat(d.id)},d.hidden?"Снова предлагать при вводе":"Не предлагать при вводе"));
  if(!d.isNew&&!isOtherCat(d.id)&&n===0)acts.push(catArm?h("button",{type:"button",class:"del",onclick:()=>deleteCat(d.id)},"Да, удалить"):h("button",{type:"button",class:"danger",onclick:()=>{catArm=true;renderCatSet()}},"Удалить категорию"));
  const note=d.isNew?null:isOtherCat(d.id)?"Эту категорию нельзя удалить: в неё попадают операции без категории.":n===null?"Проверяем, есть ли операции с этой категорией…":n>0?"В категории "+n+" "+plural(n,["операция","операции","операций"])+", её можно только перестать предлагать при вводе.":null;
  return h("div",{class:"editor"},
    h("div",{class:"inline",style:"align-items:flex-end;flex-wrap:nowrap"},catIcon(d,44),h("div",{style:"flex:1;min-width:0"},h("label",{class:"label",for:"ce-name"},"Название"),name)),
    h("div",null,h("span",{class:"label"},"Цвет"),colors),
    h("div",null,h("span",{class:"label"},"Иконка"),h("div",{class:"ico-grid",role:"radiogroup","aria-label":"Иконка"},...builtins,...customs,up),
      h("div",{class:"hint"},"«+» — загрузить свою картинку PNG или JPG. Она обрежется до квадрата и будет видна всем участникам счёта.")),
    h("div",{class:"inline"},h("button",{type:"button",class:"primary",onclick:saveCat},d.isNew?"Добавить категорию":"Сохранить"),h("button",{type:"button",class:"ghost",onclick:()=>{catEdit=null;renderCatSet()}},"Отмена")),
    h("div",{class:"formmsg",id:"ceMsg",role:"status"}),
    acts.length?h("div",{class:"confirm"},...acts):null,
    note?h("div",{class:"hint",style:"margin:0"},note):null)}
async function writeCats(kind,list,msgEl){if(!acc)return false;const a=acc;
  const next={exp:(kind==="exp"?list:CATS).map(stripCat),inc:(kind==="inc"?list:INC_CATS).map(stripCat)};
  try{await accDoc(a).update({cats:next});a.cats=next;applyCats();renderCats();render();renderHistory();renderCatSet();renderStats();renderTplSet();renderTplBar();return true}
  catch(e){if(msgEl)writeErr(e,msgEl);else toast("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.");return false}}
async function saveCat(){const d=catEdit,msg=$("ceMsg");msg.classList.remove("bad");const name=String(d.name||"").trim().slice(0,30);
  if(!name){msg.classList.add("bad");msg.textContent="Введите название категории.";$("ce-name").focus();return}
  const list=catListOf(catTab).map(x=>({...x}));
  if(list.some(x=>x.id!==d.id&&x.name.toLowerCase()===name.toLowerCase())){msg.classList.add("bad");msg.textContent="Категория с таким названием уже есть.";return}
  const item={id:d.id,name,c:d.c,icon:d.icon,hidden:!!d.hidden};
  const i=list.findIndex(x=>x.id===d.id);
  if(i<0){const oi=list.findIndex(x=>isOtherCat(x.id));list.splice(oi<0?list.length:oi,0,item)}else list[i]=item;
  if(await writeCats(catTab,list,msg)){catEdit=null;renderCatSet();toast(i<0?"Категория «"+name+"» добавлена":"Категория сохранена")}}
async function toggleHideCat(id){const list=catListOf(catTab).map(x=>x.id===id?{...x,hidden:!x.hidden}:{...x});
  if(await writeCats(catTab,list)){const c=list.find(x=>x.id===id);catEdit=null;renderCatSet();toast(c.hidden?"«"+c.name+"» больше не предлагается при вводе":"«"+c.name+"» снова предлагается при вводе")}}
async function deleteCat(id){const list=catListOf(catTab).filter(x=>x.id!==id).map(x=>({...x}));
  if(await writeCats(catTab,list)){catEdit=null;catArm=false;renderCatSet();toast("Категория удалена")}}
async function moveCat(i,dir){const list=catListOf(catTab).map(x=>({...x})),j=i+dir;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];await writeCats(catTab,list)}
async function delIcon(id){if(iconArm!==id){iconArm=id;renderCatSet();return}
  iconArm=null;if(!acc)return;
  try{await iconCol(acc).doc(id).delete();delete iconData[id];
    const key="img:"+id;if(catEdit&&catEdit.icon===key)catEdit.icon="dots";
    if(CATS.some(c=>c.icon===key)||INC_CATS.some(c=>c.icon===key)){const fix=l=>l.map(c=>c.icon===key?{...c,icon:"dots"}:{...c});
      const a=acc,next={exp:fix(CATS).map(stripCat),inc:fix(INC_CATS).map(stripCat)};await accDoc(a).update({cats:next});a.cats=next;applyCats()}
    renderCatSet();renderCats();render();toast("Иконка удалена")}catch(e){toast("Не получилось удалить иконку")}}
$("addCatBtn").onclick=()=>{const list=catListOf(catTab);catEdit={id:(catTab==="inc"?"i_":"")+genId(),name:"",c:"--c"+(1+list.length%9),icon:"star",hidden:false,isNew:true};catArm=false;renderCatSet();
  setTimeout(()=>{const el=$("ce-name");if(el)el.focus()},0)};
$("iconFile").addEventListener("change",async e=>{const f=e.target.files&&e.target.files[0];if(!f||!iconFor||!acc)return;const target=iconFor;
  try{const data=await fileToIcon(f);const ref=await iconCol(acc).add({data,createdAt:Date.now(),by:uid||""});iconData[ref.id]=data;target.icon="img:"+ref.id;renderCatSet();toast("Иконка загружена")}
  catch(err){toast(err&&err.message==="type"?"Подходят только картинки PNG и JPG":err&&err.message==="big"?"Файл больше 15 МБ — выберите картинку поменьше":err&&err.code?"Не получилось сохранить иконку":"Не получилось прочитать картинку")}});

/* tooltip for charts */
const tip=h("div",{class:"tip",hidden:true,role:"status"});document.body.append(tip);
function moveTip(x,y){const r=tip.getBoundingClientRect();let l=x+12,t=y-r.height-12;
  if(l+r.width>innerWidth-8)l=x-r.width-12;if(t<8)t=y+18;tip.style.left=Math.max(8,l)+"px";tip.style.top=t+"px"}
document.addEventListener("pointerover",e=>{const t=e.target.closest&&e.target.closest("[data-tip]");
  if(!t){tip.hidden=true;return}tip.textContent=t.getAttribute("data-tip");tip.hidden=false;moveTip(e.clientX,e.clientY)});
document.addEventListener("pointermove",e=>{if(!tip.hidden)moveTip(e.clientX,e.clientY)});
addEventListener("scroll",()=>{tip.hidden=true},{passive:true});

/* ---------- sheets ---------- */
let sheetOpen=null,sheetReturn=null;
function openSheet(id,focusEl){if(sheetOpen&&sheetOpen!==id)$(sheetOpen).hidden=true;sheetOpen=id;sheetReturn=document.activeElement;
  $(id).hidden=false;$("scrim").hidden=false;document.body.classList.add("locked");tip.hidden=true;
  setTimeout(()=>{try{(focusEl||$(id).querySelector("button,input,select")).focus({preventScroll:true})}catch(e){}},30)}
function closeSheet(){if(!sheetOpen)return;$(sheetOpen).hidden=true;$("scrim").hidden=true;document.body.classList.remove("locked");sheetOpen=null;
  try{if(sheetReturn&&document.contains(sheetReturn))sheetReturn.focus({preventScroll:true})}catch(e){}sheetReturn=null}
$("scrim").onclick=closeSheet;
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&sheetOpen)closeSheet()});
for(const b of document.querySelectorAll("[data-close]"))b.onclick=closeSheet;
let ovBal={},ovBusy=false;
async function refreshOverview(){if(ovBusy||!db)return;ovBusy=true;
  await Promise.all(allAccounts().map(async a=>{try{ovBal[a.type+":"+a.id]=totalFor(a,balancesFor(a,await loadOpsOf(a)))}catch(e){}}));
  ovBusy=false;renderTabs()}
$("accBtn").onclick=()=>{renderTabs();openSheet("accSheet",$("tabs").querySelector('[aria-selected="true"]'));refreshOverview()};
$("accNew").onclick=()=>{closeSheet();openNew(false)};
$("accJoin").onclick=()=>{closeSheet();openNew(false);setTimeout(()=>$("joinCode").focus(),60)};
$("fab").onclick=()=>openEntry(false);
function openEntry(keep){if(!acc||readOnly)return;
  if(!keep){tplActive=null;goalActive=null;tplSaveState=null;$("amount").value="";$("note").value="";$("trAmt2").value="";$("date").value=today();detailOpen="";$("formMsg").textContent=""}
  renderCats();renderWho();renderTplBar();openSheet("entrySheet",$("amount"))}

/* compact detail chips in the entry form */
const UI_ICONS={date:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',sub:'<path d="M18 7.5V6a1.5 1.5 0 0 0-1.5-1.5H6A2 2 0 0 0 4 6.5v11A2 2 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 18 7.5H6"/>',
  who:'<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.8 3.6-5.5 7-5.5s6.2 1.7 7 5.5"/>',note:'<path d="M5 19h4L19 9l-4-4L5 15z"/><path d="M13 7l4 4"/>'};
let detailOpen="";
function renderDetails(){if(!acc)return;const tr=curKind==="tr",subs=subsOf(acc),pp=people(acc);
  const d=$("date").value||today(),yd=ymd(new Date(Date.now()-864e5)),note=$("note").value.trim();
  const chip=(key,label,set)=>{const b=h("button",{type:"button",class:"dchip"+(detailOpen===key?" on":"")+(set?" set":""),"aria-expanded":String(detailOpen===key),
      onclick:()=>{detailOpen=detailOpen===key?"":key;renderDetails();const f={date:"date",note:"note"}[detailOpen];if(f)setTimeout(()=>$(f).focus(),0)}},h("span",null,label));
    b.insertAdjacentHTML("afterbegin",'<svg viewBox="0 0 24 24" aria-hidden="true">'+UI_ICONS[key]+'</svg>');return b};
  const items=[chip("date",d===today()?"Сегодня":d===yd?"Вчера":shortDate(d).replace(/\s?г\.$/,""),d!==today())];
  if(!tr&&subs.length>1)items.push(chip("sub",(subs.find(x=>x.id===formSub)||subs[0]).name,false));
  if(pp.length)items.push(chip("who",curWho()||"Кто",false));
  items.push(chip("note",note?note:"Комментарий",!!note));
  const g=goalActive&&goalsOf(acc).find(x=>x.id===goalActive);
  if(g){const gb=h("button",{type:"button",class:"dchip on set","aria-label":"Не относить к цели «"+g.name+"»",onclick:()=>{goalActive=null;renderDetails()}},h("span",null,"Цель «"+g.name+"» ×"));items.unshift(gb)}
  $("details").replaceChildren(...items);
  $("dateRow").hidden=detailOpen!=="date";$("subWrap").hidden=detailOpen!=="sub"||tr||subs.length<2;$("whoWrap").hidden=detailOpen!=="who"||!pp.length;$("noteRow").hidden=detailOpen!=="note"}
$("date").addEventListener("change",renderDetails);$("note").addEventListener("change",renderDetails);

/* settings menu with separate screens */
let prefSec=null;
const PREF_SECS={me:"prefMe",theme:"prefTheme",app:"prefApp",acc:"accSet",subs:"subSet",cats:"catSet",tpls:"tplSet"};
const MENU_ICONS={me:ICONS.bank,theme:ICONS.sun,app:ICONS.phone,acc:ICONS.wallet,subs:ICONS.piggy,cats:ICONS.star,tpls:ICONS.refund};
function renderPrefMenu(){const row=(k,title,sub)=>{const ic=h("span",{class:"micon"});ic.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+MENU_ICONS[k]+'</svg>';
    return h("button",{type:"button",class:"mrow",onclick:()=>openPrefSec(k)},ic,h("span",{class:"n"},h("b",null,title),h("small",null,sub)),h("span",{class:"chev","aria-hidden":"true"},"›"))};
  const thName={system:"Как в системе",light:"Светлая",dark:"Тёмная"}[prefs.theme],acName=(ACCENTS.find(a=>a[0]===prefs.accent)||ACCENTS[0])[1];
  const items=[h("div",{class:"mgroup"},"Приложение"),row("me","Аккаунт и резервная копия",(window.KASSA&&KASSA.email())||"Почта, имя, выход"),row("theme","Оформление",thName+" тема · "+acName.toLowerCase()+" акцент"),
    row("app","Общие",(prefs.start==="stats"?"Открывать статистику":"Открывать главную")+" · "+(prefs.cents==="round"?"без копеек":"с копейками"))];
  if(acc){const subsN=subsOf(acc).length,ts=tplsOf(acc).length;
    items.push(h("div",{class:"mgroup"},"Счёт «"+(acc.name||"")+"»"),
      row("acc","Счёт и участники",acc.type==="shared"?"Название, бюджет, код приглашения":"Название, валюта, бюджет"),
      row("subs","Кошельки",subsN+" "+plural(subsN,["кошелёк","кошелька","кошельков"])),
      row("cats","Категории",CATS.length+" расходов · "+INC_CATS.length+" доходов"),
      row("tpls","Шаблоны платежей",ts?ts+" "+plural(ts,["шаблон","шаблона","шаблонов"]):"Пока нет"))}
  $("setMenu").replaceChildren(...items)}
function applyPrefSec(){if(prefSec&&["acc","subs","cats","tpls"].includes(prefSec)&&!acc)prefSec=null;
  $("setMenu").hidden=!!prefSec;$("prefBack").hidden=!prefSec;
  for(const [k,id] of Object.entries(PREF_SECS))$(id).hidden=prefSec!==k;
  if(!prefSec)renderPrefMenu()}
function openPrefSec(k){prefSec=k;applyPrefSec();if(k==="me")fillMe();if(k==="acc")fillSettings(true);if(k==="subs")fillSubs();if(k==="cats"){catEdit=null;renderCatSet()}if(k==="tpls"){tplEdit=null;renderTplSet()}scrollTo({top:0})}
$("prefBackBtn").onclick=()=>{prefSec=null;applyPrefSec();scrollTo({top:0})};

/* ---------- views ---------- */
let view=prefs.start;
function setView(v,userNav){view=v;if(userNav)navTouched=true;
  if(userNav&&editingId){editingId=null;edCache={id:null,el:null};renderList()}
  if(userNav&&v==="prefs")prefSec=null;
  $("vSpend").hidden=v!=="spend";$("vStats").hidden=v!=="stats";$("vPrefs").hidden=v!=="prefs";$("vHist").hidden=v!=="history";
  for(const b of document.querySelectorAll(".bnav .nb"))b.toggleAttribute("aria-current",false),b.dataset.view===v&&b.setAttribute("aria-current","page");
  $("monthNav").hidden=!(v==="spend"||v==="stats");$("monthLabel").textContent=monthLabel(month);
  $("fab").disabled=!acc||readOnly;
  if(!acc){$("vSpend").hidden=true;$("vStats").hidden=true;$("vHist").hidden=true}
  if(v==="history")renderHistory();
  resubHist();renderSubs();
  applyPrefSec();
  if(v==="stats")renderStats();
  if(v==="prefs"){renderPrefs();renderCatSet();renderTplSet();applyPrefSec()}
  if(userNav){if(v==="prefs"&&acc)fillSettings(true);tip.hidden=true;scrollTo({top:0})}}
document.querySelector(".bnav").addEventListener("click",e=>{const b=e.target.closest(".nb");if(b)setView(b.dataset.view,true)});

/* ---------- accounts ---------- */
const allAccounts=()=>[...shared,...personal].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
const accDoc=a=>a.type==="personal"?db.doc("data/users/"+uid+"/"+a.id):db.doc("accounts/"+a.id);
const expCol=a=>a.type==="personal"?db.collection("data/users/"+uid+"/"+a.id+"/expenses"):db.collection("accounts/"+a.id+"/expenses");
const people=a=>(a&&a.type==="shared"?(a.people||[]):[]).map(s=>String(s).trim()).filter(Boolean);

function nameOf(id){if(!id)return "";if(id===uid)return "Вы";return names[id]||"Участник"}
async function ensureNames(ids){if(!user)return;const need=[...new Set(ids)].filter(i=>i&&!(i in names)&&!pendingNames.has(i));
  if(!need.length)return;need.forEach(i=>pendingNames.add(i));
  try{const ps=await user.profiles(need);for(const i of need){names[i]=(ps[i]&&ps[i].name)||"";pendingNames.delete(i)}render();renderPeople();renderStats()}
  catch(e){need.forEach(i=>{names[i]="";pendingNames.delete(i)})}}

const kindText=a=>a.type==="personal"?"личный":"общий · "+(a.members||[]).length+" "+plural((a.members||[]).length,["участник","участника","участников"]);
function renderTabs(){const list=allAccounts();
  $("accName").textContent=acc?(acc.name||"Без названия"):list.length?"Выберите счёт":"Семейная касса";
  $("accKind").textContent=acc?(acc.type==="personal"?"личный счёт":kindText(acc)):db?(list.length?"":"нет счетов"):"";
  $("tabs").replaceChildren(...(list.length?list.map(a=>{const sel=!!acc&&sameAcc(a,acc);
    return h("button",{type:"button",class:"accrow",role:"option","aria-selected":String(sel),onclick:()=>{closeSheet();if(!sel)selectAcc(a)}},
      h("span",{class:"accav"+(a.type==="personal"?" p":""),"aria-hidden":"true"},(String(a.name||"?").trim().charAt(0)||"?").toUpperCase()),
      h("span",{class:"n"},h("b",null,a.name||"Без названия"),h("small",null,kindText(a))),
      h("span",{class:"accbal"+((ovBal[a.type+":"+a.id]||0)<0?" neg":"")},a.type+":"+a.id in ovBal?fmtC(ovBal[a.type+":"+a.id],a.currency||"₽"):"…"),
      h("span",{class:"check","aria-hidden":"true"},sel?"✓":""))}):[h("div",{class:"empty"},"Счетов пока нет.")]));
  const known=list.filter(a=>a.type+":"+a.id in ovBal);
  if(list.length>1&&known.length===list.length){let sumv=0;const miss=new Set();
    for(const a of list){const v=conv(ovBal[a.type+":"+a.id],a.currency||"₽");if(v===null)miss.add(a.currency||"₽");else sumv+=v}
    $("accTotal").replaceChildren(...[h("span",null,"Всего на всех счетах"),h("b",{class:sumv<0?"neg":""},fmtC(sumv,prefs.base)),
      miss.size?h("small",null,"Без счетов в "+[...miss].join(", ")+": задайте курс в «Настройки → Общие».") :null].filter(Boolean))}
  else $("accTotal").replaceChildren(...(list.length>1?[h("span",null,"Всего на всех счетах"),h("b",null,"…")]:[]));
  $("accNew").hidden=readOnly||!db;$("accJoin").hidden=readOnly||!db}
function selectAcc(a){acc=a;lsSet("fk.acc",a.type+":"+a.id);dangerConfirm=false;
  catEdit=null;tplEdit=null;tplActive=null;tplSaveState=null;goalNew=null;goalEdit=null;
  $("newPanel").hidden=true;editingId=null;syncView();resubscribe();resubHist()}
function openNew(first){closeSheet();$("newPanel").hidden=false;scrollTo({top:0});$("newIntro").hidden=!first;$("cancelNew").hidden=first;
  $("newTitle").textContent=first?"Создайте первый счёт":"Новый счёт";$("newMsg").textContent="";$("joinMsg").textContent="";
  if(!first)$("newName").focus()}
function setNewType(t){newType=t;for(const b of $("newType").querySelectorAll("button"))b.setAttribute("aria-checked",String(b.dataset.type===t))}
$("newType").addEventListener("click",e=>{const b=e.target.closest("button");if(b)setNewType(b.dataset.type)});
$("cancelNew").onclick=()=>{$("newPanel").hidden=true};

function onAccounts(){if(!(gotP&&gotS))return;
  const list=allAccounts(),saved=lsGet("fk.acc")||"";
  let next=acc&&list.find(a=>a.id===acc.id&&a.type===acc.type);
  if(!next)next=list.find(a=>a.type+":"+a.id===saved)||list[0]||null;
  acc=next;
  if(!acc){syncView();if(!readOnly)openNew(true);else notice("Пока нет счетов, доступных вам.");return}
  syncView();resubscribe();resubHist()}

function syncView(){renderTabs();setView(view,false);
  if(!acc)return;
  const isShared=acc.type==="shared";
  $("setTitle").textContent="Счёт «"+(acc.name||"")+"»";
  $("inviteBlock").hidden=!isShared;$("setPeopleWrap").hidden=!isShared;
  $("codeOut").textContent=acc.code||"——————";
  applyCats();resubIcons();loadSubSel();fillSettings(false);renderWho();renderDanger();renderPeople();renderCats();renderTplBar();renderSubs();render();renderStats();renderHistory();renderCatSet();renderTplSet()}

function renderCats(){if(curKind==="tr"&&!canTransfer())curKind="exp";
  const inc=curKind==="inc",vis=(inc?INC_CATS:CATS).filter(c=>!c.hidden);
  if(!vis.some(c=>c.id===(inc?curInc:curCat))){if(inc)curInc=vis[0].id;else curCat=vis[0].id}
  const sel=inc?curInc:curCat;
  const kinds=[["exp","Расход"],["inc","Доход"]];if(canTransfer())kinds.push(["tr","Перевод"]);
  $("kindSeg").replaceChildren(mseg(kinds,curKind,v=>{curKind=v;renderCats()},"Тип операции"));
  $("catLabel").textContent=inc?"Источник":"Категория";$("whoLabel").textContent=inc?"Кто получил":"Кто потратил";
  $("addBtn").textContent=curKind==="tr"?"Перевести":inc?"Добавить доход":"Добавить расход";
  const tiles=vis.map(c=>h("button",{type:"button",class:"ctile",role:"radio","aria-checked":String(c.id===sel),
    onclick:()=>{if(inc)curInc=c.id;else curCat=c.id;renderCats()}},catIcon(c,40),h("span",null,c.name)));
  if(!readOnly)tiles.push(h("button",{type:"button",class:"ctile more",onclick:()=>{closeSheet();catTab=inc?"inc":"exp";setView("prefs",true);openPrefSec("cats")}},catIcon({c:"--c10",icon:"tools"},40),h("span",null,"Настроить")));
  $("cats").replaceChildren(...tiles);
  $("entryTitle").textContent=curKind==="tr"?"Новый перевод":inc?"Новый доход":"Новый расход";
  renderFormSubs()}
function curWho(){const p=people(acc);if(!p.length)return "";let v=lsGet("fk.who."+acc.id);if(!p.includes(v))v=p[0];return v}
function renderWho(){if(!acc)return;const p=people(acc),sel=curWho();
  $("members").replaceChildren(...p.map(n=>h("button",{type:"button",class:"chip",role:"radio","aria-checked":String(n===sel),
    onclick:()=>{lsSet("fk.who."+acc.id,n);renderWho()}},n)));renderDetails()}

/* ---------- spending view ---------- */
function render(){
  if(view==="spend"||view==="stats")$("monthLabel").textContent=monthLabel(month);
  if(!acc)return;
  $("curSym").textContent=cur();
  const ops=expenses.filter(inSub),exps=ops.filter(isExp),incs=ops.filter(isInc);
  const total=sum(exps),incTotal=sum(incs),bal=incTotal-total;
  $("sumLabel").textContent=MONTHS[+month.slice(5)-1]+(subSel!=="all"?" · "+subName(subSel):"");
  $("total").textContent=fmt(total);
  $("incV").textContent=incTotal?"+"+fmt(incTotal):"—";
  const bv=$("balV");bv.textContent=incTotal||total?(bal>0?"+":"")+fmt(bal):"—";bv.className=!(incTotal||total)?"":bal>=0?"pos":"neg";
  const now=today().slice(0,7),isNow=month===now,isPast=month<now;
  const budget=accBudget();
  $("meterWrap").hidden=!budget;
  if(budget){const p=total/budget,f=$("fill");f.style.width=Math.min(100,p*100)+"%";f.className="fill"+(p>1?" bad":p>.9?" warn":"");
    const left=budget-total;
    $("meterMeta").replaceChildren(h("span",null,"Бюджет "+fmt(budget)+" · "+Math.round(p*100)+"%"),
      left>=0?h("span",null,"осталось "+fmt(left)):h("span",{class:"over"},"перерасход "+fmt(-left)))}
  const st=$("stats");
  if(isNow&&budget>total){const dl=daysIn(month)-new Date().getDate()+1;st.replaceChildren("Можно тратить ",h("b",null,fmt((budget-total)/dl))," в день до конца месяца")}
  else{const daysPassed=isNow?new Date().getDate():isPast?daysIn(month):0;
    st.replaceChildren(...(daysPassed&&total?["В среднем ",h("b",null,fmt(total/daysPassed))," в день"]:[]))}
  if(acc.type==="shared")ensureNames(expenses.map(e=>e.by));
  $("listTitle").textContent="Операции за "+MONTHS[+month.slice(5)-1].toLowerCase();
  renderList();renderDue();renderGoals()}
const who=e=>e.member||nameOf(e.by)||"—";
function group(list,key){const m={};for(const e of list){const k=key(e);m[k]=(m[k]||0)+(Number(e.amount)||0)}return Object.entries(m).sort((a,b)=>b[1]-a[1])}
function personColor(name){const all=[...new Set([...people(acc),...histExp.map(who),...expenses.map(who)])].sort();
  const i=all.indexOf(name);return i<0||i>7?"var(--c10)":"var(--c"+(i+1)+")"}
function renderBars(box,rows,name,color,total){
  if(!rows.length){box.replaceChildren(h("div",{class:"empty"},"Пока пусто"));return}
  const max=rows[0][1]||1;
  box.replaceChildren(...rows.map(([k,v])=>h("div",{class:"brow"},
    h("div",{class:"name"},h("span",{class:"dot",style:"background:"+color(k)}),name(k)),
    h("div",{class:"val"},fmt(v),h("small",null,total?Math.round(v/total*100)+"%":"")),
    h("div",{class:"bt"},h("i",{style:"width:"+(v/max*100)+"%;background:"+color(k)})))))}
function renderList(){const box=$("list");
  if(!loaded){box.replaceChildren(h("div",{class:"empty"},"Загружаем траты…"));return}
  if(!expenses.filter(inSub).length){box.replaceChildren(h("div",{class:"empty"},acc.type==="shared"?"В этом месяце операций пока нет. Нажмите «+» внизу, чтобы добавить первую — её сразу увидят все участники счёта.":"В этом месяце операций пока нет. Нажмите «+» внизу, чтобы добавить первую."));return}
  const sorted=expenses.filter(inSub).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0));
  const days={};for(const e of sorted)(days[e.date]=days[e.date]||[]).push(e);
  box.replaceChildren(...Object.keys(days).map(d=>{const items=days[d],out=sum(items.filter(isExp)),inn=sum(items.filter(isInc));
    return h("div",{class:"day"},h("div",{class:"dayh"},h("span",null,dayLabel(d)),h("span",null,out?fmt(out):null,inn?h("span",{class:"in"},"+"+fmt(inn)):null)),
      ...items.map(e=>itemRow(e,false,"ops")))}))}

/* ---------- rows and editor ---------- */
let editingId=null,editingWhere="",edCache={id:null,el:null};
const shortDate=d=>{const [y,m,dd]=String(d).split("-").map(Number);return new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short",year:"numeric"}).format(new Date(y,m-1,dd))};
function itemRow(e,showDate,where){if(editingId===e.id&&editingWhere===where)return editor(e);
  const c=catOf(e),inc=isInc(e),tr=isTr(e),multi=subsOf(acc).length>1;
  const sub=[showDate&&e.date?shortDate(e.date):"",tr?endName(e,"from")+" → "+endName(e,"to"):"",!tr&&e.note?c.name:"",
    !tr&&multi&&subSel==="all"?subName(subOf(e)):"",e.goal?goalName(e.goal):"",acc.type==="shared"?who(e):""].filter(Boolean).join(" · ");
  const sign=tr?trSign(e):inc?"+":"";
  const kids=[catIcon(c,34),
    h("div",{class:"what"},h("div",null,e.note||c.name),sub?h("div",{class:"sub"},sub):null),
    h("div",{class:"amt"+(tr?" tr":inc?" inc":"")},sign+fmt(Number(e.amount)||0))];
  return readOnly?h("div",{class:"item"},...kids):h("button",{type:"button",class:"item","aria-label":"Изменить: "+(e.note||c.name)+", "+fmt(Number(e.amount)||0),onclick:()=>openEditor(e.id,where)},...kids)}
function openEditor(id,where){editingId=id;editingWhere=where;edCache={id:null,el:null};renderList();renderHistory()}
function closeEditor(){editingId=null;edCache={id:null,el:null};renderList();renderHistory()}
function editor(e){if(isX(e))return xEditor(e);if(edCache.id===e.id&&edCache.el)return edCache.el;
  const subs=subsOf(acc);
  const st={kind:isTr(e)?"tr":isInc(e)?"inc":"exp",cat:isTr(e)?"":catOf(e).id,confirm:false};
  const opt=()=>subs.map(x=>h("option",{value:x.id},x.name));
  const kindBox=h("div"),catSel=h("select",{class:"field",id:"ed-cat"}),
    amount=h("input",{class:"field",id:"ed-amount",inputmode:"decimal",autocomplete:"off",value:String(e.amount??"")}),
    date=h("input",{type:"date",id:"ed-date",value:e.date||today()}),
    note=h("input",{class:"field",id:"ed-note",maxlength:"80",placeholder:"Необязательно",value:e.note||""}),
    subSelE=h("select",{class:"field",id:"ed-sub"},...opt()),fromE=h("select",{class:"field",id:"ed-from"},...opt()),toE=h("select",{class:"field",id:"ed-to"},...opt()),
    msg=h("div",{class:"formmsg",role:"status"}),delBox=h("div",{class:"confirm"});
  subSelE.value=isTr(e)?(subSel!=="all"?subSel:"main"):subOf(e);
  fromE.value=isTr(e)?trEnd(e.from):subOf(e);toE.value=isTr(e)?trEnd(e.to):(subs.find(x=>x.id!==fromE.value)||subs[0]).id;
  let whoSel=null;const pp=[...new Set([...people(acc),e.member].filter(Boolean))];
  if(acc.type==="shared"&&pp.length){whoSel=h("select",{class:"field",id:"ed-who"},...pp.map(n=>h("option",{value:n},n)));whoSel.value=e.member||pp[0]}
  const catLbl=h("label",{class:"label",for:"ed-cat"},"Категория");
  const catBox=h("div",null,catLbl,catSel),subBox=h("div",null,h("label",{class:"label",for:"ed-sub"},"Кошелёк"),subSelE),
    trBox=h("div",{class:"row2 half"},h("div",null,h("label",{class:"label",for:"ed-from"},"Откуда"),fromE),h("div",null,h("label",{class:"label",for:"ed-to"},"Куда"),toE));
  const fillCats=()=>{const tr=st.kind==="tr";catBox.hidden=tr;trBox.hidden=!tr;subBox.hidden=tr||subs.length<2;if(tr)return;
    const list=(st.kind==="inc"?INC_CATS:CATS).filter(c=>!c.hidden||c.id===st.cat);catLbl.textContent=st.kind==="inc"?"Источник":"Категория";
    catSel.replaceChildren(...list.map(c=>h("option",{value:c.id},c.name)));catSel.value=list.some(c=>c.id===st.cat)?st.cat:list[0].id};
  const kinds=[["exp","Расход"],["inc","Доход"]];if(subs.length>1||isTr(e))kinds.push(["tr","Перевод"]);
  const drawKind=()=>kindBox.replaceChildren(mseg(kinds,st.kind,v=>{st.kind=v;drawKind();fillCats()},"Тип операции"));
  catSel.onchange=()=>{st.cat=catSel.value};
  const drawDel=()=>delBox.replaceChildren(...(st.confirm
    ?[h("button",{type:"button",class:"del",onclick:doDel},"Да, удалить"),h("button",{type:"button",onclick:()=>{st.confirm=false;drawDel()}},"Не удалять")]
    :[h("button",{type:"button",class:"danger",onclick:()=>{st.confirm=true;drawDel()}},"Удалить операцию")]));
  async function doDel(){try{await expCol(acc).doc(e.id).delete();patchLocal(e.id,null);closeEditor();toast("Операция удалена")}catch(err){writeErr(err,msg)}}
  async function save(){msg.classList.remove("bad");const a=Math.round(parseNum(amount.value)*100)/100;
    if(!(a>0)||a>1e9){msg.classList.add("bad");msg.textContent="Введите сумму больше нуля.";amount.focus();return}
    const d=date.value||e.date||today();
    const patch={amount:a,date:d,month:d.slice(0,7),note:note.value.trim().slice(0,80)};
    if(st.kind==="tr"){if(fromE.value===toE.value){msg.classList.add("bad");msg.textContent="Выберите разные кошельки: откуда и куда.";return}
      Object.assign(patch,{kind:"transfer",from:fromE.value,to:toE.value})}
    else Object.assign(patch,{kind:st.kind==="inc"?"income":"expense",cat:catSel.value,sub:subSelE.value});
    if(whoSel)patch.member=whoSel.value;
    try{await expCol(acc).doc(e.id).update(patch);patchLocal(e.id,{...e,...patch});const moved=view==="spend"&&d.slice(0,7)!==month;closeEditor();
      toast(moved?"Сохранено. Операция перенесена в "+monthLabel(d.slice(0,7)).toLowerCase():"Изменения сохранены")}catch(err){writeErr(err,msg)}}
  drawKind();fillCats();drawDel();
  const meta=acc.type==="shared"&&e.by?h("div",{class:"hint",style:"margin:0"},"Добавил(а): "+nameOf(e.by)+(e.createdAt>1e12?" · "+new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(e.createdAt)):"")):null;
  const el=h("div",{class:"editor"},kindBox,
    h("div",null,h("label",{class:"label",for:"ed-amount"},"Сумма, "+cur()),amount),
    h("div",{class:"row2"},h("div",null,h("label",{class:"label",for:"ed-date"},"Дата"),date),catBox),
    subBox,trBox,
    whoSel?h("div",null,h("label",{class:"label",for:"ed-who"},"Кто"),whoSel):null,
    h("div",null,h("label",{class:"label",for:"ed-note"},"Комментарий"),note),
    h("div",{class:"inline"},h("button",{type:"button",class:"primary",onclick:save},"Сохранить"),h("button",{type:"button",class:"ghost",onclick:closeEditor},"Отмена")),
    msg,delBox,meta);
  edCache={id:e.id,el};setTimeout(()=>{try{amount.focus({preventScroll:true})}catch(x){}},0);return el}

/* ---------- sub-accounts ---------- */
const subsOf=a=>{const list=Array.isArray(a&&a.subs)?a.subs.filter(x=>x&&x.id&&x.name):[];
  const main=list.find(x=>x.id==="main")||{id:"main",name:"Основной",start:0};return [main,...list.filter(x=>x.id!=="main")]};
const subIds=()=>subsOf(acc).map(x=>x.id);
const subOf=e=>subIds().includes(e.sub)?e.sub:"main";
const subName=id=>(subsOf(acc).find(x=>x.id===id)||subsOf(acc)[0]).name;
const trEnd=id=>id==="ext"?"ext":subIds().includes(id)?id:"main";
const isOff=id=>{const l=subsOf(acc);return l.length>1&&!!(l.find(x=>x.id===id)||{}).off};
function switchBtn(label,on,onToggle,id){return h("button",{type:"button",class:"switch",role:"switch",id:id||null,"aria-checked":String(!!on),onclick:onToggle},h("i"),label)}
const genId=()=>"s"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function inSub(e){if(!acc)return true;
  if(isTr(e)){const f=trEnd(e.from),t=trEnd(e.to);if(subSel==="all")return (f!=="ext"&&!isOff(f))||(t!=="ext"&&!isOff(t));return f===subSel||t===subSel}
  return subSel==="all"?!isOff(subOf(e)):subOf(e)===subSel}
function balancesFor(a,ops){const subs=subsOf(a),ids=subs.map(x=>x.id),b=Object.fromEntries(subs.map(x=>[x.id,Number(x.start)||0]));
  const end=id=>id==="ext"?"ext":ids.includes(id)?id:"main";
  for(const e of ops){const v=Number(e.amount)||0;
    if(isTr(e)){const f=end(e.from),t=end(e.to);if(f!=="ext")b[f]-=v;if(t!=="ext")b[t]+=v}
    else b[ids.includes(e.sub)?e.sub:"main"]+=isInc(e)?v:-v}
  return b}
function totalFor(a,b){const subs=subsOf(a);return subs.filter(x=>!(subs.length>1&&x.off)).reduce((t,x)=>t+(b[x.id]||0),0)}
function balances(){return balancesFor(acc,histExp)}
/* reads every operation of any account the viewer can open (used for the overview and all-accounts statistics) */
const opsCache=new Map();
async function loadOpsOf(a){if(acc&&sameAcc(a,acc)&&histLoaded&&archDone)return histExp;
  const key=a.type+":"+a.id,c=opsCache.get(key);if(c&&Date.now()-c.at<120000)return c.ops;
  const col=expCol(a),out=new Map();let upper="9999-12-31",strict=false,guard=0;
  for(;;){const qs=await col.where("date",strict?"<":"<=",upper).orderBy("date","desc").limit(1000).get();let fresh=0,oldest=upper;
    for(const d of qs.docs){const v=d.data();if(!out.has(d.id)){out.set(d.id,{id:d.id,...v});fresh++}const dt=String(v.date||"");if(dt&&dt<oldest)oldest=dt}
    if(qs.size<1000||++guard>500)break;
    if(fresh===0){if(strict)break;strict=true;continue}
    upper=oldest;strict=false}
  const ops=[...out.values()];opsCache.set(key,{at:Date.now(),ops});return ops}
function loadSubSel(){const v=acc?lsGet("fk.sub."+acc.type+acc.id):null;subSel=v&&(v==="all"||subIds().includes(v))?v:"all";if(subsOf(acc).length<2)subSel="all"}
function pickSub(v){subSel=v;formSub=v==="all"?formSub:v;if(acc)lsSet("fk.sub."+acc.type+acc.id,v);editingId=null;edCache={id:null,el:null};
  renderSubs();render();renderStats();renderHistory();renderCats()}
function renderSubs(){const strip=$("subStrip");strip.hidden=!acc||view==="prefs";if(strip.hidden){$("newSub").hidden=true;$("subToggle").hidden=true;return}
  const subs=subsOf(acc),bal=histLoaded&&archDone?balances():null,one=subs.length<2;
  const total=bal?subs.filter(x=>!isOff(x.id)).reduce((t,x)=>t+bal[x.id],0):null;
  const chip=(id,name,v)=>{const off=id!=="all"&&isOff(id);
    return h("button",{type:"button",class:"subchip"+(off?" off":""),"aria-pressed":String(subSel===id||one&&id==="main"),onclick:()=>pickSub(one?"all":id),
      title:id==="all"?"Сумма кошельков, включённых во «Всего»":off?"Не входит во «Всего»":"Баланс кошелька"},
      h("span",null,name),h("small",{class:v!==null&&v<0?"neg":""},v===null?"…":fmt(v)))};
  const items=[];if(!one)items.push(chip("all","Всего",total));
  for(const x of subs)items.push(chip(x.id,x.name,bal?bal[x.id]:null));
  if(!readOnly)items.push(h("button",{type:"button",class:"subchip add",onclick:()=>{$("newSub").hidden=false;$("nsMsg").textContent="";$("nsName").focus()}},"+ Кошелёк"));
  $("subs").replaceChildren(...items);renderSubToggle()}
function renderSubToggle(){const box=$("subToggle"),subs=subsOf(acc);
  box.hidden=!acc||view==="prefs"||subs.length<2||subSel==="all";if(box.hidden)return;
  const x=subs.find(y=>y.id===subSel);if(!x){box.hidden=true;return}
  const btn=switchBtn("Включать «"+x.name+"» во «Всего»",!x.off,()=>toggleOff(x.id,btn),"subOffSw");
  if(readOnly)btn.disabled=true;
  box.replaceChildren(btn,h("div",{class:"hint",style:"margin:0"},x.off?"Сейчас этот кошелёк не входит во «Всего»: его баланс, операции, бюджет и статистика считаются отдельно.":"Баланс и операции этого кошелька входят во «Всего», бюджет и общую статистику."))}
async function toggleOff(id,btn){if(!acc||readOnly)return;const a=acc;
  const next=subsOf(a).map(x=>({id:x.id,name:x.name,start:Number(x.start)||0,off:x.id===id?!x.off:!!x.off}));
  if(btn)btn.disabled=true;
  try{await accDoc(a).update({subs:next});a.subs=next;filledFor="";fillSettings(false);
    const now=next.find(x=>x.id===id);toast(now.off?"«"+now.name+"» больше не входит во «Всего»":"«"+now.name+"» снова входит во «Всего»");
    renderSubs();render();renderStats();renderHistory()}
  catch(e){toast("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.");if(btn)btn.disabled=false}}
function renderFormSubs(){if(!acc)return;const subs=subsOf(acc),tr=curKind==="tr";
  if(!subs.some(x=>x.id===formSub))formSub=subSel!=="all"?subSel:lsGet("fk.fsub."+acc.id);
  if(!subs.some(x=>x.id===formSub))formSub="main";
  $("trWrap").hidden=!tr;$("catWrap").hidden=tr;
  $("subPick").replaceChildren(...subs.map(x=>h("button",{type:"button",class:"chip",role:"radio","aria-checked":String(x.id===formSub),
    onclick:()=>{formSub=x.id;lsSet("fk.fsub."+acc.id,x.id);renderFormSubs()}},x.name)));
  if(!subs.some(x=>x.id===trFrom))trFrom=subSel!=="all"?subSel:subs[0].id;
  if(!validTo(trTo)||trTo===trFrom)trTo=defaultTo(trFrom);
  $("trFrom").replaceChildren(...subs.map(x=>h("option",{value:x.id},x.name)));$("trTo").replaceChildren(...toOptions());
  $("trFrom").value=trFrom;$("trTo").value=trTo;updAmt2();renderDetails()}
function updAmt2(){const dest=curKind==="tr"?destOf(trTo):null,show=!!dest&&(dest.a.currency||"₽")!==cur();
  $("trAmt2Wrap").hidden=!show;if(show)$("trAmt2Lbl").textContent="Придёт в «"+(dest.a.name||"")+"», "+(dest.a.currency||"₽")}
$("trFrom").onchange=e=>{trFrom=e.target.value};$("trTo").onchange=e=>{trTo=e.target.value;updAmt2()};
$("nsCancel").onclick=()=>{$("newSub").hidden=true};
$("nsCreate").onclick=async()=>{const msg=$("nsMsg");msg.classList.remove("bad");if(!acc)return;
  const name=$("nsName").value.trim().slice(0,30);
  if(!name){msg.classList.add("bad");msg.textContent="Придумайте название кошелька.";$("nsName").focus();return}
  const subs=subsOf(acc);
  if(subs.some(x=>x.name.toLowerCase()===name.toLowerCase())){msg.classList.add("bad");msg.textContent="Кошелёк с таким названием уже есть.";return}
  const st=parseNum($("nsStart").value),id=genId(),next=[...subs.map(x=>({id:x.id,name:x.name,start:Number(x.start)||0,off:!!x.off})),{id,name,start:Number.isFinite(st)?Math.round(st*100)/100:0,off:false}];
  const btn=$("nsCreate");btn.disabled=true;
  try{await accDoc(acc).update({subs:next});acc.subs=next;$("nsName").value="";$("nsStart").value="";$("newSub").hidden=true;
    filledFor="";fillSettings(false);toast("Кошелёк «"+name+"» добавлен");pickSub(id)}catch(e){writeErr(e,msg)}finally{btn.disabled=false}};
function fillSubs(){subDraft=subsOf(acc).map(x=>({id:x.id,name:x.name,start:Number(x.start)||0,off:!!x.off}));renderSubRows()}
function renderSubRows(){$("subRows").replaceChildren(...subDraft.map((x,i)=>h("div",{class:"subrow"+(x.del?" del":"")},
  h("div",null,h("label",{class:"label",for:"sbn-"+i},"Название"),h("input",{class:"field",id:"sbn-"+i,maxlength:"30",value:x.name,disabled:x.del?true:null,oninput:e=>{x.name=e.target.value}})),
  h("div",null,h("label",{class:"label",for:"sbs-"+i},"На старте"),h("input",{class:"field",id:"sbs-"+i,inputmode:"decimal",value:String(x.start),disabled:x.del?true:null,oninput:e=>{x.start=e.target.value}})),
  i===0?h("span"):h("button",{type:"button",class:"icon-btn","aria-label":(x.del?"Вернуть":"Удалить")+" кошелёк",title:x.del?"Вернуть":"Удалить",
    onclick:()=>{if(x.isNew)subDraft.splice(i,1);else x.del=!x.del;renderSubRows()}},x.del?"↺":"×"),
  subDraft.length>1&&!x.del?h("div",{class:"sw-line"},switchBtn("Включать во «Всего»",!x.off,()=>{x.off=!x.off;renderSubRows()},"sbo-"+i)):null)));
  const n=subDraft.filter(x=>x.del).length;
  if(n)$("subRows").append(h("div",{class:"hint",style:"margin:0;color:var(--bad)"},(n===1?"Отмеченный кошелёк удалится":"Отмеченные кошельки удалятся")+" после сохранения, их операции перейдут в «"+(subDraft[0].name||"Основной")+"»."))}
$("addSubRow").onclick=()=>{subDraft.push({id:genId(),name:"",start:0,isNew:true});renderSubRows();$("sbn-"+(subDraft.length-1)).focus()};
async function reassignSub(a,id){const col=expCol(a);
  for(const f of ["sub","from","to"]){const qs=await col.where(f,"==",id).get();
    for(const d of qs.docs){const v=d.data();
      if(f!=="sub"&&v.kind==="transfer"){const other=f==="from"?v.to:v.from;if(other==="main"||other===id||!other){await col.doc(d.id).delete();continue}}
      await col.doc(d.id).update({[f]:"main"})}}}

/* ---------- operations: create, transfers between accounts ---------- */
const canTransfer=()=>!!acc&&(subsOf(acc).length>1||allAccounts().length>1);
const sameAcc=(a,b)=>!!a&&!!b&&a.type===b.type&&a.id===b.id;
function destOf(to){if(!String(to||"").startsWith("x:"))return null;const [,t,id,sid]=String(to).split(":");
  const a=allAccounts().find(x=>x.type===t&&x.id===id);if(!a||sameAcc(a,acc))return null;return {a,sid:subsOf(a).some(s=>s.id===sid)?sid:"main"}}
function toOptions(){const subs=subsOf(acc),others=allAccounts().filter(a=>!sameAcc(a,acc));
  return [h("optgroup",{label:"Этот счёт"},...subs.map(x=>h("option",{value:x.id},x.name))),
    ...others.map(a=>{const ss=subsOf(a),cc=(a.currency||"₽")!==cur()?" ("+(a.currency||"₽")+")":"";
      return h("optgroup",{label:"Счёт «"+(a.name||"")+"»"+cc},...ss.map(x=>h("option",{value:"x:"+a.type+":"+a.id+":"+x.id},ss.length>1?x.name:"«"+(a.name||"")+"»"+cc)))})]}
const validTo=v=>subIds().includes(v)||!!destOf(v);
function defaultTo(from){const s=subsOf(acc).find(x=>x.id!==from);if(s)return s.id;const o=allAccounts().find(a=>!sameAcc(a,acc));return o?"x:"+o.type+":"+o.id+":main":from}
const isX=e=>isTr(e)&&(e.from==="ext"||e.to==="ext");
const endName=(e,side)=>{const v=trEnd(side==="from"?e.from:e.to);return v==="ext"?"«"+((e.xacc&&e.xacc.name)||"другой счёт")+"»":subName(v)};
function trSign(e){const f=trEnd(e.from),t=trEnd(e.to);
  if(subSel==="all"){const fi=f!=="ext"&&!isOff(f),ti=t!=="ext"&&!isOff(t);return fi&&ti?"⇄ ":fi?"−":"+"}
  return f===subSel?"−":"+"}
function noteLocal(id,doc){if(String(doc.date)<archFrom){archExp.set(id,{...doc,id});mergeHist();afterHist()}}
function patchLocal(id,doc){if(doc&&String(doc.date)<archFrom)archExp.set(id,{...doc,id});else archExp.delete(id);mergeHist();afterHist()}
async function createOp(o){
  const base={amount:o.amount,member:o.member||"",by:uid,note:o.note||"",date:o.date,month:o.date.slice(0,7),createdAt:Date.now()};
  if(o.tpl)base.tpl=o.tpl;if(o.goal)base.goal=o.goal;
  if(o.kind==="tr"){const dest=destOf(o.to);
    if(dest){const link=genId();
      const doc={...base,kind:"transfer",from:o.from,to:"ext",xacc:{type:dest.a.type,id:dest.a.id,name:dest.a.name||""},xsub:dest.sid,link};
      const ref=await expCol(acc).add(doc);noteLocal(ref.id,doc);
      const other={amount:o.amount2||o.amount,member:"",by:uid,note:o.note||"",date:o.date,month:o.date.slice(0,7),createdAt:Date.now(),
        kind:"transfer",from:"ext",to:dest.sid,xacc:{type:acc.type,id:acc.id,name:acc.name||""},xsub:o.from,link};
      try{await expCol(dest.a).add(other)}catch(e){toast("Списание записано, но в счёт «"+(dest.a.name||"")+"» перевод не попал. Проверьте доступ к нему.")}
      return ref}
    const doc={...base,kind:"transfer",from:o.from,to:o.to};const ref=await expCol(acc).add(doc);noteLocal(ref.id,doc);return ref}
  const doc={...base,kind:o.kind==="inc"?"income":"expense",cat:o.cat,sub:o.sub||"main"};
  const ref=await expCol(acc).add(doc);noteLocal(ref.id,doc);return ref}
async function counterpart(e){const t=e.xacc||{};const a=allAccounts().find(x=>x.type===t.type&&x.id===t.id);if(!a||!e.link)return null;
  try{const qs=await expCol(a).where("link","==",e.link).limit(3).get();const d=qs.docs.find(x=>x.id!==e.id||!sameAcc(a,acc));return d?{a,id:d.id}:null}catch(err){return null}}
function xEditor(e){if(edCache.id===e.id&&edCache.el)return edCache.el;
  const out=e.to==="ext",other=(e.xacc&&e.xacc.name)||"другой счёт",st={confirm:false};
  const amount=h("input",{class:"field",id:"ed-amount",inputmode:"decimal",autocomplete:"off",value:String(e.amount??"")}),
    date=h("input",{type:"date",id:"ed-date",value:e.date||today()}),
    note=h("input",{class:"field",id:"ed-note",maxlength:"80",placeholder:"Необязательно",value:e.note||""}),
    msg=h("div",{class:"formmsg",role:"status"}),delBox=h("div",{class:"confirm"});
  const drawDel=()=>delBox.replaceChildren(...(st.confirm
    ?[h("button",{type:"button",class:"del",onclick:doDel},"Да, удалить в обоих счетах"),h("button",{type:"button",onclick:()=>{st.confirm=false;drawDel()}},"Не удалять")]
    :[h("button",{type:"button",class:"danger",onclick:()=>{st.confirm=true;drawDel()}},"Удалить перевод")]));
  async function doDel(){try{const cp=await counterpart(e);await expCol(acc).doc(e.id).delete();patchLocal(e.id,null);
      if(cp)await expCol(cp.a).doc(cp.id).delete();closeEditor();toast(cp?"Перевод удалён в обоих счетах":"Перевод удалён в этом счёте. Во втором счёте удалите запись вручную.")}catch(err){writeErr(err,msg)}}
  async function save(){msg.classList.remove("bad");const a=Math.round(parseNum(amount.value)*100)/100;
    if(!(a>0)||a>1e9){msg.classList.add("bad");msg.textContent="Введите сумму больше нуля.";amount.focus();return}
    const d=date.value||e.date||today(),patch={amount:a,date:d,month:d.slice(0,7),note:note.value.trim().slice(0,80)};
    try{await expCol(acc).doc(e.id).update(patch);patchLocal(e.id,{...e,...patch});
      const cp=await counterpart(e);let both=false;
      if(cp){const same=(cp.a.currency||"₽")===cur();const p2={date:patch.date,month:patch.month,note:patch.note};if(same)p2.amount=a;await expCol(cp.a).doc(cp.id).update(p2);both=true}
      closeEditor();toast(both?"Изменения сохранены в обоих счетах":"Сохранено в этом счёте")}catch(err){writeErr(err,msg)}}
  drawDel();
  const el=h("div",{class:"editor"},
    h("div",{class:"hint",style:"margin:0"},out?"Перевод из кошелька «"+subName(trEnd(e.from))+"» в счёт «"+other+"».":"Перевод из счёта «"+other+"» в кошелёк «"+subName(trEnd(e.to))+"»."),
    h("div",{class:"row2"},h("div",null,h("label",{class:"label",for:"ed-amount"},"Сумма, "+cur()),amount),h("div",null,h("label",{class:"label",for:"ed-date"},"Дата"),date)),
    h("div",null,h("label",{class:"label",for:"ed-note"},"Комментарий"),note),
    h("div",{class:"inline"},h("button",{type:"button",class:"primary",onclick:save},"Сохранить"),h("button",{type:"button",class:"ghost",onclick:closeEditor},"Отмена")),
    msg,delBox,h("div",{class:"hint",style:"margin:0"},"Дата и комментарий меняются в обоих счетах. Сумма — тоже, если у счетов одна валюта."));
  edCache={id:e.id,el};setTimeout(()=>{try{amount.focus({preventScroll:true})}catch(x){}},0);return el}

/* ---------- payment templates ---------- */
const tplsOf=a=>Array.isArray(a&&a.tpls)?a.tpls.filter(t=>t&&t.id&&t.name):[];
let tplActive=null,tplSaveState=null,tplEdit=null,tplArm=false;
function tplCat(t){return t.kind==="tr"?TR:t.kind==="inc"?(ICAT[t.cat]||ICAT.i_other):(CAT[t.cat]||CAT.other)}
function tplDesc(t){const parts=[t.kind==="inc"?"Доход":t.kind==="tr"?"Перевод":"Расход"];
  if(t.kind==="tr"){const d=destOf(t.to);parts.push(subName(trEnd(t.from))+" → "+(d?"«"+d.a.name+"»":subName(trEnd(t.to))))}else parts.push(tplCat(t).name);
  parts.push(t.repeat==="month"?"каждый месяц "+(+t.day||1)+"-го":"без повтора");return parts.join(" · ")}
async function writeTpls(list,msgEl){if(!acc)return false;const a=acc;
  try{await accDoc(a).update({tpls:list});a.tpls=list;renderTplBar();renderDue();renderTplSet();return true}
  catch(e){if(msgEl)writeErr(e,msgEl);else toast("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.");return false}}
function renderTplBar(){const bar=$("tplBar");if(!acc||readOnly){bar.hidden=true;return}bar.hidden=false;
  const ts=tplsOf(acc);
  const chips=ts.map(t=>h("button",{type:"button",class:"tchip"+(tplActive===t.id?" on":""),"aria-pressed":String(tplActive===t.id),onclick:()=>fillFromTpl(t)},
    catIcon(tplCat(t),22),h("span",null,t.name),t.amount?h("small",null,(t.kind==="inc"?"+":"")+fmt(t.amount)):null));
  chips.push(h("button",{type:"button",class:"tchip add",onclick:openTplSave},ts.length?"+ Шаблон из формы":"+ Сохранить как шаблон"));
  bar.replaceChildren(h("span",{class:"label",style:"margin:0"},"Шаблоны"),h("div",{class:"tscroll"},h("div",{class:"tchips"},...chips)));renderTplSave()}
function fillFromTpl(t,date){if(tplActive===t.id&&!date){tplActive=null;$("amount").value="";$("note").value="";renderTplBar();return}
  curKind=t.kind==="inc"?"inc":t.kind==="tr"&&canTransfer()?"tr":"exp";
  if(curKind==="exp"&&CAT[t.cat])curCat=t.cat;if(curKind==="inc"&&ICAT[t.cat])curInc=t.cat;
  if(t.sub&&subIds().includes(t.sub))formSub=t.sub;
  if(curKind==="tr"){if(subIds().includes(t.from))trFrom=t.from;if(validTo(t.to))trTo=t.to}
  if(t.member&&people(acc).includes(t.member))lsSet("fk.who."+acc.id,t.member);
  $("amount").value=t.amount?String(t.amount).replace(".",","):"";$("note").value=t.note||"";if(date)$("date").value=date;
  tplActive=t.id;detailOpen="";if(sheetOpen!=="entrySheet")openEntry(true);else{renderCats();renderWho();renderTplBar()}}
function openTplSave(){tplSaveState={name:"",monthly:false,day:new Date().getDate()};renderTplSave();setTimeout(()=>{const el=$("tsName");if(el)el.focus()},0)}
function renderTplSave(){const box=$("tplSave");if(!tplSaveState){box.hidden=true;box.replaceChildren();return}box.hidden=false;const st=tplSaveState;
  box.replaceChildren(h("div",{class:"editor"},
    h("div",null,h("label",{class:"label",for:"tsName"},"Название шаблона"),h("input",{class:"field",id:"tsName",maxlength:"30",placeholder:"Например, «Аренда» или «Интернет»",value:st.name,oninput:e=>{st.name=e.target.value}})),
    switchBtn("Повторять каждый месяц",st.monthly,()=>{st.monthly=!st.monthly;renderTplSave()},"tsMonthly"),
    st.monthly?h("div",null,h("label",{class:"label",for:"tsDay"},"Число месяца"),h("input",{class:"field",id:"tsDay",type:"number",min:"1",max:"31",inputmode:"numeric",value:String(st.day),style:"max-width:120px",oninput:e=>{st.day=e.target.value}})):null,
    h("div",{class:"hint",style:"margin:0"},"В шаблон попадут тип, сумма, категория, кошелёк и комментарий из формы. Если сумму не вводить, её нужно будет указывать каждый раз."),
    h("div",{class:"inline"},h("button",{type:"button",class:"primary",onclick:saveTplFromForm},"Сохранить шаблон"),h("button",{type:"button",class:"ghost",onclick:()=>{tplSaveState=null;renderTplSave()}},"Отмена")),
    h("div",{class:"formmsg",id:"tsMsg",role:"status"})))}
async function saveTplFromForm(){const st=tplSaveState,msg=$("tsMsg");msg.classList.remove("bad");const name=String(st.name).trim().slice(0,30);
  if(!name){msg.classList.add("bad");msg.textContent="Придумайте название шаблона.";$("tsName").focus();return}
  const amt=Math.round(parseNum($("amount").value)*100)/100,day=Math.min(31,Math.max(1,parseInt(st.day,10)||1));
  const t={id:genId(),name,kind:curKind,amount:amt>0?amt:0,cat:curKind==="inc"?curInc:curKind==="exp"?curCat:"",sub:formSub||"main",
    from:curKind==="tr"?trFrom:"",to:curKind==="tr"?trTo:"",member:curWho(),note:$("note").value.trim().slice(0,80),repeat:st.monthly?"month":"none",day,skips:[]};
  if(await writeTpls([...tplsOf(acc),t],msg)){tplSaveState=null;tplActive=t.id;renderTplBar();toast("Шаблон «"+name+"» сохранён")}}

function renderDue(){const box=$("dueCard"),tm=today().slice(0,7);
  if(!acc||month!==tm||!loaded){box.hidden=true;return}
  const ts=tplsOf(acc).filter(t=>t.repeat==="month");if(!ts.length){box.hidden=true;return}
  const td=+today().slice(8,10),dim=daysIn(tm);
  const claimed=new Set();
  const all=ts.map(t=>{const own=expenses.find(e=>e.tpl===t.id);let auto=null;
    if(!own){auto=expenses.find(e=>!claimed.has(e.id)&&tplMatches(t,e));if(auto)claimed.add(auto.id)}
    return {t,day:Math.min(dim,Math.max(1,+t.day||1)),done:!!own||!!auto||(t.paid||[]).includes(tm),skip:(t.skips||[]).includes(tm)}});
  const rows=all.filter(r=>!r.done&&!r.skip).sort((a,b)=>a.day-b.day),doneN=all.filter(r=>r.done).length;
  box.hidden=false;
  const head=h("div",{class:"sechead"},h("h2",{style:"margin:0"},"Регулярные платежи"),
    h("span",{class:"hint",style:"margin:0"},rows.length?"осталось "+rows.length+(doneN?" · записано "+doneN:""):"всё записано"));
  if(!rows.length){box.replaceChildren(head);return}
  box.replaceChildren(head,...rows.map(r=>{const t=r.t,due=r.day<=td;
    return h("div",{class:"due"+(due?" now":"")},catIcon(tplCat(t),32),
      h("div",{class:"what"},h("div",null,t.name),h("div",{class:"sub"},(due?(r.day===td?"сегодня":"с "+dayMonth(tm+"-"+pad(r.day))):dayMonth(tm+"-"+pad(r.day)))+(t.kind==="inc"?" · доход":t.kind==="tr"?" · перевод":""))),
      h("div",{class:"amt"+(t.kind==="inc"?" inc":"")},t.amount?(t.kind==="inc"?"+":"")+fmt(t.amount):"сумма не задана"),
      readOnly?null:h("div",{class:"due-act"},
        h("button",{type:"button",class:"ghost sm",title:"Записать операцию по шаблону",onclick:ev=>runTpl(t,r.day,ev.currentTarget)},t.amount?(t.kind==="inc"?"Получено":"Оплачено"):"Указать сумму"),
        h("button",{type:"button",class:"linkbtn muted",title:"Операция уже записана вручную или в другом счёте",onclick:()=>markTpl(t,"paid")},"Уже записано"),
        h("button",{type:"button",class:"linkbtn muted",onclick:()=>markTpl(t,"skips")},"Не в этом месяце")))}),
    h("div",{class:"hint",style:"margin:2px 0 0"},"Платёж отмечается сам, если в этом месяце есть операция с той же категорией и суммой."))}
function tplMatches(t,e){if(e.tpl)return false;
  if(t.kind==="tr"){if(!isTr(e)||trEnd(e.from)!==trEnd(t.from||"main"))return false;const d=destOf(t.to);
    if(d){if(e.to!=="ext"||!e.xacc||e.xacc.id!==d.a.id)return false}else if(trEnd(e.to)!==trEnd(t.to))return false}
  else{if(t.kind==="inc"?!isInc(e):!isExp(e))return false;if((e.cat||(t.kind==="inc"?"i_other":"other"))!==t.cat)return false}
  if(t.amount)return Math.abs((Number(e.amount)||0)-t.amount)<=Math.max(1,t.amount*.02);
  return String(e.note||"").toLowerCase().includes(String(t.name).toLowerCase())}
async function runTpl(t,day,btn){const tm=today().slice(0,7),td=+today().slice(8,10),date=tm+"-"+pad(Math.min(day,td));
  const dest=t.kind==="tr"?destOf(t.to):null;
  const needForm=!t.amount||(t.kind==="tr"&&!canTransfer())||(dest&&(dest.a.currency||"₽")!==cur())||(t.kind==="tr"&&!dest&&!subIds().includes(t.to));
  if(needForm){fillFromTpl(t,date);return}
  if(btn)btn.disabled=true;
  try{await createOp({kind:t.kind,amount:t.amount,cat:t.cat,sub:subIds().includes(t.sub)?t.sub:"main",from:subIds().includes(t.from)?t.from:"main",to:t.to,member:t.member,note:t.note||t.name,date,tpl:t.id});
    toast("«"+t.name+"» записан: "+(t.kind==="inc"?"+":"")+fmt(t.amount))}
  catch(e){toast("Не получилось внести платёж. Проверьте интернет и попробуйте ещё раз.");if(btn)btn.disabled=false}}
async function markTpl(t,field){const tm=today().slice(0,7),list=tplsOf(acc).map(x=>x.id===t.id?{...x,[field]:[...(x[field]||[]).filter(m=>m>=shiftMonth(tm,-12)&&m!==tm),tm]}:x);
  if(await writeTpls(list))toast(field==="paid"?"«"+t.name+"» отмечен как записанный":"«"+t.name+"» не ждём в этом месяце")}

/* templates in settings */
function renderTplSet(){if(!acc||view!=="prefs")return;
  const ts=tplsOf(acc);
  const rows=ts.map(t=>tplEdit&&!tplEdit.isNew&&tplEdit.id===t.id?tplEditor():h("div",{class:"catrow"},catIcon(tplCat(t),32),
    h("div",{class:"n"},h("div",null,t.name),h("div",{class:"sub"},(t.amount?(t.kind==="inc"?"+":"")+fmt(t.amount)+" · ":"")+tplDesc(t))),
    readOnly?null:h("button",{type:"button",class:"ghost sm",onclick:()=>{tplEdit=JSON.parse(JSON.stringify(t));tplArm=false;renderTplSet()}},"Изменить")));
  if(tplEdit&&tplEdit.isNew)rows.push(tplEditor());
  if(!rows.length)rows.push(h("div",{class:"empty",style:"padding:6px 0"},"Шаблонов пока нет. Добавьте сюда, например, аренду, интернет или зарплату."));
  $("tplList").replaceChildren(...rows);$("addTplBtn").hidden=readOnly||!!(tplEdit&&tplEdit.isNew)}
function tplEditor(){const d=tplEdit,subs=subsOf(acc);
  const f=(id,label,el)=>h("div",null,h("label",{class:"label",for:id},label),el);
  const kinds=[["exp","Расход"],["inc","Доход"]];if(canTransfer()||d.kind==="tr")kinds.push(["tr","Перевод"]);
  const name=h("input",{class:"field",id:"te-name",maxlength:"30",placeholder:"Например, «Аренда»",value:d.name||"",oninput:e=>{d.name=e.target.value}});
  const amt=h("input",{class:"field",id:"te-amt",inputmode:"decimal",autocomplete:"off",placeholder:"Вводить каждый раз",value:d.amountRaw!==undefined?d.amountRaw:(d.amount?String(d.amount).replace(".",","):""),oninput:e=>{d.amountRaw=e.target.value}});
  const mid=[];
  if(d.kind==="tr"){const from=h("select",{class:"field",id:"te-from",onchange:e=>{d.from=e.target.value}},...subs.map(x=>h("option",{value:x.id},x.name)));
    from.value=subIds().includes(d.from)?d.from:subs[0].id;d.from=from.value;
    const to=h("select",{class:"field",id:"te-to",onchange:e=>{d.to=e.target.value}},...toOptions());
    to.value=validTo(d.to)&&d.to!==d.from?d.to:defaultTo(d.from);d.to=to.value;
    mid.push(h("div",{class:"row2 half"},f("te-from","Откуда",from),f("te-to","Куда",to)))}
  else{const list=(d.kind==="inc"?INC_CATS:CATS).filter(c=>!c.hidden||c.id===d.cat);
    const cat=h("select",{class:"field",id:"te-cat",onchange:e=>{d.cat=e.target.value}},...list.map(c=>h("option",{value:c.id},c.name)));
    cat.value=list.some(c=>c.id===d.cat)?d.cat:list[0].id;d.cat=cat.value;mid.push(f("te-cat",d.kind==="inc"?"Источник":"Категория",cat));
    if(subs.length>1){const sb=h("select",{class:"field",id:"te-sub",onchange:e=>{d.sub=e.target.value}},...subs.map(x=>h("option",{value:x.id},x.name)));
      sb.value=subIds().includes(d.sub)?d.sub:"main";d.sub=sb.value;mid.push(f("te-sub","Кошелёк",sb))}}
  const pp=people(acc);let whoEl=null;
  if(pp.length){whoEl=h("select",{class:"field",id:"te-who",onchange:e=>{d.member=e.target.value}},...pp.map(n=>h("option",{value:n},n)));whoEl.value=pp.includes(d.member)?d.member:pp[0];d.member=whoEl.value}
  const note=h("input",{class:"field",id:"te-note",maxlength:"80",placeholder:"Необязательно",value:d.note||"",oninput:e=>{d.note=e.target.value}});
  const day=h("input",{class:"field",id:"te-day",type:"number",min:"1",max:"31",inputmode:"numeric",style:"max-width:120px",value:String(d.day||1),oninput:e=>{d.day=e.target.value}});
  const acts=d.isNew?null:h("div",{class:"confirm"},tplArm?h("button",{type:"button",class:"del",onclick:deleteTpl},"Да, удалить шаблон"):h("button",{type:"button",class:"danger",onclick:()=>{tplArm=true;renderTplSet()}},"Удалить шаблон"));
  return h("div",{class:"editor"},mseg(kinds,d.kind,v=>{d.kind=v;renderTplSet()},"Тип"),
    f("te-name","Название",name),f("te-amt","Сумма, "+cur(),amt),...mid,whoEl?f("te-who","Кто",whoEl):null,f("te-note","Комментарий",note),
    switchBtn("Повторять каждый месяц",d.repeat==="month",()=>{d.repeat=d.repeat==="month"?"none":"month";renderTplSet()},"te-rep"),
    d.repeat==="month"?f("te-day","Число месяца",day):null,
    h("div",{class:"inline"},h("button",{type:"button",class:"primary",onclick:saveTpl},d.isNew?"Добавить шаблон":"Сохранить"),h("button",{type:"button",class:"ghost",onclick:()=>{tplEdit=null;renderTplSet()}},"Отмена")),
    h("div",{class:"formmsg",id:"teMsg",role:"status"}),acts)}
async function saveTpl(){const d=tplEdit,msg=$("teMsg");msg.classList.remove("bad");const name=String(d.name||"").trim().slice(0,30);
  if(!name){msg.classList.add("bad");msg.textContent="Придумайте название шаблона.";$("te-name").focus();return}
  if(d.kind==="tr"&&d.from===d.to){msg.classList.add("bad");msg.textContent="Выберите разные «Откуда» и «Куда».";return}
  const raw=d.amountRaw!==undefined?d.amountRaw:String(d.amount||"");const amt=Math.round(parseNum(raw)*100)/100;
  if(String(raw).trim()&&!(amt>0)){msg.classList.add("bad");msg.textContent="Сумма должна быть больше нуля или пустой.";return}
  const t={id:d.id,name,kind:d.kind,amount:amt>0?amt:0,cat:d.kind==="tr"?"":d.cat,sub:d.sub||"main",from:d.kind==="tr"?d.from:"",to:d.kind==="tr"?d.to:"",
    member:d.member||"",note:String(d.note||"").trim().slice(0,80),repeat:d.repeat==="month"?"month":"none",day:Math.min(31,Math.max(1,parseInt(d.day,10)||1)),skips:Array.isArray(d.skips)?d.skips:[],paid:Array.isArray(d.paid)?d.paid:[]};
  const list=tplsOf(acc).map(x=>({...x}));const i=list.findIndex(x=>x.id===t.id);if(i<0)list.push(t);else list[i]=t;
  if(await writeTpls(list,msg)){tplEdit=null;renderTplSet();toast(i<0?"Шаблон «"+name+"» добавлен":"Шаблон сохранён")}}
async function deleteTpl(){const id=tplEdit.id;if(await writeTpls(tplsOf(acc).filter(x=>x.id!==id))){tplEdit=null;tplArm=false;if(tplActive===id)tplActive=null;renderTplSet();toast("Шаблон удалён")}}
$("addTplBtn").onclick=()=>{tplEdit={id:genId(),name:"",kind:"exp",amount:0,cat:CATS.find(c=>!c.hidden).id,sub:"main",from:"main",to:"",member:"",note:"",repeat:"month",day:new Date().getDate(),skips:[],isNew:true};tplArm=false;renderTplSet();
  setTimeout(()=>{const el=$("te-name");if(el)el.focus()},0)};

/* ---------- goals ---------- */
const goalsOf=a=>Array.isArray(a&&a.goals)?a.goals.filter(g=>g&&g.id&&g.name):[];
const goalName=id=>{const g=goalsOf(acc).find(x=>x.id===id);return g?"на «"+g.name+"»":""};
let goalNew=null,goalEdit=null,goalArm=false,goalActive=null;
function goalSaved(g,bal){if(!bal)return null;
  if(g.mode==="contrib"){let v=Number(g.start)||0;for(const e of histExp){if(e.goal!==g.id)continue;const a=Number(e.amount)||0;v+=isExp(e)?-a:a}return v}
  return subIds().includes(g.sub)?bal[g.sub]:null}
function renderGoals(){const sec=$("goalsSec");if(!acc){sec.hidden=true;return}
  const gs=goalsOf(acc);sec.hidden=readOnly&&!gs.length;if(sec.hidden)return;
  $("addGoalBtn").hidden=readOnly||!!goalNew;renderGoalNew();
  const bal=histLoaded&&archDone?balances():null;
  if(!gs.length){$("goals").replaceChildren(goalNew?h("span"):h("div",{class:"hint",style:"margin:0"},"Поставьте цель, например «Отпуск — 150 000 ₽ к июлю». Копить можно в отдельном кошельке или в общей копилке, а приложение подскажет, сколько откладывать в месяц."));return}
  $("goals").replaceChildren(...gs.map(g=>goalEdit&&goalEdit.id===g.id?goalEditor():goalCard(g,bal)))}
function goalCard(g,bal){const subOk=subIds().includes(g.sub),contrib=g.mode==="contrib",have=goalSaved(g,bal),target=Number(g.target)||0;
  const p=have!==null&&target?Math.max(0,Math.min(1,have/target)):0,done=have!==null&&target>0&&have>=target;
  let pace="";
  if(have!==null&&!done&&g.deadline){const left=target-Math.max(0,have);
    if(g.deadline<today())pace="Срок был "+shortDate(g.deadline)+" · не хватает "+fmt(left);
    else{const [y,m,d]=g.deadline.split("-").map(Number),days=Math.max(1,Math.round((new Date(y,m-1,d)-new Date(new Date().toDateString()))/864e5)),months=Math.round(days/30.44);
      pace="До "+shortDate(g.deadline)+" · "+(months>=1?"откладывайте по "+fmt(Math.ceil(left/months))+" в месяц":"осталось "+days+" "+plural(days,["день","дня","дней"])+", не хватает "+fmt(left))}}
  return h("div",{class:"goal"},
    h("div",{class:"ghead"},h("b",null,g.name),h("span",{class:"gpct"},have===null?"…":done?"Готово":Math.round(p*100)+"%")),
    h("div",{class:"track"},h("div",{class:"fill"+(done?" ok":""),style:"width:"+(p*100)+"%"})),
    h("div",{class:"meta",style:"margin-top:0"},h("span",null,have===null?"Считаем…":fmt(Math.max(0,have))+" из "+fmt(target)),h("span",null,subOk?(contrib?"отложено в «":"в «")+subName(g.sub)+"»":contrib?"":"кошелёк удалён")),
    done?h("div",{class:"hint",style:"margin:0;color:var(--good)"},"Цель достигнута."):pace?h("div",{class:"hint",style:"margin:0"},pace):null,
    readOnly?null:h("div",{class:"inline",style:"align-items:center"},(subOk||contrib)&&!done?h("button",{type:"button",class:"ghost sm",onclick:()=>topUp(g)},"Отложить"):null,
      h("button",{type:"button",class:"linkbtn",onclick:()=>{goalEdit={...g};goalArm=false;renderGoals()}},"Изменить")))}
function topUp(g){const subs=subsOf(acc),target=subIds().includes(g.sub)?g.sub:"main";
  if(subs.length>1&&subs.some(x=>x.id!==target)){curKind="tr";trTo=target;trFrom=(subs.find(x=>x.id!==target&&!x.off)||subs.find(x=>x.id!==target)).id}
  else{curKind="inc";formSub=target}
  tplActive=null;goalActive=g.id;$("amount").value="";$("date").value=today();$("note").value="На цель «"+g.name+"»";detailOpen="";openEntry(true)}
function renderGoalNew(){const box=$("goalNew");if(!goalNew){box.hidden=true;box.replaceChildren();return}box.hidden=false;const g=goalNew,subs=subsOf(acc);
  const sel=h("select",{class:"field",id:"gnSub",onchange:e=>{g.mode=e.target.value;renderGoalNew()}},h("option",{value:"new"},"Новый кошелёк для этой цели"),...subs.map(x=>h("option",{value:x.id},"Кошелёк «"+x.name+"»")));sel.value=g.mode;
  box.replaceChildren(h("div",{class:"editor"},
    h("div",null,h("label",{class:"label",for:"gnName"},"Название цели"),h("input",{class:"field",id:"gnName",maxlength:"40",placeholder:"Например, «Отпуск» или «Новый ноутбук»",value:g.name,oninput:e=>{g.name=e.target.value}})),
    h("div",{class:"row2 half"},h("div",null,h("label",{class:"label",for:"gnTarget"},"Сколько нужно, "+cur()),h("input",{class:"field",id:"gnTarget",inputmode:"decimal",autocomplete:"off",value:g.target,oninput:e=>{g.target=e.target.value}})),
      h("div",null,h("label",{class:"label",for:"gnDate"},"К какой дате"),h("input",{type:"date",id:"gnDate",value:g.deadline,min:today(),oninput:e=>{g.deadline=e.target.value}}))),
    h("div",null,h("label",{class:"label",for:"gnSub"},"Где копить"),sel),
    h("div",{class:"stack",style:"gap:10px"},
      g.mode==="new"||!g.whole?h("div",null,h("label",{class:"label",for:"gnStart"},"Уже отложено"),h("input",{class:"field",id:"gnStart",inputmode:"decimal",autocomplete:"off",placeholder:"0",style:"max-width:200px",value:g.start,oninput:e=>{g.start=e.target.value}})):null,
      g.mode==="new"?switchBtn("Включать накопления во «Всего»",g.inTotal,()=>{g.inTotal=!g.inTotal;renderGoalNew()},"gnTotal")
        :switchBtn("Считать весь баланс кошелька",g.whole,()=>{g.whole=!g.whole;renderGoalNew()},"gnWhole"),
      g.mode==="new"?null:h("div",{class:"hint",style:"margin:0"},g.whole?"Прогресс — весь баланс кошелька. Подходит, если кошелёк отведён только под эту цель.":"Прогресс — только то, что вы отложили кнопкой «Отложить» у цели. Траты из этого кошелька на цель не влияют.")),
    h("div",{class:"inline"},h("button",{type:"button",class:"primary",onclick:createGoal},"Создать цель"),h("button",{type:"button",class:"ghost",onclick:()=>{goalNew=null;renderGoals()}},"Отмена")),
    h("div",{class:"formmsg",id:"gnMsg",role:"status"})))}
async function createGoal(){const g=goalNew,msg=$("gnMsg");msg.classList.remove("bad");const name=String(g.name).trim().slice(0,40),target=Math.round(parseNum(g.target)*100)/100;
  if(!name){msg.classList.add("bad");msg.textContent="Назовите цель.";$("gnName").focus();return}
  if(!(target>0)){msg.classList.add("bad");msg.textContent="Укажите, сколько нужно накопить.";$("gnTarget").focus();return}
  const a=acc,subs=subsOf(a).map(x=>({id:x.id,name:x.name,start:Number(x.start)||0,off:!!x.off}));let sub=g.mode;
  if(g.mode==="new"){let sname=name.slice(0,30);if(subs.some(x=>x.name.toLowerCase()===sname.toLowerCase()))sname=(name.slice(0,22)+" (цель)");
    const st=parseNum(g.start);sub=genId();subs.push({id:sub,name:sname,start:Number.isFinite(st)&&st>0?Math.round(st*100)/100:0,off:!g.inTotal})}
  const st0=parseNum(g.start),contrib=g.mode!=="new"&&!g.whole;
  const goals=[...goalsOf(a),{id:genId(),name,target,deadline:g.deadline||"",sub,mode:contrib?"contrib":"wallet",start:contrib&&Number.isFinite(st0)&&st0>0?Math.round(st0*100)/100:0,createdAt:Date.now()}];
  try{await accDoc(a).update({subs,goals});a.subs=subs;a.goals=goals;goalNew=null;filledFor="";fillSettings(false);renderSubs();renderGoals();renderCats();toast("Цель «"+name+"» создана")}
  catch(e){writeErr(e,msg)}}
function goalEditor(){const g=goalEdit;
  return h("div",{class:"goal"},h("div",{class:"stack",style:"gap:12px"},
    h("div",null,h("label",{class:"label",for:"geName"},"Название цели"),h("input",{class:"field",id:"geName",maxlength:"40",value:g.name,oninput:e=>{g.name=e.target.value}})),
    h("div",{class:"row2 half"},h("div",null,h("label",{class:"label",for:"geTarget"},"Сколько нужно"),h("input",{class:"field",id:"geTarget",inputmode:"decimal",value:String(g.target).replace(".",","),oninput:e=>{g.target=e.target.value}})),
      h("div",null,h("label",{class:"label",for:"geDate"},"К какой дате"),h("input",{type:"date",id:"geDate",value:g.deadline||"",oninput:e=>{g.deadline=e.target.value}}))),
    subIds().includes(g.sub)?h("div",null,h("label",{class:"label",for:"geMode"},"Как считать прогресс"),(()=>{const sel=h("select",{class:"field",id:"geMode",onchange:e=>{g.mode=e.target.value;renderGoals()}},
      h("option",{value:"wallet"},"Весь баланс кошелька «"+subName(g.sub)+"»"),h("option",{value:"contrib"},"Только отложенное на эту цель"));sel.value=g.mode==="contrib"?"contrib":"wallet";return sel})()):null,
    g.mode==="contrib"?h("div",null,h("label",{class:"label",for:"geStart"},"Было отложено до начала учёта"),h("input",{class:"field",id:"geStart",inputmode:"decimal",style:"max-width:200px",value:String(g.start||0).replace(".",","),oninput:e=>{g.start=e.target.value}})):null,
    h("div",{class:"inline"},h("button",{type:"button",class:"primary",onclick:saveGoal},"Сохранить"),h("button",{type:"button",class:"ghost",onclick:()=>{goalEdit=null;renderGoals()}},"Отмена")),
    h("div",{class:"formmsg",id:"geMsg",role:"status"}),
    h("div",{class:"confirm"},goalArm?h("button",{type:"button",class:"del",onclick:deleteGoal},"Да, удалить цель"):h("button",{type:"button",class:"danger",onclick:()=>{goalArm=true;renderGoals()}},"Удалить цель")),
    h("div",{class:"hint",style:"margin:0"},"Удаление цели не трогает кошелёк и накопленные деньги.")))}
async function saveGoal(){const g=goalEdit,msg=$("geMsg");msg.classList.remove("bad");const name=String(g.name).trim().slice(0,40),target=Math.round(parseNum(g.target)*100)/100;
  if(!name||!(target>0)){msg.classList.add("bad");msg.textContent=!name?"Назовите цель.":"Укажите сумму больше нуля.";return}
  const st0=parseNum(g.start),mode=g.mode==="contrib"?"contrib":"wallet";
  const a=acc,goals=goalsOf(a).map(x=>x.id===g.id?{...x,name,target,deadline:g.deadline||"",mode,start:mode==="contrib"&&Number.isFinite(st0)&&st0>0?Math.round(st0*100)/100:0}:x);
  try{await accDoc(a).update({goals});a.goals=goals;goalEdit=null;renderGoals();toast("Цель сохранена")}catch(e){writeErr(e,msg)}}
async function deleteGoal(){const a=acc,id=goalEdit.id,goals=goalsOf(a).filter(x=>x.id!==id);
  try{await accDoc(a).update({goals});a.goals=goals;goalEdit=null;goalArm=false;renderGoals();toast("Цель удалена")}catch(e){toast("Не получилось удалить цель")}}
$("addGoalBtn").onclick=()=>{goalNew={name:"",target:"",deadline:"",mode:"new",start:"",inTotal:false,whole:false};goalEdit=null;renderGoals();setTimeout(()=>{const el=$("gnName");if(el)el.focus()},0)};

/* ---------- history ---------- */
let histExp=[],histLoaded=false,histUnsub=null,histKey="",histShown=60,dl=null;
let liveExp=[],archExp=new Map(),archDone=false,archFrom="0000-00-00";
function mergeHist(){const mp=new Map(archExp);for(const e of liveExp)mp.set(e.id,e);histExp=[...mp.values()]}
function afterHist(){renderHistory();renderSubs();renderStats();renderGoals();if(view==="prefs")renderCatSet()}
const HF0={q:"",kind:"all",period:"all",cat:"",who:"",sort:"date_desc",from:"",to:""};
let hf={...HF0};
function resubHist(){if(!db||!acc)return;const key=acc.type+":"+acc.id;if(key===histKey)return;
  histKey=key;if(histUnsub)histUnsub();histLoaded=false;archDone=false;histExp=[];liveExp=[];archExp=new Map();histShown=60;renderHistory();const a=acc;
  archFrom=shiftMonth(today().slice(0,7),-2)+"-01";
  histUnsub=expCol(a).where("date",">=",archFrom).orderBy("date","desc").limit(1000).onSnapshot(qs=>{if(histKey!==key)return;
    liveExp=qs.docs.map(d=>({id:d.id,...d.data()}));histLoaded=true;mergeHist();afterHist()},
    ()=>{if(histKey!==key)return;histLoaded=true;afterHist();notice("Не удалось загрузить историю. Обновите страницу.",true)});
  loadArchive(a,key)}
/* older operations are read page by page, so there is no limit on how many an account can hold */
async function loadArchive(a,key){let upper=archFrom,strict=true,guard=0;
  try{for(;;){if(histKey!==key)return;
      const qs=await expCol(a).where("date",strict?"<":"<=",upper).orderBy("date","desc").limit(1000).get();
      if(histKey!==key)return;
      let fresh=0,oldest=upper;
      for(const d of qs.docs){const v=d.data();if(!archExp.has(d.id)){archExp.set(d.id,{id:d.id,...v});fresh++}const dt=String(v.date||"");if(dt&&dt<oldest)oldest=dt}
      if(qs.size<1000||++guard>500)break;
      if(fresh===0){if(strict)break;strict=true;continue}
      upper=oldest;strict=false;mergeHist();afterHist()}}
  catch(e){if(histKey===key)notice("Не удалось загрузить старые операции. Обновите страницу.",true)}
  if(histKey!==key)return;archDone=true;mergeHist();afterHist()}
function filteredHist(){const t=today(),tm=t.slice(0,7);let from="",to="";
  if(hf.period==="m1")from=tm+"-01";else if(hf.period==="m3")from=shiftMonth(tm,-2)+"-01";else if(hf.period==="y")from=shiftMonth(tm,-11)+"-01";
  else if(hf.period==="custom"){from=hf.from;to=hf.to;if(from&&to&&from>to)[from,to]=[to,from]}
  const q=hf.q.trim().toLowerCase().replace(/\s+/g," ");
  const rows=histExp.filter(e=>{const inc=isInc(e),d=String(e.date||"");
    const k=isTr(e)?"tr":inc?"inc":"exp";if(hf.kind!=="all"&&hf.kind!==k)return false;
    if(!inSub(e))return false;
    if(from&&d<from||to&&d>to)return false;
    if(hf.cat&&catOf(e).id!==hf.cat)return false;
    if(hf.who&&who(e)!==hf.who)return false;
    if(q){const amt=Number(e.amount)||0;const hay=[e.note,catOf(e).name,acc.type==="shared"?who(e):"",String(amt),String(amt).replace(".",","),fmt(amt),isTr(e)?endName(e,"from")+" "+endName(e,"to"):subName(subOf(e))].join(" ").toLowerCase().replace(/[\s\u00a0]+/g," ");
      if(!q.split(" ").every(w=>hay.includes(w)))return false}
    return true});
  const A=e=>Number(e.amount)||0,byDate=(a,b)=>String(a.date).localeCompare(String(b.date))||(a.createdAt||0)-(b.createdAt||0);
  rows.sort(hf.sort==="date_asc"?byDate:hf.sort==="amt_desc"?(a,b)=>A(b)-A(a):hf.sort==="amt_asc"?(a,b)=>A(a)-A(b):(a,b)=>-byDate(a,b));
  return rows}
function histControls(){
  $("hKind").replaceChildren(mseg([["all","Все"],["exp","Расходы"],["inc","Доходы"],["tr","Переводы"]],hf.kind,v=>{hf.kind=v;if(v==="exp"&&ICAT[hf.cat]||v==="inc"&&CAT[hf.cat]||v==="tr")hf.cat="";histShown=60;renderHistory()},"Тип"));
  $("hPeriod").replaceChildren(mseg([["m1","Месяц"],["m3","3 мес"],["y","Год"],["all","Всё"],["custom","Даты"]],hf.period,v=>{hf.period=v;histShown=60;renderHistory()},"Период"));
  $("hRange").hidden=hf.period!=="custom";
  const groups=[];
  if(hf.kind!=="inc")groups.push(h("optgroup",{label:"Расходы"},...CATS.map(c=>h("option",{value:c.id},c.name))));
  if(hf.kind!=="exp")groups.push(h("optgroup",{label:"Доходы"},...INC_CATS.map(c=>h("option",{value:c.id},c.name))));
  $("hCat").replaceChildren(h("option",{value:""},"Все категории"),...groups);$("hCat").value=hf.cat;$("hCat").disabled=hf.kind==="tr";
  const isS=!!acc&&acc.type==="shared";$("hWhoWrap").hidden=!isS;
  if(isS){const ns=[...new Set([...people(acc),...histExp.map(who)])].filter(x=>x&&x!=="—").sort();
    $("hWho").replaceChildren(h("option",{value:""},"Все"),...ns.map(n=>h("option",{value:n},n)));if(!ns.includes(hf.who))hf.who="";$("hWho").value=hf.who}
  $("hSort").value=hf.sort}
function renderHistory(){if(view!=="history")return;histControls();
  const list=$("hList"),more=$("hMore");more.hidden=true;$("hCap").hidden=archDone||!histLoaded;
  if(!acc){list.replaceChildren();$("hSum").replaceChildren();return}
  if(!histLoaded){list.replaceChildren(h("div",{class:"empty"},"Загружаем историю…"));$("hSum").replaceChildren();return}
  if(acc.type==="shared")ensureNames(histExp.map(e=>e.by));
  const rows=filteredHist(),out=sum(rows.filter(isExp)),inn=sum(rows.filter(isInc));
  $("hSum").replaceChildren(h("span",null,"Найдено ",h("b",null,String(rows.length))," "+plural(rows.length,["операция","операции","операций"])),
    ...[out?h("span",null,"Расходы ",h("b",null,fmt(out))):null,inn?h("span",null,"Доходы ",h("b",{class:"pos"},"+"+fmt(inn))):null].filter(Boolean));
  $("hCsv").hidden=!dl||!rows.length||readOnly;
  if(!rows.length){list.replaceChildren(h("div",{class:"empty"},histExp.length?"Ничего не найдено. Измените поиск или сбросьте фильтры.":"Операций пока нет. Нажмите «+» внизу, чтобы добавить первую."));return}
  const shown=rows.slice(0,histShown);
  if(hf.sort.startsWith("date")){
    const mT={},dT={};for(const e of rows){if(isTr(e))continue;const m=e.month||String(e.date).slice(0,7),k=isInc(e)?1:0,a=Number(e.amount)||0;
      (mT[m]=mT[m]||[0,0])[k]+=a;(dT[e.date]=dT[e.date]||[0,0])[k]+=a}
    const blocks=[];let cm=null,cd=null,box=null;
    const tot=x=>{if(!x)return [];const [o,i]=x;return [o?fmt(o):null,i?h("span",{class:"in"},"+"+fmt(i)):null]};
    for(const e of shown){const m=e.month||String(e.date).slice(0,7);
      if(m!==cm){cm=m;cd=null;blocks.push(h("div",{class:"mhead"},h("span",null,monthLabel(m)),h("span",null,...tot(mT[m]))))}
      if(e.date!==cd){cd=e.date;box=h("div",{class:"day"},h("div",{class:"dayh"},h("span",null,dayLabel(String(e.date))),h("span",null,...tot(dT[e.date]))));blocks.push(box)}
      box.append(itemRow(e,false,"hist"))}
    list.replaceChildren(...blocks)}
  else list.replaceChildren(h("div",{class:"day"},...shown.map(e=>itemRow(e,true,"hist"))));
  if(rows.length>histShown){more.hidden=false;more.textContent="Показать ещё "+Math.min(60,rows.length-histShown)+" из "+(rows.length-histShown)}}
$("hq").addEventListener("input",e=>{hf.q=e.target.value;histShown=60;renderHistory()});
$("hCat").addEventListener("change",e=>{hf.cat=e.target.value;histShown=60;renderHistory()});
$("hWho").addEventListener("change",e=>{hf.who=e.target.value;histShown=60;renderHistory()});
$("hSort").addEventListener("change",e=>{hf.sort=e.target.value;histShown=60;renderHistory()});
$("hFrom").addEventListener("change",e=>{hf.from=e.target.value;histShown=60;renderHistory()});
$("hTo").addEventListener("change",e=>{hf.to=e.target.value;histShown=60;renderHistory()});
$("hMore").onclick=()=>{histShown+=60;renderHistory()};
$("hReset").onclick=()=>{hf={...HF0};$("hq").value="";$("hFrom").value="";$("hTo").value="";histShown=60;renderHistory()};
$("hCsv").onclick=async()=>{if(!dl||!acc)return;const rows=filteredHist();
  const esc=v=>{v=String(v??"");return /[";\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const lines=[["Дата","Тип","Категория","Кошелёк","Сумма","Валюта","Кто","Комментарий"],
    ...rows.map(e=>[e.date,isTr(e)?"Перевод":isInc(e)?"Доход":"Расход",catOf(e).name,isTr(e)?endName(e,"from")+" → "+endName(e,"to"):subName(subOf(e)),String(Number(e.amount)||0).replace(".",","),cur(),acc.type==="shared"?who(e):"",e.note||""])].map(r=>r.map(esc).join(";"));
  try{await dl.save({filename:"Семейная касса - "+(acc.name||"счёт").replace(/[\\/:*?"<>|]/g," ")+".csv",data:"\ufeff"+lines.join("\r\n")});toast("Файл сохранён")}
  catch(err){const code=err&&err.code;if(code==="declined")return;
    if(["unavailable","not_granted","capability_disabled","capability_removed"].includes(code)){dl=null;$("hCsv").hidden=true;toast("Скачивание недоступно в этом окне");return}
    toast(code==="rate_limited"?"Подождите немного и попробуйте снова":"Не получилось сохранить файл")}};

/* ---------- statistics ---------- */
const PERIODS=[["m","Месяц",1],["q","3 мес",3],["h","6 мес",6],["y","Год",12]];
function periodInfo(){const n=(PERIODS.find(p=>p[0]===prefs.period)||PERIODS[0])[2];const cur=[],prev=[];
  for(let i=n-1;i>=0;i--)cur.push(shiftMonth(month,-i));for(let i=2*n-1;i>=n;i--)prev.push(shiftMonth(month,-i));return {n,cur,prev}}
function elapsedDates(months){const t=today(),tm=t.slice(0,7),out=[];
  for(const m of months){if(m>tm)continue;const last=m===tm?+t.slice(8,10):daysIn(m);for(let d=1;d<=last;d++)out.push(m+"-"+pad(d))}return out}

function periodTitle(cur){if(cur.length===1)return monthLabel(cur[0]);
  const a=cur[0].split("-"),b=cur[cur.length-1].split("-");
  return a[0]===b[0]?MONTHS[+a[1]-1]+" — "+MONTHS[+b[1]-1].toLowerCase()+" "+b[0]:monthLabel(cur[0])+" — "+monthLabel(cur[cur.length-1]).toLowerCase()}

let allStat={key:"",ready:false,busy:false,ops:[],at:0};
const accsKey=()=>allAccounts().map(a=>a.type+a.id).join(",");
async function loadAllStat(){const list=allAccounts(),key=accsKey();if(allStat.busy)return;allStat.busy=true;const out=[];
  for(const a of list){let ops;try{ops=await loadOpsOf(a)}catch(e){continue}
    const ex=normCatList(a.cats&&a.cats.exp,DEF_EXP,"other"),inc=normCatList(a.cats&&a.cats.inc,DEF_INC,"i_other");
    const E=Object.fromEntries(ex.map(c=>[c.id,c])),I=Object.fromEntries(inc.map(c=>[c.id,c]));
    const subs=subsOf(a),ids=subs.map(x=>x.id),off=id=>subs.length>1&&!!(subs.find(x=>x.id===id)||{}).off;
    for(const e of ops){if(isTr(e))continue;if(off(ids.includes(e.sub)?e.sub:"main"))continue;
      out.push({...e,_cur:a.currency||"₽",_cat:isInc(e)?(I[e.cat]||I.i_other):(E[e.cat]||E.other)})}}
  allStat={key,ready:true,busy:false,ops:out,at:Date.now()};renderStats()}
function renderStats(){if(view!=="stats")return;
  $("periodSeg").replaceChildren(mseg(PERIODS.map(p=>[p[0],p[1]]),prefs.period,v=>{prefs.period=v;savePrefs();renderStats()},"Период"));
  const many=allAccounts().length>1;if(!many&&prefs.scope==="all")prefs.scope="acc";
  $("scopeSeg").replaceChildren(...(many?[mseg([["acc","Этот счёт"],["all","Все счета"]],prefs.scope,v=>{prefs.scope=v;savePrefs();if(v==="all")allStat.at=0;renderStats()},"Какие счета")]:[]));
  renderCustom();$("statNote").hidden=true;
  if(!acc){$("kpis").replaceChildren();$("charts").replaceChildren();return}
  const P=periodInfo(),all=prefs.scope==="all";
  $("periodName").textContent=periodTitle(P.cur)+(all?" · все счета":subSel!=="all"?" · "+subName(subSel):"");
  const loading=()=>{$("kpis").replaceChildren();$("charts").replaceChildren(h("div",{class:"empty"},all?"Собираем данные всех счетов…":"Считаем статистику…"))};
  if(!all){if(!histLoaded||!archDone)return loading();
    const allSet=new Set([...P.cur,...P.prev]);statsBody(P,histExp.filter(e=>allSet.has(e.month)&&inSub(e)));return}
  if(!allStat.ready||allStat.key!==accsKey()||Date.now()-allStat.at>120000){if(!allStat.ready||allStat.key!==accsKey())loading();loadAllStat();if(!allStat.ready||allStat.key!==accsKey())return}
  const allSet=new Set([...P.cur,...P.prev]),miss=new Set(),ops=[],mexp=[],minc=[],seen=new Set();
  for(const e of allStat.ops){const inc=isInc(e),id="n"+(inc?"i:":":")+e._cat.name.toLowerCase();
    if(!seen.has(id)){seen.add(id);(inc?minc:mexp).push({...e._cat,id,hidden:false})}
    if(!allSet.has(e.month))continue;const v=conv(Number(e.amount)||0,e._cur);if(v===null){miss.add(e._cur);continue}
    ops.push({...e,amount:v,cat:id})}
  mexp.push({...DEF_EXP.find(x=>x.id==="other"),hidden:false});minc.push({...DEF_INC.find(x=>x.id==="i_other"),hidden:false});
  if(miss.size){$("statNote").hidden=false;$("statNote").textContent="Не учтены счета в "+[...miss].join(", ")+": задайте курс в «Настройки → Общие». Суммы показаны в "+prefs.base+"."}
  const keep={CATS,INC_CATS};CATS=mexp;INC_CATS=minc;indexCats();curOverride=prefs.base;statAll=true;
  try{statsBody(P,ops)}finally{CATS=keep.CATS;INC_CATS=keep.INC_CATS;indexCats();curOverride=null;statAll=false}}
function statsBody(P,S){const curSet=new Set(P.cur),inCur=e=>curSet.has(e.month);
  const E=S.filter(e=>inCur(e)&&isExp(e)),Prev=S.filter(e=>!inCur(e)&&isExp(e)),I=S.filter(e=>inCur(e)&&isInc(e)),IP=S.filter(e=>!inCur(e)&&isInc(e));
  if(acc.type==="shared"||statAll)ensureNames(S.map(e=>e.by));
  const ctx={...P,E,Prev,I,IP,total:sum(E),prevTotal:sum(Prev),incTotal:sum(I),prevInc:sum(IP),days:elapsedDates(P.cur)};
  renderKpis(ctx);
  const on=prefs.charts.filter(c=>c.on);
  if(!S.length){$("charts").replaceChildren(h("div",{class:"card empty",style:"padding:18px"},"За этот период операций нет. Нажмите «+», чтобы добавить, или выберите период подлиннее."));return}
  if(!on.length){$("charts").replaceChildren(h("div",{class:"empty"},"Все графики скрыты. Включите нужные в блоке «Выбрать графики» ниже."));return}
  const cards=on.map(cfg=>chartCard(cfg,ctx));
  $("charts").replaceChildren(...cards.map(c=>c.el));
  for(const c of cards)c.draw();
  lastChartW=$("charts").clientWidth}

function trend(a,b,goodUp){if(!b||!a)return b?"":"Прошлый период без записей";const d=(a-b)/b,up=d>0;
  return [h("span",{class:up===goodUp?"down":"up"},(up?"↑ ":"↓ ")+Math.abs(Math.round(d*100))+"%")," к прошлому периоду"]}
function renderKpis(c){const k=[];
  const budget=accBudget()*c.n;
  k.push(kpi("Потрачено",fmt(c.total),trend(c.total,c.prevTotal,false)));
  if(c.I.length||c.IP.length){k.push(kpi("Доходы","+"+fmt(c.incTotal),trend(c.incTotal,c.prevInc,true)));
    const bal=c.incTotal-c.total;
    k.push(kpi("Разница",(bal>0?"+":"")+fmt(bal),c.incTotal?(bal>=0?"отложено "+Math.round(bal/c.incTotal*100)+"% дохода":"расходы больше доходов"):"доходов в периоде нет"))}
  k.push(kpi("В среднем в день",c.days.length?fmt(c.total/c.days.length):"—",c.days.length+" "+plural(c.days.length,["день","дня","дней"])+" в периоде"));
  if(budget){const p=c.total/budget;k.push(kpi("Бюджет за период",Math.round(p*100)+"%",p>1?"перерасход "+fmt(c.total-budget):"осталось "+fmt(budget-c.total)))}
  const top=group(c.E,e=>e.cat||"other")[0];
  k.push(kpi("Больше всего",top?(CAT[top[0]]||CAT.other).name:"—",top&&c.total?Math.round(top[1]/c.total*100)+"% всех трат":""));
  if(k.length%2)k.push(kpi("Записей",String(c.E.length+c.I.length),c.E.length?"средний расход "+fmt(c.total/c.E.length):""));
  $("kpis").replaceChildren(...k)}
function kpi(label,value,sub){return h("div",{class:"kpi"},h("span",{class:"k"},label),h("span",{class:"v"},value),h("span",{class:"s"},sub))}

function chartCard(cfg,ctx){const def=CHART[cfg.id];
  const setType=v=>{cfg.type=v;savePrefs();renderStats()};
  const opts=[mseg(def.types,cfg.type,setType,"Вид графика")];
  if(cfg.id==="structure"&&(acc.type==="shared"||statAll))opts.unshift(mseg([["cat","Категории"],["person","Люди"]],cfg.group,v=>{cfg.group=v;savePrefs();renderStats()},"Группировка"));
  const body=h("div",{class:"cbody"});
  const el=h("section",{class:"card chart-card","aria-label":def.name},h("div",{class:"chead"},h("span",{class:"ctitle"},def.name),h("div",{class:"copts"},...opts)),body);
  return {el,draw:()=>{const W=Math.max(240,body.clientWidth||480);DRAW[cfg.id](body,cfg,ctx,W)}}}

function niceMax(v){if(!(v>0))return 1;const p=Math.pow(10,Math.floor(Math.log10(v))),f=v/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
function barPath(x,y,w,hh,r){if(hh<=0.5)return "";r=Math.min(r,w/2,hh);return `M${x},${y+hh}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+hh}Z`}
/* vertical frame with gridlines; returns scale */
function frame(svg,W,H,max,m){const iw=W-m.l-m.r,ih=H-m.t-m.b;const y=v=>m.t+ih-(v/max)*ih;
  for(let i=0;i<=4;i++){const v=max*i/4,yy=y(v);svg.append(s("line",{class:i?"gl":"base",x1:m.l,x2:W-m.r,y1:yy,y2:yy}));
    if(i)svg.append(s("text",{x:m.l-6,y:yy+4,"text-anchor":"end"},compact(v)))}
  return {iw,ih,y}}
function emptyMsg(body,t){body.replaceChildren(h("div",{class:"empty"},t))}
function legend(items){return h("div",{class:"legend"},...items.map(([c,t])=>h("span",null,h("i",{class:"dot",style:"background:"+c}),t)))}

const DRAW={
structure(body,cfg,c,W){
  const isP=cfg.group==="person"&&(acc.type==="shared"||statAll);
  let rows=group(c.E,isP?who:e=>e.cat||"other");
  if(!rows.length)return emptyMsg(body,"В этом периоде расходов нет.");
  if(isP&&rows.length>8){const rest=rows.slice(7).reduce((t,r)=>t+r[1],0);rows=[...rows.slice(0,7),["Остальные",rest]]}
  share(body,cfg.type,rows,isP?k=>k:k=>(CAT[k]||CAT.other).name,isP?personColor:k=>"var("+(CAT[k]||CAT.other).c+")",c.total,W)},

income(body,cfg,c,W){
  const rows=group(c.I,e=>ICAT[e.cat]?e.cat:"i_other");
  if(!rows.length)return emptyMsg(body,"В этом периоде доходов нет. Нажмите «+» и переключите форму на «Доход».");
  share(body,cfg.type,rows,k=>ICAT[k].name,k=>"var("+ICAT[k].c+")",c.incTotal,W)},

flow(body,cfg,c,W){
  if(!c.I.length&&!c.E.length)return emptyMsg(body,"В этом периоде операций нет.");
  let units;
  if(c.n>1)units=c.cur.map(m=>({label:MSHORT[+m.slice(5)-1],tip:monthLabel(m),f:e=>e.month===m}));
  else{const d=daysIn(month);units=[];for(let a=1;a<=d;a+=7){const b=Math.min(d,a+6);
    units.push({label:a+"–"+b,tip:a+"–"+dayMonth(month+"-"+pad(b)),f:e=>{const dd=+String(e.date).slice(8,10);return dd>=a&&dd<=b}})}}
  const inc=units.map(u=>sum(c.I.filter(u.f))),exp=units.map(u=>sum(c.E.filter(u.f))),net=inc.map((v,i)=>v-exp[i]);
  const N=units.length,H=220,m={l:48,r:10,t:16,b:26};
  const svg=s("svg",{width:W,height:H,viewBox:`0 0 ${W} ${H}`,role:"img","aria-label":"Доходы и расходы"});
  const iw=W-m.l-m.r,ih=H-m.t-m.b,band=iw/N,cx=i=>m.l+band*i+band/2;
  let hi,lo;
  if(cfg.type==="net"){const M=niceMax(Math.max(...net.map(Math.abs)));hi=net.some(v=>v>0)||!net.some(v=>v<0)?M:0;lo=net.some(v=>v<0)?-M:0}
  else{hi=niceMax(Math.max(...inc,...exp));lo=0}
  const y=v=>m.t+ih*(hi-v)/(hi-lo),steps=(hi&&lo)?4:4;
  for(let i=0;i<=steps;i++){const v=lo+(hi-lo)*i/steps;svg.append(s("line",{class:Math.abs(v)<1e-9?"base":"gl",x1:m.l,x2:W-m.r,y1:y(v),y2:y(v)}));
    if(Math.abs(v)>1e-9)svg.append(s("text",{x:m.l-6,y:y(v)+4,"text-anchor":"end"},(v>0&&lo<0?"+":"")+compact(v)))}
  units.forEach((u,i)=>svg.append(s("text",{x:cx(i),y:H-8,"text-anchor":"middle"},u.label)));
  if(cfg.type==="net"){const bw=Math.max(4,Math.min(32,band*.55));
    net.forEach((v,i)=>{if(!v)return;const x=cx(i)-bw/2;
      if(v>0)svg.append(s("path",{d:barPath(x,y(v),bw,y(0)-y(v),4),fill:"var(--inc)"}));
      else{const y0=y(0),hh=y(v)-y0,r=Math.min(4,bw/2,hh);svg.append(s("path",{d:`M${x},${y0}V${y0+hh-r}Q${x},${y0+hh} ${x+r},${y0+hh}H${x+bw-r}Q${x+bw},${y0+hh} ${x+bw},${y0+hh-r}V${y0}Z`,fill:"var(--exp)"}))}
      if(N<=6)svg.append(s("text",{x:cx(i),y:v>0?y(v)-6:y(v)+14,"text-anchor":"middle",class:"strong"},(v>0?"+":"")+compact(v)))})}
  else{const bw=Math.max(3,Math.min(18,band*.3));
    units.forEach((u,i)=>{if(inc[i])svg.append(s("path",{d:barPath(cx(i)-bw-1,y(inc[i]),bw,y(0)-y(inc[i]),Math.min(4,bw/2)),fill:"var(--inc)"}));
      if(exp[i])svg.append(s("path",{d:barPath(cx(i)+1,y(exp[i]),bw,y(0)-y(exp[i]),Math.min(4,bw/2)),fill:"var(--exp)"}))})}
  units.forEach((u,i)=>svg.append(s("rect",{class:"hit",x:m.l+band*i,y:m.t,width:band,height:ih,
    "data-tip":u.tip+" · доходы +"+fmt(inc[i])+" · расходы "+fmt(exp[i])+" · разница "+(net[i]>0?"+":"")+fmt(net[i])})));
  body.replaceChildren(svg,legend(cfg.type==="net"?[["var(--inc)","Доходы больше расходов"],["var(--exp)","Расходы больше доходов"]]:[["var(--inc)","Доходы"],["var(--exp)","Расходы"]]))},
};
function share(body,type,rows,nameF,colF,total,W){
  if(type==="bars"){const box=h("div",{class:"bars"});body.replaceChildren(box);renderBars(box,rows,nameF,colF,total);return}
  const c={total};
  const R=Math.min(96,Math.floor((W-8)/2)),r=R*.6,S=R*2+4,cx=S/2,cy=S/2;
  const svg=s("svg",{width:S,height:S,viewBox:`0 0 ${S} ${S}`,role:"img","aria-label":"Кольцевая диаграмма: "+rows.map(([k,v])=>nameF(k)+" "+Math.round(v/c.total*100)+"%").join(", ")});
  let a=-Math.PI/2;
  for(const [k,v] of rows){const frac=v/c.total;let a1=a+frac*Math.PI*2;
    const tipT=nameF(k)+" · "+fmt(v)+" · "+Math.round(frac*100)+"%";
    if(rows.length===1){svg.append(s("circle",{cx,cy,r:(R+r)/2,fill:"none",stroke:colF(k),"stroke-width":R-r,"data-tip":tipT}));break}
    const large=a1-a>Math.PI?1:0,p=(ang,rad)=>[cx+rad*Math.cos(ang),cy+rad*Math.sin(ang)];
    const [x0,y0]=p(a,R),[x1,y1]=p(a1,R),[x2,y2]=p(a1,r),[x3,y3]=p(a,r);
    svg.append(s("path",{d:`M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${large} 0 ${x3},${y3}Z`,
      fill:colF(k),stroke:"var(--surface)","stroke-width":2,"stroke-linejoin":"round","data-tip":tipT}));a=a1}
  svg.append(s("text",{x:cx,y:cy-2,"text-anchor":"middle",class:"strong",style:"font-size:15px"},compact(c.total)+" "+cur()),
    s("text",{x:cx,y:cy+16,"text-anchor":"middle"},"всего"));
  const list=h("div",{class:"dlist"},...rows.map(([k,v])=>h("div",{class:"drow"},h("span",{class:"dot",style:"background:"+colF(k)}),
    h("span",{class:"n"},nameF(k)),h("span",{class:"v"},fmt(v)),h("span",{class:"p"},Math.round(v/c.total*100)+"%"))));
  body.replaceChildren(h("div",{class:"donut-wrap"},svg,list))}
Object.assign(DRAW,{
dynamics(body,cfg,c,W){
  const byDay=c.n===1,t=today();
  let labels,vals,tips,last;
  if(byDay){const d=daysIn(month);vals=Array(d).fill(0);
    for(const e of c.E){const i=+String(e.date).slice(8,10)-1;if(i>=0&&i<d)vals[i]+=Number(e.amount)||0}
    labels=vals.map((_,i)=>String(i+1));tips=vals.map((_,i)=>dayMonth(month+"-"+pad(i+1)));
    last=month<t.slice(0,7)?d-1:month===t.slice(0,7)?+t.slice(8,10)-1:-1}
  else{vals=c.cur.map(m=>sum(c.E.filter(e=>e.month===m)));labels=c.cur.map(m=>MSHORT[+m.slice(5)-1]);tips=c.cur.map(monthLabel);
    last=c.cur.findLastIndex(m=>m<=t.slice(0,7))}
  if(last<0||!c.total)return emptyMsg(body,"В этом периоде трат нет.");
  const N=vals.length,budget=accBudget()*c.n;
  let plot=vals,pace=null;
  if(cfg.type==="cum"){let acc2=0;plot=vals.map(v=>acc2+=v);if(budget)pace=vals.map((_,i)=>budget*(i+1)/N)}
  const shown=plot.slice(0,last+1);
  const max=niceMax(Math.max(...shown,pace?budget:0));
  const H=220,m={l:44,r:10,t:14,b:26};
  const svg=s("svg",{width:W,height:H,viewBox:`0 0 ${W} ${H}`,role:"img","aria-label":"Динамика трат"});
  const {iw,y}=frame(svg,W,H,max,m);const band=iw/N,cx=i=>m.l+band*i+band/2;
  const every=byDay?(N>20?5:2):1;
  labels.forEach((l,i)=>{if(byDay&&!(i===0||(i+1)%every===0))return;
    svg.append(s("text",{x:cx(i),y:H-8,"text-anchor":"middle"},l))});
  if(cfg.type==="bars"){const bw=Math.max(2,Math.min(28,band*.66));
    vals.forEach((v,i)=>{if(v>0)svg.append(s("path",{d:barPath(cx(i)-bw/2,y(v),bw,y(0)-y(v),Math.min(4,bw/2)),fill:"var(--accent)"}))});
    const avg=c.total/(byDay?c.days.length:last+1);
    if(avg>0&&avg<=max){svg.append(s("line",{x1:m.l,x2:W-m.r,y1:y(avg),y2:y(avg),stroke:"var(--fg)","stroke-width":1,"stroke-dasharray":"4 4",opacity:.55}),
      s("text",{x:W-m.r,y:y(avg)-6,"text-anchor":"end",class:"strong"},"в среднем "+compact(avg)))}}
  else{const pts=shown.map((v,i)=>[cx(i),y(v)]);
    const line=pts.map((p,i)=>(i?"L":"M")+p[0]+","+p[1]).join("");
    svg.append(s("path",{d:line+`L${pts[pts.length-1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`,fill:"var(--accent)",opacity:.12}));
    if(pace){svg.append(s("path",{d:pace.map((v,i)=>(i?"L":"M")+cx(i)+","+y(v)).join(""),fill:"none",stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"}),
      s("text",{x:cx(N-1),y:y(budget)-6,"text-anchor":"end"},"бюджет "+compact(budget)))}
    svg.append(s("path",{d:line,fill:"none",stroke:"var(--accent)","stroke-width":2,"stroke-linejoin":"round","stroke-linecap":"round"}));
    const lp=pts[pts.length-1];svg.append(s("circle",{cx:lp[0],cy:lp[1],r:4.5,fill:"var(--accent)",stroke:"var(--surface)","stroke-width":2}),
      s("text",{x:Math.min(lp[0],W-m.r-4),y:lp[1]-10,"text-anchor":lp[0]>W-80?"end":"middle",class:"strong"},compact(shown[shown.length-1])))}
  vals.forEach((v,i)=>{const extra=cfg.type==="cum"?(i<=last?" · всего с начала: "+fmt(plot[i]):""):"";
    svg.append(s("rect",{class:"hit",x:m.l+band*i,y:m.t,width:band,height:H-m.t-m.b,"data-tip":tips[i]+" · "+fmt(v)+extra}))});
  body.replaceChildren(svg);
  if(pace)body.append(legend([["var(--accent)","Траты нарастающим итогом"],["var(--muted)","Равномерный расход бюджета"]]))},

compare(body,cfg,c,W){
  if(!c.Prev.length)return emptyMsg(body,"В прошлом периоде записей нет, сравнивать пока не с чем.");
  const pct=(a,b)=>b?Math.round((a-b)/b*100):null;
  const delta=(a,b)=>{const p=pct(a,b);if(p===null)return h("span",null,"новое");if(p===0)return h("span",null,"без изменений");
    return h("span",null,h("span",{class:p>0?"up":"down"},p>0?"↑ ":"↓ "),Math.abs(p)+"%")};
  const prevLbl=c.n===1?"Прошлый месяц":"Прошлые "+c.n+" мес.";
  const curLbl=c.n===1?"Этот месяц":"Эти "+c.n+" мес.";
  const rowsData=cfg.type==="total"?[["__all","Всего",c.total,c.prevTotal]]:
    CATS.map(k=>[k.id,k.name,sum(c.E.filter(e=>(e.cat||"other")===k.id)),sum(c.Prev.filter(e=>(e.cat||"other")===k.id))]).filter(r=>r[2]||r[3]).sort((a,b)=>b[2]-a[2]||b[3]-a[3]);
  const max=Math.max(...rowsData.map(r=>Math.max(r[2],r[3])))||1;
  body.replaceChildren(legend([["var(--accent)",curLbl],["var(--prev)",prevLbl]]),
    h("div",{class:"cmp",style:"margin-top:12px"},...rowsData.map(([id,n,a,b])=>h("div",{class:"crow","data-tip":n+": "+fmt(a)+" против "+fmt(b)},
      h("div",{class:"n"},id==="__all"?null:h("span",{class:"dot",style:"background:var("+CAT[id].c+")"}),n),
      h("div",{class:"d"},fmt(a)," · ",delta(a,b)),
      h("div",{class:"bb"},h("i",{style:"width:"+(a/max*100)+"%;background:var(--accent)"}),h("i",{style:"width:"+(b/max*100)+"%;background:var(--prev)"}))))))},

catmonths(body,cfg,c,W){
  if(c.n===1)return emptyMsg(body,"Этот график сравнивает месяцы. Выберите период «3 мес», «6 мес» или «Год».");
  const share=cfg.type==="share";
  const data=c.cur.map(m=>{const ex=c.E.filter(e=>e.month===m);const t=sum(ex);return {m,t,parts:CATS.map(k=>[k,sum(ex.filter(e=>(e.cat||"other")===k.id))]).filter(p=>p[1]>0)}});
  if(!c.total)return emptyMsg(body,"В этом периоде трат нет.");
  const H=230,m={l:44,r:10,t:12,b:26};
  const max=share?1:niceMax(Math.max(...data.map(d=>d.t)));
  const svg=s("svg",{width:W,height:H,viewBox:`0 0 ${W} ${H}`,role:"img","aria-label":"Категории по месяцам"});
  const iw=W-m.l-m.r,ih=H-m.t-m.b,y=v=>m.t+ih-(v/max)*ih;
  for(let i=0;i<=4;i++){const v=max*i/4;svg.append(s("line",{class:i?"gl":"base",x1:m.l,x2:W-m.r,y1:y(v),y2:y(v)}));
    if(i)svg.append(s("text",{x:m.l-6,y:y(v)+4,"text-anchor":"end"},share?Math.round(v*100)+"%":compact(v)))}
  const band=iw/data.length,bw=Math.min(40,band*.62);
  data.forEach((d,i)=>{const x=m.l+band*i+band/2;
    svg.append(s("text",{x,y:H-8,"text-anchor":"middle"},MSHORT[+d.m.slice(5)-1]));
    let base=0;d.parts.forEach(([k,v],j)=>{const val=share?v/d.t:v;const y0=y(base),y1=y(base+val);base+=val;
      const hh=Math.max(0,y0-y1),top=j===d.parts.length-1;
      const gap=j>0?2:0;const hh2=Math.max(0,hh-gap);
      svg.append(s("path",{d:top?barPath(x-bw/2,y1,bw,hh2,4):`M${x-bw/2},${y1}h${bw}v${hh2}h${-bw}Z`,fill:"var("+k.c+")",
        "data-tip":monthLabel(d.m)+" · "+k.name+" · "+fmt(v)+" ("+Math.round(v/d.t*100)+"%)"}))});
    if(!share&&d.t)svg.append(s("text",{x,y:y(d.t)-6,"text-anchor":"middle",class:"strong"},compact(d.t)))});
  const used=CATS.filter(k=>c.E.some(e=>(e.cat||"other")===k.id));
  body.replaceChildren(svg,legend(used.map(k=>["var("+k.c+")",k.name])))},

weekday(body,cfg,c,W){
  if(!c.total)return emptyMsg(body,"В этом периоде трат нет.");
  const sums=Array(7).fill(0),cnt=Array(7).fill(0);
  const wd=s=>{const [y,m,d]=s.split("-").map(Number);return (new Date(y,m-1,d).getDay()+6)%7};
  for(const e of c.E)if(e.date)sums[wd(String(e.date))]+=Number(e.amount)||0;
  for(const d of c.days)cnt[wd(d)]++;
  const vals=cfg.type==="avg"?sums.map((v,i)=>cnt[i]?v/cnt[i]:0):sums;
  const H=200,m={l:44,r:10,t:18,b:26},max=niceMax(Math.max(...vals));
  const svg=s("svg",{width:W,height:H,viewBox:`0 0 ${W} ${H}`,role:"img","aria-label":"Траты по дням недели"});
  const {iw,y}=frame(svg,W,H,max,m);const band=iw/7,bw=Math.min(36,band*.6);
  const topI=vals.indexOf(Math.max(...vals));
  vals.forEach((v,i)=>{const x=m.l+band*i+band/2;
    svg.append(s("text",{x,y:H-8,"text-anchor":"middle"},WD[i]));
    if(v>0)svg.append(s("path",{d:barPath(x-bw/2,y(v),bw,y(0)-y(v),4),fill:i===topI?"var(--accent)":"var(--prev)"}),
      s("text",{x,y:y(v)-6,"text-anchor":"middle",class:i===topI?"strong":""},compact(v)));
    svg.append(s("rect",{class:"hit",x:m.l+band*i,y:m.t,width:band,height:H-m.t-m.b,"data-tip":WD[i]+" · "+(cfg.type==="avg"?"в среднем "+fmt(v)+" за день":fmt(v)+" за период")}))});
  body.replaceChildren(svg,h("div",{class:"hint",style:"margin:6px 0 0"},"Выделен день, когда тратите больше всего."))},

top(body,cfg,c){
  const list=[...c.E].sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0)).slice(0,+cfg.type);
  if(!list.length)return emptyMsg(body,"В этом периоде трат нет.");
  const isS=acc.type==="shared";
  body.replaceChildren(h("div",{class:"top"},...list.map(e=>{const k=CAT[e.cat]||CAT.other;
    return h("div",{class:"trow"},catIcon(k,30),
      h("div",{class:"what"},h("div",null,e.note||k.name),h("div",{class:"sub"},[e.date?dayMonth(String(e.date)):"",e.note?k.name:"",isS?who(e):""].filter(Boolean).join(" · "))),
      h("div",{class:"amt"},fmt(Number(e.amount)||0)))})))}
});

function renderCustom(){const L=prefs.charts;
  $("custList").replaceChildren(...L.map((c,i)=>h("div",{class:"cust-row"},
    h("input",{type:"checkbox",id:"chk-"+c.id,checked:c.on?true:null,onchange:e=>{c.on=e.target.checked;savePrefs();renderStats()}}),
    h("label",{for:"chk-"+c.id},CHART[c.id].name),
    h("button",{type:"button",class:"icon-btn","aria-label":"Выше",disabled:i===0?true:null,onclick:()=>{move(i,-1)}},"↑"),
    h("button",{type:"button",class:"icon-btn","aria-label":"Ниже",disabled:i===L.length-1?true:null,onclick:()=>{move(i,1)}},"↓"))))}
function move(i,d){const L=prefs.charts,j=i+d;if(j<0||j>=L.length)return;[L[i],L[j]]=[L[j],L[i]];savePrefs();renderStats()}

let lastChartW=0,rsT=null;
new ResizeObserver(()=>{clearTimeout(rsT);rsT=setTimeout(()=>{const w=$("charts").clientWidth;if(view==="stats"&&w&&Math.abs(w-lastChartW)>4)renderStats()},150)}).observe($("charts"));

/* ---------- settings view ---------- */
function renderRates(){const curs=[...new Set(allAccounts().map(a=>a.currency||"₽"))].filter(c=>c!==prefs.base);
  $("baseCur").replaceChildren(...CURS.map(([v,t])=>h("option",{value:v},t)));$("baseCur").value=prefs.base;
  $("rateRows").replaceChildren(...(curs.length?[h("span",{class:"label",style:"margin:0"},"Курсы для пересчёта"),
    ...curs.map(c=>h("div",{class:"inline",style:"align-items:center;flex-wrap:nowrap"},h("label",{for:"rate-"+c.charCodeAt(0),style:"white-space:nowrap"},"1 "+c+" ="),
      h("input",{class:"field",id:"rate-"+c.charCodeAt(0),inputmode:"decimal",style:"max-width:140px",placeholder:"курс",value:prefs.rates[c]?String(prefs.rates[c]).replace(".",","):"",
        oninput:e=>{const v=parseNum(e.target.value);if(v>0)prefs.rates[c]=v;else delete prefs.rates[c];savePrefs();opsCache.clear()}}),h("span",null,prefs.base))),
    h("div",{class:"hint",style:"margin:0"},"Курсы задаются вручную: приложение не может получать их из интернета.")]
    :[h("div",{class:"hint",style:"margin:0"},"Все ваши счета в одной валюте, курсы не нужны.")]))}
$("baseCur").addEventListener("change",e=>{prefs.base=e.target.value;savePrefs();renderRates()});
function renderPrefs(){if(!prefSec)renderPrefMenu();renderRates();
  bigSeg($("themeSeg"),[["system","Как в системе","Светлая или тёмная"],["light","Светлая",""],["dark","Тёмная",""]],prefs.theme,v=>{prefs.theme=v;applyTheme();savePrefs();renderPrefs();renderStats()});
  $("accentSw").replaceChildren(...ACCENTS.map(([id,n,c])=>h("button",{type:"button",class:"sw",role:"radio","aria-checked":String(prefs.accent===id),"aria-label":n,title:n,style:"background:"+c,
    onclick:()=>{prefs.accent=id;applyTheme();savePrefs();renderPrefs()}})));
  bigSeg($("startSeg"),[["spend","Главная","Сводка, цели и операции"],["stats","Статистика","Графики за период"]],prefs.start,v=>{prefs.start=v;savePrefs();renderPrefs()});
  bigSeg($("centsSeg"),[["show","С копейками","1 234,50 ₽"],["round","Округлять","1 235 ₽"]],prefs.cents,v=>{prefs.cents=v;savePrefs();renderPrefs();render()})}
$("resetCharts").onclick=()=>{prefs.charts=defaultCharts();savePrefs();toast("Графики вернулись к стандартному набору")};

function fillSettings(force){if(!acc)return;const key=acc.type+":"+acc.id;if(!force&&filledFor===key)return;filledFor=key;
  $("setName").value=acc.name||"";$("setPeople").value=people(acc).join(", ");
  $("setBudget").value=acc.budget||"";$("setCur").value=acc.currency||"₽";$("setMsg").textContent="";dangerConfirm=false;renderDanger();fillSubs()}
async function renderPeople(){if(!acc||acc.type!=="shared")return;const ids=acc.members||[];
  let ps={};if(user&&ids.length){try{ps=await user.profiles(ids)}catch(e){}}
  if(!acc||acc.type!=="shared")return;
  $("people").replaceChildren(...ids.map(id=>{const p=ps[id]||{};
    return h("div",{class:"person"},p.avatarUrl?h("img",{src:p.avatarUrl,alt:""}):h("span",{class:"dot",style:"width:28px;height:28px;background:var(--soft)"}),
      h("div",null,h("div",null,id===uid?"Вы":(p.name||"Участник")),h("div",{class:"tag"},id===acc.owner?"создал счёт":"участник")))}));
  if(!ids.length)$("people").replaceChildren(h("div",{class:"hint"},"Пока никого"))}
function renderDanger(){const z=$("dangerZone");if(!acc||readOnly){z.replaceChildren();return}
  const isOwner=acc.type==="personal"||!acc.owner||acc.owner===uid;
  if(!dangerConfirm){z.replaceChildren(h("button",{type:"button",class:"ghost danger",onclick:()=>{dangerConfirm=true;renderDanger()}},
    isOwner?"Удалить счёт":"Выйти из счёта"));return}
  z.replaceChildren(h("div",{class:"stack",style:"gap:10px"},
    h("div",{class:"hint"},isOwner?"Счёт и все его траты удалятся без возможности восстановления"+(acc.type==="shared"?" — у всех участников.":"."):"Счёт пропадёт из вашего списка. Траты останутся у остальных участников."),
    h("div",{class:"confirm"},h("button",{type:"button",class:"del",onclick:()=>isOwner?deleteAcc():leaveAcc()},isOwner?"Да, удалить":"Да, выйти"),
      h("button",{type:"button",onclick:()=>{dangerConfirm=false;renderDanger()}},"Отмена"))))}

$("copyCode").onclick=()=>{const code=$("codeOut").textContent;
  try{navigator.clipboard.writeText(code).then(()=>toast("Код скопирован"),()=>selectCode())}catch(e){selectCode()}};
function selectCode(){const r=document.createRange();r.selectNodeContents($("codeOut"));const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Код выделен — скопируйте его")}

/* ---------- data ---------- */
function resubscribe(){if(!db||!acc)return;const key=acc.type+":"+acc.id+":"+month;if(key===subKey)return;
  subKey=key;if(unsub)unsub();loaded=false;expenses=[];render();const a=acc;
  unsub=expCol(a).where("month","==",month).onSnapshot(qs=>{if(!acc||acc.id!==a.id)return;
    expenses=qs.docs.map(d=>({id:d.id,...d.data()}));loaded=true;render()},
    err=>{loaded=true;render();notice(err.code==="revoked"?"Доступ к счетам закрыт.":"Не удалось загрузить траты. Обновите страницу.",true)})}
function setReadOnly(){readOnly=true;$("fab").disabled=true;closeSheet();$("saveSet").hidden=true;$("saveSubs").hidden=true;$("newPanel").hidden=true;
  notice("Доступ только на просмотр.");renderTabs();renderDanger();if(acc)renderList()}
function writeErr(e,el){const c=e&&e.code;el.classList.add("bad");
  el.textContent=c==="rate_limited"?"Слишком много попыток ввести код. Попробуйте через час.":c==="quota_exceeded"?"База заполнена: удалите старые операции, чтобы добавить новые.":c==="denied"?"Нет доступа: вы не участник этого счёта или вышли из аккаунта.":c==="invalid_argument"?"Запись не найдена — возможно, её уже удалили. Обновите страницу.":c==="invalid_argument_data"?"Данные не прошли проверку. Проверьте поля и попробуйте ещё раз.":"Не получилось сохранить. Проверьте интернет и попробуйте ещё раз."}

$("form").addEventListener("submit",async ev=>{ev.preventDefault();const msg=$("formMsg");msg.classList.remove("bad");
  const amount=Math.round(parseNum($("amount").value)*100)/100;
  if(!(amount>0)||amount>1e9){msg.classList.add("bad");msg.textContent="Введите сумму больше нуля.";$("amount").focus();return}
  if(!db||!acc)return;
  const date=$("date").value||today(),btn=$("addBtn"),inc=curKind==="inc",tr=curKind==="tr";let amount2=0;
  if(tr){if(trFrom===trTo){msg.classList.add("bad");msg.textContent="Выберите разные «Откуда» и «Куда».";return}
    const dest=destOf(trTo);
    if(dest&&(dest.a.currency||"₽")!==cur()){amount2=Math.round(parseNum($("trAmt2").value)*100)/100;
      if(!(amount2>0)){msg.classList.add("bad");msg.textContent="Укажите, сколько придёт в счёт «"+(dest.a.name||"")+"» в "+(dest.a.currency||"₽")+".";$("trAmt2").focus();return}}}
  btn.disabled=true;
  try{const dest=tr?destOf(trTo):null;
    await createOp({kind:curKind,amount,amount2,cat:inc?curInc:curCat,sub:formSub||"main",from:trFrom,to:trTo,member:curWho(),note:$("note").value.trim().slice(0,80),date,tpl:tplActive,goal:goalActive});
    $("amount").value="";$("note").value="";$("trAmt2").value="";msg.textContent="";tplActive=null;goalActive=null;renderTplBar();closeSheet();
    if(tr)toast("Переведено "+fmt(amount)+": "+subName(trFrom)+" → "+(dest?"«"+(dest.a.name||"")+"»":subName(trTo)));
    else toast(date.slice(0,7)===month?(inc?"Доход добавлен: +":"Расход добавлен: ")+fmt(amount):"Добавлено в "+monthLabel(date.slice(0,7)).toLowerCase())}
  catch(e){writeErr(e,msg)}finally{btn.disabled=false}});

$("saveSet").onclick=async()=>{const msg=$("setMsg");msg.classList.remove("bad");if(!acc)return;
  const b=parseNum($("setBudget").value);
  const patch={name:$("setName").value.trim().slice(0,40)||acc.name||"Счёт",budget:b>0?Math.round(b):0,currency:$("setCur").value};
  if(acc.type==="shared")patch.people=[...new Set($("setPeople").value.split(",").map(s=>s.trim().slice(0,30)).filter(Boolean))].slice(0,12);
  const a=acc;
  try{await accDoc(a).update(patch);Object.assign(a,patch);renderTabs();msg.textContent="Сохранено";render()}catch(e){writeErr(e,msg)}};
$("saveSubs").onclick=async()=>{const msg=$("subMsg");msg.classList.remove("bad");if(!acc)return;
  const keep=subDraft.filter(x=>!x.del&&(String(x.name).trim()||x.id==="main"));
  const names=keep.map(x=>String(x.name).trim().toLowerCase()||"основной");
  if(new Set(names).size!==names.length){msg.classList.add("bad");msg.textContent="У кошельков должны быть разные названия.";return}
  const subs=keep.map(x=>{const st=parseNum(x.start);return {id:x.id,name:String(x.name).trim().slice(0,30)||"Основной",start:Number.isFinite(st)?Math.round(st*100)/100:0,off:!!x.off}});
  const removed=subDraft.filter(x=>x.del&&!x.isNew).map(x=>x.id);
  const a=acc;
  try{if(removed.length){msg.textContent="Переносим операции…";for(const id of removed)await reassignSub(a,id)}
    await accDoc(a).update({subs});a.subs=subs;fillSubs();loadSubSel();renderSubs();render();msg.textContent="Сохранено"}catch(e){writeErr(e,msg)}};

$("createBtn").onclick=async()=>{const msg=$("newMsg");msg.classList.remove("bad");
  const name=$("newName").value.trim().slice(0,40);
  if(!name){msg.classList.add("bad");msg.textContent="Придумайте название счёта.";$("newName").focus();return}
  if(!uid){msg.classList.add("bad");msg.textContent="Не удалось определить ваш аккаунт. Выйдите и войдите снова.";return}
  const b=parseNum($("newBudget").value);
  const base={name,currency:$("newCur").value,budget:b>0?Math.round(b):0,createdAt:Date.now()};
  const btn=$("createBtn");btn.disabled=true;
  try{const doc=newType==="personal"?{...base,type:"personal"}:{...base,type:"shared",owner:uid,members:[uid],people:[],code:genCode()};
    const ref=await (newType==="personal"?db.collection("data/users/"+uid):db.collection("accounts")).add(doc);
    lsSet("fk.acc",newType+":"+ref.id);acc={id:ref.id,...doc};
    $("newName").value="";$("newBudget").value="";$("newPanel").hidden=true;
    toast(newType==="shared"?"Общий счёт создан — код приглашения в настройках":"Личный счёт создан");
    if(newType==="shared"){view="prefs";prefSec="acc"}syncView();resubscribe();if(newType==="shared")fillSettings(true)}
  catch(e){writeErr(e,msg)}finally{btn.disabled=false}};

$("joinBtn").onclick=async()=>{const msg=$("joinMsg");msg.classList.remove("bad");
  const code=$("joinCode").value.trim().toUpperCase().replace(/\s/g,"");
  if(code.length<6){msg.classList.add("bad");msg.textContent="Код состоит из 6 символов.";return}
  if(!uid){msg.classList.add("bad");msg.textContent="Не удалось определить ваш аккаунт. Выйдите и войдите снова.";return}
  try{const id=await db.joinByCode(code);
    if(!id){msg.classList.add("bad");msg.textContent="Счёт с таким кодом не найден. Проверьте код.";return}
    const snap=await db.doc("accounts/"+id).get(),data=snap.data()||{};
    lsSet("fk.acc","shared:"+id);acc={id,...data};if(!shared.some(x=>x.id===id))shared.push(acc);
    $("joinCode").value="";$("newPanel").hidden=true;toast("Вы в счёте «"+(data.name||"")+"»");syncView();resubscribe()}
  catch(e){writeErr(e,msg)}};

async function leaveAcc(){const a=acc;try{await accDoc(a).update({members:(a.members||[]).filter(x=>x!==uid)});
  acc=null;subKey="";histKey="";iconKey="";toast("Вы вышли из счёта")}catch(e){writeErr(e,$("setMsg"))}}
async function deleteAcc(){const a=acc,msg=$("setMsg");msg.classList.remove("bad");msg.textContent="Удаляем…";
  try{if(unsub){unsub();unsub=null}if(histUnsub){histUnsub();histUnsub=null}if(iconUnsub){iconUnsub();iconUnsub=null}subKey="";histKey="";iconKey="";
    for(;;){const qs=await expCol(a).limit(200).get();if(qs.empty)break;for(const d of qs.docs)await expCol(a).doc(d.id).delete()}
    await accDoc(a).delete();acc=null;msg.textContent="";toast("Счёт удалён");onAccounts()}
  catch(e){writeErr(e,msg)}}

function changeMonth(d){month=shiftMonth(month,d);render();resubscribe();if(view==="stats")renderStats()}
$("prev").onclick=()=>changeMonth(-1);
$("next").onclick=()=>changeMonth(1);
$("date").value=today();
applyTheme();renderCats();renderPrefs();setView(view);
$("tabs").replaceChildren(h("div",{class:"empty"},"Загружаем счета…"));

(async()=>{
  const c=window.claude;
  db=c&&c.use?await c.use("db"):null;
  if(!db){$("tabs").replaceChildren();$("accKind").textContent="";notice("Не удалось подключиться к базе. Проверьте интернет и обновите страницу.",true);return}
  c.use("downloads").then(x=>{dl=x;renderHistory()},()=>{});
  user=await c.use("user");
  uid=user?await user.id():null;
  const can=user?await user.can("data.write"):null;
  if(can===false)setReadOnly();
  if(uid){
    db.doc("data/users/"+uid+"/prefs").get().then(snap=>{if(!snap.exists)return;
      const startBefore=prefs.start;prefs=normPrefs(snap.data());lsSet("fk.prefs",JSON.stringify(prefs));applyTheme();
      if(!navTouched&&prefs.start!==startBefore)view=prefs.start;setView(view)}).catch(()=>{});
    db.collection("data/users/"+uid).where("type","==","personal").onSnapshot(qs=>{
      personal=qs.docs.map(d=>({id:d.id,...d.data()}));gotP=true;refreshAcc();onAccounts()},()=>{gotP=true;onAccounts()})}
  else gotP=true;
  const sq=uid&&!readOnly?db.collection("accounts").where("members","array-contains",uid):db.collection("accounts");
  sq.onSnapshot(qs=>{shared=qs.docs.map(d=>({id:d.id,...d.data()}));gotS=true;refreshAcc();onAccounts()},
    ()=>{gotS=true;onAccounts();notice("Не удалось загрузить общие счета. Обновите страницу.",true)});
})();
function refreshAcc(){if(!acc)return;const f=allAccounts().find(a=>a.id===acc.id&&a.type===acc.type);if(f)acc=f}

/* ---------- account, backup and restore (standalone version) ---------- */
function fillMe(){$("meEmail").textContent=(window.KASSA&&KASSA.email())||"—";$("meName").value=(window.KASSA&&KASSA.myName())||"";$("bkMsg").textContent="";
  $("usage").textContent="";if(db&&db.usage)db.usage().then(u=>{const mb=(u.bytes||0)/1048576;
    $("usage").textContent="Сейчас в базе "+u.docs+" "+plural(u.docs,["запись","записи","записей"])+" (≈ "+(mb<0.1?"меньше 0,1":mb.toFixed(1).replace(".",","))+" МБ). Бесплатного тарифа хватает на 500 МБ."}).catch(()=>{})}
$("meNameSave").onclick=async()=>{const n=$("meName").value.trim().slice(0,60);if(!n){toast("Введите имя");return}
  try{await KASSA.setName(n);names[uid]=n;toast("Имя сохранено");renderPeople()}catch(e){toast("Не получилось сохранить имя")}};
$("signOut").onclick=()=>KASSA.signOut();
async function collectBackup(){const docs=[],seen=new Set(),add=(path,data)=>{if(!seen.has(path)){seen.add(path);docs.push({path,data})}};
  const mine=await db.collection("data/users/"+uid).get();for(const d of mine.docs)add("data/users/"+uid+"/"+d.id,d.data());
  for(const a of allAccounts()){add(accDoc(a).path,Object.fromEntries(Object.entries(a).filter(([k])=>k!=="id")));
    opsCache.delete(a.type+":"+a.id);const ops=acc&&a.type===acc.type&&a.id===acc.id&&histLoaded&&archDone?histExp:await loadOpsOf(a);
    for(const e of ops){const {id,...v}=e;add(expCol(a).path+"/"+id,v)}
    const ic=await iconCol(a).get();for(const d of ic.docs)add(iconCol(a).path+"/"+d.id,d.data())}
  return {app:"semeynaya-kassa",version:1,user:uid,exportedAt:new Date().toISOString(),docs}}
$("bkExport").onclick=async ev=>{const btn=ev.currentTarget,msg=$("bkMsg");msg.classList.remove("bad");btn.disabled=true;msg.textContent="Собираем данные…";
  try{const b=await collectBackup();await dl.save({filename:"semeynaya-kassa-"+today()+".json",data:JSON.stringify(b)});
    msg.textContent="Готово: "+b.docs.length+" "+plural(b.docs.length,["запись","записи","записей"])+" в файле."}
  catch(e){msg.classList.add("bad");msg.textContent="Не получилось собрать копию. Проверьте интернет и попробуйте ещё раз."}finally{btn.disabled=false}};
$("bkImportBtn").onclick=()=>{$("bkFile").value="";$("bkFile").click()};
$("bkFile").addEventListener("change",async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;const msg=$("bkMsg");msg.classList.remove("bad");
  let b;try{b=JSON.parse(await f.text())}catch(x){msg.classList.add("bad");msg.textContent="Это не файл резервной копии.";return}
  if(!b||b.app!=="semeynaya-kassa"||!Array.isArray(b.docs)){msg.classList.add("bad");msg.textContent="Это не файл резервной копии «Семейной кассы».";return}
  const old=String(b.user||""),map=v=>old&&old!==uid?v.split(old).join(uid):v;
  const rows=b.docs.filter(d=>d&&typeof d.path==="string"&&d.data&&typeof d.data==="object").map(d=>({path:map(d.path),data:JSON.parse(map(JSON.stringify(d.data)))}))
    .filter(d=>d.path.startsWith("data/users/"+uid+"/")||d.path.startsWith("accounts/"))
    .sort((x,y)=>x.path.split("/").length-y.path.split("/").length);
  let ok=0,fail=0;msg.textContent="Восстанавливаем 0 из "+rows.length+"…";
  let kept=0;
  for(const r of rows){
    if(/^accounts\/[^/]+$/.test(r.path)){
      /* a shared account that still exists keeps its members; a missing one is recreated with you as the only member */
      let exists=false;try{exists=(await db.doc(r.path).get()).exists}catch(x){}
      if(exists){kept++;ok++;continue}
      r.data.members=[uid];r.data.owner=uid}
    try{await db.doc(r.path).set(r.data);ok++}catch(x){fail++}
    if((ok+fail)%25===0)msg.textContent="Восстанавливаем "+(ok+fail)+" из "+rows.length+"…"}
  msg.textContent="Восстановлено "+ok+" из "+rows.length+(fail?" · не удалось "+fail+" (обычно это общие счета, где вы не участник)":"")+". Обновляем приложение…";
  setTimeout(()=>location.reload(),1800)});

/* Семейная касса — оформление: тема, свой цвет акцента и фон.
   Подключается в <head>, чтобы выбранный вид появлялся сразу, без мигания. */
(function(){
const BGS=["plain","mint","sky","sunset","lavender","sand","dots","grid","color","image"];
const hex=v=>/^#[0-9a-f]{6}$/i.test(v||"")?String(v).toLowerCase():null;
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const toHex=a=>"#"+a.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,"0")).join("");
const lum=a=>{const c=a.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
/* moves a colour toward black or white until text in it is readable on the given background */
function fit(c,bg,toward,min){let t=0,x=c;while(contrast(x,bg)<min&&t<1){t+=.04;x=mix(c,toward,t)}return x}
/* one picked colour -> accent for the light theme, the dark theme and the text on accent buttons */
function accentVars(h){const c=rgb(h),light=fit(c,[255,255,255],[0,0,0],4.5),dark=fit(c,[23,32,32],[255,255,255],5.5);
  return {"--acc-l":toHex(light),"--acc-d":toHex(dark),"--acc-ink-l":"#ffffff","--acc-ink-d":toHex(mix(dark,[0,0,0],.82))}}
const clamp=(v,a,b,d)=>{v=Number(v);return Number.isFinite(v)?Math.max(a,Math.min(b,v)):d};
const okImg=v=>typeof v==="string"&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
function localImg(){try{return localStorage.getItem("fk.bgimg")}catch(e){return null}}
function apply(p,img){const r=document.documentElement,s=r.style;p=p||{};
  if(p.theme==="light"||p.theme==="dark")r.setAttribute("data-app-theme",p.theme);else r.removeAttribute("data-app-theme");
  const ac=p.accent==="custom"?hex(p.accentColor):null;
  if(p.accent&&p.accent!=="emerald"&&p.accent!=="custom")r.setAttribute("data-accent",p.accent);else r.removeAttribute("data-accent");
  for(const k of ["--acc-l","--acc-d","--acc-ink-l","--acc-ink-d"])s.removeProperty(k);
  if(ac){const v=accentVars(ac);for(const k in v)s.setProperty(k,v[k])}
  let bg=BGS.includes(p.bg)?p.bg:"plain";
  if(bg==="color"&&!hex(p.bgColor))bg="plain";
  if(bg==="image"){if(img===undefined)img=localImg();if(!okImg(img))bg="plain"}
  if(bg==="plain")r.removeAttribute("data-bg");else r.setAttribute("data-bg",bg);
  s.setProperty("--bgk",String(clamp(p.bgK,5,90,40)));
  s.setProperty("--bgdim",String(clamp(p.bgDim,0,90,55)));
  if(bg==="color")s.setProperty("--bgc",hex(p.bgColor));else s.removeProperty("--bgc");
  if(bg==="image")s.setProperty("--bgimg",'url("'+img+'")');else s.removeProperty("--bgimg");
  if(bg==="image"&&p.bgBlur)r.setAttribute("data-bgblur","");else r.removeAttribute("data-bgblur");
  return bg}
window.kassaTheme={apply,accentVars,BGS,hex,okImg,localImg};
try{apply(JSON.parse(localStorage.getItem("fk.prefs")||"{}"))}catch(e){}
})();

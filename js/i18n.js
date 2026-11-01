/* Семейная касса — languages (ru is the source language, en is a dictionary). Loaded before all other scripts. */
(function(){
const SUP=["ru","en"];
let saved=null;try{saved=localStorage.getItem("fk.lang")}catch(e){}
function detect(){const ls=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||"ru"]);
  for(const l of ls){const b=String(l).toLowerCase().slice(0,2);if(["ru","uk","be","kk"].includes(b))return "ru";if(b==="en")return "en"}return "en"}
const LANG=SUP.includes(saved)?saved:detect();
/* the English dictionary is a separate file, loaded only when English is on */
if(LANG==="en")document.write('<script src="js/i18n-en.js"><\/script>');
function T(s){const D=window.I18N_EN;if(LANG==="ru"||!D||typeof s!=="string")return s;const v=D[s];return v===undefined?s:v}
window.LANG=LANG;window.LANG_SET=SUP.includes(saved);window.LOC=LANG==="en"?"en-GB":"ru-RU";window.T=T;
window.lc=s=>LANG==="ru"?String(s).toLowerCase():String(s);
window.setLang=function(l,noReload){if(!SUP.includes(l))return;try{localStorage.setItem("fk.lang",l)}catch(e){}if(!noReload&&l!==LANG)location.reload()};
document.documentElement.lang=LANG;
const CY=/[А-Яа-яЁё]/;
function tr(s){const k=s.replace(/\s+/g," ").trim();const v=T(k);if(v===k)return s;const m=s.match(/^\s*/)[0],e=s.match(/\s*$/)[0];return m+v+e}
window.translateDom=function(root){if(!window.I18N_EN)return;root=root||document;
  const w=document.createTreeWalker(root.body||root,NodeFilter.SHOW_TEXT);const nodes=[];while(w.nextNode())nodes.push(w.currentNode);
  for(const n of nodes){if(CY.test(n.nodeValue))n.nodeValue=tr(n.nodeValue)}
  for(const el of (root.querySelectorAll?root:document).querySelectorAll("[placeholder],[aria-label],[title],[alt],meta[name=description]"))
    for(const a of ["placeholder","aria-label","title","alt","content"]){const v=el.getAttribute(a);if(v&&CY.test(v))el.setAttribute(a,tr(v))}
  if(CY.test(document.title))document.title=tr(document.title);
  for(const a of document.querySelectorAll('a[href="privacy.html"],a[href="delete-account.html"]'))a.setAttribute("href",a.getAttribute("href").replace(".html",".en.html"))};
function boot(){if(LANG!=="ru")translateDom(document);
  for(const b of document.querySelectorAll("[data-lang]")){b.setAttribute("aria-checked",String(b.dataset.lang===LANG));b.addEventListener("click",()=>setLang(b.dataset.lang))}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();

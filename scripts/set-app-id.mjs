// Меняет идентификатор приложения (bundle ID / applicationId) во всех проектах сразу.
// Запуск: node scripts/set-app-id.mjs ru.example.kassa
// Менять можно только до первой публикации в сторах: после неё идентификатор уже не поменять.
import {readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,readdirSync,existsSync} from "node:fs";
const id=process.argv[2];
if(!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(id||"")){console.error("Укажите идентификатор вида ru.example.kassa (латиница, точки)");process.exit(1)}
const cfg=JSON.parse(readFileSync("capacitor.config.json","utf8"));const old=cfg.appId;
if(old===id){console.log("Уже "+id);process.exit(0)}
cfg.appId=id;writeFileSync("capacitor.config.json",JSON.stringify(cfg,null,2)+"\n");
const edit=(p,f)=>{writeFileSync(p,f(readFileSync(p,"utf8")))};
const esc=s=>s.replace(/\./g,"\\.");
edit("android/app/build.gradle",s=>s.replace(new RegExp('"'+esc(old)+'"',"g"),'"'+id+'"'));
edit("android/app/src/main/res/values/strings.xml",s=>s.replace(new RegExp(">"+esc(old)+"<","g"),">"+id+"<"));
const src="android/app/src/main/java/",from=src+old.split(".").join("/"),to=src+id.split(".").join("/");
mkdirSync(to,{recursive:true});
for(const f of readdirSync(from)){edit(from+"/"+f,s=>s.replace("package "+old+";","package "+id+";"));renameSync(from+"/"+f,to+"/"+f)}
/* remove the now-empty folders of the old package */
let parts=old.split(".");while(parts.length){const d=src+parts.join("/");if(existsSync(d)&&!readdirSync(d).length)rmSync(d,{recursive:true});parts.pop()}
edit("ios/App/App.xcodeproj/project.pbxproj",s=>s.replace(new RegExp("PRODUCT_BUNDLE_IDENTIFIER = "+esc(old)+";","g"),"PRODUCT_BUNDLE_IDENTIFIER = "+id+";"));
console.log(old+" → "+id);

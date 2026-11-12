// Собирает сайт в папку dist/: её содержимое выкладывается на хостинг и попадает в приложения для iOS и Android.
import {cpSync,rmSync,mkdirSync,existsSync,readFileSync,writeFileSync} from "node:fs";
const OUT="dist";
const FILES=["index.html","app.css","manifest.webmanifest","sw.js","privacy.html","privacy.en.html","delete-account.html","delete-account.en.html",".htaccess","robots.txt"];
const DIRS=["css","fonts","icons","js"];
rmSync(OUT,{recursive:true,force:true});mkdirSync(OUT);
for(const f of FILES)if(existsSync(f))cpSync(f,OUT+"/"+f);
for(const d of DIRS)cpSync(d,OUT+"/"+d,{recursive:true});
/* the site address can be given at build time (SITE_URL=https://example.com npm run build) */
const site=(process.env.SITE_URL||"").trim().replace(/\/+$/,"");
if(site){const p=OUT+"/js/config.js";writeFileSync(p,readFileSync(p,"utf8").replace(/siteUrl:"[^"]*"/,'siteUrl:"'+site+'"'))}
console.log("dist/ готова"+(site?" · siteUrl="+site:""));

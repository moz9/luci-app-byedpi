// Local UI fixture. Does not connect to a router or execute service commands.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/byedpi/main.js'), 'utf8');
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ByeDPI — проверка интерфейса</title><style>
:root {color-scheme:dark;--border-color-low:#344054;--text-color-medium:#aab5c6;--background-color-high:#151c28}
*{box-sizing:border-box}body{font:15px/1.5 system-ui;background:#101722;color:#e7edf6;margin:24px auto;padding:0 20px;max-width:1250px}
button,input,select,textarea{font:inherit;color:inherit;background:#202b3e;border:1px solid #4a5770;border-radius:5px;padding:7px 11px}
button{cursor:pointer}button:disabled{opacity:.45;cursor:default}.cbi-button-apply{background:#286ec5}
textarea{width:100%}h2,h3,p{margin:0}h2{margin-bottom:10px}details pre{max-width:320px}summary{cursor:pointer}
</style><body><main id="app"></main><script>
const _ = s => s;
function E(tag, attrs, children) {
 const el=document.createElement(tag);
 for(const [key,value] of Object.entries(attrs||{})) {
  if(value==null) continue;
  if(typeof value==='function') el.addEventListener(key,value);
  else el.setAttribute(key,String(value));
 }
 const add=x=>{ if(Array.isArray(x)) x.forEach(add); else if(x!=null) el.append(x.nodeType?x:document.createTextNode(String(x))); };
 add(children); return el;
}
let current='-s1 -d1 -At,s -r1+s';
let job={active:false}, tick=0;
const ranking=[
 {id:2,strategy:'-s1 -At,s -d1',total:40,failed:0,slow:0,median_ms:188,p95_ms:235,jitter_ms:47,min_rate:3300000,rounds:8,eligible:true},
 {id:1,strategy:current,total:40,failed:3,slow:5,median_ms:200,p95_ms:3171,jitter_ms:2971,min_rate:940000,rounds:8,eligible:false}
];
const rpc={exec:async (helper,args)=>{
 const action=args[0]; let data={};
 if(action==='status') data={running:true,enabled:true,pid:'1234',current_strategy:current,command:['ciadpi',current]};
 if(action==='list-strategies') data={strategies:ranking.map(x=>({id:x.id,value:x.strategy}))};
 if(action==='diagnostics') data={checks:[{name:'Рабочий ByeDPI',ok:true,detail:'Проверка интерфейса'}]};
 if(action==='start-autotest'||action==='start-test'){ tick=0; job={active:true,state:'running',stage:'screen',current_id:1,candidate_count:60,round:0,started:100,checked_at:100,ranking:[],message:'Первичный отбор стратегий'}; }
 if(action==='stop-test') job={...job,state:'stopped',message:'Подбор остановлен. Рабочая стратегия сохранена.',recommended_id:''};
 if(action==='test-status'&&job.state==='running'){tick++;job={...job,stage:tick<2?'screen':'stable',round:tick,checked_at:100+tick*30,ranking:tick<2?[]:ranking};if(tick>=5)job={...job,state:'complete',recommended_id:'2',message:'Проверка завершена.'};}
 if(['test-status','start-autotest','start-test','stop-test'].includes(action)) data=job;
 if(action==='apply'){current=args[1];data={running:true,enabled:true,current_strategy:current};}
 return {code:0,stdout:JSON.stringify(data)};
}};
const poll={add:fn=>setInterval(fn,1500)};
const ui={addNotification:(_a,node)=>document.body.append(node)};
const view={extend:obj=>obj};
const source=${JSON.stringify(source).replaceAll('</', '<\\/')};
const page=new Function('E','_','view','fs','poll','ui',source)(E,_,view,rpc,poll,ui);
page.load().then(data=>document.getElementById('app').append(page.render(data)));
</script></body></html>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
server.listen(18741,'127.0.0.1',()=>console.log('UI fixture: http://127.0.0.1:18741'));

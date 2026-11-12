// Controlled browser comparison: both runs use repaired hulls and fixed 1/60 steps.
// Baseline bypasses only SAT-axis deduplication; no shader or geometry quality changes.
// Run separately from browser.mjs: BROWSER_PATH=/path/to/chromium node tests/horse-performance.mjs
// Run with Node 24+: BROWSER_PATH=/path/to/chromium node tests/browser.mjs
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
let benchmarkMode='baseline';
const server=createServer(async(req,res)=>{try {const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname); let data=await readFile(root+(path==='/'?'/index.html':path));if(path==='/flake-physics.js'){
 data=data.toString();
 if(benchmarkMode==='baseline')data=data.replace('export function optimizeCollisionAxes(shape){','export function optimizeCollisionAxes(shape){return shape;');
 data=data.replace('setSpecimenHulls, step, clear, stats','setSpecimenHulls, step(dt){const started=performance.now();try{return step(dt);}finally{if(window.measurePhysics)(window.physicsTimes??=[]).push(performance.now()-started);}}, clear, stats');
}res.setHeader('Cache-Control','no-store');if(path==='/app.js')data=data.toString().replace('models.update(dt)','models.update(window.benchmarkFixedStep?1/60:dt)')+'\nwindow.peelDebug={models,state,scene};';res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.woff2')?'font/woff2':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(8765,'127.0.0.1',r));
const browser=spawn(process.env.BROWSER_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',['--headless','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=9225','--user-data-dir=/private/tmp/oxide-qa-browser','about:blank'],{stdio:'ignore'});
let ws;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let tabs;for(let i=0;i<50;i++){try{tabs=await(await fetch('http://127.0.0.1:9225/json')).json();break;}catch{await delay(200);}}
 assert(tabs,'Browser failed to start');
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map(),errors=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);});
 const call=(method,params={})=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
 const run=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 await call('Runtime.enable');await call('Log.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1050,height:850,deviceScaleFactor:1,mobile:false});await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.drawCount=0;for(const name of ['drawElements','drawArrays']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.drawCount++;return original.apply(this,args);};}`});await call('Page.navigate',{url:'http://127.0.0.1:8765/'});
 let loaded=false;for(let i=0;i<100;i++){await delay(200);loaded=await run("document.readyState==='complete'&&!document.getElementById('loading')");if(loaded||errors.length)break;}
 assert.equal(errors.length,0,JSON.stringify(errors));assert(loaded,'Scene did not finish loading');
 assert(await run("document.getElementById('webgl-error').hidden"));
 const idleDraws=await run('window.drawCount');await delay(500);
 assert.equal(await run('window.drawCount'),idleDraws,'Paused scene should not draw');





 console.log('GPU',await run(`(()=>{const gl=document.getElementById('scene').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';})()`));
 await call('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:2,mobile:true});
 for(const mode of ['baseline','optimized']){
  benchmarkMode=mode;
  if(mode==='optimized'){
   await call('Page.reload',{ignoreCache:true});
   for(let i=0;i<150;i++){await delay(100);if(await run("!!window.peelDebug&&!document.getElementById('loading')"))break;}
  }
  await run("document.getElementById('horse-shape').click()");
  for(let i=0;i<150;i++){await delay(100);if(await run("peelDebug.models.sampleKey==='horse'"))break;}
  assert.equal(await run('peelDebug.models.sampleKey'),'horse');
  await run("document.querySelector('[data-metal=copper]').click();document.getElementById('age').value=100;document.getElementById('age').dispatchEvent(new Event('input'));window.benchmarkFixedStep=true;window.physicsTimes=[];window.frameTimes=[];window.measurePhysics=true;window.markFrame=function(t){if(!window.measurePhysics)return;window.frameTimes.push(t);requestAnimationFrame(window.markFrame);};requestAnimationFrame(window.markFrame)");
  for(let i=0;i<200;i++){await delay(200);if(await run('window.physicsTimes.length>=180'))break;}
  const result=await run(`(()=>{window.measurePhysics=false;const p=window.physicsTimes.sort((a,b)=>a-b),f=window.frameTimes,g=f.slice(1).map((v,i)=>v-f[i]).sort((a,b)=>a-b);return {physics:{n:p.length,median:p[Math.floor(p.length*.5)],p95:p[Math.floor(p.length*.95)]},frames:{n:f.length,medianInterval:g[Math.floor(g.length*.5)],p95Interval:g[Math.floor(g.length*.95)]},stats:peelDebug.models.peelingStats};})()`);
  console.log(mode,JSON.stringify(result));assert.equal(errors.length,0,JSON.stringify(errors));
 }
 console.log('PASS: browser physics comparison without runtime errors.');

} finally {ws?.close();browser.kill();server.close();}

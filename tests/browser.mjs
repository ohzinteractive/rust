// Run with Node 24+: BROWSER_PATH=/path/to/chromium node tests/browser.mjs
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const server=createServer(async(req,res)=>{try {const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname); let data=await readFile(root+(path==='/'?'/index.html':path));if(path==='/app.js')data=data.toString()+'\nwindow.peelDebug={models,state,scene};';res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.woff2')?'font/woff2':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(8765,'127.0.0.1',r));
const browser=spawn(process.env.BROWSER_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',['--headless','--no-first-run','--no-default-browser-check','--disable-background-networking','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9225','--user-data-dir=/private/tmp/oxide-qa-browser','about:blank'],{stdio:'ignore'});
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




 assert(await run("!document.getElementById('sample-model')"));
 assert(await run("document.getElementById('horse-shape').textContent.includes('Horse')"));
 await run("document.getElementById('horse-shape').click()");
 for(let i=0;i<150;i++){await delay(200);if(await run("peelDebug.models.sampleKey==='horse'"))break;}
 assert.equal(await run('peelDebug.models.sampleKey'),'horse');
 assert(await run("document.getElementById('horse-shape').getAttribute('aria-pressed')==='true'"));
 assert(await run("document.querySelector('.model-panel').hidden"));
 for(const sample of ['duck','glasses']){
   await run("(()=>{const original=Math.random;Math.random=()=>.99;document.getElementById('random-shape').click();Math.random=original;})()");
   for(let i=0;i<150;i++){await delay(200);if(await run(`peelDebug.models.sampleKey==='${sample}'`))break;}
   assert.equal(await run('peelDebug.models.sampleKey'),sample);
   assert(await run('!!peelDebug.models.peelingStats'));
   assert(await run("document.getElementById('horse-shape').getAttribute('aria-pressed')==='false'"));
   assert(await run("document.querySelector('.model-panel').hidden"));
 }

 // A local upload reveals the panel; built-in and random samples do not.
 await run(`(async()=>{const blob=await fetch('/samples/horse.glb').then(r=>r.blob());const transfer=new DataTransfer();transfer.items.add(new File([blob],'upload.glb'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer}));})()`);
 for(let i=0;i<150;i++){await delay(200);if(await run("!document.querySelector('.model-panel').hidden"))break;}
 assert(await run("!document.querySelector('.model-panel').hidden"));
 assert.equal(await run("document.getElementById('model-name').textContent"),'upload.glb');
 await run("document.getElementById('paint-toggle').click();document.getElementById('model-paint-mode').value='original';document.getElementById('model-paint-mode').dispatchEvent(new Event('change'))");
 assert.equal(await run('peelDebug.models.peelingStats'),null);
 await run("document.getElementById('picker-paint-color').value='#176bfa';document.getElementById('picker-paint-color').dispatchEvent(new Event('input'))");
 assert.equal(await run("document.getElementById('model-paint-mode').value"),'paint');
 assert(await run(`(()=>{const m=peelDebug.scene.getObjectByName('Imported coating').material[0];const shader={uniforms:{},vertexShader:'',fragmentShader:''};m.onBeforeCompile(shader);return !m.map&&!m.vertexColors&&shader.uniforms.uPink.value.getHexString()==='176bfa';})()`));
 await run("document.getElementById('age').value=65;document.getElementById('age').dispatchEvent(new Event('input'))");
 for(let i=0;i<50;i++){await delay(200);if(await run('peelDebug.models.peelingStats.detached>0'))break;}
 assert(await run('peelDebug.models.peelingStats.detached>0'));
 await run("document.querySelector('[data-metal=copper]').click()");
 assert.equal(await run('peelDebug.models.peelingStats.detached'),0);
 assert.equal(await run('peelDebug.models.peelingStats.total'),0);
 await run(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['broken'],'broken.glb'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer}));})()`);
 for(let i=0;i<50;i++){await delay(100);if(await run("document.getElementById('model-status').textContent.startsWith('Could not import')"))break;}
 assert(await run("document.getElementById('model-status').textContent.startsWith('Could not import')"));
 assert.equal(await run("document.getElementById('model-name').textContent"),'upload.glb');
 assert.equal(errors.length,1,'Only the intentional invalid-file error is expected');errors.length=0;
 await run("document.getElementById('horse-shape').click();document.querySelector('[data-shape=cube]').click()");
 await delay(1000);assert.equal(await run('peelDebug.models.active'),false);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(400);
 assert(await run('document.documentElement.scrollWidth<=innerWidth'),'Mobile overflow');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS: horse, random duck/glasses, GLB upload and invalid-file recovery, paint/original materials, peeling/reset, canceled loads and mobile layout.');

} finally {ws?.close();browser.kill();server.close();}

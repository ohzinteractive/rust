import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const server=createServer(async(req,res)=>{try {const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname); let data=await readFile(root+(path==='/'?'/index.html':path));if(path==='/shape-gate.js')data=data.toString()+'\nwindow.gateDebug={gate,scene,camera,renderer};';if(path==='/app.js')data=data.toString()+'\nwindow.readGateLanding=()=>shapeGate?.group.parent===oasis.group?{height:shapeGate.group.position.y,landing:gateLanding,bank:gateBank}:null;window.renderGateBank=renderScene;renderScene=()=>{};';res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.woff2')?'font/woff2':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(8767,'127.0.0.1',r));
const browser=spawn(process.env.BROWSER_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',['--headless','--no-first-run','--no-default-browser-check','--disable-background-networking','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9227','--user-data-dir=/private/tmp/oxide-gate-qa-browser','about:blank'],{stdio:'ignore'});
let ws;let errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let tabs;for(let i=0;i<50;i++){try{tabs=await(await fetch('http://127.0.0.1:9227/json')).json();break;}catch{await delay(200);}}
 assert(tabs,'Browser failed to start');
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();errors=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);});
 const call=(method,params={})=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
 const run=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
 await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Runtime.enable');await call('Log.enable');await call('Page.enable');await call('Page.bringToFront');await call('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:process.argv.includes('--kelp-drop-only')?'no-preference':'reduce'}]});await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.drawCount=0;for(const name of ['drawElements','drawArrays']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.drawCount++;return original.apply(this,args);};}`});await call('Page.navigate',{url:'http://127.0.0.1:8767/shape-gate.html'});

 for(let i=0;i<150;i++){
  await delay(200);
  if(await run("!!window.gateDebug&&!!gateDebug.scene.getObjectByName('Shape Gate wheel')"))break;
 }
 assert(await run("!!window.gateDebug"));
 await run("gateDebug.renderer.setAnimationLoop(null);gateDebug.gate.setCycle(false);document.getElementById('cycle').checked=false;void 0");
 const dimensions=await run(`import('./shape-gate-weathering.js').then(({tileDisplacementGLSL})=>{
  const gl=document.createElement('canvas').getContext('webgl2');
  const createShader=(type,source)=>{
   const shader=gl.createShader(type);
   gl.shaderSource(shader,source);gl.compileShader(shader);
   if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
   return shader;
  };
  const program=gl.createProgram();
  gl.attachShader(program,createShader(gl.VERTEX_SHADER,'#version 300 es\\n#define ROOT_HEAVE\\n#define attribute in\\nuniform float rootHeave;in vec3 position;out vec3 lifted;'+tileDisplacementGLSL+'void main(){lifted=liftMarbleTile(position);gl_Position=vec4(lifted,1.0);}'));
  gl.attachShader(program,createShader(gl.FRAGMENT_SHADER,'#version 300 es\\nprecision highp float;out vec4 color;void main(){color=vec4(1.0);}'));
  gl.transformFeedbackVaryings(program,['lifted'],gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.vertexAttrib3f(gl.getAttribLocation(program,'tilePressure'),.16,.068,.058);
  gl.uniform1f(gl.getUniformLocation(program,'stoneAge'),1);
  gl.vertexAttrib3f(gl.getAttribLocation(program,'tileSupport'),-.4,-.4,-.1);
  const vertices=gl.createBuffer(),output=gl.createBuffer(),position=gl.getAttribLocation(program,'position');
  gl.bindBuffer(gl.ARRAY_BUFFER,vertices);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-.4,-.4,0,.4,-.4,0,-.4,.4,0,-.4,-.4,-.1]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,48,gl.DYNAMIC_READ);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
  gl.enable(gl.RASTERIZER_DISCARD);
  return [0,13].map(heave=>{
   gl.uniform1f(gl.getUniformLocation(program,'rootHeave'),heave);
   gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,4);gl.endTransformFeedback();
   const result=new Float32Array(12);
   gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,result);
   const [x,y,z]=result.slice(9);
   const wave=.5+.5*Math.sin(y*47+x*7+Math.sin(x*4)*2.3);
   const sand=.16-.087-(.006+.022*wave**3)+x*.068+y*.058;
   return {contact:z-sand,size:[3,6,9].map(i=>Math.hypot(result[i]-result[0],result[i+1]-result[1],result[i+2]-result[2])),rise:result[5]-result[2]};
  });
 })`);
 assert(Math.abs(dimensions[1].contact+.008)<1e-6,'The tilted slab rests in the sand at its low corner');
 assert(dimensions[1].rise>dimensions[0].rise+.3,'The palm-facing edge rises substantially');
 for(const [i,base] of dimensions[0].size.entries()){
  assert(Math.abs(base-dimensions[1].size[i])<1e-6,'Rigid tilt preserves slab width, length and thickness');
 }
 for(const age of [0,.5,1]){
  const state=await run(`(()=>{const {gate,scene,renderer,camera}=gateDebug;gate.setWeathering(${age});gate.advance(0,camera,0);renderer.shadowMap.needsUpdate=true;gate.captureGoldReflection();renderer.render(scene,camera);const tiles=scene.getObjectByName('Polished marble tiles');return {age:gate.weathering,vertices:tiles.geometry.attributes.position.count,sand:scene.getObjectByName('Sand filling lifted marble gaps').geometry.attributes.position.count,flowers:scene.getObjectByName('Wildflowers in marble cracks').visible,flowerVertices:scene.getObjectByName('Pink and white crack flowers').geometry.attributes.position.count,pressures:Array.from(tiles.geometry.attributes.tilePressure.array).some(x=>x>.05),ferns:scene.getObjectByName('Ferns growing in marble joints').visible,aluminum:scene.getObjectByName('Brush seal').children[0].children[0].material.name,palms:scene.getObjectByName('Palms reclaiming the checkerboard').children.map(x=>x.children.find(c=>c.children.some(p=>p.name==='Feather palm')).scale.y)};})()`);
  assert.equal(state.age,age);assert.equal(state.ferns,age>0);assert.equal(state.aluminum,'Weathering aluminum brush rails');assert(state.sand>10000);assert.equal(state.flowers,age>.025);assert(state.flowerVertices>10000);assert(state.pressures);assert(state.vertices>10000);assert.equal(state.palms.length,4);
  if(age===0)assert(state.palms.every(x=>x<.1));
  if(age===1)assert(state.palms.every(x=>x>.95));
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(`/private/tmp/gate-weathering-${age}.png`,Buffer.from(shot.result.data,'base64'));
 }
 const palmGrowth=await run(`(()=>{
   const {gate,camera,scene}=gateDebug;
   const palm=scene.getObjectByName('Feather palm').parent;
   const heart=palm.getObjectByName('Palm growing heart');
   const before=heart.getWorldPosition(heart.position.clone()).y;
   const scale=palm.scale.y;
   gate.advance(30,camera,1);
   return {before,after:heart.getWorldPosition(heart.position.clone()).y,scale,afterScale:palm.scale.y,age:gate.weathering};
 })()`);
 assert.equal(palmGrowth.age,1);assert(palmGrowth.after>palmGrowth.before);assert.equal(palmGrowth.afterScale,palmGrowth.scale);
 await run("gateDebug.gate.resizeFloor(2);gateDebug.renderer.render(gateDebug.scene,gateDebug.camera);void 0");
 assert.equal(errors.length,0,JSON.stringify(errors));
 await call('Emulation.setDeviceMetricsOverride',{width:1050,height:760,deviceScaleFactor:1,mobile:false});
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await call('Page.navigate',{url:'http://127.0.0.1:8767/?scene=oasis&object=gate&view=shape-gate'});
 let landing,settled;
 for(let i=0;i<80;i++){
  const placement=await run("window.readGateLanding?.()");
  if(placement?.landing)landing=placement.landing;
  if(placement&&!placement.landing){settled=placement;break;}
  await delay(200);
 }
 assert(landing&&settled,'The waterfront platform falls and comes to rest');
 assert(landing.start-settled.bank.clearHeight>.1,'The drop is visible');
 assert(Math.abs(settled.height-settled.bank.clearHeight)<1e-6,'The fresh platform settles above the sand');
 await run("document.querySelector('[data-gate-time=\"600\"]').click();document.getElementById('oasis-settings-close').click();window.renderGateBank()");
 const oasisShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/gate-oasis-ferns.png',Buffer.from(oasisShot.result.data,'base64'));
 const timeline=await run(`(()=>{
  const slider=document.getElementById('gate-timeline');
  const play=document.getElementById('gate-timeline-play');
  document.querySelector('[data-gate-time="600"]').click();
  const end=slider.valueAsNumber;
  const buried=readGateLanding().height;
  document.querySelector('[data-gate-time="0"]').click();
  const clear=readGateLanding().height;
  slider.value=240;
  slider.dispatchEvent(new Event('input',{bubbles:true}));
  const paused=play.getAttribute('aria-label');
  document.getElementById('gate-timeline-speed').value='20';
  play.click();
  return {visible:!!slider.getClientRects().length,end,seek:slider.valueAsNumber,paused,buried,clear};
 })()`);
 const {buried,clear,...controls}=timeline;
 assert.deepEqual(controls,{visible:true,end:600,seek:240,paused:'Play growth timeline'});
 assert(clear-buried>.15,'Sand encroaches as the platform settles further');
 assert(Math.abs(clear-settled.bank.clearHeight)<1e-6,'Scrubbing back clears the fresh checkers again');
 await delay(500);
 assert(await run("document.getElementById('gate-timeline').valueAsNumber>245"),'20× playback advances multiple scene seconds');
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS: marble shaders and shadows render at three ages; four palms and crack flowers grow, sand fills the lifted tiles, floor expands, ferns unfurl, aluminum weathers and the oasis platform settles, no WebGL errors.');
} catch(error) {if(errors.length)console.error(JSON.stringify(errors));throw error;} finally {ws?.close();browser.kill();server.close();}

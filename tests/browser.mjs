// Run with Node 24+: BROWSER_PATH=/path/to/chromium node tests/browser.mjs
import {createServer} from 'node:http';
import {readFile, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {checkMazeFeathers} from './maze-feathers-browser.mjs';
import {checkMazeMaps,checkCourtyardShortcut} from './maze-maps-browser.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const server=createServer(async(req,res)=>{try {const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname); let data=await readFile(root+(path==='/'?'/index.html':path));if(path==='/app.js')data=data.toString()+'\nwindow.peelDebug={models,state,scene,feathers,core,surface,renderer,camera,controls,featherRenderer,mazeNavigation,get idle(){return !renderDirty}};';res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.woff2')?'font/woff2':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}});
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
 await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Runtime.enable');await call('Log.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1050,height:850,deviceScaleFactor:1,mobile:false});await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.drawCount=0;for(const name of ['drawElements','drawArrays']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){window.drawCount++;return original.apply(this,args);};}`});await call('Page.navigate',{url:'http://127.0.0.1:8765/'});
 let loaded=false;for(let i=0;i<100;i++){await delay(200);loaded=await run("document.readyState==='complete'&&!document.getElementById('loading')");if(loaded||errors.length)break;}
 assert.equal(errors.length,0,JSON.stringify(errors));assert(loaded,'Scene did not finish loading');
 assert(await run("document.getElementById('webgl-error').hidden"));
 if(process.argv.includes('--ritual-only')){
   await checkCourtyardShortcut({run,assert});
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await checkCourtyardShortcut({run,assert});
   assert.equal(errors.length,0,JSON.stringify(errors));
   console.log('PASS: courtyard shortcut, arrival reveal, restart and exit on both maps, desktop and mobile.');
 }else if(process.argv.includes('--maps-only')){
   await checkMazeMaps({run,call,assert});
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await checkMazeMaps({run,call,assert});
   assert.equal(errors.length,0,JSON.stringify(errors));
   console.log('PASS: desktop and mobile map switching, room disposal, geometry, and navigation.');
 }else if(process.argv.includes('--galaxy-only')){
   const numerics=await run("import('/tests/galaxy-gpu.js').then(module=>module.checkMeteorNumerics(peelDebug.renderer))");
   assert(numerics.invalid===0&&numerics.black===0,'Sky must remain finite and visible throughout the meteor lifecycle: '+JSON.stringify(numerics));
   console.log('Meteor HDR sweep',JSON.stringify(numerics));
   const seams=await run("import('/tests/galaxy-gpu.js').then(module=>module.checkGalaxySeams(peelDebug.renderer))");
   assert(seams.exteriorAlpha.every(alpha=>alpha===255),'Open views must have a sky backdrop: '+JSON.stringify(seams));
   assert(seams.orbitContrast>25&&seams.orbitPlanetContrast>25,'Orbit must move the celestial background while keeping the planet beneath the maze: '+JSON.stringify(seams));
   assert(seams.planetContrast>25,'The large planet must be visible: '+JSON.stringify(seams));
   assert(seams.prematureTailDifference<=2,'A meteor must not have a trail before traveling that distance: '+JSON.stringify(seams));
   assert(seams.slowerArrivalContrast>15,'Meteors must take longer to reach their previous positions: '+JSON.stringify(seams));
   assert(seams.belowContrast>5,'Meteors must also pass below the maze: '+JSON.stringify(seams));
   assert(seams.parallaxContrast>5&&seams.farContrast>5,'Close flybys must have parallax and distant meteors must remain visible: '+JSON.stringify(seams));
   assert(seams.entryContrasts.every(contrast=>contrast>15),'Every entry path must remain visible on the near hemisphere: '+JSON.stringify(seams));
   assert(seams.impactContrast>15&&seams.nearSideMargin>0&&seams.frontEntryContrast>15,'Entry must be visible in front of the near hemisphere: '+JSON.stringify(seams));
   assert(seams.vacuumTailDifference<=2&&seams.quietBrightness<60,'Space approaches must be faint and have no luminous tails: '+JSON.stringify(seams));
   assert(seams.atmosphericWakeContrast>5&&seams.afterglowContrast>5,'Atmospheric entry must leave a wake and lingering train: '+JSON.stringify(seams));
   assert(seams.meteorContrast>15,'Meteors must move and fade over time: '+JSON.stringify(seams));
   assert(seams.moonContrast>25,'The moon must be visible against the sky: '+JSON.stringify(seams));
   assert(seams.maxDifference<=2,'Galaxy must be continuous across longitude wrapping and poles: '+JSON.stringify(seams));
   assert.equal(errors.length,0,JSON.stringify(errors));
   console.log('PASS: galaxy seam GPU checks',JSON.stringify(seams));
 }else if(process.argv.includes('--maze-only')){
   await checkMazeFeathers({run,call,delay,assert});
   await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await checkMazeFeathers({run,call,delay,assert,mobile:true});
   assert.equal(errors.length,0,JSON.stringify(errors));
   console.log('PASS: desktop and mobile maze flight, return, settings, navigation and rendering.');
 }else{
 const idleDraws=await run('window.drawCount');await delay(500);
 assert.equal(await run('window.drawCount'),idleDraws,'Paused scene should not draw');
 await run("document.querySelector('[data-shape=maze]').click()");
 assert(await run("peelDebug.state.shape==='maze'&&document.querySelector('[data-shape=maze]').getAttribute('aria-pressed')==='true'&&peelDebug.surface.mesh.visible&&peelDebug.surface.flakes.length>0"));
 await delay(500);
 const mazeShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-maze.png',Buffer.from(mazeShot.result.data,'base64'));
 await run("window.mazeOverviewCamera={position:peelDebug.camera.position.toArray(),quaternion:peelDebug.camera.quaternion.toArray(),target:peelDebug.controls.target.toArray(),near:peelDebug.camera.near,fov:peelDebug.camera.fov};document.getElementById('maze-enter').click()");
 assert(await run("peelDebug.mazeNavigation.active&&!peelDebug.controls.enabled&&peelDebug.camera.near===.001&&peelDebug.camera.fov===75&&peelDebug.scene.getObjectByName('Maze walking floor').visible&&document.getElementById('maze-fpv').hidden===false"));
 const mazeStart=await run('peelDebug.mazeNavigation.walker.position.toArray()');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
 await run('for(let i=0;i<30;i++)peelDebug.mazeNavigation.update(1/60)');
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
 assert(await run(`Math.hypot(peelDebug.mazeNavigation.walker.position.x-${mazeStart[0]},peelDebug.mazeNavigation.walker.position.z-${mazeStart[2]})>.03`),'W walks along the entrance corridor');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'d',code:'KeyD',windowsVirtualKeyCode:68});
 await run('for(let i=0;i<180;i++)peelDebug.mazeNavigation.update(1/60)');
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'d',code:'KeyD',windowsVirtualKeyCode:68});
 assert(await run('peelDebug.mazeNavigation.walker.canStand(peelDebug.mazeNavigation.walker.position.x,peelDebug.mazeNavigation.walker.position.z)'),'Strafing must retain clearance from walls');
 await run("document.querySelector('[data-fpv-restart]').click();window.mazeLook=peelDebug.camera.quaternion.toArray()");
 await call('Input.dispatchMouseEvent',{type:'mousePressed',x:500,y:350,button:'left',clickCount:1});
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:560,y:375,button:'left',buttons:1});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:560,y:375,button:'left',clickCount:1});
 assert(await run('JSON.stringify(mazeLook)!==JSON.stringify(peelDebug.camera.quaternion.toArray())'),'Dragging must look around');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
 await run("window.dispatchEvent(new Event('blur'));window.mazeBlur=peelDebug.mazeNavigation.walker.position.toArray();for(let i=0;i<30;i++)peelDebug.mazeNavigation.update(1/60)");
 assert(await run('JSON.stringify(mazeBlur)===JSON.stringify(peelDebug.mazeNavigation.walker.position.toArray())'),'Losing focus must clear held movement');
 await run("document.querySelector('[data-fpv-restart]').click()");await delay(200);
 const fpvShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-maze-fpv.png',Buffer.from(fpvShot.result.data,'base64'));
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert(await run("!peelDebug.mazeNavigation.active&&peelDebug.controls.enabled&&!peelDebug.scene.getObjectByName('Maze walking floor').visible&&document.getElementById('maze-fpv').hidden"));
 assert(await run('JSON.stringify(mazeOverviewCamera)===JSON.stringify({position:peelDebug.camera.position.toArray(),quaternion:peelDebug.camera.quaternion.toArray(),target:peelDebug.controls.target.toArray(),near:peelDebug.camera.near,fov:peelDebug.camera.fov})'),'Exiting restores the overview camera');
 await run("document.getElementById('layers-view').click();peelDebug.state.exploded=.6;document.getElementById('age-play').click();document.getElementById('rotate').click();document.getElementById('maze-enter').click()");
 assert(await run('!peelDebug.state.playing&&peelDebug.state.exploded===0&&!peelDebug.controls.autoRotate'),'Navigation pauses aging, layers and orbit');
 assert(await run("(()=>{document.querySelector('[data-fpv-exit]').click();return peelDebug.state.playing&&peelDebug.state.exploded===.6&&peelDebug.controls.autoRotate&&document.getElementById('layers-view').getAttribute('aria-pressed')==='true'})()"),'Leaving navigation restores playback and layer settings');
 await run("document.getElementById('age-play').click();document.getElementById('rotate').click()");
 await run("document.getElementById('maze-enter').click();document.querySelector('[data-shape=pill]').click()");
 assert(await run("!peelDebug.mazeNavigation.active&&document.getElementById('maze-enter').hidden&&peelDebug.controls.enabled"),'Changing shape must leave navigation');
 await run("document.querySelector('[data-shape=cube]').click()");
 await checkMazeFeathers({run,call,delay,assert});
 const transparency=await run("import('/tests/transparency-gpu.js').then(module=>module.checkTransparency(peelDebug.renderer))");
 console.log('Transparency GPU',JSON.stringify(transparency));
 assert.equal(transparency.mode,'weighted','Browser must exercise weighted OIT');
 assert.equal(transparency.opaqueOrderDifference,0);
 assert(transparency.opaquePixel[0]>200&&transparency.opaquePixel[2]<5,'Opaque near filaments must hide far filaments');
 assert(transparency.transparentOrderDifference<=2,'Translucent intersections must not depend on draw order');
 assert(transparency.transparentPixel[0]>10&&transparency.transparentPixel[2]>10,'Both translucent depth layers must contribute');
 assert(transparency.occludedPixel.slice(0,3).every(value=>value<2),'Opaque geometry must occlude translucent feathers');
 assert(transparency.emptyTransparencyDifference<=1,'An empty OIT pass must preserve scene color and canvas alpha');
 assert(transparency.stateRestored,'Transparency must restore renderer state');
 assert(transparency.viewportRestored,'Transparency must restore the active render-target viewport');
 assert.equal(transparency.fallbackMode,'alpha-hash');
 assert(transparency.fallbackDepth,'Devices without floating-point targets must use depth-writing hashed transparency');
 assert.equal(errors.length,0,JSON.stringify(errors));
 const contacts=await run("import('/tests/transparency-gpu.js').then(module=>module.checkFeatherContactShadows(peelDebug.renderer))");
 console.log('Feather contact shadows GPU',JSON.stringify(contacts));
 assert(contacts.near<contacts.fading&&contacts.fading<contacts.unshadowed,'Nearby feather shadows must fade smoothly with separation');
 assert(Math.abs(contacts.far-contacts.unshadowed)<=1,'Distant feathers must not cast contact shadows through maze walls');
 assert(Math.abs(contacts.outsideFocus-contacts.unshadowed)<=1&&contacts.insideFocus<contacts.unshadowed,'Tracked shadows must only shade the active travel region');
 const ambientMaze=await run("import('/tests/transparency-gpu.js').then(module=>module.checkAmbientMazeShadows(peelDebug.renderer))");
 console.log('Ambient maze shadows GPU',JSON.stringify(ambientMaze));
 assert(ambientMaze.darkenedPixels>100&&ambientMaze.maxDifference>12,'Feather shadows must remain clearly visible on ambient-lit maze walls');
 assert.equal(ambientMaze.projection,1);
 const scattering=await run("import('/tests/transparency-gpu.js').then(module=>module.checkSkinScattering(peelDebug.renderer))");
 console.log('Skin scattering GPU',JSON.stringify(scattering));
 assert(scattering.full[0]>scattering.half[0]&&scattering.half[0]>scattering.off[0],'Scattering strength must control light transmitted from behind');
 assert(scattering.full[0]>scattering.full[1]&&scattering.full[1]>scattering.full[2],'Back-scattered light should have a warm skin tint');
 assert(scattering.unlit.slice(0,3).every(value=>value===0),'Scattering must not glow without incident light');
 assert(scattering.grazingOn[0]>scattering.grazingOff[0]&&scattering.opaque,'Wrapped lighting must preserve opaque skin');
 assert.deepEqual(scattering.clamped,scattering.full,'Scattering must stay bounded at 100%');
 assert.equal(errors.length,0,JSON.stringify(errors));
 const shadowCheck=await run("import('/tests/transparency-gpu.js').then(module=>module.checkFeatherShadows(peelDebug.renderer))");
 console.log('Feather shadows GPU',JSON.stringify(shadowCheck));
 assert(shadowCheck.darkenedPixels>10&&shadowCheck.strong<shadowCheck.soft&&shadowCheck.soft<shadowCheck.off,'Shadow strength must control visible occlusion');
 assert.equal(shadowCheck.clamped,shadowCheck.full,'Shadows must stay bounded at 100%');
 assert(shadowCheck.cachedDuringOrbit&&shadowCheck.breezeUpdatesShadow,'Shadows must cache while still and update with the breeze');
 assert(shadowCheck.partialReady&&shadowCheck.hiddenClearsShadow,'Shadow maps must handle translucent and hidden feathers');
 const plumeShadows=await run("import('/tests/transparency-gpu.js').then(module=>module.checkFeatherShadows(peelDebug.renderer,'plume'))");
 console.log('Original plume shadows GPU',JSON.stringify(plumeShadows));
 assert(plumeShadows.darkenedPixels>10&&plumeShadows.strong<plumeShadows.soft&&plumeShadows.soft<plumeShadows.off,'Original filament geometry must cast visible shadows with adjustable strength');
 assert.equal(plumeShadows.clamped,plumeShadows.full);
 assert(plumeShadows.cachedDuringOrbit&&plumeShadows.breezeUpdatesShadow&&plumeShadows.partialReady&&plumeShadows.hiddenClearsShadow,'Plume shadows must follow wind, opacity and camera caching');
 assert.equal(errors.length,0,JSON.stringify(errors));

 await run("document.getElementById('feather-material').click()");
 assert.equal(await run('peelDebug.state.material'),'feathers');
 assert(await run("!document.getElementById('feather-controls').hidden&&document.getElementById('exposure-controls').hidden"));
 assert(await run('peelDebug.feathers.stats.count>100&&!peelDebug.surface.mesh.visible'));
 assert(await run('peelDebug.feathers.group.children.every(batch=>!batch.material.transparent&&batch.material.depthWrite)'));
 assert.equal(await run('peelDebug.core.material.name'),'Feather skin');
 for(const key of ['opacity','shadow','subsurface','branchRandomness'])assert.equal(await run("Number(document.getElementById('feather-"+key+"').max)"),100);
 assert(await run("peelDebug.state.featherSettings.style==='plume'&&document.getElementById('feather-style-plume').checked&&peelDebug.state.featherDensity===4&&peelDebug.state.featherSettings.length===2&&peelDebug.state.featherSettings.width===1.9&&peelDebug.state.featherSettings.detail===1&&peelDebug.state.featherSettings.angle===46&&peelDebug.state.featherSettings.shadow===.84"));
 // Edit the shared grammar at a sparse density so the structure is easy to inspect.
 await run("document.getElementById('feather-lsystem-settings').open=true;document.getElementById('feather-density').value=1;document.getElementById('feather-density').dispatchEvent(new Event('input'));window.grammarRoots=peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array));window.grammarVertices=peelDebug.feathers.group.children[0].geometry.attributes.position.count");
 for(const [key,value] of [['generations',3],['branchLength',2],['branchRandomness',0]])await run("document.getElementById('feather-"+key+"').value="+value+";document.getElementById('feather-"+key+"').dispatchEvent(new Event('input'))");
 await run("document.getElementById('feather-axiom').value='F';document.getElementById('feather-ruleF').value='F[+F]F[-F]F'");
 assert.equal(await run('peelDebug.state.featherSettings.axiom'),'X','Rule drafts must wait for Apply');
 await run("document.getElementById('feather-grammar-apply').click();window.appliedGrammarGeometry=peelDebug.feathers.group.children[0].geometry");
 assert(await run("peelDebug.state.featherSettings.axiom==='F'&&peelDebug.state.featherSettings.ruleF==='F[+F]F[-F]F'&&peelDebug.state.featherSettings.generations===3&&peelDebug.state.featherSettings.branchLength===2&&peelDebug.state.featherSettings.branchRandomness===0&&document.getElementById('feather-grammar-status').textContent==='Grammar applied.'"));
 assert(await run("JSON.stringify(grammarRoots)===JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))&&peelDebug.feathers.group.children[0].geometry.attributes.position.count>grammarVertices"));
 await run("document.getElementById('feather-ruleX').value='F[+X';document.getElementById('feather-grammar-apply').click()");
 assert(await run("peelDebug.state.featherSettings.ruleX==='F[+X][-X]'&&peelDebug.feathers.group.children[0].geometry===appliedGrammarGeometry&&document.getElementById('feather-ruleX').getAttribute('aria-invalid')==='true'&&document.getElementById('feather-grammar-status').textContent.includes('closing')"));
 await run("document.getElementById('feather-ruleX').value='FQ';document.getElementById('feather-ruleX').dispatchEvent(new Event('input'));document.getElementById('feather-grammar-apply').click()");
 assert(await run("document.getElementById('feather-grammar-status').textContent.includes('Use only')&&peelDebug.feathers.group.children[0].geometry===appliedGrammarGeometry"));
 await run("document.getElementById('feather-ruleX').value='F[+X][-X]';document.getElementById('feather-ruleF').value='';document.getElementById('feather-ruleX').dispatchEvent(new Event('input'));document.getElementById('feather-ruleF').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 assert.equal(await run('peelDebug.state.featherSettings.ruleF'),'','Empty productions must be supported');
 await run("document.getElementById('feather-grammar-reset').click()");
 assert(await run("peelDebug.state.featherDensity===1&&peelDebug.state.featherSettings.generations===2&&peelDebug.state.featherSettings.axiom==='X'&&peelDebug.state.featherSettings.ruleF==='FF'&&peelDebug.state.featherSettings.branchLength===1&&peelDebug.state.featherSettings.branchRandomness===1"),'Reset grammar must retain the mesh density');
 await run("document.getElementById('feather-preset-1').click();document.getElementById('feather-lsystem-settings').open=false");
 assert(await run("peelDebug.state.featherSettings.generations===2&&peelDebug.state.featherSettings.axiom==='X'&&peelDebug.state.featherSettings.ruleX==='F[+X][-X]'&&peelDebug.state.featherSettings.ruleF==='FF'&&peelDebug.state.featherSettings.branchLength===1&&peelDebug.state.featherSettings.branchRandomness===1&&document.getElementById('feather-ruleF').value==='FF'&&peelDebug.state.featherDensity===4"));
 await run("window.restFlightRoots=peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array));document.getElementById('feather-settings-close').click()");
 const flightClick=await run(`(async()=>{
   const THREE=await import('/vendor/three.module.js'),ray=new THREE.Raycaster(),v=new THREE.Vector3(),q=new THREE.Quaternion(),root=new THREE.Vector3();
   const rect=document.getElementById('scene').getBoundingClientRect();peelDebug.feathers.group.updateWorldMatrix(true,true);
   for(const batch of peelDebug.feathers.group.children){
     const a=batch.geometry.attributes;
     for(let i=0;i<batch.geometry.instanceCount;i++){
       q.fromBufferAttribute(a.featherRotation,i);root.fromBufferAttribute(a.featherPosition,i);
       v.fromBufferAttribute(a.position,a.position.count-1).multiply(new THREE.Vector3(a.featherScale.getX(i)*peelDebug.state.featherSettings.width,a.featherScale.getX(i)*peelDebug.state.featherSettings.length,a.featherScale.getX(i)*peelDebug.state.featherSettings.width)).applyQuaternion(q).add(root).applyMatrix4(batch.matrixWorld).project(peelDebug.camera);
       const x=rect.left+(v.x+1)*rect.width/2,y=rect.top+(1-v.y)*rect.height/2;
       if(x<10||y<110||x>rect.right-10||y>rect.bottom-180||document.elementFromPoint(x,y)?.id!=='scene')continue;
       ray.setFromCamera(new THREE.Vector2(v.x,v.y),peelDebug.camera);
       if(peelDebug.feathers.pick(ray)!==null)return {x,y};
     }
   }
   return null;
 })()`);
 assert(flightClick,'A visible feather must be pickable');
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...flightClick});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...flightClick});
 assert.equal(await run('peelDebug.feathers.flyingCount'),await run('peelDebug.feathers.stats.count'),'A real canvas click must launch the entire coat');
 let flightMoved=false;
 for(let i=0;i<75;i++){
   await delay(200);
   flightMoved=await run("JSON.stringify(restFlightRoots)!==JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))");
   if(flightMoved)break;
 }
 assert.equal(errors.length,0,JSON.stringify(errors));
 assert(flightMoved,'A detached feather must visibly move after a canvas click');
 const spread=await run(`(async()=>{
   const THREE=await import('/vendor/three.module.js');
   for(let i=0;i<1080;i++)peelDebug.feathers.advance(1/60,peelDebug.camera,peelDebug.controls.target);
   const points=[];
   for(const batch of peelDebug.feathers.group.children){
     const p=batch.geometry.attributes.featherPosition;
     for(let i=0;i<p.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(batch.matrixWorld).project(peelDebug.camera));
   }
   peelDebug.featherRenderer.render(peelDebug.scene,peelDebug.camera);
   return {x:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),y:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)),visible:points.filter(p=>Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>0&&p.z<1).length/Math.max(1,points.length)};
 })()`);
 console.log('Flight viewport coverage',JSON.stringify(spread));
 assert(spread.x>1.2&&spread.y>1&&spread.visible>.6,'The flock must spread across the visible scene');
 const flyingShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-flying-feather.png',Buffer.from(flyingShot.result.data,'base64'));
 await run("document.getElementById('feather-settings-toggle').click();window.beforeReturnRoots=peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array));document.getElementById('feather-return').click();window.returnDidNotSnap=JSON.stringify(beforeReturnRoots)===JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))");
 assert.equal(await run('peelDebug.feathers.returningCount'),await run('peelDebug.feathers.flyingCount'));
 assert(await run('window.returnDidNotSnap'),'Return must preserve the current pose rather than snap');
 await run("for(let i=0;i<2400&&peelDebug.feathers.flyingCount;i++)peelDebug.feathers.advance(1/60,peelDebug.camera,peelDebug.controls.target)");
 assert.equal(await run('peelDebug.feathers.flyingCount'),0,'The entire coat must settle back onto the mesh');
 await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 assert(await run("JSON.stringify(restFlightRoots)===JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))"),'Return feathers must restore the same roots');
 await run("document.getElementById('feather-fly-all').click()");
 assert.equal(await run('peelDebug.feathers.flyingCount'),await run('peelDebug.feathers.stats.count'),'Fly all must launch every feather');
 await run("document.getElementById('feather-return').click()");
 assert.equal(await run('peelDebug.feathers.returningCount'),await run('peelDebug.feathers.flyingCount'));
 await run("for(let i=0;i<1800&&peelDebug.feathers.flyingCount;i++)peelDebug.feathers.advance(1/60,peelDebug.camera,peelDebug.controls.target)");
 assert.equal(await run('peelDebug.feathers.flyingCount'),0);
 await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await run("document.getElementById('feather-width').value=.5;document.getElementById('feather-width').dispatchEvent(new Event('input'));document.getElementById('feather-density').value=2;document.getElementById('feather-density').dispatchEvent(new Event('input'));document.getElementById('feather-preset-1').click()");
 assert(await run("peelDebug.state.featherDensity===4&&peelDebug.state.featherSettings.width===1.9&&peelDebug.state.featherSettings.style==='plume'"),'Preset 1 must restore the saved feather values');
 await run("document.getElementById('feather-settings-close').click()");
 await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...flightClick});
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:flightClick.x+24,y:flightClick.y});
 await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:flightClick.x+24,y:flightClick.y});
 assert.equal(await run('peelDebug.feathers.flyingCount'),0,'Dragging to orbit must not detach a feather');
 // Flush drag inertia so the later flight-idle check measures a still camera.
 await run("peelDebug.controls.enableDamping=false;peelDebug.controls.update();document.getElementById('reset-view').click();peelDebug.controls.enableDamping=true;document.getElementById('feather-settings-toggle').click()");
 await run("document.getElementById('feather-style-layered').click()");
 await run("window.styleRoots=peelDebug.feathers.group.children.filter(batch=>batch.isLineSegments).map(batch=>Array.from(batch.geometry.attributes.featherPosition.array));window.styleCount=peelDebug.feathers.stats.count;document.getElementById('feather-style-plume').click()");
 assert(await run("peelDebug.state.featherSettings.style==='plume'&&peelDebug.feathers.group.children.every(batch=>batch.isLineSegments&&batch.customDepthMaterial)&&peelDebug.feathers.stats.count===styleCount"));
 assert(await run("JSON.stringify(styleRoots)===JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))"));
 await run("document.getElementById('feather-opacity').value=45;document.getElementById('feather-opacity').dispatchEvent(new Event('input'))");
 assert(await run('peelDebug.feathers.translucent&&peelDebug.featherRenderer.mode==="weighted"'));
 const plumeShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-original-plumes.png',Buffer.from(plumeShot.result.data,'base64'));
 await run("document.querySelector('[data-metal=copper]').click();document.getElementById('feather-material').click()");
 assert(await run("peelDebug.state.featherSettings.style==='plume'&&document.getElementById('feather-style-plume').checked&&peelDebug.feathers.group.children.every(batch=>batch.isLineSegments)"));
 await run("document.getElementById('feather-settings-reset').click()");
 assert(await run("peelDebug.state.featherSettings.style==='plume'&&document.getElementById('feather-style-plume').checked&&peelDebug.feathers.group.children.every(batch=>batch.isLineSegments)"));
 assert.equal(await run("document.getElementById('feather-shadow-value').textContent"),'84%');
 assert(await run("peelDebug.feathers.follicleGroup.getObjectByName('Feather follicles').count===peelDebug.feathers.stats.count"));
 await run("document.getElementById('feather-surface-settings').open=true;window.skinRoots=peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array));document.getElementById('feather-lift').value=45;document.getElementById('feather-lift').dispatchEvent(new Event('input'));document.getElementById('feather-flowDirection').value=90;document.getElementById('feather-flowDirection').dispatchEvent(new Event('input'));document.getElementById('feather-skin-color').value='#c99a85';document.getElementById('feather-skin-color').dispatchEvent(new Event('input'));document.getElementById('feather-subsurface').value=70;document.getElementById('feather-subsurface').dispatchEvent(new Event('input'))");
 assert(await run("peelDebug.state.featherSettings.lift===45&&peelDebug.state.featherSettings.flowDirection===90&&peelDebug.core.material.color.getHexString()==='c99a85'"));
 assert(Math.abs(await run('peelDebug.core.material.userData.skinSubsurface.value')-.7)<1e-9);
 assert.equal(await run("document.getElementById('feather-subsurface-value').textContent"),'70%');
 assert(await run("JSON.stringify(skinRoots)===JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))"));
 await run("document.getElementById('feather-settings-reset').click();document.getElementById('feather-surface-settings').open=false");
 assert(await run("peelDebug.state.featherSettings.lift===22&&peelDebug.state.featherSettings.flowDirection===0&&peelDebug.core.material.color.getHexString()==='c68f79'"));
 assert.equal(await run('peelDebug.core.material.userData.skinSubsurface.value'),.35);
 await run("document.getElementById('feather-density').value=4;document.getElementById('feather-density').dispatchEvent(new Event('input'));document.getElementById('feather-opacity').value=0;document.getElementById('feather-opacity').dispatchEvent(new Event('input'))");
 const skinShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-skin-follicles.png',Buffer.from(skinShot.result.data,'base64'));
 assert(await run("peelDebug.feathers.group.children.every(batch=>!batch.visible)&&peelDebug.feathers.follicleGroup.children[0].visible"));
 await run("document.getElementById('feather-settings-reset').click();document.getElementById('feather-style-layered').click()");
 const layeredShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-skin-layered.png',Buffer.from(layeredShot.result.data,'base64'));
 await run("window.borderCameraPosition=peelDebug.camera.position.clone();document.getElementById('feather-settings-close').click();for(let i=0;i<4;i++)document.getElementById('scene').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}))");
 const borderShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-feather-borders.png',Buffer.from(borderShot.result.data,'base64'));
 await run("peelDebug.camera.position.copy(borderCameraPosition);document.getElementById('feather-settings-toggle').click()");
 assert(await run("document.getElementById('layers-view').disabled&&!peelDebug.state.playing"));
 assert(await run("!document.getElementById('feather-options').hidden&&document.getElementById('feather-settings-toggle').getAttribute('aria-expanded')==='true'"));
 await run("document.getElementById('feather-density').value=5;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 await run("window.initialFeatherRoots=peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array));");
 for(const [key,value] of [['length',1.5],['width',.7],['detail',55],['angle',40],['opacity',45],['shadow',50]]){
   await run(`document.getElementById('feather-${key}').value=${value};document.getElementById('feather-${key}').dispatchEvent(new Event('input'))`);
 }
 assert(await run("peelDebug.state.featherSettings.length===1.5&&peelDebug.state.featherSettings.width===.7&&peelDebug.state.featherSettings.detail===.55&&peelDebug.state.featherSettings.angle===40&&peelDebug.state.featherSettings.opacity===.45"));
 assert(await run("peelDebug.feathers.group.children.every(batch=>batch.material.blending===1&&batch.material.toneMapped&&batch.material.opacity===.45)"));
 assert(await run('peelDebug.feathers.translucent&&peelDebug.featherRenderer.mode==="weighted"'));
 assert.equal(await run("document.getElementById('feather-opacity-value').textContent"),'45%');
 assert.equal(await run("peelDebug.feathers.shadowUniforms.uFeatherShadowStrength.value"),.5);
 assert(await run("JSON.stringify(initialFeatherRoots)===JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))"));
 await run("document.getElementById('feather-breeze').value=65;document.getElementById('feather-breeze').dispatchEvent(new Event('input'));document.getElementById('feather-windDirection').value=90;document.getElementById('feather-windDirection').dispatchEvent(new Event('input'))");
 assert.equal(await run("document.getElementById('feather-breeze-value').textContent"),'65%');
 assert.equal(await run("document.getElementById('feather-windDirection-value').textContent"),'90° N');
 const northWind=await run("(()=>{const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};peelDebug.feathers.group.children[0].material.onBeforeCompile(shader);return shader.uniforms.uFeatherWind.value.clone().transformDirection(peelDebug.feathers.group.parent.matrixWorld).toArray()})()");
 assert(Math.abs(northWind[0])<.00001&&Math.abs(northWind[1])<.00001&&Math.abs(northWind[2]+1)<.00001);
 const breezeStart=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 let breezeVisible=false;
 for(let i=0;i<10;i++){
   await delay(200);
   const next=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   if(next.result.data!==breezeStart.result.data){breezeVisible=true;break;}
 }
 assert(breezeVisible,'Breeze must visibly animate the rendered feathers');
 assert(await run("JSON.stringify(initialFeatherRoots)===JSON.stringify(peelDebug.feathers.group.children.map(batch=>Array.from(batch.geometry.attributes.featherPosition.array)))"),'Breeze must leave roots attached');
 await run("document.getElementById('feather-windDirection').value=270;document.getElementById('feather-windDirection').dispatchEvent(new Event('input'))");
 const southWind=await run("(()=>{const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};peelDebug.feathers.group.children[0].material.onBeforeCompile(shader);return shader.uniforms.uFeatherWind.value.clone().transformDirection(peelDebug.feathers.group.parent.matrixWorld).toArray()})()");
 assert(Math.abs(southWind[0])<.00001&&Math.abs(southWind[2]-1)<.00001);
 await run("document.getElementById('feather-breeze').value=0;document.getElementById('feather-breeze').dispatchEvent(new Event('input'))");
 assert.equal(await run('peelDebug.feathers.flyingCount'),0,'Returned feathers must leave the flight simulation idle');
 let calmDraws=await run('window.drawCount'),stableFrames=0;
 for(let i=0;i<100&&stableFrames<8;i++){
   await delay(200);const measurement=await run('({draws:window.drawCount,idle:peelDebug.idle})');
   stableFrames=measurement.idle&&measurement.draws===calmDraws?stableFrames+1:0;calmDraws=measurement.draws;
 }
 assert.equal(stableFrames,8,'Calm transparency and camera damping must settle to idle');
 await delay(500);
 assert.equal(await run('window.drawCount'),calmDraws,'Calm feathers must stop continuous rendering');
 await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
 assert(await run("document.getElementById('feather-options').hidden&&document.activeElement.id==='feather-settings-toggle'"));
 await run("document.getElementById('feather-settings-toggle').click()");
 assert(await run("!document.getElementById('feather-options').hidden"));
 await run("document.getElementById('surface-view').click()");
 assert(await run("document.getElementById('feather-options').hidden"));
 await run("document.getElementById('feather-material').click();document.getElementById('feather-settings-reset').click()");
 assert(await run("peelDebug.state.featherSettings.style==='plume'&&peelDebug.state.featherSettings.length===2&&peelDebug.state.featherSettings.width===1.9&&peelDebug.state.featherSettings.detail===1&&peelDebug.state.featherSettings.angle===46&&peelDebug.state.featherSettings.opacity===1&&peelDebug.state.featherSettings.shadow===.84&&peelDebug.state.featherDensity===4"));
 assert.equal(await run("document.getElementById('feather-density-value').textContent"),'4%');
 assert(await run("peelDebug.state.featherSettings.breeze===0&&peelDebug.state.featherSettings.windDirection===0"),'Reset restores calm and default wind direction');
 await delay(500);
 const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-feathers-cube.png',Buffer.from(shot.result.data,'base64'));
 await run("document.getElementById('feather-density').value=5;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 for(const shape of ['cone','sphere','plus','pill','maze','cube']){
   await run(`document.querySelector('[data-shape=${shape}]').click()`);
   if(shape==='maze')for(let i=0;i<30&&!(await run('peelDebug.feathers.stats.count>0'));i++)await delay(100);
   assert(await run('peelDebug.feathers.stats.count>0&&!peelDebug.surface.mesh.visible'));
 }
 await run("document.getElementById('feather-density').value=0;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 assert.equal(await run('peelDebug.feathers.stats.count'),0);
 await run("document.getElementById('feather-density').value=100;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 const fullDensity=await run('peelDebug.feathers.stats');
 assert.equal(fullDensity.count,Math.round(fullDensity.area*100));
 assert(fullDensity.count>900,'Full density must exceed the former count limit');
 assert.equal(await run("peelDebug.feathers.group.children.filter(batch=>batch.isLineSegments).reduce((sum,batch)=>sum+batch.geometry.instanceCount,0)"),fullDensity.count);
 assert(await run("!document.getElementById('feather-count').textContent.includes('limit reached')"));
 assert.equal(await run("document.getElementById('feather-density-value').textContent"),'100%');
 assert.equal(await run("document.getElementById('feather-density').getAttribute('aria-valuetext')"),'100%');
 await run("document.getElementById('feather-density').value=50;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 assert(await run('peelDebug.feathers.stats.count>300'));
 assert.equal(await run('peelDebug.feathers.stats.count'),Math.round(fullDensity.area*50));
 await run("document.getElementById('feather-density').value=5;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 assert.equal(errors.length,0,JSON.stringify(errors));
 await run("document.querySelector('[data-metal=copper]').click()");
 assert(await run("peelDebug.state.material==='metal'&&peelDebug.surface.mesh.visible&&!peelDebug.feathers.group.parent"));
 assert(await run("!document.getElementById('sample-model')"));
 assert(await run("document.getElementById('horse-shape').textContent.includes('Horse')"));
 await run("document.getElementById('horse-shape').click()");
 for(let i=0;i<150;i++){await delay(200);if(await run("peelDebug.models.sampleKey==='horse'"))break;}
 assert.equal(await run('peelDebug.models.sampleKey'),'horse');
 assert(await run("document.getElementById('horse-shape').getAttribute('aria-pressed')==='true'"));
 assert(await run("document.querySelector('.model-panel').hidden"));
 await run("document.getElementById('feather-material').click()");
 assert(await run('peelDebug.models.active&&peelDebug.feathers.stats.count>0&&!peelDebug.models.peelingStats'));
 await run("document.getElementById('feather-density').value=100;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 await delay(500);
 const horseShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-feathers-horse.png',Buffer.from(horseShot.result.data,'base64'));
 await run("document.getElementById('feather-density').value=5;document.getElementById('feather-density').dispatchEvent(new Event('input'))");
 await run("document.getElementById('paint-toggle').click()");
 assert(await run("peelDebug.state.material==='metal'&&!!peelDebug.models.peelingStats"));
 for(const sample of ['duck','glasses']){
   await run("(()=>{const original=Math.random;Math.random=()=>.99;document.getElementById('random-shape').click();Math.random=original;})()");
   for(let i=0;i<150;i++){await delay(200);if(await run(`peelDebug.models.sampleKey==='${sample}'`))break;}
   assert.equal(await run('peelDebug.models.sampleKey'),sample);
   if(sample==='duck'){
     assert(await run("peelDebug.state.material==='feathers'&&peelDebug.feathers.stats.count>0&&!peelDebug.models.peelingStats&&!peelDebug.state.playing"));
     assert(await run("peelDebug.models.meshes.every(mesh=>mesh.material===peelDebug.feathers.substrate)&&document.getElementById('feather-material').getAttribute('aria-pressed')==='true'"));
   }else assert(await run("peelDebug.state.material==='metal'&&!!peelDebug.models.peelingStats&&!peelDebug.feathers.group.parent"));
   assert(await run("document.getElementById('horse-shape').getAttribute('aria-pressed')==='false'"));
   assert(await run("document.querySelector('.model-panel').hidden"));
 }
 await run("(async()=>{const original=Math.random;let draws=0;Math.random=()=>++draws===2?0:.99;try{await document.getElementById('random-shape').onclick();}finally{Math.random=original;}})()");
 assert(await run("!peelDebug.models.active&&peelDebug.state.material==='feathers'&&peelDebug.feathers.stats.count>0&&peelDebug.core.material===peelDebug.feathers.substrate&&!peelDebug.surface.mesh.visible"));
 assert(await run("document.getElementById('toast').textContent.startsWith('Feathered')&&!document.getElementById('feather-controls').hidden&&document.getElementById('layers-view').disabled"));
 await run("document.querySelector('[data-metal=copper]').click()");

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

 // A real GLB morph clip exercises attachment updates and restoring rest pose.
 await run(`(()=>{
   document.getElementById('feather-material').click();
   const chunks=[new Float32Array([-1,0,0,1,0,0,0,2,0]),new Float32Array([0,0,1,0,0,1,0,0,1]),new Float32Array([0,1]),new Float32Array([0,1])];
   let offset=0;
   const bufferViews=chunks.map(chunk=>{const view={buffer:0,byteOffset:offset,byteLength:chunk.byteLength};offset+=chunk.byteLength;return view});
   const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Animated feather surface',mesh:0}],meshes:[{weights:[0],primitives:[{attributes:{POSITION:0},targets:[{POSITION:1}]}]}],
     buffers:[{byteLength:offset}],bufferViews,accessors:[
       {bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,2,0]},
       {bufferView:1,componentType:5126,count:3,type:'VEC3',min:[0,0,1],max:[0,0,1]},
       {bufferView:2,componentType:5126,count:2,type:'SCALAR',min:[0],max:[1]},
       {bufferView:3,componentType:5126,count:2,type:'SCALAR'}],
     animations:[{name:'Lift',samplers:[{input:2,output:3,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:0,path:'weights'}}]}]};
   const json=new TextEncoder().encode(JSON.stringify(gltf)),jsonLength=Math.ceil(json.length/4)*4;
   const bytes=new Uint8Array(12+8+jsonLength+8+offset),view=new DataView(bytes.buffer);
   view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);
   view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(json,20);
   let cursor=20+jsonLength;view.setUint32(cursor,offset,true);view.setUint32(cursor+4,0x004e4942,true);cursor+=8;
   for(const chunk of chunks){bytes.set(new Uint8Array(chunk.buffer),cursor);cursor+=chunk.byteLength;}
   const transfer=new DataTransfer();transfer.items.add(new File([bytes],'animated-feathers.glb'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer}));
 })()`);
 for(let i=0;i<100;i++){await delay(100);if(await run("document.getElementById('model-name').textContent==='animated-feathers.glb'"))break;}
 assert.equal(await run("document.getElementById('model-name').textContent"),'animated-feathers.glb');
 assert(await run("peelDebug.state.material==='feathers'&&peelDebug.feathers.stats.count>0"));
 const restZ=await run("peelDebug.feathers.group.children[0].geometry.attributes.featherPosition.getZ(0)");
 await run("document.getElementById('model-animation').value=0;document.getElementById('model-animation').dispatchEvent(new Event('change'));document.getElementById('animation-toggle').click()");
 let followedMorph=false;
 for(let i=0;i<30;i++){
   await delay(150);
   followedMorph=await run(`Math.abs(peelDebug.feathers.group.children[0].geometry.attributes.featherPosition.getZ(0)-${restZ})>.05`);
   if(followedMorph)break;
 }
 assert(followedMorph,'Feathers must follow morph animation: '+JSON.stringify(await run(`({restZ:${restZ},z:peelDebug.feathers.group.children[0].geometry.attributes.featherPosition.getZ(0),weights:peelDebug.models.meshes[0].morphTargetInfluences,button:document.getElementById('animation-toggle').textContent})`)));
 await run("document.getElementById('model-animation').value=-1;document.getElementById('model-animation').dispatchEvent(new Event('change'))");
 assert(await run(`Math.abs(peelDebug.feathers.group.children[0].geometry.attributes.featherPosition.getZ(0)-${restZ})<.00001`),'Rest pose must restore feather attachments');
 await run("document.querySelector('[data-metal=iron]').click()");
 await run("document.getElementById('horse-shape').click();document.querySelector('[data-shape=cube]').click()");
 await delay(1000);assert.equal(await run('peelDebug.models.active'),false);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(400);
 assert(await run('document.documentElement.scrollWidth<=innerWidth'),'Mobile overflow');
 await checkMazeFeathers({run,call,delay,assert,mobile:true});
 await run("document.querySelector('[data-shape=maze]').click();document.getElementById('maze-enter').click()");
 assert(await run("peelDebug.mazeNavigation.active&&peelDebug.camera.fov===75&&document.documentElement.scrollWidth<=innerWidth"));
 const touchWalk=await run("(()=>{const r=document.querySelector('[data-walk=forward]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
 await call('Emulation.setTouchEmulationEnabled',{enabled:true});
 const touchStart=await run('peelDebug.mazeNavigation.walker.position.toArray()');
 await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touchWalk,id:1}]});
 await run('for(let i=0;i<30;i++)peelDebug.mazeNavigation.update(1/60)');
 await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert(await run(`Math.hypot(peelDebug.mazeNavigation.walker.position.x-${touchStart[0]},peelDebug.mazeNavigation.walker.position.z-${touchStart[2]})>.03`),'Holding the mobile pad must walk');
 assert(await run("['[data-fpv-exit]','[data-fpv-restart]','[data-walk=forward]','[data-walk=turnLeft]'].every(selector=>{const button=document.querySelector(selector),r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})"),'Mobile navigation controls must be reachable');
 const mobileFpvShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-maze-fpv-mobile.png',Buffer.from(mobileFpvShot.result.data,'base64'));
 await call('Emulation.setTouchEmulationEnabled',{enabled:false});
 await run("document.querySelector('[data-fpv-exit]').click();document.querySelector('[data-shape=cube]').click()");
 await run("document.getElementById('feather-material').click()");await delay(400);
 assert(await run('document.documentElement.scrollWidth<=innerWidth'),'Mobile feather controls overflow');
 assert(await run("(()=>{const r=document.getElementById('feather-controls').getBoundingClientRect();return r.top>0&&r.bottom<=innerHeight&&r.width>0})()"));
 assert(await run("(()=>{const r=document.getElementById('feather-options').getBoundingClientRect();return !document.getElementById('feather-options').hidden&&r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),'Mobile feather settings fit the viewport');
 await run("document.getElementById('feather-surface-settings').open=true;document.getElementById('feather-lsystem-settings').open=true");
 assert(await run("['axiom','ruleX','ruleF','grammar-apply','grammar-reset'].every(key=>{const input=document.getElementById('feather-'+key);input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===input})"),'Mobile grammar fields and actions must remain reachable');
 assert(await run("['density','generations','branchLength','branchRandomness','subsurface','lift','flowDirection','length','width','detail','angle','opacity','shadow','breeze','windDirection'].every(key=>{const input=document.getElementById('feather-'+key);input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===input})"),'All mobile feather sliders must be reachable while scrolling');
 await run("document.getElementById('feather-surface-settings').open=false;document.getElementById('feather-lsystem-settings').open=false;document.getElementById('feather-options').scrollTop=0");
 assert(await run("(()=>{const button=document.getElementById('feather-settings-close'),r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()"),'Mobile menu close button must remain reachable above model controls');
 const mobileShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile('/private/tmp/oxide-feathers-mobile.png',Buffer.from(mobileShot.result.data,'base64'));
 assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('PASS: breeze animation and direction, calm rendering, feather settings, reset, stable roots, materials, density, animation, GLB upload, peeling and mobile layout.');

 }
} finally {ws?.close();browser.kill();server.close();}

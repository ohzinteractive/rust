import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpRoaming({run,call,delay}){
  await run('document.getElementById("kelp-material").click();document.querySelector("[data-shape=cube]").click();peelDebug.kelp.setPlaying(false);peelDebug.controls.enableDamping=false;peelDebug.controls.update()');
  await run(`(()=>{const slider=document.getElementById('kelp-fish-speed');slider.value=5;slider.dispatchEvent(new Event('input'));})()`);
  assert(await run('peelDebug.kelpFish.settings.speed===.05'),'The speed control supports very slow swimming');
  await run(`(()=>{const slider=document.getElementById('kelp-fish-speed');slider.value=100;slider.dispatchEvent(new Event('input'));})()`);
  const canvas=()=>run('(()=>{const r=peelDebug.renderer.domElement.getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+r.height*.4};})()');
  const point=await canvas();
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=5;i++)await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+i*14,y:point.y+i*3,buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+70,y:point.y+15,button:'left',buttons:0,clickCount:1});
  assert(await run('!peelDebug.kelpFish.roaming'),'Dragging to orbit does not release the school');
  const pose=await run('JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()])');
  const tap=await canvas();
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:tap.x,y:tap.y,button:'left',buttons:1,clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:tap.x,y:tap.y,button:'left',buttons:0,clickCount:1});
  assert(await run('peelDebug.kelpFish.roaming&&peelDebug.kelp.playing&&peelDebug.kelpAttractor.active&&document.getElementById("kelp-fish-roam").textContent==="Regroup fish"'),'A scene click releases and unpauses fish while the object remains');
  assert.equal(await run('JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()])'),pose,'Releasing fish preserves the camera');
  await run('peelDebug.kelp.setPlaying(true);for(let i=0;i<500;i++){peelDebug.kelp.advance(.05);peelDebug.kelpFish.advance(.05);}peelDebug.kelp.setPlaying(false);peelDebug.renderer.shadowMap.needsUpdate=true;peelDebug.renderScene()');
  const result=await run(`import('./kelp-avoidance.js').then(({createKelpAvoidance})=>{
    const {kelp,kelpFish,kelpAttractor}=peelDebug,field=createKelpAvoidance(kelp);field.update();
    const point=kelpAttractor.center.clone();let escaped=0,contacts=0,shapeContacts=0;const xs=[];
    for(let i=0;i<kelpFish.stats.count;i++){
      const f=kelpFish.inspectFish(i);point.fromArray(f.position);xs.push(point.x);
      if(!field.isClear(point,.42*f.size))contacts++;
      if(kelpAttractor.distanceTo(point)<=.46*f.size)shapeContacts++;
      if(point.distanceTo(kelpAttractor.center)>5)escaped++;
    }
    return {escaped,contacts,shapeContacts,spread:Math.max(...xs)-Math.min(...xs)};
  })`);
  assert.equal(result.shapeContacts,0,'Roaming preserves object clearance');assert.equal(result.contacts,0,'Fish avoid the animated kelp');assert(result.escaped>2&&result.spread>6,'Roaming fish explore outside the shape orbit: '+JSON.stringify(result));
  const capture=async suffix=>{await run('peelDebug.renderScene()');const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/oxide-kelp-roaming'+suffix+'.png',Buffer.from(shot.result.data,'base64'));};
  await capture('');
  await run('document.getElementById("kelp-fish-roam").click()');assert(await run('!peelDebug.kelpFish.roaming&&peelDebug.kelpAttractor.active'),'Regroup restores shape attraction');
  await run('peelDebug.kelp.setPlaying(false)');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(300);await run('document.getElementById("reset-view").click()');
  const mobile=await canvas();
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:mobile.x,y:mobile.y,radiusX:2,radiusY:2,force:1}]});
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert(await run('peelDebug.kelpFish.roaming'),'A mobile tap releases the fish');
  await run('peelDebug.kelp.setPlaying(false);document.getElementById("kelp-settings-toggle").click()');
  assert(await run('(()=>{const b=document.getElementById("kelp-fish-roam");b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b;})()'),'Regroup control is reachable on mobile');
  await run('document.getElementById("kelp-fish-roam").click();document.getElementById("kelp-settings-close").click();peelDebug.kelp.setPlaying(false)');
  assert(await run('!peelDebug.kelpFish.roaming'));await capture('-mobile');
  assert(await run('document.documentElement.scrollWidth<=innerWidth'),'Roaming status does not overflow the mobile layout');
  console.log('PASS: moving-kelp avoidance, free exploration, object clearance, click/drag separation, camera preservation, regroup and mobile tap.',JSON.stringify(result));
}

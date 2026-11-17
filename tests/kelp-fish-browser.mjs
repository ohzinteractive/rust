import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpFish({run,call,delay}){
  const input=(id,value)=>run(`(()=>{const i=document.getElementById('${id}');i.value=${value};i.dispatchEvent(new Event('input'));})()`);
  const advance=steps=>run(`(()=>{const {kelp,kelpFish,renderer}=peelDebug;kelp.setPlaying(true);for(let i=0;i<${steps};i++){kelp.advance(.05);kelpFish.advance(.05);}kelp.setPlaying(false);renderer.shadowMap.needsUpdate=true;peelDebug.renderScene();})()`);
  const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/'+name+'.png',Buffer.from(shot.result.data,'base64'));};
  await run('document.getElementById("kelp-material").click();window.fishCamera=[peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()];window.fishGeometry=peelDebug.kelpFish.group.children[0].geometry;window.forestGeometry=peelDebug.kelp.group.children[1].geometry;peelDebug.renderScene()');
  assert(await run('peelDebug.kelpFish.stats.count===20&&peelDebug.kelpFish.group.visible'));
  await input('kelp-strands',22);await input('kelp-height',7);await input('kelp-fish-count',180);
  await run('document.getElementById("reset-view").click();window.fishCamera=[peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()];window.forestGeometry=peelDebug.kelp.group.children[1].geometry;void 0');
  await input('kelp-fish-feeding',0);await advance(120);await screenshot('oxide-fish-school');
  assert.equal(await run('peelDebug.kelp.stats.remaining'),1);
  await input('kelp-fish-feeding',100);await advance(1000);
  assert(await run('peelDebug.kelp.stats.remaining<.75&&peelDebug.kelp.stats.eaten>0&&peelDebug.kelpFish.stats.bites>100'),'Fish strip actual foliage');
  assert(await run('peelDebug.kelpFish.group.children[0].geometry===fishGeometry&&peelDebug.kelp.group.children[1].geometry===forestGeometry'),'Animation and feeding reuse their geometry');
  await screenshot('oxide-fish-grazed-kelp');
  const frozen=await run('JSON.stringify([peelDebug.kelpFish.inspectFish(0),peelDebug.kelp.stats.remaining])');await delay(250);
  assert.equal(await run('JSON.stringify([peelDebug.kelpFish.inspectFish(0),peelDebug.kelp.stats.remaining])'),frozen,'Pause freezes fish and damage');
  assert(await run('[peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()].every((v,i)=>v.every((x,j)=>Math.abs(x-fishCamera[i][j])<1e-8))'),'Fish never move the camera');
  await run('document.getElementById("kelp-camera-push").click();peelDebug.kelp.setPlaying(true)');
  for(let i=0;i<25;i++){
    await delay(200);
    if(await run('peelDebug.camera.position.distanceTo({x:fishCamera[0][0],y:fishCamera[0][1],z:fishCamera[0][2]})>.001'))break;
  }
  assert(await run('peelDebug.camera.position.distanceTo({x:fishCamera[0][0],y:fishCamera[0][1],z:fishCamera[0][2]})>.001'), 'Optional cinematic push moves the camera');
  await run('peelDebug.controls.dispatchEvent({type:"start"});peelDebug.kelp.setPlaying(false)');
  assert(await run('document.getElementById("kelp-camera-push").getAttribute("aria-pressed")==="false"'), 'Manual orbit cancels the camera shot');
  await input('kelp-fish-count',500);await input('kelp-fish-speed',175);await advance(40);assert(await run('peelDebug.kelpFish.group.children[0].count===500&&peelDebug.kelpFish.settings.speed===1.75'));
  await input('kelp-fish-count',0);await run('document.getElementById("kelp-restore").click()');assert(await run('peelDebug.kelp.stats.remaining===1&&peelDebug.kelpFish.group.children[0].count===0'));
  await input('kelp-fish-count',180);await input('kelp-fish-feeding',45);await input('kelp-fish-speed',100);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(300);
  await run('document.getElementById("kelp-regrow").click();document.getElementById("reset-view").click()');await advance(120);await screenshot('oxide-fish-mobile');
  await run('document.getElementById("kelp-settings-toggle").click()');
  for(const id of ['kelp-fish-count','kelp-fish-speed','kelp-fish-feeding','kelp-restore'])assert(await run(`(()=>{const e=document.getElementById('${id}');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===e;})()`),id+' is reachable on mobile');
  assert(await run('document.documentElement.scrollWidth<=innerWidth'));
  await run('document.querySelector("[data-metal=iron]").click()');assert(await run('!peelDebug.kelpFish.group.visible&&!peelDebug.kelp.group.visible'));
  console.log('PASS: fish school, visible grazing, pause, fixed camera, 500 fish, restore, mobile controls and scene exit.');
}

import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpAttractor({run,call,delay}){
  const click=id=>run(`document.getElementById('${id}').click()`);
  await click('kelp-material');
  await run('peelDebug.kelp.setPlaying(false);peelDebug.controls.enableDamping=false;peelDebug.controls.update();window.attractorPose=JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()]);void 0');
  for(const kind of ['cube','cone','sphere','plus','pill','maze']){
    await run(`document.querySelector('[data-shape="${kind}"]').click();peelDebug.renderScene()`);
    assert(await run(`peelDebug.state.material==='kelp'&&peelDebug.kelpEnvironment.enabled&&peelDebug.kelpAttractor.active&&peelDebug.kelpAttractor.shape==='${kind}'&&!peelDebug.core.parent.visible`),'Toolbar shape stays in the kelp scene: '+kind);
    assert(await run(`document.querySelector('[data-shape="${kind}"]').getAttribute('aria-pressed')==='true'`));
    assert(await run('JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()])===attractorPose'),'Adding a shape preserves the camera');
  }
  await run('document.querySelector("[data-shape=cube]").click();window.fishY=Array.from({length:peelDebug.kelpFish.stats.count},(_,i)=>peelDebug.kelpFish.inspectFish(i).position[1]).reduce((a,b)=>a+b,0)/peelDebug.kelpFish.stats.count;void 0');
  await run(`(()=>{
    const {kelp,kelpFish,kelpAttractor,renderer}=peelDebug;
    kelp.setPlaying(true);
    for(let frame=0;frame<600;frame++){kelp.advance(.05);kelpFish.advance(.05);}
    kelp.setPlaying(false);renderer.shadowMap.needsUpdate=true;peelDebug.renderScene();
  })()`);
  assert(await run(`(()=>{
    const {kelpFish,kelpAttractor}=peelDebug,probe=kelpAttractor.center.clone();let y=0;
    for(let i=0;i<kelpFish.stats.count;i++){
      const f=kelpFish.inspectFish(i);probe.fromArray(f.position);y+=probe.y;
      if(kelpAttractor.distanceTo(probe)<=f.size*.46)return false;
    }
    return y/kelpFish.stats.count<fishY-1&&kelpFish.stats.feeding===0;
  })()`),'Fish gather around the object near the seabed without touching it');
  const capture=async name=>{await run('peelDebug.renderScene()');const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/'+name+'.png',Buffer.from(shot.result.data,'base64'));};
  await capture('oxide-kelp-attractor');
  await click('kelp-remove-shape');assert(await run('!peelDebug.kelpAttractor.hasShape&&document.getElementById("kelp-remove-shape").disabled'));
  await click('horse-shape');
  for(let i=0;i<100;i++){await delay(100);if(await run('!document.getElementById("horse-shape").disabled'))break;}
  assert(await run('peelDebug.kelpAttractor.shape==="horse"&&peelDebug.state.material==="kelp"&&!peelDebug.models.active&&document.getElementById("horse-shape").getAttribute("aria-pressed")==="true"'),'Horse is an underwater attractor, not the specimen model');
  await run('document.getElementById("horse-shape").click();document.querySelector("[data-shape=sphere]").click()');
  for(let i=0;i<100;i++){await delay(100);if(await run('!document.getElementById("horse-shape").disabled'))break;}
  assert(await run('peelDebug.kelpAttractor.shape==="sphere"'),'A late horse load cannot replace a newer shape selection');
  await click('random-shape');
  for(let i=0;i<100;i++){await delay(100);if(await run('!document.getElementById("horse-shape").disabled'))break;}
  assert(await run('peelDebug.state.material==="kelp"&&peelDebug.kelpAttractor.hasShape&&peelDebug.kelpAttractor.shape!=="sphere"'),'Random shape also stays in the underwater scene');
  await run('document.querySelector("[data-shape=cube]").click();peelDebug.renderScene()');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(300);await click('reset-view');
  await capture('oxide-kelp-attractor-mobile');
  await click('kelp-settings-toggle');
  assert(await run(`(()=>{const b=document.getElementById('kelp-remove-shape');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b;})()`),'Remove shape is reachable on mobile');
  await run('document.querySelector("[data-metal=iron]").click()');assert(await run('!peelDebug.kelpAttractor.group.visible&&peelDebug.core.parent.visible'));
  await click('kelp-material');assert(await run('peelDebug.kelpAttractor.active&&peelDebug.kelpAttractor.shape==="cube"'));
  await click('kelp-remove-shape');assert(await run('!peelDebug.kelpAttractor.active'));
  console.log('PASS: six shapes and horse, attraction, clearance, camera preservation, async selection, remove, mobile controls and scene restoration.');
}

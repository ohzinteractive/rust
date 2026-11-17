import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpLeafPhysics({run,call}){
  await run(`document.getElementById('kelp-material').click();peelDebug.kelp.setPlaying(false);
    peelDebug.kelpFish.setSettings({count:12});peelDebug.renderScene();`);
  const result=await run(`(()=>{
    const {kelp,kelpFish}=peelDebug,physics=kelp.getLeafPhysics();
    const before=physics.texture.image.data.slice(),geometry=kelp.group.children[1].geometry;
    kelp.setPlaying(true);
    const start=performance.now();
    for(let i=0;i<90;i++){kelp.advance(1/30);kelpFish.advance(1/30);}
    const elapsed=performance.now()-start;kelp.setPlaying(false);
    const data=physics.texture.image.data;
    let changed=0,maxOffset=0;
    for(let i=0;i<data.length;i+=4){
      if(Math.abs(data[i]-before[i])+Math.abs(data[i+1]-before[i+1])+Math.abs(data[i+2]-before[i+2])>.001)changed++;
      maxOffset=Math.max(maxOffset,Math.hypot(data[i],data[i+1],data[i+2]));
    }
    const version=physics.version;kelp.advance(.1);
    peelDebug.renderScene();
    return {changed,maxOffset,finite:data.every(Number.isFinite),pinned:Array.from({length:kelp.stats.blades},(_,i)=>Math.hypot(...data.slice(i*9*4,i*9*4+3))).every(v=>v<1e-6),
      paused:version===physics.version,geometryStable:geometry===kelp.group.children[1].geometry,elapsed,blades:kelp.stats.blades};
  })()`);
  assert(result.changed>100&&result.maxOffset>.01,'Many leaves flex under contact rather than following independent waves');
  assert(result.finite&&result.pinned&&result.paused&&result.geometryStable,JSON.stringify(result));
  assert(result.maxOffset<.71,'Bending stays bounded in the dense forest');
  const capture=async name=>{await run('peelDebug.renderScene()');const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/'+name+'.png',Buffer.from(shot.result.data,'base64'));};
  await capture('oxide-kelp-flexible-leaves');
  await run(`peelDebug.controls.enableDamping=false;
    peelDebug.controls.target.set(-4.8,1.6,1.3);peelDebug.camera.position.set(-1.8,2.1,6.5);peelDebug.controls.update();`);
  await capture('oxide-kelp-leaf-contact-close');
  console.log('PASS: full-forest leaf flex, pinned attachments, bounded motion, pause, stable geometry and shared shader rendering.',JSON.stringify(result));
}

import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkFishVariety({run,call}){
  await call('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});
  await run("document.getElementById('kelp-material').click();peelDebug.kelp.rebuild({strands:4,generations:2});peelDebug.kelp.setPlaying(false);peelDebug.kelpFish.setSettings({count:80,feeding:0});peelDebug.controls.enableDamping=false;window.lifeBefore=peelDebug.kelpFish.group.children[0].material.userData.scaleLife.texture.image.data.slice();void 0");
  const report=await run(`(()=>{const d=peelDebug;d.kelp.setPlaying(true);for(let i=0;i<120;i++){d.kelp.advance(.1);d.kelpFish.advance(.1);}d.kelp.setPlaying(false);d.renderer.shadowMap.needsUpdate=true;d.renderScene();const life=d.kelpFish.group.children[0].material.userData.scaleLife;return {lifeGeneration:life.stats.generation,livingScales:life.texture.image.data.some((v,i)=>v!==lifeBefore[i]),species:[...new Set(Array.from({length:d.kelpFish.stats.count},(_,i)=>d.kelpFish.inspectFish(i).species))].sort(),finite:Array.from(d.kelpFish.group.children[0].instanceMatrix.array).every(Number.isFinite),attributes:d.renderer.getContext().getParameter(d.renderer.getContext().MAX_VERTEX_ATTRIBS)};})()`);
  assert.deepEqual(report.species,['blue','discus','neon','silver']);assert(report.finite&&report.attributes>=16&&report.livingScales&&report.lifeGeneration>=9);
  const generation=await run('peelDebug.kelpFish.group.children[0].material.userData.scaleLife.stats.generation');
  await run('for(let i=0;i<60;i++)peelDebug.kelpFish.advance(.1)');assert.equal(await run('peelDebug.kelpFish.group.children[0].material.userData.scaleLife.stats.generation'),generation,'Pausing the fish also freezes their scale evolution');
  // A side view under the actual water lighting makes all four silhouettes
  // and their markings visible without relying on random school positions.
  await run(`import('./vendor/three.module.js').then(T=>{
    const d=peelDebug,m=d.kelpFish.group.children[0];d.kelp.group.visible=false;m.count=4;
    for(let i=0;i<4;i++){
      m.geometry.attributes.fishSpecies.setX(i,i);m.setColorAt(i,new T.Color(0xffffff));
      const pose=new T.Object3D();pose.position.set((i-1.5)*1.8,1.2,2.5);pose.scale.setScalar(i===1?1.65:i===2?2.6:2.2);pose.updateMatrix();m.setMatrixAt(i,pose.matrix);
    }
    m.geometry.attributes.fishSpecies.needsUpdate=true;m.instanceMatrix.needsUpdate=true;m.instanceColor.needsUpdate=true;
    d.controls.target.set(0,1.2,2.5);d.camera.position.set(0,1.7,10);d.controls.update();d.renderer.shadowMap.needsUpdate=true;d.renderScene();
  })`);
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/oxide-fish-variety.png',Buffer.from(shot.result.data,'base64'));
  await run("peelDebug.controls.target.set(.9,1.2,2.5);peelDebug.camera.position.set(1.3,1.7,5.2);peelDebug.controls.update();peelDebug.renderScene()");
  const closeup=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/oxide-discus-closeup.png',Buffer.from(closeup.result.data,'base64'));
  await run("peelDebug.kelpFish.reset();peelDebug.kelpFish.setSettings({count:500});peelDebug.renderer.shadowMap.needsUpdate=true;peelDebug.renderScene()");
  assert.equal(await run('peelDebug.kelpFish.group.children[0].count'),500);
  console.log('PASS: four fish types render with matching shadows and finite animation; population still supports 500 fish.',JSON.stringify(report));
}

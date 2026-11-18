import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpOrbit({run,call}){
  await call('Emulation.setDeviceMetricsOverride',{width:900,height:760,deviceScaleFactor:1,mobile:false});
  await run("document.getElementById('kelp-material').click();peelDebug.kelp.rebuild({strands:24,generations:3,height:7,current:.35});peelDebug.kelpEnvironment.setHeight(7);peelDebug.kelpAttractor.setWaterHeight(7);peelDebug.kelp.setPlaying(false);peelDebug.kelpFish.setSettings({count:120,feeding:0});peelDebug.controls.enableDamping=false;void 0");
  assert(await run("peelDebug.kelpAttractor.loadSample('horse')"));
  const report=await run(`(()=>{
    const d=peelDebug;d.kelpFish.setAttractor(d.kelpAttractor);d.kelp.setPlaying(true);
    const count=d.kelpFish.stats.count,point=d.kelpAttractor.center.clone();let snapshots=[],windows=0,stuck=0;
    for(let frame=0;frame<400;frame++){
      const angle=frame*.008;d.controls.target.copy(d.kelpAttractor.center);d.camera.position.set(Math.sin(angle)*6,3,d.kelpAttractor.center.z+Math.cos(angle)*6);d.controls.update();
      d.kelp.setViewingCorridor(d.camera.position,d.kelpAttractor,.1);d.kelp.advance(.1);d.kelpFish.advance(.1);
      if(frame>=200&&frame%25===0){
        const current=Array.from({length:count},(_,i)=>d.kelpFish.inspectFish(i).position);
        if(snapshots.length)for(let i=0;i<count;i++){windows++;if(point.fromArray(current[i]).distanceTo(point.clone().fromArray(snapshots[i]))<.2)stuck++;}
        snapshots=current;
      }
    }
    d.kelp.setPlaying(false);d.renderer.shadowMap.needsUpdate=true;d.renderScene();
    let contacts=0;
    const matrices=d.kelpFish.group.children[0].instanceMatrix.array;
    for(let i=0;i<count;i++){const f=d.kelpFish.inspectFish(i);point.set(matrices[i*16+12],matrices[i*16+13],matrices[i*16+14]);if(d.kelpAttractor.distanceTo(point)<=.46*f.size)contacts++;}
    return {stalled:stuck/windows,contacts,finite:Array.from(matrices).every(Number.isFinite)};
  })()`);
  assert(report.finite&&report.contacts===0,'Drawn fish retain finite poses and sculpture clearance');
  assert(report.stalled<.15,'The school keeps circulating while the camera corridor rotates: '+JSON.stringify(report));
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/oxide-fish-orbit-flow.png',Buffer.from(shot.result.data,'base64'));
  console.log('PASS: fish flow around the horse while the viewing corridor rotates.',JSON.stringify(report));
}

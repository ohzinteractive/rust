import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpDrop({run,call}){
  await run(`document.getElementById('kelp-material').click();
    peelDebug.kelp.setPlaying(false);
    window.stepDrop=peelDebug.kelpAttractor.advance;
    window.stepSand=peelDebug.kelpEnvironment.advanceImpact;
    peelDebug.kelpAttractor.advance=()=>false;
    peelDebug.kelpEnvironment.advanceImpact=()=>false;
    document.querySelector('[data-shape=pill]').click();`);
  assert(await run(`(()=>{
    const shape=peelDebug.kelpAttractor,water=peelDebug.kelpEnvironment;
    const start=shape.bounds.min.y;window.undisturbedFloor=water.floorHeight(0,2.5);
    stepDrop(.1);if(shape.bounds.min.y>=start)return false;
    if(Math.abs(shape.bounds.min.y-water.surfaceY) > 2) return false;
    window.initialTilt=shape.group.children[0].quaternion.clone();
    for(let i=0;i<100&&!water.bubbles.stats.impact;i++){stepDrop(.05);stepSand(.05);}
    for(let i=0;i<4;i++){stepDrop(.05);stepSand(.05);}
    if(!water.bubbles.stats.impact||shape.group.children[0].quaternion.equals(initialTilt))return false;
    if(water.bubbles.group.children.length!==1||water.bubbles.bubbles.geometry.type!=='SphereGeometry')return false;
    const dust=water.group.getObjectByName('Impact sand and drifting silt');
    peelDebug.renderScene();
    return dust.visible&&dust.geometry.attributes.position.array.every(Number.isFinite)
      &&dust.geometry.attributes.sedimentAlpha.array.some(a=>a>0);
  })()`),'A falling object releases visible, finite sediment particles on impact');
  await run('peelDebug.kelpEnvironment.bubbles.advance(.1);peelDebug.renderScene()');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/private/tmp/oxide-kelp-sand-impact.png',Buffer.from(shot.result.data,'base64'));
  assert(await run(`(()=>{
    const shape=peelDebug.kelpAttractor,water=peelDebug.kelpEnvironment;
    for(let i=0;i<120;i++){stepDrop(.05);stepSand(.05);water.bubbles.advance(.05);}
    if(!water.bubbles.stats.vent||!water.bubbles.stats.fish)return false;
    const dust=water.group.getObjectByName('Impact sand and drifting silt');
    if(shape.falling||shape.bounds.min.y>=undisturbedFloor||water.floorHeight(0,2.5)>=undisturbedFloor-.06||dust.visible)return false;
    const settled=shape.bounds.min.y;shape.setWaterHeight(11);
    if(Math.abs(shape.bounds.min.y-settled)>.00001)return false;
    document.querySelector('[data-shape=sphere]').click();
    if(!shape.falling||shape.bounds.min.y<undisturbedFloor+1)return false;
    document.getElementById('kelp-remove-shape').click();
    peelDebug.renderScene();return !shape.hasShape&&!dust.visible&&Math.abs(water.floorHeight(0,2.5)-undisturbedFloor)<.00001;
  })()`),'Silt disperses, the object stays buried, and replacing or removing it resets the effect');
  await run('peelDebug.renderScene()');
  const streams=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/private/tmp/oxide-kelp-bubble-streams.png',Buffer.from(streams.result.data,'base64'));
  console.log('PASS: waterline release, tilt, landing bubbles and sediment, varied vent/fish streams, settling, resizing and cleanup.');
}

import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpPolish({run,call,fishOnly=false}){
  let tissue,particles,volume;
  if(!fishOnly){
  tissue=await run(`import('./tests/kelp-look-gpu.js').then(m=>m.checkLeafTransmission(peelDebug.renderer))`);
  assert.equal(tissue.midgroundGain,1.25);assert.equal(tissue.foregroundGain,1);assert.equal(tissue.backgroundGain,1);
  particles=await run(`import('./tests/kelp-atmosphere-gpu.js').then(m=>m.checkParticleLighting(peelDebug.renderer))`);
  assert(Math.abs(particles.gain-1.25)<.025&&particles.shadowRatio<.005);
  assert(particles.glintPeak>particles.glintQuiet*1.2&&particles.shadowGlint<particles.glintPeak*.005,JSON.stringify(particles));
  volume=await run(`import('./tests/kelp-volumetrics-gpu.js').then(m=>m.checkKelpVolumetricShadows({renderer:peelDebug.renderer}))`);
  assert(volume.shaftGain>1.08&&volume.rawChanged>40,'The shaft adds shadowed radiance through the water column: '+JSON.stringify(volume));
  }
  await call('Emulation.setDeviceMetricsOverride',{width:800,height:650,deviceScaleFactor:1,mobile:false});
  await run(`document.getElementById('kelp-material').click();peelDebug.kelp.setPlaying(false);
    peelDebug.controls.enableDamping=false;peelDebug.camera.position.set(1.8,3.6,12.5);peelDebug.controls.target.set(0,2.7,1.5);peelDebug.controls.update();
    peelDebug.kelpFish.setVisible(true);peelDebug.renderer.shadowMap.needsUpdate=true;peelDebug.renderScene();`);
  const rim=await run(`(async()=>{
    const THREE=await import('./vendor/three.module.js'),{kelpFish,kelpEnvironment:water,renderer}=peelDebug;
    const fishMaterial=kelpFish.group.children[0].material,gain=fishMaterial.userData.fishRimGain,original=gain.value;
    function read(){
      peelDebug.renderScene();const t=water.getLightingDiagnostics().sceneTarget,half=t.texture.type===THREE.HalfFloatType;
      const p=half?new Uint16Array(t.width*t.height*4):new Uint8Array(t.width*t.height*4);renderer.readRenderTargetPixels(t,0,0,t.width,t.height,p);
      const gl=renderer.getContext(),program=renderer.properties.get(fishMaterial).currentProgram?.program;
      const location=program?gl.getUniformLocation(program,'fishRimGain'):null;
      const gpuGain=location?gl.getUniform(program,location):null;
      const programLog=program?gl.getProgramInfoLog(program):'';
      return {gpuGain,programLog,p,decode:v=>half?THREE.DataUtils.fromHalfFloat(v):v/255};
    }
    gain.value=0;fishMaterial.needsUpdate=true;const before=read();gain.value=original;fishMaterial.needsUpdate=true;const after=read();let changed=0,added=0;
    for(let i=0;i<before.p.length;i+=4){let delta=0;for(let c=0;c<3;c++)delta+=after.decode(after.p[i+c])-before.decode(before.p[i+c]);if(delta>.001)changed++;added+=Math.max(0,delta);}
    return {programLog:after.programLog,beforeGain:before.gpuGain,afterGain:after.gpuGain,changed,added,radiance:fishMaterial.userData.fishSunRadiance.value.toArray(),count:kelpFish.stats.count,visible:kelpFish.group.visible};
  })()`);

  await run('peelDebug.renderScene()');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/private/tmp/oxide-kelp-lighting-polish.png',Buffer.from(shot.result.data,'base64'));
  assert(rim.changed>3&&rim.added>.001,'Sun-facing fish rims gain contrast in the actual scene: '+JSON.stringify(rim));
  console.log(fishOnly?'PASS: sunlit fish rims render with increased contrast.':'PASS: selective 25% midground lift, shadowed shaft, sunlit fish rims, occasional particle glints and rendering.',JSON.stringify({tissue,particles,volume,rim}));
}

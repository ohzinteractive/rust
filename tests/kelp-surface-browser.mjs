import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function checkKelpSurface({run,call}){
  const optics=await run("import('./tests/kelp-water-gpu.js').then(m=>m.checkWaterOptics(peelDebug.renderer))");
  assert(optics.normalFresnel<.03&&optics.grazingFresnel>.7,JSON.stringify(optics));
  assert(optics.refractionDifference>.1&&optics.refractionDifference<8&&optics.changedPixels>100,JSON.stringify(optics));
  assert(optics.deep.every((v,i)=>v<optics.near[i]),JSON.stringify(optics));
  assert(optics.deep[0]/optics.near[0]<optics.deep[2]/optics.near[2],'Red attenuates faster than blue');
  assert(optics.glint>optics.offGlint*4&&optics.glint<.03,JSON.stringify(optics));
  assert(optics.ripple>0&&optics.fadedRipple===0,JSON.stringify(optics));
  assert(optics.nearWaveDetail>.01&&optics.farWaveDetail<optics.nearWaveDetail*.05,JSON.stringify(optics));
  console.log('PASS: water Fresnel, depth-aware refraction, spectral attenuation, directional glints and fading ripples.',JSON.stringify(optics));
  await call('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:1,mobile:false});
  await run(`document.getElementById('kelp-material').click();peelDebug.kelp.setPlaying(false);peelDebug.controls.enableDamping=false;`);
  const frames=[];
  for(const offset of [-1,-.12,0,.12,.7,2]){
    const result=await run(`(()=>{const d=peelDebug,y=d.kelpEnvironment.surfaceY;
      d.camera.position.set(.5,y+${offset},10);d.controls.target.set(0,y+.05,-20);d.controls.update();d.renderScene();
      const gl=d.renderer.getContext(),p=new Uint8Array(640*480*4);gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,p);
      let total=0,top=[0,0,0],bottom=[0,0,0];for(let i=0;i<p.length;i+=4){total+=p[i]+p[i+1]+p[i+2];const row=Math.floor(i/4/640);if(row>360)for(let c=0;c<3;c++)top[c]+=p[i+c];if(row<120)for(let c=0;c<3;c++)bottom[c]+=p[i+c];}
      return {mean:total/(640*480*3),top:top.map(v=>v/(640*119)),bottom:bottom.map(v=>v/(640*120))};})()`);
    assert(result.mean>5&&result.mean<245,JSON.stringify(result));assert(result.top.reduce((a,b)=>a+b,0)>25,'Waterline must not produce a black upper frame');
    frames.push(result);
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`/private/tmp/kelp-surface-${offset}.png`,Buffer.from(shot.result.data,'base64'));
  }
  assert(frames.at(-1).top[2]>frames.at(-1).top[0],'Above-water sky is blue');
  assert(frames.at(-1).top[0]>frames[0].top[0],'Sky clears as the camera emerges');
  await run(`(()=>{const d=peelDebug;d.camera.position.set(1,d.kelpEnvironment.surfaceY+7,8);d.controls.target.set(0,2,0);d.controls.update();d.renderScene();})()`);
  const overhead=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/private/tmp/kelp-surface-overhead.png',Buffer.from(overhead.result.data,'base64'));
  await run(`(()=>{const d=peelDebug;d.camera.position.set(0,d.kelpEnvironment.surfaceY+1.1,14);d.controls.target.set(0,d.kelpEnvironment.surfaceY-4,0);d.controls.update();d.renderScene();})()`);
  const oblique=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/private/tmp/kelp-surface-oblique.png',Buffer.from(oblique.result.data,'base64'));
  assert(await run(`(()=>{document.getElementById('kelp-surface').click();return document.getElementById('kelp-surface').getAttribute('aria-pressed')==='true';})()`));
  console.log('PASS: underwater, wave-level and above-water views render without blank frames; surface control starts a crossing.',JSON.stringify(frames));
}

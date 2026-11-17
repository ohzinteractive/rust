import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpAtmosphere({run,call}){
  const lighting=await run(`import('./tests/kelp-atmosphere-gpu.js').then(m=>m.checkParticleLighting(peelDebug.renderer))`);
  assert(lighting.baseline>0&&Math.abs(lighting.gain-1.25)<.025,JSON.stringify(lighting));
  assert(lighting.shadowRatio<.005,'Shadowed particles remain nearly invisible');
  assert.equal(lighting.count,480);assert.deepEqual([lighting.near,lighting.mid,lighting.far],[32,288,160]);
  assert(lighting.transition.every(Number.isFinite));
  for(let i=1;i<lighting.transition.length;i++)assert(lighting.transition[i]>=lighting.transition[i-1]-.001,'Shadow transitions are continuous and monotonic');
  await call('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:1,mobile:false});
  await run(`document.getElementById('kelp-material').click();document.querySelector('[data-shape=pill]').click();
    peelDebug.kelp.setPlaying(false);peelDebug.kelpFish.setVisible(false);peelDebug.kelpEnvironment.bubbles.group.visible=false;
    peelDebug.controls.enableDamping=false;peelDebug.renderScene();`);
  const motion=await run(`(()=>{
    const {kelp,kelpAttractor:subject,kelpEnvironment:water,camera,controls,renderer}=peelDebug;
    const gl=renderer.getContext(),size={x:gl.drawingBufferWidth,y:gl.drawingBufferHeight};
    kelp.setPlaying(true);
    const pixels=new Uint8Array(size.x*size.y*4),frames=[];
    for(let i=0;i<14;i++){
      const angle=-.12+i*.018;
      camera.position.set(Math.sin(angle)*10.5,2.5,2.5+Math.cos(angle)*10.5);controls.target.copy(subject.center);controls.update();
      kelp.setViewingCorridor(camera.position,subject,1/30);kelp.advance(1/30);water.advance(1/30);renderer.shadowMap.needsUpdate=true;peelDebug.renderScene();
      gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let mean=0,gray=0,n=0;for(let p=0;p<pixels.length;p+=64){const r=pixels[p],g=pixels[p+1],b=pixels[p+2];mean+=(r+g+b)/765;if(Math.min(r,g,b)>165&&Math.max(r,g,b)-Math.min(r,g,b)<20)gray++;n++;}
      frames.push({mean:mean/n,gray:gray/n,history:water.getLightingDiagnostics().historyWeight});
    }
    kelp.setPlaying(false);return frames;
  })()`);
  assert(motion.some(f=>f.history>0),'A slow camera move reprojects depth-validated history');
  assert(motion.every(f=>Number.isFinite(f.mean)&&f.mean>.005&&f.gray<.4),'No blank or pale-gray frames in the tested camera sweep: '+JSON.stringify(motion));
  for(let i=1;i<motion.length;i++)assert(Math.abs(motion[i].mean-motion[i-1].mean)<.18,'No sudden full-frame luminance spike');
  await run('peelDebug.kelpEnvironment.bubbles.group.visible=true;peelDebug.renderScene()');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/private/tmp/oxide-kelp-atmosphere.png',Buffer.from(shot.result.data,'base64'));
  console.log('PASS: sun-only 25% particle gain, shadow suppression, three particle layers, smooth shadow transitions and camera sweep without gray-frame flashes.',JSON.stringify({lighting,motion}));
}

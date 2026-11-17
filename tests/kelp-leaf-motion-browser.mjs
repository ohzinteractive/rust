import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

export async function checkKelpLeafMotion({run,call}){
  await mkdir('/private/tmp/kelp-motion-check',{recursive:true});
  await call('Emulation.setDeviceMetricsOverride',{width:800,height:650,deviceScaleFactor:1,mobile:false});
  await run(`document.getElementById('kelp-material').click();document.querySelector('[data-shape=pill]').click();
    const {kelp,kelpFish,kelpEnvironment:water,kelpAttractor:subject,camera,controls}=peelDebug;
    window.motionStep=kelp.advance;window.motionView=kelp.setViewingCorridor;
    kelp.advance=()=>false;kelp.setViewingCorridor=()=>false;kelp.setPlaying(true);
    kelpFish.setVisible(false);water.bubbles.group.visible=false;controls.enableDamping=false;
    controls.target.set(-4.2,1.5,.8);camera.position.set(-1.2,1.9,6.8);controls.update();
    for(let i=0;i<180;i++){motionView(camera.position,subject,1/60);motionStep(1/60);}
    window.motionPrevious=kelp.getLeafPhysics().texture.image.data.slice();
    window.motionTips=Array.from({length:kelp.stats.blades},(_,i)=>kelp.getBladeTarget(i,camera.position.clone()));
    window.motionBounds={correction:0,tip:0};peelDebug.renderScene();`);
  for(let frame=0;frame<24;frame++){
    await run(`(()=>{
      const {kelp,kelpAttractor:subject,camera,controls,renderer}=peelDebug;
      camera.position.set(-1.2+${Math.max(0,frame-11)*.05},1.9,6.8);controls.update();
      for(let step=0;step<5;step++){
        motionView(camera.position,subject,1/60);motionStep(1/60);
        const data=kelp.getLeafPhysics().texture.image.data;
        for(let i=0;i<data.length;i+=4)motionBounds.correction=Math.max(motionBounds.correction,Math.hypot(data[i]-motionPrevious[i],data[i+1]-motionPrevious[i+1],data[i+2]-motionPrevious[i+2]));
        motionPrevious.set(data);
        for(let i=0;i<motionTips.length;i++){
          const p=kelp.getBladeTarget(i,camera.position.clone());
          motionBounds.tip=Math.max(motionBounds.tip,p.distanceTo(motionTips[i]));motionTips[i].copy(p);
        }
      }
      renderer.shadowMap.needsUpdate=true;peelDebug.renderScene();
    })()`);
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile('/private/tmp/kelp-motion-check/frame-'+String(frame).padStart(3,'0')+'.png',Buffer.from(shot.result.data,'base64'));
  }
  const bounds=await run('motionBounds');
  assert(bounds.correction<.012,'Display corrections stay continuous between simulation ticks: '+JSON.stringify(bounds));
  assert(bounds.tip<.045,'A moving camera cannot produce an abrupt leaf-tip jump: '+JSON.stringify(bounds));
  assert(await run('(()=>{const p=peelDebug.kelp.getLeafPhysics().texture.image.data;for(let i=0;i<p.length;i+=36)if(Math.hypot(p[i],p[i+1],p[i+2])>1e-6)return false;return p.every(Number.isFinite);})()'),'Attachments remain pinned and motion stays finite');
  console.log('PASS: rendered leaf motion with a stationary and moving camera, interpolated collisions, bounded tip speeds and fixed attachments.',JSON.stringify(bounds));
}

import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpLightingSliders({run,call}){
  await run(`document.getElementById('kelp-material').click();peelDebug.kelp.setPlaying(false);
    document.getElementById('kelp-settings-toggle').click();document.querySelector('.kelp-lighting-inspection').open=true;
    window.setLight=(name,value)=>{const input=document.getElementById('kelp-light-'+name);input.value=value;input.dispatchEvent(new Event('input'));};
    window.readLight=()=>import('./tests/kelp-lighting-diagnostics.js').then(m=>m.readKelpLightingDiagnostics({renderer:peelDebug.renderer,environment:peelDebug.kelpEnvironment,scene:peelDebug.scene,attractor:peelDebug.kelpAttractor,renderScene:peelDebug.renderScene}));
    const view=document.getElementById('kelp-lighting-view');view.value='scattering';view.dispatchEvent(new Event('change'));
    void 0;`);
  const before=await run('readLight()');assert(before.volumeMean>0);
  await run("setLight('scattering',0)");
  assert.equal((await run('readLight()')).volumeMean,0,'Zero water scattering extinguishes the actual radiance buffer');
  await run("setLight('scattering',100);setLight('sunlight',0)");
  assert.equal((await run('readLight()')).volumeMean,0,'Sunlight supplies the scattered radiance');
  await run("setLight('sunlight',100);setLight('ambient',40);setLight('shadows',25);setLight('bloom',200)");
  assert(await run(`(()=>{
    const s=peelDebug.kelpEnvironment.lightingSettings;
    return s.sunlight===1&&s.ambient===.4&&s.scattering===1&&s.shadows===.25&&s.bloom===2
      &&document.getElementById('kelp-light-bloom-value').value==='200%';
  })()`));
  await run(`document.getElementById('kelp-light-reset').click();void 0`);
  assert(await run("JSON.stringify(peelDebug.kelpEnvironment.lightingSettings)===JSON.stringify({sunlight:1.72,ambient:.16,scattering:2.81,shadows:.96,bloom:2.96})"));
  const restored=await run('readLight()');assert.equal(restored.volumeMean,before.volumeMean);
  await run(`const v=document.getElementById('kelp-lighting-view');v.value='final';v.dispatchEvent(new Event('change'));peelDebug.renderScene();`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert(await run(`(()=>{const b=document.getElementById('kelp-light-reset');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b&&document.documentElement.scrollWidth<=innerWidth;})()`),'Controls remain reachable on mobile');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/private/tmp/oxide-kelp-lighting-sliders.png',Buffer.from(shot.result.data,'base64'));
  console.log('PASS: lighting sliders, sunlight/scattering interaction, radiance buffer updates, reset, shader rendering and mobile controls.');
}

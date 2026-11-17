import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelpLighting({run,call,delay,prefix='current'}){
  await run('document.getElementById("kelp-material").click();document.querySelector("[data-shape=cube]").click();peelDebug.kelp.setPlaying(true);for(let i=0;i<600;i++){peelDebug.kelp.advance(.05);peelDebug.kelpFish.advance(.05);}peelDebug.kelp.setPlaying(false);peelDebug.controls.enableDamping=false;peelDebug.controls.update();peelDebug.renderer.shadowMap.needsUpdate=true;peelDebug.renderScene()');
  const original=await run('JSON.stringify({environment:peelDebug.scene.environmentIntensity,lights:peelDebug.scene.children.filter(o=>o.isLight).map(o=>o.intensity)})');
  const reports={};
  const select=mode=>run(`(()=>{const view=document.getElementById('kelp-lighting-view');view.value='${mode}';view.dispatchEvent(new Event('change'));peelDebug.renderScene();})()`);
  try{
    for(const mode of ['visibility','volume-visibility','scattering','direct','final']){
      await select(mode);
      assert.equal(await run('peelDebug.kelpEnvironment.lightingView'),mode,'Settings select controls the actual pass');
      reports[mode]=await run(`import('./tests/kelp-lighting-diagnostics.js').then(m=>m.readKelpLightingDiagnostics({renderer:peelDebug.renderer,environment:peelDebug.kelpEnvironment,scene:peelDebug.scene,attractor:peelDebug.kelpAttractor,renderScene:peelDebug.renderScene}))`);
      const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-kelp-${prefix}-${mode}.png`,Buffer.from(shot.result.data,'base64'));
      assert(reports[mode].matrixError<1e-8&&reports[mode].shadowTextureMatches,'Uses the actual sun shadow texture and world transform');
      assert(reports[mode].shapeInsideShadowFrustum,'The rectangle is the cube, fully inside the shadow frustum');
      assert.equal(await run('JSON.stringify({environment:peelDebug.scene.environmentIntensity,lights:peelDebug.scene.children.filter(o=>o.isLight).map(o=>o.intensity)})'),original,'Direct-only diagnostics restore illumination');
    }
    const visibility=await run(`import('./tests/kelp-volumetrics-gpu.js').then(m=>m.compareKelpSunVisibility({renderer:peelDebug.renderer,environment:peelDebug.kelpEnvironment,scene:peelDebug.scene,attractor:peelDebug.kelpAttractor}))`);
    assert(visibility.meanError<.05&&visibility.lit>20&&visibility.shadowed>20,'Surface and water lookups agree at shared world positions: '+JSON.stringify(visibility));reports.worldVisibility=visibility;
    await select('scattering');
    assert(await run('!document.getElementById("kelp-preview-gain-control").hidden'));
    await run('document.getElementById("kelp-preview-gain").value=8;document.getElementById("kelp-preview-gain").dispatchEvent(new Event("input"));void 0');
    reports.gain=await run(`import('./tests/kelp-lighting-diagnostics.js').then(m=>m.readKelpLightingDiagnostics({renderer:peelDebug.renderer,environment:peelDebug.kelpEnvironment,scene:peelDebug.scene,attractor:peelDebug.kelpAttractor,renderScene:peelDebug.renderScene}))`);
    assert.equal(reports.gain.volumeMean,reports.scattering.volumeMean,'Preview gain leaves the radiance buffer unchanged');assert(reports.gain.meanBrightness>reports.scattering.meanBrightness*1.5);
    await select('final');
    const finalAfterGain=await run(`import('./tests/kelp-lighting-diagnostics.js').then(m=>m.readKelpLightingDiagnostics({renderer:peelDebug.renderer,environment:peelDebug.kelpEnvironment,scene:peelDebug.scene,attractor:peelDebug.kelpAttractor,renderScene:peelDebug.renderScene}))`);
    assert.equal(finalAfterGain.meanBrightness,reports.final.meanBrightness,'Preview gain cannot affect the final scene');
    await run('document.getElementById("horse-shape").click()');
    for(let i=0;i<100;i++){await delay(100);if(await run('!document.getElementById("horse-shape").disabled'))break;}
    assert.equal(await run('peelDebug.kelpAttractor.shape'),'horse');
    await run('window.inspectionMesh=peelDebug.kelpAttractor.group.children[0];window.inspectionPose=JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()]);document.getElementById("kelp-cube-reference").click();void 0');
    assert(await run('peelDebug.kelpAttractor.cubeReference&&peelDebug.kelpAttractor.shape==="cube"'));
    await run('document.getElementById("kelp-cube-reference").click();peelDebug.renderScene()');
    assert(await run('peelDebug.kelpAttractor.group.children[0]===inspectionMesh&&peelDebug.kelpAttractor.shape==="horse"&&!peelDebug.kelpAttractor.cubeReference&&document.getElementById("horse-shape").getAttribute("aria-pressed")==="true"'));
    assert.equal(await run('JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()])'),await run('inspectionPose'),'Cube reference keeps the camera unchanged');
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-kelp-${prefix}-sculpture.png`,Buffer.from(shot.result.data,'base64'));
    reports.corridor=await run(`import('./tests/kelp-volumetrics-gpu.js').then(m=>m.checkKelpCorridor({renderer:peelDebug.renderer,environment:peelDebug.kelpEnvironment,scene:peelDebug.scene,attractor:peelDebug.kelpAttractor,renderScene:peelDebug.renderScene}))`);
    assert(reports.corridor.lit.incidentMean>.65,'Sunlight actually reaches the central water column: '+JSON.stringify(reports.corridor));
    assert(reports.corridor.shadowed.incidentMean<.15&&reports.corridor.rawChanged>100&&reports.corridor.meanRawLoss>.0001,'Blocking the source extinguishes the shaft in the raw pass: '+JSON.stringify(reports.corridor));
    await call('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});await delay(300);
    await run('document.getElementById("reset-view").click();peelDebug.renderScene()');
    for(const mode of ['scattering','final']){
      await select(mode);
      const wide=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-kelp-${prefix}-wide-${mode}.png`,Buffer.from(wide.result.data,'base64'));
    }
    await run('document.getElementById("kelp-settings-toggle").click();document.querySelector(".kelp-lighting-inspection").open=true;void 0');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
    assert(await run('(()=>{const view=document.getElementById("kelp-lighting-view");view.scrollIntoView({block:"center"});const r=view.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===view;})()'),'Inspection select is reachable on mobile');
    await select('scattering');await run('document.querySelector("[data-metal=iron]").click();document.getElementById("kelp-material").click();void 0');
    assert(await run('peelDebug.kelpEnvironment.lightingView==="final"&&peelDebug.kelpEnvironment.lightingPreviewGain===1&&document.getElementById("kelp-lighting-view").value==="final"'),'Scene reentry restores normal lighting');
  }finally{await run('peelDebug.kelpEnvironment.setLightingView("final");peelDebug.renderScene()');}
  await writeFile(`/private/tmp/oxide-kelp-${prefix}-lighting.json`,JSON.stringify(reports,null,2));
  assert(reports.visibility.blackFraction>.01&&reports.visibility.whiteFraction>.01,'Visibility shows both lit and occluded regions: '+JSON.stringify(reports.visibility));
  assert(reports.scattering.volumePeak>0&&reports.scattering.volumeNonzeroFraction>.1,'Ray march produces nonzero light');
  assert.equal(reports.final.sunIntensity,9,'Sun intensity stays at its existing value');
  console.log('PASS: isolated light passes, shared world visibility, preview gain isolation, reversible cube reference, mobile controls and state restoration.',JSON.stringify(reports));
}

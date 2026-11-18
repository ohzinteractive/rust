import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkKelp({run,call,delay}){
  const input=async(id,value)=>run(`(()=>{const input=document.getElementById('${id}');input.value=${value};input.dispatchEvent(new Event('input'));})()`);
  const checkSeabedFocus=async()=>assert(await run('peelDebug.controls.target.y>=peelDebug.kelp.group.position.y&&peelDebug.controls.target.y<peelDebug.kelp.group.position.y+.5&&peelDebug.camera.position.y>peelDebug.controls.target.y+1&&peelDebug.camera.position.y<peelDebug.kelpEnvironment.surfaceY'),'Camera aims down at the seabed clearing from inside the water');
  await run('window.kelpStudio={background:peelDebug.scene.background,fog:peelDebug.scene.fog,position:peelDebug.camera.position.clone(),target:peelDebug.controls.target.clone(),minDistance:peelDebug.controls.minDistance,shadowType:peelDebug.renderer.shadowMap.type};document.getElementById("kelp-material").click();peelDebug.renderScene()');
  assert(await run("peelDebug.state.material==='kelp'&&peelDebug.kelp.group.visible&&peelDebug.kelpEnvironment.enabled&&!peelDebug.core.parent.visible&&!peelDebug.palm.group.visible&&!peelDebug.fern.group.visible"));
  assert(await run("document.getElementById('kelp-material').getAttribute('aria-pressed')==='true'&&!document.getElementById('kelp-controls').hidden&&document.getElementById('exposure-controls').hidden"));
  assert(await run('peelDebug.kelp.stats.blades>768&&peelDebug.kelp.stats.blades<1536&&peelDebug.kelp.stats.blades===peelDebug.kelp.stats.floats'));
  assert(await run('peelDebug.kelpEnvironment.surfaceY===-1.75+11.25&&peelDebug.kelpEnvironment.enabled'),'Water surface aligns with the mature canopy');
  await checkSeabedFocus();
  await run('window.kelpPose=[peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()];window.kelpGeometry=peelDebug.kelp.group.children[1].geometry;document.getElementById("kelp-pause").click()');
  await delay(600);assert(await run('peelDebug.kelp.elapsed>0'));
  await run('document.getElementById("kelp-pause").click();window.kelpTime=peelDebug.kelp.elapsed');
  await delay(200);assert(await run('peelDebug.kelp.elapsed===kelpTime&&peelDebug.kelp.group.children[1].geometry===kelpGeometry'));
  assert(await run('[peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()].every((v,i)=>v.every((x,j)=>Math.abs(x-kelpPose[i][j])<1e-8))'),'Current does not move the camera: '+JSON.stringify(await run('({before:kelpPose,after:[peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()]})')));
  await input('kelp-current',85);await input('kelp-direction',180);
  assert(await run('peelDebug.kelp.settings.current===.85&&peelDebug.kelp.settings.direction===180&&peelDebug.kelp.group.children[1].geometry===kelpGeometry'),'Current changes uniforms without rebuilding meshes');
  for(const strength of [0,100,35]){
    await input('kelp-scattering',strength);
    assert(await run(`peelDebug.kelp.settings.scattering===${strength/100}&&document.getElementById('kelp-scattering-value').value==='${strength}%'&&peelDebug.kelp.group.children[1].geometry===kelpGeometry`),'Scattering updates live without rebuilding kelp');
    assert(await run(`peelDebug.kelp.group.children.slice(1,3).every(mesh=>Math.abs(mesh.material.userData.kelpSubsurface.value-${strength/100}*mesh.material.userData.kelpScatteringScale)<1e-8)`),'Both leaves and floats receive the scattering strength');
    await run('peelDebug.renderScene()');
  }
  await input('kelp-strands',12);await input('kelp-generations',3);
  assert(await run('peelDebug.kelp.stats.blades>144&&peelDebug.kelp.stats.blades<288'));
  assert(await run('peelDebug.kelp.settings.scattering===.35&&peelDebug.kelp.group.children[1].material.userData.kelpSubsurface.value===.35'),'Scattering persists after rebuilding');
  await input('kelp-scattering',100);
  await input('kelp-height',9);assert(await run('peelDebug.kelp.settings.height===9'));
  await input('kelp-strands',48);await input('kelp-generations',4);await input('kelp-height',11);await input('kelp-current',100);await input('kelp-direction',60);
  await run('document.getElementById("kelp-regrow").click();peelDebug.renderScene()');
  assert(await run('[peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()].every((v,i)=>v.every((x,j)=>Math.abs(x-kelpPose[i][j])<1e-8))'),'Settings and regeneration preserve camera position');
  for(const mobile of [false,true]){
    if(mobile){
      await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      for(let i=0;i<30;i++){await delay(100);if(await run("Math.abs(peelDebug.camera.aspect-document.getElementById('canvas-wrap').clientWidth/document.getElementById('canvas-wrap').clientHeight)<.001"))break;}
      await run('document.getElementById("reset-view").click()');
    }
    await run('peelDebug.renderScene()');
    await checkSeabedFocus();
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-kelp${mobile?'-mobile':''}.png`,Buffer.from(shot.result.data,'base64'));
    assert(await run('document.documentElement.scrollWidth<=innerWidth'),'No horizontal page overflow');
    assert(await run("(()=>{const buttons=[...document.getElementById('kelp-material').parentElement.children];return Math.max(...buttons.map(b=>b.getBoundingClientRect().top))-Math.min(...buttons.map(b=>b.getBoundingClientRect().top))<2;})()"),'Material controls remain on one row');
    await run('document.getElementById("kelp-settings-toggle").click()');
    assert(await run("(()=>{const input=document.getElementById('kelp-current');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===input;})()"),'Current control is reachable');
    await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");assert(await run("document.getElementById('kelp-options').hidden"));
  }
  await run('document.querySelector("[data-metal=iron]").click()');
  assert(await run('!peelDebug.kelp.group.visible&&!peelDebug.kelpEnvironment.enabled&&peelDebug.scene.background===kelpStudio.background&&peelDebug.scene.fog===kelpStudio.fog&&peelDebug.controls.minDistance===kelpStudio.minDistance&&peelDebug.renderer.shadowMap.type===kelpStudio.shadowType'),'Metal restores studio lighting and controls');
  await run('document.getElementById("fern-material").click();window.fernBackdrop=peelDebug.scene.background;document.getElementById("kelp-material").click();document.getElementById("fern-material").click()');
  assert(await run('peelDebug.fern.group.visible&&!peelDebug.kelp.group.visible&&peelDebug.scene.background===fernBackdrop'),'Fern environment survives round trip through kelp');
  await run('document.getElementById("kelp-material").click();document.querySelector("[data-shape=cube]").click()');
  assert(await run('peelDebug.state.material==="kelp"&&peelDebug.kelpEnvironment.enabled&&peelDebug.kelpAttractor.shape==="cube"&&!peelDebug.core.parent.visible'),'Shape selection adds an attractor and keeps the underwater scene');
  await run('document.getElementById("kelp-remove-shape").click()');
  await run('document.getElementById("rotate").click();document.getElementById("oasis-material").click();document.getElementById("kelp-material").click();peelDebug.renderScene()');
  assert(await run('!peelDebug.state.rotate&&!peelDebug.controls.autoRotate'),'Leaving Oasis cannot restore automatic camera rotation in kelp');
  assert(await run('peelDebug.kelpEnvironment.enabled&&!peelDebug.oasis.group.visible&&!peelDebug.palm.group.visible&&!peelDebug.scene.getObjectByName("Desert sky").visible'),'Kelp replaces the desert environment');
  await run('document.getElementById("oasis-material").click();peelDebug.renderScene()');
  assert(await run('!peelDebug.kelpEnvironment.enabled&&peelDebug.oasis.group.visible&&peelDebug.palm.group.visible&&peelDebug.scene.getObjectByName("Desert sky").visible'),'Oasis returns to desert lighting and sky');
  await run('document.querySelector("[data-metal=iron]").click()');
  assert(await run('peelDebug.scene.background===kelpStudio.background&&peelDebug.scene.fog===kelpStudio.fog'),'Environment restores after a kelp and oasis round trip');
  console.log('PASS: kelp shaders, fixed camera, current controls, pause, settings, desktop/mobile layout and scene restoration.');
}

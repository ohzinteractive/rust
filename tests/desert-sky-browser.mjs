import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkDesertSky({run,call,delay}){
  const input=async(id,value)=>{
    assert(await run(`(()=>{const input=document.getElementById('${id}');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();if(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)!==input)return false;input.value=${value};input.dispatchEvent(new Event('input'));return true;})()`),id+' is reachable');
  };
  const skyPixels=`(()=>{peelDebug.renderScene();const gl=peelDebug.renderer.getContext(),pixels=[];for(let x=1;x<10;x++){const sample=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth*x/10),Math.floor(gl.drawingBufferHeight*.9),1,1,gl.RGBA,gl.UNSIGNED_BYTE,sample);pixels.push(...sample.slice(0,3));}return pixels;})()`;
  for(const mobile of [false,true]){
    await call('Emulation.setDeviceMetricsOverride',{width:mobile?390:1050,height:mobile?844:850,deviceScaleFactor:1,mobile});
    await run(`window.skyStudio={background:peelDebug.scene.background,key:peelDebug.scene.children.find(o=>o.isDirectionalLight&&o.castShadow).position.clone()};document.getElementById('oasis-material').click()`);
    assert(await run("!document.getElementById('oasis-controls').hidden&&!document.getElementById('oasis-options').hidden&&document.getElementById('feather-controls').hidden&&document.getElementById('feather-options').hidden&&document.getElementById('oasis-material').getAttribute('aria-pressed')==='true'&&document.getElementById('feather-material').getAttribute('aria-pressed')==='false'&&document.getElementById('oasis-options').contains(document.getElementById('palm-camera-light'))&&document.getElementById('metal-name').textContent==='OASIS'"),'Oasis has a dedicated selected swatch, settings and scene label');
    if(!mobile){
      assert(await run("peelDebug.camera.fov===48&&peelDebug.state.palmView.elevation===10&&peelDebug.state.palmView.azimuth===322&&peelDebug.state.palmMirage===.7&&peelDebug.palm.stats.fronds===41&&JSON.stringify(Object.fromEntries(['fronds','density','dryFraction','length','droop','curve','wind'].map(k=>[k,peelDebug.state.palmSettings[k]])))===JSON.stringify({fronds:41,density:.95,dryFraction:.38,length:1.66,droop:1.39,curve:.4,wind:.48})"),'Oasis opens with the exact requested preset');
      for(const [key,value] of [['fronds','41'],['density','95%'],['dryFraction','38%'],['length','1.66'],['droop','139%'],['curve','40%'],['wind','48%']])assert(await run(`document.getElementById('palm-${key}-value').value===${JSON.stringify(value)}`),'Preset output '+key+' matches its actual setting');
    }
    assert(await run("(()=>{const row=document.getElementById('oasis-material').parentElement;return row.children[4].id==='feather-material'&&row.children[5].id==='oasis-material'&&row.children[6].id==='cloth-material';})()"),'The palm icon sits beside Feathers and Cloth');
    assert(await run("document.getElementById('surface-view').textContent==='Building'&&document.getElementById('layers-view').textContent==='Oasis'&&!document.getElementById('layers-view').disabled&&document.getElementById('layers-view').getAttribute('aria-pressed')==='true'&&document.querySelector('.view-mode').getAttribute('aria-label')==='Scene view'"),'Palm mode replaces Surface/Layers with an enabled Building/Oasis camera switch');
    await run("document.getElementById('surface-view').click()");
    let ready=false;for(let i=0;i<75;i++){ready=await run("peelDebug.scene.getObjectByName('Jeddah building').children.length>0");if(ready)break;await delay(200);}assert(ready,'The distant tower loads');
    for(let i=0;i<20&&!(await run('peelDebug.controls.target.x< -400'));i++)await delay(100);
    assert(await run("peelDebug.controls.target.x< -400&&peelDebug.controls.target.y>50&&document.getElementById('surface-view').getAttribute('aria-pressed')==='true'&&document.getElementById('layers-view').getAttribute('aria-pressed')==='false'&&peelDebug.oasis.group.visible&&!peelDebug.state.palmTowerCloth"),'Building view frames Jeddah without hiding the oasis or starting cloth');
    await run("document.getElementById('reset-view').click()");
    assert(await run("peelDebug.controls.target.x< -400&&document.getElementById('surface-view').getAttribute('aria-pressed')==='true'"),'Reset preserves Building view');
    await run("document.getElementById('layers-view').click()");
    assert(await run("Math.abs(peelDebug.controls.target.x+3.5)<.001&&peelDebug.controls.maxDistance===45&&document.getElementById('layers-view').getAttribute('aria-pressed')==='true'"),'Oasis view restores its camera framing');
    assert(await run("peelDebug.scene.getObjectByName('Desert sky').isSky&&peelDebug.scene.getObjectByName('Desert sky').visible"),'The desert uses the Three.js Sky');
    await run("document.getElementById('oasis-settings-close').click();peelDebug.renderScene();window.skyGeometry=peelDebug.palm.group.getObjectByName('Green palm frond').geometry;window.skyCameraPosition=peelDebug.camera.position.clone()");
    const initialSky=await run(skyPixels);
    assert(initialSky.every(v=>Number.isFinite(v)&&v>0)&&initialSky.some(v=>v<250),'The atmospheric sky is visible and not clipped to white');
    const initialShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`/private/tmp/oxide-sky${mobile?'-mobile':''}.png`,Buffer.from(initialShot.result.data,'base64'));
    await run("document.getElementById('oasis-settings-toggle').click()");
    await input('palm-camera-fov',44);
    assert(await run("peelDebug.camera.fov===44&&peelDebug.state.palmView.fov===44&&peelDebug.camera.position.distanceTo(skyCameraPosition)<1e-6"),'FOV changes the lens without moving the camera');
    await input('palm-sun-elevation',28);await input('palm-sun-azimuth',240);
    assert(await run(`(async()=>{const THREE=await import('/vendor/three.module.js'),d=peelDebug,key=d.scene.children.find(o=>o.isDirectionalLight&&o.castShadow),direction=key.position.clone().sub(key.target.position).normalize(),expected=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(62),THREE.MathUtils.degToRad(240));return direction.distanceTo(expected)<1e-9&&direction.distanceTo(d.scene.getObjectByName('Desert sky').material.uniforms.sunPosition.value)<1e-9&&direction.distanceTo(d.oasis.water.material.uniforms.uSunDirection.value)<1e-9&&d.palm.group.getObjectByName('Green palm frond').geometry===skyGeometry;})()`),'Sky, shadow light and water use the requested sun direction without rebuilding palms');
    const changedSky=await run(skyPixels);
    assert(changedSky.reduce((sum,v,i)=>sum+Math.abs(v-initialSky[i]),0)>100,'Moving the sun changes actual rendered sky pixels');
    await call('Emulation.setDeviceMetricsOverride',{width:mobile?420:1100,height:mobile?800:880,deviceScaleFactor:1,mobile});await delay(250);
    assert(await run('peelDebug.camera.fov===44'),'Resizing preserves a custom FOV');
    await run("document.getElementById('reset-view').click()");
    assert(await run('peelDebug.camera.fov===44&&peelDebug.state.palmView.elevation===28&&peelDebug.state.palmView.azimuth===240'),'Reset view preserves the lens and sun');
    await run("document.getElementById('oasis-settings-toggle').click();document.getElementById('palm-regrow').click();document.getElementById('palm-oasis').click()");
    assert(await run('peelDebug.camera.fov===44&&peelDebug.state.palmView.azimuth===240'),'Regrowing and switching oasis retain settings');
    await run("document.querySelector('[name=palm-environment][value=studio]').click()");
    assert(await run("document.getElementById('surface-view').disabled&&!document.getElementById('layers-view').disabled&&document.getElementById('layers-view').getAttribute('aria-pressed')==='true'"),'The unavailable building view is disabled in the dark studio');
    assert(await run("!peelDebug.scene.getObjectByName('Desert sky').visible&&peelDebug.scene.background===skyStudio.background&&peelDebug.scene.children.find(o=>o.isDirectionalLight&&o.castShadow).position.distanceTo(skyStudio.key)<1e-9&&document.getElementById('palm-sun-settings').disabled&&peelDebug.camera.fov===44"),'Studio lighting is restored while the lens remains editable');
    await run("document.querySelector('[name=palm-environment][value=desert]').click();document.getElementById('palm-oasis').click()");
    assert(await run("peelDebug.scene.getObjectByName('Desert sky').visible&&!document.getElementById('palm-sun-settings').disabled&&peelDebug.state.palmView.azimuth===240&&peelDebug.camera.fov===44"),'Returning to the desert preserves the chosen sun and lens');
    await run("document.getElementById('palm-sun-reset').click()");
    assert(await run('peelDebug.state.palmView.elevation===10&&peelDebug.state.palmView.azimuth===322&&peelDebug.camera.fov===44'),'Reset sun restores the default sun independently of the camera');
    await run("document.getElementById('palm-camera-auto').click()");
    assert(await run('peelDebug.state.palmView.fov===null&&peelDebug.camera.fov>=70'),'Auto FOV restores responsive framing');
    await call('Emulation.setDeviceMetricsOverride',{width:mobile?390:1050,height:mobile?844:850,deviceScaleFactor:1,mobile});await delay(250);
    await run("document.getElementById('palm-camera-fov').scrollIntoView({block:'center'});document.getElementById('toast').classList.remove('show');peelDebug.renderScene()");
    const settingsShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`/private/tmp/oxide-sky-settings${mobile?'-mobile':''}.png`,Buffer.from(settingsShot.result.data,'base64'));
    await run("document.getElementById('palm-exit').click()");
    assert(await run("document.getElementById('surface-view').textContent==='Surface'&&document.getElementById('layers-view').textContent==='Layers'&&document.getElementById('layers-view').disabled&&document.querySelector('.view-mode').getAttribute('aria-label')==='Material view'"),'Leaving palms restores the material view controls');
    assert(await run("!peelDebug.palm.group.visible&&document.getElementById('oasis-controls').hidden&&!document.getElementById('feather-controls').hidden&&!document.getElementById('feather-options').hidden&&document.getElementById('feather-material').getAttribute('aria-pressed')==='true'&&document.getElementById('oasis-material').getAttribute('aria-pressed')==='false'"),'Feather coat opens the original feather settings');
    await run("document.getElementById('oasis-material').click();document.getElementById('oasis-material').click()");
    assert(await run("document.getElementById('oasis-options').hidden&&peelDebug.palm.group.visible"),'Clicking the selected Oasis swatch toggles its settings without leaving the scene');
    await run("document.getElementById('oasis-settings-toggle').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert(await run("document.getElementById('oasis-options').hidden&&document.activeElement.id==='oasis-settings-toggle'"),'Escape closes Oasis settings and restores focus');
    await run("document.querySelector('[data-shape=cube]').click()");
    assert(await run("!peelDebug.palm.group.visible&&document.getElementById('oasis-material').getAttribute('aria-pressed')==='false'"),'Selecting the current shape exits Oasis cleanly');
    await run("document.querySelector('[data-metal=iron]').click()");
    assert(await run("!peelDebug.scene.getObjectByName('Desert sky').visible&&peelDebug.scene.userData.skyToneMapped===undefined"),'Exiting palms restores the original studio');
  }
}

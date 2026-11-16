import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkBuildingShadows({run,call,delay}){
  for(const mobile of [false,true]){
    await call('Emulation.setDeviceMetricsOverride',{width:mobile?390:1050,height:mobile?844:850,deviceScaleFactor:1,mobile});
    await run("document.getElementById('oasis-material').click();document.getElementById('surface-view').click()");
    let ready=false;for(let i=0;i<100;i++){ready=await run("peelDebug.scene.getObjectByName('Jeddah building').children.length>0&&peelDebug.controls.target.x< -400");if(ready)break;await delay(150);}assert(ready,'Building view loads');
    const bare=await run("import('/tests/desert-shadows-gpu.js').then(m=>m.checkDesertShadows(peelDebug))");console.log('Building ground shadow',JSON.stringify(bare));
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-building-shadow${mobile?'-mobile':''}.png`,Buffer.from(shot.result.data,'base64'));
    assert(bare.groundPixels>100&&bare.maxGroundDelta>8&&bare.shadowFar>1000,'The bare kilometer tower casts a visible long shadow on the sand at the default low sun');
    await run("document.getElementById('oasis-settings-toggle').click();document.getElementById('palm-sun-elevation').value=35;document.getElementById('palm-sun-elevation').dispatchEvent(new Event('input'))");
    const high=await run("import('/tests/desert-shadows-gpu.js').then(m=>m.checkDesertShadows(peelDebug))");
    assert(high.groundPixels>50&&high.shadowFar<bare.shadowFar*.6,'Changing sun height refits the shadow projection');
    await run("document.getElementById('palm-tower-cloth').click();document.getElementById('palm-tower-cloth-settings').click();document.getElementById('cloth-pause').click()");
    for(let batch=0;batch<6;batch++)await run('peelDebug.cloth.simulation.paused=false;for(let i=0;i<20;i++)peelDebug.cloth.advance(1/60);peelDebug.cloth.simulation.paused=true');
    await run("document.getElementById('cloth-settings-close').click();peelDebug.renderScene()");
    // Look along the downwind side so the broad sheet does not hide its own
    // ground shadow, especially in a portrait viewport.
    await run(`(async()=>{const THREE=await import('/vendor/three.module.js'),d=peelDebug,b=new THREE.Box3().setFromObject(d.scene.getObjectByName('Jeddah building')),h=b.max.y-b.min.y,sun=d.scene.getObjectByName('Desert sky').material.uniforms.sunPosition.value;d.controls.enableDamping=false;d.controls.target.copy(b.getCenter(new THREE.Vector3())).addScaledVector(new THREE.Vector3(sun.x,0,sun.z),-h*.35/sun.y);d.controls.target.y=b.min.y+h*.35;d.camera.position.copy(d.controls.target).add(new THREE.Vector3(-sun.x,.65,-sun.z).normalize().multiplyScalar(h*2.7));d.controls.update();d.renderScene();})()`);
    const wrapped=await run("import('/tests/desert-shadows-gpu.js').then(m=>m.checkDesertShadows(peelDebug))");console.log('Cloth ground shadow',JSON.stringify(wrapped));
    const wrappedShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-cloth-shadow${mobile?'-mobile':''}.png`,Buffer.from(wrappedShot.result.data,'base64'));
    assert(wrapped.groundPixels>100&&wrapped.maxGroundDelta>15,'The animated cloth also casts a ground shadow');
    await run("document.getElementById('layers-view').click();peelDebug.renderScene()");
    assert(await run("(()=>{const light=peelDebug.scene.children.find(o=>o.isDirectionalLight&&o.castShadow);return light.shadow.camera.far===80&&light.shadow.camera.right===14&&light.target.position.length()<1e-6;})()"),'Oasis view restores the small, crisp palm shadow volume');
    await run("document.getElementById('oasis-settings-toggle').click();document.getElementById('palm-tower-cloth').click();document.getElementById('palm-sun-reset').click();document.querySelector('[data-metal=iron]').click()");
    assert(await run("(()=>{const light=peelDebug.scene.children.find(o=>o.isDirectionalLight&&o.castShadow);return light.shadow.camera.far===22&&light.shadow.bias===-.0004&&light.target.position.length()<1e-6;})()"),'Leaving the desert restores studio shadow settings');
  }
}

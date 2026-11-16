import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function checkTowerCloth({run,call,delay}){
  for(const mobile of [false,true]){
    await call('Emulation.setDeviceMetricsOverride',{width:mobile?390:1050,height:mobile?844:850,deviceScaleFactor:1,mobile});
    await run("document.getElementById('oasis-material').click()");
    assert(await run("(()=>{const toggle=document.getElementById('palm-tower-cloth');toggle.scrollIntoView({block:'center'});const r=toggle.getBoundingClientRect();if(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)!==toggle)return false;toggle.click();return true;})()"),'Tower wrapping is reachable in Oasis settings');
    await run("document.getElementById('palm-tower-cloth-settings').click();document.getElementById('cloth-redrape').click()");
    let ready=false;for(let i=0;i<100;i++){ready=await run('!!peelDebug.cloth.simulation');if(ready)break;await delay(150);}assert(ready,'The tower loads and starts its drape');
    assert(await run("peelDebug.state.material==='feathers'&&peelDebug.state.palm&&peelDebug.state.palmTowerCloth&&peelDebug.oasis.group.visible&&peelDebug.mirage.enabled&&peelDebug.cloth===peelDebug.towerCloth.surface&&peelDebug.specimenCloth.mesh===null&&peelDebug.scene.getObjectByName('Jeddah tower cloth').visible&&peelDebug.controls.target.x< -400&&peelDebug.controls.target.y>50"),'The cloth starts on Jeddah without leaving the desert, and the camera frames the tower');
    await run("document.getElementById('palm-tower-cloth-settings').click();if(!peelDebug.cloth.simulation.paused)document.getElementById('cloth-pause').click();window.towerInitial=peelDebug.cloth.simulation.positions.slice()");
    assert(await run("document.getElementById('cloth-options').parentElement.id==='oasis-controls'&&!document.getElementById('cloth-options').hidden&&document.getElementById('oasis-options').hidden&&document.getElementById('cloth-options').getAttribute('aria-label')==='Jeddah Tower cloth settings'"),'The existing cloth settings open inside the Oasis dock');
    for(let batch=0;batch<6;batch++)await run('peelDebug.cloth.simulation.paused=false;for(let i=0;i<20;i++)peelDebug.cloth.advance(1/60);peelDebug.cloth.simulation.paused=true');
    const result=await run(`(async()=>{
      const THREE=await import('/vendor/three.module.js'),cloth=peelDebug.cloth,p=cloth.simulation.positions,tower=peelDebug.scene.getObjectByName('Jeddah building'),bounds=new THREE.Box3().setFromObject(tower),rendered=new THREE.Box3().setFromObject(cloth.mesh);let inside=0;
      for(let i=0;i<p.length;i+=3)if(cloth.collider.containsSurface(p,i))inside++;
      return {finite:p.every(Number.isFinite),motion:Math.max(...p.map((v,i)=>Math.abs(v-towerInitial[i]))),inside,solverHeight:cloth.collider.bounds.max.y-cloth.collider.bounds.min.y,towerHeight:(bounds.max.y-bounds.min.y)*5,floor:rendered.min.y,base:bounds.min.y,top:rendered.max.y,apex:bounds.max.y};
    })()`);console.log('Jeddah drape',JSON.stringify(result));
    assert(result.finite&&result.motion>.1&&result.inside<8,'The real GLB supports a finite moving drape outside its actual triangles');
    await run("window.viewCloth=peelDebug.cloth.simulation;window.viewClothPositions=viewCloth.positions.slice();document.getElementById('layers-view').click()");
    assert(await run("peelDebug.cloth.simulation===viewCloth&&viewCloth.positions.every((v,i)=>v===viewClothPositions[i])&&Math.abs(peelDebug.controls.target.x+3.5)<.001&&document.getElementById('layers-view').getAttribute('aria-pressed')==='true'"),'Switching to Oasis preserves the paused tower simulation');
    await run("document.getElementById('surface-view').click()");
    assert(await run("peelDebug.cloth.simulation===viewCloth&&viewCloth.positions.every((v,i)=>v===viewClothPositions[i])&&peelDebug.controls.target.x< -400&&document.getElementById('surface-view').getAttribute('aria-pressed')==='true'"),'Switching back to Building keeps the same cloth and its folds');
    assert(Math.abs(result.solverHeight-3)<.001&&Math.abs(result.towerHeight-1000)<.01&&result.floor>=result.base-.001&&result.top>result.apex-10,'The rendered cloth keeps the tower at one kilometer and the hem above the desert');
    await run("document.getElementById('cloth-settings-close').click();document.getElementById('toast').classList.remove('show');peelDebug.renderScene()");
    const changed=await run(`(()=>{const d=peelDebug,gl=d.renderer.getContext(),a=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4),b=new Uint8Array(a.length);d.renderScene();gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,a);d.cloth.mesh.visible=false;d.renderScene();gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,b);d.cloth.mesh.visible=true;d.renderScene();let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>15)n++;return n;})()`);
    assert(changed>500,'The drape actually renders around the distant tower');
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-jeddah-cloth${mobile?'-mobile':''}.png`,Buffer.from(shot.result.data,'base64'));
    await run("document.getElementById('oasis-settings-toggle').click();document.getElementById('palm-tower-cloth-settings').click();document.querySelector('[name=cloth-fabric][value=plastic]').click();document.getElementById('cloth-add-ribbon').click();document.getElementById('cloth-redrape').click();document.getElementById('cloth-pause').click()");
    assert(await run("peelDebug.cloth.fabric.name==='Pearl plastic'&&peelDebug.cloth.ropes.stats.length===1&&peelDebug.cloth.simulation.paused&&peelDebug.cloth.simulation.time<.5&&peelDebug.oasis.group.visible"),'Fabric, ribbon, pause and redrape controls target the tower');
    await run("document.getElementById('oasis-settings-toggle').click();document.querySelector('[name=palm-environment][value=studio]').click()");
    assert(await run("peelDebug.towerCloth.surface.mesh===null&&!peelDebug.towerCloth.group.visible&&document.getElementById('palm-tower-cloth').disabled&&document.getElementById('cloth-options').parentElement.id==='cloth-controls'"),'Dark studio clears tower cloth and restores the original settings panel');
    await run("document.querySelector('[name=palm-environment][value=desert]').click()");
    assert(await run('!!peelDebug.towerCloth.surface.simulation&&peelDebug.cloth===peelDebug.towerCloth.surface'),'Returning to the desert restores the enabled tower drape');
    await run("document.getElementById('cloth-material').click()");
    assert(await run("peelDebug.state.material==='cloth'&&!peelDebug.towerCloth.group.visible&&peelDebug.towerCloth.surface.mesh===null&&peelDebug.cloth===peelDebug.specimenCloth&&!!peelDebug.cloth.simulation&&document.getElementById('cloth-options').parentElement.id==='cloth-controls'"),'The ordinary Cloth picker still drapes the selected specimen');
    await run("document.getElementById('oasis-material').click();document.getElementById('palm-tower-cloth').click();document.getElementById('reset-view').click()");
    assert(await run('!peelDebug.state.palmTowerCloth&&peelDebug.towerCloth.surface.mesh===null&&!peelDebug.towerCloth.group.visible&&peelDebug.oasis.group.visible'),'Unchecking the tower cloth removes it while keeping the oasis');
    await run("document.querySelector('[data-metal=iron]').click()");
    // Return the shared controls to their original defaults for the next viewport.
    await run("document.getElementById('cloth-material').click();while(document.querySelector('#cloth-rope-list button'))document.querySelector('#cloth-rope-list button').click();document.querySelector('[name=cloth-fabric][value=linen]').click();document.querySelector('[data-metal=iron]').click()");
  }
}

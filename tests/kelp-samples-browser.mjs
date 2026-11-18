import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export async function selectModel({run,delay},kind){
  for(let step=0;step<5;step++){
    if(await run(`(peelDebug.state.material==='kelp'?peelDebug.kelpAttractor.shape:peelDebug.models.sampleKey)==='${kind}'`))return;
    await run("document.getElementById('horse-shape').click()");
    await waitForModel({run,delay});
  }
  assert.fail('Could not select '+kind+' with the model cycle');
}
async function waitForModel({run,delay}){
  for(let i=0;i<300;i++){
    if(await run("!document.getElementById('horse-shape').disabled"))return;
    await delay(100);
  }
  assert.fail('Model did not finish loading');
}

export async function checkKelpSamples({run,call,delay}){
  const samples=['horse','duck','jeddah','glasses','horse'];
  await run("document.getElementById('kelp-material').click();peelDebug.kelp.rebuild({strands:4,generations:2});peelDebug.kelp.setPlaying(false);peelDebug.kelpFish.setSettings({count:0});window.cycleCamera=JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()]);void 0");
  assert.equal(await run("document.querySelectorAll('[data-sample]').length"),1,'Four models share one control');
  for(const [i,kind] of samples.entries()){
    await run("document.getElementById('horse-shape').click()");await waitForModel({run,delay});
    const result=await run(`(()=>{
      const a=peelDebug.kelpAttractor,m=a.group.children[0],b=document.getElementById('horse-shape');peelDebug.renderScene();
      return {shape:a.shape,mode:peelDebug.state.material,active:a.active,material:m?.material.name,
        label:b.querySelector('span').textContent,choice:b.dataset.sample,pressed:b.getAttribute('aria-pressed'),
        selected:document.querySelectorAll('.shape-row [aria-pressed=true]').length,
        camera:JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()])===cycleCamera,
        programs:peelDebug.renderer.info.programs.every(p=>!p.diagnostics||p.diagnostics.runnable)};
    })()`);
    assert.equal(result.shape,kind);assert.equal(result.mode,'kelp');assert(result.active&&result.programs&&result.camera);
    assert.equal(result.material,'Weathered underwater marble');assert.equal(result.choice,kind);assert.equal(result.pressed,'true');assert.equal(result.selected,1);
    assert(result.label.endsWith((i%4+1)+'/4'));console.log('PASS: model cycle',result.label);
  }
  await run("document.getElementById('kelp-model-size').value=150;document.getElementById('kelp-model-size').dispatchEvent(new Event('input'));document.querySelector('[data-shape=cone]').click();document.getElementById('horse-shape').click()");
  await waitForModel({run,delay});assert.equal(await run('peelDebug.kelpAttractor.shape'),'horse','Returning from a primitive restores the displayed model');
  assert.equal(await run('peelDebug.kelpAttractor.modelSize'),1.5,'Cycling preserves model size');
  await run("document.getElementById('horse-shape').click();document.querySelector('[data-shape=cone]').click()");await waitForModel({run,delay});
  assert.equal(await run('peelDebug.kelpAttractor.shape'),'cone','A late model cannot replace a newer primitive');
  await run("document.getElementById('horse-shape').click();document.getElementById('kelp-remove-shape').click()");await waitForModel({run,delay});
  assert.equal(await run('peelDebug.kelpAttractor.hasShape'),false,'Removal cancels the pending model');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
  assert(await run(`(()=>{const b=document.getElementById('horse-shape'),r=b.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&(h===b||b.contains(h));})()`),'The single model toggle fits on mobile');
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/oxide-model-cycle-mobile.png',Buffer.from(shot.result.data,'base64'));
  await run("document.querySelector('[data-metal=iron]').click()");
  for(const kind of samples){
    await selectModel({run,delay},kind);
    assert.equal(await run('peelDebug.models.sampleKey'),kind);
    assert.equal(await run("document.getElementById('horse-shape').getAttribute('aria-pressed')"),'true');
  }
  await run("document.querySelector('[data-shape=cube]').click()");
  assert(await run("!peelDebug.models.active&&document.getElementById('horse-shape').getAttribute('aria-pressed')==='false'"));
  console.log('PASS: four-model cycling and wraparound, labels, size and camera preservation, load cancellation, mobile, and specimen mode.');
}

export async function checkKelpModelSize({run,call,delay}){
  await run("document.getElementById('kelp-material').click();peelDebug.kelp.rebuild({strands:4,generations:2});peelDebug.kelp.setPlaying(false);void 0");
  assert(await run("document.getElementById('kelp-model-size').disabled"));
  await run("document.getElementById('horse-shape').click()");
  for(let i=0;i<200;i++){if(await run("!document.getElementById('horse-shape').disabled"))break;await delay(100);}
  assert.equal(await run('peelDebug.kelpAttractor.shape'),'horse');
  await run("document.getElementById('kelp-settings-toggle').click();window.sizeCamera=JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()]);peelDebug.kelpFish.setRoaming(true);void 0");
  for(const percent of [50,150,300]){
    await run(`document.getElementById('kelp-model-size').value=${percent};document.getElementById('kelp-model-size').dispatchEvent(new Event('input'))`);
    const result=await run(`(()=>{const a=peelDebug.kelpAttractor,s=a.bounds.getSize(a.center.clone());return {size:a.modelSize,span:Math.max(s.x,s.y,s.z),bottom:a.bounds.min.y,roaming:peelDebug.kelpFish.roaming,label:document.getElementById('kelp-model-size-value').value,camera:JSON.stringify([peelDebug.camera.position.toArray(),peelDebug.controls.target.toArray()])===sizeCamera}})()`);
    assert.equal(result.size,percent/100);assert(Math.abs(result.span-2.6*percent/100)<1e-5);
    assert(result.bottom< -1.75&&result.bottom>=-1.92);assert(result.roaming&&result.camera);
    assert.equal(result.label,(percent/100).toFixed(2)+'×');
  }
  await run("document.getElementById('kelp-model-size-reset').click()");assert.equal(await run('peelDebug.kelpAttractor.modelSize'),1);
  assert(await run("document.getElementById('kelp-model-size-reset').disabled"));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
  assert(await run(`(()=>{const b=document.getElementById('kelp-model-size');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return h===b&&r.left>=0&&r.right<=innerWidth})()`),'The slider is reachable on mobile');
  await run("document.getElementById('kelp-remove-shape').click()");assert(await run("document.getElementById('kelp-model-size').disabled"));
  console.log('PASS: model size slider, dimensions, grounding, roaming, camera preservation, reset, removal, and mobile access.');
}

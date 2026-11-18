import assert from 'node:assert/strict';

export async function checkSceneURL({run,call,delay}){
  const wait=async predicate=>{
    for(let i=0;i<150;i++){await delay(200);if(await run(predicate))return;}
    assert.fail('Timed out: '+predicate);
  };
  const params=()=>run('Object.fromEntries(new URL(location.href).searchParams)');
  const input=(id,value)=>run(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const navigate=async url=>{
    await call('Page.navigate',{url});
    await wait("document.readyState==='complete'&&!!window.peelDebug&&!document.getElementById('loading')");
    await delay(400);
  };
  await run("document.getElementById('oasis-material').click();document.getElementById('shape-gate-shape').click()");
  await input('palm-wind','72');await delay(400);
  let link=await run('location.href');
  assert.equal((await params()).scene,'oasis');assert.equal((await params()).object,'gate');
  const length=await run('history.length');
  await input('palm-wind','81');await delay(400);
  assert.equal(await run('history.length'),length,'Sliders do not create history entries');
  await navigate(link);
  assert(await run("peelDebug.state.palm&&peelDebug.oasis.group.visible&&document.getElementById('oasis-shape-gate').checked&&document.getElementById('palm-wind').value==='72'"),'Shared link restores Oasis, gate and wind');
  await run("document.getElementById('kelp-material').click();document.querySelector('[data-shape=sphere]').click()");
  await input('kelp-current','85');await delay(400);
  assert.equal((await params()).scene,'kelp');assert.equal((await params()).object,'sphere');
  link=await run('location.href');
  await run('history.back()');
  await wait("!!window.peelDebug&&peelDebug.state.palm&&peelDebug.oasis.group.visible");await delay(400);
  assert.equal((await params()).scene,'oasis');
  await run('history.forward()');
  await wait("!!window.peelDebug&&peelDebug.state.material==='kelp'&&peelDebug.kelpAttractor.shape==='sphere'");
  assert(await run('peelDebug.kelp.settings.current===.85'),'Forward restores slider settings');
  await navigate(link);
  assert(await run("peelDebug.state.material==='kelp'&&peelDebug.kelpAttractor.shape==='sphere'&&peelDebug.kelp.settings.current===.85"));
  await run("document.getElementById('cloth-material').click();(()=>{const input=document.querySelector('[name=cloth-fabric][value=wool]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await delay(400);link=await run('location.href');await navigate(link);
  assert(await run("peelDebug.state.material==='cloth'&&peelDebug.state.clothSettings.fabric==='wool'"),'Radio settings restore');
  await navigate('http://127.0.0.1:8765/?scene=oasis&object=gate&settings=%7Bbroken');
  assert(await run("peelDebug.state.palm&&document.getElementById('oasis-shape-gate').checked"),'Malformed settings keep readable route usable');
  await run("document.querySelector('[data-metal=copper]').click();document.querySelector('[data-shape=cone]').click();document.getElementById('layers-view').click()");
  await input('age','64');await delay(400);link=await run('location.href');
  await navigate(link);
  assert(await run("peelDebug.state.material==='metal'&&peelDebug.state.metal==='copper'&&peelDebug.state.shape==='cone'&&peelDebug.state.age===.64&&document.getElementById('layers-view').classList.contains('selected')"),'Metal, age, shape and layers view restore');
  await run("document.getElementById('kelp-material').click();document.getElementById('kelp-regrow').click()");
  await delay(400);const seed=await run('peelDebug.kelp.settings.seed');link=await run('location.href');
  await navigate(link);assert.equal(await run('peelDebug.kelp.settings.seed'),seed,'Regenerated kelp keeps its seed');
  await run("peelDebug.controls.dispatchEvent({type:'end'})");await delay(400);link=await run('location.href');
  const cameraParams=await params();
  const pose={position:cameraParams.camera.split(',').map(Number),target:cameraParams.target.split(',').map(Number)};
  assert(!/%22|%7B|%5B/i.test(link),'Camera link has readable coordinates instead of encoded JSON');
  await navigate(link);
  assert.deepEqual(await run('peelDebug.camera.position.toArray()'),pose.position,'User camera pose restores');
  console.log('PASS: URL sections, objects, settings, shared links, refresh, radio controls, history and malformed settings.');
}

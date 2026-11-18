import assert from 'node:assert/strict';

export async function checkFernMarble({run}){
  await run("document.getElementById('fern-material').click();document.getElementById('fern-on-object').click()");
  for(const shape of ['cube','sphere','plus']){
    await run(`document.querySelector('[data-shape="${shape}"]').click();peelDebug.renderScene()`);
    assert(await run(`peelDebug.core.material.name==='Weathered marble'&&peelDebug.core.geometry.hasAttribute('marblePosition')&&peelDebug.core.geometry.hasAttribute('marbleCavity')`),'Marble covers '+shape);
    assert(await run('peelDebug.fernDispersal.surfaceMode&&peelDebug.fernDispersal.stats.colonies>0'),'Ferns establish on the marble');
  }
  await run(`peelDebug.models.loadSample('duck','Duck')`);
  assert(await run(`peelDebug.models.active&&peelDebug.models.meshes.every(mesh=>mesh.material.name==='Weathered marble'&&mesh.geometry.hasAttribute('marblePosition'))`),'Imported meshes receive marble');
  await run(`peelDebug.renderScene();document.getElementById('cloth-material').click();peelDebug.renderScene()`);
  assert(await run(`peelDebug.models.meshes.every(mesh=>mesh.material.name!=='Weathered marble')`),'Leaving fern mode restores model materials');
  await run(`peelDebug.models.clear();document.querySelector('[data-metal="iron"]').click()`);
  assert(await run(`peelDebug.core.material.name!=='Weathered marble'`),'Leaving fern mode restores built-in materials');
  await run(`document.getElementById('kelp-material').click();peelDebug.kelpAttractor.setShape('cube');peelDebug.renderScene()`);
  assert(await run(`peelDebug.kelpAttractor.group.children[0].material.name==='Weathered underwater marble'`),'Underwater marble keeps its lighting');
  console.log('PASS: marble on fern-covered shapes and imported models, material restoration, and underwater rendering.');
}

export async function checkFernSurfaceGrowth({run}){
  await run(`document.getElementById('fern-material').click();peelDebug.models.loadSample('arc de triomphe 3d','Arch')`);
  assert(await run(`peelDebug.fernDispersal.speed===4&&document.getElementById('fern-simulation-speed').value==='4'&&document.getElementById('fern-simulation-speed-value').value==='4×'`),'Objects default to 4× and show the actual speed');
  const result=await run(`(()=>{
    const sim=peelDebug.fernDispersal,bed=sim.group.getObjectByName('New fern colonies'),ids=bed.children.map(c=>c.userData.id);
    sim.setPlaying(true);const start=performance.now();for(let i=0;i<240;i++)sim.advance(1/60);sim.setPlaying(false);
    const visible=ids.filter(id=>sim.inspectPlant(id)?.fronds.some(f=>f.visible)).length;
    peelDebug.renderScene();return {seedlings:ids.length,visible,cpuMs:performance.now()-start};
  })()`);
  assert(result.seedlings>5);assert.equal(result.visible,result.seedlings,'All initial seedlings show fronds within four seconds of playback');
  await run(`document.getElementById('fern-material').click()`);
  assert(await run(`peelDebug.fernDispersal.speed===1`),'The ground scene keeps its default speed');
  await run(`const speed=document.getElementById('fern-simulation-speed');speed.value=6;speed.dispatchEvent(new Event('input'));document.querySelector('[data-shape="sphere"]').click();document.getElementById('fern-regrow').click()`);
  assert(await run(`peelDebug.fernDispersal.speed===6&&document.getElementById('fern-simulation-speed').value==='6'`),'User-selected speed survives object changes and regrowth');
  console.log('PASS: detailed arch seedlings appear within four seconds, ground defaults and manual speed are preserved.',result);
}

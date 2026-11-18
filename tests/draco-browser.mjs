import assert from 'node:assert/strict';

export async function checkDraco({run,delay}){
  const assets=await run(`(async()=>{
    const {createGLTFLoader}=await import('./gltf-loader.js');
    const first=createGLTFLoader(),second=createGLTFLoader();
    const results=[];
    for(const name of ['horse','duck','jeddah','glasses','arc de triomphe 3d']){
      const gltf=await first.loadAsync('./samples/'+encodeURIComponent(name)+'.glb');
      let meshes=0,triangles=0,valid=true;
      gltf.scene.traverse(mesh=>{
        if(!mesh.isMesh)return;
        meshes++;const g=mesh.geometry;
        triangles+=(g.index?.count??g.attributes.position.count)/3;
        for(const attribute of Object.values(g.attributes))valid&&=attribute.array.every(Number.isFinite);
      });
      results.push({name,meshes,triangles,valid});
      const {disposeModel}=await import('./model-import.js');disposeModel(gltf.scene);
    }
    const libraries=performance.getEntriesByType('resource').filter(entry=>/draco_(decoder.wasm|wasm_wrapper.js)$/.test(entry.name));
    return {results,shared:first.dracoLoader===second.dracoLoader,libraries:libraries.map(entry=>entry.name)};
  })()`);
  assert(assets.shared,'All GLTF loaders share the Draco worker pool');
  assert.equal(assets.libraries.length,2,'WASM and wrapper are downloaded once');
  for(const asset of assets.results)assert(asset.valid&&asset.meshes>0&&asset.triangles>0,JSON.stringify(asset));
  assert(await run("peelDebug.models.loadSample('horse','Horse')"),'Studio loads compressed horse');
  await run("document.getElementById('kelp-material').click();peelDebug.kelp.rebuild({strands:4,generations:2});void 0");
  assert(await run("peelDebug.kelpAttractor.loadSample('duck')"),'Kelp loads compressed duck');
  await run("document.getElementById('oasis-material').click();void 0");
  for(let i=0;i<150;i++){
    if(await run("!!peelDebug.scene.getObjectByName('Jeddah building')?.children.length"))break;
    await delay(100);
  }
  assert(await run("!!peelDebug.scene.getObjectByName('Jeddah building')?.children.length"),'Oasis loads compressed tower');
  const gate=await run(`(async()=>{
    const {createShapeGate}=await import('./shape-gate-object.js');
    let selected;
    const gate=createShapeGate({scene:peelDebug.scene,renderer:peelDebug.renderer,includeGround:false,onShape:name=>{selected=name;}});
    gate.setCycle(false);
    await gate.load('glasses');
    gate.group.removeFromParent();return selected==='glasses';
  })()`);
  assert(gate,'Shape Gate loads compressed glasses');
  console.log('PASS: five Draco GLBs, shared local decoder, valid geometry, studio, Kelp, Oasis and Shape Gate.',JSON.stringify(assets.results));
}

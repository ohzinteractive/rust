import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const T=await import('../vendor/three.module.js');
const {createKelpFish}=await import('../kelp-fish.js');
const {fishSpecies}=await import('../fish-species.js');
function setup(){
  const scene=new T.Scene(),kelp={revision:1,settings:{seed:197,current:0,direction:0,height:7},stats:{blades:0},group:{visible:true},playing:true,getObstacles:()=>({version:1,capsules:[]})};
  const fish=createKelpFish({scene,kelp});fish.setVisible(true);return {fish,scene};
}

test('the default twenty-fish community contains all four types with smaller neon shoals',()=>{
  const {fish,scene}=setup(),bySpecies=new Map();
  for(let i=0;i<20;i++){
    const f=fish.inspectFish(i);if(!bySpecies.has(f.species))bySpecies.set(f.species,[]);bySpecies.get(f.species).push(f.size);
  }
  assert.deepEqual([...bySpecies.keys()].sort(),fishSpecies.map(s=>s.id).sort());
  assert(bySpecies.get('neon').length>bySpecies.get('discus').length,'Small fish outnumber the large round fish');
  assert(Math.max(...bySpecies.get('neon'))<Math.min(...bySpecies.get('discus')),'Discus have a distinctly larger body scale');
  const mesh=fish.group.children[0];assert.equal(mesh.count,20);assert.equal(fish.group.children.length,2,'The community shares one fish mesh plus the existing feeding debris');
  fish.dispose();assert.equal(scene.children.length,0);
});

test('discus have round bodies and all morphed positions and normals remain valid',()=>{
  const {fish}=setup(),g=fish.group.children[0].geometry;
  const body=new T.Box3(),discus=new T.Box3(),point=new T.Vector3();
  for(let i=0;i<g.attributes.position.count;i++){
    const p=point.fromBufferAttribute(g.attributes.fishDiscusPosition,i);assert(p.toArray().every(Number.isFinite));
    assert(p.length()<.48,'Morphed silhouettes fit inside the conservative fish clearance');
    const n=point.fromBufferAttribute(g.attributes.fishDiscusNormal,i);assert(Math.abs(n.length()-1)<1e-5);
    if(g.attributes.fishPart.getX(i)!==1)continue;
    body.expandByPoint(point.fromBufferAttribute(g.attributes.position,i));discus.expandByPoint(point.fromBufferAttribute(g.attributes.fishDiscusPosition,i));
  }
  const a=body.getSize(new T.Vector3()),b=discus.getSize(new T.Vector3());
  assert(a.x/a.y>3,'Silver fish retain their elongated shape');
  assert(b.x/b.y>.95&&b.x/b.y<1.2,'The discus retains a broad, deep body profile');assert(b.z<b.y*.3,'Discus retain a flattened side-to-side profile');
  let headHeight=0,bodyHeight=0,finHeight=0;
  for(let i=0;i<g.attributes.position.count;i++){
    const p=point.fromBufferAttribute(g.attributes.fishDiscusPosition,i),part=g.attributes.fishPart.getX(i);
    if(part===1){bodyHeight=Math.max(bodyHeight,Math.abs(p.y));if(p.x>.19)headHeight=Math.max(headHeight,Math.abs(p.y));}
    if(part===0)finHeight=Math.max(finHeight,Math.abs(p.y));
  }
  assert(headHeight<bodyHeight*.55,'The head and mouth taper instead of forming a circular plate');
  assert(finHeight<bodyHeight*1.2,'Dorsal and anal fins follow the body edge instead of forming tall triangles');
  fish.dispose();
});

test('population changes and rebuilds keep type assignment stable without rebuilding geometry',()=>{
  const {fish}=setup(),mesh=fish.group.children[0],geometry=mesh.geometry;
  const original=Array.from({length:20},(_,i)=>fish.inspectFish(i).species);
  fish.setSettings({count:500});for(let i=0;i<500;i++)assert(fishSpecies.some(s=>s.id===fish.inspectFish(i).species));
  fish.setSettings({count:5});fish.setSettings({count:20});fish.reset();
  assert.deepEqual(Array.from({length:20},(_,i)=>fish.inspectFish(i).species),original);
  assert.equal(mesh.geometry,geometry);assert.equal(mesh.geometry.attributes.fishSpecies.count,500);fish.dispose();
});

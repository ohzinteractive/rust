import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createClothSurface}=await import('../cloth-surface.js');

for(const fabric of ['wool','duvet'])test(`${fabric}: thick cloth stays supported through live fabric changes`,()=>{
  const scene=new THREE.Scene(),body=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshBasicMaterial());scene.add(body);
  const cloth=createClothSurface({scene});cloth.rebuild([body],{resolution:12,fabric,ropes:[{id:1,height:.5,tightness:.8}]});
  for(let frame=0;frame<480;frame++)cloth.advance(1/60);
  assert.equal(cloth.ropes.stats[0].status,'tied','The selected fabric supports rope wrapping');
  const sim=cloth.simulation,positions=sim.positions;
  assert(positions.every(Number.isFinite));
  for(let i=1;i<positions.length;i+=3)assert(positions[i]>=-1.739&&positions[i]<1.5,`Thicker fabric stays on the body and above the floor: y=${positions[i]}`);
  const before=positions.slice(),time=sim.time;
  cloth.setFabric('linen');assert.equal(cloth.simulation,sim);assert.equal(sim.time,time);assert.deepEqual(positions,before,'Changing fabric preserves the current drape');
  const lining=cloth.mesh.getObjectByName('Fabric reverse'),hem=cloth.mesh.getObjectByName('Fabric hem');
  assert.equal(lining.geometry,cloth.mesh.geometry);
  assert(hem.geometry.attributes.position.array.every(Number.isFinite));
  let disposed=0;hem.geometry.addEventListener('dispose',()=>disposed++);cloth.dispose();assert.equal(disposed,1);
  body.geometry.dispose();body.material.dispose();
});

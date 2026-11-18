import {registerHooks} from 'node:module';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {parseGLB}=await import('./draco-node.mjs');
const {createClothSurface}=await import('../cloth-surface.js');
const {createClothCollider}=await import('../cloth-collider.js');
const {createShapeGeometry}=await import('../specimen-shapes.js');

for(const shape of ['sphere','pill','horse'])test(`${shape}: cloth falls, folds and remains outside the specimen and floor`,async()=>{
  const scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial(),meshes=[];
  if(shape==='horse'){
    const bytes=await readFile(new URL('../samples/horse.glb',import.meta.url)),gltf=await parseGLB(bytes);
    const root=gltf.scene,bounds=new THREE.Box3().setFromObject(root,true),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),scale=3/Math.max(size.x,size.y,size.z),wrapper=new THREE.Group();
    wrapper.scale.setScalar(scale);wrapper.position.set(-center.x*scale,-1.65-bounds.min.y*scale,-center.z*scale);wrapper.add(root);scene.add(wrapper);root.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
  }else{const mesh=new THREE.Mesh(createShapeGeometry(shape),material);mesh.rotation.set(.13,.3,-.1);scene.add(mesh);meshes.push(mesh);}
  scene.updateMatrixWorld(true);
  const cloth=createClothSurface({scene});cloth.rebuild(meshes,{resolution:24,radial:shape==='horse'});
  const initial=cloth.simulation.positions.slice();
  for(let i=0;i<600;i++)cloth.advance(1/60);
  const p=cloth.simulation.positions;assert(p.every(Number.isFinite));
  let min=Infinity,max=-Infinity,inside=0;
  for(let i=0;i<p.length;i+=3){min=Math.min(min,p[i+1]);max=Math.max(max,p[i+1]);if(cloth.collider.contains(p,i))inside++;}
  assert(min>=-1.739,'The floor supports the hem');assert(max-min>.6,'Fabric folds around the silhouette instead of remaining a flat plane');
  assert(max>cloth.collider.bounds.max.y-.6,'Cloth remains draped on the object');
  assert(max<cloth.collider.bounds.max.y+.4,`Contacts cannot add enough energy to launch fabric: ${max}`);
  assert(inside<4,`${inside} cloth nodes inside the object`);
  let exactInside=0,displayInside=0;
  for(let i=0;i<p.length;i+=3)if(cloth.collider.containsSurface(p,i))exactInside++;
  const display=cloth.mesh.geometry.attributes.position.array;
  for(let i=0;i<display.length;i+=3)if(cloth.collider.containsSurface(display,i))displayInside++;
  assert(exactInside<4,`${exactInside} nodes inside actual ${shape} triangles`);
  assert(displayInside<4,`${displayInside} visible vertices inside actual ${shape} triangles`);
  assert(p.some((value,i)=>Math.abs(value-initial[i])>.3),'Gravity moves the cloth');
  cloth.simulation.paused=true;const paused=p.slice();assert.equal(cloth.advance(1),false);assert.deepEqual(p,paused);
  cloth.simulation.paused=false;cloth.advance(100);assert(p.every(Number.isFinite),'A suspended frame cannot explode the simulation');
  const old=cloth.mesh;let disposed=0;old.geometry.addEventListener('dispose',()=>disposed++);cloth.rebuild(meshes,{resolution:12});assert.equal(old.parent,null);assert.equal(disposed,1);
  cloth.dispose();assert.equal(cloth.mesh,null);assert.equal(cloth.simulation,null);
  for(const mesh of meshes){mesh.geometry.dispose();[mesh.material].flat().forEach(m=>m.dispose());}material.dispose();
});

test('mesh collision envelopes respect translation, tilt and separate geometry components',()=>{
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());mesh.rotation.z=.3;mesh.position.set(2,.3,-1);scene.add(mesh);
  const collider=createClothCollider([mesh]);const point=new Float32Array([2,.3,-1]);assert(collider.contains(point));assert(collider.project(point)>=0);assert(!collider.contains(point));
  assert(!collider.contains([5,0,0]));mesh.geometry.dispose();mesh.material.dispose();
});

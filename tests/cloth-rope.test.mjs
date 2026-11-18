import {registerHooks} from 'node:module';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {parseGLB}=await import('./draco-node.mjs');
const {createClothSurface}=await import('../cloth-surface.js');
const {createShapeGeometry}=await import('../specimen-shapes.js');

for(const [shape,resolution] of [['sphere',24],['pill',24],['horse',24],['horse',36]])test(`${shape} (${resolution}): rope cinches cloth at the selected height, supports multiple ties and releases cleanly`,async()=>{
  const scene=new THREE.Scene(),meshes=[];
  if(shape==='horse'){
    const bytes=await readFile(new URL('../samples/horse.glb',import.meta.url)),gltf=await parseGLB(bytes);
    const root=gltf.scene,bounds=new THREE.Box3().setFromObject(root,true),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),scale=3/Math.max(size.x,size.y,size.z),wrapper=new THREE.Group();
    wrapper.scale.setScalar(scale);wrapper.position.set(-center.x*scale,-1.65-bounds.min.y*scale,-center.z*scale);wrapper.add(root);scene.add(wrapper);root.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
  }else{const mesh=new THREE.Mesh(createShapeGeometry(shape),new THREE.MeshBasicMaterial());mesh.rotation.set(.12,.2,-.1);scene.add(mesh);meshes.push(mesh);}
  const cloth=createClothSurface({scene});cloth.rebuild(meshes,{resolution,radial:shape==='horse'});
  for(let i=0;i<240;i++)cloth.advance(1/60);
  cloth.setRopes([{id:1,height:.35,tightness:0}]);
  for(let i=0;i<180;i++)cloth.advance(1/60);
  const loose=cloth.ropes.stats[0];assert(loose.attachments>8,'The rope binds actual cloth edges');
  cloth.setRopes([{id:1,height:.35,tightness:1}]);
  for(let i=0;i<360;i++)cloth.advance(1/60);
  const tight=cloth.ropes.stats[0];
  assert(tight.radius<loose.radius-.05,'Tightness changes the physical rope radius');
  assert(tight.clothRadius<loose.clothRadius-.04,'Tightening gathers the fabric rather than just drawing a line');
  assert(tight.heightError<.15,'The tied material remains at the requested level: '+JSON.stringify(tight));
  cloth.setRopes([{id:1,height:.65,tightness:.9},{id:2,height:.3,tightness:.85}]);
  for(let i=0;i<660;i++)cloth.advance(1/60);
  assert(cloth.ropes.stats.every(r=>r.status==='tied'&&r.attachments>8));
  assert.equal(cloth.ropes.stats.length,2);assert(cloth.ropes.stats[0].y>tight.y+.2);
  assert(cloth.simulation.positions.every(Number.isFinite));
  let inside=0;for(let i=0;i<cloth.simulation.positions.length;i+=3)if(cloth.collider.contains(cloth.simulation.positions,i))inside++;
  assert(inside<4,'Ropes cannot pull the fabric through the object');
  const cord=cloth.ropes.group.children.find(c=>c.name==='Cloth binding rope');let disposed=0;cord.geometry.addEventListener('dispose',()=>disposed++);
  cloth.setRopes([]);assert.equal(cloth.ropes.group.children.length,0);assert.equal(disposed,1);
  for(let i=0;i<120;i++)cloth.advance(1/60);assert(cloth.simulation.positions.every(Number.isFinite));
  cloth.dispose();assert(!scene.children.some(c=>c.name==='Cloth ropes'));
  for(const mesh of meshes){mesh.geometry.dispose();[mesh.material].flat().forEach(m=>m.dispose());}
});

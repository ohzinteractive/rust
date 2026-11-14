import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createSurfaceSampler}=await import('../feather-sampling.js');
const {createVisibleFeatherSampler}=await import('../visible-feather-sampling.js');
const {createShapeGeometry}=await import('../specimen-shapes.js');
const {createFeatherSurface}=await import('../feather-surface.js');
const {mazePoint}=await import('../maze-geometry.js');

test('dense maze navigation generates only the exposed corridor and reuses its feather geometry while walking',()=>{
  const parent=new THREE.Group(),geometry=createShapeGeometry('maze'),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);parent.add(mesh);
  const effect=createFeatherSurface();effect.setSettings({detail:.1});effect.rebuild([mesh],parent,1000,7319,{viewport:true,scale:.025});
  assert.equal(effect.stats.count,0);
  const camera=new THREE.PerspectiveCamera(75,1.25,.001,80);camera.position.copy(mazePoint(15.5,29.5,.02));camera.lookAt(camera.position.clone().add(new THREE.Vector3(1,0,0)));
  effect.updateView(camera);
  const fullCount=Math.round(effect.stats.surfaceArea*1000),count=effect.stats.count;
  assert(count>5&&count<fullCount*.05,`${count} generated feathers instead of ${fullCount} for the whole maze`);
  assert(effect.stats.area<effect.stats.surfaceArea*.05);
  const objects=effect.group.children.map(batch=>[batch.geometry,batch.material]);
  camera.position.x+=.005;camera.lookAt(camera.position.clone().add(new THREE.Vector3(1,0,0)));effect.updateView(camera);
  effect.group.children.forEach((batch,i)=>{assert.equal(batch.geometry,objects[i][0]);assert.equal(batch.material,objects[i][1]);});
  effect.dispose();geometry.dispose();material.dispose();
});

test('visible density samples the front surface, excluding surfaces behind it and outside the viewport',()=>{
  const parent=new THREE.Group(),material=new THREE.MeshBasicMaterial(),geometry=new THREE.PlaneGeometry(2,2);
  const front=new THREE.Mesh(geometry,material),back=new THREE.Mesh(geometry,material);back.position.z=-.5;parent.add(front,back);
  const source=createSurfaceSampler([front,back],parent),visible=createVisibleFeatherSampler(source.triangles);
  const camera=new THREE.PerspectiveCamera(25,1,.001,20);camera.position.z=2;camera.lookAt(0,0,0);
  const result=visible.sample(camera,parent,1000,7319);
  assert(result.samples.length>500&&result.samples.length<1000,'Density must follow only the small visible area, not all eight square units');
  assert(result.area>.6&&result.area<1);
  assert(result.samples.every(sample=>sample.triangle.mesh===front),'A hidden parallel wall must receive no feathers');
  for(const sample of result.samples){
    const p=sample.position.clone().project(camera);assert(Math.abs(p.x)<=1&&Math.abs(p.y)<=1);
    assert(Math.abs(sample.weights.reduce((a,b)=>a+b,0)-1)<1e-6);
  }
  const initial=new Map(result.samples.map(sample=>[sample.key,sample.position.toArray()]));
  camera.position.x=.1;camera.lookAt(.1,0,0);
  const shifted=visible.sample(camera,parent,1000,7319);
  let shared=0;for(const sample of shifted.samples)if(initial.has(sample.key)){assert.deepEqual(sample.position.toArray(),initial.get(sample.key));shared++;}
  assert(shared>result.samples.length*.6,'Moving the camera retains most existing roots');
  camera.lookAt(.1,0,4);assert.equal(visible.sample(camera,parent,1000,7319).samples.length,0);
  geometry.dispose();material.dispose();
});

test('visibility rays respect parent rotation and use density without a feather count ceiling',()=>{
  const parent=new THREE.Group(),geometry=new THREE.PlaneGeometry(2,2),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);
  parent.rotation.set(.3,.4,.1);parent.position.set(1,2,3);parent.add(mesh);parent.updateMatrixWorld(true);
  const source=createSurfaceSampler([mesh],parent),visible=createVisibleFeatherSampler(source.triangles);
  const camera=new THREE.PerspectiveCamera(25,1,.001,20);
  camera.position.set(0,0,2).applyMatrix4(parent.matrixWorld);camera.up.set(0,1,0).transformDirection(parent.matrixWorld);camera.lookAt(parent.position);
  const small=visible.sample(camera,parent,100,11),large=visible.sample(camera,parent,2000,11);
  assert(large.samples.length>1000&&large.samples.length>small.samples.length*15);
  assert(large.samples.every(sample=>Math.abs(sample.position.z)<1e-7));
  assert.equal(visible.sample(camera,parent,0,11).samples.length,0);
  geometry.dispose();material.dispose();
});

test('nearby hidden feathers are prepared before a wall comes into view',()=>{
  const parent=new THREE.Group(),geometry=new THREE.PlaneGeometry(2,2),material=new THREE.MeshBasicMaterial();
  const front=new THREE.Mesh(geometry,material),back=new THREE.Mesh(geometry,material);back.position.z=-.08;parent.add(front,back);
  const sampler=createVisibleFeatherSampler(createSurfaceSampler([front,back],parent).triangles);
  const camera=new THREE.PerspectiveCamera(95,1,.001,20);camera.position.z=.08;camera.lookAt(0,0,0);
  assert(sampler.sample(camera,parent,1000,11).samples.every(sample=>sample.triangle.mesh===front));
  const prepared=sampler.sample(camera,parent,1000,11,{nearRadius:.22});
  const hidden=prepared.samples.filter(sample=>sample.triangle.mesh===back);assert(hidden.length>20);
  assert(hidden.every(sample=>!sampler.isVisibleSphere(sample.position,.001)),'Prepared hidden roots must remain culled');
  const keys=new Set(hidden.map(sample=>sample.key));
  camera.position.z=-.02;camera.lookAt(0,0,-1);
  const exposed=sampler.sample(camera,parent,1000,11).samples.filter(sample=>sample.triangle.mesh===back);
  assert(exposed.length>0&&exposed.every(sample=>keys.has(sample.key)),'Newly exposed roots were already present nearby');
  geometry.dispose();material.dispose();
});


test('the courtyard clears dense feathers and follicles without losing their attachments',()=>{
  const parent=new THREE.Group(),geometry=new THREE.PlaneGeometry(1,1),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);parent.add(mesh);
  const effect=createFeatherSurface();effect.setSettings({detail:.1});effect.rebuild([mesh],parent,200,7319,{viewport:true,scale:.025});
  const camera=new THREE.PerspectiveCamera(75,1,.001,20);camera.position.z=1;camera.lookAt(0,0,0);effect.updateView(camera);
  const count=effect.stats.visibleCount,roots=effect.stats.count;assert(count>0);
  effect.setCourtyardExclusion({center:new THREE.Vector3(),radius:1});effect.updateView(camera);
  assert.equal(effect.stats.visibleCount,0);assert.equal(effect.follicleGroup.children[0].count,0);
  assert.equal(effect.stats.count,roots,'The ritual only changes rendering, preserving attachments for the overview');
  effect.setCourtyardExclusion(null);effect.updateView(camera);assert.equal(effect.stats.visibleCount,count);
  effect.dispose();geometry.dispose();material.dispose();
});

import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createMazeRoom}=await import('../maze-room.js');
const {createMazeWalker}=await import('../maze-navigation.js');
const {createSurfaceSampler,readFeatherAnchor}=await import('../feather-sampling.js');
const {createVisibleFeatherSampler}=await import('../visible-feather-sampling.js');

test('FPV room closes the floor and ceiling and carries a warm lantern without crossing walls',()=>{
  const scene=new THREE.Scene(),specimen=new THREE.Group();scene.add(specimen);const walker=createMazeWalker();
  const room=createMazeRoom({scene,specimen,canStand:walker.canStand});
  assert(!room.floor.visible&&!room.roof.visible&&!room.lantern.visible&&!room.light.visible);
  room.setActive(true);specimen.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(walker.position.clone(),new THREE.Vector3(0,1,0));
  assert(ray.intersectObject(room.roof).length>0,'Looking up must hit a ceiling');
  ray.ray.direction.set(0,-1,0);assert(ray.intersectObject(room.floor).length>0,'Looking down must hit the floor');
  const camera=new THREE.PerspectiveCamera(75,1.25,.001,80);camera.position.copy(walker.position);camera.rotation.y=walker.heading;
  room.update(camera,1/60,.24);assert(room.light.isPointLight&&room.light.castShadow);
  assert(room.light.color.r>room.light.color.b,'The carried light must be warm');
  const start=room.lantern.position.clone();
  walker.move(.01,-.02);camera.position.copy(walker.position);room.update(camera,1/60,.24);
  assert(room.lantern.position.distanceTo(start)>.001);
  const lamp=new THREE.Vector3();room.light.getWorldPosition(lamp);
  assert(walker.canStand(lamp.x,lamp.z,.004),'The lantern must stay inside the corridor near a wall');
  for(let i=0;i<180;i++)room.update(camera,1/60,0);
  const settled=room.lantern.position.clone();
  assert.equal(room.update(camera,1/60,0),false,'The settled lantern does not invalidate shadows');
  assert.equal(room.interior.advance(1/60),true,'The meteor shower keeps animating while standing still');
  assert(room.lantern.position.equals(settled),'The lantern settles while the sky continues animating');
  assert.equal(room.update(camera,0,0),false);
  room.setActive(false);assert(!room.floor.visible&&!room.roof.visible&&!room.lantern.visible);room.dispose();
});

test('floor and ceiling grow feathers into the room and load when looking up or down',()=>{
  const scene=new THREE.Scene(),specimen=new THREE.Group();scene.add(specimen);const walker=createMazeWalker();
  const room=createMazeRoom({scene,specimen,canStand:walker.canStand});room.setActive(true);
  const sampler=createSurfaceSampler([room.floor,room.roof],specimen),visible=createVisibleFeatherSampler(sampler.triangles);
  const camera=new THREE.PerspectiveCamera(75,1.25,.001,80);camera.position.copy(walker.position);
  const root=new THREE.Vector3(),normal=new THREE.Vector3();
  for(const [mesh,dy] of [[room.floor,-1],[room.roof,1]]){
    camera.up.set(0,0,-1);camera.lookAt(camera.position.clone().add(new THREE.Vector3(0,dy,0)));camera.updateMatrixWorld();
    const result=visible.sample(camera,specimen,1000,7319,{nearRadius:.22});
    const samples=result.samples.filter(sample=>sample.triangle.mesh===mesh);
    assert(samples.length>0,`${mesh.name} must receive feathers`);
    assert(samples.some(sample=>visible.isVisibleSphere(sample.position,.01)),`${mesh.name} feathers must be drawable from inside`);
    readFeatherAnchor(samples[0],specimen,root,normal);
    assert(normal.y*dy<-.99,'Floor feathers face up and ceiling feathers face down');
    assert((root.y-mesh.position.y)*dy<0,'Roots must be on the interior side');
  }
  room.dispose();
});

test('space interior batches its geometric lights and releases its mirror resources',()=>{
  const scene=new THREE.Scene(),specimen=new THREE.Group();scene.add(specimen);
  const room=createMazeRoom({scene,specimen,canStand:()=>true});
  const {architecture,mirror,wallMaterial}=room.interior;
  assert.equal(architecture.children.length,3,'Frames, inlay and lights use three instanced draws');
  for(const mesh of architecture.children){
    assert(mesh.isInstancedMesh&&mesh.count>100);
    assert(mesh.instanceMatrix.array.every(Number.isFinite));
  }
  assert.equal(wallMaterial.name,'Galaxy glass');assert.equal(room.roof.material.name,'Galaxy skylight');
  assert.equal(room.floor.material,mirror.material);
  assert(mirror.getRenderTarget().width<=1024,'Reflection resolution has a bounded GPU cost');
  let disposed=0;mirror.getRenderTarget().addEventListener('dispose',()=>disposed++);
  room.setActive(true);room.setActive(false);room.setActive(true);
  assert.equal(disposed,0,'Entering and leaving reuses the same reflection target');
  room.dispose();assert.equal(disposed,1);
  assert.equal(specimen.children.length,0);assert.equal(scene.children.length,1);
});

test('orbital drift is slow, shared by every sky surface and leaves walking geometry fixed',()=>{
  const scene=new THREE.Scene(),specimen=new THREE.Group();scene.add(specimen);
  const room=createMazeRoom({scene,specimen,canStand:()=>true});
  const uniforms=room.interior.wallMaterial.uniforms;
  const sky=room.group.getObjectByName('Continuous celestial backdrop');
  assert.equal(uniforms.uOrbitAngle,room.roof.material.uniforms.uOrbitAngle);
  assert.equal(uniforms.uOrbitAngle,sky.material.uniforms.uOrbitAngle);
  const position=specimen.position.clone(),quaternion=specimen.quaternion.clone();
  for(let i=0;i<1200;i++)room.interior.advance(.05);
  assert(Math.abs(uniforms.uOrbitAngle.value-Math.PI*2/90)<1e-9,'A minute advances only four degrees of the 90-minute orbit');
  assert(specimen.position.equals(position)&&specimen.quaternion.equals(quaternion));
  const angle=uniforms.uOrbitAngle.value;room.interior.advance(0);assert.equal(uniforms.uOrbitAngle.value,angle);
  room.dispose();
});

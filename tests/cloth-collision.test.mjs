import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createClothTriangleCollider}=await import('../cloth-triangle-collider.js');
const {createClothCollider}=await import('../cloth-collider.js');

test('an open triangle does not falsely classify surrounding space as solid',()=>{
  const collider=createClothTriangleCollider([[0,0,0,2,0,2,0,2,2]]);
  assert(!collider.contains([.5,.5,1.5]),'One-sided parity must not turn an open mesh into a solid half-space');
  const point=new Float64Array([.5,.5,1.02]);assert(collider.project(point,0,.06));
  const triangle=new THREE.Triangle(new THREE.Vector3(0,0,0),new THREE.Vector3(2,0,2),new THREE.Vector3(0,2,2)),closest=new THREE.Vector3();
  triangle.closestPointToPoint(new THREE.Vector3(...point),closest);assert(new THREE.Vector3(...point).distanceTo(closest)>.059);
});

test('wrapping protects a thin appendage and bridges the gap to the main object',()=>{
  const material=new THREE.MeshBasicMaterial(),body=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material),detail=new THREE.Mesh(new THREE.BoxGeometry(.012,.012,.012),material);
  detail.position.set(1.3,.234,1.3);const collider=createClothCollider([body,detail]);
  const point=new Float64Array([1.3,.234,1.3]);assert(collider.containsSurface(point));
  assert(collider.projectWrap(point,0,.05),'Small features survive conservative triangle-slab clipping');
  assert(!collider.containsSurface(point));
  const gap=new Float64Array([1.12,.234,1.12]);assert(!collider.containsSurface(gap));
  assert(collider.projectWrap(gap,0,.05),'Fabric bridges the space between protrusions');
  const before=new Float64Array([1.3,.2339,1.3]),after=new Float64Array([1.3,.2341,1.3]);collider.projectWrap(before,0,.05);collider.projectWrap(after,0,.05);
  assert(Math.hypot(before[0]-after[0],before[2]-after[2])<.02,'Crossing a slab boundary must not snap the cloth');
  const hem=new Float64Array([.1,-1.1,.1]);
  collider.projectWrap(hem,0,.05,0,0,0);
  assert(hem[0]>1.04&&hem[1]===-1.1,'Below the lowest limb, the skirt continues outward instead of folding into the underside');
  body.geometry.dispose();detail.geometry.dispose();material.dispose();
});

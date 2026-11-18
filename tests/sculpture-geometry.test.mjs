import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {refineSculptureGeometry}=await import('../kelp-sculpture.js');
const {prepareMarbleGeometry}=await import('../kelp-marble.js');

function normalsAtPositions(geometry){
  const groups=new Map(),p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(new THREE.Vector3().fromBufferAttribute(n,i));
  }
  return groups;
}

test('organic refinement removes lighting seams while keeping a bounded solid silhouette',()=>{
  const source=new THREE.IcosahedronGeometry(1,1),before=source.attributes.position.array.slice();
  const sculpture=refineSculptureGeometry(source,{organic:true});
  const p=sculpture.attributes.position,n=sculpture.attributes.normal;
  for(let i=0;i<p.count;i++){
    const radius=new THREE.Vector3().fromBufferAttribute(p,i).length();
    assert(radius>.8&&radius<=1.001,'The sculpture retains its volume');
    assert(Math.abs(new THREE.Vector3().fromBufferAttribute(n,i).length()-1)<1e-5);
  }
  for(const normals of normalsAtPositions(sculpture).values())for(const normal of normals)assert(normal.dot(normals[0])>.999,'Smooth adjacent triangles share the same lighting normal');
  assert.deepEqual(source.attributes.position.array,before,'Refining does not mutate the source model');
  prepareMarbleGeometry(sculpture);
  assert(sculpture.attributes.marbleCavity.array.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  source.dispose();sculpture.dispose();
});

test('architectural corners stay crisp at tiny and large model scales',()=>{
  for(const scale of [.001,1,1000]){
    const source=new THREE.BoxGeometry(scale,scale*2,scale*3),sculpture=refineSculptureGeometry(source);
    const n=sculpture.attributes.normal;
    for(let i=0;i<n.count;i++)assert(Math.max(Math.abs(n.getX(i)),Math.abs(n.getY(i)),Math.abs(n.getZ(i)))>.9999,'A hard edge must not shade like a melted corner');
    const size=sculpture.boundingBox.getSize(new THREE.Vector3());
    assert(Math.abs(size.x/scale-1)<1e-6&&Math.abs(size.y/scale-2)<1e-6&&Math.abs(size.z/scale-3)<1e-6);
    source.dispose();sculpture.dispose();
  }
});

test('crease-aware organic refinement preserves sharp pedestal edges',()=>{
  const source=new THREE.BoxGeometry(2,1,2),sculpture=refineSculptureGeometry(source,{organic:true});
  assert(sculpture.boundingBox.min.distanceTo(new THREE.Vector3(-1,-.5,-1))<1e-6);
  assert(sculpture.boundingBox.max.distanceTo(new THREE.Vector3(1,.5,1))<1e-6);
  const n=sculpture.attributes.normal;
  for(let i=0;i<n.count;i++)assert(Math.max(Math.abs(n.getX(i)),Math.abs(n.getY(i)),Math.abs(n.getZ(i)))>.9999);
  source.dispose();sculpture.dispose();
});


test('collapsed imported faces never reach the renderer with zero normals',()=>{
  for(const scale of [.001,1,1000]){
    const source=new THREE.BufferGeometry();
    source.setAttribute('position',new THREE.Float32BufferAttribute([
      0,0,0, scale,0,0, 0,scale,0,
      0,0,0, scale,0,0, scale*2,0,0,
      0,0,0, 0,0,0, 0,scale,0,
    ],3));
    const sculpture=refineSculptureGeometry(source),n=sculpture.attributes.normal;
    assert.equal(sculpture.attributes.position.count,3,'Only the real surface remains');
    for(let i=0;i<n.count;i++)assert(Math.abs(new THREE.Vector3().fromBufferAttribute(n,i).length()-1)<1e-6);
    source.dispose();sculpture.dispose();
  }
  const collapsed=new THREE.BufferGeometry();collapsed.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,2,0,0],3));
  assert.throws(()=>refineSculptureGeometry(collapsed),/no non-degenerate triangles/);collapsed.dispose();
});

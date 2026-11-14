import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createFeatherBrush}=await import('../feather-brush.js');
const {plumageFrame}=await import('../plumage-frame.js');

test('passing beside a feather bends it along the skin and it springs back afterwards',()=>{
  const brush=createFeatherBrush(),normal=new THREE.Vector3(0,0,1),rotation=new THREE.Quaternion();plumageFrame(normal,22,0,0,rotation);
  const sample={index:0,scale:.0026,anchorPosition:new THREE.Vector3(0,.02,0),anchorNormal:normal,anchorRotation:rotation};
  const root=sample.anchorPosition.clone(),player=new THREE.Vector3(0,.02,.02);
  for(let i=0;i<90;i++)brush.update([sample],player,1/60,2);
  assert(sample.push.length()>.005&&sample.push.length()<.03);
  assert(Math.abs(sample.push.dot(normal))<1e-8,'Bending must sweep along the surface, not bury the feather in the wall');
  assert(sample.anchorPosition.equals(root),'The quill stays attached');
  player.set(1,.02,1);
  for(let i=0;i<180;i++)brush.update([sample],player,1/60,2);
  assert(sample.push.length()<1e-5&&sample.pushVelocity.length()<1e-5);
  assert.equal(brush.update([sample],player,1/60,2),false,'Settled feathers must stop requesting frames');
});

test('brushing skips detached feathers and remains finite after a suspended frame',()=>{
  const brush=createFeatherBrush(),sample={index:0,scale:.0026,anchorPosition:new THREE.Vector3(0,.02,0),anchorNormal:new THREE.Vector3(0,0,1),anchorRotation:new THREE.Quaternion()};
  const player=new THREE.Vector3(0,.02,.02);
  brush.update([sample],player,1,2,()=>true);assert.equal(sample.push,undefined);
  for(let i=0;i<30;i++)brush.update([sample],player,1,2);
  assert(sample.push.toArray().every(Number.isFinite));assert(sample.push.length()<.03);
});

import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createDesertMirage}=await import('../desert-mirage.js');

test('heat shimmer updates only for a visible loaded desert and stops at zero strength',()=>{
  const landmark=new THREE.Group(),mirage=createDesertMirage({renderer:{},landmark});
  mirage.setEnabled(true);assert.equal(mirage.advance(.05),false,'Loading the tower does not run an empty effect');
  landmark.add(new THREE.Group());landmark.visible=true;assert(mirage.advance(.05));assert.equal(mirage.time,.05);
  mirage.setStrength(0);assert.equal(mirage.advance(.05),false);assert.equal(mirage.time,.05);
  mirage.setStrength(5);assert.equal(mirage.strength,1);landmark.visible=false;assert.equal(mirage.advance(.05),false);
  landmark.visible=true;mirage.setEnabled(false);assert.equal(mirage.advance(.05),false);
  let drawn=0;mirage.render(null,null,()=>drawn++);assert.equal(drawn,1,'Other scene modes render directly');mirage.dispose();
});

test('reduced motion keeps the mirage reflection still',()=>{
  const landmark=new THREE.Group();landmark.add(new THREE.Group());
  const mirage=createDesertMirage({renderer:{},landmark,reducedMotion:true});mirage.setEnabled(true);
  for(let i=0;i<10;i++)assert.equal(mirage.advance(.05),false);
  assert.equal(mirage.time,0);assert(mirage.strength>0,'The static reflection remains available');mirage.dispose();
});

test('mirage projection follows a newly moved camera before allocating a render target',()=>{
  const landmark=new THREE.Group();landmark.position.z=10;landmark.add(new THREE.Group());
  const camera=new THREE.PerspectiveCamera(55,1,1,4000);camera.position.z=15;camera.lookAt(0,0,0);camera.updateMatrixWorld();
  camera.position.z=0;
  const mirage=createDesertMirage({renderer:{},landmark});mirage.setEnabled(true);let drawn=0;
  mirage.render(new THREE.Scene(),camera,()=>drawn++);assert.equal(drawn,1,'A tower now behind the camera renders directly instead of using its old screen position');mirage.dispose();
});

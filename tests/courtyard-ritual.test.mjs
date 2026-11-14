import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createCourtyardRitual}=await import('../courtyard-ritual.js');
const {createMazeWalker}=await import('../maze-navigation.js');
const {setMazeMap,mazeMaps}=await import('../maze-geometry.js');

for(const map of mazeMaps)test(`${map.id}: arrival reveals a restrained, collision-aware courtyard ritual`,()=>{
  setMazeMap(map.id);
  const parent=new THREE.Group(),walker=createMazeWalker(),camera=new THREE.PerspectiveCamera(),ritual=createCourtyardRitual({parent,canStand:walker.canStand});
  if(map.id==='observatory'){parent.rotation.set(.4,-.3,.2);parent.position.set(.3,.2,-.4);}
  parent.updateMatrixWorld(true);
  camera.position.copy(walker.position).applyMatrix4(parent.matrixWorld);
  for(let i=0;i<120;i++)ritual.advance(1/60,camera);
  assert.equal(ritual.stats.total,4,'Only a few feathers drift before arrival');
  assert.equal(ritual.stats.phase,'arrival');
  camera.position.copy(ritual.center);camera.position.y=.02;camera.position.applyMatrix4(parent.matrixWorld);
  for(let i=0;i<900;i++)ritual.advance(1/60,camera);
  assert.deepEqual(ritual.stats,{heroes:8,ambient:28,total:36,dust:128,phase:'settled'});
  const matrix=new THREE.Matrix4(),p=new THREE.Vector3();
  for(const mesh of [ritual.heroes,ritual.ambient]){
    assert(!mesh.material.transparent,'Feather silhouettes use opaque geometry');
    assert.equal(mesh.material.emissive.getHex(),0,'Gold catches the room lights without self illumination');
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);assert(matrix.elements.every(Number.isFinite));p.setFromMatrixPosition(matrix);
      assert(walker.canStand(p.x,p.z,0),`Feather ${i} stays in open courtyard space`);
      assert(Math.abs(p.y)<.19,'Feathers remain within the floor and ceiling');
    }
  }
  const before=ritual.heroes.instanceMatrix.array.slice();
  for(let i=0;i<240;i++)ritual.advance(1/60,camera);
  assert(before.some((value,i)=>Math.abs(value-ritual.heroes.instanceMatrix.array[i])>1e-5),'The settled ritual continues to orbit');
  assert(ritual.dust.geometry.attributes.position.array.every(Number.isFinite));
  let released=0;ritual.heroes.geometry.addEventListener('dispose',()=>released++);
  ritual.dispose();assert.equal(parent.children.length,0);assert.equal(released,1,'Shared geometry is released once');
  setMazeMap('garden');
});

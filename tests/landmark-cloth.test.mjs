import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createLandmarkCloth}=await import('../landmark-cloth.js');

test('a kilometer tower uses a stable cloth frame without moving or disposing the source model',()=>{
  const scene=new THREE.Scene(),tower=new THREE.Group(),material=new THREE.MeshStandardMaterial();
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.4,12,200,8),material);mesh.position.y=100;tower.add(mesh);
  tower.position.set(-465,-1.75,-308);tower.rotation.y=.3;scene.add(tower);scene.updateMatrixWorld(true);
  const original=new THREE.Box3().setFromObject(tower,true),matrix=mesh.matrixWorld.clone();
  let sourceDisposals=0;mesh.geometry.addEventListener('dispose',()=>sourceDisposals++);
  const wrap=createLandmarkCloth({scene});wrap.rebuild(tower,{resolution:12,held:true,autoSettle:false});
  assert(Math.abs(wrap.surface.collider.bounds.max.y-3)<1e-6,'The solver operates at the usual specimen scale');
  const normalized=wrap.surface.collider.bounds.clone().applyMatrix4(wrap.group.matrixWorld);
  assert(normalized.min.distanceTo(original.min)<1e-3&&normalized.max.distanceTo(original.max)<1e-3,'The collision frame maps back onto the original tower');
  const cloth=wrap.surface,initial=cloth.simulation.positions.slice();
  for(let i=0;i<120;i++)cloth.advance(1/60);
  assert(cloth.simulation.positions.every(Number.isFinite));
  assert(cloth.simulation.positions.some((v,i)=>Math.abs(v-initial[i])>.3),'Gravity folds the sheet around the tower');
  let floor=Infinity,inside=0;
  for(let i=0;i<cloth.simulation.positions.length;i+=3){floor=Math.min(floor,cloth.simulation.positions[i+1]);if(cloth.collider.containsSurface(cloth.simulation.positions,i))inside++;}
  assert(floor>=.01&&inside<4,'The ground and tower support the drape');
  cloth.mesh.updateWorldMatrix(true,false);
  const rendered=new THREE.Box3().setFromObject(cloth.mesh);
  assert(rendered.max.y>original.max.y-10&&rendered.min.y>=original.min.y,'The visible drape stays at the kilometer-scale landmark');
  cloth.simulation.paused=true;assert.equal(cloth.advance(.1),false);
  wrap.clear();assert.equal(cloth.mesh,null);assert.equal(wrap.group.visible,false);
  wrap.rebuild(tower,{resolution:12,fabric:'plastic'});assert.equal(cloth.fabric.name,'Pearl plastic');
  assert.deepEqual(mesh.matrixWorld,matrix);assert.equal(sourceDisposals,0);assert.equal(mesh.parent,tower);
  wrap.dispose();assert.equal(sourceDisposals,0);assert.equal(scene.getObjectByName('Jeddah tower cloth'),undefined);
  mesh.geometry.dispose();material.dispose();
});

test('an empty landmark does not create a cloth simulation',()=>{
  const wrap=createLandmarkCloth({scene:new THREE.Scene()});
  assert.throws(()=>wrap.rebuild(new THREE.Group()),/no height/);assert.equal(wrap.surface.simulation,null);wrap.dispose();
});

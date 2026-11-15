import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createDesertLandmark,desertMetersPerUnit}=await import('../desert-landmark.js');

function fixture(){
  const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(175,1007,151),material);
  mesh.position.set(-630,503.5,30);root.add(mesh);return {root,mesh,material};
}

test('Jeddah stays one kilometer tall, grounded in the distance and keeps its original materials',async()=>{
  const scene=new THREE.Scene(),{root,mesh,material}=fixture();let loads=0,invalidations=0;
  const landmark=createDesertLandmark({scene,floorY:-1.75,loader:{async loadAsync(url){loads++;assert(url.endsWith('/samples/jeddah.glb'));return {scene:root};}},invalidate(){invalidations++;}});
  landmark.setVisible(true);await landmark.load();
  const bounds=new THREE.Box3().setFromObject(landmark.group),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  assert(Math.abs(size.y*desertMetersPerUnit-1000)<.0001,'Scale uses meters rather than fitting the tower to palm height');
  assert(Math.abs(bounds.min.y+1.75)<.0001,'The base meets the desert floor');
  assert(Math.abs(center.x-landmark.group.position.x)<.0001&&Math.abs(center.z-landmark.group.position.z)<.0001,'The model is centered at the distant placement despite its source offset');
  assert(Math.abs(Math.hypot(center.x,center.z)*desertMetersPerUnit-2800)<50,'The landmark remains approximately 2.8 kilometers away');
  assert.equal(mesh.material,material);assert(mesh.castShadow&&mesh.receiveShadow);assert.equal(invalidations,1);
  landmark.setVisible(false);landmark.setVisible(true);await landmark.load();assert.equal(loads,1,'Environment toggles reuse the loaded building');
  let disposals=0;mesh.geometry.addEventListener('dispose',()=>disposals++);landmark.dispose();assert.equal(scene.children.length,0);assert.equal(disposals,1);
});

test('a pending building load respects leaving the scene and disposal',async()=>{
  const scene=new THREE.Scene(),{root,mesh}=fixture();let finish;
  const landmark=createDesertLandmark({scene,loader:{loadAsync(){return new Promise(resolve=>{finish=resolve;});}}});
  landmark.setVisible(true);const loading=landmark.load();landmark.setVisible(false);finish({scene:root});await loading;
  assert.equal(landmark.group.visible,false,'Finishing a load does not reopen a disabled desert');landmark.dispose();
  const second=fixture();let finishSecond,disposed=0;second.mesh.geometry.addEventListener('dispose',()=>disposed++);
  const pending=createDesertLandmark({scene,loader:{loadAsync(){return new Promise(resolve=>{finishSecond=resolve;});}}});
  pending.setVisible(true);const late=pending.load();pending.dispose();finishSecond({scene:second.root});await late;
  assert.equal(disposed,1,'A late load releases its resources after disposal');assert.equal(scene.children.length,0);
});

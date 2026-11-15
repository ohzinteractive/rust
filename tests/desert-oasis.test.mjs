import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createDesertOasis,oasisWaterRadius,oasisTerrainHeight,oasisOutline}=await import('../desert-oasis.js');

test('the oasis groups varied grounded palms outside an organic pool and shares reusable variants',()=>{
  const scene=new THREE.Scene(),oasis=createDesertOasis({scene}),sand=new THREE.MeshStandardMaterial();
  oasis.rebuild({seed:7319});oasis.setEnabled(true,sand);
  assert.equal(oasis.stats.palms,16);assert.equal(oasis.stats.maturePalms,9);assert.equal(oasis.stats.youngPalms,7);assert.equal(oasis.grove.children.length,8);assert(oasis.water.isReflector);
  const variants=new Set(),scales=new Set();
  for(const tree of oasis.grove.children){
    const [x,y,z]=tree.userData.root;
    assert(oasisWaterRadius(x,z)>1.1,'Trunks grow on the bank rather than in the water');
    const bounds=new THREE.Box3().setFromObject(tree);assert(Math.abs(bounds.min.y-y)<.06,'Scaled palms meet the same ground');
    scales.add(tree.scale.y);variants.add(tree.getObjectByName('Green palm frond').children[0].geometry);
  }
  assert.equal(variants.size,3,'The grove reuses three distinct feather-grown meshes');assert(scales.size>5,'Palms vary in height');
  const roots=oasis.grove.children.map(tree=>tree.userData.root);roots.push([-.55,-1.75,0]);
  assert(roots.every(([,,z])=>z<2),'The grove stays grouped on the far bank and leaves the foreground open');
  for(const [x,y,z] of roots.slice(0,-1))assert(Math.abs(y-oasisTerrainHeight(x,z))<.0001,'Palms follow the valley floor');
  let paired=false;
  for(let i=0;i<roots.length;i++)for(let j=0;j<i;j++){
    const distance=Math.hypot(roots[i][0]-roots[j][0],roots[i][2]-roots[j][2]);
    assert(distance>.35,'Clustered trunks have room at their bases');if(distance<1.2)paired=true;
  }
  assert(paired,'Some mature palms grow together in a family clump');
  for(const tree of oasis.understory.children){
    const [x,y,z]=tree.userData.root,bounds=new THREE.Box3().setFromObject(tree);
    assert(oasisWaterRadius(x,z)>1.05,'Young palms remain on the bank');assert(Math.abs(bounds.min.y-y)<.06);
    assert(bounds.max.y-y<1.6,'Understory crowns stay well below the mature palms');assert.equal(tree.getObjectByName('Dry palm frond'),undefined,'Young palms have fresh green growth');
    const p=tree.getObjectByName('Curved palm trunk').geometry.attributes.position,root=new THREE.Vector3(-.55,0,0);let radius=0;
    for(let i=0;i<12;i++)radius=Math.max(radius,new THREE.Vector3().fromBufferAttribute(p,i).distanceTo(root));
    assert(radius*2*tree.scale.x>.18,'Young trunks remain thick rather than miniature adult stems');
    assert(tree.getObjectByName('Old palm leaf bases').visible,'Short palms retain their rough bark bases');
    const [px,,pz]=tree.userData.parentRoot;assert(Math.hypot(x-px,z-pz)<1.1,'Young palms emerge near a parent trunk');
  }
  const families=new Set(oasis.understory.children.map(tree=>tree.userData.parentRoot.join(',')));assert(families.size>1&&families.size<oasis.understory.children.length,'Young palms grow in shared clusters');
  const first=oasis.grove.children[0];oasis.rebuild({seed:7319});assert.equal(oasis.grove.children[0],first,'Unchanged settings keep cached palms');
  let disposed=0;first.getObjectByName('Green palm frond').children[0].geometry.addEventListener('dispose',()=>disposed++);
  oasis.rebuild({seed:7320});assert.equal(disposed,1,'Rebuilding frees each shared source geometry once');
  oasis.group.traverse(mesh=>{if(mesh.geometry)assert(mesh.geometry.attributes.position.array.every(Number.isFinite));});
  assert(oasis.group.getObjectByName('Oasis sandy shoreline').geometry.attributes.normal.array.some((v,i)=>i%3===1&&v>.9));
  oasis.dispose();assert.equal(scene.children.length,0);sand.dispose();
});

test('the water lies at the bottom of the valley and the original palm follows the bank',()=>{
  const floor=-1.75,bottom=oasisTerrainHeight(-3,3.5,floor);
  for(const [x,z] of [[-17,3.5],[12,3.5],[-3,-10],[-3,15]])assert(oasisTerrainHeight(x,z,floor)>bottom+1,'Sand dunes rise on every side of the basin');
  assert(bottom<floor+.02,'The lowest sand sits just beneath the water level');
  assert(oasisTerrainHeight(-5,11,floor)>oasisTerrainHeight(-5,-6,floor)+1,'The dominant dune is opposite the grove');
  const scene=new THREE.Scene(),primaryPalm={group:new THREE.Group()},oasis=createDesertOasis({scene,primaryPalm}),sand=new THREE.MeshStandardMaterial();
  oasis.setEnabled(true,sand);assert(Math.abs(primaryPalm.group.position.y-(oasisTerrainHeight(-.55,0)-floor))<.0001);
  const height=primaryPalm.group.position.y;oasis.setEnabled(true,sand);assert.equal(primaryPalm.group.position.y,height,'Repeated syncs do not lift the palm again');
  oasis.setEnabled(false);assert.equal(primaryPalm.group.position.y,0,'The single-palm view restores its original ground height');
  oasis.dispose();sand.dispose();
});

test('water ripples and frond sway stop outside the oasis or with reduced motion',()=>{
  const scene=new THREE.Scene(),oasis=createDesertOasis({scene}),sand=new THREE.MeshStandardMaterial();
  oasis.setEnabled(true,sand);assert(oasis.advance(.05));assert(oasis.water.material.uniforms.uTime.value>0);
  const frond=oasis.grove.children[0].getObjectByName('Green palm frond');assert(frond.rotation.x!==0||frond.rotation.z!==0);
  oasis.setWind(0);assert.equal(frond.rotation.x,0);assert.equal(frond.rotation.z,0);
  oasis.setEnabled(false);const time=oasis.water.material.uniforms.uTime.value;assert.equal(oasis.advance(.05),false);assert.equal(oasis.water.material.uniforms.uTime.value,time);oasis.dispose();
  const still=createDesertOasis({scene,reducedMotion:true});still.setEnabled(true,sand);assert.equal(still.advance(.05),false);assert.equal(still.water.material.uniforms.uTime.value,0);still.dispose();sand.dispose();
});

test('shore coves form a closed boundary and local ground details stay on the dry bank',()=>{
  const radii=Array.from({length:360},(_,i)=>oasisOutline(i*Math.PI/180));
  assert(Math.max(...radii)-Math.min(...radii)>.25,'The shoreline has noticeable coves rather than a uniform ellipse');
  assert(Math.min(...radii)>.7);assert(Math.abs(oasisOutline(-Math.PI)-oasisOutline(Math.PI))<1e-8,'The boundary closes without a seam');
  const scene=new THREE.Scene(),oasis=createDesertOasis({scene});oasis.rebuild();oasis.group.updateMatrixWorld(true);
  const water=oasis.water.geometry.attributes.position;
  for(let i=0;i<water.count;i++){
    const p=new THREE.Vector3().fromBufferAttribute(water,i).applyMatrix4(oasis.water.matrixWorld);
    assert(Math.abs(oasisWaterRadius(p.x,p.z)-1)<1e-5,'Water geometry follows the same cove boundary as the shoreline');
  }
  const matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  for(const mesh of [oasis.groundcover.rocks,oasis.groundcover.grass])for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);
    assert(oasisWaterRadius(point.x,point.z)>1.08,'Rocks and grasses remain outside the water');
    assert(Math.hypot(point.x+3,point.z-3.5)<15,'Ground details stay concentrated around the oasis');
  }
  oasis.dispose();
});

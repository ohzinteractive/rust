import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createPalmTree}=await import('../palm-tree.js');

test('feather-grown palm has a grounded curved trunk, pinnate crown and dry lower fronds',()=>{
  const scene=new THREE.Scene(),palm=createPalmTree({scene});palm.rebuild();
  assert.equal(palm.stats.fronds,30);assert(palm.stats.leaflets>1000);
  assert(palm.group.getObjectByName('Curved palm trunk'));assert(palm.group.getObjectByName('Dry palm frond'));
  palm.group.traverse(mesh=>{if(mesh.geometry)assert(mesh.geometry.attributes.position.array.every(Number.isFinite));});
  const bounds=new THREE.Box3().setFromObject(palm.group);assert(bounds.min.y> -1.95&&bounds.min.y< -1.65);assert(bounds.max.y>.9);
  const leaf=palm.group.getObjectByName('Green palm frond').children[0],original=leaf.geometry.attributes.position.array.slice();
  palm.rebuild();assert.deepEqual(palm.group.getObjectByName('Green palm frond').children[0].geometry.attributes.position.array,original,'A seed gives the same fronds');
  palm.rebuild({fronds:18,seed:123,length:1.8,droop:1.5});assert.equal(palm.stats.fronds,18);
  palm.dispose();assert.equal(scene.children.length,0);
});

test('wind bends fronds around their fixed crown roots and calm trees stop updating',()=>{
  const scene=new THREE.Scene(),palm=createPalmTree({scene});palm.rebuild({wind:.5});palm.group.visible=true;
  const frond=palm.group.getObjectByName('Green palm frond'),root=frond.position.clone();
  assert(palm.advance(1/60));assert.deepEqual(frond.position,root);assert(frond.rotation.x!==0||frond.rotation.z!==0);
  palm.setWind(0);assert.equal(palm.advance(1/60),false);assert.equal(frond.rotation.x,0);assert.equal(frond.rotation.z,0);
  let disposed=0;frond.children[0].geometry.addEventListener('dispose',()=>disposed++);palm.rebuild();assert.equal(disposed,1);
  palm.group.visible=false;palm.setWind(.5);assert.equal(palm.advance(1/60),false);palm.dispose();
});

test('short palms keep substantial trunk diameter independently of their height',()=>{
  const scene=new THREE.Scene(),palm=createPalmTree({scene,floorY:0});palm.rebuild();
  const root=new THREE.Vector3(-.55,0,0);
  function baseRadius(){const p=palm.group.getObjectByName('Curved palm trunk').geometry.attributes.position;let radius=0;for(let i=0;i<12;i++)radius=Math.max(radius,new THREE.Vector3().fromBufferAttribute(p,i).distanceTo(root));return radius;}
  const matureRadius=baseRadius();
  palm.rebuild({trunkHeight:.38,trunkRadius:.11,length:.9,dryFraction:0});
  assert(baseRadius()>matureRadius*.85,'Shortening the trunk does not shrink its diameter');
  assert(Math.abs(palm.group.getObjectByName('Palm growing heart').position.y-.38)<.001,'The crown attaches to the short trunk');
  assert(baseRadius()*2/.38>.6,'The short trunk has a stout silhouette');
  assert(palm.group.getObjectByName('Old palm leaf bases').count<=60,'Bark bases retain their physical spacing on short trunks');palm.dispose();
});

test('young growth opens through a continuous crown above brown hanging fronds',()=>{
  const scene=new THREE.Scene(),palm=createPalmTree({scene});palm.rebuild();
  const fronds=palm.group.children.filter(child=>child.userData.layer),dry=fronds.filter(child=>child.userData.layer==='dry'),spears=fronds.filter(child=>child.userData.layer==='spear');
  assert.equal(dry.length,9);assert(spears.length>=3&&spears.length<6);assert(palm.group.getObjectByName('Palm growing heart'));
  for(const frond of dry){
    const bounds=new THREE.Box3().setFromObject(frond);assert(bounds.min.y<frond.position.y-1.1,'Dead fronds hang downward below their roots');
    assert(bounds.max.y<frond.position.y+.2,'Dry fronds do not jut upward into the new growth');
    assert(frond.children[1].material.color.r>frond.children[1].material.color.g,'Dry stalks are brown too');
    assert(frond.position.y<spears[0].position.y-.15);
  }
  for(const frond of spears){const bounds=new THREE.Box3().setFromObject(frond);assert(bounds.max.y>frond.position.y+.9,'The growing crown points upward');}
  const inclinations=fronds.filter(frond=>frond.userData.layer!=='dry').map(frond=>{
    const p=frond.children[1].geometry.attributes.position,centers=[new THREE.Vector3(),new THREE.Vector3()];
    for(let side=0;side<4;side++){
      centers[0].add(new THREE.Vector3().fromBufferAttribute(p,side));
      centers[1].add(new THREE.Vector3().fromBufferAttribute(p,p.count-5+side));
    }
    const tip=centers[1].sub(centers[0]).multiplyScalar(.25);
    return Math.atan2(tip.y,Math.hypot(tip.x,tip.z));
  }).sort((a,b)=>a-b);
  assert(inclinations[0]<-.5&&inclinations.at(-1)>1,'Live leaves span drooping and upright growth');
  for(let i=1;i<inclinations.length;i++)assert(inclinations[i]-inclinations[i-1]<.4,'Intermediate leaves fill the crown rather than leaving an angular gap');
  const bases=palm.group.getObjectByName('Old palm leaf bases');
  assert(bases.instanceColor,'Old leaf bases have individual weathered colors');
  assert(new Set(bases.instanceColor.array).size>100,'Bark color varies across the trunk');
  const leaflets=palm.stats.leaflets;palm.rebuild({density:1,dryFraction:.5});assert(palm.stats.leaflets>leaflets);
  assert.equal(palm.group.children.filter(child=>child.userData.layer==='dry').length,15);
  palm.rebuild({dryFraction:0});assert.equal(palm.group.children.filter(child=>child.userData.layer==='dry').length,0);palm.dispose();
});

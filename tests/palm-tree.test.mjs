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

test('a growing palm frond rises folded, then opens and lowers at the crown in calm air',()=>{
  const scene=new THREE.Scene(),palm=createPalmTree({scene,growFronds:true});
  palm.rebuild({wind:0});
  palm.group.visible=true;
  const shoot=palm.group.getObjectByName('Growing palm frond');
  const root=new THREE.Vector3();
  shoot.getWorldPosition(root);
  const stem=shoot.children[1];
  const vertices=stem.geometry.attributes.position;
  const tip=()=>stem.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices,vertices.count-5)).sub(root);
  assert.equal(shoot.visible,false);
  for(let i=0;i<80;i++)assert(palm.advance(.05));
  const upright=tip();
  const folded=shoot.scale.z;
  assert(upright.y>Math.hypot(upright.x,upright.z)*2);
  for(let i=0;i<170;i++)palm.advance(.05);
  const spread=tip();
  assert(spread.y<upright.y*.6);
  assert(Math.hypot(spread.x,spread.z)>Math.hypot(upright.x,upright.z)*2);
  assert(shoot.scale.z>folded*5);
  assert(shoot.getWorldPosition(new THREE.Vector3()).distanceTo(root)<1e-6);
  palm.dispose();
});

test('development seeks before the first rebuild are retained when the palm is built',()=>{
  const palm=createPalmTree({scene:new THREE.Scene(),showDevelopment:true});
  palm.seekDevelopment(1);
  palm.seekDevelopment(.52);
  assert.equal(palm.stats.fronds,0);
  palm.rebuild();
  const trunk=palm.group.getObjectByName('Curved palm trunk');
  assert(trunk.parent.visible&&trunk.parent.scale.y>0&&trunk.parent.scale.y<.5);
  const scale=trunk.parent.scale.clone(),drawCount=trunk.geometry.drawRange.count;
  palm.seekDevelopment(.52);
  assert.deepEqual(trunk.parent.scale,scale);
  assert.equal(trunk.geometry.drawRange.count,drawCount);
  palm.seekDevelopment(1);
  assert.equal(trunk.parent.scale.y,1);
  palm.dispose();
});

test('the palm can be scrubbed from a grounded seed to a full crown and back',()=>{
  const scene=new THREE.Scene(),palm=createPalmTree({scene,showDevelopment:true});
  palm.rebuild();
  const seed=palm.group.getObjectByName('Palm seed');
  const shoot=palm.group.getObjectByName('First palm shoot');
  const trunk=palm.group.getObjectByName('Curved palm trunk');
  palm.seekDevelopment(0);
  assert(seed.visible&&!shoot.visible&&!trunk.parent.visible);
  palm.seekDevelopment(.23);
  assert(shoot.visible&&shoot.scale.y>.5);
  palm.seekDevelopment(.52);
  assert(trunk.parent.visible&&trunk.parent.scale.y<.5);
  const base=trunk.localToWorld(new THREE.Vector3(-.55,-1.75,0));
  assert(base.distanceTo(new THREE.Vector3(-.55,-1.75,0))<1e-6);
  palm.seekDevelopment(1);
  assert(!seed.visible&&!shoot.visible&&trunk.parent.scale.y===1);
  palm.seekDevelopment(0);
  assert(seed.visible&&!shoot.visible&&!trunk.parent.visible);
  palm.dispose();
});

test('studio leaves emerge individually in rings of three before the next ring rises',()=>{
  const palm=createPalmTree({scene:new THREE.Scene(),showDevelopment:true,growFronds:true});
  palm.rebuild();
  const leaves=[];
  palm.group.traverse(object=>{if(object.name==='Green palm frond')leaves.push(object);});
  const emerged=new Set();
  let previous;
  for(let frame=0;frame<=600&&emerged.size<7;frame++){
    palm.seekDevelopment(frame/1000);
    const fresh=leaves.filter(leaf=>leaf.visible&&!emerged.has(leaf));
    assert(fresh.length<=1);
    if(!fresh.length)continue;
    const leaf=fresh[0],blade=leaf.children[0].children[0];
    assert(blade.scale.z<blade.scale.y*.2);
    if(previous){
      if(emerged.size%3===0)assert(leaf.position.y>previous.leaf.position.y);
      else{
        assert.equal(leaf.position.y,previous.leaf.position.y);
        assert(Math.abs(Math.cos(blade.parent.rotation.y-previous.heading)+.5)<1e-6);
      }
      assert(previous.blade.rotation.z<previous.pitch);
      assert(previous.blade.scale.z>previous.width);
    }
    previous={leaf,blade,heading:blade.parent.rotation.y,pitch:blade.rotation.z,width:blade.scale.z};
    emerged.add(leaf);
  }
  assert.equal(emerged.size,7);
  palm.dispose();
});

test('an old studio leaf browns, falls to the floor and fades independently of new leaves',()=>{
  const palm=createPalmTree({scene:new THREE.Scene(),floorY:0,showDevelopment:true});
  palm.rebuild();
  const leaves=[];
  palm.group.traverse(object=>{if(object.name==='Green palm frond')leaves.push(object);});
  const seekLeafTime=time=>palm.seekDevelopment(.15+.85*(time/84)**(1/1.8));
  seekLeafTime(5);
  const old=leaves.at(-1),blade=old.children[0].children[0],leaf=blade.children[0];
  const root=old.position.clone(),pitch=blade.rotation.z;
  seekLeafTime(15.3);
  assert(old.position.distanceTo(root)<1e-6);
  assert(blade.rotation.z<pitch&&leaf.material.color.g<.6);
  assert.equal(leaves.at(-5).children[0].children[0].children[0].material.opacity,1);
  seekLeafTime(17.5);
  assert(old.position.y<root.y&&old.position.y>.012);
  seekLeafTime(20);
  assert(Math.abs(old.position.y-(.003+old.userData.landing.clearance*blade.scale.y))<1e-6);
  assert(leaf.material.opacity>0&&leaf.material.opacity<1);
  seekLeafTime(5);
  assert(old.position.distanceTo(root)<1e-6&&old.scale.y===1&&leaf.material.opacity===1);
  palm.dispose();
});

test('a dry studio branch stays on its original ring and lands without flattening',()=>{
  const palm=createPalmTree({scene:new THREE.Scene(),showDevelopment:true,floorY:0});
  palm.rebuild({wind:0});
  const branch=palm.group.getObjectByName('Dry palm frond');
  palm.seekDevelopment(.73);
  const anchor=branch.position.clone();
  for(let frame=74;frame<=83;frame++){
    palm.seekDevelopment(frame/100);
    assert(branch.position.distanceTo(anchor)<1e-6);
  }
  let lastY=anchor.y;
  for(let frame=831;frame<=880;frame++){
    palm.seekDevelopment(frame/1000);
    assert(branch.position.y<=lastY+1e-6);
    assert.equal(branch.scale.x,branch.scale.y);
    lastY=branch.position.y;
  }
  assert(lastY<anchor.y*.5);
  palm.dispose();
});

import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelpSunlight}=await import('../kelp-lighting.js');
const {createKelpSeabed,seabedHeight}=await import('../kelp-seabed.js');

test('sand has bounded surface relief and a level sculpture clearing',()=>{
  assert(Math.abs(seabedHeight(0,2.5))<1e-8);
  let min=Infinity,max=-Infinity;
  for(let x=-12;x<=12;x+=.4)for(let z=-12;z<=12;z+=.4){const h=seabedHeight(x,z);assert(Number.isFinite(h)&&Math.abs(h)<.1);min=Math.min(min,h);max=Math.max(max,h);}
  assert(max-min>.07,'Broad dunes and depressions are real height changes');
});

test('sediment builds up locally at rock bases and clears when the rock field changes',()=>{
  const seabed=createKelpSeabed({sunlight:createKelpSunlight(),time:{value:0}});
  const x=5+1.02,z=0,before=seabed.heightAt(x,z),far=seabed.heightAt(-8,6);
  seabed.setStones([{center:new THREE.Vector3(5,0,0),rx:1,rz:.8,angle:0}]);
  assert(seabed.heightAt(x,z)>before+.025);assert.equal(seabed.heightAt(-8,6),far);
  const contact=seabed.geometry.attributes.seabedSediment.array;assert(contact.some((v,i)=>i%2===0&&v>.7),'Contact shading follows the stone footprint');
  assert(seabed.geometry.attributes.normal.array.every(Number.isFinite));
  seabed.setStones([]);assert.equal(seabed.heightAt(x,z),before);assert(contact.every(v=>v===0));seabed.dispose();
});

test('neighboring stones form broad continuous banks while the focal clearing stays level',()=>{
  const seabed=createKelpSeabed({sunlight:createKelpSunlight(),time:{value:0}});
  const a={center:new THREE.Vector3(4,0,0),rx:.8,rz:.9,angle:.3},b={center:new THREE.Vector3(6,0,0),rx:1,rz:.8,angle:-.5};
  const centerBefore=seabed.heightAt(0,2.5),base=seabed.heightAt(5,0),skirt=seabed.heightAt(5.6,0);
  seabed.setStones([a]);const single=seabed.heightAt(5,0);
  assert(single-base>.08,'A real sand bank rises beside the rock');assert(seabed.heightAt(5.6,0)-skirt>.035,'The bank has a broad outer skirt');
  seabed.setStones([a,b]);assert(seabed.heightAt(5,0)>single+.025,'Deposits blend across the gap between stones');
  assert.equal(seabed.heightAt(0,2.5),centerBefore,'The sculpture foundation remains level');
  let previous=seabed.heightAt(2,0);
  for(let x=2.05;x<8;x+=.05){const h=seabed.heightAt(x,0);assert(Math.abs(h-previous)<.045,'Bank shoulders transition smoothly');assert(h-seabedHeight(x,0)<.28);previous=h;}
  const mesh=new THREE.Mesh(seabed.geometry,new THREE.MeshBasicMaterial());mesh.rotation.x=-Math.PI/2;mesh.updateMatrixWorld(true);
  const ray=new THREE.Raycaster();
  for(const [x,z] of [[4.2,.1],[5.13,.46],[6.3,-.7]]){
    ray.set(new THREE.Vector3(x,2,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(mesh,false)[0];
    assert(hit&&Math.abs(hit.point.y-seabed.heightAt(x,z))<1e-6,'Swimming and debris sample the rendered surface');
  }
  mesh.material.dispose();seabed.dispose();
});


test('an impact depresses the footprint, pushes a rim of sand outward, and clears on replacement',()=>{
  const seabed=createKelpSeabed({sunlight:createKelpSunlight(),time:{value:0}});
  const center=seabed.heightAt(0,2.5),rim=seabed.heightAt(1.13,2.5),far=seabed.heightAt(5,5);
  seabed.setImpact({x:0,z:2.5,rx:1,rz:.8,depth:.16});
  assert.equal(seabed.heightAt(0,2.5),center);
  for(let i=0;i<10;i++)seabed.advance(.1);
  assert(seabed.heightAt(0,2.5)<center-.07);
  assert(seabed.heightAt(1.13,2.5)>rim+.025);
  assert.equal(seabed.heightAt(5,5),far);assert(!seabed.advance(.1));
  seabed.setStones([]);assert(seabed.heightAt(0,2.5)<center-.07,'Rebuilding the stone field preserves the footprint');
  seabed.setImpact(null);assert.equal(seabed.heightAt(0,2.5),center);assert.equal(seabed.heightAt(1.13,2.5),rim);
  assert(seabed.geometry.attributes.normal.array.every(Number.isFinite));seabed.dispose();
});


test('a cube remains embedded across its footprint without a circular sand lip',()=>{
  const seabed=createKelpSeabed({sunlight:createKelpSunlight(),time:{value:0}});
  const floor=seabed.heightAt(0,2.5),depth=.16,bottom=floor-depth;
  seabed.setImpact({x:0,z:2.5,rx:1.3,rz:1.3,depth,footprint:'box',quiet:true});
  for(let x=-1.3;x<=1.3;x+=.13)for(let z=1.2;z<=3.8;z+=.13){
    assert(seabed.heightAt(x,z)>bottom+.045,'Sand overlaps the buried base everywhere, preventing coplanar contact or gaps');
  }
  const edge=seabed.heightAt(0,3.8);
  for(const x of [-.8,-.4,.4,.8])assert(Math.abs(seabed.heightAt(x,3.8)-edge)<.006,'The contact bank follows the straight face');
  assert(seabed.geometry.attributes.normal.array.every(Number.isFinite));seabed.dispose();
});

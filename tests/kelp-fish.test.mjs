import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelp}=await import('../kelp.js');
const {createKelpFish}=await import('../kelp-fish.js');
function setup(count=80){
  const scene=new THREE.Scene(),kelp=createKelp({scene});kelp.rebuild({strands:22,height:7,current:.38,direction:25});kelp.group.visible=true;
  const fish=createKelpFish({scene,kelp});fish.setSettings({count,feeding:.45});fish.setVisible(true);
  return {scene,kelp,fish,tick(dt=.1,n=1){for(let i=0;i<n;i++){kelp.advance(dt);fish.advance(dt);}},dispose(){fish.dispose();kelp.dispose();}};
}

test('school uses deterministic fixed steps in still water and keeps finite fish in the water',()=>{
  const a=setup(),b=setup();a.kelp.setCurrent(0);b.kelp.setCurrent(0);a.fish.setSettings({feeding:0});b.fish.setSettings({feeding:0});
  a.tick(.1,100);b.tick(.05,200);
  for(let i=0;i<80;i++){
    const x=a.fish.inspectFish(i),y=b.fish.inspectFish(i);assert.deepEqual(x,y);
    assert(x.position.every(Number.isFinite));assert(x.velocity.every(Number.isFinite));
    assert(Math.abs(x.position[0])<=8.5&&Math.abs(x.position[2])<=8.5);assert(x.position[1]>=-1.5&&x.position[1]<=6.25);
  }
  assert.equal(a.kelp.stats.remaining,1,'Non-feeding fish leave kelp intact');
  const headings=Array.from({length:80},(_,i)=>new THREE.Vector3(...a.fish.inspectFish(i).facing));
  const shared=headings.reduce((sum,direction)=>sum.add(direction),new THREE.Vector3()).normalize();
  const cruising=headings.filter((_,i)=>a.fish.inspectFish(i).foliageSpeed>.98);
  assert(cruising.length>10,'A substantial part of the school cruises in clear water');
  assert(cruising.every(direction=>direction.dot(shared)>.9),'Open-water fish share a heading while fish near leaves can turn through gaps');
  const positions=Array.from({length:80},(_,i)=>a.fish.inspectFish(i).position),center=positions.reduce((sum,p)=>sum.map((x,j)=>x+p[j]/80),[0,0,0]);
  assert(positions.filter(p=>Math.hypot(...p.map((x,j)=>x-center[j]))<3).length>65,'The school stays cohesive');
  a.dispose();b.dispose();
});

test('fish bite only at the moving blade, progressively eat it and leave bounded debris',()=>{
  const sim=setup(180),{fish,kelp}=sim;
  const originalBite=kelp.bite,point=new THREE.Vector3();let verified=0;
  const reachable=[];
  for(let i=0;i<kelp.stats.blades;i++)if(kelp.getBladeTarget(i,point)&&Math.abs(point.x)<7&&Math.abs(point.z)<7)reachable.push(i);
  kelp.bite=(index,amount)=>{
    kelp.getBladeTarget(index,point);
    const feeder=Array.from({length:fish.stats.count},(_,i)=>fish.inspectFish(i)).find(f=>f.target===index);
    assert(feeder,'A real feeding fish owns the target');assert(point.distanceTo(new THREE.Vector3(...feeder.position))<.56,'Feeding requires physical proximity');
    verified++;return originalBite(index,amount);
  };
  const geometry=kelp.group.children[1].geometry,positions=geometry.attributes.position.array.slice();
  sim.tick(.1,450);
  assert(verified>100);assert(kelp.stats.remaining<1);
  const patchHealth=reachable.reduce((sum,i)=>sum+kelp.getBladeHealth(i),0)/reachable.length;
  assert(patchHealth<.97,JSON.stringify({patchHealth,reachable:reachable.length,bites:fish.stats.bites}));assert(kelp.stats.eaten>0);assert(fish.stats.fragments<=160);
  assert.equal(kelp.group.children[1].geometry,geometry);assert.deepEqual(geometry.attributes.position.array,positions,'Eating does not rebuild the forest mesh');
  fish.setSettings({feeding:0});const health=kelp.stats.remaining;sim.tick(.1,60);assert.equal(kelp.stats.remaining,health);assert.equal(fish.stats.feeding,0);
  kelp.restore();assert.equal(kelp.stats.remaining,1);assert.equal(kelp.stats.eaten,0);
  sim.dispose();
});

test('pause, scene visibility, rebuilds and population changes preserve a bounded simulation',()=>{
  const sim=setup(50),{kelp,fish,scene}=sim;sim.tick(.1,30);
  const before=fish.inspectFish(0),matrix=fish.group.children[0].instanceMatrix.array.slice();
  kelp.setPlaying(false);assert.equal(fish.advance(.1),false);assert.deepEqual(fish.inspectFish(0),before);assert.deepEqual(fish.group.children[0].instanceMatrix.array,matrix);
  kelp.setPlaying(true);fish.setVisible(false);assert.equal(fish.advance(.1),false);fish.setVisible(true);
  fish.setSettings({count:500,feeding:0,speed:2});sim.tick(.1,40);assert.equal(fish.stats.count,500);assert.equal(fish.group.children.length,2);
  assert.equal(fish.group.children[0].count,500);for(let i=0;i<500;i++)assert(fish.inspectFish(i).position.every(Number.isFinite));
  fish.setSettings({count:0});assert.equal(fish.stats.count,0);assert.equal(fish.inspectFish(0),null);assert.equal(fish.group.children[0].count,0);
  for(let i=0;i<kelp.stats.blades;i++)kelp.bite(i,1);
  fish.setSettings({count:20,feeding:1});sim.tick(.1,120);assert.equal(fish.stats.feeding,0,'A depleted forest leaves fish schooling without invalid targets');
  kelp.rebuild({height:3});fish.setSettings({count:20});sim.tick();assert.equal(fish.stats.bites,0);assert.equal(kelp.stats.remaining,1);
  let disposed=0;fish.group.children[0].geometry.addEventListener('dispose',()=>disposed++);sim.dispose();assert.equal(disposed,1);assert.equal(scene.children.length,0);
});

test('blade damage and its shadow share health; targets follow current and disappear when eaten',()=>{
  const sim=setup(0),{kelp}=sim,mesh=kelp.group.children[1];
  const make=()=>({uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <clipping_planes_fragment>'});
  const visible=make(),depth=make();mesh.material.onBeforeCompile(visible);mesh.customDepthMaterial.onBeforeCompile(depth);
  assert.equal(visible.uniforms.kelpHealth,depth.uniforms.kelpHealth);assert.match(depth.fragmentShader,/discard/);
  const before=kelp.getBladeTarget(0,new THREE.Vector3()).clone();sim.tick(.1,10);
  assert(before.distanceTo(kelp.getBladeTarget(0,new THREE.Vector3()))>.001);
  kelp.bite(0,.5);assert.equal(kelp.getBladeHealth(0),.5);assert.equal(visible.uniforms.kelpHealth.value.image.data[0],.5);
  kelp.bite(0,2);assert.equal(kelp.getBladeTarget(0,new THREE.Vector3()),null);assert.equal(kelp.getBladeHealth(0),0);
  sim.dispose();
});

test('fish and interpolated bodies stay above an elevated seabed',()=>{
  const sim=setup(30),{fish}=sim,point=new THREE.Vector3();
  let elevation=3.5;const floor=()=>-1.75+elevation;
  assert(Array.from({length:fish.stats.count},(_,i)=>fish.inspectFish(i).position[1]).some(y=>y<floor()+.25),'The new bank initially intersects part of the school');
  fish.setFloorHeight(floor);fish.setSettings({feeding:0});fish.setRoaming(true);
  for(let frame=0;frame<120;frame++){
    if(frame===60){elevation=4.4;fish.setFloorHeight(floor);}
    sim.tick(.05);
    const matrices=fish.group.children[0].instanceMatrix.array;
    for(let i=0;i<fish.stats.count;i++){
      const f=fish.inspectFish(i);point.fromArray(f.position);assert(point.y>=floor()+.25-1e-6);
      assert(matrices[i*16+13]>=floor()+.25-1e-6,'Drawn interpolation clears the raised terrain too');
    }
  }
  sim.dispose();
});

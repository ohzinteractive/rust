import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelp}=await import('../kelp.js');
const {createKelpFish}=await import('../kelp-fish.js');
const {createKelpAttractor}=await import('../kelp-attractor.js');
const {createKelpAvoidance}=await import('../kelp-avoidance.js');

test('kelp collision guides follow current and damage without rebuilding render geometry',()=>{
  const kelp=createKelp({scene:new THREE.Scene()});kelp.rebuild({strands:4,generations:2,current:0});kelp.group.visible=true;
  const geometry=kelp.group.children[1].geometry,source=kelp.getObstacles(),version=source.version;
  const first=source.capsules[10].a.clone(),full=source.capsules.filter(c=>c.leaf===0).length;
  kelp.advance(.1);assert.equal(kelp.getObstacles().version,version,'Still water reuses the collision grid');
  kelp.setCurrent(1,90);assert.notDeepEqual(kelp.getObstacles().capsules[10].a,first);
  const moving=kelp.getObstacles().capsules[10].a.clone();kelp.advance(.1);assert.notDeepEqual(kelp.getObstacles().capsules[10].a,moving);
  kelp.bite(0,.6);assert(kelp.getObstacles().capsules.filter(c=>c.leaf===0).length<full);
  kelp.bite(0,1);assert.equal(kelp.getObstacles().capsules.filter(c=>c.leaf===0).length,1,'The float remains after the blade is eaten');
  kelp.restore();assert.equal(kelp.getObstacles().capsules.filter(c=>c.leaf===0).length,full);
  assert.equal(kelp.group.children[1].geometry,geometry);kelp.dispose();
});

test('spatial avoidance clears ribbon envelopes and keeps projections above the seabed',()=>{
  const source={version:1,capsules:[{a:new THREE.Vector3(0,.3,0),b:new THREE.Vector3(2,.3,0),radius:.2,leaf:0}]};
  const field=createKelpAvoidance({getObstacles:()=>source});assert(field.update());assert(!field.update());
  const p=new THREE.Vector3(1,.25,0),normal=new THREE.Vector3();
  assert(!field.isClear(p,.4));assert(field.isClear(p,.4,0),'A grazing fish may approach its owned blade');
  field.project(p,.4,normal,-1,.25);assert(p.y>=.25);assert(field.isClear(p,.4));
  source.capsules[0].a.z=5;source.capsules[0].b.z=5;source.version++;field.update();
  assert(field.isClear(new THREE.Vector3(1,.3,0),.4));assert(!field.isClear(new THREE.Vector3(1,.3,5),.4));
});

test('free fish spread through the forest, avoid moving kelp and shapes, and can regroup',()=>{
  const scene=new THREE.Scene(),kelp=createKelp({scene});kelp.rebuild({strands:4,generations:2,height:7,current:.5});kelp.group.visible=true;
  const shape=createKelpAttractor({scene,height:7});shape.setVisible(true);shape.setShape('cube');
  const fish=createKelpFish({scene,kelp});fish.setSettings({count:40});fish.setVisible(true);fish.setAttractor(shape);
  const field=createKelpAvoidance(kelp),point=new THREE.Vector3(),drawn=new THREE.Vector3();
  const tick=(n,check=false)=>{for(let i=0;i<n;i++){
    kelp.advance(.05);fish.advance(.05);
    if(check&&i%10===0){field.update();const matrices=fish.group.children[0].instanceMatrix.array;
      for(let j=0;j<fish.stats.count;j++){
        const f=fish.inspectFish(j);point.fromArray(f.position);drawn.set(matrices[j*16+12],matrices[j*16+13],matrices[j*16+14]);
        assert(field.isClear(point,.46*f.size),'Body avoids the moving kelp');assert(field.isClear(drawn,.46*f.size),'Interpolated body avoids the kelp');
        assert(shape.distanceTo(point)>.46*f.size);assert(shape.distanceTo(drawn)>.46*f.size);
        assert(f.position.every(Number.isFinite));assert(point.y>=-1.5);
      }
    }
  }};
  tick(100);fish.setRoaming(true);assert(fish.roaming);tick(600,true);
  let far=0,minX=Infinity,maxX=-Infinity;
  for(let i=0;i<fish.stats.count;i++){point.fromArray(fish.inspectFish(i).position);if(point.distanceTo(shape.center)>5)far++;minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);}
  assert(far>5,'Free fish explore beyond the shape orbit');assert(maxX-minX>8,'Fish choose independent destinations');assert.equal(fish.stats.feeding,0);assert(shape.active,'The placed shape stays in the scene');
  fish.setRoaming(false);assert(!fish.roaming);tick(100,true);
  fish.dispose();shape.dispose();kelp.dispose();assert.equal(scene.children.length,0);
});

test('fish ease through a leaf corridor and recover cruising speed in clear water',()=>{
  const scene=new THREE.Scene();
  const source={version:1,capsules:[{a:new THREE.Vector3(2.7,-1,2.8),b:new THREE.Vector3(2.7,6,2.8),radius:.22,leaf:0}]};
  const kelp={revision:1,playing:true,settings:{height:7,seed:812,current:0,direction:0},stats:{blades:0},getObstacles:()=>source};
  const fish=createKelpFish({scene,kelp});fish.setSettings({count:30,feeding:0});fish.setVisible(true);
  const point=new THREE.Vector3(),field=createKelpAvoidance(kelp);field.update();
  let closeSamples=0,slowSamples=0;
  for(let step=0;step<240;step++){
    fish.advance(.05);
    for(let i=0;i<30;i++){
      const f=fish.inspectFish(i);point.fromArray(f.position);
      assert(field.isClear(point,.46*f.size),'Fish take a path around the leaf');
      if(step>40&&field.nearest(point,2)<.48*f.size+.7){
        closeSamples++;
        if(Math.hypot(...f.velocity)<(.9+f.size*.3)*.8)slowSamples++;
      }
    }
  }
  assert(closeSamples>30,'Fish reach the foliage');
  assert(slowSamples/closeSamples>.8,'Most fish near foliage swim slowly instead of driving into it');
  source.capsules=[];source.version++;
  for(let i=0;i<100;i++)fish.advance(.05);
  assert(Array.from({length:30},(_,i)=>fish.inspectFish(i)).every(f=>f.foliageSpeed>.99),'Fish resume cruising when the path clears');
  fish.setSettings({speed:.05});assert.equal(fish.settings.speed,.05,'Very slow swimming is available');fish.dispose();
});

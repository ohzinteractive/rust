import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const T=await import('../vendor/three.module.js');
const {createKelpAttractor}=await import('../kelp-attractor.js');
const {createKelpFish}=await import('../kelp-fish.js');
const {createKelpAvoidance}=await import('../kelp-avoidance.js');

test('an orbit blocked by kelp keeps flowing through elevated gaps without piling up',()=>{
  const scene=new T.Scene(),capsules=[];
  // These two hedges cut the orbit. Going over their tops is possible; chasing
  // a low target through them leaves fish oscillating against their sides.
  for(const x of [-2.7,2.7])for(let z=-2;z<=7;z+=.6)capsules.push({a:new T.Vector3(x,-1.75,z),b:new T.Vector3(x,1,z),radius:.2,leaf:-1});
  const kelp={revision:1,settings:{seed:197,current:0,direction:0,height:7},stats:{blades:0},group:{visible:true},playing:true,getObstacles:()=>({version:1,capsules})};
  const shape=createKelpAttractor({scene,height:7,reducedMotion:true});shape.setVisible(true);shape.setShape('cube');
  const fish=createKelpFish({scene,kelp});fish.setSettings({count:120,feeding:0});fish.setVisible(true);fish.setAttractor(shape);
  const field=createKelpAvoidance(kelp);field.update();
  let previous=[],windows=0,stalled=0,orbit=0;const point=new T.Vector3();
  for(let frame=0;frame<450;frame++){
    fish.advance(.1);
    if(frame<200||frame%25)continue;
    const current=[];
    for(let i=0;i<120;i++){
      const f=fish.inspectFish(i);current.push(f.position);point.fromArray(f.position);
      assert(f.position.every(Number.isFinite)&&f.velocity.every(Number.isFinite));
      assert(shape.distanceTo(point)>.46*f.size,'The fish still clear the sculpture');
      assert(field.isClear(point,.42*f.size),'Detours retain clearance from kelp');
      if(!previous.length)continue;
      const before=previous[i],travel=point.distanceTo(new T.Vector3(...before));
      windows++;if(travel<.2)stalled++;
      const angle=Math.atan2(point.z-shape.center.z,point.x-shape.center.x)-Math.atan2(before[2]-shape.center.z,before[0]-shape.center.x);
      orbit+=Math.atan2(Math.sin(angle),Math.cos(angle));
    }
    previous=current;
  }
  assert(stalled/windows<.05,'Fish must resume swimming instead of remaining stuck: '+stalled/windows);
  assert(orbit/windows>.12,'The school continues around the figure instead of hovering at the barriers');
  let closePairs=0;
  for(let i=0;i<120;i++)for(let j=i+1;j<120;j++)if(point.fromArray(fish.inspectFish(i).position).distanceTo(new T.Vector3(...fish.inspectFish(j).position))<.3)closePairs++;
  assert(closePairs<35,'The school stays spread out instead of packing into the same gaps');
  fish.dispose();shape.dispose();assert.equal(scene.children.length,0);
});

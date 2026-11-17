import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelpBubbles}=await import('../kelp-bubbles.js');

test('vents and fish emit varied rising bubbles from their own locations in a bounded pool',()=>{
  const parent=new THREE.Group(),fish={group:{visible:true},stats:{count:1},inspectFish:()=>({position:[1,1,1],facing:[1,0,0],size:1})};
  const system=createKelpBubbles({parent,floorHeight:(x,z)=>-.1*x,surfaceHeight:()=>5,fish,capacity:80});
  for(let i=0;i<60;i++)system.advance(.1);
  assert.equal(system.group.children.length,1,'Invisible emitters leave no holes or rings on the seabed');
  assert.equal(system.bubbles.geometry.type,'SphereGeometry');
  system.bubbles.geometry.computeBoundingBox();assert(system.bubbles.geometry.boundingBox.max.z-system.bubbles.geometry.boundingBox.min.z>1.9,'Bubbles have real depth');
  assert.equal(system.vents.length,8);assert(system.stats.vent>0&&system.stats.fish>0);
  const records=Array.from({length:system.stats.count},(_,i)=>system.inspect(i));
  assert(Math.max(...records.map(p=>p.radius))-Math.min(...records.map(p=>p.radius))>.03);
  assert(records.every(p=>Number.isFinite(p.y)&&p.y<5));
  const p=system.inspect(0);system.advance(.1);assert(system.inspect(0).y>p.y);
  for(let i=0;i<1000;i++)system.advance(.1);
  assert(system.stats.count<=80);assert(system.bubbles.count<=80);
  assert(system.bubbles.instanceMatrix.array.every(Number.isFinite));
  assert(Array.from({length:system.stats.count},(_,i)=>system.inspect(i)).every(p=>p.y<5&&p.age<=55));
  system.dispose();assert.equal(parent.children.length,0);
});

test('landing releases mixed sizes and clearing the object preserves vent bubbles',()=>{
  const parent=new THREE.Group(),system=createKelpBubbles({parent,floorHeight:()=>0,surfaceHeight:()=>8});
  for(let i=0;i<10;i++)system.advance(.1);
  const vents=system.stats.vent;
  system.burst({x:0,y:0,z:0,rx:1,rz:1,footprint:'box'});
  assert.equal(system.stats.impact,42);
  const impact=Array.from({length:system.stats.count},(_,i)=>system.inspect(i)).filter(p=>p.source==='impact');
  assert(impact.every(p=>Math.abs(Math.max(Math.abs(p.x),Math.abs(p.z))-1)<1e-6));
  system.clearImpact();assert.equal(system.stats.impact,0);assert.equal(system.stats.vent,vents);
  system.burst({quiet:true});assert.equal(system.stats.impact,0);
  system.group.visible=false;const before=system.inspect(0);assert.equal(system.advance(.1),false);assert.deepEqual(system.inspect(0),before);
  system.dispose();
});

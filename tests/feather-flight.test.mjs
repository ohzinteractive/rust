import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeatherFlight} from '../feather-flight.js';

const wind={x:1,y:0,z:0};
function launch(sim,id,x=0){
  return sim.launch({id,position:{x,y:0,z:0},quaternion:{x:0,y:0,z:0,w:1},
    center:{x:0,y:.3,z:0},half:{x:.18,y:.3,z:.035},normal:{x:0,y:0,z:1}});
}

test('feather flight launches once, moves without breeze, stays finite and clears to idle',()=>{
  const sim=createFeatherFlight();assert.equal(sim.step(.02,wind,0),false);
  assert(launch(sim,0));assert.equal(launch(sim,0),false);
  const body=sim.get(0).body,start=body.position.clone();
  assert.equal(sim.step(0,wind,0),false);
  for(let i=0;i<360;i++)sim.step(1/60,wind,0);
  assert(body.position.distanceTo(start)>.3);
  for(const value of [...body.position.toArray(),...body.velocity.toArray(),...body.quaternion.toArray()])assert(Number.isFinite(value));
  assert(body.position.y>-1.75);
  sim.clear();assert.equal(sim.count,0);assert.equal(sim.step(.02,wind,1),false);
});

test('predictive separation and rigid contacts keep approaching feathers apart',()=>{
  const sim=createFeatherFlight();launch(sim,0,-.25);launch(sim,1,.25);
  const a=sim.get(0).body,b=sim.get(1).body;
  for(let i=0;i<480;i++)sim.step(1/120,wind,0);
  a.position.set(-.4,2,3);b.position.set(.4,2,3);a.aabbNeedsUpdate=b.aabbNeedsUpdate=true;
  a.velocity.x=1;b.velocity.x=-1;
  for(let i=0;i<240;i++)sim.step(1/120,wind,0);
  assert(a.position.distanceTo(b.position)>.5,'Approaching feathers must separate');
  assert(a.position.distanceTo(b.position)>.5,'The feathers must retain separate flight paths');
  sim.clear();
});

test('coincident launches separate deterministically and flight does not impose a count cap',()=>{
  const sim=createFeatherFlight();launch(sim,0);launch(sim,1);
  for(let i=0;i<240;i++)sim.step(1/120,wind,.4);
  assert(sim.get(0).body.position.distanceTo(sim.get(1).body.position)>.4);
  for(let i=2;i<1200;i++)launch(sim,i,i*2);
  assert.equal(sim.count,1200);sim.clear();assert.equal(sim.count,0);
});

test('takeoff starts at rest and spreads through a scene-sized volume',()=>{
  const sim=createFeatherFlight();
  for(let i=0;i<32;i++)launch(sim,i,(i%8-3.5)*.2);
  const first=sim.get(0).body,start=first.position.clone();
  assert.equal(first.velocity.length(),0);assert.equal(first.angularVelocity.length(),0);
  sim.step(1/60,wind,0);assert(first.position.distanceTo(start)<.003,'Takeoff must ease in without a position jump');
  for(let i=0;i<1200;i++)sim.step(1/60,wind,0);
  const positions=[...sim.entries].map(f=>f.body.position);
  const span=axis=>Math.max(...positions.map(p=>p[axis]))-Math.min(...positions.map(p=>p[axis]));
  assert(span('x')>5&&span('y')>3&&span('z')>5,'The flock must fill 3D space rather than a small shell around its roots');
  sim.clear();
});

test('return preserves the current pose, eases home, can be interrupted and settles to idle',()=>{
  const sim=createFeatherFlight();launch(sim,0);
  const body=sim.get(0).body;
  for(let i=0;i<600;i++)sim.step(1/60,wind,.3);
  const before=body.position.clone(),velocity=body.velocity.clone();
  sim.returnAll();assert.equal(sim.returningCount,1);assert(body.position.almostEquals(before));assert(body.velocity.almostEquals(velocity));
  for(let i=0;i<6;i++)sim.step(1/60,wind,.3);
  assert(body.position.distanceTo(before)<.3,'Return must not teleport to the root');
  const interrupted=body.position.clone();assert.equal(sim.resumeAll(),1);assert.equal(sim.returningCount,0);assert(body.position.almostEquals(interrupted));
  for(let i=0;i<120;i++)sim.step(1/60,wind,.3);
  sim.returnAll();
  for(let i=0;i<1800&&sim.count;i++)sim.step(1/60,wind,.3);
  assert.equal(sim.count,0,'Returned feathers must settle and stop simulation');
  assert.equal(sim.step(1/60,wind,.3),false);
});

test('returning immediately after takeoff keeps a still feather at its root',()=>{
  const sim=createFeatherFlight();launch(sim,0);
  const body=sim.get(0).body,start=body.position.clone();sim.returnAll();
  for(let i=0;i<600&&sim.count;i++)sim.step(1/60,wind,0);
  assert(body.position.distanceTo(start)<.004);assert.equal(sim.count,0);
});

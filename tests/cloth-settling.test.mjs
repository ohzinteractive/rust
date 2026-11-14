import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClothSimulation} from '../cloth-simulation.js';

const advance=(simulation,frames=600)=>{for(let i=0;i<frames;i++)simulation.advance(1/60);};
const sheet=(options={})=>createClothSimulation({columns:4,rows:4,width:2,depth:2,height:-1.738,floorY:-1.75,...options});

test('a quiet sheet freezes its pose and stops doing simulation work',()=>{
  let settled=0;
  const simulation=sheet({onSettle(){settled++;}});simulation.breeze=0;advance(simulation);
  assert(simulation.sleeping);assert(!simulation.paused,'Automatic settling is separate from manual pause');
  assert.equal(settled,1,'The UI is notified once when the sheet settles');
  const pose=simulation.positions.slice(),time=simulation.time;
  for(const dt of [1/60,1,100])assert.equal(simulation.advance(dt),false);
  assert.equal(simulation.time,time);assert.deepEqual(simulation.positions,pose);
  assert.equal(settled,1,'Idle frames do not send repeated settling notifications');
  simulation.wake();assert(!simulation.sleeping);assert(simulation.advance(1/60));
});

test('small consecutive steps do not hide cumulative cloth drift',()=>{
  const simulation=sheet({autoSettle:false});simulation.breeze=0;simulation.setFabric({damping:0});advance(simulation,180);
  simulation.autoSettle=true;
  for(let frame=0;frame<900;frame++){
    for(let i=0;i<simulation.positions.length;i+=3)simulation.positions[i]+=.0015;
    simulation.advance(1/60);
  }
  assert(simulation.movement.mean<.001,'Individual steps qualify as small');
  assert(!simulation.sleeping,'Drift across the observation window keeps the cloth awake');
});

test('queued wrapping prevents sleep and rope edits wake a settled sheet',()=>{
  const simulation=sheet(),ropes={revision:0,pending:true,advance(){}};simulation.breeze=0;simulation.setTies(ropes);
  advance(simulation);assert(!simulation.sleeping,'Waiting and wrapping ropes must finish');
  ropes.pending=false;advance(simulation);assert(simulation.sleeping);
  ropes.revision++;ropes.pending=true;
  assert(simulation.advance(1/60));assert(!simulation.sleeping,'A rope change resumes the solver');
});

test('higher tolerance accepts smaller ongoing drift sooner',()=>{
  for(const [tolerance,shouldSleep] of [[.003,false],[.01,true]]){
    const simulation=sheet({autoSettle:false});simulation.breeze=0;simulation.setFabric({damping:0});advance(simulation,180);
    simulation.settleTolerance=tolerance;simulation.autoSettle=true;
    for(let frame=0;frame<600&&!simulation.sleeping;frame++){
      for(let i=0;i<simulation.positions.length;i+=3)simulation.positions[i]+=.0006;
      simulation.advance(1/60);
    }
    assert.equal(simulation.sleeping,shouldSleep);
  }
});

test('physical edits and Resume wake settling while manual pause remains under user control',()=>{
  const simulation=sheet();simulation.breeze=0;
  for(const edit of [()=>{simulation.breeze=.2;},()=>simulation.setFabric({bend:.18}),()=>{simulation.held=false;},()=>{simulation.autoSettle=false;}]){
    advance(simulation);assert(simulation.sleeping);edit();assert(!simulation.sleeping);assert(simulation.advance(1/60));
  }
  advance(simulation);assert(!simulation.sleeping,'Auto-stop can be disabled');
  simulation.paused=true;simulation.breeze=.4;simulation.setFabric({bend:.03});
  assert(simulation.paused);assert.equal(simulation.advance(1),false);
  simulation.paused=false;assert(simulation.advance(1/60));
});

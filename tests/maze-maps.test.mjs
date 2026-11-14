import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const {setMazeMap,getMazeMap,createMazePlan,getMazeLayout}=await import('../maze-geometry.js');
const {createMazeWalker}=await import('../maze-navigation.js');

test('map switching restores deterministic layouts, refreshes colliders and keeps both destinations reachable',()=>{
  const snapshots=new Map(),layouts=[];
  for(const id of ['garden','observatory','garden','observatory']){
    setMazeMap(id);assert.equal(getMazeMap(),id);
    const plan=createMazePlan(),snapshot=JSON.stringify(plan.walls);
    if(snapshots.has(id))assert.equal(snapshot,snapshots.get(id));else snapshots.set(id,snapshot);
    const layout=getMazeLayout();assert(!layouts.includes(layout),'Switching invalidates the old collider cache');layouts.push(layout);
    const walker=createMazeWalker(),queue=[[plan.entry.x,plan.entry.z]],seen=new Set([queue[0].join(',')]);
    for(let i=0;i<queue.length;i++){
      const [x,z]=queue[i];
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const key=(x+dx)+','+(z+dz);
        if(plan.walls[z+dz]?.[x+dx]===0&&!seen.has(key)){seen.add(key);queue.push([x+dx,z+dz]);}
      }
    }
    assert(seen.has(plan.goal.x+','+plan.goal.z));assert(walker.canStand(walker.position.x,walker.position.z));
  }
  assert.notEqual(snapshots.get('garden'),snapshots.get('observatory'));
  assert.throws(()=>setMazeMap('missing'),RangeError);
  setMazeMap('garden');
});

test('the courtyard shortcut reaches a safe ritual viewpoint in either map and restart restores the entrance',()=>{
  for(const id of ['garden','observatory']){
    setMazeMap(id);const walker=createMazeWalker(),entrance=walker.position.clone();
    assert(walker.visitCourtyard());assert(walker.inCourtyard);assert(walker.canStand(walker.position.x,walker.position.z));
    assert(walker.position.distanceTo(entrance)>.5);
    walker.reset();assert(walker.position.equals(entrance));assert(!walker.inCourtyard);
  }
  setMazeMap('garden');
});

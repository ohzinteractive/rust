import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createFeatherFlight}=await import('../feather-flight.js');
const {createMazeFlight}=await import('../maze-flight.js');
const {createMazePlan,mazePoint,mazeDimensions}=await import('../maze-geometry.js');
const wind={x:1,y:0,z:1},walls=createMazePlan().walls;

function setup(tilted=false){
  const frame=new THREE.Group();frame.position.set(.2,.12,-.1);
  if(tilted)frame.rotation.set(.23,.67,-.16);
  frame.updateMatrixWorld();
  const sim=createFeatherFlight(),environment=createMazeFlight(frame);
  sim.setEnvironment(environment);
  return {sim,environment,frame,inverse:frame.matrixWorld.clone().invert()};
}
function launch({sim,frame},id,point=mazePoint(15.5,29.5),normal=new THREE.Vector3(0,0,1)){
  return sim.launch({id,position:point.clone().applyMatrix4(frame.matrixWorld),quaternion:frame.quaternion,
    center:{x:0,y:0,z:0},half:{x:.006,y:.008,z:.003},normal:normal.clone().transformDirection(frame.matrixWorld)});
}
function inside(p,tolerance=.001){
  const {unit,size,hinge,height}=mazeDimensions;
  assert(Math.abs(p.y)<=height/2+tolerance,'Floor and ceiling contain flight');
  const z=p.z/unit+size/2,taper=1-.28*Math.max(0,(z-hinge)/(size-hinge)),x=p.x/(unit*taper)+size/2;
  assert(x>=0&&x<size&&z>=0&&z<size,'The outer border includes the open entrance');
  assert.equal(walls[Math.floor(z)][Math.floor(x)],0,'Feathers stay in a passage');
}

test('maze walls stop sustained flight forces, even during takeoff and return',()=>{
  for(const tilted of [false,true]){
    const setupResult=setup(tilted),{sim,environment,frame,inverse}=setupResult;
    assert(launch(setupResult,0));
    const body=sim.get(0).body;
    let wallContacts=0;body.addEventListener('collide',event=>{if(event.body.mass===0)wallContacts++;});
    const outside=mazePoint(10,29.5).applyMatrix4(frame.matrixWorld);
    environment.target=(f,t,out)=>out.copy(outside);
    for(let i=0;i<1200;i++){sim.step(1/120,wind,1);inside(new THREE.Vector3().copy(body.position).applyMatrix4(inverse));}
    assert(wallContacts>0,'The feather must make real wall contacts');
    sim.returnAll();
    for(let i=0;i<3600&&sim.count;i++)sim.step(1/120,wind,0);
    assert.equal(sim.count,0,'A feather returns from its corridor wall');
    sim.setEnvironment(null);
  }
});

test('floor, ceiling and the open entrance contain feathers under outward forces',()=>{
  for(const target of [mazePoint(15.5,29.5,-2),mazePoint(15.5,29.5,2),mazePoint(15.5,35)]){
    const result=setup(true),{sim,environment,frame,inverse}=result;launch(result,0);
    target.applyMatrix4(frame.matrixWorld);environment.target=(f,t,out)=>out.copy(target);
    const body=sim.get(0).body;let contacts=0;
    body.addEventListener('collide',()=>contacts++);
    for(let i=0;i<1200;i++){sim.step(1/120,wind,1);inside(new THREE.Vector3().copy(body.position).applyMatrix4(inverse));}
    assert(contacts>0);sim.setEnvironment(null);
  }
});

test('miniature feathers collide with one another and still return to their roots',()=>{
  const result=setup(),{sim,inverse}=result;
  for(let i=0;i<8;i++)launch(result,i,mazePoint(15.5,29.2+i*.08,(i%2)*.025));
  const bodies=[...sim.entries].map(f=>f.body);let contacts=0;
  for(const body of bodies)body.addEventListener('collide',event=>{if(event.body.mass>0)contacts++;});
  for(let i=0;i<1800;i++){
    sim.step(1/120,wind,.5);
    for(const body of bodies)inside(new THREE.Vector3().copy(body.position).applyMatrix4(inverse));
  }
  assert(contacts>0,'Airborne miniature boxes make feather-to-feather contacts');
  sim.returnAll();for(let i=0;i<4800&&sim.count;i++)sim.step(1/120,wind,0);
  assert.equal(sim.count,0);sim.setEnvironment(null);
});

test('outside roots cannot launch through the enclosure and changing mode removes maze colliders',()=>{
  const result=setup(),{sim}=result;
  assert.equal(launch(result,0,mazePoint(0,2),new THREE.Vector3(-1,0,0)),false);
  assert.equal(launch(result,1,mazePoint(15.5,29.5,.19),new THREE.Vector3(0,1,0)),false);
  launch(result,2);const world=sim.get(2).body.world;
  assert(world.bodies.length>60);
  sim.setEnvironment(null);assert.equal(world.bodies.length,1);assert.equal(sim.count,0);
  assert(launch(result,3,mazePoint(0,2),new THREE.Vector3(-1,0,0)));
  sim.clear();
});

test('the rendered maze coat launches and returns wall, floor and ceiling feathers',async()=>{
  const {createFeatherSurface}=await import('../feather-surface.js');
  const {createMazeGeometry}=await import('../maze-geometry.js');
  const {createMazeRoom}=await import('../maze-room.js');
  const scene=new THREE.Scene(),frame=new THREE.Group();scene.add(frame);
  frame.position.y=.12;frame.rotation.set(.15,.2,-.1);
  const wall=new THREE.Mesh(createMazeGeometry(),new THREE.MeshBasicMaterial());frame.add(wall);
  const room=createMazeRoom({specimen:frame,scene,canStand:()=>true});room.setActive(true);
  const feathers=createFeatherSurface();
  feathers.rebuild([wall,room.floor,room.roof],frame,2,7319,{scale:.025,maze:true});
  const count=feathers.launchAll();assert(count>20,'The real coat must launch into the maze');
  for(let i=0;i<600;i++)feathers.advance(1/60);
  assert.equal(feathers.flyingCount,count);
  feathers.returnAll();
  for(let i=0;i<3600&&feathers.flyingCount;i++)feathers.advance(1/60);
  assert.equal(feathers.flyingCount,0,'Real feather proxies must be able to reattach to the skin');
  feathers.dispose();room.dispose();wall.geometry.dispose();wall.material.dispose();
});

test('walking the camera into a feather transfers momentum in a tilted maze',()=>{
  const result=setup(true),{sim,environment,frame,inverse}=result;
  const root=mazePoint(15.5,16.5,.02);launch(result,0,root);
  environment.target=(f,t,out)=>out.copy(f.start);
  for(let i=0;i<720;i++)sim.step(1/120,wind,0);
  const body=sim.get(0).body,start=body.position.clone();let contacts=0;
  body.addEventListener('collide',event=>{if(event.body.collisionFilterGroup===4)contacts++;});
  const up=new THREE.Vector3(0,1,0).transformDirection(frame.matrixWorld);
  for(let i=0;i<90;i++){
    const eye=root.clone();eye.z+=.08-i*.002;
    sim.setCamera(eye.applyMatrix4(frame.matrixWorld),up);
    sim.step(1/120,wind,0);
    inside(new THREE.Vector3().copy(body.position).applyMatrix4(inverse));
  }
  assert(contacts>0,'The camera capsule must make real contacts with airborne feathers');
  assert(body.position.distanceTo(start)>.035,'The moving camera visibly pushes the feather');
  sim.returnAll();
  for(let i=0;i<3600&&sim.count;i++)sim.step(1/120,wind,0);
  assert.equal(sim.count,0,'An explicit return can finish even beside the camera');
  sim.setEnvironment(null);
});

test('camera pressure cannot force a feather through the maze wall',()=>{
  const result=setup(true),{sim,environment,frame,inverse}=result;
  const root=mazePoint(15.5,29.5,.02);launch(result,0,root);
  environment.target=(f,t,out)=>out.copy(f.start);
  const body=sim.get(0).body,up=new THREE.Vector3(0,1,0).transformDirection(frame.matrixWorld);
  let contacts=0;body.addEventListener('collide',event=>{if(event.body.collisionFilterGroup===1)contacts++;});
  for(let i=0;i<1200;i++){
    const eye=root.clone();eye.x+=.035-Math.min(.035,i*.0003);
    sim.setCamera(eye.applyMatrix4(frame.matrixWorld),up);sim.step(1/120,wind,0);
    inside(new THREE.Vector3().copy(body.position).applyMatrix4(inverse));
  }
  assert(contacts>0,'The wall must oppose sustained camera pressure');
  const world=body.world,before=world.bodies.length;sim.setCamera(null);
  assert.equal(world.bodies.length,before-1,'Leaving first person removes the camera collider');
  sim.setEnvironment(null);
});

test('camera teleports do not sweep feathers out of distant passages',()=>{
  const result=setup(),{sim,environment,frame}=result;
  launch(result,0,mazePoint(15.5,16.5,.02));environment.target=(f,t,out)=>out.copy(f.start);
  for(let i=0;i<720;i++)sim.step(1/120,wind,0);
  const body=sim.get(0).body,start=body.position.clone();
  for(const x of [-.3,.3,-.3]){
    sim.setCamera(new THREE.Vector3(x,.02,0).applyMatrix4(frame.matrixWorld));
    sim.step(1/60,wind,0);
  }
  assert(body.position.distanceTo(start)<.001,'Restarting must not create a path of camera impulses');
  const world=body.world;sim.setEnvironment(null);assert.equal(world.bodies.length,1);
});

import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';

registerHooks({resolve(specifier,context,next){
  return next(specifier==='three'?new URL('../vendor/three.module.js',import.meta.url).href:specifier,context);
}});
const THREE=await import('../vendor/three.module.js');
const CANNON=await import('../vendor/cannon-es.js');
const {createMazePlan,getMazeLayout,createMazeFloorGeometry,setMazeMap}=await import('../maze-geometry.js');
setMazeMap('observatory');
const {createShapeGeometry}=await import('../specimen-shapes.js');
const {createFlakePhysics}=await import('../flake-physics.js');
const {PeelingSurface}=await import('../peeling-surface.js');
const {createMazeWalker}=await import('../maze-navigation.js');
const {mazePoint}=await import('../maze-geometry.js');

test('maze entrance reaches the courtyard and every passage',()=>{
  const {walls,size}=createMazePlan(),queue=[[15,size-1]],seen=new Set(['15,30']);
  for(let i=0;i<queue.length;i++){
    const [x,z]=queue[i];
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const a=x+dx,b=z+dz,key=`${a},${b}`;
      if(a<0||b<0||a>=size||b>=size||walls[b][a]||seen.has(key))continue;
      seen.add(key);queue.push([a,b]);
    }
  }
  assert(seen.has('15,15'),'The central courtyard must be accessible');
  assert.equal(seen.size,walls.reduce((sum,row)=>sum+row.filter(value=>!value).length,0));
  assert.equal(walls[0].filter(value=>!value).length,0);
  assert.equal(walls.at(-1).filter(value=>!value).length,1,'Only one outer entrance');
  assert.deepEqual(createMazePlan().walls,walls,'Switching away and back retains the plan');
});

test('reference floor plan has an irregular solid outline with outward faces and open rooms',()=>{
  const geometry=createShapeGeometry('maze'),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  geometry.computeBoundingBox();
  assert(geometry.boundingBox.getSize(new THREE.Vector3()).x>2.5&&geometry.boundingBox.max.x<=1.65);
  assert(Math.abs(geometry.boundingBox.getSize(new THREE.Vector3()).y-.38)<1e-6);
  const ray=new THREE.Raycaster(new THREE.Vector3(0,2,0),new THREE.Vector3(0,-1,0));
  assert.equal(ray.intersectObject(mesh).length,0,'The courtyard has no hidden cap or base');
  ray.ray.origin.set(0,2,-1.6);
  assert(ray.intersectObject(mesh).length>0,'The outer hedge is a real mesh');
  ray.ray.origin.set(0,2,1.6);
  assert.equal(ray.intersectObject(mesh).length,0,'The entrance stays open');
  const p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i+=3){
    const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
    assert(b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3().fromBufferAttribute(n,i))>1e-8,'Every triangle has outward, nondegenerate winding');
  }
  assert(getMazeLayout().patches.some(patch=>patch.corners.some(p=>p.z>1.6)&&patch.corners.every(p=>Math.abs(p.x)<1.21)),'The lower outline narrows');
  for(const attribute of Object.values(geometry.attributes))assert(attribute.array.every(Number.isFinite));
  geometry.dispose();mesh.material.dispose();
});

test('maze colliders and peeling follow walls without filling the courtyard',()=>{
  const parent=new THREE.Group(),physics=createFlakePhysics(),state={shape:'maze',seed:7319,age:0,peel:.68,exploded:0};
  physics.setSpecimenShape('maze');
  assert.equal(physics.world.bodies[1].shapes.length,getMazeLayout().hulls.length);
  function hitsWall(z){
    const ray=new CANNON.Ray(new CANNON.Vec3(0,2,z),new CANNON.Vec3(0,-.5,z)),hit=new CANNON.RaycastResult();
    ray.intersectBody(physics.world.bodies[1],hit);return hit.hasHit;
  }
  assert.equal(hitsWall(0),false,'Physics must leave the courtyard open');
  assert(hitsWall(-1.6),'Raised walls must have physical colliders');
  const material=new THREE.MeshBasicMaterial(),surface=new PeelingSurface({parent,material,physics,state});
  assert(surface.flakes.length>0);
  const ray=new THREE.Raycaster(new THREE.Vector3(0,2,0),new THREE.Vector3(0,-1,0));
  assert.equal(ray.intersectObject(surface.mesh).length,0,'The coating must preserve the courtyard');
  for(const attribute of Object.values(surface.mesh.geometry.attributes))assert(attribute.array.every(Number.isFinite));
  for(const flake of surface.flakes){
    assert(flake.root.y<.2&&flake.root.y>-.2);
    assert(flake.radius>0&&flake.radius<3.4);
  }
  state.age=.8;surface.updateAttached();
  for(const attribute of Object.values(surface.mesh.geometry.attributes))assert(attribute.array.every(Number.isFinite));
  physics.clear();surface.mesh.geometry.dispose();material.dispose();
});

test('first-person walker cannot tunnel through walls, slide outside the maze or clip at corners',()=>{
  const walker=createMazeWalker();
  assert(walker.canStand(walker.position.x,walker.position.z));
  const start=walker.position.clone();
  walker.move(4,0);
  assert(walker.position.x<.7,'A long movement must stop at the entrance corridor wall');
  assert(walker.canStand(walker.position.x,walker.position.z));
  walker.move(0,5);
  assert(walker.position.z<1.63,'Walking backwards cannot leave the floor');
  walker.reset();assert(walker.position.equals(start));
  for(let i=0;i<300;i++){
    walker.move(Math.sin(i)*.12,Math.cos(i*.7)*.12);
    assert(walker.canStand(walker.position.x,walker.position.z),'Diagonal collisions must retain clearance at corners');
    assert.equal(walker.position.y,start.y,'Walking keeps a constant eye height');
  }
});

test('first-person walker can follow the entrance route all the way to the courtyard',()=>{
  const {walls,size,goal}=createMazePlan(),queue=[[15,30]],previous=new Map([['15,30',null]]);
  for(let i=0;i<queue.length&&!previous.has(goal.x+','+goal.z);i++){
    const [x,z]=queue[i];
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const a=x+dx,b=z+dz,key=`${a},${b}`;
      if(a<0||b<0||a>=size||b>=size||walls[b][a]||previous.has(key))continue;
      previous.set(key,[x,z]);queue.push([a,b]);
    }
  }
  const route=[];
  for(let cell=[goal.x,goal.z];cell;cell=previous.get(cell.join(',')))route.push(cell);
  const walker=createMazeWalker();
  for(const [x,z] of route.reverse()){
    const target=mazePoint(x+.5,z+.5);
    walker.move(target.x-walker.position.x,target.z-walker.position.z);
    assert(Math.hypot(walker.position.x-target.x,walker.position.z-target.z)<1e-7,'Every route segment must be wide enough to walk');
  }
  assert(walker.inCourtyard);
  walker.reset();assert(!walker.inCourtyard);
});

test('vertical movement stays inside the room, retains wall collisions and resets height',()=>{
  const walker=createMazeWalker(),start=walker.position.clone();
  assert(walker.move(0,0,.05));assert(walker.position.y>start.y);
  walker.move(0,0,100);assert(Math.abs(walker.position.y-.168)<1e-9);
  walker.move(4,0);assert(walker.canStand(walker.position.x,walker.position.z));
  walker.move(0,0,-100);assert(Math.abs(walker.position.y+.168)<1e-9);
  assert.equal(walker.move(0,0,-1),false,'The floor stops downward motion');
  walker.reset();assert(walker.position.equals(start));
});

test('irregular annexes have connected floors while exterior voids remain unwalkable',()=>{
  const {walls,size,goal}=createMazePlan(),geometry=createMazeFloorGeometry(),material=new THREE.MeshBasicMaterial(),floor=new THREE.Mesh(geometry,material);
  floor.rotation.x=-Math.PI/2;floor.updateMatrixWorld();
  const walker=createMazeWalker(),ray=new THREE.Raycaster();
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const p=mazePoint(x+.5,z+.5);ray.set(p.clone().setY(1),new THREE.Vector3(0,-1,0));
    assert.equal(ray.intersectObject(floor).length>0,walls[z][x]!==2,'The floor follows the occupied building footprint');
    assert.equal(walker.canStand(p.x,p.z),walls[z][x]===0,'Only room and passage cells are walkable');
  }
  assert.equal(walls[goal.z][goal.x],0);
  for(const [x,z] of [[5,3],[3,8],[23,9],[28,18],[4,22],[11,26],[19,28],[27,24]])assert.equal(walls[z][x],0,'Reference chambers and annexes remain open');
  geometry.dispose();material.dispose();
});

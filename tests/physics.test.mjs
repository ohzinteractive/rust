import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Use the browser's import-map target in Node (24+), without installing packages.
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'three' ? new URL('../vendor/three.module.js', import.meta.url).href : specifier, context);
} });
const THREE = await import('../vendor/three.module.js');
const { createFlakePhysics } = await import('../flake-physics.js');
const { PeelingSurface } = await import('../peeling-surface.js');

function fixture() {
  const parent = new THREE.Group();
  parent.position.y = .12;
  parent.rotation.set(.02, -.13, -.045);
  parent.updateMatrixWorld(true);
  const physics = createFlakePhysics({ floorY: -1.75, cubePosition: parent.position, cubeQuaternion: parent.quaternion });
  const state = { seed: 7319, age: 0, peel: .68, relief: .65, exploded: 0 };
  const surface = new PeelingSurface({ parent, material: new THREE.MeshBasicMaterial(), physics, state });
  return { physics, state, surface };
}

test('idle worlds do no work; suspended frames have a bounded catch-up budget', () => {
  const physics = createFlakePhysics();
  assert.equal(physics.step(1 / 60), 0);
  const vertices = [];
  for (const [x,y,z] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]) vertices.push({x:x*.1,y:y*.01,z:z*.1});
  const body = physics.addFlake({vertices, faces:[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]], position:{x:3,y:1,z:0}});
  assert.equal(physics.step(5), 3);
  for (let i=0;i<600;i++) physics.step(1/60);
  assert.equal(physics.stats().awake, 0);
  assert.equal(physics.stats().total, 1);
  assert(body.position.y >= -1.66);
  const time = physics.world.time;
  const pose = body.position.clone();
  for (let i=0;i<60;i++) assert.equal(physics.step(1/60), 0);
  assert.equal(physics.world.time, time);
  assert(body.position.almostEquals(pose));
  physics.clear();
  assert.equal(physics.world.bodies.length, 2);
});

test('cached deformation and local normals match the full reference calculation', () => {
  const {surface,state} = fixture();
  state.age=.03;state.peel=0;
  surface.updateAttached();
  const geometry=surface.mesh.geometry;
  const reference=geometry.clone();reference.computeVertexNormals();
  const actual=geometry.attributes.normal.array,expected=reference.attributes.normal.array;
  for(let i=0;i<actual.length;i++) assert(Math.abs(actual[i]-expected[i])<1e-5);
  const version=geometry.attributes.position.version;
  surface.updateAttached();surface.syncPhysics();
  assert.equal(geometry.attributes.position.version,version);
  reference.dispose();geometry.dispose();surface.material.dispose();
});

test('released fragments update GPU buffers, remain above the floor, and repaint clears them', () => {
  const {surface,state,physics}=fixture();
  state.age=1;surface.updateAttached();
  assert.equal(surface.detachedCount,6);
  const geometry=surface.mesh.geometry;
  const before=geometry.attributes.position.version;
  physics.step(1/60);surface.syncPhysics();
  assert(geometry.attributes.position.version>before);
  assert(geometry.attributes.position.updateRanges.length>0);
  for(let i=0;i<600;i++){physics.step(1/60);surface.syncPhysics();}
  for(const flake of surface.flakes) if(flake.body) {
    for(const vertex of flake.body.shapes[0].vertices) {
      const point=flake.body.quaternion.vmult(vertex);
      assert(point.y+flake.body.position.y>=-1.757);
    }
  }
  // Even when attached geometry changes, settled normals remain untouched.
  const settled=surface.flakes.find(f=>f.body?.mass===0);
  assert(settled);
  const start=settled.start*3,end=start+settled.infos.length*3;
  const normals=geometry.attributes.normal.array.slice(start,end);
  state.age=.2;surface.updateAttached();
  assert.deepEqual(geometry.attributes.normal.array.slice(start,end),normals);
  state.age=0;surface.repaint();
  assert.equal(surface.detachedCount,0);
  assert.equal(physics.stats().total,0);
  assert.equal(physics.world.bodies.length,2);
  assert(geometry.attributes.flakeAge.array.every(age=>age===-1));
  geometry.dispose();surface.material.dispose();
});

test('fresh topcoat is flat and seamless, then age opens cracks', () => {
  const {surface,state}=fixture();
  const geo=surface.mesh.geometry;
  assert.equal(geo.attributes.coatEdge.count,geo.attributes.position.count);
  assert(geo.attributes.coatEdge.array.every(value=>value>=0&&value<=1));
  for(const flake of surface.flakes){
    for(const info of flake.infos){
      if(info.back||info.wall)continue;
      const i=info.index;
      const position=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,i);
      const normal=new THREE.Vector3().fromBufferAttribute(geo.attributes.normal,i);
      assert(Math.abs(position.dot(flake.face.n)-1.318)<1e-6);
      assert(normal.dot(flake.face.n)>.99999,'Fresh paint has a beveled cell edge');
    }
  }
  const flake=surface.flakes[0];
  const edge=flake.infos.filter(info=>!info.back&&!info.wall).reduce((a,b)=>Math.hypot(a.dx,a.dy)>Math.hypot(b.dx,b.dy)?a:b);
  const before=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,edge.index);
  state.age=.3;state.peel=0;state.relief=0;surface.updateAttached();
  const after=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,edge.index);
  assert(after.distanceTo(flake.root)<before.distanceTo(flake.root),'Aging should pull the cell edge inward to open a crack');
  state.age=0;surface.repaint();
  assert(new THREE.Vector3().fromBufferAttribute(geo.attributes.position,edge.index).distanceTo(before)<1e-6);
  geo.dispose();surface.material.dispose();
});


test('aged cracks recover the original shared edge normals', () => {
  const {surface,state}=fixture();
  state.age=1;state.peel=0;surface.updateAttached();
  const geo=surface.mesh.geometry,reference=geo.clone();
  const aliases=new Map();
  for(const flake of surface.flakes)for(const info of flake.infos)if(info.wall)aliases.set(info.index,info.surfaceIndex);
  const indices=reference.index.array;
  for(let i=0;i<indices.length;i++)indices[i]=aliases.get(indices[i])??indices[i];
  reference.computeVertexNormals();
  const expected=reference.attributes.normal.array,actual=geo.attributes.normal.array;
  for(const flake of surface.flakes)for(const info of flake.infos){
    const source=info.wall?info.surfaceIndex:info.index;
    for(let axis=0;axis<3;axis++)assert(Math.abs(actual[info.index*3+axis]-expected[source*3+axis])<1e-5);
  }
  reference.dispose();geo.dispose();surface.material.dispose();
});

test('fractures have varied chip sizes and stay within the existing body budget', () => {
  const {surface}=fixture();
  assert.equal(surface.flakes.length,294);
  const radii=surface.flakes.map(f=>f.radius).sort((a,b)=>a-b);
  assert(radii[Math.floor(radii.length*.9)]/radii[Math.floor(radii.length*.1)]>1.7);
  assert(surface.flakes.some(f=>f.infos.some(i=>Math.abs(i.jagX)+Math.abs(i.jagY)>.02)));
  surface.mesh.geometry.dispose();surface.material.dispose();
});

test('bare non-iron profiles retain an intact surface while painted profiles can peel', async () => {
  const {metalPresets,corrosionRate}=await import('../metal-presets.js');
  const {surface,state,physics}=fixture();
  for(const metal of ['copper','bronze','aluminum']){
    state.metal=metal;state.flakeFactor=metalPresets[metal].bareFlaking;
    state.age=0;surface.repaint();state.age=1;surface.updateAttached();
    assert.equal(surface.detachedCount,0);
    assert.equal(surface.pendingReleaseCount,0);
    assert.equal(physics.stats().total,0);
    const env={...state,moisture:1,oxygen:1,salt:.3,speed:1};
    assert(corrosionRate(env)>0);
    assert.equal(corrosionRate({...env,moisture:0}),0);
    assert.equal(corrosionRate({...env,oxygen:0}),0);
  }
  const env={metal:'aluminum',age:0,moisture:1,oxygen:1,salt:.3,speed:1};
  assert(corrosionRate({...env,age:1})<corrosionRate(env));
  state.flakeFactor=1;surface.updateAttached();
  assert(surface.detachedCount>0);
  surface.mesh.geometry.dispose();surface.material.dispose();
});

test('core face boundaries stay welded after displacement, with continuous normals', async () => {
  const {createCoreGeometry}=await import('../core-geometry.js');
  const {noise}=await import('../peeling-surface.js');
  const original=new THREE.BoxGeometry(2.6,2.6,2.6,72,72,72);
  const geometry=createCoreGeometry(noise),groups=new Map();
  const source=original.attributes.position,position=geometry.attributes.position,normal=geometry.attributes.normal;
  let shared=0;
  for(let i=0;i<source.count;i++){
    const key=`${source.getX(i)},${source.getY(i)},${source.getZ(i)}`;
    if(groups.has(key)){
      const other=groups.get(key);shared++;
      for(const axis of ['getX','getY','getZ']){
        assert.equal(position[axis](i),position[axis](other),'Face-edge positions have separated');
        assert.equal(normal[axis](i),normal[axis](other),'Face-edge normals have a shading seam');
      }
    }else groups.set(key,i);
  }
  assert(shared>800,'Exercise all edges and corners');
  original.dispose();geometry.dispose();
});

test('bare patinated faces have no triangle-fan bumps or shading seams', () => {
  const {surface,state}=fixture();
  state.flakeFactor=0;state.age=.75;surface.updateAttached();
  const geo=surface.mesh.geometry;
  for(const flake of surface.flakes)for(const info of flake.infos){
    if(info.back||info.wall)continue;
    const p=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,info.index);
    const n=new THREE.Vector3().fromBufferAttribute(geo.attributes.normal,info.index);
    assert(Math.abs(p.dot(flake.face.n)-1.318)<1e-6);
    assert(n.dot(flake.face.n)>.99999);
  }
  geo.dispose();surface.material.dispose();
});

test('bare metal aging reuses its existing geometry buffers', () => {
  const {surface,state}=fixture();
  state.flakeFactor=0;state.age=.1;surface.updateAttached();
  const geo=surface.mesh.geometry,version=geo.attributes.position.version;
  for(let i=2;i<=10;i++){state.age=i/10;surface.updateAttached();}
  assert.equal(geo.attributes.position.version,version);
  assert.equal(surface.detachedCount,0);
  state.flakeFactor=1;surface.updateAttached();
  assert(geo.attributes.position.version>version);
  geo.dispose();surface.material.dispose();
});

test('loose flakes can be picked up, released, removed, and restored on repaint', () => {
  const {surface,state,physics}=fixture();state.age=1;surface.updateAttached();
  const flake=surface.flakes.find(f=>f.body),body=flake.body;
  assert(physics.grabFlake(body));
  physics.moveFlake(body,{x:3,y:2,z:0});
  assert.equal(body.position.x,3);assert.equal(physics.stats().held,1);
  physics.releaseFlake(body);assert(body.mass>0);assert.equal(physics.stats().held,0);
  const y=body.position.y;for(let i=0;i<30;i++)physics.step(1/60);assert(body.position.y<y);
  surface.syncPhysics();
  const original=surface.mesh.geometry.index.array.slice(flake.indexStart,flake.indexStart+flake.indexCount);
  const count=physics.stats().total;surface.removeFlake(flake);
  assert.equal(physics.stats().total,count-1);
  assert.equal(surface.flakeAtFace(flake.indexStart/3),undefined);
  assert(surface.mesh.geometry.index.array.slice(flake.indexStart,flake.indexStart+flake.indexCount).every(i=>i===flake.start));
  state.age=0;surface.repaint();
  assert.deepEqual(surface.mesh.geometry.index.array.slice(flake.indexStart,flake.indexStart+flake.indexCount),original);
  surface.mesh.geometry.dispose();surface.material.dispose();
});

test('settled flakes keep their world positions when the cube moves', () => {
  const {surface,state,physics}=fixture();state.age=1;surface.updateAttached();
  const flake=surface.flakes.find(f=>f.body);
  physics.grabFlake(flake.body);physics.moveFlake(flake.body,{x:3,y:0,z:0});surface.syncPhysics();
  const info=flake.infos[0];
  const before=new THREE.Vector3().fromBufferAttribute(surface.mesh.geometry.attributes.position,info.index).applyMatrix4(surface.parent.matrixWorld);
  surface.parent.position.y+=.3;physics.setCubeTransform(surface.parent.position,surface.parent.quaternion);surface.syncPhysics();
  const after=new THREE.Vector3().fromBufferAttribute(surface.mesh.geometry.attributes.position,info.index).applyMatrix4(surface.parent.matrixWorld);
  assert(before.distanceTo(after)<1e-6);
  surface.mesh.geometry.dispose();surface.material.dispose();
});

test('pointer taps bounce the cube; flake drags move and taps remove', async () => {
  const {createSceneInteractions}=await import('../scene-interactions.js');
  const {surface,state,physics}=fixture();
  const canvas=new EventTarget();canvas.style={};canvas.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});
  let captured=null;canvas.setPointerCapture=id=>{captured=id;};canvas.hasPointerCapture=id=>captured===id;canvas.releasePointerCapture=()=>{captured=null;};
  const oldWindow=globalThis.window;globalThis.window=new EventTarget();
  const camera=new THREE.PerspectiveCamera(45,800/600,.1,100);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const core=new THREE.Mesh(new THREE.BoxGeometry(2.6,2.6,2.6),new THREE.MeshBasicMaterial());surface.parent.add(core);
  const controls={enabled:true};const input=createSceneInteractions({canvas,camera,controls,core,specimen:surface.parent,surface,physics,invalidate(){}});
  const send=(type,x,y)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{clientX:x,clientY:y,button:0,pointerId:1});canvas.dispatchEvent(e);};
  try{
    send('pointerdown',400,300);send('pointerup',400,300);
    assert(input.update(1/60));assert(surface.parent.position.y>.12);input.cancel();
    state.age=1;surface.updateAttached();const flake=surface.flakes.find(f=>f.body);
    physics.grabFlake(flake.body);physics.moveFlake(flake.body,{x:3,y:0,z:0});physics.releaseFlake(flake.body);surface.syncPhysics();
    const target=()=>{
      const geo=surface.mesh.geometry,idx=geo.index.array;
      for(let i=flake.indexStart;i<flake.indexStart+flake.indexCount;i+=3){
        const a=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,idx[i]),b=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,idx[i+1]),c=new THREE.Vector3().fromBufferAttribute(geo.attributes.position,idx[i+2]);
        if(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()<1e-10)continue;
        const p=a.add(b).add(c).divideScalar(3).applyMatrix4(surface.parent.matrixWorld).project(camera);
        return [(p.x+1)*400,(1-p.y)*300];
      }
    };
    let [x,y]=target();send('pointerdown',x,y);assert.equal(controls.enabled,false);
    send('pointermove',x+40,y-30);send('pointerup',x+40,y-30);
    assert(controls.enabled);assert(!flake.removed);assert(flake.body.mass>0);assert(flake.body.position.x>3);
    surface.syncPhysics();[x,y]=target();send('pointerdown',x,y);send('pointerup',x,y);assert(flake.removed);
  }finally{input.cancel();globalThis.window=oldWindow;surface.mesh.geometry.dispose();surface.material.dispose();core.geometry.dispose();core.material.dispose();}
});

test('all specimen shapes have finite curved coatings, bounded flake counts and matching colliders', async () => {
  const {createShapeGeometry}=await import('../specimen-shapes.js');
  for(const shape of ['cone','sphere','plus','pill']){
    const {surface,state,physics}=fixture();
    state.shape=shape;physics.setSpecimenShape(shape);surface.rebuild();
    const core=createShapeGeometry(shape),geo=surface.mesh.geometry;
    assert(surface.flakes.length<=294&&surface.flakes.length>200);
    for(const name of ['position','normal','restPosition','coatEdge']){
      assert(geo.attributes[name].array.every(Number.isFinite),`${shape} ${name}`);
      assert(core.attributes[name].array.every(Number.isFinite));
    }
    for(const flake of surface.flakes)for(const wall of flake.infos.filter(info=>info.wall)){
      const front=flake.infos.find(info=>info.index===wall.surfaceIndex);
      assert.notEqual(wall.base,front.base,'wall projection must not mutate the coating vertex');
      assert(wall.base.distanceTo(front.base)<1e-8,`${shape} walls share the projected surface boundary`);
    }
    assert(physics.world.bodies[1].shapes.length===(shape==='plus'?5:shape==='pill'?3:1));
    state.age=1;surface.updateAttached();assert(surface.detachedCount>0);
    for(let i=0;i<240;i++){physics.step(1/60);surface.syncPhysics();}
    for(const flake of surface.flakes)if(flake.body){
      assert(Number.isFinite(flake.body.position.y));
      for(const vertex of flake.body.shapes[0].vertices)assert(flake.body.quaternion.vmult(vertex).y+flake.body.position.y>=-1.757);
    }
    state.age=0;surface.repaint();assert.equal(physics.stats().total,0);
    core.dispose();surface.mesh.geometry.dispose();surface.material.dispose();
  }
});

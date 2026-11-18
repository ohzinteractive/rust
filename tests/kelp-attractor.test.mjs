import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelpAttractor}=await import('../kelp-attractor.js');
const {createKelp}=await import('../kelp.js');
const {createKelpFish}=await import('../kelp-fish.js');

test('all toolbar geometries fall into the seabed, replace cleanly, and preserve body clearance',()=>{
  const scene=new THREE.Scene(),shape=createKelpAttractor({scene});shape.setVisible(true);
  let disposed=0;
  for(const kind of ['cube','cone','sphere','plus','pill','maze']){
    shape.setShape(kind);shape.group.children[0].geometry.addEventListener('dispose',()=>disposed++);
    assert.equal(shape.group.children.length,1);assert.equal(shape.shape,kind);assert(shape.active);
    assert.equal(shape.group.children[0].material.shadowSide,THREE.DoubleSide,'Buried objects cast from the light-facing surface at sand contact');
    assert(shape.bounds.min.y>-1.75+1,'New shapes start suspended in the water');
    const release=shape.bounds.min.y;
    shape.advance(.1);assert(shape.bounds.min.y<release,'Gravity starts the descent');
    for(let i=0;i<80;i++)shape.advance(.1);
    assert(!shape.falling);assert(shape.bounds.min.y<-1.75&&shape.bounds.min.y>=-1.92,'The object settles a little into the sand');
    const size=shape.bounds.getSize(new THREE.Vector3());assert(Math.abs(Math.max(size.x,size.y,size.z)-2.6)<1e-5);
    for(const point of [shape.center.clone(),new THREE.Vector3(shape.center.x,-1.74,shape.center.z),shape.bounds.max.clone().addScalar(.02)]){
      assert(shape.project(point,.6));assert(shape.distanceTo(point)>=.6);assert(point.y>=-1.75,'No ejection through the seabed');
    }
  }
  shape.setWaterHeight(3);assert(shape.bounds.max.y< -1.75+3);
  shape.clear();assert.equal(disposed,6);assert(!shape.active);assert(shape.bounds.isEmpty());
  shape.dispose();assert.equal(scene.children.length,0);
});

test('cube inspection restores the original mesh and cleans up both geometries',()=>{
  const scene=new THREE.Scene(),shape=createKelpAttractor({scene});shape.setVisible(true);shape.setShape('pill');
  const original=shape.group.children[0],bounds=shape.bounds.clone();let disposed=0;
  original.geometry.addEventListener('dispose',()=>disposed++);
  shape.setCubeReference(true);const cube=shape.group.children[0];cube.geometry.addEventListener('dispose',()=>disposed++);
  assert(shape.cubeReference);assert.equal(shape.shape,'cube');assert.equal(disposed,0);
  shape.setCubeReference(false);assert.equal(shape.group.children[0],original);assert(shape.bounds.equals(bounds));assert.equal(disposed,1);
  shape.setCubeReference(true);shape.setShape('sphere');assert.equal(disposed,2);assert(!shape.cubeReference);assert.equal(shape.shape,'sphere');
  shape.clear();shape.setCubeReference(true);assert(shape.active);shape.setCubeReference(false);assert(!shape.active);assert(shape.bounds.isEmpty());
  shape.dispose();assert.equal(scene.children.length,0);
});

function simulation(){
  const scene=new THREE.Scene(),kelp=createKelp({scene});kelp.rebuild({strands:4,generations:2,height:7,current:0});kelp.group.visible=true;
  const shape=createKelpAttractor({scene,height:7});shape.setVisible(true);shape.setShape('cube');shape.group.position.x=4;shape.group.position.z=-2;shape.setWaterHeight(7);
  const fish=createKelpFish({scene,kelp});fish.setSettings({count:60,speed:2});fish.setVisible(true);
  const p=new THREE.Vector3(),drawn=new THREE.Vector3();
  function check(){
    const matrix=fish.group.children[0].instanceMatrix.array;
    for(let i=0;i<fish.stats.count;i++){
      const f=fish.inspectFish(i);p.fromArray(f.position);
      assert(shape.distanceTo(p)>.46*f.size,'Simulated fish body and tail remain outside the object');
      drawn.set(matrix[i*16+12],matrix[i*16+13],matrix[i*16+14]);
      assert(shape.distanceTo(drawn)>.46*f.size,'Interpolated fish remain outside the object');
      assert(p.y>=-1.5);assert(f.velocity.every(Number.isFinite));
    }
  }
  return {kelp,shape,fish,check,
    meanDistance(){let sum=0;for(let i=0;i<fish.stats.count;i++)sum+=p.fromArray(fish.inspectFish(i).position).distanceTo(shape.center);return sum/fish.stats.count;},
    tick(n,dt=1/60,verify=true){for(let i=0;i<n;i++){kelp.advance(dt);shape.advance(dt);fish.advance(dt);if(verify)check();}},
    dispose(){fish.dispose();shape.dispose();kelp.dispose();assert.equal(scene.children.length,0);},
  };
}

test('fish approach and circle a shape without body or interpolation collisions',()=>{
  const sim=simulation(),before=sim.meanDistance();sim.fish.setAttractor(sim.shape);sim.check();sim.tick(1200);
  assert(sim.meanDistance()<before*.9,'The school gathers near the shape instead of staying at its old cruising location');
  assert.equal(sim.kelp.stats.remaining,1,'The active shape is the focus instead of grazing');
  for(const kind of ['sphere','plus','cone','pill','maze']){sim.shape.setShape(kind);sim.fish.setAttractor(sim.shape);sim.check();sim.tick(60);}
  sim.kelp.setPlaying(false);sim.shape.setShape('cube');sim.fish.setAttractor(sim.shape);sim.check();assert.equal(sim.fish.advance(.1),false);
  sim.kelp.setPlaying(true);sim.fish.setSettings({count:500});sim.check();sim.tick(60);
  sim.dispose();
});

test('removing the attractor resumes normal kelp feeding',()=>{
  const sim=simulation();sim.fish.setAttractor(sim.shape);sim.tick(120,1/30);
  sim.shape.clear();sim.fish.setAttractor(sim.shape);sim.tick(400,.1,false);
  assert(sim.fish.stats.bites>0);assert(sim.kelp.stats.remaining<1);sim.dispose();
});


test('each replacement lands once and its moving collision bounds follow the mesh',()=>{
  const scene=new THREE.Scene(),impacts=[];
  const shape=createKelpAttractor({scene,getFloorHeight:()=>-1.7,onImpact:p=>impacts.push(p)});
  shape.setVisible(true);
  for(const kind of ['pill','sphere','cube']){
    shape.setShape(kind);const before=impacts.length;
    for(let i=0;i<120;i++){
      shape.advance(.05);
      const actual=new THREE.Box3().setFromObject(shape.group);
      assert(actual.min.distanceTo(shape.bounds.min)<1e-6);
      assert(actual.max.distanceTo(shape.bounds.max)<1e-6);
    }
    assert.equal(impacts.length,before+1);assert(Math.abs(impacts.at(-1).y+1.7)<1e-6);
    assert.equal(impacts.at(-1).footprint,kind==='cube'?'box':'ellipse');
    assert(!shape.falling);
  }
  shape.setShape('cone');shape.advance(.1);shape.clear();
  for(let i=0;i<30;i++)assert(!shape.advance(.1));
  assert.equal(impacts.length,3,'Removing a falling object cancels its impact');shape.dispose();
});

test('reduced motion places the object in the sand without a drop or sand burst',()=>{
  const scene=new THREE.Scene(),impacts=[];
  const shape=createKelpAttractor({scene,reducedMotion:true,onImpact:p=>impacts.push(p)});
  shape.setVisible(true);shape.setShape('pill');
  assert(!shape.falling);assert(!shape.advance(.1));assert(shape.bounds.min.y<-1.75);
  assert.equal(impacts.length,1);assert(impacts[0].quiet);shape.dispose();
});


test('release starts at the water surface, rocks during descent and settles with a buried flat base',()=>{
  const scene=new THREE.Scene(),impacts=[];
  const shape=createKelpAttractor({scene,getSurfaceHeight:()=>8.4,onImpact:p=>impacts.push(p)});
  shape.setVisible(true);shape.setShape('cube');
  assert(Math.abs(shape.bounds.min.y-(8.4-2.6*.35))<1e-6);
  const mesh=shape.group.children[0],initial=mesh.quaternion.clone();
  assert(Math.abs(mesh.rotation.x)>.1);shape.advance(.1);assert(!mesh.quaternion.equals(initial));
  let last=shape.bounds.min.y;
  for(let i=0;i<100;i++){
    shape.advance(.05);assert(shape.bounds.min.y<=last+1e-8,'The lowest corner descends monotonically');last=shape.bounds.min.y;
  }
  assert.equal(impacts.length,1);assert(!shape.falling);assert(mesh.rotation.x===0&&mesh.rotation.z===0);
  assert(Math.abs(shape.bounds.min.y-(-1.75-.16))<1e-6);shape.dispose();
});


test('resizing keeps settled geometry grounded and updates its footprint without rebuilding',()=>{
  const scene=new THREE.Scene(),impacts=[];
  const shape=createKelpAttractor({scene,reducedMotion:true,onImpact:p=>impacts.push(p)});shape.setVisible(true);
  for(const kind of ['cube','cone','plus']){
    shape.setShape(kind);const mesh=shape.group.children[0],geometry=mesh.geometry;
    for(const factor of [.25,.5,1,2,3]){
      shape.setModelSize(factor);
      const actual=new THREE.Box3().setFromObject(shape.group),size=actual.getSize(new THREE.Vector3());
      assert(Math.abs(Math.max(size.x,size.y,size.z)-2.6*factor)<1e-5);
      assert(actual.min.distanceTo(shape.bounds.min)<1e-6&&actual.max.distanceTo(shape.bounds.max)<1e-6);
      assert(actual.min.y<-1.75&&actual.min.y>=-1.92);
      assert.equal(mesh.geometry,geometry);assert(!shape.falling);
      assert(impacts.at(-1).quiet);assert(Math.abs(impacts.at(-1).rx-size.x/2)<1e-6);
    }
  }
  assert(!shape.setModelSize(NaN));assert.equal(shape.modelSize,3);
  shape.setModelSize(-10);assert.equal(shape.modelSize,.25);
  shape.clear();shape.setModelSize(1.5);shape.setShape('sphere');assert.equal(shape.modelSize,1.5);
  assert(Math.abs(shape.bounds.getSize(new THREE.Vector3()).x-3.9)<1e-5);shape.dispose();
});

test('resizing during descent preserves the falling pose and still lands once',()=>{
  const scene=new THREE.Scene(),impacts=[],shape=createKelpAttractor({scene,onImpact:p=>impacts.push(p)});
  shape.setVisible(true);shape.setShape('cone');shape.advance(.1);
  const bottom=shape.bounds.min.y,rotation=shape.group.children[0].quaternion.clone();
  shape.setModelSize(1.5);
  assert(shape.falling);assert(Math.abs(shape.bounds.min.y-bottom)<1e-6);
  assert(shape.group.children[0].quaternion.equals(rotation));
  shape.advance(.05);assert(shape.bounds.min.y<bottom);
  for(let i=0;i<120;i++)shape.advance(.05);
  assert(!shape.falling);assert.equal(impacts.filter(p=>!p.quiet).length,1);shape.dispose();
});

test('fish keep their body clearance after an object grows or shrinks',()=>{
  const sim=simulation();sim.fish.setAttractor(sim.shape);sim.tick(60);
  for(const factor of [1.5,.25,1]){
    sim.shape.setModelSize(factor);sim.fish.setAttractor(sim.shape);sim.check();sim.tick(60);
  }
  sim.dispose();
});

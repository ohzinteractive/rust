import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createFern}=await import('../fern.js');

test('ferns grow repeatable divided fronds grounded at a low crown',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild();
  assert.equal(fern.stats.fronds,18);assert(fern.stats.pinnae>500);assert(fern.stats.pinnules>10000);
  fern.group.traverse(node=>{if(node.geometry)assert(node.geometry.attributes.position.array.every(Number.isFinite));});
  const bounds=new THREE.Box3().setFromObject(fern.group);
  assert(bounds.min.y>=-1.76&&bounds.min.y< -1.65);assert(bounds.max.y<0&&bounds.max.y> -1);
  const original=fern.group.getObjectByName('Divided fern foliage').geometry.attributes.position.array.slice();
  let disposed=0;fern.group.getObjectByName('Divided fern foliage').geometry.addEventListener('dispose',()=>disposed++);
  fern.rebuild();assert.equal(disposed,1);assert.deepEqual(fern.group.getObjectByName('Divided fern foliage').geometry.attributes.position.array,original);
  fern.rebuild({seed:100});assert.notDeepEqual(fern.group.getObjectByName('Divided fern foliage').geometry.attributes.position.array,original);
  const dense=fern.stats.pinnules;fern.rebuild({density:.25,fronds:6});assert(fern.stats.pinnules<dense);assert.equal(fern.stats.fronds,6);
  fern.dispose();assert.equal(scene.children.length,0);
});

test('wind preserves fern roots and calm or hidden plants stop updating',()=>{
  const fern=createFern({scene:new THREE.Scene()});fern.rebuild();fern.group.visible=true;
  const frond=fern.group.children[0],root=frond.position.clone();assert(fern.advance(1/60));assert.deepEqual(frond.position,root);assert.notEqual(frond.rotation.z,0);
  fern.setWind(0);assert.equal(frond.rotation.z,0);assert.equal(fern.advance(1/60),false);
  fern.setWind(.5);fern.group.visible=false;assert.equal(fern.advance(1/60),false);fern.dispose();
});

const {createFernLifeCycle,fernLifeStages}=await import('../fern-life-cycle.js');
test('fern life cycle separates generations, loops playback, and restores the mature plant',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild();
  const cycle=createFernLifeCycle({scene,fern});assert.equal(fernLifeStages.length,7);
  cycle.setActive(true);
  for(let stage=0;stage<7;stage++){
    cycle.seek(stage*100+30);assert.equal(cycle.stage,stage);
    assert.equal(cycle.group.children.filter(view=>view.visible).length,1);
    assert.equal(fern.group.visible,stage===0||stage===6);
    scene.traverse(node=>{if(node.geometry)assert(node.geometry.attributes.position.array.every(Number.isFinite));});
  }
  const roots=new THREE.Box3().setFromObject(fern.group);assert(roots.min.y> -1.76&&roots.min.y< -1.65,'Young fern stays on the ground when scaled');
  cycle.seek(550);assert.equal(cycle.group.getObjectByName('Zygote').visible,false);
  cycle.seek(580);assert.equal(cycle.group.getObjectByName('Zygote').visible,true);
  cycle.seek(699);cycle.setPlaying(true);cycle.advance(.1);assert.equal(cycle.stage,0);
  cycle.setPlaying(false);const progress=cycle.progress;assert.equal(cycle.advance(.1),false);assert.equal(cycle.progress,progress);
  cycle.seek(650);cycle.setActive(false);assert.equal(cycle.playing,false);assert.equal(cycle.group.visible,false);
  assert.equal(fern.group.scale.y,1);assert.equal(fern.group.position.y,0);assert(fern.group.children.every(frond=>frond.visible));
  cycle.dispose();fern.dispose();assert.equal(scene.children.length,0);
});

const {createFernDispersal}=await import('../fern-spores.js');
test('wind carries spores from real fronds to grounded, growing colonies',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild();fern.group.visible=true;
  const dispersal=createFernDispersal({scene,fern});dispersal.rebuild();dispersal.setVisible(true);dispersal.setWind(.5,0);dispersal.setPlaying(true);
  for(let i=0;i<80;i++)dispersal.advance(.05);
  assert(dispersal.stats.airborne>50);assert.equal(dispersal.stats.grown,0);
  const before=dispersal.group.getObjectByName('Drifting fern spores').instanceMatrix.array.slice();
  dispersal.setPlaying(false);assert.equal(dispersal.advance(.05),false);assert.deepEqual(dispersal.group.getObjectByName('Drifting fern spores').instanceMatrix.array,before);
  dispersal.setPlaying(true);for(let i=0;i<1400;i++)dispersal.advance(.05);
  assert(dispersal.stats.landed>=180);assert(dispersal.stats.colonies>=3);assert(dispersal.stats.grown>0);
  const landings=dispersal.landings;assert(landings.every(p=>Math.abs(p.y+1.736)<.00001));
  const mean=landings.reduce((sum,p)=>sum+p.x,0)/landings.length;assert(mean>1.5,'Wind moves the population downwind');
  for(const colony of dispersal.group.getObjectByName('New fern colonies').children){
    assert.equal(colony.position.y,-1.75);assert(landings.some(p=>Math.hypot(p.x-colony.position.x,p.z-colony.position.z)<.00001));
    if(colony.getObjectByName('Growing young fern').visible)assert(colony.getObjectByName('Growing young fern').scale.y>0);
  }
  dispersal.rebuild();dispersal.setWind(.5,180);dispersal.setPlaying(true);for(let i=0;i<320;i++)dispersal.advance(.05);
  const reverseMean=dispersal.landings.reduce((sum,p)=>sum+p.x,0)/dispersal.landings.length;assert(reverseMean< -1.5,'Changing wind direction reverses drift');
  dispersal.dispose();fern.dispose();assert.equal(scene.children.length,0);
});

test('offspring mature at full size, seed successive generations, and respect the population limit',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild({fronds:6,density:.25});
  const dispersal=createFernDispersal({scene,fern,maxColonies:12});dispersal.rebuild();dispersal.setVisible(true);dispersal.setWind(.55,0);dispersal.setSpeed(32);dispersal.setPlaying(true);
  for(let i=0;i<700&&(dispersal.stats.colonies<12||dispersal.stats.generation<3);i++)dispersal.advance(.05);
  assert.equal(dispersal.stats.colonies,12);assert(dispersal.stats.generation>=3);assert(dispersal.stats.reproducing>1);assert(dispersal.stats.emitted>1000);
  const colonies=dispersal.group.getObjectByName('New fern colonies').children;
  assert(colonies.some(c=>c.userData.generation>=3));
  for(const colony of colonies)if(colony.userData.stage==='mature'||colony.userData.stage==='drying')assert(colony.getObjectByName('Growing young fern').scale.x>=1,'Older offspring keep growing beyond the parent size');
  const canopy=dispersal.group.getObjectByName('Full-size offspring canopies');
  assert.equal(canopy.children.length,4,'Canopies share three detail batches and a simple shadow batch');
  const originalVertices=fern.group.children.reduce((sum,f)=>sum+f.children.filter(c=>c.geometry).reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count),0),0);
  assert.equal(canopy.children[0].geometry.attributes.position.count,originalVertices,'Nearby detail retains every parent frond and stem triangle');
  assert(canopy.children.slice(0,3).reduce((sum,m)=>sum+m.count,0)<=24);
  const before=dispersal.stats.emitted;for(let i=0;i<20;i++)dispersal.advance(.05);assert(dispersal.stats.emitted>before,'Mature ferns keep releasing after population fills');
  dispersal.setPopulationLimit(16);for(let i=0;i<300&&dispersal.stats.colonies<16;i++)dispersal.advance(.05);assert.equal(dispersal.stats.colonies,16);
  dispersal.dispose();fern.dispose();
});

test('speed accelerates the whole simulation while preserving wind trajectories',()=>{
  function simulate(speed,frames,wind=.5){
    const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild({fronds:6,density:.25});
    const dispersal=createFernDispersal({scene,fern});dispersal.rebuild();dispersal.setVisible(true);dispersal.setPlaying(true);dispersal.setWind(wind,0);dispersal.setSpeed(speed);
    for(let i=0;i<frames;i++)dispersal.advance(.05);
    const result={stats:dispersal.stats,landings:dispersal.landings};dispersal.dispose();fern.dispose();return result;
  }
  const normal=simulate(1,320),fast=simulate(8,40);
  assert(Math.abs(normal.stats.elapsed-fast.stats.elapsed)<.00001);assert.equal(normal.stats.emitted,fast.stats.emitted);assert.equal(normal.stats.colonies,fast.stats.colonies);
  assert.equal(normal.landings.length,fast.landings.length);
  normal.landings.forEach((point,i)=>assert(point.distanceTo(fast.landings[i])<.00001));
  const weak=simulate(8,40,.1),strong=simulate(8,40,.8);
  const meanX=run=>run.landings.reduce((sum,p)=>sum+p.x,0)/run.landings.length;
  assert(meanX(strong)>meanX(weak)*3,'Stronger winds spread spores farther from the parent');
});

test('colony rendering reduces geometry, culls offscreen plants and updates a paused view without moving it',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild({fronds:6,density:.25});
  const sim=createFernDispersal({scene,fern,maxColonies:80});sim.rebuild();sim.setVisible(true);sim.setWind(.5,0);sim.setSpeed(32);sim.setPlaying(true);
  for(let i=0;i<1600&&sim.stats.colonies<80;i++)sim.advance(.05);sim.setPlaying(false);
  assert.equal(sim.stats.colonies,80,'The colony can exceed the previous 64-fern limit');
  const canopies=sim.group.getObjectByName('Full-size offspring canopies'),high=canopies.children[0].geometry;
  const fullTriangles=high.attributes.position.count/3*sim.stats.colonies;
  const overview=new THREE.PerspectiveCamera(45,1,.1,1000);overview.position.set(0,30,45);overview.lookAt(0,-1,0);sim.updateView(overview);
  assert(sim.renderStats.triangles<fullTriangles*.4,'Mixed-distance views retain foreground quality while removing at least 60% of canopy triangles');
  assert(sim.renderStats.drawCalls<=5);
  const camera=new THREE.PerspectiveCamera(45,1,.1,1000);camera.position.set(0,5,8);camera.lookAt(0,-1,0);
  const pose=camera.position.clone(),rotation=camera.quaternion.clone();sim.updateView(camera);
  assert(sim.renderStats.culled>0);assert.deepEqual(camera.position,pose);assert.deepEqual(camera.quaternion.toArray(),rotation.toArray());
  const uploads=sim.renderStats.matrixUploads;sim.updateView(camera);assert.equal(sim.renderStats.matrixUploads,uploads,'Static mature instances are not uploaded again');
  camera.lookAt(0,50,100);sim.updateView(camera);assert.equal(sim.renderStats.visible,0,'Turning away culls all crowns even while playback is paused');
  let disposed=0;high.addEventListener('dispose',()=>disposed++);sim.rebuild();assert.equal(disposed,1,'Owned detail geometry is released on restart');
  sim.dispose();fern.dispose();assert.equal(scene.children.length,0);
});

test('old ferns grow, dry out, stop reproducing, and leave room for replacements',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild({fronds:6,density:.25});
  const sim=createFernDispersal({scene,fern,maxColonies:12});sim.rebuild();sim.setVisible(true);sim.setPlaying(true);sim.setWind(.5,0);sim.setSpeed(32);
  for(let i=0;i<65;i++)sim.advance(.05);
  const bed=sim.group.getObjectByName('New fern colonies'),first=bed.children.find(c=>c.userData.stage==='mature');assert(first);
  const root=first.position.clone(),beforeFronds=sim.inspectPlant(first.userData.id).fronds;
  for(let i=0;i<15;i++)sim.advance(.05);
  assert(sim.inspectPlant(first.userData.id).fronds.some((f,i)=>f.age>beforeFronds[i].age));assert.equal(first.getObjectByName('Growing young fern').scale.x,1,'Fronds develop without scaling the whole plant');assert.deepEqual(first.position,root);
  for(let i=0;i<250&&first.userData.stage!=='drying';i++)sim.advance(.05);
  assert.equal(first.userData.stage,'drying');
  for(let i=0;i<5;i++)sim.advance(.05);
  assert(first.userData.dryness>0);
  assert(sim.inspectPlant(first.userData.id).fronds.some(f=>f.dryness>0),'Fronds age separately in the drying crown');
  for(let i=0;i<100&&first.userData.stage!=='dead';i++)sim.advance(.05);
  assert.equal(first.userData.stage,'dead');assert(sim.stats.died>0);
  assert.equal(sim.stats.reproducing,sim.stats.grown+(sim.stats.parentStage==='dead'?0:1),'Dead plants are removed from the reproductive population');
  for(let i=0;i<20;i++)sim.advance(.05);
  assert.equal(first.parent,null,'Dead foliage decomposes and releases its scene nodes');assert(sim.stats.colonies<=12);for(let i=0;i<300&&sim.stats.born<=12;i++)sim.advance(.05);assert(sim.stats.born>12,'New plants can occupy freed population slots');
  for(let i=0;i<160;i++)sim.advance(.05);
  assert.equal(sim.stats.parentStage,'dead');
  const pose=fern.group.scale.clone(),stats=sim.stats;sim.setPlaying(false);assert.equal(sim.advance(.1),false);assert.deepEqual(sim.stats,stats);assert.deepEqual(fern.group.scale,pose);
  sim.rebuild();sim.setVisible(true);assert.equal(sim.stats.died,0);assert.equal(fern.group.scale.x,1);assert(fern.group.visible,'Restart restores the original fern');
  sim.dispose();fern.dispose();
});

const {fernFrondState,fernFrondPoint}=await import('../fern-growth.js');
test('crowns add fronds gradually, replace old leaves, and retain young shoots among aging fronds',()=>{
  const life={seed:23,dryAt:240,dieAt:290};
  const states=age=>Array.from({length:18},(_,i)=>fernFrondState(age,i,life));
  assert(states(8).filter(f=>f.visible).length<states(28).filter(f=>f.visible).length);
  assert(states(28).filter(f=>f.visible).length<states(50).filter(f=>f.visible).length,'More fronds emerge as the crown develops');
  assert(Array.from({length:90},(_,i)=>states(70+i)).some(fronds=>fronds.some(f=>f.visible&&f.unroll<.9)&&fronds.some(f=>f.visible&&f.dryness>.5)&&fronds.some(f=>f.mature)),'New coiled shoots coexist with green and old brown fronds');
  assert(fernFrondState(150,0,life).bornAt>6,'A fresh fiddlehead replaces an older frond');
  const early=fernFrondState(25,0,life),later=fernFrondState(150,0,life);assert(later.size>early.size,'Later fronds can be larger than the juvenile leaves');
  assert(states(309).every(f=>!f.visible),'A dead crown produces no new shoots');
});

test('fiddlehead deformation keeps the root attached and progressively unrolls its tip',()=>{
  const life={seed:23,dryAt:240,dieAt:290},frond={length:1.4,pitch:1.1,bend:1.2};
  const root=new THREE.Vector3(),tip=new THREE.Vector3(frond.length*(Math.sin(frond.pitch)-Math.sin(frond.pitch-frond.bend))/frond.bend,frond.length*(Math.cos(frond.pitch-frond.bend)-Math.cos(frond.pitch))/frond.bend,0);
  const early=fernFrondState(8,0,life),opened=fernFrondState(25,0,life);
  const a=fernFrondPoint(tip,frond,1,early),b=fernFrondPoint(tip,frond,1,opened);
  assert(a.distanceTo(b)>.1);assert(b.y>a.y,'The rolled tip rises and extends into a frond');
  assert(fernFrondPoint(root,frond,0,early).distanceTo(fernFrondPoint(root,frond,0,opened))<.00001,'The developing frond stays fixed at its crown');
  for(const age of [6,8,12,20,70,150,280,300])for(let i=0;i<18;i++)assert(fernFrondPoint(tip,frond,1,fernFrondState(age,i,life)).toArray().every(Number.isFinite));
});

test('shoots rise upright from the crown, unroll before spreading, and lower older leaves under new growth',()=>{
  const life={seed:23,dryAt:240,dieAt:290,frondCount:18},frond={length:1.4,pitch:1.1,bend:1.2};
  const axis=t=>new THREE.Vector3(frond.length*(Math.sin(frond.pitch)-Math.sin(frond.pitch-frond.bend*t))/frond.bend,frond.length*(Math.cos(frond.pitch-frond.bend*t)-Math.cos(frond.pitch))/frond.bend,0);
  const rising=fernFrondState(10,0,life),unrolling=fernFrondState(16,0,life),unrolled=fernFrondState(19,0,life),open=fernFrondState(30,0,life),older=fernFrondState(48,0,life);
  assert(rising.rise>0&&rising.unroll===0&&rising.opening===0);
  const shaft=fernFrondPoint(axis(.02),frond,.02,rising);assert(shaft.y>.01&&Math.abs(shaft.x)<.0001,'The shoot grows vertically rather than leaning outwards');
  assert(unrolling.unroll>0&&unrolling.unroll<1&&unrolling.opening===0);assert.equal(unrolled.unroll,1);assert.equal(unrolled.opening,0,'Leaflets stay folded until the tip has unrolled');
  const pinna=axis(.5).add(new THREE.Vector3(0,0,.2));
  assert(fernFrondPoint(pinna,frond,.5,open).z>fernFrondPoint(pinna,frond,.5,unrolled).z*10,'Pinnae spread after unrolling');
  assert(older.pressure>open.pressure);assert(older.settle>open.settle);
  const high=fernFrondPoint(axis(1),frond,1,open),low=fernFrondPoint(axis(1),frond,1,older);
  assert(low.y<high.y&&low.x>high.x,'New opening fronds lower older leaves outward without flattening the whole crown');
  assert.equal(older.dryness,0,'This settling also affects healthy green fronds');
  let pressure=0;for(let age=30;age<100;age++){const now=fernFrondState(age,0,life).pressure;assert(now>=pressure,'Settled fronds do not rise when a neighboring leaf is replaced');pressure=now;}
});


test('shoots start tiny, emerge sequentially across replacements, and only mature crowns release spores',async()=>{
  const {fernCanReleaseSpores,FERN_FROND_INTERVAL}=await import('../fern-growth.js');
  const life={seed:23,dryAt:600,dieAt:650,frondCount:18};
  const small=fernFrondState(7,0,life),full=fernFrondState(36,0,life);
  assert(small.size<full.size*.1,'A new shoot begins below a tenth of its developed size');
  for(let index=0;index<18;index++){
    let size=0;
    for(let step=0;step<=24;step++){
      const state=fernFrondState(6+index*FERN_FROND_INTERVAL+step,index,life);
      assert(state.size>=size);size=state.size;
    }
  }
  const births=new Set();
  for(let age=0;age<500;age+=.5)for(let index=0;index<18;index++){
    const state=fernFrondState(age,index,life);if(state.age>=0)births.add(state.bornAt);
  }
  const ordered=[...births].sort((a,b)=>a-b);
  for(let i=1;i<ordered.length;i++)assert(ordered[i]-ordered[i-1]>=FERN_FROND_INTERVAL,'Replacement shoots retain the one-at-a-time rhythm');
  for(let age=0;age<48;age++)assert.equal(fernCanReleaseSpores(age,life),false);
  assert(fernCanReleaseSpores(48,life));assert.equal(fernCanReleaseSpores(651,life),false);
  assert.equal(fernFrondState(35,0,life).mature,false,'An opened frond still needs time to become fertile');
});


test('fern LOD follows apparent size and resists switching back and forth near thresholds',async()=>{
  const {selectFernLOD}=await import('../fern-lod.js');
  assert.equal(selectFernLOD(.5),0);assert.equal(selectFernLOD(.1),1);assert.equal(selectFernLOD(.02),2);
  assert.equal(selectFernLOD(.21,0),0);assert.equal(selectFernLOD(.23,1),1);
  assert.equal(selectFernLOD(.17,0),1);assert.equal(selectFernLOD(.26,1),0);
  assert.equal(selectFernLOD(.033,1),1);assert.equal(selectFernLOD(.037,2),2);
  assert.equal(selectFernLOD(.025,1),2);assert.equal(selectFernLOD(.045,2),1);
});

test('leaflets spread from the base toward the tip instead of opening as one rigid sheet',()=>{
  const life={seed:23,dryAt:240,dieAt:290},state=fernFrondState(24,0,life),frond={length:1.4,pitch:1.1,bend:1.2};
  const width=t=>{const theta=frond.pitch-frond.bend*t;return fernFrondPoint(new THREE.Vector3(frond.length*(Math.sin(frond.pitch)-Math.sin(theta))/frond.bend,frond.length*(Math.cos(theta)-Math.cos(frond.pitch))/frond.bend,.2),frond,t,state).z;};
  assert(width(.2)>width(.85)*1.5,'Lower pinnae open before those at the tip');
});

test('spore flow is coherent, gusts smoothly, follows wind direction and remains bounded',async()=>{
  const {sampleFernFlow}=await import('../fern-flow.js');
  const point=new THREE.Vector3(2,.4,3),wind=new THREE.Vector3(.8,0,0),a=new THREE.Vector3(),b=new THREE.Vector3();
  assert.equal(sampleFernFlow(point,2,wind,.5,-1.75,a),a,'Flow reuses the caller buffer');
  sampleFernFlow(point.clone().addScalar(.001),2,wind,.5,-1.75,b);assert(a.distanceTo(b)<.002,'Nearby spores share an eddy');
  sampleFernFlow(point,2.001,wind,.5,-1.75,b);assert(a.distanceTo(b)<.002,'The flow changes continuously');
  sampleFernFlow(point,5,wind,.5,-1.75,b);assert(a.distanceTo(b)>.05,'Gusts evolve over time');
  sampleFernFlow(point,2,new THREE.Vector3(),0,-1.75,b);assert.equal(b.length(),0,'Calm wind adds no artificial drift');
  for(let t=0;t<100;t++){
    sampleFernFlow(point,t,wind,.5,-1.75,a);assert(a.x>0&&a.length()<1.5);
    sampleFernFlow(point,t,wind.clone().negate(),.5,-1.75,b);assert(b.x<0&&b.length()<1.5);
  }
  sampleFernFlow(new THREE.Vector3(2,-1.75,3),2,wind,.5,-1.75,a);assert.equal(a.y,0,'Vertical eddies ease out at the ground');
});

test('leaf contact lowers only the lower leaf of another crown and releases smoothly',async()=>{
  const {solveFernContacts,fernContactValue}=await import('../fern-contact.js');
  const leaf=(plant,y,x=0)=>({plant,frond:2,t:.8,radius:.15,point:new THREE.Vector3(x,y,0)});
  const hits=solveFernContacts([leaf(1,.4),leaf(2,.43)]);
  assert(hits.get('1:2')>0);assert.equal(hits.has('2:2'),false);
  assert.equal(solveFernContacts([leaf(1,.4),leaf(1,.43)]).size,0);
  assert.equal(solveFernContacts([leaf(1,.4),leaf(2,.43,2)]).size,0);
  assert.equal(solveFernContacts([leaf(1,.4),leaf(2,.8)]).size,0);
  const data=new Float32Array([0,.15,2,0]);
  assert.equal(fernContactValue(data,0,2),0);assert(fernContactValue(data,0,3)>.14);
  const life={seed:23,dryAt:240,dieAt:290},frond={length:1.4,pitch:1.1,bend:1.2},state=fernFrondState(40,0,life);
  const p=new THREE.Vector3(0,0,0);
  const before=fernFrondPoint(p,frond,0,state);state.contact=.15;
  assert.deepEqual(fernFrondPoint(p,frond,0,state),before,'Roots remain attached');
});

test('changing wind stays smooth, repeats after reset, and windmill faces incoming air',async()=>{
  const {createChangingWind,createWindmill}=await import('../fern-wind.js');
  const wind=createChangingWind(42),path=[];let previous={strength:.5,direction:25};
  for(let i=0;i<1200;i++){
    const value=wind.advance(.05,.5,25,true);assert(Math.abs(value.direction-previous.direction)<2);assert(value.strength>=0&&value.strength<=1);path.push(value);previous=value;
  }
  assert(path.some(v=>Math.abs(v.direction-25)>10));wind.reset();
  for(let i=0;i<path.length;i++)assert.deepEqual(wind.advance(.05,.5,25,true),path[i]);
  assert.deepEqual(wind.advance(1,.5,25,false),{strength:.5,direction:25});
  const root=new THREE.Group(),mill=createWindmill(root,-1.75);mill.update(1,.5,0);
  const head=mill.group.children[1],facing=new THREE.Vector3(0,0,1).applyQuaternion(head.quaternion);assert(facing.x<-.99);
  const rotor=head.children[0],rotation=rotor.rotation.z;mill.update(1,0,90);assert.equal(rotor.rotation.z,rotation);
  mill.dispose();assert.equal(root.children.length,0);
});

test('pointer wind travels from the windmill toward the cursor and grows with distance',async()=>{
  const {pointerFernWind}=await import('../fern-wind.js');
  const camera=new THREE.PerspectiveCamera(45,1,.1,100);camera.position.set(4,5,7);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const origin=new THREE.Vector3(-1,0,0),ray=new THREE.Raycaster();
  const sample=point=>{const p=point.clone().project(camera);return pointerFernWind(new THREE.Vector2(p.x,p.y),camera,origin,ray);};
  assert(sample(origin).strength<.00001);
  const near=sample(origin.clone().add(new THREE.Vector3(1,0,0))),far=sample(origin.clone().add(new THREE.Vector3(4,0,0)));
  assert(far.strength>near.strength*3.9);assert(Math.abs(far.direction)<.00001);
  assert(Math.abs(sample(origin.clone().add(new THREE.Vector3(0,0,3))).direction-90)<.00001);
});

test('wind streaks animate in one bounded batch and disappear in calm air',async()=>{
  const {createWindTrails}=await import('../fern-wind.js');const root=new THREE.Group(),trails=createWindTrails(root);
  trails.update(.1,.5,0);const geometry=trails.lines.geometry,before=geometry.attributes.position.array.slice();
  trails.update(.2,.8,90);assert(geometry.attributes.position.array.every(Number.isFinite));assert.notDeepEqual(geometry.attributes.position.array,before);
  assert.equal(root.children.length,1);assert(geometry.attributes.position.count<400);
  trails.update(.1,0,90);assert.equal(trails.lines.visible,false);
  trails.dispose();assert.equal(root.children.length,0);
});


test('new ferns wait for individual sprouting times and do not age or release spores early',()=>{
  const fern=createFern({scene:new THREE.Scene()});fern.rebuild({fronds:6,density:.25});
  const sim=createFernDispersal({scene:new THREE.Scene(),fern,maxColonies:12});sim.rebuild();sim.setVisible(true);sim.setWind(.5,0);sim.setPlaying(true);
  for(let i=0;i<240;i++)sim.advance(.05);
  const colonies=sim.group.getObjectByName('New fern colonies').children;assert(colonies.length>1);
  assert(new Set(colonies.map(c=>c.userData.growthDelay)).size>1);
  const waiting=colonies.find(c=>c.userData.stage==='waiting');assert(waiting);
  const state=sim.inspectPlant(waiting.userData.id);assert(state.waitingFor>0);assert(state.growthDelay>=4&&state.growthDelay<=22);assert(state.fronds.every(f=>!f.visible&&!f.mature));
  assert.equal(waiting.getObjectByName('Growing young fern').visible,false);
  sim.setPlaying(false);sim.advance(.1);assert.deepEqual(sim.inspectPlant(waiting.userData.id),state);
  sim.setPlaying(true);for(let i=0;i<600;i++)sim.advance(.05);
  assert(sim.inspectPlant(waiting.userData.id).fronds.some(f=>f.visible));
  sim.dispose();fern.dispose();
});

test('fern surface anchors sample real triangles and offspring follow their surface normals',async()=>{
  const {createFernSurface}=await import('../fern-surface.js');
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.SphereGeometry(1,20,12),new THREE.MeshBasicMaterial());mesh.position.y=.3;scene.add(mesh);
  const habitat=createFernSurface(mesh);let seed=1;const random=()=>((seed=seed*16807%2147483647)-1)/2147483646;
  for(let i=0;i<30;i++){const hit=habitat.sample(random);assert(hit.point.distanceTo(mesh.position)>.96&&hit.point.distanceTo(mesh.position)<1.02);assert(hit.normal.dot(hit.point.clone().sub(mesh.position))>.9);}
  assert(habitat.intersect(new THREE.Vector3(2,.3,0),new THREE.Vector3(0,.3,0)));
  const fern=createFern({scene});fern.rebuild({fronds:6,density:.25});const sim=createFernDispersal({scene,fern,maxColonies:24});sim.setSurface(habitat);sim.rebuild();sim.setVisible(true);
  const colonies=sim.group.getObjectByName('New fern colonies').children;assert(colonies.length>5);
  for(const colony of colonies){const normal=new THREE.Vector3(0,1,0).applyQuaternion(colony.quaternion);assert(normal.dot(colony.position.clone().sub(mesh.position).normalize())>.9);assert(colony.position.distanceTo(mesh.position)>.96);}
  sim.setPlaying(true);for(let i=0;i<1500;i++)sim.advance(.05);assert(sim.stats.grown>0);assert(sim.stats.emitted>90);
  sim.dispose();fern.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('fern coating samples every mesh of a model in world coordinates',async()=>{
  const {createFernSurface}=await import('../fern-surface.js');
  const a=new THREE.Mesh(new THREE.BoxGeometry(1,1,1)),b=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));a.position.x=-2;b.position.x=2;
  const habitat=createFernSurface([a,b]);let seed=7;const random=()=>((seed=seed*16807%2147483647)-1)/2147483646;
  const points=Array.from({length:100},()=>habitat.sample(random).point);
  assert(points.some(p=>p.x< -1));assert(points.some(p=>p.x>1));assert(points.every(p=>Math.abs(p.x)>1));
  assert(habitat.intersect(new THREE.Vector3(4,0,0),new THREE.Vector3(2,0,0)));
  a.geometry.dispose();b.geometry.dispose();a.material.dispose();b.material.dispose();
});

test('windmill stays outside the object and its fern canopy at a fixed corner',async()=>{
  const {windmillCorner}=await import('../fern-wind.js');
  for(const bounds of [new THREE.Box3(new THREE.Vector3(-1,-2,-1),new THREE.Vector3(1,1,1)),new THREE.Box3(new THREE.Vector3(3,-1,-4),new THREE.Vector3(5,4,-2))]){
    const position=windmillCorner(bounds,-1.75,.6);
    assert(position.x+.35<bounds.min.x-.6);assert(position.z-.35>bounds.max.z+.6);assert.equal(position.y,-1.75);
  }
});


test('dead ferns accumulate soil height and new ferns root on the previous crown',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild({fronds:6,density:.25});
  const sim=createFernDispersal({scene,fern,maxColonies:1});sim.rebuild();sim.setVisible(true);sim.setWind(0);sim.setSpeed(32);sim.setPlaying(true);
  for(let i=0;i<400&&sim.stats.deposits===0;i++)sim.advance(.05);
  assert(sim.stats.deposits>0);const firstHeight=sim.floorHeight(0,0);assert(firstHeight> -1.75);
  for(let i=0;i<80;i++)sim.advance(.05);
  const bed=sim.group.getObjectByName('New fern colonies');
  assert(bed.children.some(c=>Math.hypot(c.position.x,c.position.z)<.001&&c.position.y>=firstHeight-.001),'A replacement roots above the original crown');
  const litter=sim.group.getObjectByName('Persistent fallen fern fronds');assert(litter.count>0);
  for(let i=0;i<500;i++)sim.advance(.05);
  assert(sim.floorHeight(0,0)>firstHeight,'Successive generations build more ground');assert(litter.count>1);
  sim.rebuild();assert.equal(sim.floorHeight(0,0),-1.75);assert.equal(sim.stats.deposits,0);sim.dispose();fern.dispose();
});

test('a full fern population reserves every old crown for renewal despite incoming spores',()=>{
  const scene=new THREE.Scene(),fern=createFern({scene});fern.rebuild({fronds:6,density:.25});
  const sim=createFernDispersal({scene,fern,maxColonies:8});sim.rebuild();sim.setVisible(true);sim.setWind(.6,0);sim.setSpeed(32);sim.setPlaying(true);
  for(let i=0;i<700&&sim.stats.colonies<8;i++)sim.advance(.05);
  assert.equal(sim.stats.colonies,8);
  const bed=sim.group.getObjectByName('New fern colonies'),key=c=>c.position.x.toFixed(5)+','+c.position.z.toFixed(5);
  const sites=new Map(bed.children.filter(c=>c.userData.stage!=='dead').map(c=>[key(c),{id:c.userData.id,height:c.position.y}])),renewed=new Set();
  assert.equal(sites.size,8);
  for(let i=0;i<600;i++){
    sim.advance(.05);assert(sim.stats.colonies<=8);
    for(const c of bed.children){
      assert(sites.has(key(c)),'An incoming spore cannot steal a reserved population slot');
      const old=sites.get(key(c));if(c.userData.id!==old.id){assert(c.position.y>old.height);renewed.add(key(c));}
    }
  }
  assert.equal(renewed.size,sites.size,'Every established crown gets a successor at the same x/z');
  sim.dispose();fern.dispose();
});

test('accumulated soil batches many patches, preserves heights and frees its buffers on reset',async()=>{
  const {createFernFloor}=await import('../fern-floor.js');const root=new THREE.Group(),floor=createFernFloor(root,-1.75);
  for(let i=0;i<30;i++)floor.deposit(new THREE.Vector3(i*4,-1.75,0),1);
  assert(floor.stats.soilTiles>64,'Exercise terrain buffer expansion');assert.equal(floor.group.children.length,1);
  const batch=floor.group.children[0];assert(batch.isBatchedMesh);assert(batch.geometry.attributes.position.array.every(Number.isFinite));
  const before=floor.height(0,0);floor.deposit(new THREE.Vector3(0,-1.75,0),1);assert(Math.abs(floor.height(0,0)-before-.035)<1e-9);
  let disposed=0;batch.geometry.addEventListener('dispose',()=>disposed++);floor.clear();assert.equal(disposed,1);assert.equal(floor.height(0,0),-1.75);assert.equal(floor.group.children.length,0);
  floor.dispose();assert.equal(root.children.length,0);
});

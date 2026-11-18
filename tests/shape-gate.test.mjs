import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const T=await import('../vendor/three.module.js');
const {createSlottedGateShape}=await import('../shape-gate-geometry.js');
test('gate has a continuous opening for the cord and model with solid sides',()=>{
 for(const points of [[[-.7,.8],[-.7,2.2],[.7,2.2],[.7,.8]],[[-.7,.8],[0,2.2],[.7,.8]]]){
  const shape=createSlottedGateShape(points.map(p=>new T.Vector2(...p)));
  const g=new T.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:true,bevelSize:.015,bevelThickness:.015,bevelSegments:2});
  const mesh=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.updateMatrixWorld();
  const hit=(x,y)=>new T.Raycaster(new T.Vector3(x,y,1),new T.Vector3(0,0,-1)).intersectObject(mesh).length>0;
  for(let y=1.5;y<3.1;y+=.025)assert(!hit(0,y),'The cord path is open at '+y);
  assert(hit(.15,2.6));assert(hit(-.15,2.6));assert(hit(0,.4));assert(!hit(0,1.3));
  assert(g.attributes.position.array.every(Number.isFinite));g.dispose();mesh.material.dispose();
 }
});

test('raised rim thickens both faces and clears the cord through a rotating pass',async()=>{
 const {createGateRimGeometry,gateRimDepth,gateRimRadius}=await import('../shape-gate-geometry.js');
 const {gateDepth,gateRadius}=await import('../shape-gate-aperture.js');
 const {gateMotion,phaseForClearance,swingPivotHeight,swingRate}=await import('../shape-gate-motion.js');
 const geometry=createGateRimGeometry();
 const rim=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
 rim.position.z=-gateDepth/2;rim.updateMatrixWorld(true);
 const ray=new T.Raycaster(new T.Vector3(),new T.Vector3(0,0,-1));
 const hit=(x,y)=>{
  ray.ray.origin.set(x,y,1);
  return ray.intersectObject(rim);
 };
 const edge=hit(0,-gateRadius+.12);
 assert(Math.abs(edge[0].point.z-gateRimDepth/2)<1e-7);
 assert(Math.abs(edge.at(-1).point.z+gateRimDepth/2)<1e-7);
 assert.equal(hit(0,2.6).length,0,'The lip surrounds the face');

 const ropeRadius=.009;
 const clearance=phaseForClearance(Math.atan2(gateRimDepth/2+ropeRadius,swingPivotHeight-gateRimRadius));
 for(let y=2.7;y<=gateRimRadius;y+=.01){
  const length=swingPivotHeight-y;
  for(const face of [-gateRimDepth/2,0,gateRimDepth/2]){
   const phase=phaseForClearance(Math.asin(Math.abs(face)/length));
   const height=swingPivotHeight-Math.sqrt(length*length-face*face);
   for(const side of [-1,1]){
    const {disk}=gateMotion((Math.PI+side*phase)/swingRate,clearance,clearance);
    for(const x of [-ropeRadius,ropeRadius]){
     assert.equal(hit(x*Math.cos(disk)+height*Math.sin(disk),height*Math.cos(disk)-x*Math.sin(disk)).length,0);
    }
   }
  }
 }
 geometry.dispose();rim.material.dispose();
});

test('the checkerboard joints align with all four seal edges as the floor expands',async()=>{
 const {createGateBaseSeal,createGateFloor}=await import('../shape-gate-base.js');
 const {seal}=createGateBaseSeal();
 const {floor,resize}=createGateFloor();
 const frame=new T.Box3().setFromObject(seal);
 const marble=floor.getObjectByName('Polished marble tiles');
 const aligned=value=>assert(Math.abs(value-Math.round(value))<1e-6);
 for(const border of [0,1,8,0]){
  resize(border);
  const shader={uniforms:{},vertexShader:'',fragmentShader:''};
  marble.material.onBeforeCompile(shader);
  const size=shader.uniforms.floorTileSize.value,origin=shader.uniforms.floorTileOrigin.value;
  for(const x of [frame.min.x,frame.max.x])aligned((x+origin.x)/size.x);
  for(const z of [frame.min.z,frame.max.z])aligned((-z+origin.y)/size.y);
  marble.geometry.computeBoundingBox();
  for(const edge of [marble.geometry.boundingBox.min,marble.geometry.boundingBox.max]){
   aligned((edge.x+origin.x)/size.x);
   aligned((edge.y+origin.y)/size.y);
  }
 }
 marble.dispose();
});

test('disk spins continuously and slows at crossings with different approach depths',async()=>{
  const {gateMotion,swingRate}=await import('../shape-gate-motion.js');
  const passes=[.5,.18,.37,.09,.61];
  const angle=phase=>{
    const step=Math.floor(phase/Math.PI);
    return gateMotion(phase/swingRate,passes[step+1],passes[step]).disk;
  };
  let previous=angle(0);
  for(let step=0;step<passes.length-1;step++){
    const start=step*Math.PI,end=(step+1)*Math.PI;
    for(let i=1;i<=400;i++){
      const disk=angle(start+(end-start)*i/400);
      assert(disk>previous,'Disk keeps advancing');
      previous=disk;
    }
    assert(Math.abs(previous-2*end)<1e-10,'Opening lines up once per half swing');
    const crossingSpeed=(angle(end)-angle(end-.01))/.01;
    const middle=(start+passes[step]+end-passes[step+1])/2;
    const cruiseSpeed=(angle(middle+.1)-angle(middle))/.1;
    assert(crossingSpeed*swingRate>5*Math.PI/180,'The wheel still turns visibly at normal playback speed');
    assert(cruiseSpeed>crossingSpeed*10);
    assert(Math.abs(angle(end)-angle(end-passes[step+1])-crossingSpeed*passes[step+1])<1e-10);
    assert(Math.abs(angle(middle)-angle(middle-.1)-cruiseSpeed*.1)<1e-10);
    assert(Math.abs(angle(end+.01)-angle(end)-crossingSpeed*.01)<1e-10,'Slow speed matches on both sides of the crossing');
    assert.equal(gateMotion((start+.02)/swingRate,passes[step],passes[step]).disk,angle(start+.02),'An upcoming model can change during departure without shifting the disk');
  }
});

test('higher rope anchor keeps the model aligned with the gate and preserves its swing reach',async()=>{
 const {gateMotion,swingLength,swingPivotHeight,swingRate}=await import('../shape-gate-motion.js');
 assert.equal(swingPivotHeight,15);
 assert.equal(swingPivotHeight-swingLength,1.5);
 const {swing}=gateMotion(Math.PI/(2*swingRate));
 assert(Math.abs(-swingLength*Math.sin(swing)-2.12)<1e-10);
});

test('geometric morph targets keep the same vertices and triangles throughout every transition',async()=>{
 const {createShapeTargets,geometricShapes}=await import('../shape-gate-targets.js');const targets=createShapeTargets(32,24),g=targets.geometry,index=g.index,position=g.attributes.position;
 for(let i=0;i<geometricShapes.length;i++){
  const from=geometricShapes[i],to=geometricShapes[(i+1)%geometricShapes.length];
  for(const t of [0,.1,.25,.5,.75,.9,1]){
   targets.update(from,to,t);assert.equal(g.index,index);assert.equal(g.attributes.position,position);assert(position.array.every(Number.isFinite));assert(g.attributes.normal.array.every(Number.isFinite));
   for(let k=0;k<position.array.length;k++)assert(Math.abs(position.array[k]-(targets.positions[from][k]*(1-t)+targets.positions[to][k]*t))<1e-6);
  }
 }
 targets.dispose();
});

test('surface correspondence handles open meshes and restores exact destination geometry',async()=>{
 const {createSurfaceCorrespondence}=await import('../shape-gate-correspondence.js');
 const from=new T.Mesh(new T.BoxGeometry(1,1,1,5,5,5)),to=new T.Mesh(new T.PlaneGeometry(1.2,.8,7,7));to.position.x=.2;
 const original=to.geometry.attributes.position.array.slice(),source=from.geometry.attributes.position.array.slice(),indices=to.geometry.index.array.slice();
 const morph=createSurfaceCorrespondence([from],[to]);
 for(const t of [0,.25,.5,.75,1]){morph.update(t);const top=morph.top(new T.Vector3());assert(top.toArray().every(Number.isFinite));assert.equal(to.material.opacity,1);assert.equal(from.material.opacity,1);assert.equal(to.morphTargetInfluences[0],t);}
 morph.finish();assert.deepEqual(to.geometry.attributes.position.array,original);assert.deepEqual(to.geometry.index.array,indices);assert.deepEqual(from.geometry.attributes.position.array,source);
 for(const mesh of [from,to]){mesh.geometry.dispose();mesh.material.dispose();}
});

test('cone rounds before the torus hole opens',async()=>{
 const {createShapeTargets}=await import('../shape-gate-targets.js');
 const targets=createShapeTargets(32,24),positions=targets.geometry.attributes.position.array;
 for(const [progress,target] of [[0,'Cone'],[.32,'Flattened'],[.68,'Pinched'],[1,'Torus']]){
  targets.coneToTorus(progress);
  assert.deepEqual(positions,targets.positions[target]);
 }
 targets.coneToTorus(.84);
 assert(positions[0]>0&&positions[0]<targets.positions.Torus[0]);
 targets.dispose();
});

test('surface extraction preserves the ring opening and produces an indexed surface with outward normals',async()=>{
 const {createSurfaceExtractor}=await import('../shape-gate-surface.js');
 const n=30,origin=-.8,step=1.6/(n-1),torus=new Float32Array(n**3),sphere=new Float32Array(n**3);
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const px=origin+x*step,py=origin+y*step,pz=origin+z*step,cell=x+n*(y+n*z);
  torus[cell]=Math.hypot(Math.hypot(px,pz)-.43,py)-.195;
  sphere[cell]=Math.hypot(px,py,pz)-.47;
 }
 const extract=createSurfaceExtractor(n,origin,step);
 const ring=new T.Mesh(extract(torus,sphere,0),new T.MeshBasicMaterial());
 const closed=extract(torus,sphere,1),intermediate=extract(torus,sphere,.5);
 const ray=new T.Raycaster(new T.Vector3(0,1,0),new T.Vector3(0,-1,0));
 assert.equal(ray.intersectObject(ring).length,0);
 ring.geometry.dispose();
 ring.geometry=closed;
 assert(ray.intersectObject(ring).length>0,'Outward triangles render on the entry side');
 for(const g of [closed,intermediate]){
  assert(g.index.count>0);
  assert(g.index.array.every(i=>i<g.attributes.position.count));
  assert(g.attributes.position.array.every(Number.isFinite));
  assert(g.attributes.normal.array.every(Number.isFinite));
  g.dispose();
 }
 ring.material.dispose();
});

test('cube morph target keeps every triangle on one flat box face',async()=>{
 const {createShapeTargets}=await import('../shape-gate-targets.js');
 const targets=createShapeTargets(),positions=targets.positions.Cube,index=targets.geometry.index.array;
 for(let i=0;i<index.length;i+=3){
  const onSameFace=[0,1,2].some(axis=>{
   const face=positions[3*index[i]+axis];
   return Math.abs(Math.abs(face)-.625)<1e-6&&
    Math.abs(positions[3*index[i+1]+axis]-face)<1e-6&&
    Math.abs(positions[3*index[i+2]+axis]-face)<1e-6;
  });
  assert(onSameFace,'Cube triangles must not cut across a box edge');
 }
 targets.dispose();
});

test('an intermediate surface keeps both sides when a thin bridge would break',async()=>{
 const {createSurfaceExtractor}=await import('../shape-gate-surface.js');
 const n=36,origin=-.8,step=1.6/(n-1),from=new Float32Array(n**3),to=new Float32Array(n**3);
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const px=origin+x*step,py=origin+y*step,pz=origin+z*step,cell=x+n*(y+n*z);
  const lobes=Math.hypot(Math.abs(px)-.23,py,pz)-.15;
  const bridge=height=>Math.hypot(Math.max(0,Math.abs(px)-.23),py-height,pz)-.046;
  from[cell]=Math.min(lobes,bridge(.13));
  to[cell]=Math.min(lobes,bridge(-.13));
 }
 const geometry=createSurfaceExtractor(n,origin,step)(from,to,.5);
 const position=geometry.attributes.position,neighbors=Array.from({length:position.count},()=>[]);
 geometry.computeBoundingBox();
 assert(geometry.boundingBox.min.x<-.3&&geometry.boundingBox.max.x>.3);
 const indices=geometry.index.array;
 for(let i=0;i<indices.length;i+=3){
  const [a,b,c]=indices.subarray(i,i+3);
  neighbors[a].push(b,c);neighbors[b].push(a,c);neighbors[c].push(a,b);
 }
 const visited=new Set([0]),queue=[0];
 for(let i=0;i<queue.length;i++)for(const next of neighbors[queue[i]])if(!visited.has(next)){visited.add(next);queue.push(next);}
 assert.equal(visited.size,position.count);
 geometry.dispose();
});

test('rope tracks points on the upper surface as two peaks change height',async()=>{
 const {trackSuspension}=await import('../shape-gate-suspension.js');
 const {morphEase}=await import('../shape-gate-motion.js');
 const start=[-.3,.58,0],end=[.3,.58,0];
 const frames=Array.from({length:47},(_,frame)=>{
  const t=morphEase((frame+1)/48),positions=[];
  for(let i=0;i<=36;i++){
   const x=i/60-.3,u=i/36;
   const height=.45+Math.abs(2*u-1)*(.13-.06*(u+t-2*u*t));
   positions.push(x,height,0);
  }
  return {positions};
 });
 trackSuspension(frames,start,end);
 let previous=[0,start[1],0];
 for(let frame=0;frame<frames.length;frame++){
  const {positions,attachment}=frames[frame],t=morphEase((frame+1)/48);
  assert(positions.some((x,i)=>i%3===0&&x===attachment[0]&&positions[i+1]===attachment[1]&&positions[i+2]===attachment[2]));
  const point=[attachment[0]-(start[0]+(end[0]-start[0])*t),attachment[1],attachment[2]];
  assert(Math.hypot(...point.map((x,i)=>x-previous[i]))<.07);
  previous=point;
 }
 assert(Math.hypot(previous[0],previous[1]-end[1],previous[2])<.07);
});

test('near-disk morphs use the ordinary swing and keep changing depths clear',async()=>{
 const {createSwingClearance,gateMotion,morphEase,planNearDiskMorph,swingLength,swingRate}=await import('../shape-gate-motion.js');
 for(const [step,side,sign] of [[0,'front',1],[1,'back',-1]]){
  const samples=Array.from({length:73},(_,i)=>{
   const nearDepth=.10+.76*morphEase(i/72);
   return [[.5,-sign*nearDepth],[-.3,.35*sign],[.54,.08*sign]];
  });
  for(const grow of [true,false]){
   const frames=grow?samples:[...samples].reverse();
   const clearances=frames.map(vertices=>{
    const clearance=createSwingClearance();
    for(const [y,z] of vertices)clearance.add(y,z);
    return clearance.angle[side];
   });
   const plan=planNearDiskMorph(step,clearances);
   assert(plan);
   const halfMid=(step+.5)*Math.PI;
   const startPhase=plan.start*swingRate,endPhase=(plan.start+plan.duration)*swingRate;
   assert(grow?endPhase<halfMid:startPhase>halfMid);
   for(let i=0;i<=240;i++){
    const t=i/240,time=plan.start+plan.duration*t;
    const {swing}=gateMotion(time,.23,.38);
    assert.equal(swing,gateMotion(time).swing,'The morph does not change pendulum speed');
    for(const [y,z] of frames[Math.round(t*72)]){
     const depth=sign*((y-swingLength)*Math.sin(swing)+z*Math.cos(swing));
     assert(depth>=.18-1e-9,'The morph stays clear of the disk face');
    }
   }
  }
 }
});

test('rotating mesh opening preserves an arch notch and clears the model and rope',async()=>{
 const {traceMeshAperture,gateDepth}=await import('../shape-gate-aperture.js');
 const {createProfiledGateShape}=await import('../shape-gate-geometry.js');
 const {gateMotion,swingAmplitude,swingLength,swingPivotHeight,swingRate}=await import('../shape-gate-motion.js');
 const blocks=[
  new T.BoxGeometry(.92,.14,.43).translate(0,.45,0),
  new T.BoxGeometry(.17,.83,.36).translate(-.34,.045,.15),
  new T.BoxGeometry(.17,.83,.36).translate(.34,.045,-.12),
  new T.BoxGeometry(.08,.10,.09).translate(.60,-.38,0)
 ];
 const triangles=Float32Array.from(blocks.flatMap(({attributes:{position},index})=>{
  return Array.from(index.array).flatMap(i=>[position.getX(i),position.getY(i),position.getZ(i)]);
 }));
 const contours=traceMeshAperture(triangles,.52);
 assert.equal(contours.holes.length,1,'Disconnected mesh parts get their own openings');
 const geometry=new T.ExtrudeGeometry(createProfiledGateShape(contours),{
  depth:gateDepth,bevelEnabled:true,bevelThickness:.009,bevelSize:.009,bevelSegments:2
 });
 const plate=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
 plate.position.z=-gateDepth/2;plate.updateMatrixWorld(true);
 const solid=(x,y)=>new T.Raycaster(new T.Vector3(x,y,1),new T.Vector3(0,0,-1)).intersectObject(plate).length>0;
 assert(solid(0,1.4),'The notch between the legs still contains disk material');
 assert(!solid(0,2.55),'The rope slot opens to the rim');
 assert(!solid(.60,1.12),'The separate part has clearance');
 const clearsPlate=(x,y,z)=>{
  const radius=Math.hypot(swingLength-y,z);
  for(const face of [-.069,0,.069]){
   const swing=Math.atan2(z,swingLength-y)-Math.asin(face/radius);
   const crossingY=swingPivotHeight-Math.sqrt(radius*radius-face*face);
   for(const direction of [1,-1]){
    const crossing=direction===1?Math.PI:2*Math.PI;
    const phase=crossing+direction*Math.asin(swing/swingAmplitude);
    const {disk}=gateMotion(phase/swingRate);
    assert(!solid(x*Math.cos(disk)+crossingY*Math.sin(disk),crossingY*Math.cos(disk)-x*Math.sin(disk)),`Pass intersects the opening at ${x},${crossingY}`);
   }
  }
 };
 for(let i=0;i<triangles.length;i+=9){
  for(const [a,b,c] of [[1,0,0],[0,.5,.5],[.25,.25,.5]]){
   const x=a*triangles[i]+b*triangles[i+3]+c*triangles[i+6];
   const y=a*triangles[i+1]+b*triangles[i+4]+c*triangles[i+7];
   const z=a*triangles[i+2]+b*triangles[i+5]+c*triangles[i+8];
   clearsPlate(x,y,z);
  }
 }
 for(let y=.52;y<1.5;y+=.025)for(const x of [-.009,.009])clearsPlate(x,y,0);
 for(const block of blocks)block.dispose();
 geometry.dispose();plate.material.dispose();
});

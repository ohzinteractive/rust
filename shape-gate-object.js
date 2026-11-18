import * as T from 'three';
import {createShapeTargets,geometricShapes} from './shape-gate-targets.js';
import {createSwingClearance,gateMotion,gateTurnClearance,morphEase,phaseForClearance,planNearDiskMorph,swingCenterHeight,swingLength,swingPivotHeight,swingRate} from './shape-gate-motion.js';
import {morphFrames} from './shape-gate-surface.js';
import {findBridgeAttachment,findRoofAttachment} from './shape-gate-suspension.js';
import {createGateRimGeometry,createProfiledGateShape,createSlottedGateShape,gateRimDepth,gateRimRadius} from './shape-gate-geometry.js';
import {cordSlotHalfWidth,crossingRotation,gateBevel,gateDepth,gateRadius} from './shape-gate-aperture.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {createMarbleMaterial,prepareMarbleGeometry} from './kelp-marble.js';
import {createGateBaseSeal,createGateFloor} from './shape-gate-base.js';
import {createGoldMaterial,createGoldReflectionSky} from './shape-gate-gold.js';

const shapeGateModels=[...geometricShapes,'horse','duck','jeddah','glasses','arc de triomphe 3d'];

export function createShapeGate({renderer,scene,includeGround=true,shadowLight,onShape=()=>{},onCycle=()=>{},onStatus=()=>{}}){
 const baseSeal=createGateBaseSeal();
 const gateFloor=createGateFloor({includeGround,reflectionSize:includeGround?640:256});
 const group=new T.Group();
 group.name='Shape Gate';
 group.add(gateFloor.floor,baseSeal.seal);
 const marble=createMarbleMaterial();
 const marbleBounds=new T.Box3(new T.Vector3(-gateRadius,-gateRadius,0),new T.Vector3(gateRadius,gateRadius,gateDepth));
 const goldReflectionTarget=new T.WebGLCubeRenderTarget(includeGround?128:64,{type:T.HalfFloatType});
 const goldReflectionCamera=new T.CubeCamera(.025,includeGround?60:24,goldReflectionTarget);
 const worldToGate=new T.Matrix4();
 const createGold=()=>createGoldMaterial(goldReflectionCamera,worldToGate);
 if(includeGround){
  const reflectionSky=createGoldReflectionSky();
  reflectionSky.layers.set(1);
  goldReflectionCamera.layers.enable(1);
  group.add(reflectionSky);
 }
 const pivot=new T.Group();pivot.position.y=swingPivotHeight;group.add(pivot);const carrier=new T.Group();carrier.position.y=-swingLength;pivot.add(carrier);
 const cordRadius=.009;
 const cord=new T.Mesh(new T.CylinderGeometry(cordRadius,cordRadius,swingLength,8),new T.MeshStandardMaterial({color:0x252923}));cord.position.y=-swingLength/2;pivot.add(cord);
 let fieldWorker=null,apertureTask=null;
 let gate,elapsed=0,cycle=true,revision=0,transition=null,pending=null,automaticRequest=-1,loading=false,sequenceStep=-1;
 const targets=createShapeTargets();let activeShape='Cube';
 let lastBuiltInShape=activeShape;
 const isVertexMorph=(from,to)=>geometricShapes.includes(from)&&geometricShapes.includes(to);
 function hull(points){points.sort((a,b)=>a.x-b.x||a.y-b.y);const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);const half=arr=>{const h=[];for(const p of arr){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};return half(points).slice(0,-1).concat(half([...points].reverse()).slice(0,-1));}
 function prepare(root,model){
  root.updateMatrixWorld(true);const box=new T.Box3().setFromObject(root),center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()),scale=1.25/Math.max(size.x,size.y,size.z,.001),points=geometricShapes.includes(model)?[]:null,meshes=[];
  root.traverse(m=>{if(!m.isMesh)return;const g=m.geometry.clone(),p=g.attributes.position,v=new T.Vector3();m.skeleton?.update();for(let i=0;i<p.count;i++){m.getVertexPosition(i,v).applyMatrix4(m.matrixWorld).sub(center).multiplyScalar(scale);p.setXYZ(i,v.x,v.y,v.z);}g.deleteAttribute('skinIndex');g.deleteAttribute('skinWeight');g.computeVertexNormals();g.computeBoundingSphere();const mesh=new T.Mesh(g,createGold());mesh.castShadow=true;meshes.push(mesh);});
  if(!meshes.some(mesh=>mesh.geometry.attributes.position.count))throw Error('This file has no mesh geometry.');
  // The glasses and Arch use a specific point on the surface.
  let attachment=null;
  if(model==='glasses')attachment=findBridgeAttachment(meshes);
  if(model==='arc de triomphe 3d')attachment=findRoofAttachment(meshes);
  const anchor=attachment??new T.Vector3(0,-Infinity,0);
  if(!attachment){
   for(const mesh of meshes){
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
     const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
     if(y>anchor.y+1e-6||(Math.abs(y-anchor.y)<=1e-6&&x*x+z*z<anchor.x*anchor.x+anchor.z*anchor.z)){
      anchor.set(x,y,z);
     }
    }
   }
  }
  const clearance=createSwingClearance();
  const plateFace=gateDepth/2+gateBevel;
  const pass=createSwingClearance(plateFace+.01);
  for(const mesh of meshes){
   mesh.geometry.translate(-anchor.x,0,-anchor.z);
   const positions=mesh.geometry.attributes.position;
   for(let i=0;i<positions.count;i++){
    const y=positions.getY(i),z=positions.getZ(i);
    if(points){
     const x=positions.getX(i);
     const height=swingPivotHeight-Math.hypot(swingLength-y,z);
     const turn=crossingRotation(y,Math.abs(z));
     const sin=Math.sin(turn),inset=1-Math.cos(turn),margin=gateBevel+.012;
     const dx=height*sin+Math.abs(x)*inset+margin;
     const dy=Math.abs(x)*sin+height*inset+margin;
     points.push(new T.Vector2(x*1.15,y*1.15+swingCenterHeight));
     for(const sign of [-1,1]){
      points.push(new T.Vector2(x+sign*dx,height-dy),new T.Vector2(x+sign*dx,height+dy));
     }
    }
    clearance.add(y,z);
    pass.add(y,z);
   }
  }
  // The cord reaches the rim later than the model on very shallow meshes.
  const ropeTilt=Math.atan2(gateRimDepth/2+cordRadius,swingPivotHeight-gateRimRadius);
  const wheelPass={
   front:phaseForClearance(Math.max(ropeTilt,pass.angle.front)),
   back:phaseForClearance(Math.max(ropeTilt,pass.angle.back))
  };
  const prepared={meshes,top:anchor.y,anchor,clearance:clearance.angle,wheelPass};
  if(points){
   const slotPad=cordSlotHalfWidth+.015,slotY=anchor.y*1.15+swingCenterHeight;
   points.push(new T.Vector2(-slotPad,slotY),new T.Vector2(slotPad,slotY));
   prepared.geometry=extrudeGate(createSlottedGateShape(hull(points).reverse()),gateBevel);
  }
  return prepared;
 }
 function extrudeGate(shape,bevel){
  const geometry=new T.ExtrudeGeometry(shape,{depth:gateDepth,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,steps:1});
  prepareMarbleGeometry(geometry,marbleBounds);
  return geometry;
 }
 function showGateGeometry(geometry){
  if(gate?.geometry===geometry)return;
  if(gate)gate.geometry.dispose();
  else{
   gate=new T.Mesh(geometry,marble);gate.position.z=-gateDepth/2;
   gate.name='Shape Gate wheel';
   gate.castShadow=true;gate.receiveShadow=true;
   const rimGeometry=createGateRimGeometry();
   prepareMarbleGeometry(rimGeometry,marbleBounds);
   const rim=new T.Mesh(rimGeometry,marble);
   rim.castShadow=true;rim.receiveShadow=true;gate.add(rim);
   group.add(gate);
  }
  gate.geometry=geometry;
 }
 function showPrepared(prepared,{reset=false,installOpening=true}={}){
  const previous=[...carrier.children];
  carrier.clear();carrier.add(...prepared.meshes);
  carrier.userData.top=prepared.top;
  carrier.userData.anchor=prepared.anchor;
  carrier.userData.clearance=prepared.clearance;
  carrier.userData.wheelPass=prepared.wheelPass;
  if(installOpening)showGateGeometry(prepared.geometry);
  if(reset)elapsed=0;
  return previous;
 }
 function disposeMeshes(meshes){for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}}
 function cancelPreparation(){
  apertureTask?.cancel();
  if(fieldWorker){fieldWorker.terminate();fieldWorker=null;}
  if(pending){pending.geometry.dispose();disposeMeshes(pending.meshes);pending=null;}
 }
 function flattenTriangles(meshes,xOffset=0,zOffset=0){
  const count=meshes.reduce((total,{geometry})=>total+(geometry.index?.count??geometry.attributes.position.count),0);
  const triangles=new Float32Array(count*3);
  let offset=0;
  for(const {geometry} of meshes){
   const {attributes:{position},index}=geometry;
   const length=index?.count??position.count;
   for(let i=0;i<length;i++){
    const vertex=index?index.getX(i):i;
    triangles[offset++]=position.getX(vertex)+xOffset;
    triangles[offset++]=position.getY(vertex);
    triangles[offset++]=position.getZ(vertex)+zOffset;
   }
  }
  return triangles;
 }

 function measureAperture(prepared){
  const triangles=flattenTriangles(prepared.meshes);
  return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./shape-gate-aperture-worker.js',import.meta.url),{type:'module'});
   const task={cancel:()=>finish(null,new Error('Opening preparation canceled'))};
   apertureTask=task;
   function finish(aperture,error){
    worker.terminate();
    if(apertureTask!==task)return;
    apertureTask=null;
    if(error)reject(error);
    else resolve(aperture);
   }
   worker.onmessage=({data})=>finish(data.aperture,data.error&&new Error(data.error));
   worker.onerror=event=>finish(null,new Error(event.message));
   worker.postMessage({triangles,anchorHeight:prepared.top},[triangles.buffer]);
  });
 }

 function prepareMorphFrames(prepared,request){
  const fromTorus=activeShape==='Torus';
  const from=fromTorus?null:flattenTriangles(carrier.children,carrier.userData.anchor.x,carrier.userData.anchor.z);
  const to=flattenTriangles(prepared.meshes,prepared.anchor.x,prepared.anchor.z);
  const worker=new Worker(new URL('./shape-gate-field-worker.js',import.meta.url),{type:'module'});
  fieldWorker=worker;
  function finish({frames,clearances,error}){
   worker.terminate();
   if(worker!==fieldWorker||request!==revision)return;
   fieldWorker=null;
   if(error||frames?.length!==morphFrames-1||clearances?.length!==frames.length){
    cancelPreparation();
    setCycle(false);
    onStatus('Could not prepare the next morph');
    console.warn('Shape Gate surface preparation failed:',error);
    return;
   }
   prepared.frames=frames;
   prepared.morphClearances=clearances;
   prepared.ready=true;
  }
  worker.onmessage=({data})=>finish(data);
  worker.onerror=event=>finish({error:event.message});
  worker.postMessage({
   fromShape:activeShape,toShape:prepared.value,from,to,
   fromAnchor:carrier.userData.anchor.toArray(),toAnchor:prepared.anchor.toArray()
  },from?[from.buffer,to.buffer]:[to.buffer]);
 }
 function disposeRoot(root){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(m=>{if(m.geometry)geometries.add(m.geometry);for(const mat of [m.material].flat().filter(Boolean)){materials.add(mat);for(const v of Object.values(mat))if(v?.isTexture)textures.add(v);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
 function shapeRoot(name){
  if(name==='Cube')return new T.Mesh(new T.BoxGeometry(1.25,1.25,1.25,2,2,2));
  targets.update(name,name,1);
  return new T.Mesh(targets.geometry.clone());
 }
 async function load(value,url,automatic=false){
  const request=++revision;
  if(automatic)automaticRequest=request;
  if(!automatic)cancelPreparation();
  loading=true;onStatus('Preparing sculpture…');
  let root,prepared;
  try{
   root=geometricShapes.includes(value)?shapeRoot(value):(await new GLTFLoader().loadAsync(url??`./samples/${encodeURIComponent(value)}.glb`)).scene;
   if(request!==revision)return;
   if(automatic&&!cycle)return;
   prepared=prepare(root,value);
   if(!prepared.geometry){
    const contours=await measureAperture(prepared);
    if(request!==revision)return;
    prepared.geometry=extrudeGate(createProfiledGateShape(contours),.009);
   }
   if(automatic){
    const surface=!isVertexMorph(activeShape,value);
    pending={...prepared,value,ready:!surface};
    prepared=null;
    if(surface)prepareMorphFrames(pending,request);
   }else{
    if(transition)disposeStagedMorph();
    transition=null;
    disposeMeshes(showPrepared(prepared,{reset:true}));sequenceStep=-1;activeShape=value;
    prepared=null;
    if(shapeGateModels.includes(activeShape)){
     lastBuiltInShape=activeShape;
     onShape(activeShape);
    }
    onStatus('Drag to orbit · Scroll to zoom');
   }
  }catch(e){
   if(request===revision){cancelPreparation();if(automatic)setCycle(false);onStatus('Could not load model: '+e.message);}
  }finally{
   if(prepared){prepared.geometry?.dispose();disposeMeshes(prepared.meshes);}
   if(root)disposeRoot(root);
   if(request===revision)loading=false;
  }
 }
 function disposeStagedMorph(){
  const {prepared,opening}=transition;
  if(gate.geometry!==opening)opening.dispose();
  if(prepared)disposeMeshes(prepared.meshes);
  transition=null;
 }
 const highest=new T.Vector3();
 function highestPoint(positions){
  highest.set(0,-Infinity,0);
  let distance=Infinity;
  for(let i=0;i<positions.length;i+=3){
   const x=positions[i],y=positions[i+1],z=positions[i+2],d=x*x+z*z;
   if(y>highest.y+1e-6||(Math.abs(y-highest.y)<=1e-6&&d<distance)){
    highest.set(x,y,z);distance=d;
   }
  }
  return highest;
 }

 const sampledPositions=new Float32Array(targets.positions.Cube.length);
 function primitiveClearances(from,to){
  const clearances=[];
  for(let i=1;i<morphFrames;i++){
   const clearance=createSwingClearance();
   targets.sampleMorph(from,to,i/morphFrames,sampledPositions);
   const offset=highestPoint(sampledPositions).z;
   for(let j=0;j<sampledPositions.length;j+=3){
    clearance.add(sampledPositions[j+1],sampledPositions[j+2]-offset);
   }
   clearances.push(clearance.angle);
  }
  return clearances;
 }
 const ropeEnd=new T.Vector3(),ropeAxis=new T.Vector3(0,1,0);
 function ropeSurface(){
  if(!transition?.mesh?.visible){
   const length=swingLength-(carrier.userData.top??0);
   cord.scale.y=length/swingLength;cord.position.set(0,-length/2,0);cord.quaternion.identity();return;
  }
  const mesh=transition.mesh;
  if(transition.attachment){
   const [x,y,z]=transition.attachment;
   ropeEnd.set(x+mesh.position.x,y-swingLength,z+mesh.position.z);
  }else{
   const p=mesh.geometry.attributes.position;
   let best=-Infinity,distance=Infinity;
   for(let i=0;i<p.count;i++){
    const x=p.getX(i)+mesh.position.x,y=p.getY(i),z=p.getZ(i)+mesh.position.z;
    const d=x*x+z*z;
    if(y>best+1e-6||(Math.abs(y-best)<=1e-6&&d<distance)){
     best=y;distance=d;ropeEnd.set(x,y-swingLength,z);
    }
   }
  }
  const length=ropeEnd.length();
  cord.scale.y=length/swingLength;
  cord.position.copy(ropeEnd).multiplyScalar(.5);
  cord.quaternion.setFromUnitVectors(ropeAxis,ropeEnd.multiplyScalar(-1/length));
 }
 function sceneMotion(time=elapsed){
  const step=Math.floor(time*swingRate/Math.PI);
  if(transition?.timing.step===step){
   const {departurePass,returnPass}=transition;
   return gateMotion(time,returnPass,departurePass);
  }
  const side=step%2===0?'front':'back';
  const pass=carrier.userData.wheelPass?.[side]??gateTurnClearance;
  return gateMotion(time,pass,pass);
 }

 function startMorph(){
  const {prepared,from,to}=transition;
  const geometry=prepared.frames?new T.BufferGeometry():targets.geometry.clone();
  const mesh=new T.Mesh(geometry,createGold());
  mesh.castShadow=true;
  mesh.frustumCulled=!prepared.frames;
  mesh.visible=false;
  transition.mesh=mesh;
  transition.source=[...carrier.children];
  transition.anchor=carrier.userData.anchor;
  carrier.add(mesh);
  onStatus(from+' → '+to);
 }

 function updateMorph(progress){
  const {prepared,mesh,source,from,to}=transition;
  if(prepared.frames){
   const frame=Math.round(progress*morphFrames);
   if(frame===0||frame>=morphFrames||frame===transition.lastFrame)return;
   const {positions,normals,indices,attachment}=prepared.frames[frame-1];
   const geometry=new T.BufferGeometry();
   geometry.setAttribute('position',new T.BufferAttribute(positions,3));
   geometry.setAttribute('normal',new T.BufferAttribute(normals,3));
   geometry.setIndex(new T.BufferAttribute(indices,1));
   mesh.geometry.dispose();mesh.geometry=geometry;
   const frameEase=morphEase(frame/morphFrames);
   mesh.position.x=-T.MathUtils.lerp(transition.anchor.x,prepared.anchor.x,frameEase);
   mesh.position.z=-T.MathUtils.lerp(transition.anchor.z,prepared.anchor.z,frameEase);
   transition.attachment=attachment;
   transition.lastFrame=frame;
  }else{
   targets.morph(from,to,progress);
   const position=targets.geometry.attributes.position.array;
   mesh.geometry.attributes.position.array.set(position);
   mesh.geometry.attributes.position.needsUpdate=true;
   mesh.geometry.attributes.normal.array.set(targets.geometry.attributes.normal.array);
   mesh.geometry.attributes.normal.needsUpdate=true;
   mesh.geometry.boundingSphere.copy(targets.geometry.boundingSphere);
   const top=highestPoint(position);
   mesh.position.set(-top.x,0,-top.z);
  }
  for(const original of source)original.visible=false;
  mesh.visible=true;
 }

 function setCycle(enabled){
  cycle=enabled;
  onCycle(enabled);
  if(enabled)return;
  if(pending||(loading&&automaticRequest===revision)){
   revision++;cancelPreparation();loading=false;onStatus('Drag to orbit · Scroll to zoom');
  }
  // A staged change can still be canceled before the disk starts its turn.
  if(transition?.prepared&&!transition.mesh&&elapsed*swingRate%Math.PI<=transition.departurePass)disposeStagedMorph();
 }

 const cameraPosition=new T.Vector3();
 function sequence(previousElapsed,camera){
  const phase=elapsed*swingRate,step=Math.floor(phase/Math.PI),part=phase-step*Math.PI;
  if(transition&&transition.timing.step!==step)transition=null;

  if(cycle&&!loading&&!pending&&!transition&&sequenceStep!==step){
   sequenceStep=step;
   const next=(shapeGateModels.indexOf(lastBuiltInShape)+1)%shapeGateModels.length;
   load(shapeGateModels[next],undefined,true);
  }
  // The return timing can change during slow departure or on the first
  // frame of a half swing, when there is no earlier angle to preserve.
  const {z}=cameraPosition.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(worldToGate);
  const towardViewer=Math.abs(z)<.5||(z>0)===(step%2===0);
  const side=step%2===0?'front':'back';
  const departurePass=carrier.userData.wheelPass?.[side]??gateTurnClearance;
  const firstFrame=previousElapsed*swingRate<step*Math.PI;
  if(pending?.ready&&cycle&&!transition&&towardViewer&&(firstFrame||part<=departurePass)){
   const from=activeShape,to=pending.value,prepared=pending;
   const meshClearances=prepared.morphClearances??primitiveClearances(from,to);
   const clearances=[carrier.userData.clearance[side],...meshClearances.map(sample=>sample[side]),prepared.clearance[side]];
   const timing=planNearDiskMorph(step,clearances,elapsed);
   if(timing){
    transition={from,to,prepared,opening:prepared.geometry,timing,departurePass,returnPass:prepared.wheelPass[side]};
    pending=null;
    sequenceStep=step;
   }
  }
  if(transition){
   if(sceneMotion().disk>=(step*2+1)*Math.PI)showGateGeometry(transition.opening);
   if(transition.prepared){
    const {start,duration}=transition.timing;
    const progress=(elapsed-start)/duration;
    if(progress>=1-1e-9){
     // On departure the new model is ready before the disk turns. Keep
     // the old opening until the turn conceals the cutout change.
     disposeMeshes(showPrepared(transition.prepared,{installOpening:false}));
     activeShape=transition.to;
    lastBuiltInShape=activeShape;
     onShape(activeShape);
     transition.prepared=null;
     transition.mesh=null;
     transition.source=null;
    }else if(progress>0){
     if(!transition.mesh)startMorph();
     updateMorph(progress);
    }
   }
  }
  ropeSurface();
 }

 function captureGoldReflection(){
  // Follow the carrier's position in world axes so the reflected room stays fixed.
  carrier.getWorldPosition(goldReflectionCamera.position);
  const visible=carrier.visible;
  const {autoUpdate,needsUpdate}=renderer.shadowMap;
  carrier.visible=false;
  renderer.shadowMap.autoUpdate=false;
  renderer.shadowMap.needsUpdate=!!shadowLight&&!shadowLight.shadow.map;
  try{
   goldReflectionCamera.update(renderer,scene);
  }finally{
   carrier.visible=visible;
   renderer.shadowMap.autoUpdate=autoUpdate;
   renderer.shadowMap.needsUpdate=needsUpdate;
  }
 }

 function advance(dt,camera,speed=1){
  const previousElapsed=elapsed;
  elapsed+=dt*speed;
  group.updateWorldMatrix(true,false);
  worldToGate.copy(group.matrixWorld).invert();
  camera.updateWorldMatrix(true,false);
  sequence(previousElapsed,camera);
  const motion=sceneMotion();
  pivot.rotation.x=motion.swing;
  if(gate){
   gate.rotation.z=motion.disk;
   baseSeal.update(gate,dt);
  }
 }

 load('Cube');
 return {group,advance,captureGoldReflection,load,setCycle,resizeFloor:gateFloor.resize,halfSize:gateFloor.halfSize,setPlatformHeight:gateFloor.setPlatformHeight};
}

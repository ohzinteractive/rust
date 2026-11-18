import {createSurfaceExtractor, cubeDistanceField, gridSize, gridOrigin, gridStep, meshDistanceField, morphFrames, torusDistanceField} from './shape-gate-surface.js';
import {createSwingClearance, morphEase} from './shape-gate-motion.js';
import {trackSuspension} from './shape-gate-suspension.js';

self.onmessage=({data})=>{
 try{
  const field=(triangles,name)=>{
   if(name==='Cube')return cubeDistanceField();
   // The glasses and tower contain surfaces thinner than one grid cell.
   const shell=name==='glasses'?.82:name==='jeddah'?.74:.28;
   return meshDistanceField(triangles,gridSize,gridOrigin,gridStep,shell);
  };
  const from=data.fromShape==='Torus'?torusDistanceField():field(data.from,data.fromShape);
  const to=field(data.to,data.toShape);
  const profile={
   turnTower:data.fromShape==='jeddah'&&data.toShape==='glasses',
   preferUpper:data.fromShape==='glasses'&&data.toShape==='arc de triomphe 3d',
   reinforceNeck:data.fromShape==='Torus'&&data.toShape==='horse'
  };
  const extract=createSurfaceExtractor(),frames=[],buffers=[];
  const clearances=[];
  for(let frame=1;frame<morphFrames;frame++){
   const t=frame/morphFrames;
   const eased=morphEase(t);
   const geometry=extract(from,to,eased,profile);
   const positions=geometry.attributes.position.array,normals=geometry.attributes.normal.array,indices=geometry.index.array;
   if(!indices.length)throw new Error('Empty morph surface at frame '+frame);
   const clearance=createSwingClearance();
   const zOffset=data.fromAnchor[2]+(data.toAnchor[2]-data.fromAnchor[2])*eased;
   for(let i=0;i<positions.length;i+=3){
    clearance.add(positions[i+1],positions[i+2]-zOffset);
   }
   clearances.push(clearance.angle);
   frames.push({positions,normals,indices});
   buffers.push(positions.buffer,normals.buffer,indices.buffer);
  }
  trackSuspension(frames,data.fromAnchor,data.toAnchor);
  self.postMessage({frames,clearances},buffers);
 }catch(error){
  self.postMessage({error:error.message});
 }
};

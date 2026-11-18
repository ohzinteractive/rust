import * as T from './vendor/three.module.js';
import {mapSurfaces} from './shape-gate-correspondence.js';

function restore({positions,index,offset}){
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.BufferAttribute(positions,3));
 if(index)geometry.setIndex(new T.BufferAttribute(index,1));
 return {geometry,position:new T.Vector3(...offset)};
}

self.onmessage=({data})=>{
 try{
  const maps=mapSurfaces(data.from.map(restore),data.to.map(restore));
  self.postMessage({maps},maps.flatMap(({mapped,mappedNormal})=>[mapped.buffer,mappedNormal.buffer]));
 }catch(error){
  self.postMessage({error:error.message});
 }
};

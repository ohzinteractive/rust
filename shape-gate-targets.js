import * as T from 'three';
import {morphEase} from './shape-gate-motion.js';

export const geometricShapes=['Cube','Sphere','Cone','Torus'];
// One indexed surface, shared by every target. Collapsed pole rings let a
// sphere open into a torus without rebuilding or discarding triangles.
export function createShapeTargets(segments=96,rings=64){
 const ringTilt=Math.PI/3,cosTilt=Math.cos(ringTilt),sinTilt=Math.sin(ringTilt);
 const positions=Object.fromEntries([...geometricShapes,"Flattened","Pinched"].map(name=>[name,new Float32Array((segments+1)*(rings+1)*3)])),indices=[];
 for(let j=0;j<=rings;j++)for(let i=0;i<=segments;i++){
  const u=i/segments*Math.PI*2,v=j/rings*Math.PI,dx=Math.sin(v)*Math.cos(u),dy=Math.cos(v),dz=Math.sin(v)*Math.sin(u),k=(j*(segments+1)+i)*3;
  // Put a complete row on each horizontal box edge. The row moves with
  // longitude so faces never straddle a corner during the primitive morph.
  const faceBoundary=Math.atan(1/Math.max(Math.abs(Math.cos(u)),Math.abs(Math.sin(u))));
  const q=v<=Math.PI/2?v:Math.PI-v;
  const boxAngle=q<=Math.PI/4
   ?q/(Math.PI/4)*faceBoundary
   :faceBoundary+(q-Math.PI/4)/(Math.PI/4)*(Math.PI/2-faceBoundary);
  const boxX=Math.sin(boxAngle)*Math.cos(u),boxZ=Math.sin(boxAngle)*Math.sin(u);
  const boxY=Math.cos(boxAngle)*(v<=Math.PI/2?1:-1);
  const boxScale=.625/Math.max(Math.abs(boxX),Math.abs(boxY),Math.abs(boxZ));
  positions.Cube.set([boxX*boxScale,boxY*boxScale,boxZ*boxScale],k);
  positions.Sphere.set([dx*.625,dy*.625,dz*.625],k);
  const den=Math.hypot(dx,dz)+.5*dy,side=den>1e-9?.3125/den:Infinity,bottom=dy<0?-.625/dy:Infinity,cone=Math.min(side,bottom);
  positions.Cone.set([dx*cone,dy*cone,dz*cone],k);
  // The meridian begins inside the ring, so the poles meet at the
  // hole rather than wrapping around the outside of the torus.
  const tube=j/rings*Math.PI*2,r=.43-.195*Math.cos(tube);
  const ringY=.195*Math.sin(tube),ringZ=r*Math.sin(u);
  positions.Torus.set([r*Math.cos(u),ringY*cosTilt-ringZ*sinTilt,ringY*sinTilt+ringZ*cosTilt],k);
  positions.Flattened.set([dx*.61,dy*.31,dz*.61],k);
  const pinched=.31*(1-Math.cos(tube));
  const pinchTilt=ringTilt*.65,cy=Math.cos(pinchTilt),sy=Math.sin(pinchTilt);
  const pinchY=.234*Math.sin(tube),pinchZ=pinched*Math.sin(u);
  positions.Pinched.set([pinched*Math.cos(u),pinchY*cy-pinchZ*sy,pinchY*sy+pinchZ*cy],k);
  if(i<segments&&j<rings){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,b,a+1,b+1);}
 }
 const geometry=new T.BufferGeometry();geometry.setIndex(indices);geometry.setAttribute('position',new T.BufferAttribute(positions.Cube.slice(),3).setUsage(T.DynamicDrawUsage));
 let current='Cube';
 const output=geometry.attributes.position;
 function blend(from,to,t,result){
  const a=positions[from],b=positions[to];
  if(!a||!b)throw Error('Unknown geometric morph target');
  t=T.MathUtils.clamp(t,0,1);
  if(t===0||t===1)result.set(t===0?a:b);
  else for(let i=0;i<a.length;i++)result[i]=a[i]+(b[i]-a[i])*t;
 }
 function sampleMorph(from,to,progress,result){
  if(from==='Cone'&&to==='Torus'){
   // Round the cone, bring the poles together, then open the hole.
   const landmarks=['Cone','Flattened','Pinched','Torus'],breaks=[0,.32,.68,1];
   const leg=progress<breaks[1]?0:progress<breaks[2]?1:2;
   const t=(progress-breaks[leg])/(breaks[leg+1]-breaks[leg]);
   blend(landmarks[leg],landmarks[leg+1],t*t*(3-2*t),result);
  }else blend(from,to,morphEase(progress),result);
 }
 function refresh(){
  output.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
 }
 return {
  geometry,positions,sampleMorph,
  get current(){return current;},
  morph(from,to,progress){
   sampleMorph(from,to,progress,output.array);
   refresh();
   if(progress===1)current=to;
  },
  coneToTorus(progress){this.morph('Cone','Torus',progress);},
  update(from,to,t){
   blend(from,to,t,output.array);
   refresh();
   if(t===1)current=to;
  },
  dispose(){geometry.dispose();}
 };
}

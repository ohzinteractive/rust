import {Vector3} from './vendor/three.module.js';
import {morphEase} from './shape-gate-motion.js';

// The center plane intersects the real nose bridge between the lenses.
// Use a triangle edge intersection so the attachment is actually on the
// frame even if the GLB has no vertex at its exact center.
export function findBridgeAttachment(meshes){
 let attachment=null;
 function consider(y,z){
  if(!attachment||y>attachment.y||(y===attachment.y&&Math.abs(z)<Math.abs(attachment.z))){
   attachment=new Vector3(0,y,z);
  }
 }
 for(const mesh of meshes){
  const {attributes:{position},index}=mesh.geometry;
  const count=index?.count??position.count;
  for(let i=0;i<count;i+=3){
   const a=index?index.getX(i):i;
   const b=index?index.getX(i+1):i+1;
   const c=index?index.getX(i+2):i+2;
   const ax=position.getX(a),bx=position.getX(b),cx=position.getX(c);
   if(Math.min(ax,bx,cx)>0||Math.max(ax,bx,cx)<0)continue;
   intersectEdge(a,b,ax,bx);
   intersectEdge(b,c,bx,cx);
   intersectEdge(c,a,cx,ax);
  }
  function intersectEdge(a,b,ax,bx){
   if(ax===0)consider(position.getY(a),position.getZ(a));
   if(ax*bx>=0)return;
   const t=ax/(ax-bx),ay=position.getY(a),az=position.getZ(a);
   consider(ay+(position.getY(b)-ay)*t,az+(position.getZ(b)-az)*t);
  }
 }
 return attachment;
}

// Cast straight down through the normalized model's center. Projecting
// the triangles onto the floor finds the roof height at that exact point.
export function findRoofAttachment(meshes){
 let height=-Infinity;
 for(const mesh of meshes){
  const {attributes:{position},index}=mesh.geometry;
  const count=index?.count??position.count;
  for(let i=0;i<count;i+=3){
   const a=index?index.getX(i):i;
   const b=index?index.getX(i+1):i+1;
   const c=index?index.getX(i+2):i+2;
   const ax=position.getX(a),bx=position.getX(b),cx=position.getX(c);
   if(Math.min(ax,bx,cx)>0||Math.max(ax,bx,cx)<0)continue;
   const az=position.getZ(a),bz=position.getZ(b),cz=position.getZ(c);
   const wa=bx*cz-cx*bz,wb=cx*az-ax*cz,wc=ax*bz-bx*az;
   if(Math.min(wa,wb,wc)<0&&Math.max(wa,wb,wc)>0)continue;
   const area=wa+wb+wc;
   if(Math.abs(area)<1e-12)continue;
   const y=(wa*position.getY(a)+wb*position.getY(b)+wc*position.getY(c))/area;
   height=Math.max(height,y);
  }
 }
 return Number.isFinite(height)?new Vector3(0,height,0):null;
}

function upperSurface(positions){
 let top=-Infinity;
 for(let i=1;i<positions.length;i+=3)top=Math.max(top,positions[i]);
 const columns=new Map(),spacing=.045;
 for(let i=0;i<positions.length;i+=3){
  const x=positions[i],y=positions[i+1],z=positions[i+2];
  if(y<top-.23)continue;
  const column=Math.round(x/spacing)+65*Math.round(z/spacing);
  const previous=columns.get(column);
  if(!previous||y>previous[1])columns.set(column,[x,y,z]);
 }
 return {top,points:[...columns.values()]};
}

// Pick actual upper-surface points across the whole transition. Looking
// ahead keeps the rope on the same feature until it can move smoothly toward
// the target attachment, even when two peaks trade places.
export function trackSuspension(frames,fromAnchor,toAnchor){
 const start={points:[{local:[0,fromAnchor[1],0],cost:0,previous:-1}]};
 const layers=[start];
 for(let frame=0;frame<=frames.length;frame++){
  const last=frame===frames.length;
  const progress=morphEase((frame+1)/(frames.length+1));
  const offsetX=fromAnchor[0]+(toAnchor[0]-fromAnchor[0])*progress;
  const offsetZ=fromAnchor[2]+(toAnchor[2]-fromAnchor[2])*progress;
  const {top,points}=last?{top:toAnchor[1],points:[toAnchor]}:upperSurface(frames[frame].positions);
  const previous=layers.at(-1).points;
  const next=points.map(surface=>{
   const [x,y,z]=surface,local=[x-offsetX,y,z-offsetZ];
   let best=Infinity,prior=-1;
   for(let i=0;i<previous.length;i++){
    const a=previous[i];
    const dx=local[0]-a.local[0],dy=local[1]-a.local[1],dz=local[2]-a.local[2];
    const change=dx*dx+dy*dy+dz*dz;
    const jump=Math.max(0,Math.sqrt(change)-.048);
    const cost=a.cost+42*change+1600*jump*jump;
    if(cost<best){best=cost;prior=i;}
   }
   const heightLoss=top-y;
   const cost=best+2*heightLoss*heightLoss+.3*(local[0]**2+local[2]**2);
   return {surface,local,cost,previous:prior};
  });
  layers.push({points:next});
 }
 let current=layers.at(-1).points[0].previous;
 for(let frame=frames.length-1;frame>=0;frame--){
  const point=layers[frame+1].points[current];
  frames[frame].attachment=point.surface;
  current=point.previous;
 }
}

import {MathUtils} from './vendor/three.module.js';

// Work on the solid samples before meshing. This adds short, rounded
// connections at constrictions where interpolating the fields breaks a neck.
export function createSurfaceConnector(size, spacing){
 const slice=size*size;
 const labels=new Int32Array(size*slice),queue=new Int32Array(labels.length);
 const neighbors=[-1,1,-size,size,-slice,slice];
 const coordinate=index=>[index%size,Math.floor(index/size)%size,Math.floor(index/slice)];
 const index=(x,y,z)=>x+size*y+slice*z;

 function regions(values,threshold){
  labels.fill(0);
  const components=[];
  let label=0;
  for(let i=0;i<values.length;i++){
   if(labels[i]||!(values[i]<threshold))continue;
   label++;
   labels[i]=label;queue[0]=i;
   const edge=[];
   let length=1;
   for(let cursor=0;cursor<length;cursor++){
    const cell=queue[cursor];
    let boundary=false;
    for(const offset of neighbors){
     const next=cell+offset;
     if(!(values[next]<threshold)){boundary=true;continue;}
     if(labels[next])continue;
     labels[next]=label;queue[length++]=next;
    }
    if(boundary)edge.push(cell);
   }
   components.push({length,edge});
  }
  return components.sort((a,b)=>b.length-a.length);
 }

 function samples(edge){
  // Bound the cost even on disconnected parts of a detailed model.
  const stride=Math.max(1,Math.ceil(edge.length/340));
  const points=[];
  for(let i=0;i<edge.length;i+=stride)points.push(coordinate(edge[i]));
  return points;
 }

 function closestGap(a,b,values,upper){
  let bestCost=Infinity,start,end;
  for(const p of a)for(const q of b){
   const dx=q[0]-p[0],dy=q[1]-p[1],dz=q[2]-p[2];
   const distance=dx*dx+dy*dy+dz*dz;
   if(distance>=bestCost)continue;
   const midpoint=index(Math.round((p[0]+q[0])/2),Math.round((p[1]+q[1])/2),Math.round((p[2]+q[2])/2));
   const clearance=Math.max(0,values[midpoint])/spacing;
   const roof=upper?Math.max(0,upper-Math.min(p[1],q[1])):0;
   const cost=distance+.8*clearance*clearance+.7*roof*roof;
   if(cost<bestCost){bestCost=cost;start=p;end=q;}
  }
  return {start,end,cost:bestCost};
 }

 function bridge(values,start,end,radius){
  const direction=end.map((value,i)=>value-start[i]);
  const lengthSquared=direction.reduce((sum,value)=>sum+value*value,0);
  const smoothing=spacing*1.65,padding=Math.ceil(radius+smoothing/spacing);
  const min=start.map((value,i)=>Math.max(1,Math.min(value,end[i])-padding));
  const max=start.map((value,i)=>Math.min(size-2,Math.max(value,end[i])+padding));
  for(let z=min[2];z<=max[2];z++)for(let y=min[1];y<=max[1];y++)for(let x=min[0];x<=max[0];x++){
   const dx=x-start[0],dy=y-start[1],dz=z-start[2];
   const t=MathUtils.clamp((dx*direction[0]+dy*direction[1]+dz*direction[2])/lengthSquared,0,1);
   const field=(Math.hypot(dx-direction[0]*t,dy-direction[1]*t,dz-direction[2]*t)-radius)*spacing;
   const cell=index(x,y,z),old=values[cell];
   const overlap=Math.max(0,smoothing-Math.abs(old-field))/smoothing;
   values[cell]=Math.min(old,field)-overlap*overlap*smoothing*.25;
  }
 }

 function connect(values,components,preferUpper,neckStrength){
  if(components.length<2)return;
  const main=components[0];
  // Very small flecks fall away during surface extraction. The remaining
  // parts can connect to any region already attached to the main body.
  const meaningful=neckStrength>0?Math.max(35,main.length*.045):Math.max(16,main.length*.012);
  const connected=[samples(main.edge)];
  for(const component of components.slice(1)){
   if(component.length<meaningful)break;
   const points=samples(component.edge);
   const upper=preferUpper
    ?points.reduce((y,point)=>Math.max(y,point[1]),0)-3
    :0;
   let closest={cost:Infinity};
   for(const prior of connected){
    const gap=closestGap(prior,points,values,upper);
    if(gap.cost<closest.cost)closest=gap;
   }
   if(!closest.start)continue;
   const distance=Math.hypot(...closest.start.map((value,i)=>value-closest.end[i]));
   // A distant fleck is a sampling artifact. Do not pull a long strand
   // toward it unless it is a substantial part of the evolving shape.
   if(distance*spacing>.24&&(neckStrength>0||component.length<main.length*.045))continue;
   const radius=MathUtils.clamp(1.6+.26*Math.sqrt(distance),1.8,3.2)+neckStrength;
   bridge(values,closest.start,closest.end,radius);
   connected.push(points);
  }
 }

 return (values,{preferUpper=false,neckStrength=0}={})=>{
  connect(values,regions(values,0),preferUpper,0);
  // A section can still be connected by a single sample. Look at the
  // deeper core to spot those pinches before they look like two objects.
  if(neckStrength>.25){
   const core=regions(values,-spacing*neckStrength);
   connect(values,core,preferUpper,neckStrength);
  }
 };
}

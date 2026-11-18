import * as THREE from './vendor/three.module.js';
import {createSurfaceConnector} from './shape-gate-surface-connectivity.js';

export const gridSize = 80;
export const gridOrigin = -.8;
export const gridStep = 1.6 / (gridSize - 1);
export const morphFrames = 72;

export function torusDistanceField(){
 const field=new Float32Array(gridSize**3);
 const tilt=Math.PI/3,cos=Math.cos(tilt),sin=Math.sin(tilt);
 for(let z=0;z<gridSize;z++)for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){
  const px=gridOrigin+x*gridStep,py=gridOrigin+y*gridStep,pz=gridOrigin+z*gridStep;
  const height=cos*py+sin*pz,radial=Math.hypot(px,-sin*py+cos*pz);
  field[x+gridSize*(y+gridSize*z)]=Math.min(.45,Math.hypot(radial-.43,height)-.195);
 }
 return field;
}

export function cubeDistanceField(){
 const field=new Float32Array(gridSize**3);
 for(let z=0;z<gridSize;z++)for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){
  const dx=Math.abs(gridOrigin+x*gridStep)-.625;
  const dy=Math.abs(gridOrigin+y*gridStep)-.625;
  const dz=Math.abs(gridOrigin+z*gridStep)-.625;
  field[x+gridSize*(y+gridSize*z)]=Math.hypot(Math.max(0,dx),Math.max(0,dy),Math.max(0,dz))+Math.min(0,Math.max(dx,dy,dz));
 }
 return field;
}

// Vote across all three scan directions. An odd number of crossings marks
// an open scanline, so an opening in a mesh cannot fill a whole row of space.
function interior(triangles, n, origin, step){
 const votes = new Uint8Array(n ** 3);
 const pitch = [1, n, n * n];
 for(let axis = 0; axis < 3; axis++){
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const rays = Array.from({length:n * n}, () => []);
  for(let i = 0; i < triangles.length; i += 9){
   const a = i, b = i + 3, c = i + 6;
   const bu = triangles[b+u]-triangles[a+u], bv = triangles[b+v]-triangles[a+v];
   const cu = triangles[c+u]-triangles[a+u], cv = triangles[c+v]-triangles[a+v];
   const determinant = bu*cv-bv*cu;
   if(Math.abs(determinant) < 1e-12)continue;
   const loU = Math.max(0, Math.ceil((Math.min(triangles[a+u],triangles[b+u],triangles[c+u])-origin)/step));
   const hiU = Math.min(n-1, Math.floor((Math.max(triangles[a+u],triangles[b+u],triangles[c+u])-origin)/step));
   const loV = Math.max(0, Math.ceil((Math.min(triangles[a+v],triangles[b+v],triangles[c+v])-origin)/step));
   const hiV = Math.min(n-1, Math.floor((Math.max(triangles[a+v],triangles[b+v],triangles[c+v])-origin)/step));
   for(let j=loV;j<=hiV;j++)for(let k=loU;k<=hiU;k++){
    const du=origin+k*step+1e-8-triangles[a+u],dv=origin+j*step+2e-8-triangles[a+v];
    const s=(du*cv-dv*cu)/determinant,t=(bu*dv-bv*du)/determinant;
    if(s>=0&&t>=0&&s+t<=1){
     rays[k+n*j].push(triangles[a+axis]+s*(triangles[b+axis]-triangles[a+axis])+t*(triangles[c+axis]-triangles[a+axis]));
    }
   }
  }
  for(let j=0;j<n;j++)for(let k=0;k<n;k++){
   const ray=rays[k+n*j].sort((a,b)=>a-b);
   const hits=ray.filter((x,i)=>i===0||x-ray[i-1]>1e-6);
   if(hits.length%2)continue;
   const row=k*pitch[u]+j*pitch[v];
   for(let h=0;h<hits.length;h+=2){
    const first=Math.max(0,Math.ceil((hits[h]-origin)/step));
    const last=Math.min(n-1,Math.floor((hits[h+1]-origin)/step));
    for(let i=first;i<=last;i++)votes[row+i*pitch[axis]]++;
   }
  }
 }
 return votes;
}

export function meshDistanceField(triangles,n=gridSize,origin=gridOrigin,step=gridStep,shell=.28){
 const votes=interior(triangles,n,origin,step);
 const distances=new Float32Array(n**3).fill(Infinity);
 const triangle=new THREE.Triangle(), point=new THREE.Vector3(), nearest=new THREE.Vector3(),box=new THREE.Box3();
 const padding=step*2.5;
 for(let i=0;i<triangles.length;i+=9){
  triangle.a.fromArray(triangles,i);triangle.b.fromArray(triangles,i+3);triangle.c.fromArray(triangles,i+6);
  box.makeEmpty().expandByPoint(triangle.a).expandByPoint(triangle.b).expandByPoint(triangle.c).expandByScalar(padding);
  const x0=Math.max(0,Math.ceil((box.min.x-origin)/step)),x1=Math.min(n-1,Math.floor((box.max.x-origin)/step));
  const y0=Math.max(0,Math.ceil((box.min.y-origin)/step)),y1=Math.min(n-1,Math.floor((box.max.y-origin)/step));
  const z0=Math.max(0,Math.ceil((box.min.z-origin)/step)),z1=Math.min(n-1,Math.floor((box.max.z-origin)/step));
  for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   point.set(origin+x*step,origin+y*step,origin+z*step);
   const distance=triangle.closestPointToPoint(point,nearest).distanceToSquared(point),cell=x+n*(y+n*z);
   if(distance<distances[cell])distances[cell]=distance;
  }
 }
 for(let i=0;i<distances.length;i++)distances[i]=Math.sqrt(distances[i]);
 // Propagate from exact distances near each triangle. The Euclidean
 // neighbor weights keep the interpolated surface round away from details.
 const offsets=[];
 for(let z=-1;z<=0;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
  if(z<0||y<0||(y===0&&x<0))offsets.push([x+n*(y+n*z),step*Math.hypot(x,y,z)]);
 }
 for(const direction of [1,-1]){
  for(let z=1;z<n-1;z++)for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
   const i=direction===1?x+n*(y+n*z):n**3-1-(x+n*(y+n*z));
   let best=distances[i];
   for(const [offset,cost] of offsets)best=Math.min(best,distances[i+direction*offset]+cost);
   distances[i]=best;
  }
 }
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=x+n*(y+n*z),edge=x===0||y===0||z===0||x===n-1||y===n-1||z===n-1;
  // A thin shell covers open or subcell features. A bounded signed field
  // ensures the interpolation cannot pull long spikes from empty space.
  const d=Math.min(.45,distances[i]);
  distances[i]=edge? .45 : votes[i]>=2? -d : d-step*shell;
 }
 const dilated=distances.slice(),closed=distances.slice();
 const neighbors=[1,-1,n,-n,n*n,-n*n];
 // Weld one-cell gaps between nearby sheets, such as the horse's stepped
 // base, before blending. Leave the original endpoint meshes untouched.
 for(let z=1;z<n-1;z++)for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
  const i=x+n*(y+n*z);
  if(Math.abs(distances[i])>step*3)continue;
  let value=distances[i];
  for(const offset of neighbors)value=Math.min(value,distances[i+offset]);
  dilated[i]=value;
 }
 for(let z=1;z<n-1;z++)for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
  const i=x+n*(y+n*z);
  if(Math.abs(distances[i])>step*2)continue;
  let value=dilated[i];
  for(const offset of neighbors)value=Math.max(value,dilated[i+offset]);
  closed[i]=value;
 }
 for(let z=1;z<n-1;z++)for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
  const i=x+n*(y+n*z);
  if(Math.abs(distances[i])>step*1.5)continue;
  let value=closed[i]*4;
  for(const offset of neighbors)value+=closed[i+offset];
  distances[i]=value/10;
 }
 return distances;
}

const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];

// Surface nets share vertices between neighboring cells, so the mesh
// stays watertight even when a hole closes or new features branch out.
export function createSurfaceExtractor(n=gridSize,origin=gridOrigin,step=gridStep){
 const cellVertices=new Int32Array(n**3);
 const connect=createSurfaceConnector(n,step);
 const offsets=corners.map(([x,y,z])=>x+n*(y+n*z));
 const pitch=[1,n,n*n];
 const histogram=new Uint32Array(1024),binSize=.9/histogram.length;
 let previousFrom,previousTo,fromRadius,toRadius;
 return (from,to,progress,{turnTower=false,preferUpper=false,reinforceNeck=false}={})=>{
  if(from!==previousFrom||to!==previousTo){
   const volume=field=>field.reduce((count,value)=>count+(value<0),0);
   fromRadius=Math.cbrt(volume(from));toRadius=Math.cbrt(volume(to));
   previousFrom=from;previousTo=to;
  }
  const values=new Float32Array(from.length);
  histogram.fill(0);
  // Bend the tower's long axis along the width of the frames before the
  // lenses emerge. Sample its rotated field with bilinear interpolation.
  const turn=Math.min(1,progress/.6),angle=turnTower?Math.PI*.5*turn*turn*(3-2*turn):0;
  const cos=Math.cos(angle),sin=Math.sin(angle),center=(n-1)/2,plane=n*n;
  const rotated=angle?new Int32Array(plane):null;
  const weights=angle?new Float32Array(plane*2):null;
  if(rotated){
   rotated.fill(-1);
   for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const u=(x-center)*cos+(y-center)*sin+center,v=-(x-center)*sin+(y-center)*cos+center;
    const sx=Math.floor(u),sy=Math.floor(v),i=x+n*y;
    if(sx<0||sy<0||sx>=n-1||sy>=n-1)continue;
    rotated[i]=sx+n*sy;weights[i*2]=u-sx;weights[i*2+1]=v-sy;
   }
  }
  for(let i=0;i<values.length;i++){
   let source=from[i];
   if(rotated){
    const cell=i%plane,mapped=rotated[cell]+i-cell;
    if(rotated[cell]<0)source=.45;
    else{
     const u=weights[cell*2],v=weights[cell*2+1];
     const a=from[mapped]+(from[mapped+1]-from[mapped])*u;
     const b=from[mapped+n]+(from[mapped+n+1]-from[mapped+n])*u;
     source=a+(b-a)*v;
    }
   }
   const value=source+(to[i]-source)*progress;
   values[i]=value;
   const bin=Math.max(0,Math.min(histogram.length-1,Math.floor((value+.45)/binSize)));
   histogram[bin]++;
  }
  // Interpolate the equivalent solid radius. The thin Tower and Glasses
  // barely overlap, so a fixed zero contour would make them almost vanish.
  const volume=Math.max(1,(fromRadius+(toRadius-fromRadius)*progress)**3);
  let bin=0,count=0;
  while(bin<histogram.length-1&&count+histogram[bin]<volume)count+=histogram[bin++];
  const quantile=(bin+(volume-count)/Math.max(1,histogram[bin]))*binSize-.45;
  const level=progress===0||progress===1?0:THREE.MathUtils.clamp(quantile,-.08,.24)+(turnTower?.02*Math.sin(Math.PI*progress)**2:0);
  for(let i=0;i<values.length;i++)values[i]-=level;
  const inMotion=progress>0&&progress<1;
  if(inMotion){
   const neckStrength=reinforceNeck?1.7*Math.sin(Math.PI*progress)**2:0;
   connect(values,{preferUpper,neckStrength});
  }
  cellVertices.fill(-1);
  const positions=[],indices=[];
  const sample=new Float32Array(8);
  for(let z=0;z<n-1;z++)for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
   const cell=x+n*(y+n*z);
   let mask=0;
   for(let i=0;i<8;i++)if((sample[i]=values[cell+offsets[i]])<0)mask|=1<<i;
   if(mask===0||mask===255)continue;
   let px=0,py=0,pz=0,count=0;
   for(const [a,b] of edges){
    if((sample[a]<0)===(sample[b]<0))continue;
    const t=sample[a]/(sample[a]-sample[b]),p=corners[a],q=corners[b];
    px+=p[0]+(q[0]-p[0])*t;py+=p[1]+(q[1]-p[1])*t;pz+=p[2]+(q[2]-p[2])*t;count++;
   }
   const vertex=positions.length/3;
   cellVertices[cell]=vertex;
   positions.push(origin+(x+px/count)*step,origin+(y+py/count)*step,origin+(z+pz/count)*step);
   const coordinates=[x,y,z];
   for(let axis=0;axis<3;axis++){
    if((sample[0]<0)===(sample[1<<axis]<0))continue;
    const u=(axis+1)%3,v=(axis+2)%3;
    if(!coordinates[u]||!coordinates[v])continue;
    const b=cellVertices[cell-pitch[u]],d=cellVertices[cell-pitch[v]],c=cellVertices[cell-pitch[u]-pitch[v]];
    if(sample[0]<0)indices.push(vertex,b,c,vertex,c,d);
    else indices.push(vertex,c,b,vertex,d,c);
   }
  }
  // Drop any isolated flecks left after the solid has been connected.
  // Keep original endpoint components when extracting a standalone shape.
  const parent=Int32Array.from({length:positions.length/3},(_,i)=>i);
  function find(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
  for(let i=0;i<indices.length;i+=3){
   const root=find(indices[i]);parent[find(indices[i+1])]=root;parent[find(indices[i+2])]=root;
  }
  const sizes=new Int32Array(parent.length);
  for(let i=0;i<parent.length;i++)sizes[find(i)]++;
  let largest=0;
  for(let i=1;i<sizes.length;i++)if(sizes[i]>sizes[largest])largest=i;
  const retained=[],compact=[],remap=new Int32Array(parent.length).fill(-1);
  for(let i=0;i<indices.length;i+=3){
   const component=find(indices[i]);
   if(inMotion?component!==largest:sizes[component]<40)continue;
   for(let j=0;j<3;j++){
    const old=indices[i+j];
    if(remap[old]<0){
     remap[old]=compact.length/3;
     compact.push(positions[old*3],positions[old*3+1],positions[old*3+2]);
    }
    retained.push(remap[old]);
   }
  }
  // Relax the grid ripples with a smoothing pass and a smaller inverse
  // pass, which compensates for loss of volume around thin features.
  const sums=new Float32Array(compact.length),counts=new Uint16Array(compact.length/3);
  for(const strength of [.38,-.32,.32,-.27]){
   sums.fill(0);counts.fill(0);
   for(let i=0;i<retained.length;i+=3){
    for(let j=0;j<3;j++){
     const a=retained[i+j],b=retained[i+(j+1)%3];
     counts[a]++;counts[b]++;
     for(let axis=0;axis<3;axis++){
      sums[3*a+axis]+=compact[3*b+axis];sums[3*b+axis]+=compact[3*a+axis];
     }
    }
   }
   for(let i=0;i<compact.length;i++)compact[i]+=strength*(sums[i]/counts[Math.floor(i/3)]-compact[i]);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(compact,3));
  geometry.setIndex(retained);
  geometry.computeVertexNormals();
  return geometry;
 };
}

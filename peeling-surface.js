import * as THREE from 'three';
import { buildCollisionHull } from './collision-hull.js';
import { projectSurface, surfacePatches } from './specimen-shapes.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function seededRandom(seed){let a=seed|0;return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function hash(x,y,z){const n=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return n-Math.floor(n);}
export function noise(x,y,z){const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let a=x-ix,b=y-iy,c=z-iz;a=a*a*(3-2*a);b=b*b*(3-2*b);c=c*c*(3-2*c);const mix=(u,v,t)=>u+(v-u)*t;return mix(mix(mix(hash(ix,iy,iz),hash(ix+1,iy,iz),a),mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),a),b),mix(mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),a),mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),a),b),c);}
function fbm(x,y,z){return noise(x,y,z)*.6+noise(x*2.1+6,y*2.1+4,z*2.1+2)*.27+noise(x*4.3+9,y*4.3+2,z*4.3+8)*.13;}
function clip(poly,nx,ny,d){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=a[0]*nx+a[1]*ny-d,db=b[0]*nx+b[1]*ny-d;if(da<=0)out.push(a);if((da<0)!==(db<0)){const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}return out;}
const faceBases=[
  {n:[0,0,1],u:[1,0,0],v:[0,1,0]}, {n:[0,0,-1],u:[-1,0,0],v:[0,1,0]},
  {n:[1,0,0],u:[0,0,-1],v:[0,1,0]}, {n:[-1,0,0],u:[0,0,1],v:[0,1,0]},
  {n:[0,1,0],u:[1,0,0],v:[0,0,-1]}, {n:[0,-1,0],u:[1,0,0],v:[0,0,1]}
].map(f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,new THREE.Vector3(...v)])));

/** One merged surface for both attached flakes and persistent rigid fragments. */
export class PeelingSurface {
  constructor({parent,material,physics,state}){
    this.parent=parent;this.material=material;this.physics=physics;this.state=state;
    this.flakes=[];this.mesh=null;this.detachedCount=0;this.pendingReleaseCount=0;
    this.worldQuaternion=new THREE.Quaternion();this.inverseQuaternion=new THREE.Quaternion();
    this.inverseMatrix=new THREE.Matrix4();this.point=new THREE.Vector3();this.normal=new THREE.Vector3();
    this.bodyQuaternion=new THREE.Quaternion();
    this.lastParentMatrix=new THREE.Matrix4();
    this.rebuild();
  }
  rebuild(){
    this.physics.clear();
    if(this.mesh){this.parent.remove(this.mesh);this.mesh.geometry.dispose();}
    this.flakes=[];this.detachedCount=0;this.pendingReleaseCount=0;
    this.lastDeformation=null;
    const rng=seededRandom(this.state.seed),positions=[],rest=[],layers=[],backs=[],ages=[],edges=[],indices=[];
    const patches=surfacePatches(faceBases,this.state.shape);
    for(const face of patches){
      const sites=[],extent=1.318,patternSeed=this.state.seed*.0127;
      // Unevenly clustered sites produce large surviving sheets alongside
      // small chips, without increasing the rigid-body count.
      for(let attempt=0;sites.length<Math.floor(294/patches.length)&&attempt<5000;attempt++){
        const x=(rng()*2-1)*extent,y=(rng()*2-1)*extent;
        const density=noise(x*2.2+patternSeed,y*2.2,7);
        if(rng()>.12+.88*density*density)continue;
        if(sites.some(p=>Math.hypot(p[0]-x,p[1]-y)<.09))continue;
        sites.push([x,y]);
      }
      for(let si=0;si<sites.length;si++){
        const center=sites[si];let poly=[[-extent,-extent],[extent,-extent],[extent,extent],[-extent,extent]];
        for(let j=0;j<sites.length;j++)if(j!==si){const b=sites[j];poly=clip(poly,b[0]-center[0],b[1]-center[1],(b[0]*b[0]+b[1]*b[1]-center[0]*center[0]-center[1]*center[1])*.5);if(!poly.length)break;}
        if(poly.length<3)continue;
        const edge=[];
        for(let i=0;i<poly.length;i++){
          const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
          // Shared spatial distortion bends a fracture on both sides of the
          // seam. Fade it in with aging so fresh paint remains perfectly closed.
          for(let j=0;j<5;j++){
            const t=j/5,x=a[0]+dx*t,y=a[1]+dy*t;
            const margin=clamp((extent-Math.max(Math.abs(x),Math.abs(y)))*12);
            const amplitude=Math.min(.045,Math.hypot(dx,dy)*.16)*margin;
            const wx=(noise(x*9+patternSeed,y*9,11)-.5)*amplitude*2;
            const wy=(noise(x*9+patternSeed,y*9,29)-.5)*amplitude*2;
            edge.push([x,y,wx,wy]);
          }
        }
        const root=face.n.clone().multiplyScalar(1.318).addScaledVector(face.u,center[0]).addScaledVector(face.v,center[1]);
        const ns=this.state.seed*.0127,n=fbm(root.x*1.52+ns,root.y*1.52+ns*.7,root.z*1.52+4);
        const layer=noise(root.x*1.7+ns+13,root.y*1.7+ns,root.z*1.7+5)>.51?2:1;
        const threshold=clamp(.25+n*.86+(rng()-.5)*.2,.34,.93);
        const angle=rng()*Math.PI*2,dir=[Math.cos(angle),Math.sin(angle)];
        const radius=Math.max(...edge.map(p=>Math.hypot(p[0]-center[0],p[1]-center[1])));
        const start=positions.length/3,indexStart=indices.length,infos=[],rings=3,count=edge.length;
        for(let r=0;r<=rings;r++)for(let e=0;e<count;e++){
          const s=r/rings,dx=(edge[e][0]-center[0])*s,dy=(edge[e][1]-center[1])*s;
          const base=face.n.clone().multiplyScalar(1.318).addScaledVector(face.u,center[0]+dx).addScaledVector(face.v,center[1]+dy);
          const index=positions.length/3;
          positions.push(base.x,base.y,base.z);rest.push(base.x,base.y,base.z);layers.push(layer);backs.push(0);ages.push(-1);edges.push(s);
          infos.push({index,dx,dy,jagX:edge[e][2]*s,jagY:edge[e][3]*s,base,back:0,t:clamp((dx*dir[0]+dy*dir[1])/radius*.55+.45),grain:noise(base.x*45,base.y*45,base.z*45)});
          if(r>0){const curr=start+r*count+e,prev=start+(r-1)*count+e,next=start+r*count+(e+1)%count,prevNext=start+(r-1)*count+(e+1)%count;indices.push(prev,curr,next,prev,next,prevNext);}
        }
        const frontIndices=indices.slice(indexStart),frontInfos=infos.slice(),backStart=positions.length/3;
        for(const info of frontInfos){
          const base=info.base.clone().addScaledVector(face.n,-.018);
          positions.push(base.x,base.y,base.z);rest.push(info.base.x,info.base.y,info.base.z);layers.push(layer);backs.push(1);ages.push(-1);edges.push(edges[info.index]);
          infos.push({...info,index:positions.length/3-1,base,back:1});
        }
        // Backing uses the same rings and curl, with opposite triangle winding.
        // A single polygon fan would cut straight through the curved front.
        for(let i=0;i<frontIndices.length;i+=3)indices.push(backStart+frontIndices[i]-start,backStart+frontIndices[i+2]-start,backStart+frontIndices[i+1]-start);
        // Give crack walls their own vertices: sharing topcoat normals with
        // vertical walls makes every intact cell look beveled before it cracks.
        const wallStart=positions.length/3;
        for(let side=0;side<2;side++)for(let e=0;e<count;e++){
          const source=infos[side*frontInfos.length+rings*count+e];
          const index=positions.length/3;
          positions.push(source.base.x,source.base.y,source.base.z);
          const restIndex=source.index*3;
          rest.push(rest[restIndex],rest[restIndex+1],rest[restIndex+2]);
          layers.push(layer);backs.push(source.back);ages.push(-1);edges.push(1);
          infos.push({...source,base:source.base.clone(),index,wall:true,surfaceIndex:source.index});
        }
        for(let e=0;e<count;e++){const a=wallStart+e,b=wallStart+(e+1)%count,c=wallStart+count+e,d=wallStart+count+(e+1)%count;indices.push(a,c,d,a,d,b);}
        this.flakes.push({start,indexStart,indexCount:indices.length-indexStart,root,center,face,threshold,layer,dir,radius,infos,weight:rng(),body:null,localPositions:null,localNormals:null});
      }
    }
    if(this.state.shape&&this.state.shape!=='cube'){
      for(const flake of this.flakes){
        const sourceFace=flake.face;
        const mapped=projectSurface(flake.root,sourceFace,this.state.shape);
        const u=projectSurface(flake.root.clone().addScaledVector(sourceFace.u,.001),sourceFace,this.state.shape).position.sub(mapped.position);
        u.addScaledVector(mapped.normal,-u.dot(mapped.normal)).normalize();
        if(u.lengthSq()<.5)u.copy(sourceFace.u);
        flake.root.copy(mapped.position);flake.face={n:mapped.normal,u,v:new THREE.Vector3().crossVectors(mapped.normal,u).normalize()};
        for(const info of flake.infos){
          const front=info.base.clone().addScaledVector(sourceFace.n,info.back?.018:0);
          const sample=projectSurface(front,sourceFace,this.state.shape);
          info.surfaceNormal=sample.normal;
          info.base.copy(sample.position).addScaledVector(sample.normal,info.back?-.018:0);
          const offset=info.base.clone().sub(flake.root);
          info.dx=offset.dot(flake.face.u);info.dy=offset.dot(flake.face.v);
          positions[info.index*3]=info.base.x;positions[info.index*3+1]=info.base.y;positions[info.index*3+2]=info.base.z;
          rest[info.index*3]=sample.position.x;rest[info.index*3+1]=sample.position.y;rest[info.index*3+2]=sample.position.z;
        }
        flake.radius=Math.max(...flake.infos.map(info=>info.base.distanceTo(flake.root)));
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('restPosition',new THREE.Float32BufferAttribute(rest,3));
    geo.setAttribute('coatEdge',new THREE.Float32BufferAttribute(edges,1));
    geo.setAttribute('layer',new THREE.Float32BufferAttribute(layers,1));
    geo.setAttribute('underside',new THREE.Float32BufferAttribute(backs,1));
    geo.setAttribute('flakeAge',new THREE.Float32BufferAttribute(ages,1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(indices);geo.computeVertexNormals();geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    this.mesh=new THREE.Mesh(geo,this.material);this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
    this.parent.add(this.mesh);this.updateAttached();
  }
  updateAttached(){
    const state=this.state,geo=this.mesh.geometry,positions=geo.attributes.position,ready=[];
    const pt=this.point;
    const peel=state.peel*(state.flakeFactor??1);
    // Bare patina changes in the shader; its undeformed mesh can be reused.
    const deformation=[(state.flakeFactor??1)>0?state.age:0,peel,state.exploded];
    const changed=!this.lastDeformation||deformation.some((v,i)=>v!==this.lastDeformation[i]);
    if(!changed&&(!this.pendingReleaseCount||this.physics.stats().awake>=24))return;
    this.lastDeformation=deformation;
    for(const flake of this.flakes){
      if(flake.body||flake.removed)continue;
      const {root,face,threshold,dir,radius,infos,weight,layer}=flake;
      const localCrack=(state.flakeFactor??1)*smooth(Math.max(.08,threshold-.38),Math.max(.22,threshold-.08),state.age);
      const lift=smooth(threshold-.28,threshold,state.age)*peel;
      const split=state.exploded*(layer===2?.43:.23);
      if(changed){
        for(const info of infos){
          const bend=clamp((info.t-.4)/.6),angle=lift*(1.65+weight*.55)*bend;
          const arcLength=radius*.95*bend;
          const curl=angle>.0001?arcLength*(1-Math.cos(angle))/angle:0;
          const shift=angle>.0001?arcLength*(Math.sin(angle)/angle-1):0;
          // Fine relief lives in the shader, not in this coarse triangle fan.
          pt.copy(info.base).sub(root);
          pt.addScaledVector(face.u,(info.jagX-info.dx*(.008+.026*info.grain))*localCrack+dir[0]*shift);
          pt.addScaledVector(face.v,(info.jagY-info.dy*(.008+.026*info.grain))*localCrack+dir[1]*shift);
          pt.add(root).addScaledVector(face.n,curl+split);
          // Internal walls stay collapsed beneath intact paint; otherwise
          // their overlapping shadow casters reveal a dotted cell outline.
          if(info.wall&&!info.back)pt.addScaledVector(info.surfaceNormal??face.n,-(this.thickness??.018)*(1-localCrack));
          positions.setXYZ(info.index,pt.x,pt.y,pt.z);
        }
        this.updateNormals(flake);
        positions.addUpdateRange(flake.start*3,infos.length*3);
        geo.attributes.normal.addUpdateRange(flake.start*3,infos.length*3);
        positions.needsUpdate=true;geo.attributes.normal.needsUpdate=true;
      }
      // Zero peeling keeps the coating attached. A lifted edge eventually tears.
      const releaseAge=threshold+(1-peel)*.13;
      if(peel>.015&&state.age>=releaseAge)ready.push(flake);
    }
    this.parent.updateMatrixWorld(true);this.parent.getWorldQuaternion(this.worldQuaternion);
    // Scrubbing far forward releases a small succession of flakes instead of
    // creating hundreds of overlapping active rigid bodies in one frame.
    const capacity=Math.max(0,24-this.physics.stats().awake);
    ready.sort((a,b)=>a.threshold-b.threshold);
    const releaseCount=Math.min(6,capacity,ready.length);
    for(let i=0;i<releaseCount;i++)this.detach(ready[i]);
    this.pendingReleaseCount=ready.length-releaseCount;
  }
  // Each flake owns contiguous vertices and indices. Recompute only its
  // attached surface; settled normals must not be overwritten by other flakes.
  updateNormals(flake){
    const geo=this.mesh.geometry,p=geo.attributes.position.array,n=geo.attributes.normal.array,indices=geo.index.array;
    const start=flake.start*3,end=start+flake.infos.length*3;
    n.fill(0,start,end);
    for(let i=flake.indexStart;i<flake.indexStart+flake.indexCount;i+=3){
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
      const ax=p[c]-p[b],ay=p[c+1]-p[b+1],az=p[c+2]-p[b+2];
      const bx=p[a]-p[b],by=p[a+1]-p[b+1],bz=p[a+2]-p[b+2];
      const x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;
      n[a]+=x;n[a+1]+=y;n[a+2]+=z;
      n[b]+=x;n[b+1]+=y;n[b+2]+=z;
      n[c]+=x;n[c+1]+=y;n[c+2]+=z;
    }
    // Reintroduce the original shared edge shading as cracks open, while
    // keeping the intact topcoat flat. Blend unnormalized area-weighted normals.
    const crack=(this.state.flakeFactor??1)*smooth(.08,.5,this.state.age);
    for(const info of flake.infos){
      if(!info.wall)continue;
      const wall=info.index*3,surface=info.surfaceIndex*3;
      for(let axis=0;axis<3;axis++){
        const top=n[surface+axis],side=n[wall+axis];
        n[surface+axis]=top+side*crack;
        n[wall+axis]=side+top*crack;
      }
    }
    for(let i=start;i<end;i+=3){const length=Math.hypot(n[i],n[i+1],n[i+2])||1;n[i]/=length;n[i+1]/=length;n[i+2]/=length;}
    for(const info of flake.infos){
      if(!info.surfaceNormal||info.wall)continue;
      const i=info.index*3,sign=info.back?-1:1;
      this.normal.set(n[i],n[i+1],n[i+2]).lerp(this.point.copy(info.surfaceNormal).multiplyScalar(sign),1-crack).normalize();
      n[i]=this.normal.x;n[i+1]=this.normal.y;n[i+2]=this.normal.z;
    }
  }
  detach(flake){
    if(flake.body)return;
    const geo=this.mesh.geometry,p=geo.attributes.position,n=geo.attributes.normal;
    const worldPositions=flake.infos.map(info=>new THREE.Vector3().fromBufferAttribute(p,info.index).applyMatrix4(this.parent.matrixWorld));
    const center=new THREE.Vector3();for(const point of worldPositions)center.add(point);center.divideScalar(worldPositions.length);
    flake.localPositions=worldPositions.map(point=>point.sub(center));
    flake.localNormals=flake.infos.map(info=>new THREE.Vector3().fromBufferAttribute(n,info.index).applyQuaternion(this.worldQuaternion));
    const basis={};
    for(const key of ['u','v','n'])basis[key]=flake.face[key].clone().applyQuaternion(this.worldQuaternion);
    // Conservative support planes enclose every rendered point while keeping
    // collision complexity independent of the fine surface tessellation.
    const {vertices,faces}=buildCollisionHull(flake.localPositions,basis,.001);
    const normal=flake.face.n.clone().applyQuaternion(this.worldQuaternion);
    const side=flake.face.u.clone().multiplyScalar(flake.dir[0]).addScaledVector(flake.face.v,flake.dir[1]).applyQuaternion(this.worldQuaternion);
    let velocity=normal.clone().multiplyScalar(.38+flake.weight*.3).addScaledVector(side,.16);
    if(normal.y>.55){
      const outward=new THREE.Vector3(center.x-this.parent.position.x,0,center.z-this.parent.position.z);
      if(outward.lengthSq()<.02)outward.set(Math.cos(flake.weight*23),0,Math.sin(flake.weight*23));
      outward.normalize();velocity=outward.multiplyScalar(1.8+flake.weight*.9);velocity.y=.65+flake.weight*.2;
    }
    const spin=side.clone().cross(normal).normalize().multiplyScalar(1.2+flake.weight*2.5);
    flake.body=this.physics.addFlake({vertices,faces,position:center,velocity,angularVelocity:spin,mass:.012+flake.radius*flake.radius*.16});
    flake.infos.forEach(info=>geo.attributes.flakeAge.setX(info.index,this.state.age));
    geo.attributes.flakeAge.addUpdateRange(flake.start,flake.infos.length);
    geo.attributes.flakeAge.needsUpdate=true;
    this.detachedCount++;
  }
  flakeAtFace(faceIndex){
    const index=faceIndex*3;
    return this.flakes.find(f=>!f.removed&&index>=f.indexStart&&index<f.indexStart+f.indexCount);
  }
  removeFlake(flake){
    if(!flake?.body||flake.removed)return;
    this.physics.removeFlake(flake.body);flake.removed=true;
    const index=this.mesh.geometry.index;
    flake.savedIndices=index.array.slice(flake.indexStart,flake.indexStart+flake.indexCount);
    index.array.fill(flake.start,flake.indexStart,flake.indexStart+flake.indexCount);index.needsUpdate=true;
  }
  syncPhysics(){
    if(!this.detachedCount)return;
    const geo=this.mesh.geometry,p=geo.attributes.position,n=geo.attributes.normal;
    this.parent.updateMatrixWorld(true);
    const parentMoved=!this.lastParentMatrix.equals(this.parent.matrixWorld);
    this.lastParentMatrix.copy(this.parent.matrixWorld);
    this.inverseMatrix.copy(this.parent.matrixWorld).invert();
    this.parent.getWorldQuaternion(this.inverseQuaternion).invert();
    for(const flake of this.flakes){
      const body=flake.body;if(!body||flake.removed||(body.mass===0&&flake.settledSynced&&!parentMoved))continue;
      const quaternion=body.mass===0?body.quaternion:body.interpolatedQuaternion,position=body.mass===0?body.position:body.interpolatedPosition;
      this.bodyQuaternion.set(quaternion.x,quaternion.y,quaternion.z,quaternion.w);
      for(let i=0;i<flake.infos.length;i++){
        this.point.copy(flake.localPositions[i]).applyQuaternion(this.bodyQuaternion).add(position).applyMatrix4(this.inverseMatrix);
        this.normal.copy(flake.localNormals[i]).applyQuaternion(this.bodyQuaternion).applyQuaternion(this.inverseQuaternion);
        const index=flake.infos[i].index;
        p.setXYZ(index,this.point.x,this.point.y,this.point.z);n.setXYZ(index,this.normal.x,this.normal.y,this.normal.z);
      }
      p.addUpdateRange(flake.start*3,flake.infos.length*3);
      n.addUpdateRange(flake.start*3,flake.infos.length*3);
      p.needsUpdate=true;n.needsUpdate=true;
      flake.settledSynced=body.mass===0;
    }
  }
  repaint(){
    this.physics.clear();this.detachedCount=0;this.pendingReleaseCount=0;this.lastDeformation=null;
    for(const flake of this.flakes){
      if(flake.savedIndices)this.mesh.geometry.index.array.set(flake.savedIndices,flake.indexStart);
      flake.savedIndices=null;flake.removed=false;flake.body=null;flake.localPositions=null;flake.localNormals=null;flake.settledSynced=false;}
    this.mesh.geometry.index.needsUpdate=true;
    this.mesh.geometry.attributes.flakeAge.clearUpdateRanges();
    this.mesh.geometry.attributes.flakeAge.array.fill(-1);this.mesh.geometry.attributes.flakeAge.needsUpdate=true;
    this.updateAttached();
  }
  stats(){return {totalFlakes:this.flakes.length,attached:this.flakes.length-this.detachedCount,detached:this.detachedCount,...this.physics.stats()};}
}

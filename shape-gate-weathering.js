import * as T from 'three';
import {createPalmTree} from './palm-tree.js';

// Shared by the visible stone and its shadow passes. Erosion always removes
// material so the swinging sculpture and the cord retain their clearance.
export const erosionGLSL=`
 uniform float stoneAge;
 float erosionWave(vec3 p){
  float flow=p.y*19.0+p.x*3.8+sin(p.x*2.6+p.z*3.0)*2.8;
  float beds=.5+.5*sin(flow+sin(flow*.31)*1.4);
  float flutes=.5+.5*sin(p.x*8.1+p.y*2.3+sin(p.y*3.7)*1.8);
  return .18+.53*pow(beds,3.0)+.29*pow(flutes,4.0);
 }
 vec3 erodeStone(vec3 p,vec3 n){
  float relief=erosionWave(p)*stoneAge;
  return p-n*relief*mix(.085,.034,abs(n.z));
 }
`;

export function weatherGateMaterial(material,age){
 const compile=material.onBeforeCompile;
 material.onBeforeCompile=shader=>{
  compile(shader);
  shader.uniforms.stoneAge=age;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${erosionGLSL}`)
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvErosionPoint=position;transformed=erodeStone(transformed,normal);')
   .replace('#include <common>','#include <common>\nvarying vec3 vErosionPoint;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${erosionGLSL}\nvarying vec3 vErosionPoint;`)
   .replace('#include <lights_physical_fragment>',`roughnessFactor=mix(roughnessFactor,.96,stoneAge*.94);
    #include <lights_physical_fragment>
    #ifdef USE_CLEARCOAT
     material.clearcoat*=1.0-stoneAge;
    #endif`)
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    float windHeight=-erosionWave(vErosionPoint)*stoneAge*.034;
    vec3 windDx=dFdx(-vViewPosition),windDy=dFdy(-vViewPosition);
    vec3 windRx=cross(windDy,normal),windRy=cross(normal,windDx);
    float windDet=dot(windDx,windRx);
    vec3 windGradient=dFdx(windHeight)*windRx+dFdy(windHeight)*windRy;
    if(abs(windDet)>1e-10)normal=normalize(normal-sign(windDet)*windGradient/max(abs(windDet),1e-8));`);
 };
 material.customProgramCacheKey=()=> 'gate-layered-marble-erosion-v1';
 return material;
}

export function stoneShadowMaterial(age,distance=false){
 const material=distance?new T.MeshDistanceMaterial():new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
 material.onBeforeCompile=shader=>{
  shader.uniforms.stoneAge=age;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${erosionGLSL}`)
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=erodeStone(transformed,normal);');
 };
 return material;
}

// Extrusions have large planar triangles; split them for real silhouette relief.
// Retain parameters because the brush seal samples the original contour.
export function refineStoneGeometry(geometry,maxEdge=.13){
 const source=geometry.index?geometry.toNonIndexed():geometry;
 const p=source.attributes.position,n=source.attributes.normal,positions=[],normals=[];
 const push=(a,b,c,na,nb,nc,depth=0)=>{
  const lengths=[a.distanceToSquared(b),b.distanceToSquared(c),c.distanceToSquared(a)];
  const side=lengths.indexOf(Math.max(...lengths));
  if(lengths[side]>maxEdge*maxEdge&&depth<14){
   const v=[a,b,c],ns=[na,nb,nc],i=side,j=(side+1)%3,k=(side+2)%3;
   const middle=v[i].clone().add(v[j]).multiplyScalar(.5),mn=ns[i].clone().add(ns[j]).normalize();
   push(v[i],middle,v[k],ns[i],mn,ns[k],depth+1);
   push(middle,v[j],v[k],mn,ns[j],ns[k],depth+1);
  }else{for(const v of [a,b,c])positions.push(v.x,v.y,v.z);for(const v of [na,nb,nc])normals.push(v.x,v.y,v.z);}
 };
 for(let i=0;i<p.count;i+=3)push(...[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,i+j)),...[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(n,i+j)));
 const result=new T.BufferGeometry();result.parameters=geometry.parameters;
 result.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 result.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
 if(source!==geometry)source.dispose();geometry.dispose();
 result.computeBoundingSphere();return result;
}

export function gateRootSites(tileSize,origin){
 // All trunks emerge on existing tile intersections, away from the wheel well.
 return [[1,1],[8,5],[2,5],[8,1]].map(([x,y],i)=>({
  x:x*tileSize.x-origin.x,z:origin.y-y*tileSize.y,phase:i*.13
 }));
}

export function createReclaimingPalms(parent,sites,age){
 const roots=new T.Group();roots.name='Palms reclaiming the checkerboard';parent.add(roots);
 const bark=new T.MeshStandardMaterial({color:0x63513a,roughness:1});
 const profiles=[
  {trunkHeight:3.45,trunkRadius:.105,curve:.30,fronds:42,length:1.85,droop:1.25,heading:-.32},
  {trunkHeight:4.45,trunkRadius:.078,curve:.74,fronds:36,length:2.04,droop:1.78,heading:.33},
  {trunkHeight:3.95,trunkRadius:.090,curve:.56,fronds:48,length:2.17,droop:1.60,heading:.04},
  {trunkHeight:4.18,trunkRadius:.095,curve:.17,fronds:39,length:1.72,droop:1.39,heading:-.52}
 ];
 const palms=sites.map((site,i)=>{
  const anchor=new T.Group();anchor.position.set(site.x,-.04,site.z);roots.add(anchor);
  const {heading,...profile}=profiles[i%profiles.length];
  const palm=createPalmTree({scene:anchor,floorY:0,showDevelopment:true});
  palm.rebuild({
   ...profile,seed:7319+i*331,density:1,dryFraction:.38,wind:.69
  });
  // Palm geometry starts at x=-.55. Center that trunk on the actual joint.
  const growth=new T.Group();anchor.add(growth);growth.add(palm.group);palm.group.position.x=.55;palm.group.visible=true;
  growth.rotation.y=Math.atan2(-site.z,site.x)+heading;
  const rootMeshes=[];
  for(let j=0;j<5;j++){
   const angle=j*Math.PI*2/5+i,dx=Math.cos(angle),dz=Math.sin(angle),length=.42+(j%3)*.14;
   const path=new T.CatmullRomCurve3([new T.Vector3(0,0,0),new T.Vector3(dx*.16,.075,dz*.16),new T.Vector3(dx*length,.018,dz*length),new T.Vector3(dx*(length+.16),-.08,dz*(length+.16))]);
   const root=new T.Mesh(new T.TubeGeometry(path,16,.026,5,false),bark);root.name='Root splitting marble joint';root.castShadow=true;root.receiveShadow=true;anchor.add(root);rootMeshes.push(root);
  }
  return {site,palm,growth,rootMeshes};
 });
 let previousAge,previousExtraGrowth;
 function advance(dt,extraGrowth=0){
  for(const {site,palm,growth,rootMeshes} of palms){
   const weathered=T.MathUtils.clamp((age.value-site.phase)/(.96-site.phase),0,1);
   // Leave the last trunk rings to grow after the marble finishes weathering.
   const laterGrowth=1-Math.pow(1-T.MathUtils.clamp(extraGrowth/4,0,1),3);
   const development=.72*weathered+.28*laterGrowth;
   if(age.value!==previousAge||extraGrowth!==previousExtraGrowth)palm.seekDevelopment(development);
   growth.scale.setScalar(T.MathUtils.smoothstep(development,0,.06));
   for(const root of rootMeshes)root.scale.setScalar(.05+.95*weathered);
   palm.advance(dt);
  }
  previousAge=age.value;
  previousExtraGrowth=extraGrowth;
 }
 advance(0);return {group:roots,advance};
}

export function tileRootPressure(x,y,sites){
 const pressure=new T.Vector3();
 for(const site of sites){
  // Point the height gradient toward the trunk in the floor's XY plane.
  const dx=site.x-x,dy=-site.z-y,force=Math.exp(-(dx*dx+dy*dy)/.64);
  pressure.x+=force*.24;
  pressure.y+=force*dx*.22;
  pressure.z+=force*dy*.22;
 }
 return pressure;
}

export function createRootedTileGeometry(shape,tileSize,origin,sites,{jointInset=.004,slabDepth=.10,collectSupports=false,closeBottom=true}={}){
 const box=new T.Box2().setFromPoints(shape.getPoints()),positions=[],centers=[],pressures=[],supports=[],rootAttachments=[],indices=[];
 const hole=shape.holes[0]?new T.Box2().setFromPoints(shape.holes[0].getPoints()):null;
 function slab(x0,y0,x1,y1,cx,cy){
  if(x1-x0<1e-6||y1-y0<1e-6)return;
  const pressure=tileRootPressure(cx,cy,sites);
  // A narrow open joint separates individual tile bodies.
  if(x0>box.min.x+1e-6)x0+=jointInset;if(y0>box.min.y+1e-6)y0+=jointInset;
  if(x1<box.max.x-1e-6)x1-=jointInset;if(y1<box.max.y-1e-6)y1-=jointInset;
  const supportX=pressure.y>=0?x0:x1,supportY=pressure.z>=0?y0:y1;
  if(collectSupports&&pressure.x>.085){
   const nearest=sites.reduce((best,site)=>{
    const distance=(cx-site.x)**2+(cy+site.z)**2;
    return distance<best.distance?{site,distance}:best;
   },{site:null,distance:Infinity});
   if(nearest.distance<.75){
    const x=T.MathUtils.lerp(x0,x1,pressure.y>=0?.86:.14);
    const y=T.MathUtils.lerp(y0,y1,pressure.z>=0?.86:.14);
    rootAttachments.push({site:nearest.site,tip:[x,y,-slabDepth+.023],center:[cx,cy],
     pressure:[...pressure],support:[supportX,supportY,-slabDepth]});
   }
  }
  const add=(x,y,z)=>{
   positions.push(x,y,z);centers.push(cx,cy);pressures.push(...pressure);
   supports.push(supportX,supportY,-slabDepth);
  };
  const quad=(a,b,c,d)=>{const start=positions.length/3;for(const v of [a,b,c,d])add(...v);indices.push(start,start+1,start+2,start,start+2,start+3);};
  const segments=8;
  const xs=Array.from({length:segments+1},(_,i)=>T.MathUtils.lerp(x0,x1,i/segments));
  const ys=Array.from({length:segments+1},(_,i)=>T.MathUtils.lerp(y0,y1,i/segments));
  const bottom=-slabDepth;
  for(let j=0;j<segments;j++)for(let i=0;i<segments;i++){
   const xa=xs[i],xb=xs[i+1],ya=ys[j],yb=ys[j+1];
   quad([xa,ya,0],[xb,ya,0],[xb,yb,0],[xa,yb,0]);
   if(closeBottom)quad([xa,ya,bottom],[xa,yb,bottom],[xb,yb,bottom],[xb,ya,bottom]);
  }
  // Match the rim subdivisions to the faces so erosion cannot pull them apart.
  const edges=closeBottom?segments:1;
  for(let i=0;i<edges;i++){
   const first=i*segments/edges,last=(i+1)*segments/edges;
   const xa=xs[first],xb=xs[last],ya=ys[first],yb=ys[last];
   quad([xa,y0,bottom],[xb,y0,bottom],[xb,y0,0],[xa,y0,0]);
   quad([xb,y1,bottom],[xa,y1,bottom],[xa,y1,0],[xb,y1,0]);
   quad([x0,yb,bottom],[x0,ya,bottom],[x0,ya,0],[x0,yb,0]);
   quad([x1,ya,bottom],[x1,yb,bottom],[x1,yb,0],[x1,ya,0]);
  }
 }
 const startX=Math.round((box.min.x+origin.x)/tileSize.x),endX=Math.round((box.max.x+origin.x)/tileSize.x);
 const startY=Math.round((box.min.y+origin.y)/tileSize.y),endY=Math.round((box.max.y+origin.y)/tileSize.y);
 for(let j=startY;j<endY;j++)for(let i=startX;i<endX;i++){
  const x0=i*tileSize.x-origin.x,x1=x0+tileSize.x,y0=j*tileSize.y-origin.y,y1=y0+tileSize.y,cx=(x0+x1)/2,cy=(y0+y1)/2;
  if(!hole||x1<=hole.min.x||x0>=hole.max.x||y1<=hole.min.y||y0>=hole.max.y)slab(x0,y0,x1,y1,cx,cy);
  else{
   slab(x0,y0,Math.min(x1,hole.min.x),y1,cx,cy);slab(Math.max(x0,hole.max.x),y0,x1,y1,cx,cy);
   const a=Math.max(x0,hole.min.x),b=Math.min(x1,hole.max.x);
   slab(a,y0,b,Math.min(y1,hole.min.y),cx,cy);slab(a,Math.max(y0,hole.max.y),b,y1,cx,cy);
  }
 }
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 geometry.setAttribute('tileCenter',new T.Float32BufferAttribute(centers,2));
 geometry.setAttribute('tilePressure',new T.Float32BufferAttribute(pressures,3));
 geometry.setAttribute('tileSupport',new T.Float32BufferAttribute(supports,3));
 if(collectSupports)geometry.userData.rootAttachments=rootAttachments;
 geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.5;
 return geometry;
}

export function matureTileTilt(palmMaturation){
 const lift=14*(1-Math.exp(-palmMaturation/1.6));
 // A small, damped rocking response as the roots start pushing harder.
 const rock=.14*Math.sin(palmMaturation*78)*Math.exp(-palmMaturation*9);
 return Math.max(0,lift+rock);
}

export const gateSandInset=.087;

export const tileDisplacementGLSL=`
 uniform float stoneAge;
 attribute vec2 tileCenter;
 attribute vec3 tilePressure;
 #ifdef ROOT_HEAVE
 attribute vec3 tileSupport;
 #endif
 float tileErosion(vec2 point){
  float layer=.5+.5*sin(point.y*47.0+point.x*7.0+sin(point.x*4.0)*2.3);
  return (.006+.022*pow(layer,3.0))*stoneAge;
 }
 vec3 liftMarbleTile(vec3 p){
  vec2 delta=p.xy-tileCenter;
  vec2 slope=tilePressure.yz;
  float growth=smoothstep(.08,.95,stoneAge);
  p.z-=tileErosion(p.xy);
  #ifdef ROOT_HEAVE
   // Rotate the slab's cross section about its low edge. Both the face and
   // its thickness rotate together, so extra height narrows its footprint.
   float slopeLength=length(slope);
   if(slopeLength>.000001){
    vec2 uphill=slope/slopeLength;
    float hinge=dot(tileCenter-tileSupport.xy,uphill);
    float nearby=smoothstep(.045,.128,tilePressure.x);
    float grade=slopeLength*(growth+rootHeave*nearby);
    float cosine=inversesqrt(1.0+grade*grade);
    float sine=grade*cosine;
    float reach=dot(delta,uphill)+hinge;
    p.xy+=uphill*(reach*(cosine-1.0)-p.z*sine);
    float originalOffset=-hinge*slopeLength*growth;
    // Solve contact at the rotated bottom corner against the same sand
    // profile the substrate uses. Seat slightly into the sand to allow
    // for the tessellated surface between samples.
    float footDepth=tileSupport.z-tileErosion(tileSupport.xy);
    vec2 foot=tileSupport.xy-uphill*footDepth*sine;
    float sand=-${gateSandInset}-tileErosion(foot)+dot(foot-tileCenter,slope)*growth;
    float supportedOffset=sand-.008-footDepth*cosine;
    float contact=smoothstep(0.0,.22,rootHeave*nearby);
    p.z=reach*sine+p.z*cosine+mix(originalOffset,supportedOffset,contact);
   }
  #else
   p.z+=dot(delta,slope)*growth;
  #endif
  p.z+=tilePressure.x*growth;
  return p;
 }
`;

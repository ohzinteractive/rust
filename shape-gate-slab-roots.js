import * as T from 'three';
import {tileDisplacementGLSL} from './shape-gate-weathering.js';

// The upper end stays against the underside of the marble throughout the
// tilt. The other end starts beneath the trunk, inside the sand.
export function createSlabRoots(age,heave){
 const material=new T.MeshStandardMaterial({color:0x694728,roughness:1,vertexColors:true});
 const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
 function deform(shader,shade=false){
  shader.uniforms.stoneAge=age;
  shader.uniforms.rootHeave=heave;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
   #define ROOT_HEAVE
   uniform float rootHeave;
   ${tileDisplacementGLSL}
   attribute vec3 rootOrigin;
   attribute vec3 rootTip;
   mat3 rootFrame(vec3 span){
    vec3 along=normalize(span);
    vec3 across=normalize(cross(along,vec3(0.0,1.0,0.0)));
    return mat3(across,cross(along,across),along);
   }
  `).replace('#include <begin_vertex>',`#include <begin_vertex>
   vec3 tip=liftMarbleTile(rootTip);
   vec3 span=tip-rootOrigin;
   mat3 frame=rootFrame(span);
   float t=position.z;
   float bend=sin(t*3.14159265);
   float growth=smoothstep(.0,.9,rootHeave);
   transformed=mix(rootOrigin,tip,t)+vec3(.0,.04,-.15)*bend
     +frame*vec3(position.xy*growth,0.0);
   transformed.z-=.32*(1.0-growth);
  `);
  if(shade)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
   objectNormal=rootFrame(liftMarbleTile(rootTip)-rootOrigin)*objectNormal;
  `);
 }
 material.onBeforeCompile=shader=>deform(shader,true);
 depth.onBeforeCompile=shader=>deform(shader);
 const mesh=new T.Mesh(new T.BufferGeometry(),material);
 mesh.name='Palm roots bracing the raised slabs';
 mesh.customDepthMaterial=depth;
 mesh.castShadow=true;
 mesh.receiveShadow=true;
 // The buffer stores a tube template, so CPU raycasts cannot pick its posed surface.
 mesh.frustumCulled=false;
 mesh.raycast=()=>{};

 function rebuild(attachments){
  const geometry=new T.BufferGeometry();
  const cylinder=new T.CylinderGeometry(.034,.10,1,8,10);
  const template=cylinder.toNonIndexed();
  cylinder.dispose();
  template.rotateX(Math.PI/2).translate(0,0,.5);
  const p=template.attributes.position,n=template.attributes.normal;
  const positions=[],normals=[],colors=[],origins=[],tips=[],centers=[],pressures=[],supports=[];
  const tint=new T.Color(),base=new T.Color(0xffffff);
  for(const {site,tip,center,pressure,support} of attachments){
   for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),t=p.getZ(i);
    const grain=.84+.13*Math.sin(Math.atan2(y,x)*5+t*2)+.09*Math.cos(t*29);
    tint.copy(base).multiplyScalar(grain);
    positions.push(x,y,t);
    normals.push(n.getX(i),n.getY(i),n.getZ(i));
    colors.push(tint.r,tint.g,tint.b);
    origins.push(site.x,-site.z,-.12);
    tips.push(...tip);
    centers.push(...center);
    pressures.push(...pressure);
    supports.push(...support);
   }
  }
  template.dispose();
  for(const [name,data,size] of [['position',positions,3],['normal',normals,3],['color',colors,3],['rootOrigin',origins,3],['rootTip',tips,3],['tileCenter',centers,2],['tilePressure',pressures,3],['tileSupport',supports,3]]){
   geometry.setAttribute(name,new T.Float32BufferAttribute(data,size));
  }
  mesh.geometry.dispose();
  mesh.geometry=geometry;
  mesh.visible=attachments.length>0;
 }
 return {mesh,rebuild};
}

import * as T from 'three';
import {swingModelSize} from './shape-gate-motion.js';

export function createGoldMaterial(probe,worldToGate,floorHalfSize,cube=false){
 const material=new T.MeshStandardMaterial({
  name:'Polished gold',color:0xffd37a,roughness:.105,metalness:1,
  side:T.DoubleSide,envMap:probe.renderTarget.texture
 });
 const environment=T.ShaderChunk.envmap_physical_pars_fragment.replace(
  'envMapRotation * reflectVec, roughness',
  'envMapRotation * goldReflectionDirection(reflectVec), roughness'
 );
 const cubeEdge={value:cube?1:0};
 material.userData.cubeEdge=cubeEdge;
 material.onBeforeCompile=shader=>{
  shader.uniforms.goldProbePosition={value:probe.position};
  shader.uniforms.goldWorldToGate={value:worldToGate};
  shader.uniforms.goldFloorHalfSize={value:floorHalfSize};
  shader.uniforms.goldCubeEdge=cubeEdge;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
   varying vec3 vGoldPosition;
   varying vec3 vGoldRoundedNormal;
   uniform float goldCubeEdge;
  `).replace('#include <defaultnormal_vertex>',`#include <defaultnormal_vertex>
   vGoldRoundedNormal=transformedNormal;
   if(goldCubeEdge>0.0){
    // Polish the cube edges with curved normals while retaining its fit
    // through the precisely matched marble opening.
    const float innerFace=${(swingModelSize/2-.045).toFixed(4)};
    vec3 edgeNormal=position-clamp(position,vec3(-innerFace),vec3(innerFace));
    if(dot(edgeNormal,edgeNormal)>0.000001)vGoldRoundedNormal=normalMatrix*normalize(edgeNormal);
   }
  `).replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
   vGoldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vGoldPosition;
   varying vec3 vGoldRoundedNormal;
   uniform float goldCubeEdge;
   uniform vec3 goldProbePosition;
   uniform mat4 goldWorldToGate;
   uniform vec2 goldFloorHalfSize;

   vec3 goldReflectionDirection(vec3 ray){
    // Reproject nearby hits from the surface point into the moving cube map.
    vec3 origin=(goldWorldToGate*vec4(vGoldPosition,1.0)).xyz;
    vec3 localRay=mat3(goldWorldToGate)*ray;
    // Reproject the near checkerboard. The rotating aperture and distant
    // scenery are sampled directly from the live cube map.
    if(localRay.y>=-.001)return ray;
    float distanceToFloor=-origin.y/localRay.y;
    vec2 floorHit=(origin+localRay*distanceToFloor).xz;
    if(distanceToFloor<=0.0)return ray;
    vec3 fromProbe=vGoldPosition+ray*distanceToFloor-goldProbePosition;
    if(dot(fromProbe,fromProbe)<=.000001)return ray;
    vec2 edge=abs(floorHit)/goldFloorHalfSize;
    float weight=1.0-smoothstep(.90,1.0,max(edge.x,edge.y));
    return normalize(mix(ray,normalize(fromProbe),weight));
   }
  `).replace('#include <envmap_physical_pars_fragment>',environment)
   .replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
    if(goldCubeEdge>0.0)normal=normalize(mix(normal,normalize(vGoldRoundedNormal)*faceDirection,goldCubeEdge));
   `);
 };
 return material;
}

export function createGoldReflectionSky(){
 const material=new T.ShaderMaterial({
  side:T.BackSide,depthWrite:false,toneMapped:false,
  vertexShader:`
   varying vec3 vDirection;
   void main(){
    vDirection=position;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
   }
  `,
  fragmentShader:`
   varying vec3 vDirection;
   void main(){
    vec3 ray=normalize(vDirection);
    vec3 color=mix(vec3(.29,.36,.37),vec3(.49,.57,.65),smoothstep(0.0,.85,ray.y));
    gl_FragColor=vec4(color,1.0);
   }
  `
 });
 const sky=new T.Mesh(new T.SphereGeometry(50,24,12),material);
 sky.renderOrder=-1;
 return sky;
}

export function createGoldReflectionLights(){
 const group=new T.Group();
 group.name='Gold reflection softboxes';
 const panels=[
  {position:[-.55,1.40,3.3],size:[.72,2.3],color:0xffeed6,intensity:2.2},
  {position:[.55,1.40,-3.3],size:[.72,2.3],color:0xffeed6,intensity:2.2},
  {position:[3.0,1.25,3.4],size:[1.15,2.5],color:0xffe9cc,intensity:2.2},
  {position:[-2.65,1.4,-3.5],size:[1.55,2.5],color:0xf1f5ff,intensity:1.8},
  {position:[-2.5,1.25,3.5],size:[1.1,2.5],color:0xf1f5ff,intensity:2.8},
  {position:[1.1,3.5,-2.7],size:[2.5,1.2],color:0xffe5c2,intensity:2.7}
 ];
 for(const {position,size,color,intensity} of panels){
  const material=new T.ShaderMaterial({
   toneMapped:false,transparent:true,depthWrite:false,
   uniforms:{panelColor:{value:new T.Color(color).multiplyScalar(intensity)}},
   vertexShader:`
    varying vec2 vPanelUv;
    void main(){
     vPanelUv=uv;
     gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
    }
   `,
   fragmentShader:`
    varying vec2 vPanelUv;
    uniform vec3 panelColor;
    void main(){
     vec2 edge=abs(vPanelUv*2.0-1.0);
     vec2 falloff=1.0-smoothstep(vec2(.15,.55),vec2(1.0),edge);
     gl_FragColor=vec4(panelColor,falloff.x*falloff.y);
    }
   `
  });
  const panel=new T.Mesh(new T.PlaneGeometry(...size),material);
  panel.position.set(...position);
  panel.lookAt(0,1.5,0);
  panel.layers.set(1);
  group.add(panel);
 }
 return group;
}

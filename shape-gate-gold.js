import * as T from 'three';
import {gateRimRadius} from './shape-gate-geometry.js';

const lightCenter=new T.Vector3(1.65,1.45,4.4);
const lightHalfSize=new T.Vector2(1.75,1);

export function createGoldMaterial(probe,worldToGate){
 const material=new T.MeshStandardMaterial({
  name:'Polished gold',color:0xffd37a,roughness:.16,metalness:1,
  side:T.DoubleSide,envMap:probe.renderTarget.texture
 });
 const environment=T.ShaderChunk.envmap_physical_pars_fragment.replace(
  'envMapRotation * reflectVec, roughness',
  'envMapRotation * goldReflectionDirection(reflectVec), roughness'
 ).replace(
  'return envMapColor.rgb * envMapIntensity;',
  'return (envMapColor.rgb + goldStudioHighlight(reflectVec)) * envMapIntensity;'
 );
 material.onBeforeCompile=shader=>{
  shader.uniforms.goldProbePosition={value:probe.position};
  shader.uniforms.goldWorldToGate={value:worldToGate};
  shader.uniforms.goldLightCenter={value:lightCenter};
  shader.uniforms.goldLightHalfSize={value:lightHalfSize};
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
   varying vec3 vGoldPosition;
  `).replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
   vGoldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vGoldPosition;
   uniform vec3 goldProbePosition;
   uniform mat4 goldWorldToGate;
   uniform vec3 goldLightCenter;
   uniform vec2 goldLightHalfSize;

   float goldSurfaceDistance(vec3 origin,vec3 ray){
    float distanceToHit=1000.0;
    if(ray.y<-.001)distanceToHit=-origin.y/ray.y;
    if(abs(ray.z)>.001){
     float wheelDistance=-origin.z/ray.z;
     vec3 wheelHit=origin+ray*wheelDistance;
     if(wheelDistance>.001&&wheelDistance<distanceToHit&&wheelHit.y>=0.0&&length(wheelHit.xy)<${gateRimRadius.toFixed(4)}){
      distanceToHit=wheelDistance;
     }
    }
    return distanceToHit;
   }

   vec3 goldReflectionDirection(vec3 ray){
    // Reproject nearby hits from the surface point into the moving cube map.
    vec3 origin=(goldWorldToGate*vec4(vGoldPosition,1.0)).xyz;
    vec3 localRay=mat3(goldWorldToGate)*ray;
    vec3 fromProbe=vGoldPosition+ray*goldSurfaceDistance(origin,localRay)-goldProbePosition;
    return dot(fromProbe,fromProbe)>.000001?normalize(fromProbe):ray;
   }

   vec3 goldStudioHighlight(vec3 ray){
    vec3 origin=(goldWorldToGate*vec4(vGoldPosition,1.0)).xyz;
    ray=mat3(goldWorldToGate)*ray;
    if(abs(ray.z)<.001)return vec3(0.0);
    vec3 center=goldLightCenter*vec3(sign(ray.z),1.0,sign(ray.z));
    float distanceToLight=(center.z-origin.z)/ray.z;
    if(distanceToLight<=0.0)return vec3(0.0);
    vec2 hit=abs((origin+ray*distanceToLight).xy-center.xy)/goldLightHalfSize;
    vec2 falloff=1.0-smoothstep(vec2(.34,.16),vec2(1.0),hit);
    float occlusion=length(ray)*(distanceToLight-goldSurfaceDistance(origin,ray));
    float visible=1.0-smoothstep(-.08,.08,occlusion);
    return vec3(1.05,.94,.80)*falloff.x*falloff.y*visible;
   }
  `).replace('#include <envmap_physical_pars_fragment>',environment);
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

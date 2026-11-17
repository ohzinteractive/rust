import * as THREE from 'three';

// A steep sun path stays inside the existing corridor between the kelp walls.
export const kelpSunSlope=Object.freeze({x:-.14,y:1,z:-.52});
export function createKelpSunlight(){
  return {
    waterSunDirection:{value:new THREE.Vector3(kelpSunSlope.x,1,kelpSunSlope.z).normalize()},
    waterLightFocus:{value:new THREE.Vector3(0,-1.15,2.5)},
    waterSurface:{value:9.5},
  };
}

// The same surface opening filters incident sunlight on geometry and in the
// ray march. Visibility from the real kelp shadow map is applied separately.
export const kelpSunlightShader=`
  uniform vec3 waterSunDirection,waterLightFocus;
  uniform float waterSurface;
  vec2 waterSunSlope(){return waterSunDirection.xz/max(waterSunDirection.y,.15);}
  vec2 waterLightOffset(vec3 p){
    return p.xz-waterLightFocus.xz-waterSunSlope()*(p.y-waterLightFocus.y);
  }
  float waterSunWindow(vec3 p){
    vec2 offset=waterLightOffset(p);
    float width=1.7+max(0.0,waterSurface-p.y)*.06;
    return .09+.91*exp(-dot(offset,offset)/(width*width));
  }
  vec3 waterSunTransmission(vec3 p){
    float path=max(0.0,waterSurface-p.y)/max(waterSunDirection.y,.15);
    return exp(-vec3(.057,.031,.026)*path)*waterSunWindow(p);
  }
`;

export function configureKelpSunlight(material,sunlight,indirectDiffuse=1){
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,sunlight);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vUnderwaterWorld;')
      .replace('#include <project_vertex>',`#include <project_vertex>
        vec4 sunPosition=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          sunPosition=instanceMatrix*sunPosition;
        #endif
        vUnderwaterWorld=(modelMatrix*sunPosition).xyz;
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vUnderwaterWorld;
      ${kelpSunlightShader}
    `).replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
      void RE_Direct_Underwater(const in IncidentLight light,const in vec3 position,
        const in vec3 normal,const in vec3 viewDir,const in vec3 coatNormal,
        const in PhysicalMaterial surface,inout ReflectedLight reflected){
        IncidentLight filtered=light;
        vec3 worldLight=inverseTransformDirection(light.direction,viewMatrix);
        float isSun=smoothstep(.98,.999,dot(worldLight,waterSunDirection));
        filtered.color*=mix(vec3(1.0),waterSunTransmission(vUnderwaterWorld),isSun);
        RE_Direct_Physical(filtered,position,normal,viewDir,coatNormal,surface,reflected);
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_Underwater
    `).replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      reflectedLight.indirectDiffuse*=${indirectDiffuse.toFixed(3)};
    `);
  };
  material.customProgramCacheKey=()=>`underwater-sun-window-v1/${indirectDiffuse}`;
}

import * as THREE from 'three';

// Bird-skin inspired pigment, fine pores and shallow creases in bind-space.
// restPosition is supplied by both the shape builder and the GLB importer, so
// the surface detail follows morphs and skinning without swimming through it.
export function createSkinMaterial(color = '#c68f79', subsurface = .35) {
  const material = new THREE.MeshPhysicalMaterial({
    name:'Feather skin', color, roughness:.64, metalness:0,
    clearcoat:.06, clearcoatRoughness:.7, sheen:.12, sheenColor:0xd9aaa0
  });
  const scattering = {value:THREE.MathUtils.clamp(subsurface,0,1)};
  const detailScale={value:1};
  material.userData.skinSubsurface = scattering;
  material.userData.skinDetailScale=detailScale;
  material.onBeforeCompile = shader => {
    shader.uniforms.uSkinSubsurface = scattering;
    shader.uniforms.uSkinDetailScale=detailScale;
    shader.vertexShader = `attribute vec3 restPosition;
      varying vec3 vSkinPosition;
      ${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPosition = restPosition;');
    shader.fragmentShader = `uniform float uSkinSubsurface;
      uniform float uSkinDetailScale;
      varying vec3 vSkinPosition;
      float skinHash(vec3 p) { p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z); }
      // Rotated, C2-continuous noise with analytic derivatives keeps close-up
      // pores smooth, without the old axis-aligned blocks or derivative aliasing.
      vec4 skinNoiseD(vec3 p) {
        mat3 frame=mat3(.00,.80,.60,-.80,.36,-.48,-.60,-.48,.64);
        p=frame*p;
        vec3 cell=floor(p),f=fract(p),u=f*f*f*(f*(f*6.0-15.0)+10.0);
        vec3 du=30.0*f*f*(f-1.0)*(f-1.0);
        float a=skinHash(cell),b=skinHash(cell+vec3(1,0,0)),c=skinHash(cell+vec3(0,1,0)),d=skinHash(cell+vec3(1,1,0));
        float e=skinHash(cell+vec3(0,0,1)),g=skinHash(cell+vec3(1,0,1)),h=skinHash(cell+vec3(0,1,1)),i=skinHash(cell+vec3(1,1,1));
        float k1=b-a,k2=c-a,k3=e-a,k4=a-b-c+d,k5=a-c-e+h,k6=a-b-e+g,k7=-a+b+c-d+e-g-h+i;
        float value=a+k1*u.x+k2*u.y+k3*u.z+k4*u.x*u.y+k5*u.y*u.z+k6*u.z*u.x+k7*u.x*u.y*u.z;
        vec3 gradient=du*vec3(k1+k4*u.y+k6*u.z+k7*u.y*u.z,k2+k4*u.x+k5*u.z+k7*u.x*u.z,k3+k5*u.y+k6*u.x+k7*u.x*u.y);
        return vec4(value,gradient*frame);
      }
      float skinNoise(vec3 p) { return skinNoiseD(p).x; }
      float skinBand(float frequency,float footprint) { return 1.0-smoothstep(.2,.8,frequency*footprint); }
      float skinFilteredNoise(vec3 p,float frequency,float footprint) { return mix(.5,skinNoise(p*frequency),skinBand(frequency,footprint)); }
      vec3 skinHeightGradient(vec3 p,float footprint) {
        vec4 pores=skinNoiseD(p*135.0),grain=skinNoiseD(p*410.0+17.0),creases=skinNoiseD(p*57.0+9.0);
        float t=clamp((pores.x-.25)/.25,0.0,1.0),poreSlope=-6.0*t*(1.0-t)/.25;
        return pores.yzw*(-.00025*poreSlope*135.0*skinBand(135.0,footprint))
          +grain.yzw*(.000035*410.0*skinBand(410.0,footprint))
          +creases.yzw*(.0002*57.0*skinBand(57.0,footprint));
      }
      ${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 skinP=vSkinPosition*uSkinDetailScale;
        float skinFootprint=max(length(dFdx(skinP)),length(dFdy(skinP)));
        float mottling=skinFilteredNoise(skinP,14.3,skinFootprint);
        float finePigment=skinFilteredNoise(skinP,135.0,skinFootprint);
        diffuseColor.rgb *= mix(vec3(.94,.90,.87),vec3(1.02,1.0,.96),mottling);
        diffuseColor.rgb *= .985+.03*finePigment;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 skinGradient=skinHeightGradient(skinP,skinFootprint);
        vec3 skinDx = dFdx(-vViewPosition), skinDy = dFdy(-vViewPosition);
        vec3 skinRx = cross(skinDy, normal), skinRy = cross(normal, skinDx);
        float skinDet = dot(skinDx, skinRx);
        normal = normalize(abs(skinDet) * normal - sign(skinDet) *
          (dot(skinGradient,dFdx(vSkinPosition)) * skinRx + dot(skinGradient,dFdy(vSkinPosition)) * skinRy));
      `)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
        // Real-time skin approximation: broaden part of the diffuse response
        // and add attenuated warm back-scattering. Direct light is already
        // shadowed by Three.js; the feather contact mask also applies later.
        void RE_Direct_Skin(const in IncidentLight light, const in vec3 position,
          const in vec3 normal, const in vec3 viewDir, const in vec3 coatNormal,
          const in PhysicalMaterial skin, inout ReflectedLight reflected) {
          vec3 previousDiffuse = reflected.directDiffuse;
          RE_Direct_Physical(light, position, normal, viewDir, coatNormal, skin, reflected);
          if (uSkinSubsurface <= 0.0) return;
          float nDotL = dot(normal, light.direction);
          vec3 widths = vec3(0.6, 0.35, 0.2);
          vec3 wrapped = max(vec3(nDotL) + widths, vec3(0.0)) / ((1.0 + widths) * (1.0 + widths));
          float thickness = mix(0.3, 0.8, skinNoise(vSkinPosition * 3.7));
          vec3 attenuation = exp(-vec3(0.7, 2.0, 3.5) * thickness);
          vec3 throughDirection = normalize(light.direction + normal * 0.35);
          float viewLobe = pow(clamp(dot(viewDir, -throughDirection), 0.0, 1.0), 3.0);
          float backlight = max(-nDotL, 0.0) * (0.18 + 0.32 * viewLobe);
          vec3 scattered = light.color * skin.diffuseColor * RECIPROCAL_PI *
            (wrapped * vec3(1.0, 0.85, 0.7) + attenuation * backlight);
          vec3 standardDiffuse = reflected.directDiffuse - previousDiffuse;
          reflected.directDiffuse = previousDiffuse + mix(standardDiffuse, scattered, clamp(uSkinSubsurface, 0.0, 1.0));
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Skin
      `);
  };
  material.customProgramCacheKey = () => 'feather-skin-subsurface-v5';
  return material;
}

export function createFollicleGeometry() {
  const rim = new THREE.TorusGeometry(.0105, .003, 4, 10).toNonIndexed();
  const opening = new THREE.CircleGeometry(.008, 10).toNonIndexed();
  opening.translate(0, 0, -.0002);
  const positions = [], normals = [], colors = [];
  for (const [geometry, pigment] of [[rim, [.96,.87,.82]], [opening, [.19,.075,.055]]]) {
    positions.push(...geometry.attributes.position.array);
    normals.push(...geometry.attributes.normal.array);
    for (let i = 0; i < geometry.attributes.position.count; i++) colors.push(...pigment);
    geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

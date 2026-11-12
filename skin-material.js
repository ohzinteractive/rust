import * as THREE from 'three';

// Bird-skin inspired pigment, fine pores and shallow creases in bind-space.
// restPosition is supplied by both the shape builder and the GLB importer, so
// the surface detail follows morphs and skinning without swimming through it.
export function createSkinMaterial(color = '#c68f79', subsurface = .35) {
  const material = new THREE.MeshPhysicalMaterial({
    name:'Feather skin', color, roughness:.64, metalness:0,
    clearcoat:.06, clearcoatRoughness:.7, sheen:.12, sheenColor:0xd9aaa0
  });
  const scattering = {value:subsurface};
  material.userData.skinSubsurface = scattering;
  material.onBeforeCompile = shader => {
    shader.uniforms.uSkinSubsurface = scattering;
    shader.vertexShader = `attribute vec3 restPosition;
      varying vec3 vSkinPosition;
      ${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPosition = restPosition;');
    shader.fragmentShader = `uniform float uSkinSubsurface;
      varying vec3 vSkinPosition;
      float skinHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float skinNoise(vec3 p) {
        vec3 cell = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(skinHash(cell), skinHash(cell + vec3(1,0,0)), f.x),
          mix(skinHash(cell + vec3(0,1,0)), skinHash(cell + vec3(1,1,0)), f.x), f.y),
          mix(mix(skinHash(cell + vec3(0,0,1)), skinHash(cell + vec3(1,0,1)), f.x),
          mix(skinHash(cell + vec3(0,1,1)), skinHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float skinHeight(vec3 p) {
        float pores = skinNoise(p * 115.0);
        float folds = pow(0.5 + 0.5 * sin(p.y * 36.0 + skinNoise(p * 5.0) * 5.0), 8.0);
        return (pores - 0.5) * 0.0013 - folds * 0.00045;
      }
      ${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#include <map_fragment>
        float mottling = skinNoise(vSkinPosition * 5.5);
        float finePigment = skinNoise(vSkinPosition * 72.0);
        diffuseColor.rgb *= mix(vec3(0.79,0.64,0.61), vec3(1.04,0.99,0.86), mottling);
        diffuseColor.rgb *= 0.95 + 0.08 * finePigment;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float skinBump = skinHeight(vSkinPosition);
        vec3 skinDx = dFdx(-vViewPosition), skinDy = dFdy(-vViewPosition);
        vec3 skinRx = cross(skinDy, normal), skinRy = cross(normal, skinDx);
        float skinDet = dot(skinDx, skinRx);
        normal = normalize(abs(skinDet) * normal - sign(skinDet) *
          (dFdx(skinBump) * skinRx + dFdy(skinBump) * skinRy));
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
          reflected.directDiffuse = previousDiffuse + mix(standardDiffuse, scattered, uSkinSubsurface);
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Skin
      `);
  };
  material.customProgramCacheKey = () => 'feather-skin-subsurface-v2';
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

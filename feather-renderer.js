import * as THREE from 'three';
import {createFeatherShadowRenderer} from './feather-shadows.js';

// Weighted blended OIT (McGuire/Bavoil). Separate accumulation and revealage
// passes work in WebGL 2 without per-attachment blending extensions. Colors
// stay linear until the final screen pass applies tone mapping exactly once.
export function createFeatherRenderer({renderer, feathers, shadowLight}) {
  const supported = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  feathers.setHashedTransparency(!supported);
  const size = new THREE.Vector2(), clearColor = new THREE.Color();
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  const resolution = {value:new THREE.Vector2(1, 1)};
  const cameraRange = {value:new THREE.Vector2(.1, 80)};
  const opaqueDepth = {value:null};
  const passScene = new THREE.Scene(), cache = new Map();
  let opaque = null, accumulation = null, revealage = null;
  let width = 0, height = 0;
  const shadows=shadowLight?createFeatherShadowRenderer({renderer,feathers,light:shadowLight}):null;

  const compositeMaterial = new THREE.ShaderMaterial({
    depthTest:false, depthWrite:false, blending:THREE.NoBlending,
    toneMapped:true, premultipliedAlpha:true,
    uniforms:{opaque:{value:null}, accumulation:{value:null}, revealage:{value:null}},
    vertexShader:`varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader:`varying vec2 vUv;
      uniform sampler2D opaque;
      uniform sampler2D accumulation;
      uniform sampler2D revealage;
      void main() {
        vec4 background = texture2D(opaque, vUv);
        vec4 sum = texture2D(accumulation, vUv);
        float transmission = clamp(texture2D(revealage, vUv).r, 0.0, 1.0);
        float coverage = 1.0 - transmission;
        vec3 featherColor = sum.rgb / max(sum.a, 0.00001);
        float alpha = coverage + background.a * transmission;
        vec3 premultiplied = featherColor * coverage + background.rgb * transmission;
        gl_FragColor = vec4(premultiplied / max(alpha, 0.00001), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }`
  });
  const compositeScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
  quad.frustumCulled = false;
  compositeScene.add(quad);
  const compositeCamera = new THREE.Camera();

  function ensureTargets(w, h) {
    if (w === width && h === height) return;
    width = w; height = h;
    if (!opaque) {
      const options = {type:THREE.HalfFloatType, minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, stencilBuffer:false};
      const samples = Math.min(4, renderer.capabilities.maxSamples);
      opaque = new THREE.WebGLRenderTarget(w, h, {...options, samples});
      opaque.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      accumulation = new THREE.WebGLRenderTarget(w, h, {...options, samples, depthBuffer:false});
      revealage = new THREE.WebGLRenderTarget(w, h, {...options, samples, depthBuffer:false});
      compositeMaterial.uniforms.opaque.value = opaque.texture;
      compositeMaterial.uniforms.accumulation.value = accumulation.texture;
      compositeMaterial.uniforms.revealage.value = revealage.texture;
      opaqueDepth.value = opaque.depthTexture;
    } else for (const target of [opaque, accumulation, revealage]) target.setSize(w, h);
    resolution.value.set(w, h);
  }

  function makePassMaterial(base, pass) {
    const material = base.clone();
    material.transparent = true;
    material.alphaHash = false;
    material.depthTest = false;
    material.depthWrite = false;
    material.toneMapped = false;
    material.premultipliedAlpha = false;
    material.blending = THREE.CustomBlending;
    material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrc = material.blendSrcAlpha = pass === 'accumulation' ? THREE.OneFactor : THREE.ZeroFactor;
    material.blendDst = material.blendDstAlpha = pass === 'accumulation' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
    material.customProgramCacheKey = () => `${base.customProgramCacheKey()}/weighted-${pass}-v1`;
    material.onBeforeCompile = shader => {
      base.onBeforeCompile(shader, renderer);
      Object.assign(shader.uniforms, {uOpaqueDepth:opaqueDepth, uOitResolution:resolution, uOitCamera:cameraRange});
      shader.fragmentShader = `uniform sampler2D uOpaqueDepth;
        uniform vec2 uOitResolution;
        uniform vec2 uOitCamera;
        ${shader.fragmentShader}`
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float surfaceDepth = texture2D(uOpaqueDepth, gl_FragCoord.xy / uOitResolution).r;
          if (gl_FragCoord.z > surfaceDepth + 0.0000002) discard;
        `)
        .replace('#include <tonemapping_fragment>', '')
        .replace('#include <colorspace_fragment>', '')
        .replace('#include <premultiplied_alpha_fragment>', '')
        .replace(/}\s*$/, `
          float alpha = clamp(gl_FragColor.a, 0.0, 1.0);
          if (alpha <= 0.0) discard;
          ${pass === 'accumulation' ? `
            float viewDepth = uOitCamera.x * uOitCamera.y /
              (uOitCamera.y - gl_FragCoord.z * (uOitCamera.y - uOitCamera.x));
            // Bounded weights keep dense filament sums in FP16 range.
            float weight = clamp(pow(alpha + 0.01, 3.0) /
              pow(1.0 + viewDepth * 0.1, 3.0), 0.01, 1.0);
            gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha) * weight;
          ` : 'gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);'}
        }`);
    };
    return material;
  }

  function passEntry(batch) {
    const base = batch.material;
    if (!cache.has(base)) {
      const entry = {accumulation:makePassMaterial(base, 'accumulation'), revealage:makePassMaterial(base, 'revealage')};
      entry.proxy = batch.isMesh ? new THREE.Mesh(batch.geometry, entry.accumulation) : new THREE.LineSegments(batch.geometry, entry.accumulation);
      entry.proxy.matrixAutoUpdate = false;
      entry.proxy.frustumCulled = false;
      entry.dispose = () => {
        entry.proxy.removeFromParent();
        entry.accumulation.dispose(); entry.revealage.dispose();
        base.removeEventListener('dispose', entry.dispose); cache.delete(base);
      };
      base.addEventListener('dispose', entry.dispose); cache.set(base, entry);
    }
    const entry = cache.get(base);
    entry.proxy.geometry = batch.geometry;
    entry.proxy.matrix.copy(batch.matrixWorld);
    entry.proxy.renderOrder = batch.renderOrder;
    entry.accumulation.opacity = entry.revealage.opacity = base.opacity;
    return entry;
  }

  return {
    get mode() { return supported ? 'weighted' : 'alpha-hash'; },
    get shadowRenders(){return shadows?.renders??0;},
    render(scene, camera) {
      feathers.updateView?.(camera);
      shadows?.update(scene,camera);
      const group = feathers.group;
      if (!supported || !group.parent || !group.visible || !feathers.translucent) {
        renderer.render(scene, camera); return;
      }
      const previousTarget = renderer.getRenderTarget();
      if (previousTarget) size.set(previousTarget.width, previousTarget.height);
      else renderer.getDrawingBufferSize(size);
      ensureTargets(size.x, size.y);
      cameraRange.value.set(camera.near, camera.far);
      const previousAutoClear = renderer.autoClear;
      const previousAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColor);
      renderer.getViewport(viewport); renderer.getScissor(scissor);
      const previousScissorTest = renderer.getScissorTest();
      const visible = group.visible;
      try {
        renderer.setScissorTest(false);
        renderer.autoClear = true;
        group.visible = false;
        renderer.setRenderTarget(opaque);
        renderer.render(scene, camera);
        group.visible = visible;
        renderer.autoClear = false;
        passScene.fog = scene.fog;
        const entries = group.children.filter(batch => batch.visible).map(passEntry);
        for (const [name, target, color, alpha] of [
          ['accumulation', accumulation, 0x000000, 0], ['revealage', revealage, 0xffffff, 1]
        ]) {
          passScene.clear();
          for (const entry of entries) { entry.proxy.material = entry[name]; passScene.add(entry.proxy); }
          renderer.setRenderTarget(target);
          renderer.setClearColor(color, alpha); renderer.clear(true, false, false);
          renderer.render(passScene, camera);
        }
        renderer.setRenderTarget(previousTarget);
        if (!previousTarget) renderer.setViewport(viewport);
        renderer.render(compositeScene, compositeCamera);
      } finally {
        group.visible = visible;
        renderer.autoClear = previousAutoClear;
        renderer.setClearColor(clearColor, previousAlpha);
        renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(previousScissorTest);
        renderer.setRenderTarget(previousTarget);
      }
    },
    dispose() {
      for (const entry of [...cache.values()]) entry.dispose();
      for (const target of [opaque, accumulation, revealage]) target?.dispose();
      quad.geometry.dispose(); compositeMaterial.dispose();
      shadows?.dispose();
    }
  };
}

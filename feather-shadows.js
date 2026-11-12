import * as THREE from 'three';

export function createFeatherShadowUniforms(strength) {
  return {uFeatherShadowMap:{value:null},uFeatherShadowMatrix:{value:new THREE.Matrix4()},
    uFeatherShadowTexel:{value:new THREE.Vector2()},uFeatherShadowStrength:{value:strength},uFeatherShadowReady:{value:0}};
}

export function receiveFeatherShadows(material, uniforms) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `uniform mat4 uFeatherShadowMatrix;
      varying vec4 vFeatherShadowCoord;
      ${shader.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 featherShadowWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          featherShadowWorld = instanceMatrix * featherShadowWorld;
        #endif
        vFeatherShadowCoord = uFeatherShadowMatrix * modelMatrix * featherShadowWorld;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <packing>','');
    shader.fragmentShader = `#include <packing>
      uniform sampler2D uFeatherShadowMap;
      uniform vec2 uFeatherShadowTexel;
      uniform float uFeatherShadowStrength;
      uniform float uFeatherShadowReady;
      varying vec4 vFeatherShadowCoord;
      float featherShadowMask() {
        vec3 p = vFeatherShadowCoord.xyz / vFeatherShadowCoord.w;
        vec3 dx = dFdx(p), dy = dFdy(p);
        if (uFeatherShadowReady < 0.5 || uFeatherShadowStrength <= 0.0) return 1.0;
        if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z <= 0.0 || p.z >= 1.0) return 1.0;
        // Receiver-plane depth correction keeps the soft filter from treating
        // neighbouring texels of the same sloping vane as an occluder.
        float det = dx.x * dy.y - dx.y * dy.x;
        vec2 slope = abs(det) > 0.0000000001 ? vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / det : vec2(0.0);
        float visibility = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 offset = vec2(float(x),float(y)) * uFeatherShadowTexel * 1.25;
          float depth = unpackRGBAToDepth(texture2D(uFeatherShadowMap, p.xy + offset));
          visibility += step(p.z + dot(slope,offset) - 0.00008, depth);
        }
        return 1.0 - uFeatherShadowStrength * (1.0 - visibility / 9.0);
      }
      ${shader.fragmentShader}`.replace('#include <opaque_fragment>', 'outgoingLight *= featherShadowMask();\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => key() + '/feather-shadow-v1';
}

export function createFeatherShadowRenderer({renderer, feathers, light}) {
  const uniforms = feathers.shadowUniforms;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
  const proxies = new WeakMap(), bounds = new THREE.Box3(), point = new THREE.Vector3(), targetPoint = new THREE.Vector3();
  const clearColor = new THREE.Color(), viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  const matrixState = new THREE.Matrix4(), lightState = new THREE.Matrix4(), targetState = new THREE.Matrix4();
  const bias = new THREE.Matrix4().set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1);
  let target = null, lastVersion = -1, renders = 0;
  return {
    update(root) {
      const group = feathers.group;
      if (!group.parent || !group.visible || !feathers.shadowEnabled) {uniforms.uFeatherShadowReady.value=0;return;}
      root.updateMatrixWorld(true);light.updateWorldMatrix(true,false);light.target.updateWorldMatrix(true,false);
      if (lastVersion === feathers.shadowVersion && uniforms.uFeatherShadowReady.value && matrixState.equals(group.matrixWorld) && lightState.equals(light.matrixWorld) && targetState.equals(light.target.matrixWorld)) return;
      const casters = group.children.filter(batch => batch.isMesh && batch.visible && batch.customDepthMaterial);
      if (!casters.length) {uniforms.uFeatherShadowReady.value=0;return;}
      if (!target) {
        const resolution = Math.min(2048,renderer.capabilities.maxTextureSize);
        target = new THREE.WebGLRenderTarget(resolution,resolution,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,stencilBuffer:false});
        uniforms.uFeatherShadowMap.value=target.texture;uniforms.uFeatherShadowTexel.value.setScalar(1/resolution);
      }
      camera.position.setFromMatrixPosition(light.matrixWorld);targetPoint.setFromMatrixPosition(light.target.matrixWorld);
      camera.lookAt(targetPoint);camera.updateMatrixWorld(true);bounds.makeEmpty();
      scene.clear();
      for (const batch of casters) {
        const anchors=batch.geometry.attributes.featherPosition;
        for(let i=0;i<anchors.count;i++)bounds.expandByPoint(point.fromBufferAttribute(anchors,i).applyMatrix4(batch.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
        if(!proxies.has(batch)){const proxy=new THREE.Mesh(batch.geometry,batch.customDepthMaterial);proxy.matrixAutoUpdate=false;proxy.frustumCulled=false;proxies.set(batch,proxy);}
        const proxy=proxies.get(batch);proxy.matrix.copy(batch.matrixWorld);scene.add(proxy);
      }
      const padding=feathers.shadowPadding;
      camera.left=bounds.min.x-padding;camera.right=bounds.max.x+padding;
      camera.bottom=bounds.min.y-padding;camera.top=bounds.max.y+padding;
      camera.near=Math.max(.01,-bounds.max.z-padding);camera.far=Math.max(camera.near+.1,-bounds.min.z+padding);camera.updateProjectionMatrix();
      uniforms.uFeatherShadowMatrix.value.copy(bias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
      const previousTarget=renderer.getRenderTarget(),previousAlpha=renderer.getClearAlpha(),previousAutoClear=renderer.autoClear,previousScissor=renderer.getScissorTest();
      renderer.getClearColor(clearColor);renderer.getViewport(viewport);renderer.getScissor(scissor);
      try {
        renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.autoClear=true;renderer.setClearColor(0xffffff,1);
        renderer.render(scene,camera);uniforms.uFeatherShadowReady.value=1;renders++;
        lastVersion=feathers.shadowVersion;matrixState.copy(group.matrixWorld);lightState.copy(light.matrixWorld);targetState.copy(light.target.matrixWorld);
      } finally {
        renderer.autoClear=previousAutoClear;renderer.setClearColor(clearColor,previousAlpha);
        renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(previousScissor);renderer.setRenderTarget(previousTarget);
      }
    },
    get renders(){return renders;},
    dispose(){scene.clear();target?.dispose();uniforms.uFeatherShadowMap.value=null;uniforms.uFeatherShadowReady.value=0;}
  };
}

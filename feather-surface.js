import * as THREE from 'three';
import { generateFeatherData } from './plume-lsystem/feather-generator.js';
import { createSurfaceSampler, readFeatherAnchor } from './feather-sampling.js';
import {seededRandom} from './plume-lsystem/random.js';
import {createSkinMaterial, createFollicleGeometry} from './skin-material.js';
import {plumageFrame, createContourVane} from './plumage-frame.js';
import {createFeatherShadowUniforms,receiveFeatherShadows} from './feather-shadows.js';

const FULL_DENSITY_PER_UNIT = 100;
const OUT = new THREE.Vector3(0, 0, 1);
export const defaultFeatherSettings = Object.freeze({length:1, width:1, detail:.38, angle:26, opacity:1, shadow:.35, subsurface:.35, breeze:0, windDirection:0, lift:22, flowDirection:0, skinColor:'#c68f79'});

export function createFeatherSurface() {
  const group = new THREE.Group();
  group.name = 'Mesh feathers';
  const substrate = createSkinMaterial(defaultFeatherSettings.skinColor, defaultFeatherSettings.subsurface);
  const follicleGroup = new THREE.Group();follicleGroup.name = 'Skin follicles';
  const follicleGeometry = createFollicleGeometry();
  const follicleMaterial = new THREE.MeshStandardMaterial({color:defaultFeatherSettings.skinColor, vertexColors:true, roughness:.72});
  let follicles = null;
  const position = new THREE.Vector3(), normal = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), follicleRotation = new THREE.Quaternion();
  const follicleScale = new THREE.Vector3(), follicleMatrix = new THREE.Matrix4();
  let samples = [], meshes = [], parent = null, sampler = null, seed = 0;
  const settings = {...defaultFeatherSettings};
  const shadowUniforms=createFeatherShadowUniforms(settings.shadow);
  receiveFeatherShadows(substrate,shadowUniforms);receiveFeatherShadows(follicleMaterial,shadowUniforms);
  let shadowVersion=0;
  const sizeUniform = {value:new THREE.Vector2(settings.width, settings.length)};
  const timeUniform = {value:0}, breezeUniform = {value:settings.breeze};
  const windUniform = {value:new THREE.Vector3(1, 0, 0)};
  const inverseParent = new THREE.Matrix4();
  let hashedTransparency = false;

  function configureOpacity(batch) {
    const material = batch.material, translucent = settings.opacity < 1;
    const alphaHash = translucent && hashedTransparency;
    const transparent = translucent && !alphaHash;
    if (material.transparent !== transparent || material.alphaHash !== alphaHash) material.needsUpdate = true;
    material.opacity = settings.opacity;
    material.transparent = transparent;
    material.alphaHash = alphaHash;
    material.depthWrite = !translucent || alphaHash;
    batch.visible = settings.opacity > 0;
    if(batch.customDepthMaterial){
      const depth=batch.customDepthMaterial;
      if(depth.alphaHash!==translucent)depth.needsUpdate=true;
      depth.alphaHash=translucent;depth.opacity=settings.opacity;
    }
  }

  function updateWindDirection() {
    const angle = settings.windDirection * Math.PI / 180;
    // Compass bearings describe where the breeze blows in world space:
    // East = +X, North = -Z. Orbiting the camera never rotates the wind.
    windUniform.value.set(Math.cos(angle), 0, -Math.sin(angle));
    if (parent) {
      parent.updateWorldMatrix(true, false);
      windUniform.value.transformDirection(inverseParent.copy(parent.matrixWorld).invert());
    }
  }

  function clearBatches() {
    for (const batch of group.children) { batch.geometry.dispose(); batch.material.dispose();batch.customDepthMaterial?.dispose(); }
    group.clear();
  }
  function makeBatch(variant, anchors) {
    // Four reusable variants keep the original filament detail without issuing
    // a draw call for every feather or duplicating its geometry in memory.
    const data = generateFeatherData({variation:variant + 1, seed, density:settings.detail, depth:2, branchAngle:settings.angle * Math.PI / 180, quillFraction:.18, contour:true});
    const positions = [], colors = [];
    for (const [layer, shade] of [[data.hairs,.58], [data.barbs,.66], [data.shaft,.83]]) {
      for (let i = 0; i < layer.p.length; i += 3) positions.push(layer.p[i], layer.p[i + 1] + 2.4, layer.p[i + 2]);
      // The spline study stores HDR light intensities. Mesh feathers use
      // bounded pigment colors so a filament cannot emit excess brightness.
      for (let i = 0; i < layer.c.length; i += 3) {
        if (layer === data.hairs) {
          // The additive study fades fibres toward black. Under alpha blending
          // these should retain keratin pigment rather than outline the vane.
          const pigment = .56 + .1 * Math.min(1, layer.c[i]);
          colors.push(pigment, pigment * .84, pigment * .66);
        } else colors.push(Math.min(1,layer.c[i]*shade),Math.min(1,layer.c[i+1]*shade),Math.min(1,layer.c[i+2]*shade));
      }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('featherPosition', new THREE.InstancedBufferAttribute(new Float32Array(anchors.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('featherRotation', new THREE.InstancedBufferAttribute(new Float32Array(anchors.length * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('featherScale', new THREE.InstancedBufferAttribute(new Float32Array(anchors.map(s => s.scale)), 1));
    geometry.instanceCount = anchors.length;
    const material = new THREE.LineBasicMaterial({vertexColors:true});
    material.onBeforeCompile = shader => {
      shader.uniforms.uFeatherSize = sizeUniform;
      shader.uniforms.uFeatherTime = timeUniform;
      shader.uniforms.uFeatherBreeze = breezeUniform;
      shader.uniforms.uFeatherWind = windUniform;
      shader.vertexShader = `uniform vec2 uFeatherSize;
        uniform float uFeatherTime;
        uniform float uFeatherBreeze;
        uniform vec3 uFeatherWind;
        attribute vec3 featherPosition;
        attribute vec4 featherRotation;
        attribute float featherScale;
        ${shader.vertexShader}`.replace('#include <begin_vertex>', `
        vec3 v = position * featherScale * vec3(uFeatherSize.x, uFeatherSize.y, uFeatherSize.x);
        vec3 transformed = v + 2.0 * cross(featherRotation.xyz, cross(featherRotation.xyz, v) + featherRotation.w * v) + featherPosition;
        // Bend grows quadratically from the attached root to the free tip.
        // Shared gusts and per-feather flutter keep the motion from marching
        // in lockstep. All displacement vanishes at the root and at 0% breeze.
        float height = clamp(position.y / 5.0, 0.0, 1.0);
        float phase = dot(featherPosition, vec3(2.31, 3.17, 1.73)) + featherRotation.w * 7.0;
        float gust = 0.68 + 0.20 * sin(uFeatherTime * 1.1 + phase * 0.3)
          + 0.12 * sin(uFeatherTime * 2.3 + phase);
        float flutter = 0.06 * sin(uFeatherTime * 6.2 + phase + height * 4.0);
        vec3 axis = vec3(0.0, 1.0, 0.0);
        axis += 2.0 * cross(featherRotation.xyz, cross(featherRotation.xyz, axis) + featherRotation.w * axis);
        vec3 downwind = uFeatherWind - axis * dot(uFeatherWind, axis);
        float reach = featherScale * 5.0 * uFeatherSize.y;
        float bend = uFeatherBreeze * (gust + flutter) * height * height;
        transformed += downwind * reach * 0.65 * bend;
        transformed -= axis * reach * 0.16 * uFeatherBreeze * uFeatherBreeze
          * height * height * height * dot(downwind, downwind);
        #ifdef USE_ALPHAHASH
          vPosition = transformed;
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'mesh-feather-instances-v4';
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.userData.anchors = anchors;
    configureOpacity(lines);
    group.add(lines);
    const vaneGeometry = createContourVane(data.barbs, data.shaft);
    for (const name of ['featherPosition','featherRotation','featherScale']) vaneGeometry.setAttribute(name, geometry.attributes[name]);
    vaneGeometry.instanceCount = anchors.length;
    const vaneMaterial = new THREE.MeshBasicMaterial({vertexColors:true, side:THREE.DoubleSide, forceSinglePass:true});
    vaneMaterial.onBeforeCompile = material.onBeforeCompile;
    vaneMaterial.customProgramCacheKey = material.customProgramCacheKey;
    const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
    depthMaterial.onBeforeCompile=material.onBeforeCompile;
    depthMaterial.customProgramCacheKey=()=> 'feather-shadow-depth-v1';
    const vane = new THREE.Mesh(vaneGeometry, vaneMaterial);
    vane.customDepthMaterial=depthMaterial;
    vane.name = 'Contour vane';vane.frustumCulled = false;
    receiveFeatherShadows(material,shadowUniforms);receiveFeatherShadows(vaneMaterial,shadowUniforms);
    configureOpacity(vane);group.add(vane);
  }
  function buildBatches() {
    for (let i = 0; i < 4; i++) {
      const anchors = samples.filter((_, index) => index % 4 === i);
      if (anchors.length) makeBatch(i, anchors);
    }
    update();updateWindDirection();
  }
  function update() {
    if (!parent || !samples.length) return;
    parent.updateWorldMatrix(true, true);
    meshes.forEach(mesh => mesh.skeleton?.update());
    for (const batch of group.children) {
      if (!batch.isLineSegments) continue;
      const p = batch.geometry.attributes.featherPosition, q = batch.geometry.attributes.featherRotation;
      batch.userData.anchors.forEach((sample, i) => {
        readFeatherAnchor(sample, parent, position, normal);
        position.addScaledVector(normal, -.017);
        plumageFrame(normal, settings.lift, settings.flowDirection, sample.fan, rotation, sample.position);
        p.setXYZ(i, position.x, position.y, position.z);
        q.setXYZW(i, rotation.x, rotation.y, rotation.z, rotation.w);
        follicleRotation.setFromUnitVectors(OUT, normal);
        follicleScale.setScalar(sample.scale / .105);
        follicles?.setMatrixAt(sample.index, follicleMatrix.compose(position, follicleRotation, follicleScale));
      });
      p.needsUpdate = true; q.needsUpdate = true;
    }
    if (follicles) follicles.instanceMatrix.needsUpdate = true;
    shadowVersion++;
  }
  return {
    group, substrate, follicleGroup,shadowUniforms,
    setSettings(values) {
      const regenerate = (values.detail !== undefined && values.detail !== settings.detail) || (values.angle !== undefined && values.angle !== settings.angle);
      const reorient = (values.lift !== undefined && values.lift !== settings.lift) || (values.flowDirection !== undefined && values.flowDirection !== settings.flowDirection);
      if(['length','width','opacity','breeze','windDirection'].some(key=>values[key]!==undefined&&values[key]!==settings[key]))shadowVersion++;
      Object.assign(settings, values);
      shadowUniforms.uFeatherShadowStrength.value=settings.shadow;
      substrate.color.set(settings.skinColor);follicleMaterial.color.set(settings.skinColor);
      substrate.userData.skinSubsurface.value=settings.subsurface;
      sizeUniform.value.set(settings.width, settings.length);
      breezeUniform.value = settings.breeze;
      updateWindDirection();
      if (regenerate) { clearBatches(); buildBatches(); }
      else {for (const batch of group.children) configureOpacity(batch);if(reorient)update();}
    },
    get translucent() { return settings.opacity > 0 && settings.opacity < 1 && samples.length > 0; },
    get shadowEnabled(){return settings.shadow>0&&settings.opacity>0&&samples.length>0;},
    get shadowVersion(){return shadowVersion;},
    get shadowPadding(){return .65*Math.max(1,settings.length,settings.width)+.15;},
    setHashedTransparency(enabled) {
      hashedTransparency = enabled;
      for (const batch of group.children) configureOpacity(batch);
    },
    advance(dt) {
      if (!parent || !group.visible || !samples.length || settings.opacity <= 0 || settings.breeze <= 0 || !(dt > 0)) return false;
      timeUniform.value += Math.min(dt, .1);
      shadowVersion++;
      updateWindDirection();
      return true;
    },
    rebuild(sourceMeshes, effectParent, density, nextSeed) {
      clearBatches();
      group.removeFromParent(); effectParent.add(group);
      follicles?.dispose();follicleGroup.clear();follicleGroup.removeFromParent();effectParent.add(follicleGroup);
      // Cache area data across slider input; rebuild it when the model, seed or
      // geometry changes. Animation only updates the barycentric attachments.
      if (parent !== effectParent || seed !== nextSeed || meshes.length !== sourceMeshes.length || sourceMeshes.some((mesh, i) => meshes[i] !== mesh || meshes[i].geometry !== sampler?.geometries[i])) {
        meshes = [...sourceMeshes]; parent = effectParent; seed = nextSeed;
        sampler = createSurfaceSampler(meshes, parent);
        sampler.geometries = meshes.map(mesh => mesh.geometry);
      }
      // Density follows surface area directly, without a total-count ceiling.
      const fraction = THREE.MathUtils.clamp(density, 0, 100) / 100;
      const count = Math.round(sampler.area * FULL_DENSITY_PER_UNIT * fraction);
      samples = sampler.sample(count, seed);
      const random = seededRandom(seed + 811);
      samples.forEach((sample, index) => { sample.index=index;sample.fan=(random()-.5)*.18;sample.scale=.092+random()*.027; });
      follicles = samples.length ? new THREE.InstancedMesh(follicleGeometry, follicleMaterial, samples.length) : null;
      if(follicles){follicles.name='Feather follicles';follicles.frustumCulled=false;follicles.receiveShadow=true;follicleGroup.add(follicles);}
      buildBatches(); group.visible = true;
      return this.stats;
    },
    update,
    clear() { clearBatches();group.removeFromParent();follicles?.dispose();follicles=null;follicleGroup.clear();follicleGroup.removeFromParent();samples=[];meshes=[];parent=null;sampler=null;shadowUniforms.uFeatherShadowReady.value=0;shadowVersion++; },
    dispose() {this.clear();substrate.dispose();follicleGeometry.dispose();follicleMaterial.dispose();},
    get stats() { return {count:samples.length, area:sampler?.area ?? 0}; }
  };
}

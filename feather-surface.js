import * as THREE from 'three';
import { generateFeatherData, rewriteFeatherGrammar } from './plume-lsystem/feather-generator.js';
import { createSurfaceSampler, readFeatherAnchor } from './feather-sampling.js';
import {seededRandom} from './plume-lsystem/random.js';
import {createSkinMaterial, createFollicleGeometry} from './skin-material.js';
import {plumageFrame, createContourVane} from './plumage-frame.js';
import {createFeatherShadowUniforms,receiveFeatherShadows} from './feather-shadows.js';
import {defaultFeatherSettings} from './feather-presets.js';
import {createFeatherFlight} from './feather-flight.js';
import {createMazeFlight} from './maze-flight.js';
import {pickFeather} from './feather-picking.js';
import {createVisibleFeatherSampler} from './visible-feather-sampling.js';
import {createFeatherBrush} from './feather-brush.js';

const FULL_DENSITY_PER_UNIT = 100;
const OUT = new THREE.Vector3(0, 0, 1);
const MIN_FLIGHT_HALF_SIZE = new THREE.Vector3(.012,.012,.012);

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
  const flight=createFeatherFlight();
  const inverseGroup=new THREE.Matrix4(),groupRotation=new THREE.Quaternion(),inverseGroupRotation=new THREE.Quaternion();
  const flightPosition=new THREE.Vector3(),flightRotation=new THREE.Quaternion(),flightOffset=new THREE.Vector3();
  const worldWind=new THREE.Vector3(),worldScale=new THREE.Vector3(),launchScale=new THREE.Vector3(),halfSize=new THREE.Vector3();
  const flightSpace={origin:new THREE.Vector3(),right:new THREE.Vector3(),up:new THREE.Vector3(),forward:new THREE.Vector3()};
  const geometryExtent=new THREE.Vector3();
  const returnNormal=new THREE.Vector3();
  const cameraPosition=new THREE.Vector3(),cameraUp=new THREE.Vector3();
  let contextScale=1,viewportOnly=false,viewDirty=true,viewVersion=-1;
  let shadowContactLimit=Infinity;
  let visibleSampler=null,visibleArea=0,requestedDensity=0,samplingDirty=true,nextSampleId=0;
  const byId=new Map(),rootCache=new Map(),sampleProjection=new THREE.Matrix4(),sampleGroupMatrix=new THREE.Matrix4();
  const viewProjection=new THREE.Matrix4(),lastViewProjection=new THREE.Matrix4(),lastGroupMatrix=new THREE.Matrix4();
  const frustum=new THREE.Frustum(),sphere=new THREE.Sphere();
  let firstPerson=false,courtyardExclusion=null;
  const brush=createFeatherBrush(),playerPosition=new THREE.Vector3();
  let lantern=null;
  const lanternEnabled={value:0},lanternPosition=new THREE.Vector3();
  function featherReach(){return Math.hypot(geometryExtent.x*settings.width,geometryExtent.y*settings.length,geometryExtent.z*settings.width)+5*settings.length*(.69*settings.breeze+.16*settings.breeze**2);}

  function readPose(sample,p,q){
    const f=flight.get(sample.index);
    if(!f){p.copy(sample.anchorPosition);q.copy(sample.anchorRotation);return;}
    q.copy(f.body.quaternion);flightOffset.copy(f.center).applyQuaternion(q);
    p.copy(f.body.position).sub(flightOffset).applyMatrix4(inverseGroup);q.premultiply(inverseGroupRotation);
  }
  function writeFollicle(sample,slot){
    if(!follicles||slot<0)return;
    follicleRotation.setFromUnitVectors(OUT,sample.anchorNormal);follicleScale.setScalar(sample.scale/.105);
    follicles.setMatrixAt(slot,follicleMatrix.compose(sample.anchorPosition,follicleRotation,follicleScale));
  }

  function syncReturnTargets(dt=0,all=false){
    for(const f of flight.entries){
      if(!all&&!f.returning)continue;
      const sample=byId.get(f.id);
      flightPosition.copy(sample.anchorPosition).applyMatrix4(group.matrixWorld);
      flightRotation.copy(sample.anchorRotation).premultiply(groupRotation);
      returnNormal.copy(sample.anchorNormal).transformDirection(group.matrixWorld);
      flight.setReturnTarget(f.id,flightPosition,flightRotation,returnNormal,dt);
    }
  }

  function updateFlightSpace(camera,target){
    camera.updateWorldMatrix(true,false);
    const matrix=camera.matrixWorld,e=camera.projectionMatrix.elements;
    flightSpace.origin.setFromMatrixPosition(matrix);flightSpace.right.setFromMatrixColumn(matrix,0).normalize();
    flightSpace.up.setFromMatrixColumn(matrix,1).normalize();flightSpace.forward.setFromMatrixColumn(matrix,2).normalize().negate();
    const distance=target?flightSpace.origin.distanceTo(target):flightSpace.origin.length();
    Object.assign(flightSpace,{xScale:1/e[0],yScale:1/e[5],xOffset:e[8],yOffset:e[9],near:Math.max(2,distance*.4),far:Math.max(5,distance*1.5)});
    flight.setSpace(flightSpace);
  }

  function prepareFlightSpace(){
    group.updateWorldMatrix(true,false);
    inverseGroup.copy(group.matrixWorld).invert();group.getWorldQuaternion(groupRotation);inverseGroupRotation.copy(groupRotation).invert();
  }
  function writeFlightPose(sample){
    const f=flight.get(sample.index);if(!f||sample.slot<0)return;
    const batch=sample.batch,i=sample.slot,p=batch.geometry.attributes.featherPosition,q=batch.geometry.attributes.featherRotation;
    flightRotation.copy(f.body.quaternion);
    flightOffset.copy(f.center).applyQuaternion(flightRotation);
    flightPosition.copy(f.body.position).sub(flightOffset).applyMatrix4(inverseGroup);
    flightRotation.premultiply(inverseGroupRotation);
    p.setXYZ(i,flightPosition.x,flightPosition.y,flightPosition.z);
    q.setXYZW(i,flightRotation.x,flightRotation.y,flightRotation.z,flightRotation.w);
    const airborne=batch.geometry.attributes.featherFlight;airborne.setX(i,1);airborne.needsUpdate=true;
    p.needsUpdate=true;q.needsUpdate=true;
  }

  function configureOpacity(batch) {
    const opacity = settings.opacity;
    const material = batch.material, translucent = opacity < 1;
    const alphaHash = translucent && hashedTransparency;
    const transparent = translucent && !alphaHash;
    if (material.transparent !== transparent || material.alphaHash !== alphaHash) material.needsUpdate = true;
    material.opacity = opacity;
    material.transparent = transparent;
    material.alphaHash = alphaHash;
    material.depthWrite = !translucent || alphaHash;
    batch.visible = opacity > 0;
    if(batch.customDepthMaterial){
      const depth=batch.customDepthMaterial;
      if(depth.alphaHash!==translucent)depth.needsUpdate=true;
      depth.alphaHash=translucent;depth.opacity=opacity;
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
    group.clear();geometryExtent.set(0,0,0);
  }
  function makeBatch(variant, anchors, phrase) {
    // Four reusable variants keep the original filament detail without issuing
    // a draw call for every feather or duplicating its geometry in memory.
    const layered = settings.style === 'layered';
    const data = generateFeatherData({variation:variant + 1, seed, density:settings.detail, depth:settings.generations, phrase,
      branchAngle:settings.angle * Math.PI / 180,branchLength:settings.branchLength,branchRandomness:settings.branchRandomness,quillFraction:layered ? .18 : 0, contour:layered});
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
    geometry.computeBoundingBox();
    for(const axis of ['x','y','z'])geometryExtent[axis]=Math.max(geometryExtent[axis],Math.abs(geometry.boundingBox.min[axis]),Math.abs(geometry.boundingBox.max[axis]));
    const capacity=Math.max(1,anchors.length);
    geometry.setAttribute('featherPosition', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('featherRotation', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const scales=new Float32Array(capacity);anchors.forEach((s,i)=>scales[i]=s.scale);
    geometry.setAttribute('featherScale', new THREE.InstancedBufferAttribute(scales, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('featherPush',new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('featherLight',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('featherFlight',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount = anchors.length;
    const material = new THREE.LineBasicMaterial({vertexColors:true});
    material.onBeforeCompile = shader => {
      shader.uniforms.uFeatherSize = sizeUniform;
      shader.uniforms.uFeatherTime = timeUniform;
      shader.uniforms.uFeatherBreeze = breezeUniform;
      shader.uniforms.uFeatherWind = windUniform;
      shader.uniforms.uFeatherLanternEnabled=lanternEnabled;
      shader.vertexShader = `uniform vec2 uFeatherSize;
        uniform float uFeatherTime;
        uniform float uFeatherBreeze;
        uniform vec3 uFeatherWind;
        attribute vec3 featherPosition;
        attribute vec4 featherRotation;
        attribute float featherScale;
        attribute vec3 featherPush;
        attribute float featherLight;
        attribute float featherFlight;
        varying float vFeatherLight;
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
        float reach = featherScale * 5.0 * uFeatherSize.y * (1.0-featherFlight);
        float bend = uFeatherBreeze * (gust + flutter) * height * height;
        transformed += downwind * reach * 0.65 * bend;
        transformed -= axis * reach * 0.16 * uFeatherBreeze * uFeatherBreeze
          * height * height * height * dot(downwind, downwind);
        transformed += featherPush * height * height * (1.0-featherFlight);
        vFeatherLight=featherLight;
        #ifdef USE_ALPHAHASH
          vPosition = transformed;
        #endif
      `);
      shader.fragmentShader=`uniform float uFeatherLanternEnabled;varying float vFeatherLight;\n${shader.fragmentShader}`.replace('#include <color_fragment>','#include <color_fragment>\nif(uFeatherLanternEnabled>.5)diffuseColor.rgb*=mix(vec3(.32,.30,.27),vec3(1.0,.74,.40),vFeatherLight);');
    };
    material.customProgramCacheKey = () => 'mesh-feather-instances-v7';
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = layered ? 'Contour filaments' : 'Original plume filaments';
    lines.frustumCulled = false;
    lines.userData.anchors = anchors;
    lines.userData.allAnchors=anchors;
    lines.userData.variant=variant;
    anchors.forEach((sample,index)=>{sample.batch=lines;sample.slot=viewportOnly?-1:index;});
    if(viewportOnly){geometry.instanceCount=0;lines.userData.anchors=[];}
    const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
    depthMaterial.onBeforeCompile=material.onBeforeCompile;
    depthMaterial.customProgramCacheKey=()=> 'feather-shadow-depth-v2';
    if (!layered) lines.customDepthMaterial = depthMaterial;
    configureOpacity(lines);
    group.add(lines);
    if (!layered) { receiveFeatherShadows(material,shadowUniforms); return; }
    const vaneGeometry = createContourVane(data.barbs, data.shaft);
    for (const name of ['featherPosition','featherRotation','featherScale','featherPush','featherLight','featherFlight']) vaneGeometry.setAttribute(name, geometry.attributes[name]);
    vaneGeometry.instanceCount = anchors.length;
    const vaneMaterial = new THREE.MeshBasicMaterial({vertexColors:true, side:THREE.DoubleSide, forceSinglePass:true});
    vaneMaterial.onBeforeCompile = material.onBeforeCompile;
    vaneMaterial.customProgramCacheKey = material.customProgramCacheKey;
    const vane = new THREE.Mesh(vaneGeometry, vaneMaterial);
    vane.customDepthMaterial=depthMaterial;
    vane.userData.anchors=anchors;
    vane.userData.sourceBatch=lines;
    if(viewportOnly){vaneGeometry.instanceCount=0;vane.userData.anchors=lines.userData.anchors;}
    vane.name = 'Contour vane';vane.frustumCulled = false;
    receiveFeatherShadows(material,shadowUniforms);receiveFeatherShadows(vaneMaterial,shadowUniforms);
    configureOpacity(vane);group.add(vane);
  }
  function buildBatches() {
    const phrase=(samples.length||viewportOnly)?rewriteFeatherGrammar({axiom:settings.axiom,X:settings.ruleX,F:settings.ruleF},settings.generations):'';
    for (let i = 0; i < 4; i++) {
      const anchors = samples.filter((sample,index) => (viewportOnly?sample.variant:index%4) === i);
      if (anchors.length||viewportOnly) makeBatch(i, anchors, phrase);
    }
    update();updateWindDirection();
  }
  function sampleVisibleSurface(camera){
    const reach=featherReach(),padding=.119*contextScale*reach;
    const result=visibleSampler.sample(camera,parent,requestedDensity,seed,{padding,nearRadius:firstPerson?.22:0}),active=new Set(),next=[];
    visibleArea=result.area;
    for(const anchor of result.samples){
      let sample=rootCache.get(anchor.key);
      if(!sample){
        const random=seededRandom(anchor.variation);
        sample={...anchor,index:nextSampleId++,variant:anchor.variation%4,fan:(random()-.5)*.18,scale:(.092+random()*.027)*contextScale,slot:-1,follicleSlot:-1};
        rootCache.set(anchor.key,sample);byId.set(sample.index,sample);
      }
      active.add(sample.key);next.push(sample);
    }
    for(const [key,sample] of rootCache)if(!active.has(key)){
      if(flight.get(sample.index)||visibleSampler.isNearby(sample.anchorPosition)||visibleSampler.isVisibleSphere(sample.anchorPosition,sample.scale*reach+(sample.push?.length()??0)))next.push(sample);
      else{rootCache.delete(key);byId.delete(sample.index);}
    }
    samples=next;
    for(const batch of group.children){
      if(!batch.isLineSegments)continue;
      const anchors=samples.filter(sample=>sample.variant===batch.userData.variant),geometry=batch.geometry;
      if(geometry.attributes.featherPosition.count<anchors.length){
        const capacity=2**Math.ceil(Math.log2(anchors.length));
        // Dispose old GPU buffers, while retaining shared feather vertices and materials.
        geometry.dispose();
        for(const [name,size] of [['featherPosition',3],['featherRotation',4],['featherScale',1],['featherPush',3],['featherLight',1],['featherFlight',1]])geometry.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage));
        delete geometry._maxInstanceCount;
        for(const vane of group.children)if(vane.userData.sourceBatch===batch){
          vane.geometry.dispose();
          for(const name of ['featherPosition','featherRotation','featherScale','featherPush','featherLight','featherFlight'])vane.geometry.setAttribute(name,geometry.attributes[name]);
          delete vane.geometry._maxInstanceCount;
        }
      }
      batch.userData.allAnchors=anchors;
      for(const sample of anchors){sample.batch=batch;sample.slot=-1;sample.follicleSlot=-1;}
    }
    if((follicles?.instanceMatrix.count??0)<samples.length){
      follicles?.dispose();follicleGroup.clear();
      follicles=new THREE.InstancedMesh(follicleGeometry,follicleMaterial,2**Math.ceil(Math.log2(samples.length)));
      follicles.name='Feather follicles';follicles.frustumCulled=false;follicles.receiveShadow=true;follicleGroup.add(follicles);
    }
    if(follicles)follicles.count=0;
    samplingDirty=false;sampleProjection.copy(viewProjection);sampleGroupMatrix.copy(group.matrixWorld);
    update();
  }
  function update() {
    if (!parent || !samples.length) return;
    parent.updateWorldMatrix(true, true);
    meshes.forEach(mesh => mesh.skeleton?.update());
    prepareFlightSpace();
    for (const batch of group.children) {
      if (!batch.isLineSegments) continue;
      const p = batch.geometry.attributes.featherPosition, q = batch.geometry.attributes.featherRotation;
      batch.userData.allAnchors.forEach(sample => {
        readFeatherAnchor(sample, parent, position, normal);
        position.addScaledVector(normal, -.017-.001*(1-contextScale));
        plumageFrame(normal, settings.lift, settings.flowDirection, sample.fan, rotation, sample.position);
        (sample.anchorPosition??=new THREE.Vector3()).copy(position);
        (sample.anchorNormal??=new THREE.Vector3()).copy(normal);
        (sample.anchorRotation??=new THREE.Quaternion()).copy(rotation);
        const i=sample.slot;
        if(i>=0){p.setXYZ(i, position.x, position.y, position.z);q.setXYZW(i, rotation.x, rotation.y, rotation.z, rotation.w);}
        if(i>=0)batch.geometry.attributes.featherFlight.setX(i,0);
        writeFlightPose(sample);
        writeFollicle(sample,sample.follicleSlot);
      });
      p.needsUpdate = true; q.needsUpdate = true;batch.geometry.attributes.featherFlight.needsUpdate=true;
    }
    if (follicles) follicles.instanceMatrix.needsUpdate = true;
    shadowVersion++;
    viewDirty=true;
  }
  function updateView(camera){
    if(!viewportOnly||!parent)return;
    camera.updateWorldMatrix(true,false);group.updateWorldMatrix(true,false);
    viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    if(samplingDirty||!sampleProjection.equals(viewProjection)||!sampleGroupMatrix.equals(group.matrixWorld))sampleVisibleSurface(camera);
    if(!viewDirty&&viewVersion===shadowVersion&&lastViewProjection.equals(viewProjection)&&lastGroupMatrix.equals(group.matrixWorld))return;
    prepareFlightSpace();frustum.setFromProjectionMatrix(viewProjection);
    const worldSize=group.matrixWorld.getMaxScaleOnAxis();
    const reach=featherReach();
    let follicleCount=0;
    // Retain every attachment, but compact visible poses into the prefix drawn
    // by the shared filament/vane buffers. Turning back never reseeds the coat.
    for(const batch of group.children){
      if(!batch.isLineSegments)continue;
      const a=batch.geometry.attributes,visible=[];
      for(const sample of batch.userData.allAnchors){
        readPose(sample,flightPosition,flightRotation);
        sample.slot=-1;sample.follicleSlot=-1;
        if(courtyardExclusion&&Math.hypot(flightPosition.x-courtyardExclusion.center.x,flightPosition.z-courtyardExclusion.center.z)<courtyardExclusion.radius)continue;
        const radius=sample.scale*reach+(sample.push?.length()??0);
        sphere.center.copy(flightPosition).applyMatrix4(group.matrixWorld);sphere.radius=radius*worldSize;
        sample.slot=-1;
        if(frustum.intersectsSphere(sphere)&&visibleSampler.isVisibleSphere(flightPosition,radius)){
          const i=visible.length;sample.slot=i;visible.push(sample);
          a.featherPosition.setXYZ(i,flightPosition.x,flightPosition.y,flightPosition.z);
          a.featherRotation.setXYZW(i,flightRotation.x,flightRotation.y,flightRotation.z,flightRotation.w);
          a.featherScale.setX(i,sample.scale);
          a.featherFlight.setX(i,flight.get(sample.index)?1:0);
          a.featherPush.setXYZ(i,sample.push?.x??0,sample.push?.y??0,sample.push?.z??0);
          a.featherLight.setX(i,lantern?1-THREE.MathUtils.smoothstep(flightPosition.distanceTo(lanternPosition),.04,.65):0);
        }
        sphere.center.copy(sample.anchorPosition).applyMatrix4(group.matrixWorld);sphere.radius=.014*sample.scale/.105*worldSize;
        sample.follicleSlot=-1;
        if(frustum.intersectsSphere(sphere)&&visibleSampler.isVisibleSphere(sample.anchorPosition,.014*sample.scale/.105)){sample.follicleSlot=follicleCount;writeFollicle(sample,follicleCount++);}
      }
      batch.geometry.instanceCount=visible.length;batch.userData.anchors=visible;
      for(const name of ['featherPosition','featherRotation','featherScale','featherPush','featherLight','featherFlight']){
        a[name].clearUpdateRanges();if(visible.length)a[name].addUpdateRange(0,visible.length*a[name].itemSize);
        a[name].needsUpdate=true;
      }
    }
    for(const batch of group.children)if(batch.userData.sourceBatch){
      batch.geometry.instanceCount=batch.userData.sourceBatch.geometry.instanceCount;
      batch.userData.anchors=batch.userData.sourceBatch.userData.anchors;
    }
    if(follicles){
      follicles.count=follicleCount;follicles.instanceMatrix.clearUpdateRanges();
      if(follicleCount)follicles.instanceMatrix.addUpdateRange(0,follicleCount*16);
      follicles.instanceMatrix.needsUpdate=true;
    }
    shadowVersion++;viewVersion=shadowVersion;viewDirty=false;
    lastViewProjection.copy(viewProjection);lastGroupMatrix.copy(group.matrixWorld);
  }
  return {
    group, substrate, follicleGroup,shadowUniforms,
    setCourtyardExclusion(value){courtyardExclusion=value;viewDirty=true;},
    setSettings(values) {
      values={...values};
      for(const key of ['opacity','shadow','subsurface','branchRandomness'])if(values[key]!==undefined)values[key]=THREE.MathUtils.clamp(values[key],0,1);
      const regenerate = ['style','detail','angle','generations','axiom','ruleX','ruleF','branchLength','branchRandomness'].some(key=>values[key]!==undefined&&values[key]!==settings[key]);
      const resize = ['length','width'].some(key=>values[key]!==undefined&&values[key]!==settings[key]);
      const wasFlying=flight.count>0;
      if(regenerate||resize){flight.clear();if(viewportOnly&&wasFlying)samplingDirty=true;}
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
      else {for (const batch of group.children) configureOpacity(batch);if(reorient||(resize&&wasFlying))update();}
    },
    get translucent() { return settings.opacity > 0 && settings.opacity < 1 && samples.length > 0; },
    get shadowEnabled(){return settings.shadow>0&&settings.opacity>0&&samples.length>0;},
    get shadowVersion(){return shadowVersion;},
    get shadowPadding(){return contextScale*(Math.max(.65*Math.max(1,settings.length,settings.width),.12*Math.hypot(geometryExtent.x*settings.width,geometryExtent.y*settings.length,geometryExtent.z*settings.width))+.15+.6*settings.length*(.69*settings.breeze+.16*settings.breeze**2));},
    get shadowContactDistance(){return Math.min(this.shadowPadding,shadowContactLimit);},
    get focusShadows(){return viewportOnly&&firstPerson;},
    get shadowViewRadius(){return contextScale*24;},
    setFirstPerson(enabled){
      if(firstPerson===enabled)return;
      firstPerson=enabled;brush.reset();flight.setCamera(null);samplingDirty=true;viewDirty=true;shadowVersion++;
      if(!enabled)for(const sample of samples){sample.push?.set(0,0,0);sample.pushVelocity?.set(0,0,0);}
    },
    setLantern(light){lantern=light;lanternEnabled.value=light?1:0;viewDirty=true;},
    interact(dt,camera){
      if(!firstPerson||!parent)return false;
      prepareFlightSpace();camera.updateWorldMatrix(true,false);playerPosition.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverseGroup);
      if(lantern){
        lantern.updateWorldMatrix(true,false);position.setFromMatrixPosition(lantern.matrixWorld).applyMatrix4(inverseGroup);
        if(position.distanceToSquared(lanternPosition)>1e-12){lanternPosition.copy(position);viewDirty=true;}
      }
      const moving=brush.update(samples,playerPosition,dt,settings.length,index=>!!flight.get(index),settings.width);
      if(moving){viewDirty=true;shadowVersion++;}return moving;
    },
    setHashedTransparency(enabled) {
      hashedTransparency = enabled;
      for (const batch of group.children) configureOpacity(batch);
    },
    advance(dt,camera,target) {
      if (!parent || !group.visible || !samples.length || settings.opacity <= 0 || !(dt > 0)) return false;
      let moving=false;
      if(flight.count){
        if(camera)updateFlightSpace(camera,target);
        prepareFlightSpace();syncReturnTargets(dt);
        if(firstPerson&&camera){
          cameraPosition.setFromMatrixPosition(camera.matrixWorld);cameraUp.setFromMatrixColumn(group.matrixWorld,1).normalize();
          flight.setCamera(cameraPosition,cameraUp,contextScale);
        }else flight.setCamera(null);
        worldWind.copy(windUniform.value).transformDirection(parent.matrixWorld);
        const before=flight.count;
        flight.step(dt,worldWind,settings.breeze);
        if(flight.count<before){update();if(viewportOnly)samplingDirty=true;}
        else for(const f of flight.entries)writeFlightPose(byId.get(f.id));
        shadowVersion++;moving=true;
      }
      if(settings.breeze<=0)return moving;
      timeUniform.value += Math.min(dt, .1);
      shadowVersion++;
      updateWindDirection();
      return true;
    },
    rebuild(sourceMeshes, effectParent, density, nextSeed, {scale=1,viewport=false,shadowDistance=Infinity,maze=false}={}) {
      contextScale=scale;viewportOnly=viewport;shadowContactLimit=shadowDistance;viewDirty=true;samplingDirty=true;requestedDensity=density;visibleArea=0;
      substrate.userData.skinDetailScale.value=1/contextScale;
      rootCache.clear();byId.clear();nextSampleId=0;
      flight.setEnvironment(maze?createMazeFlight(effectParent):null);
      clearBatches();
      group.removeFromParent(); effectParent.add(group);
      follicles?.dispose();follicleGroup.clear();follicleGroup.removeFromParent();effectParent.add(follicleGroup);
      // Cache area data across slider input; rebuild it when the model, seed or
      // geometry changes. Animation only updates the barycentric attachments.
      if (parent !== effectParent || seed !== nextSeed || meshes.length !== sourceMeshes.length || sourceMeshes.some((mesh, i) => meshes[i] !== mesh || meshes[i].geometry !== sampler?.geometries[i])) {
        meshes = [...sourceMeshes]; parent = effectParent; seed = nextSeed;
        sampler = createSurfaceSampler(meshes, parent);
        sampler.geometries = meshes.map(mesh => mesh.geometry);
        visibleSampler=null;
      }
      if(viewportOnly&&!visibleSampler)visibleSampler=createVisibleFeatherSampler(sampler.triangles);
      // Density follows surface area directly, without a total-count ceiling.
      const fraction = Math.max(0,density) / 100;
      const count = viewportOnly?0:Math.round(sampler.area * FULL_DENSITY_PER_UNIT * fraction);
      samples = sampler.sample(count, seed);
      const random = seededRandom(seed + 811);
      samples.forEach((sample, index) => { sample.index=index;sample.follicleSlot=viewportOnly?-1:index;sample.fan=(random()-.5)*.18;sample.scale=(.092+random()*.027)*contextScale; });
      for(const sample of samples)byId.set(sample.index,sample);
      follicles = samples.length ? new THREE.InstancedMesh(follicleGeometry, follicleMaterial, samples.length) : null;
      if(follicles){follicles.name='Feather follicles';follicles.frustumCulled=false;follicles.receiveShadow=true;if(viewportOnly)follicles.count=0;follicleGroup.add(follicles);}
      buildBatches(); group.visible = true;
      return this.stats;
    },
    get flyingCount(){return flight.count;},
    get returningCount(){return flight.returningCount;},
    pick(raycaster){return parent&&settings.opacity>0?pickFeather({raycaster,group,meshes,settings,time:timeUniform.value,wind:windUniform.value,scale:contextScale}):null;},
    launchAll(){
      let launched=flight.resumeAll();
      if(!parent||settings.opacity<=0)return launched;
      prepareFlightSpace();
      group.getWorldScale(worldScale);
      for(const sample of samples){
        if(flight.get(sample.index))continue;
        const geometry=sample.batch.geometry;
        launchScale.set(worldScale.x*sample.scale*settings.width,worldScale.y*sample.scale*settings.length,worldScale.z*sample.scale*settings.width);
        geometry.boundingBox.getCenter(flightOffset).multiply(launchScale);
        geometry.boundingBox.getSize(halfSize).multiply(launchScale).multiplyScalar(.5).max(returnNormal.copy(MIN_FLIGHT_HALF_SIZE).multiplyScalar(contextScale));
        flightRotation.copy(sample.anchorRotation).premultiply(groupRotation);
        flightPosition.copy(sample.anchorPosition).applyMatrix4(group.matrixWorld);
        returnNormal.copy(sample.anchorNormal).transformDirection(group.matrixWorld);
        if(flight.launch({id:sample.index,position:flightPosition,quaternion:flightRotation,center:flightOffset,half:halfSize,normal:returnNormal}))launched++;
      }
      return launched;
    },
    returnAll(){if(!flight.count)return;prepareFlightSpace();syncReturnTargets(0,true);flight.returnAll();},
    update,updateView,
    clear() { flight.setEnvironment(null);clearBatches();group.removeFromParent();follicles?.dispose();follicles=null;follicleGroup.clear();follicleGroup.removeFromParent();samples=[];meshes=[];parent=null;sampler=null;visibleSampler=null;byId.clear();rootCache.clear();shadowUniforms.uFeatherShadowReady.value=0;shadowVersion++; },
    dispose() {this.clear();substrate.dispose();follicleGeometry.dispose();follicleMaterial.dispose();},
    get stats() { return {count:samples.length, visibleCount:group.children.filter(batch=>batch.isLineSegments).reduce((sum,batch)=>sum+batch.geometry.instanceCount,0), viewport:viewportOnly,area:viewportOnly?visibleArea:(sampler?.area??0),surfaceArea:sampler?.area??0}; }
  };
}

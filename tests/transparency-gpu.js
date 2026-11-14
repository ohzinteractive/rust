// GPU regression checks, run by browser.mjs using the same local renderer.
import * as THREE from 'three';
import {createFeatherRenderer} from '../feather-renderer.js';
import {createFeatherSurface} from '../feather-surface.js';
import {createSkinMaterial} from '../skin-material.js';
import {createFeatherShadowUniforms,receiveFeatherShadows} from '../feather-shadows.js';
import {createShapeGeometry} from '../specimen-shapes.js';
import {mazePoint} from '../maze-geometry.js';

// Regress the actual FPV maze under ambient light, where direct-light-only
// contact shading used to disappear. Hide feather pixels when measuring so
// this verifies their shadows on the wall, rather than darker feather colors.
export function checkAmbientMazeShadows(renderer){
  const scene=new THREE.Scene(),parent=new THREE.Group(),feathers=createFeatherSurface();scene.add(parent);
  const geometry=createShapeGeometry('maze'),source=new THREE.Mesh(geometry,feathers.substrate);parent.add(source);
  scene.add(new THREE.HemisphereLight(0xffffff,0x808080,1.4));
  const light=new THREE.DirectionalLight(0xffffff,0);light.position.set(-3.5,6,4.5);scene.add(light);
  const camera=new THREE.PerspectiveCamera(75,1.25,.001,80);camera.position.copy(mazePoint(15.5,29.5,.02));camera.lookAt(camera.position.clone().add(new THREE.Vector3(1,0,0)));
  feathers.setSettings({style:'plume',length:2,width:1.9,detail:.38,shadow:.84});
  feathers.rebuild([source],parent,500,7319,{scale:.025,viewport:true,shadowDistance:.02});feathers.setFirstPerson(true);
  const pipeline=createFeatherRenderer({renderer,feathers,shadowLight:light});
  const target=new THREE.WebGLRenderTarget(256,256),originalTarget=renderer.getRenderTarget();
  function pixels(){renderer.render(scene,camera);const bytes=new Uint8Array(256*256*4);renderer.readRenderTargetPixels(target,0,0,256,256,bytes);return bytes;}
  try{
    renderer.setRenderTarget(target);pipeline.render(scene,camera);
    feathers.group.visible=false;feathers.follicleGroup.visible=false;
    feathers.setSettings({shadow:0});const off=pixels();
    feathers.setSettings({shadow:.84});const on=pixels();
    let darkenedPixels=0,maxDifference=0;
    for(let i=0;i<off.length;i+=4){const difference=(off[i]+off[i+1]+off[i+2]-on[i]-on[i+1]-on[i+2])/3;if(difference>5)darkenedPixels++;maxDifference=Math.max(maxDifference,difference);}
    return {darkenedPixels,maxDifference,feathers:feathers.stats.count,radius:feathers.shadowUniforms.uFeatherShadowFocus.value.w,projection:feathers.shadowUniforms.uFeatherShadowProjection.value.z};
  }finally{renderer.setRenderTarget(originalTarget);pipeline.dispose();feathers.dispose();geometry.dispose();}
}

export function checkFeatherContactShadows(renderer){
  const scene=new THREE.Scene(),depthScene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,4);camera.position.z=2;camera.updateMatrixWorld();
  const uniforms=createFeatherShadowUniforms(.8),material=new THREE.MeshBasicMaterial({color:0xffffff});
  receiveFeatherShadows(material,uniforms);
  const geometry=new THREE.PlaneGeometry(2,2),receiver=new THREE.Mesh(geometry,material);
  const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  const blocker=new THREE.Mesh(geometry,depthMaterial);scene.add(receiver);depthScene.add(blocker);
  const shadow=new THREE.WebGLRenderTarget(16,16,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const output=new THREE.WebGLRenderTarget(8,8),originalTarget=renderer.getRenderTarget();
  const originalColor=renderer.getClearColor(new THREE.Color()),originalAlpha=renderer.getClearAlpha();
  uniforms.uFeatherShadowMap.value=shadow.texture;uniforms.uFeatherShadowTexel.value.setScalar(1/16);
  uniforms.uFeatherShadowDepthRange.value=camera.far-camera.near;uniforms.uFeatherShadowContactDistance.value=.05;
  uniforms.uFeatherShadowMatrix.value.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
  function render(distance){
    blocker.position.z=distance;renderer.setRenderTarget(shadow);renderer.setClearColor(0xffffff,1);renderer.render(depthScene,camera);
    renderer.setRenderTarget(output);renderer.render(scene,camera);
    const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(output,4,4,1,1,pixel);return pixel[0];
  }
  try{
    uniforms.uFeatherShadowReady.value=0;const unshadowed=render(.005);
    uniforms.uFeatherShadowReady.value=1;
    const result={unshadowed,near:render(.005),fading:render(.03),far:render(.5)};
    uniforms.uFeatherShadowFocus.value.set(10,0,0,1);result.outsideFocus=render(.005);
    uniforms.uFeatherShadowFocus.value.set(0,0,0,1);result.insideFocus=render(.005);
    return result;
  }finally{
    renderer.setRenderTarget(originalTarget);renderer.setClearColor(originalColor,originalAlpha);
    material.dispose();depthMaterial.dispose();geometry.dispose();shadow.dispose();output.dispose();
  }
}

export function checkTransparency(renderer) {
  const scene = new THREE.Scene(), group = new THREE.Group();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 10);
  camera.position.z = 3;
  const lines = [
    {color:0xff0000, z:.3}, {color:0x0000ff, z:-.3}
  ].map(({color, z}) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.7, 0, z), new THREE.Vector3(.7, 0, z)]);
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color, transparent:false, depthWrite:true}));
    group.add(line);return line;
  });
  let translucent = false;
  const feathers = {group, get translucent(){return translucent;}, setHashedTransparency(){}};
  const pipeline = createFeatherRenderer({renderer, feathers});
  const target = new THREE.WebGLRenderTarget(32, 32);
  const originalTarget = renderer.getRenderTarget(), originalAlpha = renderer.getClearAlpha();
  const originalClear = renderer.getClearColor(new THREE.Color());
  const originalToneMapping = renderer.toneMapping;
  const results = {mode:pipeline.mode};
  function render() {
    renderer.setRenderTarget(target);
    const viewport = renderer.getCurrentViewport(new THREE.Vector4());
    pipeline.render(scene, camera);
    results.viewportRestored = renderer.getCurrentViewport(new THREE.Vector4()).equals(viewport);
    const data = new Uint8Array(32 * 32 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 32, 32, data);
    return data;
  }
  function pixel(data) {
    let offset = 0, brightest = -1;
    for (let y = 14; y <= 17; y++) {
      const index = (y * 32 + 16) * 4, light = data[index] + data[index + 2];
      if (light > brightest) { brightest = light; offset = index; }
    }
    return [...data.slice(offset, offset + 4)];
  }
  function difference(a, b) { return a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0); }
  function reverse() { lines.forEach((line, i) => { line.renderOrder = i ? -1 : 1; }); }
  let occluder;
  try {
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    const opaqueFirst = render();reverse();
    results.opaqueOrderDifference = difference(opaqueFirst, render());
    results.opaquePixel = pixel(opaqueFirst);
    translucent = true;
    lines.forEach((line, i) => { line.material.transparent = true; line.material.depthWrite = false; line.material.opacity = .45; line.material.needsUpdate = true; line.renderOrder = i; });
    const first = render();reverse();
    results.transparentOrderDifference = difference(first, render());
    results.transparentPixel = pixel(first);
    occluder = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({color:0x000000}));
    occluder.position.z = 1;scene.add(occluder);
    results.occludedPixel = pixel(render());
    scene.remove(occluder);
    renderer.setClearColor(0x204060, .3);
    group.visible = false;
    const background = render();group.visible = true;
    lines.forEach(line => {line.visible=false;});
    results.emptyTransparencyDifference = difference(background, render());
    results.stateRestored = renderer.getRenderTarget() === target && group.visible && renderer.getClearAlpha() === .3;
    const fallbackScene = new THREE.Scene();
    const source = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({color:0x000000}));
    fallbackScene.add(source);
    const fallbackFeathers = createFeatherSurface();
    fallbackFeathers.rebuild([source], fallbackScene, 10, 73);
    const fallback = createFeatherRenderer({renderer:{extensions:{has:()=>false}, render:renderer.render.bind(renderer)}, feathers:fallbackFeathers});
    try {
      fallbackFeathers.setSettings({opacity:.45});
      fallback.render(fallbackScene, camera);
      results.fallbackMode = fallback.mode;
      results.fallbackDepth = fallbackFeathers.group.children.every(batch=>batch.material.alphaHash&&!batch.material.transparent&&batch.material.depthWrite);
    } finally {
      fallback.dispose();fallbackFeathers.dispose();
      source.geometry.dispose();source.material.dispose();
    }
    return results;
  } finally {
    pipeline.dispose();target.dispose();
    lines.forEach(line => {line.geometry.dispose();line.material.dispose();});
    occluder?.geometry.dispose();occluder?.material.dispose();
    renderer.setRenderTarget(originalTarget);
    renderer.setClearColor(originalClear, originalAlpha);renderer.toneMapping = originalToneMapping;
  }
}

export function checkFeatherShadows(renderer,style='layered') {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,20);
  camera.position.z=4;
  const geometry=new THREE.PlaneGeometry(2,2);geometry.setAttribute('restPosition',geometry.attributes.position.clone());
  const feathers=createFeatherSurface(),source=new THREE.Mesh(geometry,feathers.substrate);
  scene.add(source);scene.add(new THREE.HemisphereLight(0xffffff,0x808080,1.4));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-3,4,5);scene.add(light);
  feathers.setSettings({style,length:1,width:1,detail:.38,angle:26});
  feathers.rebuild([source],scene,8,73);
  const pipeline=createFeatherRenderer({renderer,feathers,shadowLight:light});
  const target=new THREE.WebGLRenderTarget(128,128),previousTarget=renderer.getRenderTarget();
  const results={};
  function render(){renderer.setRenderTarget(target);pipeline.render(scene,camera);const bytes=new Uint8Array(128*128*4);renderer.readRenderTargetPixels(target,0,0,128,128,bytes);return bytes;}
  const sum=bytes=>bytes.reduce((total,value,index)=>total+(index%4===3?0:value),0);
  try {
    feathers.setSettings({shadow:0});const off=render();
    feathers.setSettings({shadow:.75});const strong=render();
    results.off=sum(off);results.strong=sum(strong);
    results.darkenedPixels=0;
    for(let i=0;i<off.length;i+=4)if(off[i]+off[i+1]+off[i+2]>strong[i]+strong[i+1]+strong[i+2]+3)results.darkenedPixels++;
    feathers.setSettings({shadow:1});results.full=sum(render());
    feathers.setSettings({shadow:10});results.clamped=sum(render());feathers.setSettings({shadow:.75});
    const cached=pipeline.shadowRenders;camera.position.x=.1;camera.lookAt(0,0,0);render();results.cachedDuringOrbit=pipeline.shadowRenders===cached;
    camera.position.x=0;camera.lookAt(0,0,0);
    feathers.setSettings({shadow:.25});results.soft=sum(render());
    const beforeBreeze=pipeline.shadowRenders;feathers.setSettings({breeze:.6});feathers.advance(.1);render();results.breezeUpdatesShadow=pipeline.shadowRenders>beforeBreeze;
    feathers.setSettings({opacity:.45});render();results.partialReady=feathers.shadowUniforms.uFeatherShadowReady.value===1;
    feathers.setSettings({opacity:0});render();results.hiddenClearsShadow=feathers.shadowUniforms.uFeatherShadowReady.value===0;
    return results;
  } finally {pipeline.dispose();feathers.dispose();target.dispose();geometry.dispose();renderer.setRenderTarget(previousTarget);}
}

export function checkSkinScattering(renderer) {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,20);
  camera.position.z=4;
  const geometry=new THREE.PlaneGeometry(2,2,8,8);geometry.setAttribute('restPosition',geometry.attributes.position.clone());
  const material=createSkinMaterial('#c68f79',0),surface=new THREE.Mesh(geometry,material);
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(0,0,-3);scene.add(surface,light);
  const target=new THREE.WebGLRenderTarget(128,128),previousTarget=renderer.getRenderTarget(),previousToneMapping=renderer.toneMapping;
  const previousClear=renderer.getClearColor(new THREE.Color()),previousAlpha=renderer.getClearAlpha();
  const results={};
  function render(strength){
    material.userData.skinSubsurface.value=strength;renderer.setRenderTarget(target);renderer.render(scene,camera);
    const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,64,64,1,1,pixel);return [...pixel];
  }
  try {
    renderer.setClearColor(0,1);renderer.toneMapping=THREE.NoToneMapping;
    results.off=render(0);results.half=render(.5);results.full=render(1);
    results.clamped=render(10);
    light.intensity=0;results.unlit=render(10);
    light.intensity=2;light.position.set(3,0,.15);results.grazingOff=render(0);results.grazingOn=render(1);
    results.opaque=material.opacity===1&&!material.transparent&&material.transmission===0;
    return results;
  } finally {
    geometry.dispose();material.dispose();target.dispose();renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear,previousAlpha);renderer.toneMapping=previousToneMapping;
  }
}

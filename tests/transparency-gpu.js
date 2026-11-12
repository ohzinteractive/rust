// GPU regression checks, run by browser.mjs using the same local renderer.
import * as THREE from 'three';
import {createFeatherRenderer} from '../feather-renderer.js';
import {createFeatherSurface} from '../feather-surface.js';
import {createSkinMaterial} from '../skin-material.js';

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

export function checkFeatherShadows(renderer) {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,20);
  camera.position.z=4;
  const geometry=new THREE.PlaneGeometry(2,2);geometry.setAttribute('restPosition',geometry.attributes.position.clone());
  const feathers=createFeatherSurface(),source=new THREE.Mesh(geometry,feathers.substrate);
  scene.add(source);scene.add(new THREE.HemisphereLight(0xffffff,0x808080,1.4));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-3,4,5);scene.add(light);
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
    light.intensity=0;results.unlit=render(1);
    light.intensity=2;light.position.set(3,0,.15);results.grazingOff=render(0);results.grazingOn=render(1);
    results.opaque=material.opacity===1&&!material.transparent&&material.transmission===0;
    return results;
  } finally {
    geometry.dispose();material.dispose();target.dispose();renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear,previousAlpha);renderer.toneMapping=previousToneMapping;
  }
}

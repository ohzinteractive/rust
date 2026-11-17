import * as THREE from 'three';
import {createKelpParticles} from '../kelp-particles.js';
import {createKelpSunlight} from '../kelp-lighting.js';

export function checkParticleLighting(renderer){
  const scene=new THREE.Scene(),sunlight=createKelpSunlight();scene.background=new THREE.Color(0);
  sunlight.waterSurface.value=1;
  const particles=createKelpParticles({parent:scene,sun:null,sunlight,time:{value:0},floorY:0,waterHeight:{value:1}});
  const mesh=particles.points,u=particles.uniforms;mesh.onBeforeRender=()=>{};
  const layerCounts=[0,1,2].map(layer=>Array.from(mesh.geometry.attributes.particleLayer.array).filter(v=>v===layer).length);
  mesh.geometry.setDrawRange(0,1);mesh.geometry.attributes.position.setXYZ(0,0,.5,0);
  mesh.geometry.attributes.particleLayer.setX(0,1);mesh.geometry.attributes.particleSize.setX(0,.06);mesh.geometry.attributes.particlePhase.setX(0,0);
  u.viewportHeight.value=64;u.sunRadiance.value.setRGB(8,8,8);u.shadowEnabled.value=1;
  u.sunShadowMatrix.value.set(0,0,0,.5,0,0,0,.5,0,0,0,.5,0,0,0,1);
  const lit=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1),dark=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);
  const edge=new THREE.DataTexture(new Uint8Array([0,0,0,0,255,255,255,255,0,0,0,0,255,255,255,255]),2,2);
  for(const t of [lit,dark,edge])t.needsUpdate=true;
  const target=new THREE.WebGLRenderTarget(64,64,{type:THREE.HalfFloatType,depthBuffer:false});
  const camera=new THREE.PerspectiveCamera(55,1,.1,20);camera.position.set(0,.5,3);camera.lookAt(0,.5,0);
  const previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissorTest(),tone=renderer.toneMapping;
  function energy(texture,gain){
    u.sunShadow.value=texture;u.litGain.value=gain;renderer.setRenderTarget(target);renderer.render(scene,camera);
    const values=new Uint16Array(64*64*4);renderer.readRenderTargetPixels(target,0,0,64,64,values);
    let sum=0;for(let i=0;i<values.length;i+=4)sum+=THREE.DataUtils.fromHalfFloat(values[i])+THREE.DataUtils.fromHalfFloat(values[i+1])+THREE.DataUtils.fromHalfFloat(values[i+2]);
    return sum;
  }
  try{
    renderer.setScissorTest(false);renderer.toneMapping=THREE.NoToneMapping;
    const baseline=energy(lit,1),illuminated=energy(lit,1.25),shadowed=energy(dark,1.25),transition=[];
    u.sunTexel.value.set(.5,.5);
    for(let i=0;i<=8;i++){u.sunShadowMatrix.value.elements[12]=.1+i*.1;transition.push(energy(edge,1.25));}
    u.sunTexel.value.set(1,1);u.sunShadowMatrix.value.elements[12]=.5;
    mesh.geometry.attributes.particlePhase.setX(0,1.82);mesh.geometry.attributes.particlePhase.needsUpdate=true;
    mesh.geometry.attributes.particleSize.setX(0,.3);mesh.geometry.attributes.particleSize.needsUpdate=true;
    mesh.geometry.attributes.particleLayer.setX(0,0);mesh.geometry.attributes.particleLayer.needsUpdate=true;
    u.waterTime.value=0;const glintPeak=energy(lit,1.25);
    u.waterTime.value=12;const glintQuiet=energy(lit,1.25);
    u.waterTime.value=0;const shadowGlint=energy(dark,1.25);
    const layers=particles.points.geometry.attributes.particleLayer.array;
    return {glintPeak,glintQuiet,shadowGlint,baseline,illuminated,shadowed,gain:illuminated/baseline,shadowRatio:shadowed/illuminated,transition,
      count:layers.length,near:layerCounts[0],mid:layerCounts[1],far:layerCounts[2]};
  }finally{
    renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissorTest(scissor);renderer.toneMapping=tone;
    particles.dispose();target.dispose();for(const t of [lit,dark,edge])t.dispose();
  }
}

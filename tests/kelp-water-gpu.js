import * as THREE from 'three';
import {oceanShader,waterOpticsShader} from '../kelp-water.js';
import {createKelpGodrays} from '../kelp-godrays.js';

export function checkWaterOptics(renderer){
  const previous=renderer.getRenderTarget(),size=renderer.getSize(new THREE.Vector2()),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissorTest(),tone=renderer.toneMapping;
  const target=new THREE.WebGLRenderTarget(128,128,{type:THREE.UnsignedByteType});
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(48,1,.1,80);
  camera.position.set(0,4,3);camera.lookAt(0,-2,0);
  const material=new THREE.ShaderMaterial({toneMapped:false,uniforms:{pattern:{value:1}},
    vertexShader:'varying vec2 v;void main(){v=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec2 v;uniform float pattern;void main(){float c=mod(floor(v.x*6.0)+floor(v.y*6.0),2.0);gl_FragColor=vec4(mix(vec3(1.0),mix(vec3(.08,.15,.12),vec3(.8,.95,1.0),c),pattern),1.0);}'});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(60,60),material);mesh.rotation.x=-Math.PI/2;mesh.position.y=-3;scene.add(mesh);
  const sun=new THREE.DirectionalLight(0xffffff,12);sun.position.set(-.14,1,-.52);scene.add(sun,sun.target);
  const effect=createKelpGodrays(renderer);
  function render(refraction=1){
    renderer.setRenderTarget(target);effect.render(scene,camera,()=>renderer.render(scene,camera),{top:0,bottom:-20,time:1,sun,scatteringStrength:0,bloomStrength:0,glintStrength:0,refractionStrength:refraction});
    const pixels=new Uint8Array(128*128*4);renderer.readRenderTargetPixels(target,0,0,128,128,pixels);return pixels;
  }
  const probeMaterial=new THREE.ShaderMaterial({toneMapped:false,depthTest:false,depthWrite:false,
    uniforms:{cosine:{value:1},testTime:{value:0},probe:{value:0},probeScale:{value:4},surfaceRipples:{value:Array.from({length:8},()=>new THREE.Vector4(0,0,0,0))}},
    vertexShader:'varying vec2 probeUv;void main(){probeUv=position.xy;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`${oceanShader}\n${waterOpticsShader}
      uniform float cosine,testTime,probe,probeScale;varying vec2 probeUv;
      void main(){float result=waterFresnel(cosine);
      if(probe>.5&&probe<1.5){vec3 sun=normalize(vec3(-.14,1.0,-.52));result=waterSunGlint(vec3(0,1,0),reflect(-sun,vec3(0,1,0)),sun);}
      if(probe>1.5&&probe<2.5)result=waterSunGlint(vec3(0,1,0),normalize(vec3(1,1,0)),normalize(vec3(-.14,1.0,-.52)));
      if(probe>2.5&&probe<3.5)result=abs(rippleHeight(vec2(.4,0),testTime))*100.0;
      if(probe>3.5){vec2 p=probeUv*probeScale;
        float footprint=max(length(dFdx(p)),length(dFdy(p)));
        result=length(waterOpticalNormal(p,1.0)-oceanFilteredNormal(p,1.0,footprint))*10.0;}
      gl_FragColor=vec4(vec3(result),1.0);}`});
  const probeScene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),probeMaterial);probeScene.add(quad);
  function sample(probe,cosine=1,time=0){
    probeMaterial.uniforms.probe.value=probe;probeMaterial.uniforms.cosine.value=cosine;probeMaterial.uniforms.testTime.value=time;
    renderer.setRenderTarget(target);renderer.render(probeScene,new THREE.Camera());
    const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,64,64,1,1,pixel);return pixel[0]/255;
  }
  try{
    renderer.setSize(128,128,false);renderer.setScissorTest(false);renderer.toneMapping=THREE.NoToneMapping;
    const plain=render(0),refracted=render(1);let difference=0,changed=0;
    for(let i=0;i<plain.length;i+=4){const d=Math.abs(plain[i]-refracted[i])+Math.abs(plain[i+1]-refracted[i+1])+Math.abs(plain[i+2]-refracted[i+2]);difference+=d;if(d>3)changed++;}
    material.uniforms.pattern.value=0;mesh.position.y=-.5;const near=render();mesh.position.y=-7;const deep=render();
    const center=(64*128+64)*4;
    const result={refractionDifference:difference/(128*128*3),changedPixels:changed,near:Array.from(near.slice(center,center+3)),deep:Array.from(deep.slice(center,center+3)),normalFresnel:sample(0,1),grazingFresnel:sample(0,.05),glint:sample(1),offGlint:sample(2)};
    probeMaterial.uniforms.surfaceRipples.value[0].set(0,0,0,.007);
    result.ripple=sample(3,1,.5);result.fadedRipple=sample(3,1,4);
    probeMaterial.uniforms.surfaceRipples.value[0].w=0;
    result.nearWaveDetail=sample(4);probeMaterial.uniforms.probeScale.value=512;result.farWaveDetail=sample(4);
    return result;
  }finally{
    effect.dispose();mesh.geometry.dispose();material.dispose();quad.geometry.dispose();probeMaterial.dispose();target.dispose();
    renderer.setRenderTarget(previous);renderer.setSize(size.x,size.y,false);renderer.setViewport(viewport);renderer.setScissorTest(scissor);renderer.toneMapping=tone;
  }
}

import * as THREE from 'three';
import {kelpLeafTissueShader} from '../kelp-morphology.js';

export function checkLeafTransmission(renderer){
  const scene=new THREE.Scene(),material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`varying vec2 vUv;${kelpLeafTissueShader}
      void main(){float cell=floor(vUv.x*6.0);
        if(cell>2.5){float distanceToCamera=cell<3.5?8.0:cell<4.5?28.0:1.0;gl_FragColor=vec4(vec3(kelpMidgroundGain(distanceToCamera,1.0)),1.0);return;}
        vec2 leafUV=vec2(.45,cell<.5||cell>1.5?.8:0.0);
        vec3 transmitted=kelpLeafTransmittance(leafUV);
        gl_FragColor=vec4(transmitted*(cell>1.5?0.0:1.0),1.0);}`});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);scene.add(quad);
  const target=new THREE.WebGLRenderTarget(6,1,{type:THREE.HalfFloatType,depthBuffer:false});
  const previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissorTest();
  try{
    renderer.setScissorTest(false);renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
    const values=new Uint16Array(24);renderer.readRenderTargetPixels(target,0,0,6,1,values);
    const sample=offset=>Array.from(values.slice(offset,offset+3),v=>THREE.DataUtils.fromHalfFloat(v));
    const thin=sample(0),vein=sample(4),shadow=sample(8),luma=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
    return {midgroundGain:sample(12)[0],backgroundGain:sample(16)[0],foregroundGain:sample(20)[0],thin,vein,shadow,veinRatio:luma(vein)/luma(thin)};
  }finally{renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissorTest(scissor);target.dispose();quad.geometry.dispose();material.dispose();}
}

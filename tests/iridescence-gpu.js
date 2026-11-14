import * as THREE from 'three';
import {createFabricFinish,iridescentPlasticSettings} from '../cloth-fabric.js';

export function checkFilmIridescence(renderer,environment){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x141613);scene.environment=environment;scene.environmentIntensity=1.2;
  const finish=createFabricFinish();finish.setFabric('plastic');finish.setPlasticSettings(iridescentPlasticSettings);
  const geometry=new THREE.SphereGeometry(1,48,32),mesh=new THREE.Mesh(geometry,finish.front);scene.add(mesh);
  const camera=new THREE.PerspectiveCamera(40,1,.1,10);camera.position.z=3.5;camera.updateMatrixWorld();
  const target=new THREE.WebGLRenderTarget(96,96),previous=renderer.getRenderTarget();
  function pixels(strength){
    finish.setPlasticSettings({iridescence:strength});renderer.setRenderTarget(target);renderer.render(scene,camera);
    const data=new Uint8Array(96*96*4);renderer.readRenderTargetPixels(target,0,0,96,96,data);return data;
  }
  try{
    const plain=pixels(0),rainbow=pixels(1);let changed=0,colored=0;
    for(let i=0;i<plain.length;i+=4){
      const difference=Math.abs(plain[i]-rainbow[i])+Math.abs(plain[i+1]-rainbow[i+1])+Math.abs(plain[i+2]-rainbow[i+2]);
      if(difference>15)changed++;
      if(Math.max(rainbow[i],rainbow[i+1],rainbow[i+2])-Math.min(rainbow[i],rainbow[i+1],rainbow[i+2])>15)colored++;
    }
    mesh.rotation.y=.7;const turned=pixels(1);let shifted=0;
    for(let i=0;i<turned.length;i+=4)if(Math.abs(turned[i]-rainbow[i])+Math.abs(turned[i+1]-rainbow[i+1])+Math.abs(turned[i+2]-rainbow[i+2])>15)shifted++;
    return {changed,colored,shifted};
  }finally{renderer.setRenderTarget(previous);target.dispose();geometry.dispose();finish.dispose();}
}

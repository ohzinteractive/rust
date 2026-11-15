import * as THREE from 'three';
import {createDesertMirage} from '../desert-mirage.js';

export function checkDesertMirage({renderer,scene,camera,renderScene,mirage,palm}){
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),gl=renderer.getContext();
  function pixels(draw){
    draw();const data=new Uint8Array(size.x*size.y*4);gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;
  }
  function changes(a,b,center=null){
    let count=0;
    const bounds=center?[Math.round((center.x*.5+.5)*size.x)-2,Math.round((center.y*.5+.5)*size.y)-2,5,5]:[0,0,size.x,size.y];
    for(let y=bounds[1];y<bounds[1]+bounds[3];y++)for(let x=bounds[0];x<bounds[0]+bounds[2];x++){
      const i=(y*size.x+x)*4;if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>2)count++;
    }
    return count;
  }
  const strength=mirage.strength;mirage.setStrength(0);pixels(renderScene);const off=pixels(renderScene);
  mirage.setStrength(.7);const on=pixels(renderScene);mirage.setStrength(strength);
  const trunk=new THREE.Box3().setFromObject(palm.group.getObjectByName('Curved palm trunk')).getCenter(new THREE.Vector3()).project(camera);
  const landmark=scene.getObjectByName('Jeddah building'),upper=landmark.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,140,0)).project(camera);
  const animated=createDesertMirage({renderer,landmark});animated.setEnabled(true);
  const first=pixels(()=>animated.render(scene,camera,()=>renderer.render(scene,camera)));
  for(let i=0;i<12;i++)animated.advance(.05);
  const second=pixels(()=>animated.render(scene,camera,()=>renderer.render(scene,camera)));
  const result={changed:changes(off,on),foregroundChanges:changes(off,on,trunk),upperChanges:changes(off,on,upper),animatedChanges:changes(first,second),animatedForegroundChanges:changes(first,second,trunk)};
  animated.dispose();renderScene();return result;
}

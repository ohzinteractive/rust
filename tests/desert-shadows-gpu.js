import * as THREE from 'three';

export function checkDesertShadows({renderer,scene,camera,renderScene}){
  const gl=renderer.getContext(),size=renderer.getDrawingBufferSize(new THREE.Vector2());
  const light=scene.children.find(o=>o.isDirectionalLight&&o.castShadow),ground=scene.children.find(o=>o.material?.name==='Pale desert sand');
  const casterBounds=new THREE.Box3().setFromObject(scene.getObjectByName('Jeddah building'));
  const cloth=scene.getObjectByName('Jeddah tower cloth');if(cloth.visible)casterBounds.expandByObject(cloth,true);
  const casters=[];for(const root of [scene.getObjectByName('Jeddah building'),...(cloth.visible?[cloth]:[])])root.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();casters.push(o);}});
  function pixels(){renderScene();const p=new Uint8Array(size.x*size.y*4);gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;}
  pixels();const on=pixels(),intensity=light.shadow.intensity;let off;
  try{light.shadow.intensity=0;off=pixels();}finally{light.shadow.intensity=intensity;renderScene();}
  const raycaster=new THREE.Raycaster(),uv=new THREE.Vector2(),hit=new THREE.Vector3();
  let groundPixels=0,maxGroundDelta=0;
  for(let y=0;y<size.y;y+=2)for(let x=0;x<size.x;x+=2){
    const i=(y*size.x+x)*4,delta=(off[i]+off[i+1]+off[i+2]-on[i]-on[i+1]-on[i+2])/3;
    if(delta<8)continue;
    uv.set((x+.5)/size.x*2-1,(y+.5)/size.y*2-1);raycaster.setFromCamera(uv,camera);
    const groundHit=raycaster.intersectObject(ground)[0];if(!groundHit)continue;
    if(raycaster.ray.intersectBox(casterBounds,hit)&&hit.distanceTo(raycaster.ray.origin)<groundHit.distance){
      const occluder=raycaster.intersectObjects(casters,false)[0];if(occluder&&occluder.distance<groundHit.distance)continue;
    }
    groundPixels++;maxGroundDelta=Math.max(maxGroundDelta,delta);
  }
  return {groundPixels,maxGroundDelta,shadowFar:light.shadow.camera.far,target:light.target.position.toArray()};
}

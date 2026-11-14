import * as THREE from 'three';

// Resolve custom GPU instances on the CPU only on a click. The box pass prunes
// candidates; segment tests then follow the same bend as the visible shader.
export function pickFeather({raycaster,group,meshes,settings,time,wind,scale:contextScale=1}) {
  const hit=raycaster.intersectObjects(meshes,false)[0];
  let nearest=hit?hit.distance+.015*contextScale:raycaster.far,result=null;
  const box=new THREE.Box3(),matrix=new THREE.Matrix4(),scale=new THREE.Vector3();
  const root=new THREE.Vector3(),q=new THREE.Quaternion(),axis=new THREE.Vector3(),downwind=new THREE.Vector3();
  const push=new THREE.Vector3();
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),onRay=new THREE.Vector3();
  const tolerance=.016*contextScale,intersection=new THREE.Vector3();
  group.updateWorldMatrix(true,false);
  for(const batch of group.children){
    if(!batch.visible)continue;
    const geometry=batch.geometry,attributes=geometry.attributes,vertices=attributes.position;
    geometry.boundingBox??=new THREE.Box3().setFromBufferAttribute(vertices);
    for(let i=0;i<geometry.instanceCount;i++){
      root.fromBufferAttribute(attributes.featherPosition,i);q.fromBufferAttribute(attributes.featherRotation,i);
      if(attributes.featherPush)push.fromBufferAttribute(attributes.featherPush,i);else push.set(0,0,0);
      const attached=1-(attributes.featherFlight?.getX(i)??0);push.multiplyScalar(attached);
      const s=attributes.featherScale.getX(i),reach=s*5*settings.length*attached;
      scale.set(s*settings.width,s*settings.length,s*settings.width);
      matrix.compose(root,q,scale).premultiply(group.matrixWorld);
      box.copy(geometry.boundingBox).applyMatrix4(matrix).expandByScalar(tolerance+(push.length()+reach*(.69*settings.breeze+.16*settings.breeze**2))*group.matrixWorld.getMaxScaleOnAxis());
      if(!raycaster.ray.intersectBox(box,intersection)||intersection.distanceTo(raycaster.ray.origin)>nearest)continue;
      axis.set(0,1,0).applyQuaternion(q);downwind.copy(wind).addScaledVector(axis,-wind.dot(axis));
      const phase=root.x*2.31+root.y*3.17+root.z*1.73+q.w*7;
      const gust=.68+.2*Math.sin(time*1.1+phase*.3)+.12*Math.sin(time*2.3+phase);
      function vertex(index,target){
        target.fromBufferAttribute(vertices,index);
        const height=THREE.MathUtils.clamp(target.y/5,0,1),flutter=.06*Math.sin(time*6.2+phase+height*4);
        target.multiply(scale).applyQuaternion(q).add(root);
        target.addScaledVector(downwind,reach*.65*settings.breeze*(gust+flutter)*height*height);
        target.addScaledVector(axis,-reach*.16*settings.breeze**2*height**3*downwind.lengthSq());
        target.addScaledVector(push,height*height);
        return target.applyMatrix4(group.matrixWorld);
      }
      if(batch.isMesh){
        const indices=geometry.index;
        for(let k=0;k<indices.count;k+=3){
          vertex(indices.getX(k),a);vertex(indices.getX(k+1),b);vertex(indices.getX(k+2),c);
          if(!raycaster.ray.intersectTriangle(a,b,c,false,onRay))continue;
          const distance=onRay.distanceTo(raycaster.ray.origin);
          if(distance>=raycaster.near&&distance<nearest){nearest=distance;result=batch.userData.anchors[i].index;}
        }
      }else{
        for(let k=0;k<vertices.count;k+=2){
          vertex(k,a);vertex(k+1,b);
          if(raycaster.ray.distanceSqToSegment(a,b,onRay)>tolerance*tolerance)continue;
          const distance=onRay.distanceTo(raycaster.ray.origin);
          if(distance>=raycaster.near&&distance<nearest){nearest=distance;result=batch.userData.anchors[i].index;}
        }
      }
    }
  }
  return result;
}

export function createFeatherInteractions({canvas,camera,feathers,enabled,invalidate}) {
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let gesture=null;
  canvas.addEventListener('pointerdown',event=>{
    if(!enabled()||event.button!==0||gesture){gesture=null;return;}
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  });
  canvas.addEventListener('pointermove',event=>{
    if(gesture&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>6)gesture.moved=true;
  });
  canvas.addEventListener('pointerup',event=>{
    const current=gesture;gesture=null;
    if(!current||current.id!==event.pointerId||current.moved||Math.hypot(event.clientX-current.x,event.clientY-current.y)>6||!enabled())return;
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    camera.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);
    const index=feathers.pick(raycaster);
    if(index!==null&&feathers.launchAll())invalidate();
  },true);
  canvas.addEventListener('pointercancel',()=>{gesture=null;});
  canvas.addEventListener('lostpointercapture',()=>{gesture=null;});
  window.addEventListener('blur',()=>{gesture=null;});
}

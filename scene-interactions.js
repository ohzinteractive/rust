import * as THREE from 'three';

export function createSceneInteractions({canvas,camera,controls,core,specimen,surface,physics,invalidate,enabled=()=>true}){
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane();
  const normal=new THREE.Vector3(),point=new THREE.Vector3(),offset=new THREE.Vector3();
  const baseY=specimen.position.y;
  let gesture=null,height=0,velocity=0;
  function aim(event){
    const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    camera.updateMatrixWorld();specimen.updateMatrixWorld(true);ray.setFromCamera(pointer,camera);
  }
  function finish(cancelled=false){
    if(!gesture)return;
    const current=gesture;gesture=null;
    if(current.flake){
      if(!cancelled&&!current.moved)surface.removeFlake(current.flake);
      else physics.releaseFlake(current.flake.body);
      current.flake.settledSynced=false;
      controls.enabled=true;
      if(canvas.hasPointerCapture(current.id))canvas.releasePointerCapture(current.id);
    }else if(!cancelled&&!current.moved){velocity=2.5;}
    canvas.style.cursor='';invalidate();
  }
  canvas.addEventListener('pointerdown',event=>{
    if(gesture){finish(true);return;}
    if(event.button!==0||!specimen.visible||!enabled())return;
    aim(event);surface.mesh.geometry.computeBoundingSphere();
    const hit=ray.intersectObjects([surface.mesh,core],false)[0];
    if(!hit)return;
    const candidate=hit.object===surface.mesh?surface.flakeAtFace(hit.faceIndex):null;
    const flake=candidate?.body&&!candidate.removed?candidate:null;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,flake};
    if(flake){
      controls.enabled=false;physics.grabFlake(flake.body);flake.settledSynced=false;
      camera.getWorldDirection(normal);plane.setFromNormalAndCoplanarPoint(normal,hit.point);
      offset.copy(flake.body.position).sub(hit.point);
      canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
      event.preventDefault();event.stopImmediatePropagation();invalidate();
    }
  },true);
  canvas.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>6)gesture.moved=true;
    if(!gesture.flake)return;
    if(gesture.moved){
      aim(event);
      if(ray.ray.intersectPlane(plane,point)){
        point.add(offset);physics.moveFlake(gesture.flake.body,point);
        gesture.flake.settledSynced=false;invalidate();
      }
    }
    event.preventDefault();event.stopImmediatePropagation();
  },true);
  canvas.addEventListener('pointerup',event=>{if(event.pointerId===gesture?.id)finish();},true);
  canvas.addEventListener('pointercancel',event=>{if(event.pointerId===gesture?.id)finish(true);},true);
  canvas.addEventListener('lostpointercapture',event=>{if(event.pointerId===gesture?.id)finish(true);});
  window.addEventListener('blur',()=>finish(true));
  canvas.addEventListener('keydown',event=>{if(enabled()&&specimen.visible&&(event.code==='Space'||event.code==='Enter')){event.preventDefault();velocity=2.5;invalidate();}});
  canvas.title='Tap shape to bounce · Drag loose flakes to move · Tap a loose flake to remove';
  return {
    cancel(){finish(true);height=0;velocity=0;specimen.position.y=baseY;physics.setCubeTransform(specimen.position,specimen.quaternion);invalidate();},
    update(dt){
      if(height===0&&velocity===0)return false;
      velocity-=9.8*dt;height+=velocity*dt;
      if(height<=0){height=0;velocity=Math.abs(velocity)>.7?-velocity*.28:0;}
      specimen.position.y=baseY+height;specimen.updateMatrixWorld(true);
      physics.setCubeTransform(specimen.position,specimen.quaternion);
      return true;
    }
  };
}

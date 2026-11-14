import * as THREE from 'three';
import {createMazePlan,getMazeLayout,mazeDimensions,mazePoint} from './maze-geometry.js';
import {createMazeRoom} from './maze-room.js';

// A small circular walker against the actual tapered wall footprints. Substeps
// prevent tunnelling, while separate axis moves let the player slide along walls.
export function createMazeWalker(){
  const {size,unit,hinge,height}=mazeDimensions,radius=.017;
  const polygons=getMazeLayout().hulls.map(hull=>hull.vertices.slice(0,4));
  const {courtyard,walls,goal,goalLabel}=createMazePlan(),position=new THREE.Vector3();
  const entryColumn=Math.floor(size/2),entryRow=size-2;
  const [dx,dz]=[[0,-1],[1,0],[-1,0]].find(([x,z])=>!walls[entryRow+z][entryColumn+x]);
  const heading=-Math.atan2(dx,-dz);
  function grid(x,z){
    const row=z/unit+size/2,taper=1-.28*Math.max(0,(row-hinge)/(size-hinge));
    return [x/(unit*taper)+size/2,row];
  }
  function canStand(x,z,clearance=radius){
    const [column,row]=grid(x,z);
    if(column<.25||column>size-.25||row<.25||row>size-.25||walls[Math.floor(row)]?.[Math.floor(column)]!==0)return false;
    for(const polygon of polygons){
      let inside=true,nearest=Infinity;
      for(let i=0;i<4;i++){
        const a=polygon[i],b=polygon[(i+1)%4],dx=b.x-a.x,dz=b.z-a.z;
        if(dx*(z-a.z)-dz*(x-a.x)<0)inside=false;
        const t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
        nearest=Math.min(nearest,(x-a.x-dx*t)**2+(z-a.z-dz*t)**2);
      }
      if(inside||nearest<clearance*clearance)return false;
    }
    return true;
  }
  function reset(){position.copy(mazePoint(size/2,size-1.5,-height/2+.21));}
  reset();
  return {position,canStand,reset,heading,goalLabel,
    visitCourtyard(){
      for(const offset of [2,1,0,-1,-2]){
        const spot=mazePoint(goal.x+.5,goal.z+.5+offset,.015);
        if(canStand(spot.x,spot.z)){position.copy(spot);return true;}
      }
      return false;
    },
    move(dx,dz,dy=0){
      if(!dx&&!dz&&!dy)return false;
      const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.005)),startX=position.x,startZ=position.z,startY=position.y;
      for(let i=0;i<steps;i++){
        if(canStand(position.x+dx/steps,position.z))position.x+=dx/steps;
        if(canStand(position.x,position.z+dz/steps))position.z+=dz/steps;
      }
      position.y=THREE.MathUtils.clamp(position.y+dy,-height/2+radius+.005,height/2-radius-.005);
      return position.x!==startX||position.z!==startZ||position.y!==startY;
    },
    get inCourtyard(){
      const [x,z]=grid(position.x,position.z);
      return x>courtyard.left*2+1&&x<(courtyard.right+1)*2&&z>courtyard.top*2+1&&z<(courtyard.bottom+1)*2;
    }
  };
}

export function createMazeNavigation({camera,controls,specimen,canvas,stage,button,panel,onEnter,onExit,invalidate,isPaused=()=>false}){
  let walker=createMazeWalker();
  const keys=new Set(),held=new Map(),velocity=new THREE.Vector3();
  const rotation=new THREE.Quaternion(),localRotation=new THREE.Quaternion(),angles=new THREE.Euler(0,0,0,'YXZ');
  let active=false,saved=null,yaw=0,pitch=0,drag=null;
  const status=panel.querySelector('[role=status]');
  let room=createMazeRoom({specimen,scene:specimen.parent,canStand:walker.canStand});
  function syncCamera(){
    specimen.updateWorldMatrix(true,false);specimen.getWorldQuaternion(rotation);
    camera.position.copy(walker.position).applyMatrix4(specimen.matrixWorld);
    localRotation.setFromEuler(angles.set(pitch,yaw,0,'YXZ'));
    camera.quaternion.copy(rotation).multiply(localRotation);camera.updateMatrixWorld();
    if(room.update(camera))invalidate(true);
    status.textContent=walker.inCourtyard?'Destination reached':'Find the '+walker.goalLabel;
    invalidate();
  }
  function clearInput(){
    keys.clear();velocity.set(0,0,0);
    for(const [id,element] of held){if(element.hasPointerCapture(id))element.releasePointerCapture(id);element.classList.remove('held');}
    held.clear();
    if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);
    drag=null;
  }
  function enter(){
    if(active)return;
    saved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),up:camera.up.clone(),near:camera.near,far:camera.far,fov:camera.fov,
      target:controls.target.clone(),autoRotate:controls.autoRotate,enabled:controls.enabled,damping:controls.enableDamping,
      label:canvas.getAttribute('aria-label'),title:canvas.title};
    controls.autoRotate=false;controls.enableDamping=false;controls.update(0);controls.enableDamping=saved.damping;controls.enabled=false;
    active=true;clearInput();walker.reset();yaw=walker.heading;pitch=0;
    camera.near=.001;camera.far=80;camera.fov=75;camera.clearViewOffset();camera.updateProjectionMatrix();
    stage.classList.add('maze-fpv-active');panel.hidden=false;button.hidden=true;room.setActive(true);
    onEnter();
    invalidate(true);
    canvas.title='WASD or ↑ ↓ to move · ← → to turn · Space to rise · Ctrl to descend · Drag to look · Esc to exit';
    canvas.setAttribute('aria-label','First-person maze. WASD or up and down arrows to walk. Left and right arrows turn. Hold Space to rise and Control to descend. Drag to look around. Escape returns to the overview.');
    canvas.focus({preventScroll:true});syncCamera();
  }
  function exit(){
    if(!active)return;
    active=false;clearInput();room.setActive(false);panel.hidden=true;stage.classList.remove('maze-fpv-active');button.hidden=false;
    camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);camera.up.copy(saved.up);
    camera.near=saved.near;camera.far=saved.far;camera.fov=saved.fov;camera.updateProjectionMatrix();
    controls.target.copy(saved.target);controls.enabled=saved.enabled;controls.autoRotate=saved.autoRotate;
    canvas.setAttribute('aria-label',saved.label);canvas.title=saved.title;
    onExit();invalidate(true);button.focus({preventScroll:true});
  }
  const actions={KeyW:'forward',ArrowUp:'forward',KeyS:'back',ArrowDown:'back',KeyA:'left',KeyD:'right',ArrowLeft:'turnLeft',ArrowRight:'turnRight',Space:'up',ControlLeft:'down',ControlRight:'down'};
  window.addEventListener('keydown',event=>{
    if(!active||isPaused()||event.target.matches?.('input,select,textarea,[contenteditable=true]'))return;
    if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();exit();return;}
    if(actions[event.code]){event.preventDefault();event.stopImmediatePropagation();keys.add(event.code);}
  },true);
  window.addEventListener('keyup',event=>{keys.delete(event.code);});
  window.addEventListener('blur',clearInput);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
  canvas.addEventListener('pointerdown',event=>{
    if(!active||isPaused()||event.button!==0||drag)return;
    event.preventDefault();drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!active||drag?.id!==event.pointerId)return;
    yaw-=(event.clientX-drag.x)*.004;pitch=THREE.MathUtils.clamp(pitch-(event.clientY-drag.y)*.004,-1.25,1.25);
    drag.x=event.clientX;drag.y=event.clientY;syncCamera();
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(drag?.id===event.pointerId)drag=null;});
  for(const element of panel.querySelectorAll('[data-walk]')){
    element.addEventListener('pointerdown',event=>{
      event.preventDefault();held.set(event.pointerId,element);element.setPointerCapture(event.pointerId);element.classList.add('held');
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(name,event=>{held.delete(event.pointerId);element.classList.remove('held');});
    // Keyboard and assistive-technology activation also provide a small step.
    element.addEventListener('click',event=>{if(active&&event.detail===0){const action=element.dataset.walk;step(.1,new Set([action]));}});
  }
  function step(dt,actions){
    const turn=Number(actions.has('turnLeft'))-Number(actions.has('turnRight'));
    yaw+=turn*dt*1.8;
    const x=Number(actions.has('right'))-Number(actions.has('left')),z=Number(actions.has('back'))-Number(actions.has('forward'));
    const vertical=Number(actions.has('up'))-Number(actions.has('down'));
    const length=Math.max(1,Math.hypot(x,z,vertical)),speed=.24;
    velocity.x=THREE.MathUtils.damp(velocity.x,(x*Math.cos(yaw)+z*Math.sin(yaw))/length*speed,14,dt);
    velocity.z=THREE.MathUtils.damp(velocity.z,(-x*Math.sin(yaw)+z*Math.cos(yaw))/length*speed,14,dt);
    velocity.y=THREE.MathUtils.damp(velocity.y,vertical/length*speed,14,dt);
    if(velocity.lengthSq()<1e-8)velocity.set(0,0,0);
    const moved=walker.move(velocity.x*dt,velocity.z*dt,velocity.y*dt);
    if(moved||turn)syncCamera();
    const lanternMoved=room.update(camera,dt,moved?velocity.length():0);
    if(lanternMoved)invalidate(true);
    return moved||!!turn||lanternMoved;
  }
  button.addEventListener('click',enter);
  panel.querySelector('[data-fpv-exit]').addEventListener('click',exit);
  panel.querySelector('[data-fpv-courtyard]').addEventListener('click',()=>{
    if(!active)return;
    clearInput();if(!walker.visitCourtyard())return;
    yaw=walker.position.z>=room.interior.ritual.center.z?0:Math.PI;pitch=.3;
    syncCamera();room.interior.advance(1/60,camera);canvas.focus({preventScroll:true});
  });
  panel.querySelector('[data-fpv-restart]').addEventListener('click',()=>{clearInput();walker.reset();yaw=walker.heading;pitch=0;syncCamera();canvas.focus({preventScroll:true});});
  return {get active(){return active;},get walker(){return walker;},get room(){return room;},enter,exit,
    refreshMap(){exit();clearInput();room.dispose();walker=createMazeWalker();room=createMazeRoom({specimen,scene:specimen.parent,canStand:walker.canStand});},
    update(dt){
      if(!active)return false;
      if(isPaused()){clearInput();const moved=room.update(camera,dt,0);if(moved)invalidate(true);return moved;}
      const input=new Set([...keys].map(key=>actions[key]));
      for(const element of held.values())input.add(element.dataset.walk);
      return step(Math.min(dt,.05),input);
    }
  };
}

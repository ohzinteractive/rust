import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';

export function createChangingWind(seed=1){
  let random=seededRandom(seed),elapsed=0,duration=8,from=0,to=0,fromStrength=1,toStrength=1;
  return {reset(){random=seededRandom(seed);elapsed=0;duration=8;from=to=0;fromStrength=toStrength=1;},
    advance(dt,baseStrength,baseDirection,enabled){
      if(!enabled)return {strength:baseStrength,direction:baseDirection};
      elapsed+=dt;
      while(elapsed>=duration){elapsed-=duration;from=to;fromStrength=toStrength;to=(random()-.5)*160;toStrength=.35+random()*1.2;duration=7+random()*9;}
      const t=THREE.MathUtils.smoothstep(elapsed,0,duration);
      return {strength:THREE.MathUtils.clamp(baseStrength*THREE.MathUtils.lerp(fromStrength,toStrength,t),0,1),direction:baseDirection+THREE.MathUtils.lerp(from,to,t)};
    }};
}

export function createWindmill(parent,floorY){
  const group=new THREE.Group();group.name='Wind direction windmill';group.position.set(-1.15,floorY,-.35);parent.add(group);
  const metal=new THREE.MeshStandardMaterial({color:0x9a9270,roughness:.75}),wood=new THREE.MeshStandardMaterial({color:0x514c38,roughness:1});
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.014,.025,.85,6),wood);mast.position.y=.425;group.add(mast);
  const head=new THREE.Group();head.position.y=.85;group.add(head);
  const rotor=new THREE.Group();rotor.position.z=.045;head.add(rotor);
  for(let i=0;i<4;i++){
    const arm=new THREE.Group();arm.rotation.z=i*Math.PI/2;
    const blade=new THREE.Mesh(new THREE.BoxGeometry(.065,.18,.012),metal);blade.position.y=.115;blade.rotation.y=.25;arm.add(blade);rotor.add(arm);
  }
  const hub=new THREE.Mesh(new THREE.SphereGeometry(.034,8,6),metal);rotor.add(hub);
  const tail=new THREE.Mesh(new THREE.BoxGeometry(.12,.1,.012),wood);tail.position.set(0,0,-.28);tail.rotation.y=Math.PI/2;head.add(tail);
  const tailArm=new THREE.Mesh(new THREE.BoxGeometry(.014,.014,.28),metal);tailArm.position.z=-.14;head.add(tailArm);
  const trails=createWindTrails(group);
  group.traverse(n=>{if(n.isMesh)n.castShadow=true;});
  return {group,update(dt,strength,direction){head.rotation.y=Math.atan2(-Math.cos(direction*Math.PI/180),-Math.sin(direction*Math.PI/180));rotor.rotation.z=(rotor.rotation.z+dt*strength*9)%(Math.PI*2);trails.update(dt,strength,direction);},dispose(){trails.dispose();group.traverse(n=>n.geometry?.dispose());metal.dispose();wood.dispose();group.removeFromParent();}};
}

// Intersect the pointer with a horizontal air plane through the rotor hub.
export function pointerFernWind(pointer,camera,origin,raycaster,out=new THREE.Vector3()){
  raycaster.setFromCamera(pointer,camera);
  const ray=raycaster.ray,dy=ray.direction.y;
  const distance=Math.abs(dy)>.00001?(origin.y-ray.origin.y)/dy:-1;
  if(distance>0)ray.at(Math.min(distance,200),out);
  else ray.at(200,out);
  const x=out.x-origin.x,z=out.z-origin.z;
  return {strength:THREE.MathUtils.clamp(Math.hypot(x,z)/5,0,1),direction:Math.atan2(z,x)*180/Math.PI};
}


// Short translucent ribbons of air, drawn in a single line batch. Their cool
// tint distinguishes airflow from the warm reproductive spores.
export function createWindTrails(parent){
  const count=32,segments=5,positions=new Float32Array(count*segments*6),colors=new Float32Array(positions.length);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.32,depthWrite:false});
  const lines=new THREE.LineSegments(geometry,material);lines.name='Flowing wind streaks';lines.frustumCulled=false;parent.add(lines);
  const random=seededRandom(1987),particles=Array.from({length:count},()=>({phase:random(),side:(random()-.5)*1.25,height:.38+random()*.95,bend:random()*6.28}));
  let time=0,angle=0;
  return {lines,update(dt,strength,direction){
    time+=dt;const desired=direction*Math.PI/180;
    const delta=Math.atan2(Math.sin(desired-angle),Math.cos(desired-angle));angle+=delta*(dt>0?1-Math.exp(-dt*4):1);
    const co=Math.cos(angle),si=Math.sin(angle);lines.visible=strength>.015;material.opacity=.12+.22*strength;
    let offset=0;
    for(const p of particles){
      p.phase=(p.phase+dt*(.12+strength*.3))%1;
      const fade=Math.sin(p.phase*Math.PI)**2;
      for(let segment=0;segment<segments;segment++)for(let end=0;end<2;end++){
        const tail=(segment+end)/segments,u=Math.max(0,p.phase-tail*.055),distance=-.3+u*(2+strength*4);
        const across=p.side+Math.sin(u*8+p.bend+time*.25)*.12;
        positions[offset]=co*distance-si*across;positions[offset+1]=p.height+Math.sin(u*7+p.bend)*.07;positions[offset+2]=si*distance+co*across;
        const brightness=fade*(1-tail)*.8;colors[offset]=brightness*.65;colors[offset+1]=brightness*.83;colors[offset+2]=brightness;
        offset+=3;
      }
    }
    geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;
  },dispose(){geometry.dispose();material.dispose();lines.removeFromParent();}};
}


// Keep the full turning radius of the rotor and tail outside the planted
// object's box. Placement is fixed until the object is rebuilt.
export function windmillCorner(bounds,floorY,canopyReach=0,out=new THREE.Vector3()){
  const clearance=.4+Math.max(0,canopyReach);
  return out.set(bounds.min.x-clearance,floorY,bounds.max.z+clearance);
}

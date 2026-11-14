import * as THREE from 'three';
import {createFeatherFlight} from './feather-flight.js';
import {createMazeFlight} from './maze-flight.js';
import {createMazePlan,mazePoint} from './maze-geometry.js';

// A shared faceted vane, with asymmetric barbs, raised rachis and a bare quill.
export function createRitualFeatherGeometry(){
  const positions=[],colors=[];
  function triangle(a,b,c,shade){for(const p of [a,b,c]){positions.push(...p);colors.push(shade,shade*.98,shade*.92);}}
  const rows=24;
  function row(i){
    const t=i/rows,y=t-.5,x=.035*Math.sin(t*Math.PI),v=Math.max(0,Math.sin(Math.PI*Math.max(0,(t-.13)/.87)));
    const notch=i%3===0?.90:1;
    return [[x-.23*v**.8*notch,y+.095*v,-.009],[x,y,.045*Math.sin(t*Math.PI)],[x+.17*v**.95*notch,y+.075*v,-.018]];
  }
  for(let i=0;i<rows;i++){
    const a=row(i),b=row(i+1);
    triangle(a[0],a[1],b[1],.87);triangle(a[0],b[1],b[0],.91);
    triangle(a[1],a[2],b[2],1);triangle(a[1],b[2],b[1],1.06);
    // A continuous raised rachis follows the curved vane down to the bare quill.
    const spine=t=>{const x=.035*Math.sin(t*Math.PI),y=t-.5,z=.052*Math.sin(t*Math.PI)+.006,w=.007*(1-.65*t);return [[x-w,y,z],[x,y,z+.005],[x+w,y,z]];};
    const s=spine(i/rows),t=spine((i+1)/rows);
    triangle(s[0],s[1],t[1],1.08);triangle(s[0],t[1],t[0],1.08);
    triangle(s[1],s[2],t[2],1.16);triangle(s[1],t[2],t[1],1.16);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}

export function createCourtyardRitual({parent,canStand}){
  const {goal}=createMazePlan(),center=mazePoint(goal.x+.5,goal.z+.5),group=new THREE.Group();group.name='Celestial feather ritual';parent.add(group);
  const geometry=createRitualFeatherGeometry();
  const heroMaterial=new THREE.MeshStandardMaterial({color:0xe3cd9c,vertexColors:true,metalness:.42,roughness:.48,flatShading:true,side:THREE.DoubleSide});
  const ambientMaterial=new THREE.MeshStandardMaterial({color:0xcbbf9f,vertexColors:true,metalness:.2,roughness:.66,flatShading:true,side:THREE.DoubleSide});
  const heroes=new THREE.InstancedMesh(geometry,heroMaterial,8),ambient=new THREE.InstancedMesh(geometry,ambientMaterial,28);
  heroes.name='Hero feathers';ambient.name='Ambient feathers';heroes.castShadow=true;
  for(const mesh of [heroes,ambient]){mesh.count=0;mesh.frustumCulled=false;group.add(mesh);}
  const dustGeometry=new THREE.BufferGeometry(),dustPositions=new Float32Array(128*3);
  dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
  const dustMaterial=new THREE.PointsMaterial({color:0xd9bd82,size:.0008,transparent:true,opacity:.04,depthWrite:false});
  dustMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','if(length(gl_PointCoord-vec2(.5))>.5)discard;\n#include <color_fragment>');};
  const dust=new THREE.Points(dustGeometry,dustMaterial);dust.name='Golden dust';dust.frustumCulled=false;group.add(dust);
  const flight=createFeatherFlight(),environment=createMazeFlight(parent);
  const local=new THREE.Vector3(),world=new THREE.Vector3(),cameraLocal=new THREE.Vector3(),up=new THREE.Vector3(),scale=new THREE.Vector3();
  const matrix=new THREE.Matrix4(),inverse=new THREE.Matrix4(),rotation=new THREE.Quaternion(),frameRotation=new THREE.Quaternion(),inverseRotation=new THREE.Quaternion(),color=new THREE.Color();
  let clock=0,orbit=0,arrival=null,launched=0;
  function target(id,out){
    const hero=id<8,index=hero?id:id-8,phase=index*2.399+(hero?0:.7),angle=orbit*(hero?.065:.09)+phase;
    let radius=hero?.115+(index%3)*.009:.23+(index%5)*.014;
    const y=-.075+(.5+.5*Math.sin(orbit*.075+phase))*.15;
    for(let i=0;i<6;i++){
      out.set(center.x+Math.cos(angle)*radius,y,center.z+Math.sin(angle)*radius*.78);
      if(canStand(out.x,out.z,hero?.045:.022))break;
      radius*=.72;
    }
    return out;
  }
  environment.target=(f,time,out)=>{target(f.id,local).applyMatrix4(parent.matrixWorld);out.copy(local);};
  flight.setEnvironment(environment);
  function frame(){parent.updateWorldMatrix(true,false);environment.sync();inverse.copy(parent.matrixWorld).invert();parent.getWorldQuaternion(frameRotation);inverseRotation.copy(frameRotation).invert();}
  function launchTo(count){
    for(;launched<count;launched++){
      const hero=launched<8,size=hero?.058:.022+(launched%4)*.002;
      target(launched,local);world.copy(local).applyMatrix4(parent.matrixWorld);
      rotation.setFromEuler(new THREE.Euler(.2,launched*2.399,.4)).premultiply(frameRotation);
      const accepted=flight.launch({id:launched,position:world,quaternion:rotation,center:{x:0,y:0,z:0},half:{x:size*.25,y:size*.52,z:size*.06},normal:{x:0,y:0,z:0}});
      if(!accepted)break;
      const body=flight.get(launched)?.body;if(body)body.angularVelocity.set(0,hero?.045:.065,0);
    }
  }
  function draw(){
    heroes.count=Math.min(8,launched);ambient.count=Math.max(0,launched-8);
    for(const f of flight.entries){
      const hero=f.id<8,size=hero?.058:.022+(f.id%4)*.002,mesh=hero?heroes:ambient,index=hero?f.id:f.id-8;
      local.copy(f.body.position).applyMatrix4(inverse);rotation.copy(f.body.quaternion).premultiply(inverseRotation);
      const clearance=THREE.MathUtils.smoothstep(local.distanceTo(cameraLocal),.045,.14),visibility=(.25+.75*clearance)*THREE.MathUtils.smoothstep(f.age,0,.8);
      scale.set(size*1.12,size,size*.85).multiplyScalar(visibility);mesh.setMatrixAt(index,matrix.compose(local,rotation,scale));
      const radius=Math.hypot(local.x-center.x,local.z-center.z),light=hero?1.12-radius*.9:.72-radius*.25;
      color.setRGB(light,light*.96,light*.86);mesh.setColorAt(index,color);
    }
    for(const mesh of [heroes,ambient]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  return {group,heroes,ambient,dust,center,
    get stats(){return {heroes:heroes.count,ambient:ambient.count,total:heroes.count+ambient.count,dust:128,phase:arrival===null?'arrival':clock-arrival<3?'awakening':clock-arrival<12?'vortex':'settled'};},
    advance(dt,camera){
      if(!(dt>0))return false;dt=Math.min(dt,.05);clock+=dt;frame();
      if(camera){camera.updateWorldMatrix(true,false);world.setFromMatrixPosition(camera.matrixWorld);cameraLocal.copy(world).applyMatrix4(inverse);up.setFromMatrixColumn(parent.matrixWorld,1).normalize();flight.setCamera(world,up,.025);
        if(arrival===null&&Math.hypot(cameraLocal.x-center.x,cameraLocal.z-center.z)<.40)arrival=clock;
      }else{cameraLocal.set(100,100,100);flight.setCamera(null);}
      const reveal=arrival===null?0:THREE.MathUtils.smoothstep(clock-arrival,0,9);
      orbit+=dt*(.25+.75*reveal);launchTo(4+Math.floor(reveal*32));
      flight.step(dt,{x:0,y:0,z:0},0);draw();dustMaterial.opacity=.035+.075*reveal;
      for(let i=0;i<128;i++){
        const phase=i*2.399+orbit*.035,radius=.10+(i%17)/17*.24;
        let x=center.x+Math.cos(phase)*radius,z=center.z+Math.sin(phase)*radius*.8;
        if(!canStand(x,z,.002)){x=center.x+(x-center.x)*.35;z=center.z+(z-center.z)*.35;}
        dustPositions[i*3]=x;dustPositions[i*3+1]=-.14+((i*.618+clock*.009)%1)*.28;dustPositions[i*3+2]=z;
      }
      dustGeometry.attributes.position.needsUpdate=true;return true;
    },
    dispose(){flight.setEnvironment(null);group.removeFromParent();geometry.dispose();heroMaterial.dispose();ambientMaterial.dispose();dustGeometry.dispose();dustMaterial.dispose();}
  };
}

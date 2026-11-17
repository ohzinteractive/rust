import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';
import {createSeabedStoneGeometry,createSeabedStoneMaterial,seabedHeight} from './kelp-seabed.js';

// Stones and attachment paths use a separate seed so changing the holdfasts
// does not reshuffle the blades or the forest's existing clearings.
export function createKelpHoldfasts({count,seed,sunlight,time}){
  const random=seededRandom(seed+19073),geometry=createSeabedStoneGeometry(),p=new THREE.Vector3();
  const material=createSeabedStoneMaterial({sunlight,time});
  const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.name='Kelp support stones';mesh.count=0;mesh.castShadow=true;mesh.receiveShadow=true;
  const probe=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),ray=new THREE.Raycaster(),hits=[];
  const dummy=new THREE.Object3D(),local=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0),stones=[];
  function surface(stone,x,z,out){
    probe.matrixWorld.copy(stone.matrix);ray.set(local.set(x,3,z),down);hits.length=0;ray.intersectObject(probe,false,hits);
    if(!hits.length)return false;out.copy(hits[0].point);return true;
  }
  function place(root){
    let stone=stones.find(candidate=>{
      local.set(root.x,candidate.center.y,root.z).applyMatrix4(candidate.inverse);
      return local.x*local.x+local.z*local.z<.24;
    });
    if(!stone){
      const sx=.62+random()*.48,sy=.28+random()*.18,sz=.52+random()*.48;
      dummy.position.set(root.x,seabedHeight(root.x,root.z)+sy*.2,root.z);dummy.scale.set(sx,sy,sz);dummy.rotation.set((random()-.5)*.16,random()*Math.PI*2,(random()-.5)*.16);dummy.updateMatrix();
      stone={matrix:dummy.matrix.clone(),inverse:dummy.matrix.clone().invert(),center:dummy.position.clone(),rx:sx,rz:sz,angle:dummy.rotation.y,height:sy*geometry.boundingSphere.radius,collisionCenters:[]};
      for(const x of [-.55,0,.55])for(const z of [-.55,0,.55])stone.collisionCenters.push(new THREE.Vector3(x,0,z).applyMatrix4(stone.matrix));
      mesh.setMatrixAt(stones.length,stone.matrix);mesh.setColorAt(stones.length,new THREE.Color().setRGB(.78+random()*.22,.82+random()*.18,.75+random()*.22));
      stones.push(stone);mesh.count=stones.length;
    }
    return stone;
  }
  function attach(root,phase){
    // Resolve the complete rock field first, so a later neighbouring boulder
    // cannot bury an attachment point generated earlier in the loop.
    let stone=null,top=-Infinity;
    for(const candidate of stones)if(surface(candidate,root.x,root.z,p)&&p.y>top){stone=candidate;top=p.y;}
    if(!stone)throw Error('Kelp holdfast missed its support stone');
    root.y=top+.012;
    const paths=[];
    for(let finger=0;finger<8;finger++){
      const angle=phase+finger*Math.PI/4,winding=.14*Math.sin(finger*2.7+phase),points=[root.clone()];
      let reach=0;
      for(let d=.04;d<2.4;d+=.04){
        if(!surface(stone,root.x+Math.cos(angle)*d,root.z+Math.sin(angle)*d,p))break;
        reach=d;
      }
      for(let step=1;step<=12;step++){
        const t=step/12,d=reach*t*.97,a=angle+winding*Math.sin(t*Math.PI);
        if(!surface(stone,root.x+Math.cos(a)*d,root.z+Math.sin(a)*d,p))break;
        p.y+=.009;points.push(p.clone());
      }
      paths.push(points);
      // Short lateral fingers grip the rock rather than radiating like roots
      // growing in sand. Both branches follow the same measured stone surface.
      for(const side of points.length>7?[-1,1]:[]){
        const branch=[points[7].clone()];
        for(let step=1;step<=5;step++){
          const t=step/5,d=reach*(.56+.29*t),a=angle+winding+side*.24*t;
          if(!surface(stone,root.x+Math.cos(a)*d,root.z+Math.sin(a)*d,p))break;
          p.y+=.006;branch.push(p.clone());
        }
        if(branch.length>2)paths.push(branch);
      }
    }
    return {stone:stones.indexOf(stone),paths};
  }
  return {mesh,stones,prepare(roots){roots.forEach(place);},attach,finish(){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.computeBoundingBox();probe.material.dispose();}};
}

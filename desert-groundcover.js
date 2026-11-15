import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';
import {oasisCenter,oasisWaterRadius} from './oasis-shape.js';

export function createDesertGroundcover({heightAt}){
  const group=new THREE.Group();group.name='Oasis ground details';
  const rockGeometry=new THREE.IcosahedronGeometry(1,0),rockMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
  const rocks=new THREE.InstancedMesh(rockGeometry,rockMaterial,28);rocks.name='Scattered oasis pebbles';rocks.castShadow=rocks.receiveShadow=true;group.add(rocks);
  const positions=[],indices=[];
  for(let i=0;i<=5;i++){
    const t=i/5,width=.009*Math.pow(1-t,.7);positions.push(-width,t,t*t*.22,width,t,t*t*.22);
    if(i<5){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const grassGeometry=new THREE.BufferGeometry();grassGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));grassGeometry.setIndex(indices);grassGeometry.computeVertexNormals();
  const grassMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,side:THREE.DoubleSide});
  const grass=new THREE.InstancedMesh(grassGeometry,grassMaterial,120);grass.name='Dry grass beneath the palms';grass.castShadow=grass.receiveShadow=true;group.add(grass);
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion(),color=new THREE.Color();
  function dryPoint(x,z){
    const radius=oasisWaterRadius(x,z);if(radius<1.1){x=oasisCenter.x+(x-oasisCenter.x)*1.1/radius;z=oasisCenter.y+(z-oasisCenter.y)*1.1/radius;}return [x,z];
  }
  function rebuild(seed,roots){
    const random=seededRandom(seed+9231);
    for(let i=0;i<rocks.count;i++){
      const root=roots[i%roots.length],angle=random()*Math.PI*2,distance=.35+random()*.9,[x,z]=dryPoint(root[0]+Math.cos(angle)*distance,root[2]+Math.sin(angle)*distance);
      scale.set(.025+random()*.045,.018+random()*.025,.025+random()*.04);position.set(x,heightAt(x,z)+scale.y*.4,z);
      rotation.setFromEuler(new THREE.Euler(random(),random()*Math.PI*2,random()));rocks.setMatrixAt(i,matrix.compose(position,rotation,scale));
      rocks.setColorAt(i,color.set(0x9e9276).multiplyScalar(.72+random()*.35));
    }
    for(let clump=0;clump<10;clump++){
      const root=roots[clump%roots.length],angle=random()*Math.PI*2,[x,z]=dryPoint(root[0]+Math.cos(angle)*.55,root[2]+Math.sin(angle)*.55);
      for(let blade=0;blade<12;blade++){
        const [bx,bz]=dryPoint(x+(random()-.5)*.15,z+(random()-.5)*.15);
        position.set(bx,heightAt(bx,bz),bz);scale.set(.5+random()*.65,.09+random()*.13,.5+random());rotation.setFromEuler(new THREE.Euler((random()-.5)*.3,random()*Math.PI*2,(random()-.5)*.3));
        const i=clump*12+blade;grass.setMatrixAt(i,matrix.compose(position,rotation,scale));grass.setColorAt(i,color.set(random()<.65?0x929064:0x6e7a4e).multiplyScalar(.75+random()*.3));
      }
    }
    for(const mesh of [rocks,grass]){mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
  }
  return {group,rocks,grass,rebuild,dispose(){rocks.dispose();grass.dispose();rockGeometry.dispose();rockMaterial.dispose();grassGeometry.dispose();grassMaterial.dispose();group.removeFromParent();}};
}

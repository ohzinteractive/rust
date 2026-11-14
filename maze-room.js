import * as THREE from 'three';
import {mazeDimensions,createMazeFloorGeometry} from './maze-geometry.js';
import {createMazeInterior} from './maze-interior.js';

export function createMazeRoom({specimen,scene,canStand}){
  const group=new THREE.Group();group.name='Maze interior';specimen.add(group);
  const geometry=createMazeFloorGeometry();
  const floor=new THREE.Mesh(geometry,null);
  floor.name='Maze walking floor';floor.rotation.x=-Math.PI/2;floor.position.y=-mazeDimensions.height/2+.0001;
  // The ceiling's actual triangle winding and normals face into the room so
  // surface sampling grows its feathers downwards and sees it from below.
  const roofGeometry=geometry.clone(),indices=roofGeometry.index;
  for(let i=0;i<indices.count;i+=3){const b=indices.getX(i+1);indices.setX(i+1,indices.getX(i+2));indices.setX(i+2,b);}
  roofGeometry.computeVertexNormals();
  const roof=new THREE.Mesh(roofGeometry,null);
  roof.name='Maze ceiling';roof.rotation.x=-Math.PI/2;roof.position.y=mazeDimensions.height/2-.0001;
  for(const mesh of [floor,roof]){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  group.add(new THREE.AmbientLight(0xc6d4ff,.55));
  const interior=createMazeInterior({group,floor,roof,canStand});

  const lantern=new THREE.Group();lantern.name='Carried lantern';scene.add(lantern);
  const brass=new THREE.MeshStandardMaterial({color:0xc29a57,roughness:.25,metalness:.72});
  function part(shape,material,x=0,y=0,z=0){const mesh=new THREE.Mesh(shape,material);mesh.position.set(x,y,z);lantern.add(mesh);return mesh;}
  const crystal=part(new THREE.OctahedronGeometry(.005),new THREE.MeshBasicMaterial({color:0xffe5ae}));crystal.scale.y=2.4;
  for(const angle of [0,Math.PI/2]){
    const ring=part(new THREE.TorusGeometry(.007,.0005,4,4),brass);ring.rotation.y=angle;ring.rotation.z=Math.PI/4;ring.scale.y=1.8;
  }
  part(new THREE.CylinderGeometry(.004,.005,.002,8),brass,0,-.014);

  const light=new THREE.PointLight(0xffdb9e,.004,.75,2);light.name='Lantern light';light.castShadow=true;
  light.shadow.mapSize.set(256,256);light.shadow.camera.near=.003;light.shadow.bias=-.00005;light.shadow.normalBias=.0004;
  lantern.add(light);
  const inverse=new THREE.Matrix4(),local=new THREE.Vector3(),offset=new THREE.Vector3(),world=new THREE.Vector3(),rotation=new THREE.Quaternion();
  let phase=0,bob=0,active=false;
  function setActive(value){active=value;group.visible=value;floor.visible=value;roof.visible=value;lantern.visible=value;light.visible=value;if(!value){bob=0;phase=0;}}
  setActive(false);
  return {group,floor,roof,lantern,light,setActive,interior,
    update(camera,dt=0,speed=0){
      if(!active)return false;
      const previous=bob;bob=THREE.MathUtils.damp(bob,Math.min(1,speed/.24),10,dt);
      if(bob<.0001)bob=0;
      phase+=dt*speed*35;
      const scale=Math.min(1,camera.aspect/.9);
      offset.set(Math.min(.026,camera.aspect*.022)+Math.sin(phase*.5)*.001*bob,-.035+Math.sin(phase)*.0016*bob,-.065);
      camera.updateWorldMatrix(true,false);specimen.updateWorldMatrix(true,false);camera.getWorldQuaternion(rotation);
      inverse.copy(specimen.matrixWorld).invert();
      // Pull the hand inward near walls so the lantern and its light stay in
      // the corridor, including when the player is looking into a corner.
      let retraction=.1;
      for(const fraction of [1,.8,.6,.4,.2,.1]){
        world.copy(offset).multiplyScalar(fraction).applyMatrix4(camera.matrixWorld);
        local.copy(world).applyMatrix4(inverse);
        retraction=fraction;
        const clearance=Math.max(.004,.02*scale*fraction+.001);
        if(canStand(local.x,local.z,clearance)&&Math.abs(local.y)<mazeDimensions.height/2-clearance)break;
      }
      lantern.scale.setScalar(scale*retraction);
      const moved=lantern.position.distanceToSquared(world)>1e-12||1-Math.abs(lantern.quaternion.dot(rotation))>1e-8;
      lantern.position.copy(world);lantern.quaternion.copy(rotation);
      if(moved||bob!==previous||speed>0){light.shadow.needsUpdate=true;return true;}
      return false;
    },
    dispose(){
      interior.dispose();
      group.removeFromParent();lantern.removeFromParent();
      const geometries=new Set(),materials=new Set();
      for(const root of [group,lantern])root.traverse(object=>{if(object.isMesh){geometries.add(object.geometry);materials.add(object.material);}});
      geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
      group.traverse(object=>{if(object.isLight)object.dispose?.();});light.dispose();
    }
  };
}

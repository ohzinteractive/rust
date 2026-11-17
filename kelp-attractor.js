import * as THREE from 'three';
import {createShapeGeometry} from './specimen-shapes.js';
import {createKelpSunlight,configureKelpSunlight} from './kelp-lighting.js';

// A grounded scene object plus a conservative collision envelope. Using its
// world bounds keeps the same body clearance for concave shapes and models.
export function createKelpAttractor({scene,floorY=-1.75,height=11,sunlight=createKelpSunlight(),getFloorHeight=()=>floorY,getSurfaceHeight=()=>floorY+height+.25,onImpact=()=>{},onReset=()=>{},reducedMotion=false}){
  const group=new THREE.Group();group.name='Kelp fish attractor';group.visible=false;scene.add(group);
  const material=new THREE.MeshStandardMaterial({name:'Submerged stone',color:0xa3b0a1,roughness:.76,metalness:.03,envMapIntensity:.55});
  // Buried objects need their light-facing surfaces in the shadow map too.
  // Back-face-only casting moves the shadow away from the sand contact.
  material.shadowSide=THREE.DoubleSide;
  configureKelpSunlight(material,sunlight,.65);
  const bounds=new THREE.Box3(),center=new THREE.Vector3(),half=new THREE.Vector3(),size=new THREE.Vector3();
  const normal=new THREE.Vector3();
  let mesh=null,shape=null,revision=0,disposed=false,reference=null;
  let fall=null,foundation=null;
  const orientedBounds=new THREE.Box3(),rotationMatrix=new THREE.Matrix4();
  function setPose(clearance,tilt=0,rock=0){
    mesh.rotation.set(tilt,0,rock);
    rotationMatrix.makeRotationFromQuaternion(mesh.quaternion).scale(mesh.scale);
    orientedBounds.copy(mesh.geometry.boundingBox).applyMatrix4(rotationMatrix);
    mesh.position.set(0,foundation-group.position.y+clearance-orientedBounds.min.y,2.5);
    syncBounds();
  }
  function syncBounds(){
    group.updateMatrixWorld(true);bounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    bounds.getCenter(center);bounds.getSize(half).multiplyScalar(.5);
  }
  function discardReference(){if(reference?.mesh)reference.mesh.geometry.dispose();reference=null;}
  function place(startDrop=true){
    if(!mesh)return;
    mesh.geometry.computeBoundingBox();
    const local=mesh.geometry.boundingBox;local.getSize(size);
    const scale=Math.min(2.6,height*.65)/Math.max(size.x,size.y,size.z,.0001);
    mesh.scale.setScalar(scale);
    if(startDrop||foundation===null)foundation=getFloorHeight(group.position.x,group.position.z+2.5);
    const floor=foundation-group.position.y;
    const burial=Math.min(.16,size.y*scale*.12);
    const drop=Math.max(.2,getSurfaceHeight()-foundation-size.y*scale*.35);
    fall={age:0,burial,drop,hit:false,settle:0};
    if(reducedMotion||!startDrop){setPose(-burial);fall=null;}
    else setPose(drop,.19,-.13);
    if(reducedMotion&&startDrop)onImpact({x:center.x,z:center.z,y:floor+group.position.y,rx:half.x,rz:half.z,depth:burial,footprint:shape==='cube'?'box':'ellipse',quiet:true});
  }
  function removeMesh(){fall=null;onReset();if(mesh){mesh.geometry.dispose();mesh.removeFromParent();mesh=null;}shape=null;bounds.makeEmpty();}
  function install(kind,geometry){
    removeMesh();geometry.center();
    mesh=new THREE.Mesh(geometry,material);mesh.name=`Underwater ${kind}`;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);shape=kind;place();
  }
  function distanceTo(point,out=normal){
    if(!mesh){out.set(0,0,0);return Infinity;}
    const dx=point.x-center.x,dy=point.y-center.y,dz=point.z-center.z;
    const x=Math.abs(dx)-half.x,y=Math.abs(dy)-half.y,z=Math.abs(dz)-half.z;
    out.set(Math.max(0,x)*Math.sign(dx),Math.max(0,y)*Math.sign(dy),Math.max(0,z)*Math.sign(dz));
    const distance=out.length();
    if(distance>1e-9){out.multiplyScalar(1/distance);return distance;}
    // Never eject a fish down through the seabed under a grounded object.
    const allowedY=dy>=0?y:-Infinity;
    if(x>=allowedY&&x>=z){out.set(dx<0?-1:1,0,0);return x;}
    if(allowedY>=z){out.set(0,1,0);return y;}
    out.set(0,0,dz<0?-1:1);return z;
  }
  return {group,bounds,center,distanceTo,
    get shape(){return shape;},get hasShape(){return !!mesh;},get active(){return group.visible&&!!mesh;},
    get cubeReference(){return !!reference;},
    get falling(){return !!fall;},
    advance(dt){
      if(!group.visible||!mesh||!fall||!(dt>0))return false;
      dt=Math.min(dt,.1);fall.age+=dt;
      if(!fall.hit){
        // Drag limits descent speed while gravity gives the release some weight.
        const descent=3.2*(fall.age-(1-Math.exp(-2.8*fall.age))/2.8);
        const remaining=Math.max(0,fall.drop-descent),progress=1-remaining/fall.drop;
        const taper=1-progress*.8;
        setPose(remaining,(.19+Math.sin(fall.age*2.1)*.075)*taper,(-.13+Math.sin(fall.age*1.6)*.065)*taper);
        if(descent>=fall.drop){
          fall.hit=true;fall.tilt=mesh.rotation.x;fall.rock=mesh.rotation.z;
          onImpact({x:center.x,z:center.z,y:bounds.min.y,rx:half.x,rz:half.z,depth:fall.burial,footprint:shape==='cube'?'box':'ellipse',quiet:false});
        }
      }else{
        fall.settle+=dt;const t=Math.min(1,fall.settle/.75),ease=1-Math.pow(1-t,3);
        setPose(-fall.burial*ease,fall.tilt*(1-ease),fall.rock*(1-ease));
        if(t===1)fall=null;
      }
      return true;
    },
    setCubeReference(value){
      if(disposed)return;
      revision++;
      if(value&&!reference){
        reference={mesh,shape};mesh?.removeFromParent();mesh=null;shape=null;
        install('cube',new THREE.BoxGeometry(2,2,2));
      }else if(!value&&reference){
        removeMesh();mesh=reference.mesh;shape=reference.shape;reference=null;
        if(mesh){group.add(mesh);place();}
      }
    },
    get orbitRadius(){return Math.hypot(half.x,half.z);},get halfHeight(){return half.y;},
    setVisible(value){group.visible=!!value;},
    setWaterHeight(value){
      height=value;
      if(mesh){
        const previous=fall,offset=bounds.min.y-foundation,tilt=mesh.rotation.x,rock=mesh.rotation.z;
        place(false);
        if(previous){fall=previous;setPose(offset,tilt,rock);}
      }
    },
    setShape(kind){
      if(disposed)return;revision++;discardReference();
      install(kind,kind==='cube'?new THREE.BoxGeometry(2,2,2):createShapeGeometry(kind));
    },
    async loadHorse(){
      const request=++revision;
      const [{GLTFLoader},{disposeModel}]=await Promise.all([import('./vendor/GLTFLoader.js'),import('./model-import.js')]);
      if(disposed||request!==revision)return false;
      const gltf=await new GLTFLoader().loadAsync('./samples/horse.glb');
      try{
        if(disposed||request!==revision)return false;
        const root=gltf.scene,positions=[],point=new THREE.Vector3();root.updateMatrixWorld(true);
        root.traverse(object=>{
          if(!object.isMesh)return;object.skeleton?.update();
          const geometry=object.geometry,index=geometry.index;
          for(let i=0;i<(index?.count??geometry.attributes.position.count);i++){
            object.getVertexPosition(index?index.getX(i):i,point).applyMatrix4(object.matrixWorld);
            positions.push(point.x,point.y,point.z);
          }
        });
        if(!positions.length)throw Error('Horse has no visible geometry');
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
        discardReference();install('horse',geometry);return true;
      }finally{disposeModel(gltf.scene);}
    },
    project(point,padding,out=normal){
      const distance=distanceTo(point,out);
      if(distance>=padding)return false;
      point.addScaledVector(out,padding-distance+.00001);return true;
    },
    clear(){revision++;removeMesh();discardReference();},
    dispose(){disposed=true;revision++;removeMesh();discardReference();material.dispose();group.removeFromParent();},
  };
}

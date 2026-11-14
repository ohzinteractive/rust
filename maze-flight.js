import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';
import {createMazePlan,getMazeLayout,mazeDimensions,mazePoint} from './maze-geometry.js';

// The flight world uses world coordinates, while the maze plan is specimen-local.
// Separate wall bodies let the broadphase reject distant passages cheaply.
export function createMazeFlight(frame){
  const {size,unit,hinge,height}=mazeDimensions,{walls}=createMazePlan();
  const bodies=[],poses=[],matrix=new THREE.Matrix4(),inverse=new THREE.Matrix4();
  const point=new THREE.Vector3(),normal=new THREE.Vector3(),rotation=new THREE.Quaternion();
  let initialized=false;
  function add(shape,position,quaternion=new THREE.Quaternion()){
    const body=new CANNON.Body({mass:0,shape,collisionFilterGroup:1,collisionFilterMask:2});
    bodies.push(body);poses.push({position,quaternion});
  }
  for(const hull of getMazeLayout().hulls){
    const center=hull.vertices.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).multiplyScalar(1/hull.vertices.length);
    const vertices=hull.vertices.map(v=>new CANNON.Vec3(v.x-center.x,v.y-center.y,v.z-center.z));
    const faces=hull.faces.map(face=>{
      const [a,b,c]=face.map(i=>vertices[i]);
      return b.vsub(a).cross(c.vsub(a)).dot(a)<0?[...face].reverse():[...face];
    });
    add(new CANNON.ConvexPolyhedron({vertices,faces}),center);
  }
  function plane(position,inward){
    add(new CANNON.Plane(),position,new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),inward));
  }
  plane(new THREE.Vector3(0,-height/2,0),new THREE.Vector3(0,1,0));
  plane(new THREE.Vector3(0,height/2,0),new THREE.Vector3(0,-1,0));
  const outline=[[0,0],[31,0],[31,14],[31,31],[0,31],[0,14]].map(([x,z])=>mazePoint(x,z));
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    plane(a,new THREE.Vector3(a.z-b.z,0,b.x-a.x).normalize());
  }
  function cell(p){
    const z=p.z/unit+size/2,taper=1-.28*Math.max(0,(z-hinge)/(size-hinge));
    return [Math.floor(p.x/(unit*taper)+size/2),Math.floor(z)];
  }
  function sync(){
    frame.updateWorldMatrix(true,false);
    if(initialized&&matrix.equals(frame.matrixWorld))return;
    initialized=true;matrix.copy(frame.matrixWorld);inverse.copy(matrix).invert();frame.getWorldQuaternion(rotation);
    for(let i=0;i<bodies.length;i++){
      const body=bodies[i],pose=poses[i];
      body.position.copy(point.copy(pose.position).applyMatrix4(matrix));
      body.quaternion.copy(rotation.clone().multiply(pose.quaternion));body.aabbNeedsUpdate=true;
      if(body.world)body.world.broadphase.dirty=true;
    }
  }
  sync();
  return {bodies,scale:.025,sync,
    constrainApproach(f,out){
      const home=f.mazeHome;if(!home)return;
      point.copy(out).applyMatrix4(inverse);
      const margin=f.body.boundingRadius+.001;
      point.y=THREE.MathUtils.clamp(point.y,-height/2+margin,height/2-margin);
      point.z=THREE.MathUtils.clamp(point.z,(home.z-size/2)*unit+margin,(home.z+1-size/2)*unit-margin);
      const row=point.z/unit+size/2,taper=1-.28*Math.max(0,(row-hinge)/(size-hinge));
      point.x=THREE.MathUtils.clamp(point.x,(home.x-size/2)*unit*taper+margin,(home.x+1-size/2)*unit*taper-margin);
      out.copy(point.applyMatrix4(matrix));
    },
    // Exterior and top-facing roots belong to the outside coat. Only feathers
    // rooted on the inside can take off into this enclosed flight volume.
    canLaunch(position,direction){
      point.copy(position).applyMatrix4(inverse);normal.copy(direction).transformDirection(inverse);
      point.addScaledVector(normal,.001);
      const [x,z]=cell(point);
      return Math.abs(point.y)<height/2&&walls[z]?.[x]===0;
    },
    target(f,time,out){
      if(!f.mazeHome){
        point.copy(f.start).applyMatrix4(inverse);normal.copy(f.normal).transformDirection(inverse);
        point.addScaledVector(normal,.015);
        let [x,z]=cell(point);
        // The box center can overhang a wall at takeoff; choose the closest
        // open cell on its inward side for a reachable hovering target.
        if(walls[z]?.[x]!==0){
          let best=Infinity;
          for(let row=0;row<size;row++)for(let col=0;col<size;col++)if(!walls[row][col]){
            const candidate=mazePoint(col+.5,row+.5),distance=(candidate.x-point.x)**2+(candidate.z-point.z)**2;
            if(distance<best){best=distance;x=col;z=row;}
          }
        }
        f.mazeHome={x,z,y:THREE.MathUtils.clamp(point.y,-height/2+.065,height/2-.065)};
      }
      const home=f.mazeHome,t=time+f.phase;
      point.copy(mazePoint(home.x+.5+Math.sin(t*.7)*.19,home.z+.5+Math.cos(t*.53)*.19,
        home.y+Math.sin(t*.61)*.035)).applyMatrix4(matrix);
      out.copy(point);
    }
  };
}

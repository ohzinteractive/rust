import * as THREE from 'three';

export const shapeNames={cube:'Cube',cone:'Cone',sphere:'Sphere',plus:'Plus',pill:'Pill'};
const V=(x,y,z)=>new THREE.Vector3(x,y,z);

export function projectSurface(point,face,shape){
  if(shape==='plus'){
    const position=face.center.clone().addScaledVector(face.u,point.dot(face.u)/1.318*.45).addScaledVector(face.v,point.dot(face.v)/1.318*.45);
    return {position,normal:face.n.clone()};
  }
  if(shape==='cone'){
    if(face.n.y<0){
      const x=point.x/1.318,z=point.z/1.318,length=Math.hypot(x,z);
      const radius=1.35*Math.max(Math.abs(x),Math.abs(z));
      return {position:V(length?x/length*radius:0,-1.4,length?z/length*radius:0),normal:V(0,-1,0)};
    }
    const radial=face.n.clone().addScaledVector(face.u,point.dot(face.u)/1.318).normalize();
    const y=point.y/1.318*1.4,radius=(1.4-y)*1.35/2.8;
    return {position:radial.clone().multiplyScalar(radius).add(V(0,y,0)),normal:radial.add(V(0,1.35/2.8,0)).normalize()};
  }
  const direction=point.clone().normalize(),radial=Math.hypot(direction.x,direction.z);
  let distance,normal;
  if(shape==='sphere'){distance=1.45;normal=direction.clone();}
  else if(shape==='pill'){
    const radius=.82,half=.65,cylinder=radial>1e-8?radius/radial:Infinity;
    if(Math.abs(cylinder*direction.y)<=half){distance=cylinder;normal=V(direction.x,0,direction.z).normalize();}
    else{distance=half*Math.abs(direction.y)+Math.sqrt(radius*radius-half*half*(1-direction.y*direction.y));normal=direction.clone().multiplyScalar(distance).sub(V(0,Math.sign(direction.y)*half,0)).normalize();}
  }else{
    const slope=1.35/2.8,denominator=radial+slope*direction.y;
    const side=denominator>1e-8?(1.35/2)/denominator:Infinity;
    const cap=direction.y<0?-1.4/direction.y:Infinity;
    distance=Math.min(side,cap);
    normal=cap<side?V(0,-1,0):V(radial>1e-8?direction.x/radial:0,slope,radial>1e-8?direction.z/radial:0).normalize();
  }
  return {position:direction.multiplyScalar(distance),normal};
}

export function surfacePatches(bases,shape){
  if(shape==='cone')return bases.filter(face=>face.n.y!==1);
  if(shape!=='plus')return bases;
  const cells=[[0,0],[1,0],[-1,0],[0,1],[0,-1]],patches=[];
  for(const [x,y] of cells)for(const face of bases){
    if(face.n.z===0&&cells.some(([a,b])=>a===x+face.n.x&&b===y+face.n.y))continue;
    patches.push({...face,center:V(x*.9,y*.9,0).addScaledVector(face.n,.45)});
  }
  return patches;
}

export function createShapeGeometry(shape){
  let geometry;
  if(shape==='sphere')geometry=new THREE.SphereGeometry(1.432,64,40);
  else if(shape==='pill')geometry=new THREE.CapsuleGeometry(.802,1.3,12,48);
  else if(shape==='cone')geometry=new THREE.ConeGeometry(1.29,2.72,64,32);
  else{
    const outline=new THREE.Shape();
    const points=[[-.45,-1.35],[.45,-1.35],[.45,-.45],[1.35,-.45],[1.35,.45],[.45,.45],[.45,1.35],[-.45,1.35],[-.45,.45],[-1.35,.45],[-1.35,-.45],[-.45,-.45]];
    // Inset the solid beneath the coating, including the concave corners.
    const inset=points.map(p=>p.map(value=>Math.sign(value)*(Math.abs(value)-.018)));
    outline.moveTo(...inset[0]);for(const p of inset.slice(1))outline.lineTo(...p);outline.closePath();
    geometry=new THREE.ExtrudeGeometry(outline,{depth:.864,bevelEnabled:false,steps:1});geometry.translate(0,0,-.432);
  }
  const p=geometry.attributes.position;
  geometry.setAttribute('restPosition',p.clone());
  for(const name of ['coatEdge','layer','underside'])geometry.setAttribute(name,new THREE.Float32BufferAttribute(new Float32Array(p.count),1));
  geometry.setAttribute('flakeAge',new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(-1),1));
  return geometry;
}

import * as THREE from 'three';

export function createCoreGeometry(sampleNoise,segments=72){
  const geometry=new THREE.BoxGeometry(2.6,2.6,2.6,segments,segments,segments);
  const positions=geometry.attributes.position;
  const point=new THREE.Vector3(),inner=new THREE.Vector3(),outward=new THREE.Vector3();
  for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i);
    inner.copy(point).clampScalar(-1.235,1.235);
    outward.copy(point).sub(inner).normalize();
    point.copy(inner).addScaledVector(outward,.065);
    const micro=sampleNoise(point.x*23,point.y*23,point.z*23)*.008;
    // BoxGeometry duplicates edge vertices for each face. Use the same
    // position-derived direction for every copy so displacement cannot split them.
    point.addScaledVector(outward,micro);
    positions.setXYZ(i,point.x,point.y,point.z);
  }
  geometry.computeVertexNormals();
  const normals=geometry.attributes.normal,shared=new Map();
  for(let i=0;i<positions.count;i++){
    const key=`${positions.getX(i)},${positions.getY(i)},${positions.getZ(i)}`;
    let entry=shared.get(key);
    if(!entry){entry={normal:new THREE.Vector3(),indices:[]};shared.set(key,entry);}
    point.fromBufferAttribute(normals,i);entry.normal.add(point);entry.indices.push(i);
  }
  for(const {normal,indices} of shared.values()){
    normal.normalize();
    for(const i of indices)normals.setXYZ(i,normal.x,normal.y,normal.z);
  }
  geometry.setAttribute('restPosition',positions.clone());
  for(const name of ['coatEdge','layer','underside'])geometry.setAttribute(name,new THREE.Float32BufferAttribute(new Float32Array(positions.count),1));
  geometry.setAttribute('flakeAge',new THREE.Float32BufferAttribute(new Float32Array(positions.count).fill(-1),1));
  return geometry;
}

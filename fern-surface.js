import * as THREE from 'three';

// Area-weighted triangle sampling keeps roots attached to the actual mesh,
// including curved faces and concave objects rather than their bounding box.
export function createFernSurface(source){
  const triangles=[],bounds=new THREE.Box3();let area=0;
  for(const mesh of (Array.isArray(source)?source:[source])){
  mesh.updateWorldMatrix(true,false);mesh.skeleton?.update();
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<(index?.count??p.count);i+=3){
    const vertices=[0,1,2].map(k=>mesh.getVertexPosition(index?index.getX(i+k):i+k,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    for(const vertex of vertices)bounds.expandByPoint(vertex);
    const cross=vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0]));
    if(cross.lengthSq()<1e-12)continue;
    area+=cross.length()*.5;triangles.push({vertices,normal:cross.normalize(),area});
  }
  }
  const ray=new THREE.Ray(),delta=new THREE.Vector3(),hitPoint=new THREE.Vector3(),cells=new Map(),cellSize=.35;
  const segmentBounds=new THREE.Box3(),seen=new Set();
  for(const triangle of triangles){
    const box=new THREE.Box3().setFromPoints(triangle.vertices);
    triangle.box=box;
    for(let x=Math.floor(box.min.x/cellSize);x<=Math.floor(box.max.x/cellSize);x++)for(let y=Math.floor(box.min.y/cellSize);y<=Math.floor(box.max.y/cellSize);y++)for(let z=Math.floor(box.min.z/cellSize);z<=Math.floor(box.max.z/cellSize);z++){
      const key=x+','+y+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(triangle);
    }
  }
  return {bounds,scale:.22,sample(random){
    if(!triangles.length)return null;
    const at=random()*area;let lo=0,hi=triangles.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(triangles[mid].area<at)lo=mid+1;else hi=mid;}
    const triangle=triangles[lo],u=Math.sqrt(random()),v=random(),[a,b,c]=triangle.vertices;
    return {point:a.clone().multiplyScalar(1-u).addScaledVector(b,u*(1-v)).addScaledVector(c,u*v).addScaledVector(triangle.normal,.008),normal:triangle.normal.clone()};
  },intersect(from,to){
    segmentBounds.makeEmpty().expandByPoint(from).expandByPoint(to).expandByScalar(.008);
    // Most spores quickly leave the model. Reject those flights before
    // looking through the densely populated cells of detailed imports.
    if(!bounds.intersectsBox(segmentBounds))return null;
    delta.subVectors(to,from);const distance=delta.length();if(distance<1e-8)return null;
    ray.set(from,delta.normalize());let nearest=distance+.008,result=null;
    const lo=segmentBounds.min,hi=segmentBounds.max;seen.clear();
    for(let x=Math.floor(lo.x/cellSize);x<=Math.floor(hi.x/cellSize);x++)for(let y=Math.floor(lo.y/cellSize);y<=Math.floor(hi.y/cellSize);y++)for(let z=Math.floor(lo.z/cellSize);z<=Math.floor(hi.z/cellSize);z++)for(const triangle of cells.get(x+','+y+','+z)??[]){
      if(seen.has(triangle))continue;seen.add(triangle);
      if(!triangle.box.intersectsBox(segmentBounds))continue;
      if(ray.intersectTriangle(...triangle.vertices,false,hitPoint)){
        const d=from.distanceTo(hitPoint);if(d<=nearest){nearest=d;result={point:hitPoint.clone().addScaledVector(triangle.normal,.008),normal:triangle.normal.clone()};}
      }
    }
    return result;
  }};
}

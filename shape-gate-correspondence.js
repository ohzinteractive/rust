import * as T from './vendor/three.module.js';

// Closest points are evaluated on real triangles, not a volume reconstruction.
// A hierarchy makes this practical for detailed imported meshes.
function surfaceTree(meshes){
 const faces=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
 for(const mesh of meshes){const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<(index?.count??p.count);i+=3){a.fromBufferAttribute(p,index?index.getX(i):i).add(mesh.position);b.fromBufferAttribute(p,index?index.getX(i+1):i+1).add(mesh.position);c.fromBufferAttribute(p,index?index.getX(i+2):i+2).add(mesh.position);
   const triangle=new T.Triangle(a.clone(),b.clone(),c.clone()),box=new T.Box3().setFromPoints([a,b,c]);faces.push({triangle,box,center:box.getCenter(new T.Vector3())});
  }
 }
 function build(items){const box=new T.Box3();for(const f of items)box.union(f.box);if(items.length<=12)return {box,items};const s=box.getSize(new T.Vector3()),axis=s.x>=s.y&&s.x>=s.z?'x':s.y>=s.z?'y':'z';items.sort((a,b)=>a.center[axis]-b.center[axis]);const mid=items.length>>1;return {box,left:build(items.slice(0,mid)),right:build(items.slice(mid))};}
 const root=build(faces),candidate=new T.Vector3(),closest=new T.Vector3();let nearest;
 const distance=(box,p)=>{const x=Math.max(box.min.x-p.x,0,p.x-box.max.x),y=Math.max(box.min.y-p.y,0,p.y-box.max.y),z=Math.max(box.min.z-p.z,0,p.z-box.max.z);return x*x+y*y+z*z;};
 function visit(node,p){if(distance(node.box,p)>nearest)return;if(node.items){for(const f of node.items){if(distance(f.box,p)>nearest)continue;f.triangle.closestPointToPoint(p,candidate);const d=candidate.distanceToSquared(p);if(d<nearest){nearest=d;closest.copy(candidate);}}}else{const l=distance(node.left.box,p),r=distance(node.right.box,p);if(l<r){visit(node.left,p);visit(node.right,p);}else{visit(node.right,p);visit(node.left,p);}}}
 return p=>{nearest=Infinity;visit(root,p);return closest;};
}
export function mapSurfaces(from,to){
 const source=surfaceTree(from),target=surfaceTree(to),point=new T.Vector3();
 function map(mesh,nearest){
  const geometry=mesh.geometry,p=geometry.attributes.position,mapped=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){
   point.fromBufferAttribute(p,i).add(mesh.position);
   const hit=nearest(point);mapped[i*3]=hit.x-mesh.position.x;mapped[i*3+1]=hit.y-mesh.position.y;mapped[i*3+2]=hit.z-mesh.position.z;
  }
  const proxy=new T.BufferGeometry();
  proxy.setIndex(geometry.index);proxy.setAttribute('position',new T.BufferAttribute(mapped,3));proxy.computeVertexNormals();
  return {mapped,mappedNormal:proxy.attributes.normal.array};
 }
 return [...from.map(mesh=>map(mesh,target)),...to.map(mesh=>map(mesh,source))];
}

export function createSurfaceCorrespondence(from,to,maps=mapSurfaces(from,to)){
 const records=[];
 function attach(mesh,{mapped,mappedNormal},incoming){
  const geometry=mesh.geometry,p=geometry.attributes.position,original=p.array.slice(),normal=geometry.attributes.normal.array.slice();
  if(incoming){p.array.set(mapped);p.needsUpdate=true;geometry.attributes.normal.array.set(mappedNormal);geometry.attributes.normal.needsUpdate=true;}
  geometry.morphAttributes.normal=[new T.BufferAttribute(incoming?normal:mappedNormal,3)];
  geometry.morphAttributes.position=[new T.BufferAttribute(incoming?original:mapped,3)];geometry.morphTargetsRelative=false;mesh.updateMorphTargets();mesh.frustumCulled=false;
  records.push({mesh,original,mapped,incoming,normal});
 }
 from.forEach((mesh,i)=>attach(mesh,maps[i],false));
 to.forEach((mesh,i)=>attach(mesh,maps[from.length+i],true));
 return {update(t){for(const r of records)r.mesh.morphTargetInfluences[0]=t;},top(out){out.set(0,-Infinity,0);for(const r of records){const a=r.incoming?r.mapped:r.original,b=r.incoming?r.original:r.mapped,t=r.mesh.morphTargetInfluences[0],offset=r.mesh.position;for(let i=0;i<a.length;i+=3){const y=a[i+1]+(b[i+1]-a[i+1])*t+offset.y;if(y>out.y)out.set(a[i]+(b[i]-a[i])*t+offset.x,y,a[i+2]+(b[i+2]-a[i+2])*t+offset.z);}}return out;},finish(){for(const r of records){const g=r.mesh.geometry;g.attributes.position.array.set(r.original);g.attributes.position.needsUpdate=true;g.attributes.normal.array.set(r.normal);g.attributes.normal.needsUpdate=true;delete g.morphAttributes.position;delete g.morphAttributes.normal;r.mesh.updateMorphTargets();r.mesh.frustumCulled=true;g.computeBoundingSphere();}}};
}

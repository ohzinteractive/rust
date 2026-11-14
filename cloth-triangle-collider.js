import * as THREE from 'three';

// Static triangle BVH used to verify fine cloth contacts. The cheaper surface
// envelopes still handle the repeated iterations of the cloth solver.
export function createClothTriangleCollider(source){
  const faces=source.map(values=>{
    const triangle=new THREE.Triangle(new THREE.Vector3(...values.slice(0,3)),new THREE.Vector3(...values.slice(3,6)),new THREE.Vector3(...values.slice(6,9)));
    const box=new THREE.Box3().setFromPoints([triangle.a,triangle.b,triangle.c]);
    return {triangle,box,center:box.getCenter(new THREE.Vector3()),normal:triangle.getNormal(new THREE.Vector3())};
  });
  function build(items){
    const box=new THREE.Box3();for(const face of items)box.union(face.box);
    if(items.length<=8)return {box,items};
    const size=box.getSize(new THREE.Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
    items.sort((a,b)=>a.center[axis]-b.center[axis]);const split=items.length>>1;
    return {box,left:build(items.slice(0,split)),right:build(items.slice(split))};
  }
  const root=build(faces),point=new THREE.Vector3(),closest=new THREE.Vector3(),candidate=new THREE.Vector3(),normal=new THREE.Vector3(),direction=new THREE.Vector3(1,.3713907,.113173).normalize(),ray=new THREE.Ray(point,direction),intersection=new THREE.Vector3();
  let nearest=Infinity,found=false;const hits=[];
  function distanceSquared(box){
    const dx=Math.max(box.min.x-point.x,0,point.x-box.max.x),dy=Math.max(box.min.y-point.y,0,point.y-box.max.y),dz=Math.max(box.min.z-point.z,0,point.z-box.max.z);return dx*dx+dy*dy+dz*dz;
  }
  function visit(node){
    if(distanceSquared(node.box)>nearest)return;
    if(node.items){
      for(const face of node.items){
        if(distanceSquared(face.box)>nearest)continue;
        face.triangle.closestPointToPoint(point,candidate);const distance=point.distanceToSquared(candidate);
        if(distance<nearest){found=true;nearest=distance;closest.copy(candidate);normal.copy(face.normal);}
      }
    }else{
      const left=distanceSquared(node.left.box),right=distanceSquared(node.right.box);
      if(left<right){visit(node.left);visit(node.right);}else{visit(node.right);visit(node.left);}
    }
  }
  function cast(node){
    if(!ray.intersectsBox(node.box))return;
    if(node.items){
      for(const {triangle} of node.items)if(ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,intersection)){
        const distance=(intersection.x-point.x)*direction.x+(intersection.y-point.y)*direction.y+(intersection.z-point.z)*direction.z;
        if(distance>1e-7)hits.push(distance);
      }
    }else{cast(node.left);cast(node.right);}
  }
  function crossings(){
    hits.length=0;cast(root);hits.sort((a,b)=>a-b);let count=0,last=-Infinity;
    for(const hit of hits)if(hit-last>1e-6){count++;last=hit;}
    return count;
  }
  function inside(){
    if(!root.box.containsPoint(point))return false;
    // Imported meshes can have open boundaries. A one-way parity ray then
    // labels outside points as inside. Require crossings on both sides and
    // agreement across several horizontal lines through the point.
    let votes=0;
    for(const [x,z] of [[1,.3713907],[-.283,1],[1,-.618034]]){
      direction.set(x,0,z).normalize();const forward=crossings();
      direction.negate();const backward=crossings();
      if(forward%2===1&&backward%2===1)votes++;
    }
    return votes>=2;
  }

  return {
    contains(p,offset=0){point.fromArray(p,offset);return inside();},
    project(p,offset=0,padding=.04){
      point.fromArray(p,offset);found=false;nearest=padding*padding;
      if(distanceSquared(root.box)>padding*padding)return false;
      visit(root);
      let isInside=false;
      if(!found){
        if(!inside())return false;
        isInside=true;nearest=Infinity;visit(root);
      }else if(root.box.containsPoint(point))isInside=inside();
      if(!found)return false;
      const distance=Math.sqrt(nearest),dx=point.x-closest.x,dy=point.y-closest.y,dz=point.z-closest.z;
      if(!isInside&&distance>=padding)return false;
      if(distance>1e-8){
        const scale=(isInside?-1:1)*padding/distance;
        p[offset]=closest.x+dx*scale;p[offset+1]=closest.y+dy*scale;p[offset+2]=closest.z+dz*scale;
      }else{
        p[offset]=closest.x+normal.x*padding;p[offset+1]=closest.y+normal.y*padding;p[offset+2]=closest.z+normal.z*padding;
      }
      return true;
    }
  };
}

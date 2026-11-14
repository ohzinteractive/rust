import * as THREE from 'three';

function hash(value){value=Math.imul(value^value>>>16,0x7feb352d);value=Math.imul(value^value>>>15,0x846ca68b);return (value^value>>>16)>>>0;}
function stringHash(value){let result=2166136261;for(let i=0;i<value.length;i++)result=Math.imul(result^value.charCodeAt(i),16777619);return result>>>0;}
function clip(polygon,plane){
  const result=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=plane.distanceToPoint(a),db=plane.distanceToPoint(b);
    if(da>=0)result.push(a);
    if((da<0)!==(db<0))result.push(a.clone().lerp(b,da/(da-db)));
  }
  return result;
}

// Source triangles are indexed once. Camera updates raycast only a small screen
// grid, then place roots on the visible surface pieces, never on the whole mesh.
export function createVisibleFeatherSampler(triangles){
  const records=triangles.map(triangle=>{
    const {a,b,c}=triangle,n=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
    const u=new THREE.Vector3(Math.abs(n.y)<.9?0:1,Math.abs(n.y)<.9?1:0,0).cross(n).normalize(),v=new THREE.Vector3().crossVectors(n,u);
    const d=n.dot(a),key=[n.x,n.y,n.z,d].map(x=>Math.round(x*1e4)).join(',');
    const box=new THREE.Box3().setFromPoints([a,b,c]);
    return {triangle,n,u,v,d,key,seed:stringHash(key),box,center:box.getCenter(new THREE.Vector3())};
  });
  function build(items){
    if(!items.length)return null;
    const box=new THREE.Box3();for(const item of items)box.union(item.box);
    if(items.length<=8)return {box,items};
    const size=box.getSize(new THREE.Vector3()),axis=size.x>size.y?(size.x>size.z?'x':'z'):(size.y>size.z?'y':'z');
    items.sort((a,b)=>a.center[axis]-b.center[axis]);const mid=items.length>>1;
    return {box,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
  }
  const tree=build(records),ray=new THREE.Ray(),caster=new THREE.Raycaster(),boxHit=new THREE.Vector3(),hit=new THREE.Vector3();
  const inverse=new THREE.Matrix4(),projection=new THREE.Matrix4(),frustum=new THREE.Frustum(),eye=new THREE.Vector3();
  const pointer=new THREE.Vector2(),point=new THREE.Vector3(),weights=new THREE.Vector3();
  const paddedFrustum=new THREE.Frustum(),probe=new THREE.Vector3(),probeDirection=new THREE.Vector3(),sphere=new THREE.Sphere();
  const viewRight=new THREE.Vector3(),viewUp=new THREE.Vector3(),viewForward=new THREE.Vector3();
  const probes=[[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[.707,.707,0],[-.707,.707,0],[.707,-.707,0],[-.707,-.707,0]];
  let bestDistance=Infinity,best=null;
  let nearRadius=0;
  function nearby(position){return nearRadius>0&&(position.x-eye.x)**2+(position.z-eye.z)**2<nearRadius*nearRadius&&Math.abs(position.y-eye.y)<.4;}
  function findNearby(node,box,result){
    if(!node||!node.box.intersectsBox(box))return;
    if(node.items){for(const record of node.items)if(record.box.intersectsBox(box))result.push(record);}
    else{findNearby(node.left,box,result);findNearby(node.right,box,result);}
  }
  function visit(node){
    if(!node||!ray.intersectBox(node.box,boxHit))return;
    if(!node.box.containsPoint(ray.origin)&&boxHit.distanceToSquared(ray.origin)>bestDistance*bestDistance)return;
    if(node.items){
      for(const record of node.items){
        const {a,b,c}=record.triangle;
        if(!ray.intersectTriangle(a,b,c,true,hit))continue;
        const distance=hit.distanceTo(ray.origin);
        if(distance<bestDistance){bestDistance=distance;best=record;}
      }
    }else{visit(node.left);visit(node.right);}
  }
  function nearest(limit=Infinity){bestDistance=limit;best=null;visit(tree);return best;}
  function visibleSphere(center,radius=0){
    sphere.set(center,radius);if(!frustum.intersectsSphere(sphere))return false;
    let probed=false;
    for(const [x,y,z] of probes){
      probe.copy(center).addScaledVector(viewRight,x*radius).addScaledVector(viewUp,y*radius).addScaledVector(viewForward,z*radius);
      if(!frustum.containsPoint(probe))continue;
      probed=true;
      probeDirection.subVectors(probe,eye);const distance=probeDirection.length();
      if(distance<1e-6)return true;
      ray.set(eye,probeDirection.multiplyScalar(1/distance));
      if(!nearest(distance-1e-5))return true;
      if(!radius)break;
    }
    // A small cap can intersect a viewport corner between silhouette probes.
    // Keep that conservative bound until it has entirely left the frame.
    return !probed;
  }
  const tilePlanes=Array.from({length:4},()=>new THREE.Plane());
  return {
    isVisibleSphere:visibleSphere,
    isNearby:nearby,
    sample(camera,parent,density,seed,{padding=0,nearRadius:prefetch=0}={}){
      nearRadius=prefetch;
      if(!(density>0)||!tree)return {samples:[],area:0};
      camera.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false);
      inverse.copy(parent.matrixWorld).invert();eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
      viewRight.setFromMatrixColumn(camera.matrixWorld,0).transformDirection(inverse);
      viewUp.setFromMatrixColumn(camera.matrixWorld,1).transformDirection(inverse);
      viewForward.setFromMatrixColumn(camera.matrixWorld,2).transformDirection(inverse);
      projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(parent.matrixWorld);
      frustum.setFromProjectionMatrix(projection);
      paddedFrustum.copy(frustum);for(const plane of paddedFrustum.planes)plane.constant+=padding;
      const e=projection.elements,height=32,width=Math.max(12,Math.min(64,Math.round(height*camera.aspect)));
      const spacing=1/Math.sqrt(density),seen=new Set(),accepted=new Set(),samples=[],polygons=new Map();
      let area=0;
      function populate(record,piece,warm=false){
        if(piece.length<3)return;
        let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
        for(const p of piece){const u=p.dot(record.u)/spacing,v=p.dot(record.v)/spacing;minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);}
        if(!warm)for(let i=1;i<piece.length-1;i++)area+=new THREE.Triangle(piece[0],piece[i],piece[i+1]).getArea();
        for(let x=Math.floor(minU);x<=Math.floor(maxU);x++)for(let y=Math.floor(minV);y<=Math.floor(maxV);y++){
          const key=`${record.key}/${x},${y}`;if(accepted.has(key)||(!warm&&seen.has(key)))continue;
          const value=seed^record.seed^Math.imul(x,73856093)^Math.imul(y,19349663);
          point.copy(record.n).multiplyScalar(record.d).addScaledVector(record.u,(x+hash(value)/4294967296)*spacing).addScaledVector(record.v,(y+hash(value^0x9e3779b9)/4294967296)*spacing);
          if(!THREE.Triangle.getBarycoord(point,record.triangle.a,record.triangle.b,record.triangle.c,weights)||Math.min(weights.x,weights.y,weights.z)<-1e-7)continue;
          if(!warm)seen.add(key);
          if(warm?!nearby(point):(!nearby(point)&&!visibleSphere(point,padding)))continue;
          accepted.add(key);samples.push({triangle:record.triangle,weights:[weights.x,weights.y,weights.z],position:point.clone(),key,variation:hash(value^0x85ebca6b)});
        }
      }
      const margin=padding>0?.35:0;
      for(let row=0;row<height;row++)for(let column=0;column<width;column++){
        const x0=(column/width*2-1)*(1+margin),x1=((column+1)/width*2-1)*(1+margin),y0=(row/height*2-1)*(1+margin),y1=((row+1)/height*2-1)*(1+margin);
        pointer.set((x0+x1)/2,(y0+y1)/2);caster.setFromCamera(pointer,camera);ray.copy(caster.ray).applyMatrix4(inverse);
        const record=nearest();if(!record)continue;
        let polygon=polygons.get(record);
        if(!polygon){
          polygon=[record.triangle.a,record.triangle.b,record.triangle.c];
          for(const plane of paddedFrustum.planes){polygon=clip(polygon,plane);if(polygon.length<3)break;}
          polygons.set(record,polygon);
        }
        tilePlanes[0].setComponents(e[0]-x0*e[3],e[4]-x0*e[7],e[8]-x0*e[11],e[12]-x0*e[15]);
        tilePlanes[1].setComponents(x1*e[3]-e[0],x1*e[7]-e[4],x1*e[11]-e[8],x1*e[15]-e[12]);
        tilePlanes[2].setComponents(e[1]-y0*e[3],e[5]-y0*e[7],e[9]-y0*e[11],e[13]-y0*e[15]);
        tilePlanes[3].setComponents(y1*e[3]-e[1],y1*e[7]-e[5],y1*e[11]-e[9],y1*e[15]-e[13]);
        let piece=polygon;
        for(const plane of tilePlanes){piece=clip(piece,plane);if(piece.length<3)break;}
        populate(record,piece);
      }
      if(nearRadius>0){
        const box=new THREE.Box3(eye.clone().add(new THREE.Vector3(-nearRadius,-.4,-nearRadius)),eye.clone().add(new THREE.Vector3(nearRadius,.4,nearRadius))),records=[];
        findNearby(tree,box,records);
        const planes=[new THREE.Plane(new THREE.Vector3(1,0,0),-box.min.x),new THREE.Plane(new THREE.Vector3(-1,0,0),box.max.x),new THREE.Plane(new THREE.Vector3(0,1,0),-box.min.y),new THREE.Plane(new THREE.Vector3(0,-1,0),box.max.y),new THREE.Plane(new THREE.Vector3(0,0,1),-box.min.z),new THREE.Plane(new THREE.Vector3(0,0,-1),box.max.z)];
        for(const record of records){let piece=[record.triangle.a,record.triangle.b,record.triangle.c];for(const plane of planes){piece=clip(piece,plane);if(piece.length<3)break;}populate(record,piece,true);}
      }
      return {samples,area};
    }
  };
}

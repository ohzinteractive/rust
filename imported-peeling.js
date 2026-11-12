import * as THREE from 'three';
import { PeelingSurface, seededRandom } from './peeling-surface.js';
import { createFlakePhysics } from './flake-physics.js';
import { buildCollisionHull } from './collision-hull.js';

const vertexKey = p => [p.x,p.y,p.z].map(x => Math.round(x * 1e5)).join(',');
const edgeKey = (a,b) => a < b ? `${a}|${b}` : `${b}|${a}`;

// Refine only the coating, preserving the asset mesh. Long, sparse triangles
// (plinth sides and caps) need interior vertices before cracks can leave the
// original triangle outlines. Midpoint splits agree across shared edges.
export function refineSurfaceTriangles(triangles, maxEdge=.10, budget=180000) {
  function midpoint(a,b) {
    return {position:a.position.clone().lerp(b.position,.5),normal:a.normal.clone().lerp(b.normal,.5).normalize(),
      rest:a.rest.clone().lerp(b.rest,.5),uv:a.uv.clone().lerp(b.uv,.5),color:a.color.map((c,i)=>(c+b.color[i])*.5)};
  }
  for(let attempt=0;attempt<8;attempt++,maxEdge*=1.5) {
    const result=[],pending=[...triangles],limit=maxEdge*maxEdge;
    let overflow=false;
    while(pending.length) {
      const triangle=pending.pop(),v=triangle.vertices;
      const lengths=v.map((p,i)=>p.position.distanceToSquared(v[(i+1)%3].position));
      const edge=lengths.indexOf(Math.max(...lengths));
      if(lengths[edge]<=limit)result.push(triangle);
      else {
        const a=v[edge],b=v[(edge+1)%3],c=v[(edge+2)%3],m=midpoint(a,b);
        for(const vertices of [[a,m,c],[m,b,c]])pending.push({...triangle,vertices,keys:vertices.map(p=>vertexKey(p.position))});
      }
      if(result.length+pending.length>budget){overflow=true;break;}
    }
    if(!overflow)return result;
  }
  return triangles;
}

// Surface-area seeding avoids starving low-poly bases of flakes. Weighted
// geodesic growth uses physical distance, not the number of mesh triangles.
export function partitionTriangles(triangles, count, seed) {
  if(!triangles.length)return [];
  const neighbors=triangles.map(()=>[]),edges=new Map();
  const centers=triangles.map(t=>t.vertices.reduce((p,v)=>p.add(v.position),new THREE.Vector3()).multiplyScalar(1/3));
  const areas=triangles.map(t=>new THREE.Vector3().subVectors(t.vertices[1].position,t.vertices[0].position)
    .cross(new THREE.Vector3().subVectors(t.vertices[2].position,t.vertices[0].position)).length()/2);
  triangles.forEach((t,i)=>{
    for(let k=0;k<3;k++) {
      const key=`${t.material}:${t.mesh}:${edgeKey(t.keys[k],t.keys[(k+1)%3])}`,other=edges.get(key);
      if(other!==undefined){neighbors[i].push(other);neighbors[other].push(i);}else edges.set(key,i);
    }
  });
  // Binary heap keeps dense imported meshes practical.
  const heap=[];
  function push(item){
    let i=heap.length;heap.push(item);
    while(i>0){const p=(i-1)>>1;if(heap[p].distance<=item.distance)break;heap[i]=heap[p];i=p;}heap[i]=item;
  }
  function pop(){
    const first=heap[0],last=heap.pop();if(heap.length){let i=0;
      while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].distance<heap[c].distance)c++;
        if(heap[c].distance>=last.distance)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;
  }
  const rng=seededRandom(seed),labels=new Int32Array(triangles.length).fill(-1),distances=new Float64Array(triangles.length).fill(Infinity);
  const total=areas.reduce((a,b)=>a+b,0),seeds=new Set();
  count=Math.min(count,triangles.length);
  let index=0,cumulative=areas[0];
  for(let s=0;s<count;s++) {
    const target=(s+rng())/count*total;
    while(index<triangles.length-1&&cumulative<target)cumulative+=areas[++index];
    seeds.add(index);
  }
  let nextLabel=0;
  function seedAt(i){labels[i]=nextLabel++;distances[i]=0;push({index:i,distance:0});}
  function flood(){
    while(heap.length){const item=pop(),i=item.index;if(item.distance!==distances[i])continue;
      for(const j of neighbors[i]) {
        const distance=item.distance+Math.max(1e-7,centers[i].distanceTo(centers[j]));
        if(distance<distances[j]){distances[j]=distance;labels[j]=labels[i];push({index:j,distance});}
      }
    }
  }
  seeds.forEach(seedAt);flood();
  for(let i=0;i<triangles.length;i++)if(labels[i]===-1){seedAt(i);flood();}
  const patches=Array.from({length:nextLabel},()=>[]);
  triangles.forEach((t,i)=>patches[labels[i]].push(t));return patches.filter(p=>p.length);
}

export function readSurfaceTriangles(entries) {
  const triangles=[], point=new THREE.Vector3(), normal=new THREE.Vector3();
  entries.forEach(({mesh,materialIndices},meshIndex) => {
    const geo=mesh.geometry, p=geo.attributes.position, n=geo.attributes.normal, color=geo.attributes.color;
    const matrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const groups=geo.groups.length ? geo.groups : [{start:0,count:geo.index?.count??p.count,materialIndex:0}];
    for(const group of groups) for(let offset=group.start;offset<group.start+group.count;offset+=3) {
      if(materialIndices[group.materialIndex??0]<0)continue;
      const vertices=[];
      for(let k=0;k<3;k++) {
        const i=geo.index ? geo.index.getX(offset+k) : offset+k;
        point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
        normal.fromBufferAttribute(n,i).applyMatrix3(matrix).normalize();
        vertices.push({color:color?[color.getX(i),color.getY(i),color.getZ(i),color.itemSize===4?color.getW(i):1]:[1,1,1,1],position:point.clone(),normal:normal.clone(),rest:new THREE.Vector3().fromBufferAttribute(geo.attributes.restPosition,i),
          uv:geo.attributes.uv ? new THREE.Vector2().fromBufferAttribute(geo.attributes.uv,i) : new THREE.Vector2()});
      }
      const cross=new THREE.Vector3().subVectors(vertices[1].position,vertices[0].position).cross(new THREE.Vector3().subVectors(vertices[2].position,vertices[0].position));
      if(cross.lengthSq()<1e-16)continue;
      // Mirrored transforms reverse geometric winding after baking to world space.
      if(cross.dot(vertices[0].normal)<0)[vertices[1],vertices[2]]=[vertices[2],vertices[1]];
      triangles.push({vertices,keys:vertices.map(v=>vertexKey(v.position)),material:materialIndices[group.materialIndex??0],mesh:meshIndex});
    }
  });
  return triangles;
}

/** Static imported coating, baked into world space. One draw group per material;
 * attached and released fragments share the same persistent merged buffers. */
export class ImportedPeelingSurface extends PeelingSurface {
  // The base constructor establishes deformation/physics scratch state first.
  rebuild() {}
  constructor({scene,entries,materials,state,floorY=-1.75}) {
    const parent=new THREE.Group(); parent.name='Imported peeling'; scene.add(parent);
    const physics=createFlakePhysics({floorY});
    super({parent,material:materials,physics,state});
    this.thickness=.006;
    try {
    const sourceTriangles=readSurfaceTriangles(entries);
    const triangles=refineSurfaceTriangles(sourceTriangles);
    const patches=partitionTriangles(triangles,Math.min(240,Math.ceil(triangles.length/35)),state.seed);
    if(patches.length>500) { scene.remove(parent); throw new Error('Too many disconnected surfaces for peeling.'); }
    // Small regional hulls follow the duck's head, beak and body without using
    // the old cube collider or a single convex envelope over the whole model.
    physics.setSpecimenHulls(partitionTriangles(sourceTriangles,96,state.seed+1).map(patch => {
      // A disconnected single triangle still needs a solid collider.
      const points=patch.flatMap(t=>t.vertices.flatMap(v=>[
        v.position.clone().addScaledVector(v.normal,-.035),
        v.position.clone().addScaledVector(v.normal,-.037)
      ]));
      const center=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).divideScalar(points.length);
      return {...buildCollisionHull(points.map(p=>p.clone().sub(center)),undefined,.001),position:center};
    }));
    const positions=[],normals=[],rest=[],uv=[],colors=[],layers=[],backs=[],ages=[],edges=[],indices=[];
    const rng=seededRandom(state.seed+7);
    patches.sort((a,b)=>a[0].material-b[0].material);
    for(const patch of patches) {
      const root=new THREE.Vector3(), faceNormal=new THREE.Vector3();
      const vertices=patch.flatMap(t=>t.vertices);
      vertices.forEach(v=>{root.add(v.position);faceNormal.add(v.normal);}); root.divideScalar(vertices.length);
      faceNormal.normalize(); if(faceNormal.lengthSq()<.5)faceNormal.copy(vertices[0].normal);
      const u=new THREE.Vector3(Math.abs(faceNormal.x)<.8?1:0,Math.abs(faceNormal.x)<.8?0:1,0).cross(faceNormal).normalize();
      const v=faceNormal.clone().cross(u).normalize(),face={n:faceNormal,u,v};
      const radius=Math.max(.01,...vertices.map(v=>v.position.distanceTo(root)));
      const start=positions.length/3,indexStart=indices.length,infos=[];
      const angle=rng()*Math.PI*2,dir=[Math.cos(angle),Math.sin(angle)];
      const boundary=new Map();
      for(const t of patch) for(let k=0;k<3;k++) {
        const key=edgeKey(t.keys[k],t.keys[(k+1)%3]);
        if(boundary.has(key))boundary.delete(key);else boundary.set(key,[t.vertices[k],t.vertices[(k+1)%3]]);
      }
      const boundaryVertices=new Set([...boundary.values()].flat().map(v=>vertexKey(v.position)));
      const append=(vertex,back,wall=false)=>{
        const base=vertex.position.clone().addScaledVector(vertex.normal,back?.002:.002+this.thickness);
        const delta=vertex.position.clone().sub(root),dx=delta.dot(u),dy=delta.dot(v),index=positions.length/3;
        positions.push(...base.toArray()); normals.push(...vertex.normal.clone().multiplyScalar(back?-1:1).toArray());
        rest.push(...vertex.rest.toArray());uv.push(...vertex.uv.toArray());colors.push(...vertex.color);layers.push(1);backs.push(back);ages.push(-1);
        edges.push(boundaryVertices.has(vertexKey(vertex.position))?1:0);
        // Smooth source normals remain intact at age zero, including UV seams.
        infos.push({index,base,dx,dy,jagX:0,jagY:0,back,wall,surfaceIndex:index,surfaceNormal:vertex.normal.clone(),
          t:THREE.MathUtils.clamp((dx*dir[0]+dy*dir[1])/radius*.55+.45,0,1),grain:.5});
        return index;
      };
      for(const t of patch) {
        const front=t.vertices.map(vertex=>append(vertex,0)); indices.push(...front);
        const back=t.vertices.map(vertex=>append(vertex,1)); indices.push(back[0],back[2],back[1]);
      }
      for(const [a,b] of boundary.values()) {
        const topA=append(a,0,true),topB=append(b,0,true),bottomA=append(a,1,true),bottomB=append(b,1,true);
        indices.push(topA,bottomA,bottomB,topA,bottomB,topB);
      }
      const smoothing=new Map();
      for(const info of infos)if(!info.wall){
        const key=`${vertexKey(info.base)}:${vertexKey(info.surfaceNormal)}:${info.back}`;
        if(!smoothing.has(key))smoothing.set(key,[]);smoothing.get(key).push(info.index);
      }
      this.flakes.push({normalGroups:[...smoothing.values()],start,indexStart,indexCount:indices.length-indexStart,root,face,dir,radius,infos,
        threshold:.36+rng()*.58,weight:rng(),layer:1,body:null,material:patch[0].material});
    }
    const geometry=new THREE.BufferGeometry();
    for(const [name,array,size] of [['position',positions,3],['normal',normals,3],['restPosition',rest,3],['uv',uv,2],['color',colors,4],['layer',layers,1],['underside',backs,1],['flakeAge',ages,1],['coatEdge',edges,1]]) {
      geometry.setAttribute(name,new THREE.Float32BufferAttribute(array,size));
    }
    geometry.setIndex(indices);
    // Contiguous material ranges avoid one draw call per flake.
    for(const f of this.flakes) {
      const last=geometry.groups.at(-1);
      if(last?.materialIndex===f.material)last.count+=f.indexCount;
      else geometry.addGroup(f.indexStart,f.indexCount,f.material);
    }
    this.mesh=new THREE.Mesh(geometry,materials);this.mesh.name='Imported coating';
    this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
    parent.add(this.mesh);this.updateAttached();
    this.lastAge=state.age;this.elapsed=0;
    } catch(error) { physics.clear();parent.removeFromParent();this.mesh?.geometry.dispose();throw error; }
  }
  updateNormals(flake) {
    super.updateNormals(flake);
    // Tessellation must not turn a smooth curled sheet into faceted triangles.
    // Keep the original hard edges and separate wall normals at fracture rims.
    const normal=this.mesh.geometry.attributes.normal;
    for(const group of flake.normalGroups){
      if(group.length<2)continue;
      const sum=this.normal.set(0,0,0);
      for(const index of group){sum.x+=normal.getX(index);sum.y+=normal.getY(index);sum.z+=normal.getZ(index);}
      sum.normalize();for(const index of group)normal.setXYZ(index,sum.x,sum.y,sum.z);
    }
  }
  update(dt) {
    this.elapsed+=dt;
    // Rewinding exposure restores removed paint rather than keeping stale holes.
    if(this.state.age<this.lastAge-.0001)this.repaint();
    this.lastAge=this.state.age;
    const version=this.mesh.geometry.attributes.position.version;
    if(this.elapsed>.045) { this.elapsed=0;this.updateAttached(); }
    const steps=this.physics.step(dt);this.syncPhysics();
    return steps>0||version!==this.mesh.geometry.attributes.position.version;
  }
  dispose() {
    this.physics.clear();this.parent.removeFromParent();this.mesh.geometry.dispose();
  }
}

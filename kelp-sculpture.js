import * as THREE from 'three';
import {mergeVertices} from './vendor/BufferGeometryUtils.js';

// One crease-aware Loop subdivision pass softens organic silhouettes. The
// tower and glasses only receive smooth normals, keeping their authored edges.
export function refineSculptureGeometry(source,{organic=false}={}){
  let geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',source.attributes.position.clone());
  if(source.index)geometry.setIndex(source.index.clone());
  geometry.computeBoundingBox();
  const extent=geometry.boundingBox.getSize(new THREE.Vector3()).length();
  const welded=mergeVertices(geometry,Math.max(extent*1e-6,1e-8));geometry.dispose();geometry=welded;
  removeCollapsedTriangles(geometry,extent);
  if(organic&&geometry.index.count<=240000){
    const p=geometry.attributes.position,vertices=Array.from({length:p.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(p,i));
    const faces=[],edges=new Map(),neighbors=vertices.map(()=>new Set()),creases=vertices.map(()=>new Set());
    const ab=new THREE.Vector3(),ac=new THREE.Vector3();
    for(let i=0;i<geometry.index.count;i+=3){
      const face=[0,1,2].map(j=>geometry.index.getX(i+j));faces.push(face);
      const n=ab.subVectors(vertices[face[1]],vertices[face[0]]).cross(ac.subVectors(vertices[face[2]],vertices[face[0]])).clone().normalize();
      for(let j=0;j<3;j++){
        const a=face[j],b=face[(j+1)%3],opposite=face[(j+2)%3],key=a<b?`${a},${b}`:`${b},${a}`;
        neighbors[a].add(b);neighbors[b].add(a);
        if(!edges.has(key))edges.set(key,{a,b,opposites:[],normals:[]});
        const edge=edges.get(key);edge.opposites.push(opposite);edge.normals.push(n);
      }
    }
    for(const edge of edges.values()){
      edge.sharp=edge.normals.length!==2||edge.normals[0].dot(edge.normals[1])<Math.cos(Math.PI/3);
      if(edge.sharp){creases[edge.a].add(edge.b);creases[edge.b].add(edge.a);}
    }
    const positions=[];
    vertices.forEach((v,i)=>{
      const sharp=[...creases[i]],adjacent=[...neighbors[i]],out=v.clone();
      if(sharp.length===2){out.multiplyScalar(.75);for(const id of sharp)out.addScaledVector(vertices[id],.125);}
      else if(!sharp.length&&adjacent.length>=3){
        const beta=adjacent.length===3?3/16:3/(8*adjacent.length);
        out.multiplyScalar(1-adjacent.length*beta);for(const id of adjacent)out.addScaledVector(vertices[id],beta);
      }
      out.toArray(positions,positions.length);
    });
    for(const edge of edges.values()){
      const out=vertices[edge.a].clone().add(vertices[edge.b]).multiplyScalar(edge.sharp ? .5 : .375);
      if(!edge.sharp)for(const id of edge.opposites)out.addScaledVector(vertices[id],.125);
      edge.index=positions.length/3;out.toArray(positions,positions.length);
    }
    const mid=(a,b)=>edges.get(a<b?`${a},${b}`:`${b},${a}`).index,indices=[];
    for(const [a,b,c] of faces){
      const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
      indices.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
    }
    geometry.dispose();geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  }
  removeCollapsedTriangles(geometry,extent);
  const result=creaseNormals(geometry);
  geometry.dispose();result.computeBoundingBox();result.computeBoundingSphere();
  return result;
}

// Use exact welded indices rather than a fixed world-unit position hash so
// tiny glasses and large architectural models get the same smooth shading.
function creaseNormals(geometry){
  const position=geometry.attributes.position,index=geometry.index,faces=[],adjacent=Array.from({length:position.count},()=>[]);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),sum=new THREE.Vector3();
  for(let i=0;i<index.count;i+=3){
    const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
    a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]);c.fromBufferAttribute(position,ids[2]);
    normal.subVectors(b,a).cross(c.sub(a));
    const area=normal.length(),face={ids,normal:normal.clone().normalize(),area};faces.push(face);
    for(const id of ids)adjacent[id].push(face);
  }
  const result=geometry.toNonIndexed(),normals=new Float32Array(result.attributes.position.count*3);
  faces.forEach((face,i)=>face.ids.forEach((id,j)=>{
    sum.set(0,0,0);
    for(const neighbor of adjacent[id])if(face.normal.dot(neighbor.normal)>.5)sum.addScaledVector(neighbor.normal,neighbor.area);
    if(sum.lengthSq()<1e-20)sum.copy(face.normal);
    sum.normalize().toArray(normals,(i*3+j)*3);
  }));
  result.setAttribute('normal',new THREE.BufferAttribute(normals,3));return result;
}

// Welding imported CAD meshes can collapse narrow or duplicate faces. Do not
// send zero-area triangles (and their zero normals) into physical lighting.
function removeCollapsedTriangles(geometry,extent){
  const p=geometry.attributes.position,index=geometry.index,indices=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const minimumAreaSquared=Math.pow(extent,4)*1e-24;
  for(let i=0;i<index.count;i+=3){
    const ia=index.getX(i),ib=index.getX(i+1),ic=index.getX(i+2);
    a.fromBufferAttribute(p,ia);b.fromBufferAttribute(p,ib).sub(a);c.fromBufferAttribute(p,ic).sub(a);
    const areaSquared=b.cross(c).lengthSq();
    if(Number.isFinite(areaSquared)&&areaSquared>minimumAreaSquared)indices.push(ia,ib,ic);
  }
  if(!indices.length){geometry.dispose();throw Error('Model has no non-degenerate triangles');}
  geometry.setIndex(indices);
}

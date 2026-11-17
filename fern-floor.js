import * as THREE from 'three';

// Sparse tiles share a sampled height field. New deposits add height instead
// of replacing old ones, and the very same field is used for spore landings.
export function createFernFloor(parent,floorY){
  const group=new THREE.Group();group.name='Accumulated fern soil and litter';parent.add(group);
  const step=.3,tileSize=8,heights=new Map(),tiles=new Map();
  const material=new THREE.MeshStandardMaterial({color:0x383322,roughness:1,side:THREE.DoubleSide,transparent:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.litterBase={value:floorY};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float litterBase;varying float vLitterHeight;').replace('#include <begin_vertex>','#include <begin_vertex>\nvLitterHeight=position.y-litterBase;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vLitterHeight;').replace('#include <alphatest_fragment>','float litterEdge=smoothstep(.002,.018,vLitterHeight);if(litterEdge<.01)discard;diffuseColor.a*=litterEdge;\n#include <alphatest_fragment>');
  };
  let deposits=0,maxHeight=0,litter=null,cursor=0,terrain=null,tileCapacity=64;
  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1);
  const value=(x,z)=>heights.get(x)?.get(z)??0;
  function height(x,z){
    if(!deposits)return floorY;
    const gx=x/step,gz=z/step,ix=Math.floor(gx),iz=Math.floor(gz);
    return floorY+THREE.MathUtils.lerp(THREE.MathUtils.lerp(value(ix,iz),value(ix+1,iz),gx-ix),THREE.MathUtils.lerp(value(ix,iz+1),value(ix+1,iz+1),gx-ix),gz-iz);
  }
  function updateTile(tx,tz){
    const key=tx+','+tz;let tile=tiles.get(key);
    if(!tile){
      if(!terrain){terrain=new THREE.BatchedMesh(tileCapacity,tileCapacity*81,tileCapacity*384,material);terrain.name='Batched accumulated soil';terrain.receiveShadow=true;terrain.frustumCulled=false;group.add(terrain);}
      if(tiles.size>=tileCapacity){tileCapacity*=2;terrain.setInstanceCount(tileCapacity);terrain.setGeometrySize(tileCapacity*81,tileCapacity*384);}
      const geometry=new THREE.PlaneGeometry(tileSize*step,tileSize*step,tileSize,tileSize);geometry.rotateX(-Math.PI/2);geometry.translate((tx+.5)*tileSize*step,0,(tz+.5)*tileSize*step);
      tile={geometry,id:null};tiles.set(key,tile);
    }
    const p=tile.geometry.attributes.position;
    for(let i=0;i<p.count;i++)p.setY(i,floorY+value(Math.round(p.getX(i)/step),Math.round(p.getZ(i)/step))+.001);
    p.needsUpdate=true;tile.geometry.computeVertexNormals();tile.geometry.computeBoundingSphere();
    if(tile.id===null){tile.id=terrain.addGeometry(tile.geometry);terrain.addInstance(tile.id);}else terrain.setGeometryAt(tile.id,tile.geometry);
  }
  return {group,height,get stats(){return {deposits,maxHeight,soilTiles:tiles.size};},
    setLitterGeometry(source){
      const geometry=source.clone();for(const name of ['fernLife','fernContactRow'])geometry.deleteAttribute(name);
      const p=geometry.attributes.position,t=geometry.attributes.fernInfo;
      for(let i=0;i<p.count;i++)p.setY(i,.006+.018*Math.sin(Math.min(1,t.getY(i))*Math.PI));
      geometry.deleteAttribute('fernInfo');geometry.deleteAttribute('fernPart');geometry.computeVertexNormals();geometry.computeBoundingSphere();
      const mat=new THREE.MeshStandardMaterial({color:0x6e522b,roughness:1,side:THREE.DoubleSide});
      litter=new THREE.InstancedMesh(geometry,mat,1024);litter.name='Persistent fallen fern fronds';litter.count=0;litter.frustumCulled=false;litter.receiveShadow=true;group.add(litter);
    },deposit(root,radius,yaw=0){
      const dirty=new Set(),thickness=.035;
      for(let x=Math.floor((root.x-radius)/step);x<=Math.ceil((root.x+radius)/step);x++)for(let z=Math.floor((root.z-radius)/step);z<=Math.ceil((root.z+radius)/step);z++){
        const r=Math.hypot(x*step-root.x,z*step-root.z)/radius;if(r>=1)continue;
        const h=value(x,z)+thickness*(1-r*r)**2;if(!heights.has(x))heights.set(x,new Map());heights.get(x).set(z,h);maxHeight=Math.max(maxHeight,h);
        for(const tx of [Math.floor(x/tileSize),Math.floor((x-1)/tileSize)])for(const tz of [Math.floor(z/tileSize),Math.floor((z-1)/tileSize)])dirty.add(tx+','+tz);
      }
      deposits++;
      for(const key of dirty)updateTile(...key.split(',').map(Number));
      if(litter){rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);matrix.compose(new THREE.Vector3(root.x,height(root.x,root.z)+.003,root.z),rotation,scale);litter.setMatrixAt(cursor,matrix);cursor=(cursor+1)%1024;litter.count=Math.min(1024,litter.count+1);litter.instanceMatrix.needsUpdate=true;}
    },clear(){for(const tile of tiles.values())tile.geometry.dispose();tiles.clear();heights.clear();if(terrain){terrain.dispose();terrain.removeFromParent();terrain=null;}tileCapacity=64;if(litter){litter.geometry.dispose();litter.material.dispose();litter.dispose();litter.removeFromParent();litter=null;}deposits=0;maxHeight=0;cursor=0;},dispose(){this.clear();material.dispose();group.removeFromParent();}};
}

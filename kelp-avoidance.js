import * as THREE from 'three';

// Moving ribbon envelopes are indexed once per kelp update, rather than
// testing every fish against every leaf triangle. All temporary arrays recur.
export function createKelpAvoidance(kelp){
  const grid=new Map(),buckets=[],nearby=[],seen=[],cell=2;
  const key=(x,y,z)=>(x+32)+(y+32)*64+(z+32)*4096;
  const axis=new THREE.Vector3(),delta=new THREE.Vector3(),closest=new THREE.Vector3(),candidateNormal=new THREE.Vector3(),origin=new THREE.Vector3(),probe=new THREE.Vector3();
  let version=-1,capsules=[],stamp=0;
  function update(){
    const source=kelp.getObstacles();if(source.version===version)return false;
    version=source.version;capsules=source.capsules;grid.clear();let count=0;
    for(let i=0;i<capsules.length;i++){
      const c=capsules[i],r=c.radius;
      for(let x=Math.floor((Math.min(c.a.x,c.b.x)-r)/cell);x<=Math.floor((Math.max(c.a.x,c.b.x)+r)/cell);x++)
      for(let y=Math.floor((Math.min(c.a.y,c.b.y)-r)/cell);y<=Math.floor((Math.max(c.a.y,c.b.y)+r)/cell);y++)
      for(let z=Math.floor((Math.min(c.a.z,c.b.z)-r)/cell);z<=Math.floor((Math.max(c.a.z,c.b.z)+r)/cell);z++){
        const k=key(x,y,z);let bucket=grid.get(k);
        if(!bucket){bucket=buckets[count]??(buckets[count]=[]);bucket.length=0;count++;grid.set(k,bucket);}bucket.push(i);
      }
    }
    return true;
  }
  function query(point,radius){
    nearby.length=0;stamp++;
    for(let x=Math.floor((point.x-radius)/cell);x<=Math.floor((point.x+radius)/cell);x++)
    for(let y=Math.floor((point.y-radius)/cell);y<=Math.floor((point.y+radius)/cell);y++)
    for(let z=Math.floor((point.z-radius)/cell);z<=Math.floor((point.z+radius)/cell);z++){
      const bucket=grid.get(key(x,y,z));if(!bucket)continue;
      for(const i of bucket)if(seen[i]!==stamp){seen[i]=stamp;nearby.push(i);}
    }
  }
  function nearest(point,radius,out,ignoreLeaf=-1){
    query(point,radius);let nearest=Infinity;
    for(const i of nearby){
      const c=capsules[i];if(ignoreLeaf>=0&&c.leaf===ignoreLeaf)continue;
      axis.subVectors(c.b,c.a);delta.subVectors(point,c.a);
      const t=THREE.MathUtils.clamp(delta.dot(axis)/Math.max(axis.lengthSq(),1e-10),0,1);
      closest.copy(c.a).addScaledVector(axis,t);candidateNormal.subVectors(point,closest);
      const length=candidateNormal.length(),distance=length-c.radius;
      if(distance>=nearest)continue;
      if(length>.000001)candidateNormal.multiplyScalar(1/length);
      else{candidateNormal.set(-axis.z,0,axis.x);if(candidateNormal.lengthSq()<.0001)candidateNormal.set(1,0,0);candidateNormal.normalize();}
      nearest=distance;out?.copy(candidateNormal);
    }
    return nearest;
  }
  const isClear=(point,radius,ignoreLeaf=-1)=>nearest(point,radius,null,ignoreLeaf)>=radius;
  function project(point,radius,out,ignoreLeaf=-1,floor=-Infinity){
    let changed=false;
    for(let i=0;i<12;i++){
      const distance=nearest(point,radius,out,ignoreLeaf);if(distance>=radius)return changed;
      const move=radius-distance+.00001;
      if(out.y<0&&point.y+out.y*move<floor){out.y=0;if(out.lengthSq()<.0001)out.set(1,0,0);else out.normalize();}
      point.addScaledVector(out,move);point.y=Math.max(floor,point.y);changed=true;
    }
    // Rare overlapping ribbons can surround the projection point. Search for
    // a nearby opening instead of leaving a fish embedded in those ribbons.
    origin.copy(point);
    for(const distance of [.25,.5,1,1.5])for(let i=0;i<12;i++){
      const angle=i*Math.PI/6;probe.set(origin.x+Math.cos(angle)*distance,origin.y+(i%3===0?distance*.5:0),origin.z+Math.sin(angle)*distance);
      if(isClear(probe,radius,ignoreLeaf)){out.subVectors(probe,point).normalize();point.copy(probe);return true;}
    }
    return changed;
  }
  return {update,nearest,isClear,project,get count(){return capsules.length;}};
}

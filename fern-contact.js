import * as THREE from 'three';

// A spatial hash compares broad leaf samples only with nearby samples from
// other crowns. Roots and tightly coiled shoots never take part in contact.
export function solveFernContacts(samples,cellSize=.3){
  const cells=new Map(),targets=new Map();
  for(const s of samples){
    const x=Math.floor(s.point.x/cellSize),z=Math.floor(s.point.z/cellSize);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const other of cells.get(x+dx)?.get(z+dz)??[]){
      if(s.plant===other.plant)continue;
      if(Math.abs(s.point.y-other.point.y)>=.055)continue;
      const reach=s.radius+other.radius,dx=s.point.x-other.point.x,dz=s.point.z-other.point.z,distanceSquared=dx*dx+dz*dz;
      if(distanceSquared>=reach*reach)continue;
      const distance=Math.sqrt(distanceSquared);
      const lower=s.point.y<other.point.y?s:other,upper=lower===s?other:s;
      const gap=upper.point.y-lower.point.y,clearance=.055;
      if(gap>=clearance)continue;
      const amount=Math.min(.22,(clearance-gap)*(1-distance/reach)/Math.max(.1,lower.t*lower.t));
      const key=lower.plant+':'+lower.frond;
      targets.set(key,Math.max(targets.get(key)??0,amount));
    }
    if(!cells.has(x))cells.set(x,new Map());const row=cells.get(x);
    if(!row.has(z))row.set(z,[]);row.get(z).push(s);
  }
  return targets;
}

export function fernContactValue(data,offset,time){
  return THREE.MathUtils.lerp(data[offset],data[offset+1],1-Math.exp(-Math.max(0,time-data[offset+2])*3));
}

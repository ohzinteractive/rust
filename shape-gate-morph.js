import * as T from 'three';

// A shared volume allows topology to change (including holes and separate
// parts) without pairing unrelated vertices or changing material opacity.
export function createMorphField(meshes,n=48){
  const size=1.7,step=size/(n-1),origin=-.85,buckets=Array.from({length:n*n},()=>[]),v=[new T.Vector3(),new T.Vector3(),new T.Vector3()];
  for(const mesh of meshes){const p=mesh.geometry.attributes.position,index=mesh.geometry.index,count=index?.count??p.count;
    for(let k=0;k<count;k+=3){for(let j=0;j<3;j++)v[j].fromBufferAttribute(p,index?index.getX(k+j):k+j);
      const [a,b,c]=v,den=(b.z-c.z)*(a.y-c.y)+(c.y-b.y)*(a.z-c.z);if(Math.abs(den)<1e-12)continue;
      const loY=Math.max(0,Math.ceil((Math.min(a.y,b.y,c.y)-origin)/step)),hiY=Math.min(n-1,Math.floor((Math.max(a.y,b.y,c.y)-origin)/step));
      const loZ=Math.max(0,Math.ceil((Math.min(a.z,b.z,c.z)-origin)/step)),hiZ=Math.min(n-1,Math.floor((Math.max(a.z,b.z,c.z)-origin)/step));
      for(let z=loZ;z<=hiZ;z++)for(let y=loY;y<=hiY;y++){
        const py=origin+y*step+1e-7,pz=origin+z*step+2e-7,u=((b.z-c.z)*(py-c.y)+(c.y-b.y)*(pz-c.z))/den,w=((c.z-a.z)*(py-c.y)+(a.y-c.y)*(pz-c.z))/den;
        if(u>=0&&w>=0&&u+w<=1)buckets[z*n+y].push(u*a.x+w*b.x+(1-u-w)*c.x);
      }
    }
  }
  const field=new Float32Array(n*n*n),inside=new Uint8Array(field.length);
  for(let z=0;z<n;z++)for(let y=0;y<n;y++){
    const hits=buckets[z*n+y].sort((a,b)=>a-b).filter((x,i,a)=>i===0||x-a[i-1]>1e-6);let h=0;
    for(let x=0;x<n;x++){while(h<hits.length&&hits[h]<origin+x*step)h++;inside[x+n*(y+n*z)]=h%2;}
  }
  field.fill(1000);
  for(let z=1;z<n-1;z++)for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){
    const i=x+n*(y+n*z);if([i-1,i+1,i-n,i+n,i-n*n,i+n*n].some(j=>inside[j]!==inside[i])){field[i]=.5;}
  }
  // Euclidean chamfer sweeps avoid the diamond-shaped ridges produced by
  // a six-neighbor Manhattan distance field.
  const neighbors=[];for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dz<0||(dz===0&&dy<0)||(dz===0&&dy===0&&dx<0))neighbors.push([dx,dy,dz,Math.hypot(dx,dy,dz)]);
  for(let pass=0;pass<2;pass++)for(const direction of [1,-1])for(let zz=1;zz<n-1;zz++)for(let yy=1;yy<n-1;yy++)for(let xx=1;xx<n-1;xx++){
    const x=direction===1?xx:n-1-xx,y=direction===1?yy:n-1-yy,z=direction===1?zz:n-1-zz,i=x+n*(y+n*z);
    for(const [dx,dy,dz,w] of neighbors){const j=i+direction*(dx+n*(dy+n*dz));field[i]=Math.min(field[i],field[j]+w);}
  }
  for(let i=0;i<field.length;i++)field[i]*=inside[i]?-step:step;
  // Smooth the voxel stair steps before extracting the opaque surface.
  for(let pass=0;pass<2;pass++){const copy=field.slice();for(let z=1;z<n-1;z++)for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){const i=x+n*(y+n*z);field[i]=(copy[i]*2+copy[i-1]+copy[i+1]+copy[i-n]+copy[i+n]+copy[i-n*n]+copy[i+n*n])/8;}}
  return {field,n,step,origin};
}
const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
export function morphSurface(a,b,t){
 const {n,step,origin}=a,values=new Float32Array(a.field.length),positions=[],normals=[],points=corners.map(()=>new T.Vector3()),v=new Float64Array(8),cross=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3();
 // A temporary volume allowance keeps thin regions joined as holes close
 // and limbs emerge; it is exactly zero at both endpoint models.
 for(let i=0;i<values.length;i++)values[i]=a.field[i]*(1-t)+b.field[i]*t-.22*Math.sin(Math.PI*t)**2;
 // Remove sub-voxel islands produced where thin source surfaces cross.
 // Endpoint components are preserved, including separate imported parts.
 if(t>0&&t<1){const seen=new Uint8Array(values.length),queue=new Int32Array(values.length);
  for(let start=0;start<values.length;start++){if(seen[start]||values[start]>=0)continue;let tail=1;queue[0]=start;seen[start]=1;
   for(let head=0;head<tail;head++){const i=queue[head],x=i%n,y=Math.floor(i/n)%n,z=Math.floor(i/(n*n));for(const j of [x>0?i-1:-1,x<n-1?i+1:-1,y>0?i-n:-1,y<n-1?i+n:-1,z>0?i-n*n:-1,z<n-1?i+n*n:-1])if(j>=0&&!seen[j]&&values[j]<0){seen[j]=1;queue[tail++]=j;}}
   if(tail<64)for(let j=0;j<tail;j++)values[queue[j]]=Math.abs(values[queue[j]]);
  }
 }
 const gradient=new Float32Array(values.length*3);
 for(let z=1;z<n-1;z++)for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){const i=x+n*(y+n*z);gradient[i*3]=values[i+1]-values[i-1];gradient[i*3+1]=values[i+n]-values[i-n];gradient[i*3+2]=values[i+n*n]-values[i-n*n];}
 function normal(p){const gx=(p.x-origin)/step,gy=(p.y-origin)/step,gz=(p.z-origin)/step,x=Math.floor(gx),y=Math.floor(gy),z=Math.floor(gz),f=[gx-x,gy-y,gz-z],out=new T.Vector3();
 for(const [dx,dy,dz] of corners){const w=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1])*(dz?f[2]:1-f[2]),i=(x+dx+n*(y+dy+n*(z+dz)))*3;out.x+=gradient[i]*w;out.y+=gradient[i+1]*w;out.z+=gradient[i+2]*w;}return out.normalize();}
 const cut=(i,j)=>points[i].clone().lerp(points[j],v[i]/(v[i]-v[j]));
 const emit=(p,q,r,out)=>{cross.crossVectors(ab.subVectors(q,p),ac.subVectors(r,p));if(cross.dot(ab.subVectors(out,p))<0)[q,r]=[r,q];positions.push(...p.toArray(),...q.toArray(),...r.toArray());for(const vertex of [p,q,r])normals.push(...normal(vertex).toArray());};
 for(let z=0;z<n-1;z++)for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++){
  let mask=0;for(let k=0;k<8;k++){const [dx,dy,dz]=corners[k];v[k]=values[x+dx+n*(y+dy+n*(z+dz))];if(v[k]<0)mask|=1<<k;points[k].set(origin+(x+dx)*step,origin+(y+dy)*step,origin+(z+dz)*step);}if(mask===0||mask===255)continue;
  for(const ids of tetra){const ins=ids.filter(i=>v[i]<0),outs=ids.filter(i=>v[i]>=0);if(!ins.length||!outs.length)continue;
   if(ins.length===1){const i=ins[0];emit(cut(i,outs[0]),cut(i,outs[1]),cut(i,outs[2]),points[outs[0]]);}
   else if(outs.length===1){const o=outs[0];emit(cut(o,ins[0]),cut(o,ins[1]),cut(o,ins[2]),points[o]);}
   else{const p=cut(ins[0],outs[0]),q=cut(ins[0],outs[1]),r=cut(ins[1],outs[0]),s=cut(ins[1],outs[1]);emit(p,q,r,points[outs[0]]);emit(q,s,r,points[outs[0]]);}
  }
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.computeBoundingSphere();return geometry;
}

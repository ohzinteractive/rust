// A sheet wraps the outside of limbs rather than threading between them.
// Each height slab encloses every triangle crossing it, so narrow features
// are preserved even when none of the coarse surface-map samples hit them.
export function createClothWrapEnvelope(triangles,bounds,{levels=96,directions=96}={}){
  const min=bounds.min,max=bounds.max,dy=Math.max(.001,max.y-min.y)/levels;
  const sumX=new Float64Array(levels),sumZ=new Float64Array(levels),counts=new Uint32Array(levels);
  const nx=new Float64Array(directions),nz=new Float64Array(directions),queryPlanes=new Float64Array(directions),support=new Float32Array(levels*directions).fill(-Infinity);
  for(let i=0;i<directions;i++){nx[i]=Math.cos(i/directions*Math.PI*2);nz[i]=Math.sin(i/directions*Math.PI*2);}
  function include(row,x,z){
    sumX[row]+=x;sumZ[row]+=z;counts[row]++;
    const offset=row*directions;
    for(let i=0;i<directions;i++)support[offset+i]=Math.max(support[offset+i],x*nx[i]+z*nz[i]);
  }
  for(const t of triangles){
    const low=Math.max(0,Math.min(levels-1,Math.floor((Math.min(t[1],t[4],t[7])-min.y)/dy))),high=Math.max(0,Math.min(levels-1,Math.floor((Math.max(t[1],t[4],t[7])-min.y)/dy)));
    for(let row=low;row<=high;row++){
      const bottom=min.y+row*dy,top=bottom+dy;
      for(let j=0;j<3;j++)if(t[j*3+1]>=bottom-1e-7&&t[j*3+1]<=top+1e-7)include(row,t[j*3],t[j*3+2]);
      for(let j=0;j<3;j++){
        const a=j*3,b=((j+1)%3)*3,delta=t[b+1]-t[a+1];if(Math.abs(delta)<1e-10)continue;
        for(const y of [bottom,top]){
          const f=(y-t[a+1])/delta;if(f<0||f>1)continue;
          include(row,t[a]+(t[b]-t[a])*f,t[a+2]+(t[b+2]-t[a+2])*f);
        }
      }
    }
  }
  const dilations=new Map();
  function paddedSupport(padding){
    const radius=Math.max(1,Math.ceil(padding/dy));if(dilations.has(radius))return dilations.get(radius);
    const values=new Float32Array(support.length).fill(-Infinity),centerX=new Float64Array(levels),centerZ=new Float64Array(levels),totals=new Float64Array(levels);
    for(let row=0;row<levels;row++)for(let neighbor=Math.max(0,row-radius);neighbor<=Math.min(levels-1,row+radius);neighbor++){
      centerX[row]+=sumX[neighbor];centerZ[row]+=sumZ[neighbor];totals[row]+=counts[neighbor];
      for(let i=0;i<directions;i++)values[row*directions+i]=Math.max(values[row*directions+i],support[neighbor*directions+i]);
    }
    for(let row=0;row<levels;row++)if(totals[row]){centerX[row]/=totals[row];centerZ[row]/=totals[row];}
    const padded={values,centerX,centerZ};dilations.set(radius,padded);return padded;
  }
  return {
    project(p,offset=0,padding=.04,angle=null,originX=null,originZ=null){
      const x=p[offset],y=p[offset+1],z=p[offset+2];
      if(y<min.y||y>max.y||(originX===null&&(x<min.x-padding||x>max.x+padding||z<min.z-padding||z>max.z+padding)))return false;
      const {values:planes,centerX,centerZ}=paddedSupport(padding);
      const height=(y-min.y)/dy,row=Math.min(levels-1,Math.floor(height)),f=height-row;
      if(!Number.isFinite(planes[row*directions]))return false;
      let distance=Infinity,normal=0,cx=centerX[row],cz=centerZ[row];
      if(f<.5&&row>0){const w=.5-f;cx+=(centerX[row-1]-cx)*w;cz+=(centerZ[row-1]-cz)*w;}
      if(f>.5&&row<levels-1){const w=f-.5;cx+=(centerX[row+1]-cx)*w;cz+=(centerZ[row+1]-cz)*w;}
      for(let i=0;i<directions;i++){
        const current=planes[row*directions+i];let plane=current;
        // Cross-fade neighboring slabs while retaining the current slab's
        // conservative bound. This avoids steps when cloth moves vertically.
        if(f<.5&&row>0){const neighbor=planes[(row-1)*directions+i];if(Number.isFinite(neighbor))plane=Math.max(plane,current+(neighbor-current)*(1-f*2));}
        if(f>.5&&row<levels-1){const neighbor=planes[(row+1)*directions+i];if(Number.isFinite(neighbor))plane=Math.max(plane,current+(neighbor-current)*(f*2-1));}
        queryPlanes[i]=originX===null?plane+padding:Math.max(plane+padding,originX*nx[i]+originZ*nz[i]+.015);
        const margin=queryPlanes[i]-x*nx[i]-z*nz[i];if(margin<0&&originX===null)return false;
        if(margin<distance){distance=margin;normal=i;}
      }
      if(originX!==null){cx=originX;cz=originZ;}
      if(angle!==null){
        const dx=Math.cos(angle),dz=Math.sin(angle);let radius=Infinity;
        for(let i=0;i<directions;i++){const dot=nx[i]*dx+nz[i]*dz;if(dot>1e-7)radius=Math.min(radius,(queryPlanes[i]-cx*nx[i]-cz*nz[i])/dot);}
        if(originX!==null)radius=Math.max(radius,Math.hypot(x-cx,z-cz));
        p[offset]=cx+dx*(radius+.0001);p[offset+2]=cz+dz*(radius+.0001);return true;
      }
      p[offset]+=nx[normal]*(distance+.0001);p[offset+2]+=nz[normal]*(distance+.0001);return true;
    }
  };
}

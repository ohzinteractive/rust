import * as THREE from 'three';

// Low-resolution flexible ribs drive the existing detailed ribbons through a
// small texture. No full-mesh position buffers need to cross the CPU/GPU boundary.
export function createKelpLeafPhysics({blades,sample,segments=8}){
  const rows=segments+1,count=blades.length,points=[],edges=[],grid=new Map(),buckets=[],pairs=new Set(),candidates=[];
  const data=new Float32Array(Math.max(1,count)*rows*4),previousData=new Float32Array(data.length),nextData=new Float32Array(data.length);
  let displayDirty=true,displayAlpha=-1;
  const texture=new THREE.DataTexture(data,rows,Math.max(1,count),THREE.RGBAFormat,THREE.FloatType);
  const delta=new THREE.Vector3(),normal=new THREE.Vector3();
  const uAxis=new THREE.Vector3(),vAxis=new THREE.Vector3(),sideA=new THREE.Vector3(),sideB=new THREE.Vector3();
  const normalA=new THREE.Vector3(),normalB=new THREE.Vector3(),crossAxis=new THREE.Vector3(),bestNormal=new THREE.Vector3(),centers=new THREE.Vector3();
  const axes=[normalA,normalB,crossAxis,normal];
  let version=0,contacts=0,checks=0;
  for(let leaf=0;leaf<count;leaf++){
    const blade=blades[leaf];
    for(let row=0;row<rows;row++){
      const target=sample(leaf,row/segments,new THREE.Vector3());
      points.push({p:target.clone(),target,offset:new THREE.Vector3(),previous:new THREE.Vector3(),velocity:new THREE.Vector3(),bend:new THREE.Vector3(),weight:row===0?0:1,limit:Math.min(.7,(blade.length??2)*.3)*Math.pow(row/segments,1.2)});
      if(row){
        const a=leaf*rows+row-1,b=a+1;
        let radius=.012;
        for(let j=Math.floor((row-1)*32/segments);j<=Math.ceil(row*32/segments);j++)radius=Math.max(radius,blade.widths[j]+.018);
        edges.push({a,b,leaf,row:row-1,radius,length:points[a].p.distanceTo(target),side:blade.sides?.[Math.round((row-.5)*32/segments)]?.clone()??null});
      }
    }
  }
  function limit(p){
    delta.subVectors(p.p,p.target);
    if(delta.lengthSq()>p.limit*p.limit)p.p.copy(p.target).add(delta.setLength(p.limit));
  }
  function active(e){return e.row/segments<blades[e.leaf].health;}
  // Closest points on two finite segments, including parallel and collapsed ribs.
  function separate(e,f,apply=true){
    if(e.leaf===f.leaf)return 0;
    const a=points[e.a],b=points[e.b],c=points[f.a],d=points[f.b];
    const ef=Math.min(1,blades[e.leaf].health*segments-e.row),ff=Math.min(1,blades[f.leaf].health*segments-f.row);
    const ux=(b.p.x-a.p.x)*ef,uy=(b.p.y-a.p.y)*ef,uz=(b.p.z-a.p.z)*ef;
    const vx=(d.p.x-c.p.x)*ff,vy=(d.p.y-c.p.y)*ff,vz=(d.p.z-c.p.z)*ff;
    const wx=a.p.x-c.p.x,wy=a.p.y-c.p.y,wz=a.p.z-c.p.z;
    const aa=ux*ux+uy*uy+uz*uz,bb=ux*vx+uy*vy+uz*vz,cc=vx*vx+vy*vy+vz*vz;
    const dd=ux*wx+uy*wy+uz*wz,ee=vx*wx+vy*wy+vz*wz,den=aa*cc-bb*bb;
    let s=aa<1e-12?0:THREE.MathUtils.clamp(den>1e-12?(bb*ee-cc*dd)/den:0,0,1);
    let t=cc<1e-12?0:(bb*s+ee)/cc;
    if(t<0){t=0;s=aa<1e-12?0:THREE.MathUtils.clamp(-dd/aa,0,1);}
    else if(t>1){t=1;s=aa<1e-12?0:THREE.MathUtils.clamp((bb-dd)/aa,0,1);}
    normal.set(wx+ux*s-vx*t,wy+uy*s-vy*t,wz+uz*s-vz*t);
    const distance=normal.length();
    if(distance>=e.radius+f.radius)return 0;
    uAxis.set(ux,uy,uz);vAxis.set(vx,vy,vz);
    const halfA=uAxis.length()*.5,halfB=vAxis.length()*.5;
    if(halfA<1e-8||halfB<1e-8)return 0;
    uAxis.multiplyScalar(.5/halfA);vAxis.multiplyScalar(.5/halfB);
    sideA.copy(e.side??delta.set(-uz,0,ux));sideA.addScaledVector(uAxis,-sideA.dot(uAxis)).normalize();
    sideB.copy(f.side??delta.set(-vz,0,vx));sideB.addScaledVector(vAxis,-sideB.dot(vAxis)).normalize();
    normalA.crossVectors(uAxis,sideA).normalize();normalB.crossVectors(vAxis,sideB).normalize();crossAxis.crossVectors(uAxis,vAxis);
    if(distance>1e-8)normal.multiplyScalar(1/distance);else normal.copy(normalA);
    centers.set(wx+ux*.5-vx*.5,wy+uy*.5-vy*.5,wz+uz*.5-vz*.5);
    let penetration=Infinity;
    for(const axis of axes){
      if(axis.lengthSq()<1e-10)continue;axis.normalize();
      const projection=centers.dot(axis);
      const supportA=Math.abs(uAxis.dot(axis))*halfA+Math.abs(sideA.dot(axis))*e.radius+Math.abs(normalA.dot(axis))*.014;
      const supportB=Math.abs(vAxis.dot(axis))*halfB+Math.abs(sideB.dot(axis))*f.radius+Math.abs(normalB.dot(axis))*.014;
      const overlap=supportA+supportB-Math.abs(projection);
      if(overlap<=0)return 0;
      if(overlap<penetration){penetration=overlap;bestNormal.copy(axis).multiplyScalar(projection<0?-1:1);}
    }
    if(!Number.isFinite(penetration))return 0;
    if(!apply)return penetration;
    normal.copy(bestNormal);
    s*=ef;t*=ff;
    const wa=(1-s)*a.weight,wb=s*b.weight,wc=(1-t)*c.weight,wd=t*d.weight;
    const mass=(1-s)*wa+s*wb+(1-t)*wc+t*wd;if(mass<1e-8)return penetration;
    const correction=Math.min((penetration+.0005)/mass,.035/Math.max(wa,wb,wc,wd));
    a.p.addScaledVector(normal,correction*wa);b.p.addScaledVector(normal,correction*wb);
    c.p.addScaledVector(normal,-correction*wc);d.p.addScaledVector(normal,-correction*wd);
    limit(a);limit(b);limit(c);limit(d);
    return penetration;
  }
  function collide(apply=true,rebuild=true){
    let hits=0,max=0;
    if(rebuild){
      grid.clear();pairs.clear();candidates.length=0;let used=0;checks=0;
      const cell=.65;
      for(let i=0;i<edges.length;i++){
        const e=edges[i];if(!active(e))continue;
        const a=points[e.a].p,b=points[e.b].p,r=e.radius;
        const x0=Math.floor((Math.min(a.x,b.x)-r)/cell),x1=Math.floor((Math.max(a.x,b.x)+r)/cell);
        const y0=Math.floor((Math.min(a.y,b.y)-r)/cell),y1=Math.floor((Math.max(a.y,b.y)+r)/cell);
        const z0=Math.floor((Math.min(a.z,b.z)-r)/cell),z1=Math.floor((Math.max(a.z,b.z)+r)/cell);
        for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++){
          const key=(x+128)+(y+128)*256+(z+128)*65536;let bucket=grid.get(key);
          if(!bucket){bucket=buckets[used]??(buckets[used]=[]);bucket.length=0;used++;grid.set(key,bucket);}
          for(const j of bucket){
            const f=edges[j];if(f.leaf===e.leaf)continue;
            const fa=points[f.a].p,fb=points[f.b].p,rr=e.radius+f.radius;
            if(Math.min(a.x,b.x)>Math.max(fa.x,fb.x)+rr||Math.max(a.x,b.x)<Math.min(fa.x,fb.x)-rr||
               Math.min(a.y,b.y)>Math.max(fa.y,fb.y)+rr||Math.max(a.y,b.y)<Math.min(fa.y,fb.y)-rr||
               Math.min(a.z,b.z)>Math.max(fa.z,fb.z)+rr||Math.max(a.z,b.z)<Math.min(fa.z,fb.z)-rr)continue;
            const pair=i*edges.length+j;if(pairs.has(pair))continue;pairs.add(pair);checks++;
            candidates.push(i,j);
          }
          bucket.push(i);
        }
      }
    }
    for(let k=0;k<candidates.length;k+=2){
      const depth=separate(edges[candidates[k]],edges[candidates[k+1]],apply);
      if(depth>0){hits++;max=Math.max(max,depth);}
    }
    contacts=hits;return max;
  }
  function constrain(){
    for(const e of edges){
      const a=points[e.a],b=points[e.b],mass=a.weight+b.weight;
      delta.subVectors(b.p,a.p);const length=delta.length();
      if(length<1e-8)continue;
      // A little compliance lets broad blades yield without rigid hinges.
      const desired=Math.max(e.length,a.target.distanceTo(b.target)*.96);
      const correction=(length-desired)/length*.8/mass;
      a.p.addScaledVector(delta,correction*a.weight);b.p.addScaledVector(delta,-correction*b.weight);
    }
  }
  function bend(){
    // Smooth the displacement field, preserving the blade's original curl.
    // This spreads contact over neighboring sections instead of making a hinge.
    for(let leaf=0;leaf<count;leaf++)for(let row=1;row<segments;row++){
      const i=leaf*rows+row,p=points[i],a=points[i-1],b=points[i+1];
      p.bend.copy(a.p).sub(a.target).add(b.p).sub(b.target).multiplyScalar(.5)
        .sub(p.p).add(p.target).multiplyScalar(.55);
    }
    for(let leaf=0;leaf<count;leaf++)for(let row=1;row<segments;row++)points[leaf*rows+row].p.add(points[leaf*rows+row].bend);
  }
  function interpolate(alpha){
    alpha=THREE.MathUtils.clamp(alpha,0,1);
    if(!displayDirty&&alpha===displayAlpha)return false;
    let changed=false;
    for(let i=0;i<data.length;i++){
      const value=Math.fround(previousData[i]+(nextData[i]-previousData[i])*alpha);
      if(data[i]!==value)changed=true;data[i]=value;
    }
    displayAlpha=alpha;displayDirty=false;
    if(changed){texture.needsUpdate=true;version++;}return changed;
  }
  function upload(initial=false){
    previousData.set(nextData);
    points.forEach((p,i)=>{
      p.offset.subVectors(p.p,p.target);
      nextData[i*4]=p.offset.x;nextData[i*4+1]=p.offset.y;nextData[i*4+2]=p.offset.z;
    });
    displayDirty=true;
    if(initial){previousData.set(nextData);interpolate(1);texture.needsUpdate=true;}
  }
  function solve(dt,iterations=3,deferDisplay=false){
    dt=THREE.MathUtils.clamp(dt,.001,.05);
    points.forEach((p,i)=>{
      p.previous.copy(p.offset);sample(Math.floor(i/rows),(i%rows)/segments,p.target);
      if(!p.weight){p.p.copy(p.target);p.velocity.set(0,0,0);return;}
      p.velocity.multiplyScalar(Math.exp(-10*dt)).addScaledVector(p.offset,-14*dt);
      p.offset.addScaledVector(p.velocity,dt);p.p.copy(p.target).add(p.offset);
    });
    for(let i=0;i<iterations;i++){constrain();bend();for(const p of points)limit(p);collide(true,i===0);}
    // Contact projection must not turn into an instantaneous tip displacement.
    // Limit the correction speed, then interpolate it between simulation ticks.
    points.forEach((p,i)=>{
      if(!p.weight)return;
      const flex=(i%rows)/segments,maxSpeed=.12+.58*Math.pow(flex,1.2);
      delta.subVectors(p.p,p.target).sub(p.previous).clampLength(0,maxSpeed*dt);
      p.p.copy(p.target).add(p.previous).add(delta);
    });
    upload();
    points.forEach(p=>{p.velocity.subVectors(p.offset,p.previous).multiplyScalar(.75/dt).clampLength(0,.7);});
    if(!deferDisplay)interpolate(1);
  }
  function offset(leaf,t,out){
    const row=THREE.MathUtils.clamp(t,0,1)*segments,low=Math.min(segments-1,Math.floor(row)),u=row-low;
    const base=leaf*rows*4,a=base+Math.max(0,low-1)*4,b=base+low*4,c=b+4,d=base+Math.min(segments,low+2)*4;
    for(let axis=0;axis<3;axis++){
      const p0=data[a+axis],p1=data[b+axis],p2=data[c+axis],p3=data[d+axis];
      out.setComponent(axis,.5*(2*p1+(-p0+p2)*u+(2*p0-5*p1+4*p2-p3)*u*u+(-p0+3*p1-3*p2+p3)*u*u*u));
    }
    return out;
  }
  // Resolve initially intersecting rest shapes before the first displayed frame.
  for(let i=0;i<6;i++){constrain();bend();for(const p of points)limit(p);collide();}upload(true);
  return {texture,rows,solve,offset,interpolate,get version(){return version;},
    inspect(leaf,row,rendered=false){const p=points[leaf*rows+row];if(!p)return null;return rendered?sample(leaf,row/segments,new THREE.Vector3()).add(offset(leaf,row/segments,new THREE.Vector3())):p.p.clone();},
    diagnostics(){const penetration=collide(false);return {points:points.length,segments:edges.length,contacts,checks,maxPenetration:penetration};},
    dispose(){texture.dispose();grid.clear();pairs.clear();candidates.length=0;points.length=0;edges.length=0;buckets.length=0;}};
}

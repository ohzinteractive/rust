import * as THREE from 'three';
import {sampleRopeOutline} from './rope-outline.js';

const TAU=Math.PI*2,SIDES=8,LEVELS=9;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
function radiusAt(values,angle){
  const t=((angle/TAU)%1+1)%1*values.length,i=Math.floor(t),f=t-i;
  return values[i]*(1-f)+values[(i+1)%values.length]*f;
}

export function createRibbonBinding({mesh,material,positions,links,bounds,center,height,span,width,turns,points,profileAt}){
  const size=Math.max(.001,bounds.max.y-bounds.min.y),mid=THREE.MathUtils.lerp(bounds.min.y,bounds.max.y,height);
  const low=Math.max(bounds.min.y+size*.03,mid-size*span*.5),high=Math.min(bounds.min.y+size*.97,mid+size*span*.5);
  let segments=points,bandWidth=width*size,levels=[];
  function initialize(){
    levels=Array.from({length:LEVELS},(_,i)=>{
      const y=THREE.MathUtils.lerp(low,high,i/(LEVELS-1)),profile=profileAt((y-bounds.min.y)/size);
      const current=Float32Array.from(profile.radii,r=>r*1.5+.12);
      return {y,radii:profile.radii,current,loose:current.slice()};
    });
  }
  function geometry(){
    const count=segments*turns,p=new Float32Array((count+1)*SIDES*3),uv=new Float32Array((count+1)*SIDES*2),indices=[];
    for(let i=0;i<=count;i++)for(let j=0;j<SIDES;j++){
      const index=i*SIDES+j;uv[index*2]=i/count;uv[index*2+1]=j/SIDES;
      if(i<count){const a=index,b=(i+1)*SIDES+j,c=(i+1)*SIDES+(j+1)%SIDES,d=i*SIDES+(j+1)%SIDES;indices.push(a,d,b,b,d,c);}
    }
    for(let i=1;i<SIDES-1;i++){indices.push(0,i+1,i);const end=count*SIDES;indices.push(end,end+i,end+i+1);}
    const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.BufferAttribute(p,3).setUsage(THREE.DynamicDrawUsage));
    result.setAttribute('normal',new THREE.BufferAttribute(p.slice(),3).setUsage(THREE.DynamicDrawUsage));result.setAttribute('uv',new THREE.BufferAttribute(uv,2));result.setIndex(indices);
    mesh.geometry.dispose();mesh.geometry=result;mesh.material=material;mesh.name='Cloth binding ribbon';
  }
  function radius(y,angle,key='current'){
    const t=clamp((y-low)/(high-low))*(LEVELS-1),i=Math.min(LEVELS-2,Math.floor(t)),f=t-i;
    return radiusAt(levels[i][key],angle)*(1-f)+radiusAt(levels[i+1][key],angle)*f;
  }
  function angleAt(a,b,t,reference){
    let angle=Math.atan2(positions[a+2]*(1-t)+positions[b+2]*t-center.y,positions[a]*(1-t)+positions[b]*t-center.x);
    angle+=Math.round((reference-angle)/TAU)*TAU;return angle;
  }
  initialize();geometry();
  return {
    get maxY(){return high;},
    setWidth(value){bandWidth=value*size;},
    resize(value){
      segments=value;
      for(const level of levels){
        for(const key of ['current','loose']){const old=level[key];level[key]=Float32Array.from({length:segments},(_,i)=>radiusAt(old,i/segments*TAU));}
        level.radii=profileAt((level.y-bounds.min.y)/size).radii;
      }
      geometry();
    },
    capture(record){
      const attachments=[];
      for(const [a,b] of links){
        let angle=Math.atan2(positions[a+2]-center.y,positions[a]-center.x);if(angle<0)angle+=TAU;
        for(let turn=-1;turn<=turns;turn++){
          const target=t=>low+(high-low)*(turn+angleAt(a,b,t,angle)/TAU)/turns;
          const da=positions[a+1]-target(0),db=positions[b+1]-target(1);if(da*db>0||Math.abs(da-db)<1e-8)continue;
          let left=0,right=1;
          for(let pass=0;pass<12;pass++){
            const t=(left+right)*.5,d=positions[a+1]*(1-t)+positions[b+1]*t-target(t);
            if(d*da>0)left=t;else right=t;
          }
          const t=(left+right)*.5,y=target(t);if(y<low-1e-6||y>high+1e-6)continue;
          attachments.push({a,b,t,y});
        }
      }
      if(attachments.length<8)return false;
      let bottom=Infinity,top=-Infinity;for(const contact of attachments){bottom=Math.min(bottom,contact.y);top=Math.max(top,contact.y);}
      if(bottom>low+(high-low)*.15||top<high-(high-low)*.15)return false;
      for(const level of levels){
        const samples=new Float32Array(segments),hits=new Uint16Array(segments);
        for(const [a,b] of links){
          const ya=positions[a+1],yb=positions[b+1];if((ya-level.y)*(yb-level.y)>0||Math.abs(yb-ya)<1e-8)continue;
          const t=(level.y-ya)/(yb-ya),x=positions[a]*(1-t)+positions[b]*t-center.x,z=positions[a+2]*(1-t)+positions[b+2]*t-center.y;
          const index=Math.floor(((Math.atan2(z,x)/TAU+1)%1)*segments);samples[index]=Math.max(samples[index],Math.hypot(x,z));hits[index]++;
        }
        for(let i=0;i<segments;i++){
          let left=i,right=i;for(let n=0;n<segments&&!hits[left];n++)left=(left+segments-1)%segments;for(let n=0;n<segments&&!hits[right];n++)right=(right+1)%segments;
          const distance=(right-left+segments)%segments,f=distance?((i-left+segments)%segments)/distance:0;
          level.loose[i]=Math.max(level.radii[i]+.03,THREE.MathUtils.lerp(samples[left],samples[right],f)+.018);level.current[i]=level.loose[i];
        }
      }
      record.attachments=attachments;return true;
    },
    tighten(dt,tightness){
      const blend=1-Math.exp(-dt*2);
      for(const level of levels)for(let i=0;i<segments;i++)level.current[i]+=(THREE.MathUtils.lerp(level.loose[i],level.radii[i],tightness)-level.current[i])*blend;
    },
    solve(record){
      for(const {a,b,t,y} of record.attachments){
        const wa=1-t,wb=t,den=wa*wa+wb*wb,x=positions[a]*wa+positions[b]*wb-center.x,z=positions[a+2]*wa+positions[b+2]*wb-center.y;
        const length=Math.hypot(x,z),limit=radius(y,Math.atan2(z,x))-.014,shrink=length>limit?(limit/length-1)*.85:0,dy=(y-positions[a+1]*wa-positions[b+1]*wb)*.9;
        for(let j=0;j<2;j++){const i=j?b:a,w=(j?wb:wa)/den;positions[i]+=x*shrink*w;positions[i+1]+=dy*w;positions[i+2]+=z*shrink*w;}
      }
    },
    get meanRadius(){let sum=0;for(const level of levels)for(const value of level.current)sum+=value;return sum/(levels.length*segments);},
    render(display,indices,columns,rows){
      const outlines=levels.map(level=>{
        const contacts=[];
        for(let i=0;i<segments;i++)contacts.push([Math.cos(i/segments*TAU)*level.current[i],Math.sin(i/segments*TAU)*level.current[i]]);
        function edge(a,b){
          const ya=display[a+1],yb=display[b+1];if(Math.abs(yb-ya)<1e-8)return;
          for(const y of [level.y-bandWidth*.5,level.y,level.y+bandWidth*.5]){
            if((ya-y)*(yb-y)>0)continue;const t=(y-ya)/(yb-ya);
            contacts.push([display[a]*(1-t)+display[b]*t-center.x,display[a+2]*(1-t)+display[b+2]*t-center.y]);
          }
        }
        if(indices)for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;edge(a,b);edge(b,c);edge(c,a);}
        else for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
          const a=(row*(columns+1)+col)*3;if(col<columns)edge(a,a+3);if(row<rows)edge(a,a+(columns+1)*3);if(col<columns&&row<rows)edge(a+3,a+(columns+1)*3);
        }
        const samples=sampleRopeOutline(contacts,segments),outline=[];
        for(let i=0;i<segments;i++){const x=samples[i*4],z=samples[i*4+1];outline.push({x,z,nx:samples[i*4+2],nz:samples[i*4+3],angle:(Math.atan2(z,x)+TAU)%TAU});}
        return outline.sort((a,b)=>a.angle-b.angle);
      });
      function sample(outline,angle){
        let left=0,right=outline.length;while(left<right){const middle=(left+right)>>1;if(outline[middle].angle<=angle)left=middle+1;else right=middle;}
        const a=outline[(left+outline.length-1)%outline.length],b=outline[left%outline.length],dx=Math.cos(angle),dz=Math.sin(angle),ex=b.x-a.x,ez=b.z-a.z;
        const denominator=dx*ez-dz*ex,r=Math.abs(denominator)>1e-9?(a.x*ez-a.z*ex)/denominator:Math.hypot(a.x,a.z);
        const t=clamp(((dx*r-a.x)*ex+(dz*r-a.z)*ez)/(ex*ex+ez*ez));return {r,nx:a.nx*(1-t)+b.nx*t,nz:a.nz*(1-t)+b.nz*t};
      }
      const count=segments*turns,centers=new Float32Array((count+1)*5);
      const angles=outlines[(LEVELS-1)/2].map(point=>point.angle),start=angles[0];
      for(let i=0;i<=count;i++){
        // Keep the extra samples at rounded bends on every turn, just as for
        // round cord; uniformly spaced rays would discard that corner detail.
        const phase=Math.floor(i/segments)*TAU+angles[i%segments]-start,t=phase/(turns*TAU),angle=phase+start,u=clamp(t)*(LEVELS-1),row=Math.min(LEVELS-2,Math.floor(u)),f=u-row;
        const a=sample(outlines[row],angle%TAU),b=sample(outlines[row+1],angle%TAU),r=a.r*(1-f)+b.r*f;
        centers.set([center.x+Math.cos(angle)*r,low+(high-low)*t,center.y+Math.sin(angle)*r,a.nx*(1-f)+b.nx*f,a.nz*(1-f)+b.nz*f],i*5);
      }
      const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,tangent=new THREE.Vector3(),normal=new THREE.Vector3(),across=new THREE.Vector3();
      for(let i=0;i<=count;i++){
        const a=Math.max(0,i-1)*5,b=Math.min(count,i+1)*5,c=i*5;
        tangent.set(centers[b]-centers[a],centers[b+1]-centers[a+1],centers[b+2]-centers[a+2]).normalize();
        normal.set(centers[c+3],0,centers[c+4]).normalize();across.crossVectors(tangent,normal).normalize();normal.crossVectors(across,tangent).normalize();
        for(let side=0;side<SIDES;side++){
          const angle=side/SIDES*TAU,out=Math.cos(angle),up=Math.sin(angle),index=i*SIDES+side,depth=.003;
          p.setXYZ(index,centers[c]+normal.x*out*depth+across.x*up*bandWidth*.5,centers[c+1]+normal.y*out*depth+across.y*up*bandWidth*.5,centers[c+2]+normal.z*out*depth+across.z*up*bandWidth*.5);
          const nx=normal.x*out/depth+across.x*up/(bandWidth*.5),ny=normal.y*out/depth+across.y*up/(bandWidth*.5),nz=normal.z*out/depth+across.z*up/(bandWidth*.5),length=Math.hypot(nx,ny,nz);
          n.setXYZ(index,nx/length,ny/length,nz/length);
        }
      }
      p.needsUpdate=true;n.needsUpdate=true;
    }
  };
}

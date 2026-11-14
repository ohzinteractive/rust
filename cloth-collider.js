import * as THREE from 'three';
import {createClothWrapEnvelope} from './cloth-wrap-envelope.js';
import {createClothTriangleCollider} from './cloth-triangle-collider.js';

// Three orthogonal surface envelopes approximate a static mesh's occupied
// volume. Rasterizing triangles once keeps contact queries independent of the
// source mesh's triangle count (including detailed GLBs and posed characters).
export function createClothCollider(meshes,{resolution=73}={}){
  const triangles=[],bounds=new THREE.Box3(),vertex=new THREE.Vector3(),instance=new THREE.Matrix4(),transform=new THREE.Matrix4();
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);mesh.skeleton?.update();
    const geometry=mesh.geometry,index=geometry.index,count=index?.count??geometry.attributes.position.count;
    for(let copy=0;copy<(mesh.isInstancedMesh?mesh.count:1);copy++){
      transform.copy(mesh.matrixWorld);if(mesh.isInstancedMesh){mesh.getMatrixAt(copy,instance);transform.multiply(instance);}
      const start=geometry.drawRange.start,end=Math.min(count,start+geometry.drawRange.count);
      for(let i=start;i+2<end;i+=3){
        const triangle=[];
        for(let j=0;j<3;j++){
          mesh.getVertexPosition(index?index.getX(i+j):i+j,vertex).applyMatrix4(transform);
          bounds.expandByPoint(vertex);triangle.push(vertex.x,vertex.y,vertex.z);
        }
        triangles.push(triangle);
      }
    }
  }
  if(bounds.isEmpty())throw new Error('Choose a mesh to drape.');
  const min=bounds.min.toArray(),max=bounds.max.toArray(),size=max.map((v,i)=>Math.max(.001,v-min[i])),fields=[];
  for(let axis=0;axis<3;axis++){
    const u=(axis+1)%3,v=(axis+2)%3,low=new Float32Array(resolution*resolution).fill(Infinity),high=new Float32Array(resolution*resolution).fill(-Infinity);
    for(const t of triangles){
      const ax=(t[u]-min[u])/size[u]*(resolution-1),ay=(t[v]-min[v])/size[v]*(resolution-1);
      const bx=(t[3+u]-min[u])/size[u]*(resolution-1),by=(t[3+v]-min[v])/size[v]*(resolution-1);
      const cx=(t[6+u]-min[u])/size[u]*(resolution-1),cy=(t[6+v]-min[v])/size[v]*(resolution-1);
      const denominator=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(denominator)<1e-10)continue;
      const left=Math.max(0,Math.floor(Math.min(ax,bx,cx))),right=Math.min(resolution-1,Math.ceil(Math.max(ax,bx,cx)));
      const top=Math.max(0,Math.floor(Math.min(ay,by,cy))),bottom=Math.min(resolution-1,Math.ceil(Math.max(ay,by,cy)));
      for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
        const a=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/denominator,b=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/denominator,c=1-a-b;
        if(a<-.00001||b<-.00001||c<-.00001)continue;
        const depth=a*t[axis]+b*t[3+axis]+c*t[6+axis],i=y*resolution+x;
        low[i]=Math.min(low[i],depth);high[i]=Math.max(high[i],depth);
      }
    }
    fields.push({u,v,low,high});
  }
  const exact=createClothTriangleCollider(triangles),wrap=createClothWrapEnvelope(triangles,bounds);
  const lower=new Float64Array(3),upper=new Float64Array(3),contactNormal=new Float64Array(3);
  function intervals(p,offset,padding){
    for(let axis=0;axis<3;axis++){
      const {u,v,low,high}=fields[axis];let x=(p[offset+u]-min[u])/size[u]*(resolution-1),y=(p[offset+v]-min[v])/size[v]*(resolution-1);
      if(x < -padding/size[u]*(resolution-1)||y < -padding/size[v]*(resolution-1)||x > (1+padding/size[u])*(resolution-1)||y > (1+padding/size[v])*(resolution-1))return false;
      x=Math.max(0,Math.min(resolution-1,x));y=Math.max(0,Math.min(resolution-1,y));
      const ix=Math.min(resolution-2,Math.floor(x)),iy=Math.min(resolution-2,Math.floor(y)),fx=x-ix,fy=y-iy;
      let weight=0,lo=0,hi=0;
      for(let j=0;j<2;j++)for(let k=0;k<2;k++){
        const i=(iy+j)*resolution+ix+k,w=(k?fx:1-fx)*(j?fy:1-fy);
        if(high[i]===-Infinity)continue;weight+=w;lo+=low[i]*w;hi+=high[i]*w;
      }
      if(weight<.00001)return false;
      lower[axis]=lo/weight-padding;upper[axis]=hi/weight+padding;
      if(p[offset+axis]<lower[axis]||p[offset+axis]>upper[axis])return false;
    }
    return true;
  }
  const support=new THREE.Vector3(),topField=fields[1];let highest=-Infinity,nearest=Infinity;
  for(let row=0;row<resolution;row++)for(let col=0;col<resolution;col++){
    const y=topField.high[row*resolution+col],distance=(row/(resolution-1)-.5)**2+(col/(resolution-1)-.5)**2;
    if(y>highest+.002||(Math.abs(y-highest)<.002&&distance<nearest)){
      highest=y;nearest=distance;support.set(min[0]+row/(resolution-1)*size[0],y+.09,min[2]+col/(resolution-1)*size[2]);
    }
  }
  function crossSection(y){
    const points=[];
    for(const t of triangles)for(let edge=0;edge<3;edge++){
      const a=edge*3,b=((edge+1)%3)*3,dy=t[b+1]-t[a+1];
      if(Math.abs(dy)<1e-9)continue;
      const u=(y-t[a+1])/dy;if(u<0||u>1)continue;
      points.push([t[a]+(t[b]-t[a])*u,t[a+2]+(t[b+2]-t[a+2])*u]);
    }
    points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const unique=points.filter((p,i)=>!i||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>1e-7);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const lower=[],upper=[];
    for(const p of unique){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(let i=unique.length-1;i>=0;i--){const p=unique[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  }
  return {bounds,support,contactNormal,crossSection,
    containsSurface:exact.contains,projectSurface:exact.project,
    projectWrap(p,offset=0,padding=.04,angle=null,originX=null,originZ=null){
      // Continue the lowest silhouette down to the hem; projecting against
      // underside triangles would fold that skirt back through the feet.
      if(originX!==null&&p[offset+1]<bounds.min.y){
        const y=p[offset+1];p[offset+1]=bounds.min.y;
        const changed=wrap.project(p,offset,padding,angle,originX,originZ);p[offset+1]=y;return changed;
      }
      if(p[offset+1]<bounds.min.y||p[offset+1]>bounds.max.y)return exact.project(p,offset,padding);
      return wrap.project(p,offset,padding,angle,originX,originZ);
    },
    // Follow the gradient of the upper surface. Normal projection lets gravity
    // slide the sheet down sloping shoulders instead of gathering it on top.
    projectDrape(p,offset=0,padding=.045){
      const x=(p[offset]-min[0])/size[0]*(resolution-1),z=(p[offset+2]-min[2])/size[2]*(resolution-1);
      if(x<0||z<0||x>resolution-1||z>resolution-1)return -1;
      const row=Math.min(resolution-2,Math.floor(x)),col=Math.min(resolution-2,Math.floor(z)),fx=x-row,fz=z-col;
      const h00=topField.high[row*resolution+col],h10=topField.high[(row+1)*resolution+col],h01=topField.high[row*resolution+col+1],h11=topField.high[(row+1)*resolution+col+1];
      if(h00===-Infinity&&h10===-Infinity&&h01===-Infinity&&h11===-Infinity)return -1;
      const base=min[1]-.1,a=Number.isFinite(h00)?h00:base,b=Number.isFinite(h10)?h10:base,c=Number.isFinite(h01)?h01:base,d=Number.isFinite(h11)?h11:base;
      const height=(a*(1-fx)+b*fx)*(1-fz)+(c*(1-fx)+d*fx)*fz;
      const gx=Math.max(-8,Math.min(8,((b-a)*(1-fz)+(d-c)*fz)*(resolution-1)/size[0]));
      const gz=Math.max(-8,Math.min(8,((c-a)*(1-fx)+(d-b)*fx)*(resolution-1)/size[2]));
      const length=Math.sqrt(1+gx*gx+gz*gz),penetration=height+padding*length-p[offset+1];
      if(penetration<=0)return -1;
      const distance=penetration/(length*length);
      p[offset]-=gx*distance;p[offset+1]+=distance;p[offset+2]-=gz*distance;
      contactNormal[0]=-gx/length;contactNormal[1]=1/length;contactNormal[2]=-gz/length;return 1;
    },
    contains(p,offset=0){return intervals(p,offset,0);},
    project(p,offset=0,padding=.04){
      if(!intervals(p,offset,padding))return -1;
      let nearest=Infinity,dominant=0;
      for(let a=0;a<3;a++)nearest=Math.min(nearest,p[offset+a]-lower[a],upper[a]-p[offset+a]);
      // Blend equally near faces at a corner instead of switching abruptly
      // between axis normals as neighboring cloth constraints are solved.
      let length=0;
      for(let a=0;a<3;a++){
        const lo=p[offset+a]-lower[a],hi=upper[a]-p[offset+a],distance=Math.min(lo,hi),weight=Math.exp(-(distance-nearest)/.045);
        contactNormal[a]=(hi<lo?1:-1)*weight;length+=weight*weight;
      }
      length=Math.sqrt(length);let travel=Infinity;
      for(let a=0;a<3;a++){
        contactNormal[a]/=length;
        if(Math.abs(contactNormal[a])>Math.abs(contactNormal[dominant]))dominant=a;
        if(Math.abs(contactNormal[a])>1e-8)travel=Math.min(travel,(contactNormal[a]>0?upper[a]-p[offset+a]:p[offset+a]-lower[a])/Math.abs(contactNormal[a]));
      }
      for(let a=0;a<3;a++)p[offset+a]+=contactNormal[a]*(travel+.0001);
      // Curved envelopes change as X/Z moves; finish any residual penetration.
      for(let pass=0;pass<3&&intervals(p,offset,padding);pass++){
        let distance=Infinity,axis=0,target=0;
        for(let a=0;a<3;a++){
          const lo=p[offset+a]-lower[a],hi=upper[a]-p[offset+a];
          if(lo<distance){distance=lo;axis=a;target=lower[a]-.0001;}
          if(hi<distance){distance=hi;axis=a;target=upper[a]+.0001;}
        }
        p[offset+axis]=target;
      }
      return dominant;

    }
  };
}

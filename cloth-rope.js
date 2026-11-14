import * as THREE from 'three';

const SEGMENTS=96,SIDES=8,TAU=Math.PI*2;
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
function radiusAt(radii,angle){
  const t=((angle/TAU)%1+1)%1*SEGMENTS,i=Math.floor(t),f=t-i;
  return radii[i]*(1-f)+radii[(i+1)%SEGMENTS]*f;
}
function makeProfile(collider,height,clearance){
  const y=THREE.MathUtils.lerp(collider.bounds.min.y,collider.bounds.max.y,clamp(height,.03,.97)),hull=collider.crossSection(y);
  const center=new THREE.Vector2();
  if(hull.length<3){const c=collider.bounds.getCenter(new THREE.Vector3());center.set(c.x,c.z);}else for(const p of hull)center.add(new THREE.Vector2(...p).multiplyScalar(1/hull.length));
  const radii=new Float32Array(SEGMENTS);
  for(let i=0;i<SEGMENTS;i++){
    const x=Math.cos(i/SEGMENTS*TAU),z=Math.sin(i/SEGMENTS*TAU);let nearest=Infinity;
    for(let j=0;j<hull.length;j++){
      const a=hull[j],b=hull[(j+1)%hull.length],ex=b[0]-a[0],ez=b[1]-a[1],ax=a[0]-center.x,az=a[1]-center.y,den=x*ez-z*ex;
      if(Math.abs(den)<1e-8)continue;
      const r=(ax*ez-az*ex)/den,t=(ax*z-az*x)/den;
      if(r>=0&&t>=-1e-6&&t<=1.000001)nearest=Math.min(nearest,r);
    }
    radii[i]=(Number.isFinite(nearest)?nearest:.08)+clearance+.065;
  }
  return {y,center,radii};
}
function makeCord(material){
  const geometry=new THREE.BufferGeometry(),positions=new Float32Array((SEGMENTS+1)*SIDES*3),normals=new Float32Array(positions.length),indices=[];
  for(let i=0;i<SEGMENTS;i++)for(let j=0;j<SIDES;j++){
    const a=i*SIDES+j,b=(i+1)*SIDES+j,c=(i+1)*SIDES+(j+1)%SIDES,d=i*SIDES+(j+1)%SIDES;indices.push(a,d,b,b,d,c);
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(indices);
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Cloth binding rope';mesh.castShadow=true;mesh.frustumCulled=false;return mesh;
}

export function createClothRopes({scene,collider,positions,columns,rows,clearance=.055}){
  const group=new THREE.Group();group.name='Cloth ropes';scene.add(group);
  const material=new THREE.MeshStandardMaterial({name:'Braided umber cord',color:0x553c23,roughness:.94});
  const knotGeometry=new THREE.TorusKnotGeometry(.022,.007,32,6,2,3);
  const tailGeometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(.02,-.07,.025),new THREE.Vector3(-.015,-.16,.045)]),12,.007,6,false);
  const records=new Map(),links=[];let ceiling=-Infinity,clock=0,lastWrappedAt=-Infinity;
  let displayPositions=positions,displayColumns=columns,displayRows=rows,displayIndices=null;
  const supportDirections=Array.from({length:SEGMENTS},(_,i)=>[Math.cos(i/SEGMENTS*TAU),Math.sin(i/SEGMENTS*TAU)]);
  for(let z=0;z<=rows;z++)for(let x=0;x<=columns;x++){
    const a=(z*(columns+1)+x)*3;
    if(x<columns)links.push([a,a+3]);if(z<rows)links.push([a,a+(columns+1)*3]);
    if(x<columns&&z<rows)links.push([a+3,a+(columns+1)*3]);
  }
  function crossings(r){
    const attachments=[];
    for(const [a,b] of links){
      const ya=positions[a+1],yb=positions[b+1];
      if((ya-r.y)*(yb-r.y)>0||Math.abs(yb-ya)<1e-8)continue;
      attachments.push({a,b,t:clamp((r.y-ya)/(yb-ya))});
    }
    return attachments;
  }
  function capture(r){
    const attachments=crossings(r),samples=new Float32Array(SEGMENTS),hits=new Uint16Array(SEGMENTS);
    for(const {a,b,t} of attachments){
      const x=positions[a]*(1-t)+positions[b]*t-r.center.x,z=positions[a+2]*(1-t)+positions[b+2]*t-r.center.y,angle=Math.atan2(z,x);
      const index=Math.floor(((angle/TAU+1)%1)*SEGMENTS),radius=Math.hypot(x,z);samples[index]=Math.max(samples[index],radius);hits[index]++;
    }
    if(attachments.length<8)return false;
    r.attachments=attachments;
    // Missing angles interpolate between neighboring material crossings.
    for(let i=0;i<SEGMENTS;i++){
      let left=i,right=i;for(let n=0;n<SEGMENTS&&!hits[left];n++)left=(left+SEGMENTS-1)%SEGMENTS;for(let n=0;n<SEGMENTS&&!hits[right];n++)right=(right+1)%SEGMENTS;
      const span=(right-left+SEGMENTS)%SEGMENTS,f=span?((i-left+SEGMENTS)%SEGMENTS)/span:0;
      r.loose[i]=Math.max(r.radii[i]+.03,THREE.MathUtils.lerp(samples[left],samples[right],f)+.018);r.current[i]=r.loose[i];
    }
    return true;
  }
  function render(surfacePositions,surfaceColumns,surfaceRows,surfaceIndices){
    if(surfacePositions){displayPositions=surfacePositions;displayColumns=surfaceColumns;displayRows=surfaceRows;displayIndices=surfaceIndices??null;}
    for(const r of records.values()){
      if(!r.mesh.visible)continue;
      // The visible cord lies outside all folds at its height, including the
      // finer display surface. A taut rope bridges the pleats' outer envelope.
      const support=new Float64Array(SEGMENTS).fill(-Infinity);
      function include(x,z){for(let i=0;i<SEGMENTS;i++)support[i]=Math.max(support[i],x*supportDirections[i][0]+z*supportDirections[i][1]+.014);}
      for(let i=0;i<SEGMENTS;i++)include(supportDirections[i][0]*r.current[i],supportDirections[i][1]*r.current[i]);
      function edge(a,b){
        const ya=displayPositions[a+1],yb=displayPositions[b+1];if((ya-r.y)*(yb-r.y)>0||Math.abs(yb-ya)<1e-8)return;
        const t=(r.y-ya)/(yb-ya);include(displayPositions[a]*(1-t)+displayPositions[b]*t-r.center.x,displayPositions[a+2]*(1-t)+displayPositions[b+2]*t-r.center.y);
      }
      if(displayIndices){
        for(let i=0;i<displayIndices.length;i+=3){const a=displayIndices[i]*3,b=displayIndices[i+1]*3,c=displayIndices[i+2]*3;edge(a,b);edge(b,c);edge(c,a);}
      }else for(let z=0;z<=displayRows;z++)for(let x=0;x<=displayColumns;x++){
        const a=(z*(displayColumns+1)+x)*3;
        if(x<displayColumns)edge(a,a+3);if(z<displayRows)edge(a,a+(displayColumns+1)*3);
        if(x<displayColumns&&z<displayRows)edge(a+3,a+(displayColumns+1)*3);
      }
      const display=new Float32Array(SEGMENTS);
      for(let i=0;i<SEGMENTS;i++){
        let radius=Infinity;
        for(let j=0;j<SEGMENTS;j++){const dot=supportDirections[i][0]*supportDirections[j][0]+supportDirections[i][1]*supportDirections[j][1];if(dot>1e-6)radius=Math.min(radius,support[j]/dot);}
        display[i]=Math.max(r.current[i],radius);
      }
      r.display=display;
      const p=r.mesh.geometry.attributes.position,n=r.mesh.geometry.attributes.normal;
      for(let i=0;i<=SEGMENTS;i++){
        const angle=i/SEGMENTS*TAU,previous=(i+SEGMENTS-1)%SEGMENTS,next=(i+1)%SEGMENTS;
        const ax=Math.cos(previous/SEGMENTS*TAU)*r.display[previous],az=Math.sin(previous/SEGMENTS*TAU)*r.display[previous],bx=Math.cos(next/SEGMENTS*TAU)*r.display[next],bz=Math.sin(next/SEGMENTS*TAU)*r.display[next];
        const length=Math.hypot(bx-ax,bz-az),nx=(bz-az)/length,nz=-(bx-ax)/length;
        for(let j=0;j<SIDES;j++){
          const turn=j/SIDES*TAU,cos=Math.cos(turn),sin=Math.sin(turn),index=i*SIDES+j,thickness=.011*(1+.06*Math.sin(i*.8+j*2));
          p.setXYZ(index,r.center.x+Math.cos(angle)*r.display[i%SEGMENTS]+nx*cos*thickness,r.y+sin*thickness,r.center.y+Math.sin(angle)*r.display[i%SEGMENTS]+nz*cos*thickness);n.setXYZ(index,nx*cos,sin,nz*cos);
        }
      }
      p.needsUpdate=true;n.needsUpdate=true;
      r.knot.position.set(r.center.x,r.y,r.center.y+radiusAt(r.display,Math.PI/2)+.016);
    }
  }
  return {group,
    get ceiling(){return ceiling;},get active(){for(const r of records.values())if(r.attachments.length)return true;return false;},
    get stats(){return [...records.values()].map(r=>{
      let radius=0,error=0;
      for(const {a,b,t} of r.attachments){const x=positions[a]*(1-t)+positions[b]*t-r.center.x,z=positions[a+2]*(1-t)+positions[b+2]*t-r.center.y;radius+=Math.hypot(x,z);error=Math.max(error,Math.abs(positions[a+1]*(1-t)+positions[b+1]*t-r.y));}
      return {id:r.id,height:r.height,tightness:r.tightness,y:r.y,attachments:r.attachments.length,status:r.status,radius:r.current.reduce((a,b)=>a+b,0)/SEGMENTS,clothRadius:radius/Math.max(1,r.attachments.length),heightError:error};
    });},
    setRopes(settings){
      const wanted=new Set(settings.map(s=>s.id));
      for(const [id,r] of records)if(!wanted.has(id)){r.mesh.geometry.dispose();r.mesh.removeFromParent();r.knot.removeFromParent();records.delete(id);}
      for(const settingsRope of settings){
        const height=clamp(settingsRope.height,.03,.97),tightness=clamp(settingsRope.tightness),existing=records.get(settingsRope.id);
        if(existing&&existing.height===height){
          if(existing.tightness!==tightness){existing.tightness=tightness;existing.readyAt=clock+1;if(existing.attachments.length)existing.status='queued';}
          continue;
        }
        const profile=makeProfile(collider,height,clearance),r=existing??{id:settingsRope.id,mesh:makeCord(material),knot:new THREE.Group()};
        Object.assign(r,profile,{height,tightness,attachments:[],loose:new Float32Array(SEGMENTS),current:new Float32Array(SEGMENTS),waiting:0,status:'waiting',readyAt:Math.max(3.2,clock+1),startedAt:0});
        for(let i=0;i<SEGMENTS;i++)r.current[i]=r.loose[i]=r.radii[i]*1.5+.12;
        if(!existing){const knot=new THREE.Mesh(knotGeometry,material);r.knot.add(knot);for(const side of [-1,1]){const tail=new THREE.Mesh(tailGeometry,material);tail.position.x=side*.012;tail.scale.x=side;r.knot.add(tail);}group.add(r.mesh,r.knot);}
        records.set(r.id,r);r.mesh.visible=false;r.knot.visible=false;
      }
      render();
    },
    advance(dt){
      clock+=dt;
      let wrapping=false;
      for(const r of records.values())if(r.status==='wrapping'){
        if(clock-r.startedAt>=3){r.status='tied';lastWrappedAt=clock;}else wrapping=true;
      }
      for(const r of records.values()){
        if((r.status==='waiting'||r.status==='queued')&&!wrapping&&clock>=r.readyAt&&clock-lastWrappedAt>=.6){
          r.waiting+=dt;
          if(r.status==='queued'||r.waiting>=.1){
            r.waiting=0;
            if(r.attachments.length||capture(r)){
              r.status='wrapping';r.startedAt=clock;wrapping=true;ceiling=Math.max(ceiling,r.y+.16);r.mesh.visible=true;r.knot.visible=true;
            }
          }
        }
        if(r.status!=='wrapping')continue;
        const blend=1-Math.exp(-dt*2);
        for(let i=0;i<SEGMENTS;i++){const target=THREE.MathUtils.lerp(r.loose[i],r.radii[i],r.tightness);r.current[i]+=(target-r.current[i])*blend;}
      }
    },
    solve(){
      for(const r of records.values())for(const {a,b,t} of r.attachments){
        const wa=1-t,wb=t,den=wa*wa+wb*wb,x=positions[a]*wa+positions[b]*wb-r.center.x,z=positions[a+2]*wa+positions[b+2]*wb-r.center.y,y=positions[a+1]*wa+positions[b+1]*wb;
        const length=Math.hypot(x,z),radius=radiusAt(r.current,Math.atan2(z,x))-.014,shrink=length>radius?(radius/length-1)*.85:0,dy=(r.y-y)*.9;
        for(let j=0;j<2;j++){const i=j?b:a,w=(j?wb:wa)/den;positions[i]+=x*shrink*w;positions[i+1]+=dy*w;positions[i+2]+=z*shrink*w;}
      }
    },
    render,
    dispose(){for(const r of records.values())r.mesh.geometry.dispose();records.clear();group.removeFromParent();material.dispose();knotGeometry.dispose();tailGeometry.dispose();}
  };
}

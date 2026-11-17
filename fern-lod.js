import * as THREE from 'three';

// Projected crown size, with a dead band to avoid flicker at LOD boundaries.
// The input is the crown height as a fraction of the viewport height.
export function selectFernLOD(projectedSize,previous=-1){
  const near=.22,far=.035,hysteresis=.15;
  if(previous===0&&projectedSize>=near*(1-hysteresis))return 0;
  if(projectedSize>=near*(previous===1?1+hysteresis:1))return 0;
  if(previous===2&&projectedSize<far*(1+hysteresis))return 2;
  return projectedSize>=far*(previous===1?1-hysteresis:1)?1:2;
}

// Bake the parent into shared canopy meshes. Medium detail retains paired
// pinnules; distant crowns use toothed frond silhouettes along the same rachis.
export function createFernCanopyLODs(fern,floorY){
  const stores=Array.from({length:3},()=>({p:[],n:[],c:[],info:[],part:[]}));
  const point=new THREE.Vector3(),normal=new THREE.Vector3(),color=new THREE.Color();
  const transform=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3();
  const pinnules=Math.max(4,Math.round(7+fern.settings.density*5)),bladesPerPinna=1+pinnules*2;
  let frondIndex=-1;
  function info(store,t,stalk=false){store.info.push(frondIndex+(stalk?.5:0),t);}
  function vertex(store,geometry,index,material){
    store.part.push(geometry.attributes.rachisT?Math.floor(index/48):-1);
    info(store,geometry.attributes.rachisT?geometry.attributes.rachisT.getX(index):Math.floor(index/5)/40,!geometry.attributes.rachisT);
    point.fromBufferAttribute(geometry.attributes.position,index).applyMatrix4(transform);store.p.push(point.x,point.y,point.z);
    normal.fromBufferAttribute(geometry.attributes.normal,index).applyMatrix3(normalMatrix).normalize();store.n.push(normal.x,normal.y,normal.z);
    if(geometry.attributes.color)color.fromBufferAttribute(geometry.attributes.color,index);else color.copy(material.color);
    store.c.push(color.r,color.g,color.b);
  }
  for(const frond of fern.group.children){
    if(frond.name!=='Fern frond')continue;frondIndex++;
    transform.compose(new THREE.Vector3(frond.position.x,frond.position.y-floorY,frond.position.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),frond.rotation.y),new THREE.Vector3(1,1,1));normalMatrix.getNormalMatrix(transform);
    const leaf=frond.getObjectByName('Divided fern foliage'),stem=frond.getObjectByName('Fern rachis');
    for(const child of [leaf,stem]){
      const geometry=child.geometry,index=geometry.index;
      for(let i=0;i<(index?.count??geometry.attributes.position.count);i++)vertex(stores[0],geometry,index?index.getX(i):i,child.material);
    }
    const geometry=leaf.geometry;
    for(let blade=0;blade<geometry.attributes.position.count/48;blade++){
      const local=blade%bladesPerPinna;
      if(local&&Math.floor((local-1)/2)%2)continue;
      for(let segment=0;segment<8;segment+=2){
        const start=blade*48+segment*6,end=start+6;
        for(const index of [start,start+1,end+2,end+2,start+1,end+5])vertex(stores[1],geometry,index,leaf.material);
      }
    }
    // Preserve stem continuity at medium distance without its full round tube.
    const attr=stem.geometry.attributes.position,centers=[];
    for(let row=0;row<=40;row++){
      const center=new THREE.Vector3();for(let side=0;side<4;side++)center.add(new THREE.Vector3().fromBufferAttribute(attr,row*5+side));centers.push(center.multiplyScalar(.25));
    }
    let length=0;for(let i=1;i<centers.length;i++)length+=centers[i].distanceTo(centers[i-1]);
    const base=new THREE.Color().fromBufferAttribute(leaf.geometry.attributes.color,Math.min(100,leaf.geometry.attributes.color.count-1));
    const sample=t=>{const x=THREE.MathUtils.clamp(t,0,1)*40,i=Math.min(39,Math.floor(x));return centers[i].clone().lerp(centers[i+1],x-i);};
    let farPart=0;
    function farVertex(v,t,stalk=false){stores[2].part.push(stalk?-1:farPart);info(stores[2],t,stalk);point.copy(v).applyMatrix4(transform);stores[2].p.push(point.x,point.y,point.z);stores[2].c.push(base.r,base.g,base.b);}
    // Separate pinnae leave real gaps, so the distant mesh does not turn into
    // the solid, star-shaped leaves that looked wrong in dense foregrounds.
    for(let row=0;row<14;row++)for(const side of [-1,1]){
      farPart=row*2+(side<0?0:1);
      const t=.15+row/14*.79,reach=length*.23*Math.pow(Math.sin((t-.13)/.87*Math.PI),.77);
      const root=sample(t),tipT=t+reach*.35/length,tip=sample(tipT).add(new THREE.Vector3(0,0,side*reach));
      const mid=root.clone().lerp(tip,.53),tangent=sample(Math.min(1,t+.025)).sub(root).normalize().multiplyScalar(length*.013*(1-t*.55));
      const a=mid.clone().add(tangent),b=mid.clone().sub(tangent);
      for(const [v,u] of [[root,t],[a,(t+tipT)*.5+.012],[b,(t+tipT)*.5-.012],[a,(t+tipT)*.5+.012],[tip,tipT],[b,(t+tipT)*.5-.012]])farVertex(v,u);
    }
    for(let row=0;row<40;row+=4){
      const a=centers[row],b=centers[row+4],w=.003*length;
      let stemVertex=0;
      for(const v of [a.clone().add(new THREE.Vector3(0,0,w)),a.clone().add(new THREE.Vector3(0,0,-w)),b.clone().add(new THREE.Vector3(0,0,w)),b.clone().add(new THREE.Vector3(0,0,w)),a.clone().add(new THREE.Vector3(0,0,-w)),b.clone().add(new THREE.Vector3(0,0,-w))]){
        stores[1].part.push(-1);info(stores[1],([0,0,1,1,0,1][stemVertex++]?(row+4):row)/40,true);
        point.copy(v).applyMatrix4(transform);stores[1].p.push(point.x,point.y,point.z);stores[1].n.push(0,1,0);stores[1].c.push(stem.material.color.r,stem.material.color.g,stem.material.color.b);
        farVertex(v,([0,0,1,1,0,1][stemVertex-1]?(row+4):row)/40,true);
      }
    }
  }
  return stores.map(store=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(store.p,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(store.c,3));
    if(store.n.length)geometry.setAttribute('normal',new THREE.Float32BufferAttribute(store.n,3));else geometry.computeVertexNormals();
    geometry.setAttribute('fernPart',new THREE.Float32BufferAttribute(store.part,1));geometry.setAttribute('fernInfo',new THREE.Float32BufferAttribute(store.info,2));geometry.computeBoundingSphere();return geometry;
  });
}

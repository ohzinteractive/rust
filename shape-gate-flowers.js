import * as T from 'three';
import {tileRootPressure} from './shape-gate-weathering.js';
import {seededRandom} from './plume-lsystem/random.js';

// Tiny, irregular fleabane-like flowers, with round leaves and wiry stems.
// All plants share one mesh; per-plant roots keep growth and shadows aligned
// with the lifting tile rather than floating above a flat ground plane.
const flowerGrowthGLSL=`
 uniform float flowerAge;
 attribute vec3 flowerRoot;
 attribute float flowerBirth;
 attribute float flowerPetal;
 attribute vec3 flowerPressure;
 attribute vec2 flowerTileDelta;
 vec3 growCrackFlower(vec3 p){
  float growth=smoothstep(flowerBirth,flowerBirth+.34,flowerAge);
  float bloom=smoothstep(flowerBirth+.14,flowerBirth+.43,flowerAge);
  vec3 root=flowerRoot;
  float lifting=smoothstep(.08,.95,flowerAge);
  float layer=.5+.5*sin(-root.z*47.0+root.x*7.0+sin(root.x*4.0)*2.3);
  root.y+=lifting*(flowerPressure.x+dot(flowerTileDelta,flowerPressure.yz))
   -(.006+.022*pow(layer,3.0))*flowerAge;
  return root+(p-flowerRoot)*growth*mix(1.0,bloom,flowerPetal);
 }
`;

export function createCrackFlowers(parent,{tileSize,origin,rootSites,opening,age}){
 const group=new T.Group();group.name='Wildflowers in marble cracks';parent.add(group);
 const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.91,side:T.DoubleSide});
 function deform(shader){
  shader.uniforms.flowerAge=age;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${flowerGrowthGLSL}`)
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=growCrackFlower(transformed);');
 }
 material.onBeforeCompile=deform;
 const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});depth.onBeforeCompile=deform;
 const distance=new T.MeshDistanceMaterial();distance.onBeforeCompile=deform;
 const leafGeometry=new T.CircleGeometry(1,7).rotateX(-Math.PI/2),petalGeometry=new T.SphereGeometry(1,5,3),centerGeometry=new T.SphereGeometry(1,6,3);
 const mesh=new T.Mesh(new T.BufferGeometry(),material);mesh.name='Pink and white crack flowers';
 mesh.castShadow=true;mesh.receiveShadow=true;mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;group.add(mesh);
 let stats={plants:0,pink:0,white:0};
 function rebuild(border=0){
  const positions=[],normals=[],colors=[],roots=[],births=[],petals=[],pressures=[],deltas=[];
  const color=new T.Color(),matrix=new T.Matrix4(),normalMatrix=new T.Matrix3(),point=new T.Vector3(),normal=new T.Vector3();
  stats={plants:0,pink:0,white:0};
  function append(geometry,position,scale,rotation,tone,plant,petal=0){
   matrix.compose(position,new T.Quaternion().setFromEuler(rotation),scale);normalMatrix.getNormalMatrix(matrix);color.set(tone);
   const p=geometry.attributes.position,n=geometry.attributes.normal,index=geometry.index;
   for(let i=0;i<(index?.count??p.count);i++){
    const v=index?index.getX(i):i;
    point.fromBufferAttribute(p,v).applyMatrix4(matrix);normal.fromBufferAttribute(n,v).applyNormalMatrix(normalMatrix);
    positions.push(...point);normals.push(...normal);colors.push(color.r,color.g,color.b);
    roots.push(...plant.root);births.push(plant.birth);petals.push(petal);pressures.push(...plant.pressure);deltas.push(...plant.delta);
   }
  }
  const zero=new T.Euler(),one=new T.Vector3(1,1,1);
  for(let j=-border;j<=7+border;j++)for(let i=-border;i<=10+border;i++){
   const random=seededRandom(61943+i*73856093+j*19349663);
   const edgeX=i===-border?-1:i===10+border?1:0;
   const edgeZ=j===-border?1:j===7+border?-1:0;
   const edge=edgeX!==0||edgeZ!==0;
   if(random()>(edge?.70:.88))continue;
   const seamX=i*tileSize.x-origin.x,seamZ=origin.y-j*tileSize.y;
   const alongX=edgeX?false:edgeZ?true:random()>.5,count=6+Math.floor(random()*7);
   for(let k=0;k<count;k++){
    const travel=(random()-.5)*.88;
    const x=seamX+(alongX?travel:(random()-.5)*.002),z=seamZ+(alongX?(random()-.5)*.002:travel);
    if(Math.abs(x)<opening.x+.09&&Math.abs(z)<opening.y+.10)continue;
    if(Math.abs(x)>origin.x+border*tileSize.x+.001||Math.abs(z)>origin.y+border*tileSize.y+.001)continue;
    if(stats.plants>=1100)continue;
    const root=new T.Vector3(x,-.075,z);
    // Roots begin in the sand, below the higher tile lip, and grow up through the joint.
    const u=(x+origin.x)/tileSize.x,v=(-z+origin.y)/tileSize.y;
    let pressure=new T.Vector3(),delta=new T.Vector2(),highest=-Infinity;
    for(const a of [Math.floor(u-.025),Math.floor(u+.025)])for(const b of [Math.floor(v-.025),Math.floor(v+.025)]){
     const cx=(a+.5)*tileSize.x-origin.x,cy=(b+.5)*tileSize.y-origin.y,p=tileRootPressure(cx,cy,rootSites),d=new T.Vector2(x-cx,-z-cy);
     const h=p.x+d.x*p.y+d.y*p.z;if(h>highest){highest=h;pressure=p;delta=d;}
    }
    const plant={root,pressure,delta,birth:.025+random()*.48};
    const height=.16+random()*.22,leanX=(random()-.5)*.13,leanZ=(random()-.5)*.13;
    const curve=new T.CatmullRomCurve3([root,root.clone().add(new T.Vector3(leanX*.3,height*.48,leanZ*.3)),root.clone().add(new T.Vector3(leanX,height,leanZ))]);
    const stem=new T.TubeGeometry(curve,7,.0013+random()*.0008,4,false);
    append(stem,new T.Vector3(),one,zero,0x657344,plant);stem.dispose();
    const leaves=4+Math.floor(random()*4);
    for(let l=0;l<leaves;l++){
     const t=.08+l/leaves*.68,angle=l*2.399+random()*.6,size=.013+random()*.013;
     const position=curve.getPoint(t).add(new T.Vector3(Math.cos(angle)*size*.7,0,Math.sin(angle)*size*.7));
     append(leafGeometry,position,new T.Vector3(size*.65,.0025,size),new T.Euler((random()-.5)*.6,angle,(random()-.5)*.6),[0x4d632c,0x687a37,0x7f8b49][l%3],plant);
    }
    if(k%2===0){
     const length=.20+random()*.26,sign=random()<.5?-1:1;
     const tip=new T.Vector3(alongX?sign*length:(random()-.5)*.055,.095+random()*.025,alongX?(random()-.5)*.055:sign*length);
     if(edge){tip.x+=edgeX*.32;tip.z+=edgeZ*.32;tip.y=-.06-random()*.15;}
     const runner=new T.CatmullRomCurve3([root,root.clone().add(new T.Vector3(tip.x*.25,edge?.18:.105,tip.z*.25)),root.clone().add(new T.Vector3(tip.x*.65,edge?.20:.11,tip.z*.65)),root.clone().add(tip)]);
     const vine=new T.TubeGeometry(runner,10,.0025,4,false);
     append(vine,new T.Vector3(),one,zero,0x556633,plant);vine.dispose();
     for(let l=0;l<12;l++){
      const t=.12+l/14,angle=l*2.399+random()*.4,size=.021+random()*.015;
      const p=runner.getPoint(t).add(new T.Vector3(Math.cos(angle)*size*.6,.002,Math.sin(angle)*size*.6));
      append(leafGeometry,p,new T.Vector3(size*.72,.003,size),new T.Euler((random()-.5)*.65,angle,(random()-.5)*.5),[0x3f582b,0x5a7134,0x748542][l%3],plant);
     }
    }
    const head=curve.getPoint(1),pink=random()<.54,size=.020+random()*.018,petalCount=5+Math.floor(random()*4);
    const tone=pink?[0xb95874,0xcf8191,0xdf9ba7][Math.floor(random()*3)]:[0xf2edda,0xe9e6d4,0xfff6e5][Math.floor(random()*3)];
    for(let l=0;l<petalCount;l++){
     const angle=l/petalCount*Math.PI*2;
     const p=head.clone().add(new T.Vector3(Math.cos(angle)*size*.62,.001+random()*.004,Math.sin(angle)*size*.62));
     append(petalGeometry,p,new T.Vector3(size*.54,.0025,size*.31),new T.Euler(0,-angle,(random()-.5)*.3),tone,plant,1);
    }
    append(centerGeometry,head.clone().add(new T.Vector3(0,.004,0)),new T.Vector3(size*.28,.005,size*.28),zero,pink?0xb59542:0xc5a742,plant,1);
    stats.plants++;stats[pink?'pink':'white']++;
   }
  }
  const geometry=new T.BufferGeometry();
  for(const [name,array,size] of [['position',positions,3],['normal',normals,3],['color',colors,3],['flowerRoot',roots,3],['flowerBirth',births,1],['flowerPetal',petals,1],['flowerPressure',pressures,3],['flowerTileDelta',deltas,2]])geometry.setAttribute(name,new T.Float32BufferAttribute(array,size));
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.35;
  mesh.geometry.dispose();mesh.geometry=geometry;
 }
 function advance(){group.visible=age.value>.025;}
 rebuild();advance();
 return {group,rebuild,advance,get stats(){return {...stats};},dispose(){mesh.geometry.dispose();for(const g of [leafGeometry,petalGeometry,centerGeometry])g.dispose();for(const m of [material,depth,distance])m.dispose();group.removeFromParent();}};
}

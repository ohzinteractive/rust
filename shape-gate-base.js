import * as T from 'three';
import {gateBevel,gateDepth} from './shape-gate-aperture.js';
import {gateRimDepth,gateRimInnerRadius,gateRimRadius} from './shape-gate-geometry.js';
import {createMarbleBorderMaterial,createPolishedMarbleFloor} from './shape-gate-floor.js';
import {metalPresets} from './metal-presets.js';
import {seededRandom} from './plume-lsystem/random.js';

const sideOffset = gateRimDepth / 2 + .105;
const endOffset = gateRimRadius + .125;
const channelWidth = .136;
const platformHeight = .22;
const rimHeight = .07;

export function createGateFloor(){
 const halfLength=endOffset+.025, halfWidth=sideOffset+.025;
 // The aluminum frame spans eight columns and one centered row.
 const frameColumns=8, columns=frameColumns+2, rows=7;
 const tileSize=new T.Vector2(2*(endOffset+channelWidth)/frameColumns,2*(sideOffset+channelWidth));
 const rimWidth=tileSize.clone().multiplyScalar(1/3);
 const tileHalfLength=columns*tileSize.x/2, tileHalfWidth=rows*tileSize.y/2;
 const rectangle=(x,y)=>[new T.Vector2(-x,-y),new T.Vector2(x,-y),new T.Vector2(x,y),new T.Vector2(-x,y)];
 function surfaceWithOpening(x,y,openingX,openingY){
  const shape=new T.Shape(rectangle(x,y));
  shape.holes.push(new T.Path(rectangle(openingX,openingY).reverse()));
  return shape;
 }
 const surround=(x,y)=>new T.ShapeGeometry(surfaceWithOpening(50,50,x+rimWidth.x,y+rimWidth.y))
  .rotateX(-Math.PI/2).translate(0,-platformHeight,0);
 const tiles=(x,y)=>surfaceWithOpening(x,y,halfLength,halfWidth);
 function platformEdge(x,y){
  const bevel=.012;
  // The outer marble runs from the tile joints to the beveled fascia.
  const shape=surfaceWithOpening(x+rimWidth.x,y+rimWidth.y,x,y);
  const geometry=new T.ExtrudeGeometry(shape,{
   depth:platformHeight+rimHeight-2*bevel,bevelEnabled:true,
   bevelSize:bevel,bevelThickness:bevel,bevelSegments:2
  });
  return geometry.rotateX(-Math.PI/2).translate(0,bevel-platformHeight,0);
 }
 const floor=new T.Mesh(surround(tileHalfLength,tileHalfWidth),new T.MeshStandardMaterial({color:0xb3a08a,roughness:.9}));
 floor.receiveShadow=true;
 const marble=createPolishedMarbleFloor(tiles(tileHalfLength,tileHalfWidth),tileSize,tileHalfLength,tileHalfWidth);
 const edge=new T.Mesh(platformEdge(tileHalfLength,tileHalfWidth),createMarbleBorderMaterial());
 edge.name='Beveled platform edge';
 edge.castShadow=true;
 edge.receiveShadow=true;
 floor.add(marble,edge);

 const depth=gateRimRadius+.12;
 const well=new T.BoxGeometry(2*halfLength,depth,2*halfWidth);
 // Leave the positive-Y face open under the brush seal.
 const {start,count}=well.groups[2];
 well.setIndex(new T.BufferAttribute(well.index.array.filter((_,i)=>i<start||i>=start+count),1));
 well.clearGroups();
 const lining=new T.Mesh(well,new T.MeshStandardMaterial({color:0x222525,roughness:.92,side:T.BackSide}));
 lining.position.y=-depth/2;
 lining.receiveShadow=true;
 floor.add(lining);

 let expansion=0;
 function resize(border){
  const size={columns:columns+2*border,rows:rows+2*border};
  if(border===expansion)return size;
  const x=size.columns*tileSize.x/2, y=size.rows*tileSize.y/2;
  const groundGeometry=surround(x,y), tileGeometry=new T.ShapeGeometry(tiles(x,y)), edgeGeometry=platformEdge(x,y);
  floor.geometry.dispose();
  marble.geometry.dispose();
  edge.geometry.dispose();
  floor.geometry=groundGeometry;
  // Keep the tile origin and reflection target fixed as tiles are added.
  marble.geometry=tileGeometry;
  edge.geometry=edgeGeometry;
  expansion=border;
  return size;
 }
 return {floor,resize};
}

function createChannel(length){
 // Cross-section of the aluminum channel. The opening faces the bristles.
 const profile = [
  [0,.008],[.125,.008],[channelWidth,.019],[channelWidth,.135],[.126,.145],
  [.098,.145],[.098,.113],[.008,.113],[0,.105],[0,.085],
  [.039,.085],[.039,.047],[0,.047]
 ];
 const path = new T.Shape(profile.map(([z,y])=>new T.Vector2(-z,y)));
 const geometry = new T.ExtrudeGeometry(path,{depth:length,bevelEnabled:false});
 geometry.rotateY(Math.PI/2).translate(-length/2,0,0);
 const position = geometry.attributes.position;
 // The two cuts meet the adjacent channel at 45 degrees.
 for(let i=0;i<position.count;i++){
  const x=position.getX(i);
  position.setX(i,x+Math.sign(x)*position.getZ(i));
 }
 geometry.computeVertexNormals();
 return geometry;
}

function createBristles(length,reach,seed,sampleAt){
 const random = seededRandom(seed);
 const positions=[],colors=[],indices=[],brushData=[];
 const count=Math.ceil(length/.0045), spacing=length/count;
 for(const rootHeight of [.052,.066,.080])for(let i=0;i<count;i++){
  const x=-length/2+(i+.12+random()*.76)*spacing;
  const width=.002+random()*.0015, lean=(random()-.5)*.026;
  const drop=.012+random()*.019, tip=-reach(x)+random()*.012;
  const root=.038, middle=T.MathUtils.lerp(root,tip,.53);
  const start=positions.length/3;
  positions.push(
   x-width,rootHeight,root, x+width,rootHeight,root,
   x+lean*.4-width*.7,rootHeight-drop*.4,middle, x+lean*.4+width*.7,rootHeight-drop*.4,middle,
   x+lean,rootHeight-drop,tip
  );
  const shade=.004+random()*.016;
  const sampleX=sampleAt(x+lean), phase=random()*Math.PI*2;
  for(const weight of [0,0,.30,.30,1]){
   colors.push(shade*.83,shade*.92,shade);
   brushData.push(sampleX,weight,phase);
  }
  indices.push(start,start+2,start+1,start+1,start+2,start+3,start+2,start+4,start+3);
 }
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
 geometry.setAttribute('brushData',new T.Float32BufferAttribute(brushData,3));
 geometry.setIndex(indices);
 geometry.computeVertexNormals();
 geometry.computeBoundingSphere();
 geometry.boundingSphere.radius+=.07;
 return geometry;
}

// Scan the wheel at bristle height, including the rotating cutout and rim gap.
function sectionEdges(contours,cos,sin){
 const edges=[];
 const height=.06;
 for(const points of contours)for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];
  const ay=a.x*sin+a.y*cos,by=b.x*sin+b.y*cos;
  if((ay>height)===(by>height))continue;
  const t=(height-ay)/(by-ay);
  edges.push(T.MathUtils.lerp(a.x,b.x,t)*cos-T.MathUtils.lerp(a.y,b.y,t)*sin);
 }
 return edges.sort((a,b)=>a-b);
}

function createBrushMotion(material){
 const samples=256, span=2*endOffset;
 const values=new Uint8Array(samples), deflection=new Float32Array(samples);
 const map=new T.DataTexture(values,samples,1,T.RedFormat);
 map.magFilter=map.minFilter=T.LinearFilter;
 map.needsUpdate=true;
 const angle={value:0};
 material.onBeforeCompile=shader=>{
  shader.uniforms.brushContact={value:map};
  shader.uniforms.brushAngle=angle;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
   attribute vec3 brushData;
   uniform sampler2D brushContact;
   uniform float brushAngle;
  `).replace('#include <begin_vertex>',`#include <begin_vertex>
   float x=brushData.x;
   float flex=brushData.y*texture2D(brushContact,vec2(x/${span.toFixed(6)}+.5,.5)).r;
   float flutter=sin(brushAngle*32.0-x*23.0+brushData.z);
   float drag=clamp(x/.75,-1.0,1.0);
   transformed.y=max(.006,transformed.y+flex*(drag*.045+flutter*.012));
   transformed.z+=flex*(.019+flutter*.005);
  `);
 };
 const outlines=new WeakMap();
 function contour(geometry){
  if(!outlines.has(geometry)){
   const {shapes,options}=geometry.parameters;
   const {shape,holes}=shapes.extractPoints(options.curveSegments??12);
   outlines.set(geometry,[shape,...holes]);
  }
  return outlines.get(geometry);
 }
 let previousAngle;
 return (gate,dt)=>{
  const rotation=gate.rotation.z;
  const speed=previousAngle===undefined||dt<=0?0:Math.max(0,(rotation-previousAngle)/dt);
  previousAngle=rotation;
  angle.value=rotation;
  const drive=speed/(speed+.18);
  const cos=Math.cos(rotation),sin=Math.sin(rotation);
  const body=drive>0?sectionEdges(contour(gate.geometry),cos,sin):[];
  const rim=drive>0?sectionEdges(contour(gate.children[0].geometry),cos,sin):[];
  const spring=1-Math.exp(-dt*15);
  let bodyEdge=0,rimEdge=0,changed=false;
  for(let i=0;i<samples;i++){
   const x=(i+.5)*span/samples-endOffset;
   while(bodyEdge<body.length&&body[bodyEdge]<x)bodyEdge++;
   while(rimEdge<rim.length&&rim[rimEdge]<x)rimEdge++;
   const contact=bodyEdge%2||rimEdge%2;
   deflection[i]+=((contact?drive:0)-deflection[i])*spring;
   const value=Math.round(deflection[i]*255);
   if(value!==values[i]){
    values[i]=value;
    changed=true;
   }
  }
  if(changed)map.needsUpdate=true;
 };
}

export function createGateBaseSeal(){
 const seal=new T.Group();
 seal.name='Brush seal';
 const aluminum=new T.MeshStandardMaterial({color:metalPresets.aluminum.colors.metal,metalness:.48,roughness:.31});
 const nylon=new T.MeshStandardMaterial({vertexColors:true,roughness:.88,side:T.DoubleSide});
 const update=createBrushMotion(nylon);
 const faceClearance=gateDepth/2+gateBevel+.012;
 const rimClearance=gateRimDepth/2+.010;
 const sideReach=x=>{
  const rim=T.MathUtils.smoothstep(Math.abs(x),gateRimInnerRadius-.14,gateRimInnerRadius-.025);
  return sideOffset-T.MathUtils.lerp(faceClearance,rimClearance,rim);
 };
 const endReach=()=>endOffset-gateRimRadius-.012;
 const sides=[
  [0,sideOffset,0,2*endOffset,sideReach],
  [0,-sideOffset,Math.PI,2*endOffset,sideReach],
  [endOffset,0,Math.PI/2,2*sideOffset,endReach],
  [-endOffset,0,-Math.PI/2,2*sideOffset,endReach]
 ];
 for(const [i,[x,z,angle,length,reach]] of sides.entries()){
  const strip=new T.Group();
  strip.position.set(x,0,z);
  strip.rotation.y=angle;
  const rail=new T.Mesh(createChannel(length-.006),aluminum);
  rail.castShadow=true;
  rail.receiveShadow=true;
  const sampleAt=localX=>T.MathUtils.clamp(x+Math.cos(angle)*localX,-gateRimRadius+.04,gateRimRadius-.04);
  const bristles=new T.Mesh(createBristles(length-.016,reach,217+i,sampleAt),nylon);
  bristles.receiveShadow=true;
  strip.add(rail,bristles);
  seal.add(strip);
 }
 return {seal,update};
}

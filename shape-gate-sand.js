import * as T from 'three';
import {addWindShapedSand} from './desert-sand.js';
import {createRootedTileGeometry,tileDisplacementGLSL,gateSandInset} from './shape-gate-weathering.js';

// A continuous sand substrate, with solid sides beneath each displaced tile.
// The extra depth fills the raised steps instead of leaving hollow black slots.
export function createGateSand(shape,tileSize,origin,sites,age){
 const geometryFor=shape=>{
  const geometry=createRootedTileGeometry(shape,tileSize,origin,sites,{jointInset:0,slabDepth:.36,closeBottom:false});
  geometry.translate(0,0,-gateSandInset);
  return geometry;
 };
 const material=addWindShapedSand(new T.MeshStandardMaterial({name:'Sand packed into marble joints',color:0xbca379,roughness:1}));
 const compileSand=material.onBeforeCompile;
 function displace(shader){
  shader.uniforms.stoneAge=age;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${tileDisplacementGLSL}`)
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=liftMarbleTile(transformed);');
 }
 material.onBeforeCompile=shader=>{
  compileSand(shader);displace(shader);
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   vec2 grainCell=floor(vSandWorld.xz*310.0);
   float grain=fract(sin(dot(grainCell,vec2(127.1,311.7)))*43758.5453);
   float resolvedGrain=1.0-smoothstep(.35,1.5,length(fwidth(vSandWorld.xz*310.0)));
   diffuseColor.rgb*=1.0+(grain-.5)*.24*resolvedGrain;
  `);
 };
 material.customProgramCacheKey=()=> 'gate-packed-sand-v1';
 const sand=new T.Mesh(geometryFor(shape),material);
 sand.name='Sand filling lifted marble gaps';sand.rotation.x=-Math.PI/2;
 sand.castShadow=true;sand.receiveShadow=true;
 const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});depth.onBeforeCompile=displace;sand.customDepthMaterial=depth;
 const distance=new T.MeshDistanceMaterial();distance.onBeforeCompile=displace;sand.customDistanceMaterial=distance;
 return {mesh:sand,resize(shape){sand.geometry.dispose();sand.geometry=geometryFor(shape);}};
}

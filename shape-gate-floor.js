import * as T from 'three';
import {Reflector} from './vendor/Reflector.js';
import {marbleNoiseGLSL} from './kelp-marble.js';

const polishedMarbleGLSL=`
 ${marbleNoiseGLSL}
 vec3 sampleBlackMarble(vec3 stone,float aa){
  vec3 field=stone*vec3(.72,1.38,.96)+1.45*vec3(
   marbleFbm(stone*.84+4.1),marbleFbm(stone*.92+18.3),marbleNoise(stone-12.6)
  );
  float cloud=marbleFbm(stone*.67+9.2);
  float fault=marbleFbm(field*1.35)-.48;
  float presence=smoothstep(.28,.63,marbleNoise(field*.56+20.8));
  float mainVein=(1.0-smoothstep(.004,.016+aa,abs(fault)))*presence;
  float branch=abs(marbleFbm(field*2.4+7.8)-.51);
  float fineVeins=(1.0-smoothstep(.003,.009+aa,branch))*(1.0-smoothstep(.04,.22,abs(fault)));
  vec3 charcoal=mix(vec3(.009,.011,.014),vec3(.047,.052,.056),smoothstep(.18,.72,cloud));
  charcoal=mix(charcoal,vec3(.12,.13,.135),.28*(1.0-smoothstep(.008,.065,abs(fault)))*presence);
  return mix(charcoal,vec3(.57,.56,.53),min(.78,.73*mainVein+.19*fineVeins));
 }

 vec3 sampleWhiteMarble(vec3 stone,float aa){
  float cloud=marbleFbm(stone*.61+6.4);
  float warp=marbleFbm(stone*vec3(.57,.8,.75)+15.9);
  float ripple=marbleNoise(stone*1.9+27.2)-.5;
  float strata=dot(stone.xy,vec2(.44,-.64))+warp*1.72+ripple*.115+stone.z*.21;
  float seam=abs(fract(strata+.5)-.5);
  float ribbon=1.0-smoothstep(.028,.148+aa,seam);
  float thread=1.0-smoothstep(.006,.028+aa,abs(seam-.036-ripple*.034));
  float density=mix(.5,1.0,smoothstep(.18,.70,cloud));
  vec3 ivory=mix(vec3(.58,.609,.61),vec3(.93,.915,.86),smoothstep(.16,.71,cloud));
  ivory=mix(ivory,vec3(.30,.34,.36),ribbon*density*.58);
  return mix(ivory,vec3(.265,.30,.32),thread*ribbon*density*.38);
 }
`;

export function createMarbleBorderMaterial(){
 const material=new T.MeshPhysicalMaterial({name:'Dark marble border',roughness:.28,clearcoat:.3,clearcoatRoughness:.22});
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
   varying vec3 vBorderStone;
  `).replace('#include <begin_vertex>',`#include <begin_vertex>
   vBorderStone=position*3.3+vec3(12.4,8.1,16.7);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vBorderStone;
   ${polishedMarbleGLSL}
  `).replace('#include <color_fragment>',`#include <color_fragment>
   float borderAA=clamp(length(fwidth(vBorderStone))*.22,.002,.025);
   diffuseColor.rgb*=sampleBlackMarble(vBorderStone,borderAA);
  `);
 };
 return material;
}

export function createPolishedMarbleFloor(shape,tileSize,halfLength,halfWidth,{resolution=640,updateInterval=0}={}){
 const floor=new Reflector(new T.ShapeGeometry(shape),{
  textureWidth:resolution,textureHeight:resolution,multisample:0,clipBias:.0005
 });
 floor.name='Polished marble tiles';
 floor.rotation.x=-Math.PI/2;
 floor.receiveShadow=true;
 floor.getRenderTarget().isPlanarReflection=true;
 const planarReflection={value:1};
 const renderPlanarReflection=floor.onBeforeRender;
 const reflectedView=new T.Matrix4(),reflectedProjection=new T.Matrix4(),reflectedFloor=new T.Matrix4();
 let reflectedAt=-Infinity;
 floor.onBeforeRender=(renderer,scene,camera)=>{
  const target=renderer.getRenderTarget();
  // Reflections see the tiles directly, without starting another capture.
  const capturing=target?.isWebGLCubeRenderTarget||target?.isPlanarReflection;
  planarReflection.value=capturing?0:1;
  if(capturing)return;
  const now=performance.now();
  if(now-reflectedAt<updateInterval&&reflectedView.equals(camera.matrixWorld)&&
     reflectedProjection.equals(camera.projectionMatrix)&&reflectedFloor.equals(floor.matrixWorld))return;
  renderPlanarReflection.call(floor,renderer,scene,camera);
  reflectedAt=now;
  reflectedView.copy(camera.matrixWorld);
  reflectedProjection.copy(camera.projectionMatrix);
  reflectedFloor.copy(floor.matrixWorld);
 };

 const {tDiffuse,textureMatrix}=floor.material.uniforms;
 floor.material.dispose();
 const material=new T.MeshPhysicalMaterial({color:0xffffff,roughness:.24,clearcoat:.32,clearcoatRoughness:.19});
 material.onBeforeCompile=shader=>{
  shader.uniforms.floorMirror=tDiffuse;
  shader.uniforms.floorMirrorMatrix=textureMatrix;
  shader.uniforms.floorPlanarReflection=planarReflection;
  shader.uniforms.floorTileOrigin={value:new T.Vector2(halfLength,halfWidth)};
  shader.uniforms.floorTileSize={value:tileSize};
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
   uniform mat4 floorMirrorMatrix;
   varying vec4 vFloorMirror;
   varying vec2 vTilePoint;
  `).replace('#include <project_vertex>',`#include <project_vertex>
   vFloorMirror=floorMirrorMatrix*vec4(transformed,1.0);
   vTilePoint=position.xy;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
   uniform sampler2D floorMirror;
   uniform float floorPlanarReflection;
   uniform vec2 floorTileOrigin;
   uniform vec2 floorTileSize;
   varying vec4 vFloorMirror;
   varying vec2 vTilePoint;
   ${polishedMarbleGLSL}
  `).replace('#include <color_fragment>',`#include <color_fragment>
   vec2 tileUV=(vTilePoint+floorTileOrigin)/floorTileSize;
   vec2 tile=floor(tileUV);
   vec2 local=fract(tileUV);
   float darkTile=mod(tile.x+tile.y,2.0);
   float tileSeed=marbleHash(vec3(tile,24.3));
   float angle=floor(tileSeed*4.0)*1.5707963;
   vec2 cut=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*(local-.5);
   vec3 stone=vec3(cut*vec2(2.65,3.2),tileSeed*24.0)+vec3(tileSeed*7.0,0.0,0.0);
   float stoneAA=clamp(length(fwidth(vTilePoint))*.75,.002,.025);
   vec3 stoneColor=darkTile>.5?sampleBlackMarble(stone,stoneAA):sampleWhiteMarble(stone,stoneAA);
   vec2 edge=min(local,1.0-local);
   float seamDistance=min(edge.x,edge.y);
   float jointAA=clamp(fwidth(seamDistance)*.6,.001,.018);
   float joint=1.0-smoothstep(.004,.004+jointAA,seamDistance);
   diffuseColor.rgb=mix(stoneColor,vec3(.095,.091,.084),joint);
  `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   roughnessFactor=mix(mix(.25,.19,darkTile),.8,joint);
  `).replace('#include <opaque_fragment>',`
   if(floorPlanarReflection>.5){
    vec2 mirrorUV=vFloorMirror.xy/vFloorMirror.w;
    vec2 blur=vec2(mix(1.65,1.2,darkTile)/${resolution.toFixed(1)});
    vec3 reflection=texture2D(floorMirror,mirrorUV).rgb*.40;
    reflection+=.15*(texture2D(floorMirror,mirrorUV+vec2(blur.x,0.0)).rgb+
     texture2D(floorMirror,mirrorUV-vec2(blur.x,0.0)).rgb+
     texture2D(floorMirror,mirrorUV+vec2(0.0,blur.y)).rgb+
     texture2D(floorMirror,mirrorUV-vec2(0.0,blur.y)).rgb);
    float facing=clamp(dot(normal,normalize(vViewPosition)),0.0,1.0);
    float sheen=(mix(.16,.145,darkTile)+.23*pow(1.0-facing,3.0))*(1.0-joint*.9);
    outgoingLight=mix(outgoingLight,reflection,sheen);
   }
   #include <opaque_fragment>
  `);
 };
 floor.material=material;
 return floor;
}

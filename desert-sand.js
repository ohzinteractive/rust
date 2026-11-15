// Fine relief uses world coordinates so the large desert plane and the local
// dune mesh meet without a texture seam. Derivative filtering prevents distant
// ripple patterns from flickering as the camera moves.
export function addWindShapedSand(material){
  material.customProgramCacheKey=()=> 'desert-wind-sand-v1';
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSandWorld;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvSandWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vSandWorld;
      float sandPhase(vec2 p){return dot(p,vec2(.92,.38))*52.0+1.4*sin(dot(p,vec2(-.38,.92))*.9)+.3*sin(p.x*2.0+p.y*.7);}
      float sandTrail(vec2 p){
        float t=clamp((p.y-6.0)/9.0,0.0,1.0),path=-4.0-3.0*t+1.1*sin(t*3.14159265);
        return exp(-pow((p.x-path)/(.22+t*.08),2.0))*smoothstep(5.8,7.0,p.y)*(1.0-smoothstep(13.0,15.5,p.y));
      }`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        float ripplePhase=sandPhase(vSandWorld.xz);
        float rippleFilter=1.0-smoothstep(.65,2.6,fwidth(ripplePhase));
        float rippleCrest=pow(.5+.5*sin(ripplePhase),3.0),trail=sandTrail(vSandWorld.xz);
        diffuseColor.rgb*=1.0+(.025-rippleCrest*.085)*rippleFilter*(1.0-trail*.8)-trail*.045;
        float sandRelief=rippleCrest*.004*rippleFilter*(1.0-trail*.75);`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 sandDx=dFdx(-vViewPosition),sandDy=dFdy(-vViewPosition);
        vec3 sandR1=cross(sandDy,normal),sandR2=cross(normal,sandDx);
        float sandDet=dot(sandDx,sandR1);
        normal=normalize(abs(sandDet)*normal-sign(sandDet)*(dFdx(sandRelief)*sandR1+dFdy(sandRelief)*sandR2));`);
  };
  return material;
}

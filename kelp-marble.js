import * as THREE from 'three';
import {configureKelpSunlight} from './kelp-lighting.js';

// Weld positions for the cavity estimate without changing the sculpture's
// smooth normals or topology. Concave edges collect more dirt than ridges.
export function prepareMarbleGeometry(geometry,coordinateBounds){
  geometry.computeBoundingBox();
  const p=geometry.attributes.position,box=coordinateBounds??geometry.boundingBox;
  const span=box.getSize(new THREE.Vector3()),extent=Math.max(span.x,span.y,span.z,1e-6);
  const center=box.getCenter(new THREE.Vector3()),nodes=[],lookup=new Map(),ids=[];
  const coords=new Float32Array(p.count*3),cavity=new Float32Array(p.count);
  for(let i=0;i<p.count;i++){
    const position=new THREE.Vector3().fromBufferAttribute(p,i).sub(center).divideScalar(extent);
    position.toArray(coords,i*3);
    const key=[position.x,position.y,position.z].map(v=>Math.round(v*1e5)).join(',');
    if(!lookup.has(key)){lookup.set(key,nodes.length);nodes.push({position,neighbors:new Set()});}
    ids.push(lookup.get(key));
  }
  const index=geometry.index,count=index?.count??p.count,ab=new THREE.Vector3(),ac=new THREE.Vector3(),face=new THREE.Vector3(),edges=new Map();
  for(const node of nodes)node.cavity=0;
  for(let i=0;i<count;i+=3){
    const tri=[0,1,2].map(j=>ids[index?index.getX(i+j):i+j]);
    if(tri.some(id=>id===undefined))continue;
    ab.subVectors(nodes[tri[1]].position,nodes[tri[0]].position);
    ac.subVectors(nodes[tri[2]].position,nodes[tri[0]].position);face.crossVectors(ab,ac).normalize();
    for(let j=0;j<3;j++){
      const a=tri[j],b=tri[(j+1)%3],opposite=tri[(j+2)%3],key=a<b?`${a},${b}`:`${b},${a}`;
      nodes[a].neighbors.add(b);nodes[b].neighbors.add(a);
      const previous=edges.get(key);
      if(previous){
        ab.subVectors(nodes[opposite].position,nodes[a].position).normalize();
        ac.subVectors(nodes[previous.opposite].position,nodes[a].position).normalize();
        const fold=Math.max(ab.dot(previous.normal),ac.dot(face));
        const value=THREE.MathUtils.smoothstep(fold,.025,.5);
        nodes[a].cavity=Math.max(nodes[a].cavity,value);nodes[b].cavity=Math.max(nodes[b].cavity,value);
      }else edges.set(key,{normal:face.clone(),opposite});
    }
  }
  // Blur the deposit mask over the welded surface so stains do not reveal
  // individual triangles. Crease shading remains a small ambient contribution.
  for(let pass=0;pass<3;pass++){
    const next=nodes.map(node=>{
      let sum=0;for(const id of node.neighbors)sum+=nodes[id].cavity;
      return node.cavity*.45+sum/Math.max(1,node.neighbors.size)*.55;
    });
    nodes.forEach((node,i)=>{node.cavity=next[i];});
  }
  for(let i=0;i<p.count;i++)cavity[i]=nodes[ids[i]].cavity;
  geometry.setAttribute('marblePosition',new THREE.BufferAttribute(coords,3));
  geometry.setAttribute('marbleCavity',new THREE.BufferAttribute(cavity,1));
}

export const marbleNoiseGLSL=`
  float marbleHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
  float marbleNoise(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.0-15.0)+10.0);
    return mix(mix(mix(marbleHash(i),marbleHash(i+vec3(1,0,0)),f.x),
      mix(marbleHash(i+vec3(0,1,0)),marbleHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(marbleHash(i+vec3(0,0,1)),marbleHash(i+vec3(1,0,1)),f.x),
      mix(marbleHash(i+vec3(0,1,1)),marbleHash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  float marbleFractureDistance(vec3 p){
    vec3 cell=floor(p),local=fract(p);float nearest=100.0,second=100.0;
    for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec3 offset=vec3(float(x),float(y),float(z)),id=cell+offset;
      vec3 feature=.15+.7*vec3(marbleHash(id+7.0),marbleHash(id+19.0),marbleHash(id+31.0));
      vec3 delta=offset+feature-local;float distanceSquared=dot(delta,delta);
      if(distanceSquared<nearest){second=nearest;nearest=distanceSquared;}else second=min(second,distanceSquared);
    }
    return sqrt(second)-sqrt(nearest);
  }
  float marbleFbm(vec3 p){
    float value=0.0,weight=.53;
    for(int i=0;i<4;i++){value+=weight*marbleNoise(p);p=p*2.03+vec3(4.3,1.7,8.2);weight*=.48;}
    return value;
  }
`;

export function createUnderwaterMarbleMaterial(sunlight){
  return createMarbleMaterial(sunlight);
}

export function createMarbleMaterial(sunlight=null){
  const material=new THREE.MeshPhysicalMaterial({name:sunlight?'Weathered underwater marble':'Weathered marble',color:0xc9cec4,roughness:.32,metalness:0,ior:1.46,specularIntensity:.7,clearcoat:.28,clearcoatRoughness:.2,envMapIntensity:.75,shadowSide:THREE.DoubleSide});
  if(sunlight)configureKelpSunlight(material,sunlight,.65);
  const compileSunlight=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    compileSunlight(shader);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec3 marblePosition;attribute float marbleCavity;
      varying vec3 vMarblePosition;varying float vMarbleCavity;
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      vMarblePosition=marblePosition;vMarbleCavity=marbleCavity;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vMarblePosition;varying float vMarbleCavity;
      ${marbleNoiseGLSL}
    `).replace('#include <color_fragment>',`#include <color_fragment>
      // Volumetric mineral clouds and irregular seams, sampled in object space.
      // Mineral veins stay within the stone; sparse open fissures and pores add relief.
      vec3 marbleP=vMarblePosition*5.0;
      vec3 marbleWarp=vec3(marbleFbm(marbleP+3.7),marbleFbm(marbleP+17.2),marbleFbm(marbleP-8.4));
      vec3 mineralP=marbleP*vec3(.85,1.25,.75)+marbleWarp*2.4;
      float marbleCloud=marbleFbm(mineralP*.85+vec3(3.7,8.1,2.4));
      float seamField=marbleFbm(mineralP*1.7+marbleWarp);
      float seamDistance=abs(seamField-.48);
      float seamAA=max(fwidth(seamField),.001);
      float seamWidth=mix(.004,.015,marbleNoise(mineralP*2.1+23.0));
      float marbleVein=(1.0-smoothstep(seamWidth,seamWidth+seamAA*1.8,seamDistance));
      float marbleSoftVein=1.0-smoothstep(.015,.075,seamDistance);
      float veinBreakup=smoothstep(.27,.64,marbleNoise(mineralP*.75-7.0));
      marbleVein*=veinBreakup;
      float marbleCavity=smoothstep(.08,.72,vMarbleCavity);
      float marbleStain=smoothstep(.49,.69,marbleFbm(marbleP*2.1+vec3(19.0,2.0,7.0)));
      float marbleBase=1.0-smoothstep(-.48,-.32,vMarblePosition.y);
      float marbleDirt=clamp(marbleStain*(.22+marbleCavity*.28)+marbleCavity*.23+marbleBase*(.06+marbleCloud*.18),0.0,.62);
      vec3 marbleTone=mix(vec3(.83,.88,.85),vec3(1.04,1.01,.94),smoothstep(.22,.74,marbleCloud));
      marbleTone=mix(marbleTone,vec3(.57,.64,.61),marbleSoftVein*.12+marbleVein*.20);
      diffuseColor.rgb*=mix(marbleTone,vec3(.12,.18,.13),marbleDirt);
      // Sparse weathering on top of the mineral body: irregular fractures,
      // crumbled rims, warm inclusions and pores rather than etched vein lines.
      float fractureDistance=marbleFractureDistance(vMarblePosition*3.2+marbleWarp*.23+vec3(11.3,4.8,23.1));
      float fractureAA=max(fwidth(fractureDistance),.001);
      float fractureWidth=mix(.006,.018,marbleNoise(marbleP*2.2+41.0));
      float fractureRegion=smoothstep(.38,.66,marbleNoise(marbleP*.7+7.0));
      float marbleFracture=(1.0-smoothstep(fractureWidth,fractureWidth+fractureAA*1.5,fractureDistance))*fractureRegion;
      float fractureRim=(1.0-smoothstep(fractureWidth+.004,fractureWidth+.038+fractureAA,fractureDistance))*fractureRegion;
      float fractureGrit=marbleNoise(marbleP*43.0+vec3(2.0,13.0,5.0));
      float marbleChipping=fractureRim*smoothstep(.59,.81,fractureGrit);
      vec3 poreP=mat3(.0,.8,.6,-.8,.36,-.48,-.6,-.48,.64)*(marbleP*29.0);
      float poreNoise=marbleNoise(poreP+vec3(17.0,3.0,29.0));
      float poreResolved=1.0-smoothstep(.35,1.1,length(fwidth(poreP)));
      float marblePores=smoothstep(.73,.87,poreNoise)*poreResolved;
      float poreRim=smoothstep(.63,.79,poreNoise)*poreResolved;
      float mineralFreckles=poreRim*(.30+.70*marbleNoise(marbleP*3.7+31.0));
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.66,.51,.32),mineralFreckles*.45);
      vec3 fractureTone=mix(vec3(.045,.052,.037),vec3(.13,.12,.075),fractureGrit);
      diffuseColor.rgb=mix(diffuseColor.rgb,fractureTone,clamp(marbleFracture*.72+marbleChipping*.32,0.0,.88));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.11,.12,.075),marblePores*.48);
      float scratchPhase=dot(marbleP,vec3(137.0,83.0,41.0))+marbleNoise(marbleP*13.0)*.8;
      float scratchAA=max(fwidth(scratchPhase),.025);
      float scratchPatch=smoothstep(.64,.83,marbleNoise(marbleP*vec3(17.0,7.0,11.0)+53.0));
      float marbleScratches=(1.0-smoothstep(.025,.025+scratchAA,abs(sin(scratchPhase))))*scratchPatch*(1.0-smoothstep(.5,1.5,fwidth(scratchPhase)));
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.13,marbleScratches*.25);
      vec3 grainP=marbleP*55.0;
      float marbleGrain=marbleNoise(grainP);
      float marbleResolved=1.0-smoothstep(.35,1.0,length(fwidth(grainP)));
      float marblePitting=smoothstep(.72,.86,marbleGrain)*marbleResolved*marbleDirt;
      float marbleDamage=clamp(marbleFracture+marbleChipping*.6+marblePores*.7,0.0,1.0);
      float marbleHeight=(marbleGrain-.5)*.00012*marbleResolved-marblePitting*.0006
        -marbleFracture*.0014-marbleChipping*.0008-marblePores*.0007-marbleScratches*.00006;
    `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(.27+marbleCloud*.11+marbleDirt*.42+marblePitting*.12+marbleDamage*.30+marbleScratches*.05,.28,.90);
    `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 marbleDx=dFdx(-vViewPosition),marbleDy=dFdy(-vViewPosition);
      vec3 marbleRx=cross(marbleDy,normal),marbleRy=cross(normal,marbleDx);
      float marbleDet=dot(marbleDx,marbleRx);
      // Compute derivatives before the guard. At thin silhouettes the
      // screen-space tangent frame can collapse; retain the smooth normal.
      vec3 marbleGradient=dFdx(marbleHeight)*marbleRx+dFdy(marbleHeight)*marbleRy;
      if(abs(marbleDet)>1e-12){
        vec3 marblePerturbed=normal-sign(marbleDet)*marbleGradient/max(abs(marbleDet),1e-8);
        float marbleNormalLength=dot(marblePerturbed,marblePerturbed);
        if(marbleNormalLength>1e-12&&marbleNormalLength<1e12)
          normal=marblePerturbed*inversesqrt(marbleNormalLength);
      }
    `).replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        material.clearcoat*=1.0-marbleDamage*.85;
        material.clearcoatRoughness=clamp(material.clearcoatRoughness+marbleDamage*.35,.2,.8);
      #endif
    `).replace('#include <aomap_fragment>',`#include <aomap_fragment>
      reflectedLight.indirectDiffuse*=1.0-marbleCavity*.25;
      reflectedLight.indirectSpecular*=1.0-marbleCavity*.15;
    `);
  };
  material.customProgramCacheKey=()=>sunlight?'weathered-underwater-marble-v5':'weathered-marble-v5';
  return material;
}

import * as THREE from 'three';

// A mixed community inspired by the reference: small neon shoals, a few broad
// striped discus, slender blue swimmers, and the existing silver fish.
export const fishSpecies=Object.freeze([
  Object.freeze({id:'silver',name:'Silver fish',size:1,speed:1,shape:[1,1,1],tailRate:1,tailAmplitude:1}),
  Object.freeze({id:'neon',name:'Neon tetra',size:.62,speed:1.05,shape:[1.0,.82,.85],tailRate:1.55,tailAmplitude:.8}),
  Object.freeze({id:'discus',name:'Striped discus',size:1.55,speed:.68,shape:[1,1,1],tailRate:.68,tailAmplitude:.55}),
  Object.freeze({id:'blue',name:'Blue swimmer',size:.90,speed:1.12,shape:[1.08,.90,.88],tailRate:1.25,tailAmplitude:.9}),
]);
const community=[0,1,1,3,1,0,1,2,0,3,1,0,1,0,1,2,0,1,3,1];
export const speciesForFish=index=>community[index%community.length];
export const fishBodyProfile=[[-.26,0,0],[-.225,.012,.010],[-.16,.038,.025],[-.07,.060,.039],[.035,.069,.046],[.13,.056,.039],[.205,.033,.026],[.254,.012,.010],[.275,0,0]];

// Discus morph targets share the silver fish's topology. Species remain in one
// instanced draw, with matching visible and shadow geometry at every size.
export function addFishSpeciesGeometry(geometry){
  const position=geometry.attributes.position,normal=geometry.attributes.normal,part=geometry.attributes.fishPart;
  const positions=new Float32Array(position.count*3),normals=new Float32Array(position.count*3);
  const profile=new THREE.CubicInterpolant(Float32Array.from(fishBodyProfile,r=>r[0]),Float32Array.from(fishBodyProfile.flatMap(r=>r.slice(1))),2);
  const discusProfile=[[-.26,0,0],[-.225,.018,.012],[-.17,.105,.035],[-.09,.177,.048],[0,.19,.052],[.10,.163,.045],[.18,.105,.035],[.235,.048,.020],[.275,.008,.008]];
  const discus=new THREE.CubicInterpolant(Float32Array.from(discusProfile,r=>r[0]),Float32Array.from(discusProfile.flatMap(r=>r.slice(1))),2);
  const out=new THREE.Vector3(),n=new THREE.Vector3();
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i),region=part.getX(i);
    if(region===1){
      const t=(x+.26)/.535,sample=profile.evaluate(THREE.MathUtils.clamp(x,-.26,.275));
      const sourceH=Math.max(sample[0],1e-6),sourceW=Math.max(sample[1],1e-6);
      const cross=discus.evaluate(THREE.MathUtils.clamp(x,-.26,.275)),h=Math.max(cross[0],1e-6),w=Math.max(cross[1],1e-6);
      out.set(x*.82,(y-Math.sin(t*Math.PI)*.003)/sourceH*h,z/sourceW*w);
      const dh=(discus.evaluate(Math.min(.275,x+.0001))[0]-discus.evaluate(Math.max(-.26,x-.0001))[0])/.0002;
      const dw=(discus.evaluate(Math.min(.275,x+.0001))[1]-discus.evaluate(Math.max(-.26,x-.0001))[1])/.0002;
      n.set((-out.y*out.y*dh/(h*h*h)-out.z*out.z*dw/(w*w*w))/.82,out.y/(h*h),out.z/(w*w)).normalize();
    }else if(region===2){
      out.set(x*.82,y*1.7,z*1.05);
      n.fromBufferAttribute(normal,i).divide(new THREE.Vector3(.82,1.7,1.05)).normalize();
    }else if(x<-.24){
      const fan=THREE.MathUtils.clamp((-x-.245)/.18,0,1);
      out.set(-.205-.12*Math.sqrt(fan)+.055*Math.pow(Math.abs(y)/.12,2),y*.65,z);
      n.fromBufferAttribute(normal,i);
    }else if(Math.abs(z)>.012){
      out.set(x*.82,y*.8,z*.7);
      n.fromBufferAttribute(normal,i).divide(new THREE.Vector3(.82,.8,.7)).normalize();
    }else{
      const h=Math.max(profile.evaluate(THREE.MathUtils.clamp(x,-.26,.275))[0],.01);
      const edge=Math.max(0,discus.evaluate(THREE.MathUtils.clamp(x,-.26,.275))[0]);
      const ratio=Math.abs(y)/h;
      out.set(x*.82,Math.sign(y)*(ratio<=1?edge*ratio:edge+Math.min(.025,(ratio-1)*.012)),z);
      n.fromBufferAttribute(normal,i);
    }
    if(n.lengthSq()<.1)n.set(x<0?-1:1,0,0);
    out.toArray(positions,i*3);n.toArray(normals,i*3);
  }
  geometry.setAttribute('fishDiscusPosition',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('fishDiscusNormal',new THREE.BufferAttribute(normals,3));
}
const scalar=value=>Number(value).toFixed(4);
export const fishSpeciesVertexGLSL=`
  attribute float fishSpecies;
  attribute vec3 fishDiscusPosition,fishDiscusNormal;
  vec3 fishSpeciesScale(){
    ${fishSpecies.map((species,i)=>`if(fishSpecies<${scalar(i+.5)})return vec3(${species.shape.map(scalar).join(',')});`).join('\n')}
    return vec3(1.0);
  }
  vec3 fishSpeciesPosition(vec3 p){
    if(fishSpecies>1.5&&fishSpecies<2.5)return fishDiscusPosition;
    vec3 shaped=p*fishSpeciesScale();
    if(fishSpecies>.5){
      float snout=smoothstep(.16,.275,p.x);
      shaped.x+=snout*.012;shaped.y*=1.0-snout*.16;
      float fin=smoothstep(.073,.105,abs(p.y))*smoothstep(-.245,-.18,p.x);
      shaped.x-=fin*.035;shaped.y+=sign(p.y)*fin*.025;
      float fork=(1.0-smoothstep(-.34,-.27,p.x))*smoothstep(.04,.10,abs(p.y));
      shaped.x-=fork*.010;shaped.y+=sign(p.y)*fork*.015;
    }
    return shaped;
  }
  vec3 fishSpeciesNormal(vec3 n){
    if(fishSpecies>1.5&&fishSpecies<2.5)return fishDiscusNormal;
    vec3 scale=fishSpeciesScale();
    if(fishSpecies<.5)return normalize(n/scale);
    float t=clamp((position.x-.16)/.115,0.0,1.0),snout=t*t*(3.0-2.0*t);
    float slope=6.0*t*(1.0-t)/.115;
    float xx=scale.x+.012*slope,yy=scale.y*(1.0-snout*.16),yx=-scale.y*position.y*.16*slope;
    return normalize(vec3(n.x/xx-yx*n.y/(xx*yy),n.y/yy,n.z/scale.z));
  }
  vec2 fishTailTraits(){
    ${fishSpecies.map((species,i)=>`if(fishSpecies<${scalar(i+.5)})return vec2(${scalar(species.tailRate)},${scalar(species.tailAmplitude)});`).join('\n')}
    return vec2(1.0);
  }
`;


export const fishMarkingsGLSL=`
  float fishMarkHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float fishMarkNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.0-15.0)+10.0);
    return mix(mix(fishMarkHash(i),fishMarkHash(i+vec2(1.0,0.0)),f.x),mix(fishMarkHash(i+vec2(0.0,1.0)),fishMarkHash(i+vec2(1.0)),f.x),f.y);
  }
`;

export const fishSpeciesPigmentGLSL=`
  vec3 fishSpeciesBacklight=vec3(0.0);
  float speciesAA=max(fwidth(vFishSurface.y),.00035);
  float neonBand=1.0-smoothstep(.006,.006+speciesAA,abs(vFishSurface.y-.010));
  if(vFishSpecies>.5){
    vec3 pigment,finPigment;
    if(vFishSpecies<1.5){
      float redBand=(1.0-smoothstep(.012,.012+speciesAA,abs(vFishSurface.y+.014)))*(1.0-smoothstep(.06,.13,vFishSurface.x));
      pigment=mix(vec3(.17,.24,.23),vec3(.025,.065,.08),smoothstep(-.02,.065,vFishSurface.y));
      pigment=mix(pigment,vec3(.57,.025,.035),redBand*.95);
      pigment=mix(pigment,vec3(.025,.48,.85),neonBand*.95);
      finPigment=vec3(.26,.35,.36);
    }else if(vFishSpecies<2.5){
      vec2 marking=vec2(vFishSurface.x*72.0,vFishSurface.y*185.0);
      vec2 warp=vec2(fishMarkNoise(marking*.38+7.0),fishMarkNoise(marking*.38-13.0));
      float field=fishMarkNoise(marking+warp*3.0)+fishMarkNoise(marking*2.03+warp)*.42;
      float lineAA=max(fwidth(field),.008);
      float fineLines=1.0-smoothstep(.012,.012+lineAA,abs(field-.71));
      float faceFade=1.0-smoothstep(.10,.19,vFishSurface.x);
      float belly=1.0-smoothstep(-.045,.025,vFishSurface.y);
      vec3 bodyTone=mix(vec3(.24,.105,.065),vec3(.40,.27,.16),belly*.55);
      pigment=mix(bodyTone,vec3(.055,.29,.31),fineLines*faceFade*.72);
      float bars=1.0-smoothstep(.18,.46,abs(sin((vFishSurface.x+.10)*30.0)));
      pigment*=1.0-bars*.07;
      finPigment=mix(vec3(.16,.16,.11),vec3(.10,.25,.24),fineLines*.35);
    }else{
      float phase=vFishSurface.y*340.0+vFishSurface.x*7.0;
      float wave=mix(.5,.5+.5*sin(phase),1.0-smoothstep(.7,2.5,fwidth(phase)));
      pigment=mix(vec3(.035,.09,.26),vec3(.24,.49,.69),smoothstep(.35,.65,wave));
      pigment=mix(pigment,vec3(.48,.53,.46),(1.0-smoothstep(-.05,-.025,vFishSurface.y))*.65);
      finPigment=vec3(.12,.26,.39);
    }
    if(vFishSkin>.5){
      diffuseColor.rgb=pigment*(.94+vFishRoughness*.6);
      fishSpeciesBacklight=pigment*(vFishSpecies<1.5?.025:(vFishSpecies<2.5?.010:.012));
    }
    else if(vFishPart<.5){
      diffuseColor.rgb=mix(diffuseColor.rgb,finPigment,.8);
      if(vFishSpecies>1.5&&vFishSpecies<2.5)fishSpeciesBacklight=finPigment*.012;
    }
  }
`;

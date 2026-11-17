import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';
import {kelpSunlightShader} from './kelp-lighting.js';
import {sunShadowShader} from './kelp-godrays.js';

// Keep the existing 480 particles, distributing their scale and drift over
// three world-space layers. Nothing follows the camera or respawns on a pan.
export function createKelpParticles({parent,sun,sunlight,time,floorY,waterHeight}){
  const random=seededRandom(29017),positions=[],layers=[],sizes=[],phases=[];
  for(let i=0;i<480;i++){
    const layer=i<32?0:i<320?1:2;
    positions.push((random()-.5)*(layer===2?36:22),random(),layer===2?-8-random()*20:layer===0?3+random()*11:(random()-.5)*22);
    layers.push(layer);sizes.push(layer===0?.035+random()*.035:layer===1?.012+random()*.010:.004+random()*.004);phases.push(random()*Math.PI*2);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  for(const [name,data] of [['particleLayer',layers],['particleSize',sizes],['particlePhase',phases]])geometry.setAttribute(name,new THREE.Float32BufferAttribute(data,1));
  const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
  const uniforms={...sunlight,waterTime:time,waterHeight,floorY:{value:floorY},viewportHeight:{value:850},litGain:{value:1.25},
    sunShadow:{value:white},sunShadowMatrix:{value:new THREE.Matrix4()},sunTexel:{value:new THREE.Vector2(1,1)},
    shadowEnabled:{value:0},shadowBias:{value:0},shadowStrength:{value:1},shadowRadius:{value:1},sunRadiance:{value:new THREE.Color()}};
  // Bilinear depth comparisons avoid a point flashing between binary shadow
  // texels as it drifts. The kernel and world transform match the water pass.
  const shadow=sunShadowShader.replace('float sunVisibility(vec3 p){',`float particleShadow(vec2 uv,float receiver){
      vec2 pixel=uv/sunTexel-.5,base=(floor(pixel)+.5)*sunTexel,f=fract(pixel);
      float a=step(receiver,unpackRGBAToDepth(texture2D(sunShadow,base)));
      float b=step(receiver,unpackRGBAToDepth(texture2D(sunShadow,base+vec2(sunTexel.x,0.0))));
      float c=step(receiver,unpackRGBAToDepth(texture2D(sunShadow,base+vec2(0.0,sunTexel.y))));
      float d=step(receiver,unpackRGBAToDepth(texture2D(sunShadow,base+sunTexel)));
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    float sunVisibility(vec3 p){`).replace('step(q.z+shadowBias,blocker)/9.0','particleShadow(q.xy+offset,q.z+shadowBias)/9.0');
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms,
    vertexShader:`attribute float particleLayer,particleSize,particlePhase;
      uniform float waterTime,waterHeight,floorY,viewportHeight;
      varying vec3 vParticleWorld;varying float vAlpha,vSoft,vPhase,vGlint;
      void main(){
        vPhase=particlePhase;vGlint=step(.93,fract(particlePhase*7.13));
        vec3 p=position;p.y=floorY+p.y*waterHeight;
        float speed=particleLayer<.5?.025:particleLayer<1.5?.010:.001;
        p.x+=sin(waterTime*speed+particlePhase)*.24;
        p.z+=cos(waterTime*speed*.7+particlePhase)*.16;
        p.y+=sin(waterTime*speed*.8+particlePhase)*.08;
        vec4 world=modelMatrix*vec4(p,1.0),mv=viewMatrix*world;vParticleWorld=world.xyz;
        float projected=particleSize*projectionMatrix[1][1]*viewportHeight/max(.1,-mv.z);
        float diameter=clamp(projected,2.0,particleLayer<.5?12.0:3.5);
        float coverage=min(1.0,projected*projected/(diameter*diameter));
        float nearFade=smoothstep(.4,1.2,-mv.z);
        float farFade=particleLayer<.5?1.0-smoothstep(7.0,13.0,-mv.z):exp(-length(mv.xyz)*.025);
        vAlpha=(particleLayer<.5?.16:particleLayer<1.5?.4:.20)*coverage*nearFade*farFade;
        vSoft=particleLayer<.5?1.0:0.0;
        gl_Position=projectionMatrix*mv;gl_PointSize=diameter;
      }`,
    fragmentShader:`varying vec3 vParticleWorld;varying float vAlpha,vSoft,vPhase,vGlint;
      uniform vec3 sunRadiance;uniform float litGain,waterTime;
      #include <packing>
      ${shadow}
      ${kelpSunlightShader}
      void main(){
        float r=length(gl_PointCoord-.5)*2.0;
        float profile=exp(-r*r*mix(3.0,5.5,vSoft))*(1.0-smoothstep(.65,1.0,r));
        float visibility=sunVisibility(vParticleWorld);
        vec3 incident=sunRadiance*waterSunTransmission(vParticleWorld)*visibility*visibility;
        vec3 view=normalize(cameraPosition-vParticleWorld),halfVector=view+waterSunDirection;
        halfVector*=inversesqrt(max(dot(halfVector,halfVector),.000001));
        vec3 flakeNormal=normalize(vec3(cos(vPhase+waterTime*.21),.35+sin(vPhase*.7+waterTime*.13)*.6,sin(vPhase+waterTime*.21)));
        float glint=pow(abs(dot(flakeNormal,halfVector)),24.0)*vGlint;
        vec3 sparkle=vec3(.55,.87,.78)*incident*.18*litGain*(.85+glint*1.75);
        gl_FragColor=vec4(sparkle,profile*vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const points=new THREE.Points(geometry,material);points.name='Suspended marine particles';points.frustumCulled=false;parent.add(points);
  const size=new THREE.Vector2();
  function update(renderer){
    if(renderer?.getDrawingBufferSize){renderer.getDrawingBufferSize(size);uniforms.viewportHeight.value=size.y;}
    const shadow=sun?.shadow;
    uniforms.sunShadow.value=shadow?.map?.texture??white;
    uniforms.shadowEnabled.value=sun?.castShadow&&shadow?.map?1:0;
    uniforms.shadowStrength.value=shadow?.intensity??1;uniforms.shadowBias.value=shadow?.bias??0;uniforms.shadowRadius.value=shadow?.radius??1;
    if(shadow){uniforms.sunShadowMatrix.value.copy(shadow.matrix);uniforms.sunTexel.value.set(1/(shadow.map?.width??1),1/(shadow.map?.height??1));}
    if(sun)uniforms.sunRadiance.value.copy(sun.color).multiplyScalar(sun.intensity);else uniforms.sunRadiance.value.setRGB(0,0,0);
  }
  points.onBeforeRender=update;
  return {points,uniforms,update,dispose(){points.removeFromParent();geometry.dispose();material.dispose();white.dispose();}};
}

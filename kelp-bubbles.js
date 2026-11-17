import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';
import {createKelpSunlight,kelpSunlightShader} from './kelp-lighting.js';
import {sunShadowShader,waterGradientShader,createWaterGradientUniforms} from './kelp-godrays.js';

export function createKelpBubbles({parent,floorHeight,surfaceHeight,fish=null,capacity=400,sun=null,sunlight=createKelpSunlight()}){
  const random=seededRandom(5871),group=new THREE.Group();group.name='Rising underwater bubbles';parent.add(group);
  const vents=[[-2.3,4.1],[2.5,4.6],[-1.8,.3],[2.3,-.6],[-4.4,1.7],[4.6,1.1],[-.8,-4],[1.1,6.8]].map(([x,z])=>({x,z,radius:.055+random()*.055,next:random()*.8}));
  const geometry=new THREE.SphereGeometry(1,16,12),fades=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('bubbleFade',fades);
  const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
  const uniforms={...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),...sunlight,
    ...createWaterGradientUniforms(),
    bubbleSunRadiance:{value:new THREE.Color()},sunShadow:{value:white},sunShadowMatrix:{value:new THREE.Matrix4()},sunTexel:{value:new THREE.Vector2(1,1)},
    shadowEnabled:{value:0},shadowBias:{value:0},shadowStrength:{value:1},shadowRadius:{value:1}};
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:true,uniforms,
    vertexShader:`attribute float bubbleFade;varying vec3 vBubbleWorld,vBubbleNormal;varying float vFade;
      #include <fog_pars_vertex>
      void main(){
        vFade=bubbleFade;
        vec3 scaleSquared=vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));
        vBubbleNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*(normal/max(scaleSquared,vec3(.000001))));
        vec4 world=modelMatrix*instanceMatrix*vec4(position,1.0);vBubbleWorld=world.xyz;
        vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader:`varying vec3 vBubbleWorld,vBubbleNormal;varying float vFade;uniform vec3 bubbleSunRadiance;
      #include <packing>
      #include <fog_pars_fragment>
      ${kelpSunlightShader}
      ${sunShadowShader}
      ${waterGradientShader}
      void main(){
        vec3 normal=normalize(vBubbleNormal),view=normalize(cameraPosition-vBubbleWorld);
        float facing=clamp(dot(normal,view),0.0,1.0);
        float fresnel=.0204+.9796*pow(1.0-facing,5.0);
        // Water-to-air reflection strengthens near the critical angle, while
        // the central part of the curved shell stays almost transparent.
        float reflectionBand=smoothstep(.67,.80,sqrt(max(0.0,1.0-facing*facing)));
        vec3 reflectedDirection=reflect(-view,normal);
        vec3 reflected=waterGradient(reflectedDirection);
        reflected=mix(reflected,vec3(.24,.34,.27),(1.0-smoothstep(-.7,.0,reflectedDirection.y))*.55);
        vec3 halfVector=normalize(view+waterSunDirection);
        float specular=pow(max(0.0,dot(normal,halfVector)),150.0)*.7+pow(max(0.0,dot(normal,halfVector)),28.0)*.07;
        vec3 glint=bubbleSunRadiance*waterSunTransmission(vBubbleWorld)*sunVisibility(vBubbleWorld)*specular*.23;
        vec3 color=reflected*mix(.65,1.25,reflectionBand)+glint;
        float alpha=(.018+reflectionBand*.26+fresnel*.13+min(.45,max(glint.r,max(glint.g,glint.b))*.35))*vFade;
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`});
  const bubbles=new THREE.InstancedMesh(geometry,material,capacity);bubbles.name='Varied rising air bubbles';bubbles.count=0;bubbles.frustumCulled=false;
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(bubbles);
  bubbles.onBeforeRender=()=>{
    const shadow=sun?.shadow;
    uniforms.sunShadow.value=shadow?.map?.texture??white;uniforms.shadowEnabled.value=sun?.castShadow&&shadow?.map?1:0;
    if(shadow){uniforms.sunShadowMatrix.value.copy(shadow.matrix);uniforms.sunTexel.value.set(1/(shadow.map?.width??1),1/(shadow.map?.height??1));uniforms.shadowBias.value=shadow.bias;uniforms.shadowStrength.value=shadow.intensity;uniforms.shadowRadius.value=shadow.radius;}
    if(sun)uniforms.bubbleSunRadiance.value.copy(sun.color).multiplyScalar(sun.intensity);else uniforms.bubbleSunRadiance.value.setRGB(0,0,0);
  };
  const dummy=new THREE.Object3D(),particles=[];
  let elapsed=0,fishNext=.8;
  function emit(x,y,z,radius,source){
    if(particles.length>=capacity||y>=surfaceHeight())return;
    particles.push({x,y,z,radius,source,age:0,phase:random()*Math.PI*2,speed:.24+Math.sqrt(radius)*2.2});
  }
  function syncVents(){
    for(const v of vents)v.y=floorHeight(v.x,v.z)+.006;
  }
  function burst(impact){
    if(impact.quiet)return;
    for(let i=0;i<42;i++){
      const a=random()*Math.PI*2,box=impact.footprint==='box',u=Math.cos(a),v=Math.sin(a),edge=box?1/Math.max(Math.abs(u),Math.abs(v)):1;
      emit(impact.x+u*impact.rx*edge,impact.y+.05+random()*.12,impact.z+v*impact.rz*edge,.018+random()**2*.095,'impact');
    }
    draw();
  }
  function draw(){
    particles.forEach((p,i)=>{
      const size=p.radius*(1+Math.min(.3,p.age*.018));
      dummy.position.set(p.x+Math.sin(p.age*2+p.phase)*.055,p.y,p.z+Math.cos(p.age*1.7+p.phase)*.04);
      dummy.rotation.set(Math.sin(p.age*.8+p.phase)*.12,0,Math.cos(p.age*.65+p.phase)*.09);dummy.scale.set(size,size*(1+Math.sin(p.age*4+p.phase)*.06),size);dummy.updateMatrix();bubbles.setMatrixAt(i,dummy.matrix);
      fades.setX(i,Math.min(1,p.age*5+.2)*THREE.MathUtils.clamp((surfaceHeight()-p.y)/.16,0,1));
    });
    bubbles.count=particles.length;bubbles.instanceMatrix.needsUpdate=true;fades.needsUpdate=true;
  }
  function advance(dt){
    if(!(dt>0)||!group.visible)return false;dt=Math.min(dt,.1);elapsed+=dt;
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.age+=dt;p.y+=p.speed*dt;p.x+=dt*.018;if(p.y>=surfaceHeight()||p.age>55)particles.splice(i,1);}
    for(const v of vents){
      if(elapsed<v.next)continue;
      v.next=elapsed+.22+random()*.85;
      emit(v.x,v.y+.005,v.z,.012+random()**2*.065,'vent');
    }
    if(elapsed>=fishNext){
      fishNext=elapsed+.65+random()*1.9;
      const f=fish?.group.visible&&fish.inspectFish(Math.floor(random()*fish.stats.count));
      if(f){const [x,y,z]=f.position,[fx,fy,fz]=f.facing;for(let i=0;i<2+Math.floor(random()*3);i++)emit(x+fx*f.size*.4,y+fy*f.size*.4+i*.025,z+fz*f.size*.4,.012+random()*.025,'fish');}
    }
    draw();return true;
  }
  syncVents();
  return {group,bubbles,vents,syncVents,burst,advance,get stats(){return {count:particles.length,vent:particles.filter(p=>p.source==='vent').length,fish:particles.filter(p=>p.source==='fish').length,impact:particles.filter(p=>p.source==='impact').length};},
    clearImpact(){for(let i=particles.length-1;i>=0;i--)if(particles[i].source==='impact')particles.splice(i,1);draw();},
    inspect(i){return particles[i]?{...particles[i]}:null;},
    dispose(){group.removeFromParent();white.dispose();for(const m of [bubbles]){m.geometry.dispose();m.material.dispose();m.dispose();}particles.length=0;}};
}

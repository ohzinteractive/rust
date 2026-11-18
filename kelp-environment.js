import * as THREE from 'three';
import {oceanShader} from './kelp-water.js';
import {createKelpParticles} from './kelp-particles.js';
import {createKelpBubbles} from './kelp-bubbles.js';
import {createKelpSediment} from './kelp-sediment.js';
import {seededRandom} from './plume-lsystem/random.js';
import {createKelpGodrays,createWaterGradientUniforms} from './kelp-godrays.js';
import {createKelpSunlight,configureKelpSunlight,kelpSunSlope} from './kelp-lighting.js';
import {createKelpSeabed,createSeabedStoneGeometry,createSeabedStoneMaterial,seabedHeight} from './kelp-seabed.js';

export function createKelpEnvironment({scene,ground,shadow,key,rim,fill,skyLight,renderer,focus=null,kelp=null,fish=null,sunlight=createKelpSunlight()}){
  const group=new THREE.Group();group.name='Underwater environment';group.visible=false;scene.add(group);
  const time={value:0},lightFocus=sunlight.waterLightFocus,random=seededRandom(2901);
  const sunSlope=new THREE.Vector3(kelpSunSlope.x,1,kelpSunSlope.z);
  const waterGradientUniforms=createWaterGradientUniforms(),waterColor=waterGradientUniforms.waterDeep.value;
  // The compositor owns the water boundary; only its world height is needed here.
  let surfaceY=ground.position.y;
  // Direction-based sky stays fixed as the camera moves through the surface.
  const backdropMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,toneMapped:false,
    vertexShader:`varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*vec4(mat3(viewMatrix)*position,1.0);gl_Position.z=gl_Position.w*.99999;}`,
    fragmentShader:`varying vec3 vDirection;
      ${oceanShader}
      void main(){gl_FragColor=vec4(oceanSky(vDirection),1.0);
      #include <colorspace_fragment>
      }`});
  const backdrop=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),backdropMaterial);backdrop.name='Ocean sky';backdrop.frustumCulled=false;backdrop.renderOrder=-10;group.add(backdrop);
  const sediment=createKelpSediment({parent:group});
  const seabed=createKelpSeabed({sunlight,time}),sand=seabed.material;
  const rockMaterial=createSeabedStoneMaterial({sunlight,time});
  const rocks=new THREE.InstancedMesh(createSeabedStoneGeometry(),rockMaterial,38),dummy=new THREE.Object3D(),rockRecords=[];
  rocks.name='Seabed stones';rocks.castShadow=true;rocks.receiveShadow=true;
  for(let i=0;i<rocks.count;i++){
    const clusters=[[-4.8,4.5],[4.7,3.8],[-3.5,-3.3],[4.0,-3.5]];
    const cluster=clusters[i%4],angle=random()*Math.PI*2,r=Math.sqrt(random())*(i%5===0?5.3:2.1);
    let x=cluster[0]+Math.cos(angle)*r,z=cluster[1]+Math.sin(angle)*r;
    if(Math.hypot(x,z-2.5)<2.0)x+=(x<0?-1:1)*2.7;
    const size=.13+Math.pow(random(),1.5)*.48,sx=size*(1+random()*.8),sy=size*(.46+random()*.55),sz=size*(.7+random()*.75),rotation=random()*Math.PI*2;
    dummy.position.set(x,ground.position.y+seabedHeight(x,z)+sy*.15,z);
    dummy.scale.set(sx,sy,sz);dummy.rotation.set((random()-.5)*.3,rotation,(random()-.5)*.3);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
    rocks.setColorAt(i,new THREE.Color().setRGB(.8+random()*.2,.8+random()*.2,.73+random()*.25));
    rockRecords.push({center:new THREE.Vector3(x,0,z),rx:sx,rz:sz,angle:rotation});
  }
  group.add(rocks);
  const pebbles=new THREE.InstancedMesh(rocks.geometry,rockMaterial,150);pebbles.name='Clustered seabed pebbles';
  const shellMaterial=new THREE.MeshStandardMaterial({color:0xaaa78f,roughness:.88,side:THREE.DoubleSide});configureKelpSunlight(shellMaterial,sunlight);
  const shells=new THREE.InstancedMesh(new THREE.CircleGeometry(1,7,0,Math.PI*.78),shellMaterial,24);shells.name='Small shell fragments';
  const litterMaterial=new THREE.MeshStandardMaterial({color:0x697047,roughness:.96,side:THREE.DoubleSide});configureKelpSunlight(litterMaterial,sunlight);
  const litter=new THREE.InstancedMesh(new THREE.CircleGeometry(1,5),litterMaterial,32);litter.name='Settled kelp scraps';
  for(const mesh of [pebbles,shells,litter]){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  let seabedRevision=-1;
  function syncSeabed(){
    const revision=kelp?.revision??0;if(seabedRevision===revision)return;seabedRevision=revision;
    const placements=[...rockRecords,...(kelp?.getSupportStones()??[])];seabed.setStones(placements);
    const scatter=seededRandom(4931+(kelp?.settings.seed??0));
    for(const mesh of [pebbles,shells,litter]){
      for(let i=0;i<mesh.count;i++){
        const anchor=placements[Math.floor(scatter()*placements.length)],a=scatter()*Math.PI*2;
        const r=Math.max(anchor.rx,anchor.rz)*(1.15+scatter()*1.15);
        let x=anchor.center.x+Math.cos(a)*r,z=anchor.center.z+Math.sin(a)*r;
        if(i%9===0){x=(scatter()-.5)*20;z=(scatter()-.5)*19;}
        if(Math.hypot(x,z-2.5)<1.7)x+=(x<0?-1:1)*2.0;
        const h=seabed.heightAt(x,z),size=.025+scatter()*.055;
        if(mesh===pebbles){
          dummy.position.set(x,ground.position.y+h+size*.13,z);dummy.scale.set(size*(1.1+scatter()*.8),size*.55,size);
          dummy.rotation.set(scatter()*.3,scatter()*Math.PI*2,scatter()*.2);
        }else{
          dummy.position.set(x,ground.position.y+h+.008,z);dummy.scale.set(size*(mesh===litter?1.7:1),size*(mesh===litter?.40:.85),1);
          dummy.rotation.set(-Math.PI/2+(scatter()-.5)*.16,0,scatter()*Math.PI*2);
        }
        dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.computeBoundingBox();
    }
    bubbles.syncVents();
  }
  const schoolLight=new THREE.SpotLight(0xd9f4dc,16,28,.48,.85,1.5);
  schoolLight.name='Cool reflected light on the shoal';group.add(schoolLight,schoolLight.target);
  const surfaceRipples=Array.from({length:8},()=>new THREE.Vector4(0,0,0,0));
  let rippleSlot=0,rippleFish=0,lastRipple=-1;
  function updateSurfaceRipples(){
    if(time.value<lastRipple){for(const ripple of surfaceRipples)ripple.set(0,0,0,0);lastRipple=-1;}
    if(time.value-lastRipple<.65)return;
    lastRipple=time.value;
    const count=fish?.settings.count??0;
    for(let j=0;j<count;j++){
      const index=(rippleFish+j)%count,f=fish.inspectFish(index);
      if(!f)continue;
      const depth=surfaceY-f.position[1],speed=Math.hypot(...f.velocity);
      if(depth<0||depth>.38||speed<.12)continue;
      surfaceRipples[rippleSlot].set(f.position[0],f.position[2],time.value,.007*(1-depth/.38));
      rippleSlot=(rippleSlot+1)%surfaceRipples.length;rippleFish=(index+1)%count;break;
    }
  }
  const godrays=renderer?createKelpGodrays(renderer,sunlight):null;
  let lightingView='final',lightingPreviewGain=1;
  const lightingDefaults={sunlight:1.72,ambient:.16,scattering:2.81,shadows:.96,bloom:2.96};
  const lightingSettings={...lightingDefaults};
  const lightingLimits={sunlight:3,ambient:3,scattering:4,shadows:1,bloom:3};
  const lightingViews={final:0,visibility:1,scattering:2,direct:3,'volume-visibility':4};
  const waterHeight={value:10};
  const particles=createKelpParticles({parent:group,sun:key,sunlight,time,floorY:ground.position.y,waterHeight});
  const lights=[key,rim,fill,skyLight];let saved=null;
  function updateFocus(){
    if(focus?.active){
      // Put the lit water behind the sculpture, leaving its shaded side clear.
      lightFocus.value.copy(focus.center);lightFocus.value.y+=focus.halfHeight*.15;lightFocus.value.z-=.6;
      schoolLight.target.position.copy(focus.center);schoolLight.target.position.y+=focus.halfHeight*.4;
      schoolLight.position.copy(schoolLight.target.position);schoolLight.position.x-=3;schoolLight.position.y+=4;schoolLight.position.z+=3.5;
    }else{
      lightFocus.value.set(0,ground.position.y+.6,2.5);
      schoolLight.target.position.set(0,ground.position.y+(waterHeight.value-.25)*.46,2.6);
      schoolLight.position.set(2.4,schoolLight.target.position.y+2.5,6.8);
    }
    schoolLight.target.updateMatrixWorld();
    if(saved){
      key.target.position.copy(lightFocus.value);
      const rise=surfaceY+5-lightFocus.value.y;
      key.position.copy(lightFocus.value).addScaledVector(sunSlope,rise);
      key.target.updateMatrixWorld();
    }
  }
  function setHeight(height){
    const depth=height+.25;surfaceY=ground.position.y+depth;waterHeight.value=depth;
    sunlight.waterSurface.value=surfaceY;
    updateFocus();
  }
  const bubbles=createKelpBubbles({parent:group,floorHeight:(x,z)=>ground.position.y+seabed.heightAt(x,z),surfaceHeight:()=>surfaceY,fish,sun:key,sunlight});
  setHeight(7);
  return {group,bubbles,particles,render(camera,draw,elapsed){
    if(Number.isFinite(elapsed))time.value=elapsed;
    if(!saved||!godrays){draw();return;}
    syncSeabed();
    updateFocus();updateSurfaceRipples();
    const indirect=[rim,fill,skyLight,schoolLight],intensities=indirect.map(light=>light.intensity),environment=scene.environmentIntensity,sunIntensity=key.intensity,shadowIntensity=key.shadow.intensity;
    try{
      key.intensity=sunIntensity*lightingSettings.sunlight;key.shadow.intensity=shadowIntensity*lightingSettings.shadows;
      indirect.forEach((light,i)=>{light.intensity=intensities[i]*lightingSettings.ambient;});scene.environmentIntensity=environment*lightingSettings.ambient;
      if(lightingView==='direct'){indirect.forEach(light=>{light.intensity=0;});scene.environmentIntensity=0;}
      godrays.render(scene,camera,draw,{top:surfaceY,bottom:ground.position.y,time:time.value,sun:key,focus:lightFocus.value,debugView:lightingViews[lightingView],previewGain:lightingPreviewGain,scatteringStrength:lightingSettings.scattering,bloomStrength:lightingSettings.bloom,surfaceRipples});
    }finally{key.intensity=sunIntensity;key.shadow.intensity=shadowIntensity;indirect.forEach((light,i)=>{light.intensity=intensities[i];});scene.environmentIntensity=environment;}
  },setLightingView(view){
    if(!Object.hasOwn(lightingViews,view))throw new RangeError('Unknown lighting view');
    lightingView=view;godrays?.resetHistory();
  },get lightingSettings(){return {...lightingSettings};},setLightingSettings(values){
    for(const name of Object.keys(lightingDefaults)){
      if(Number.isFinite(values[name]))lightingSettings[name]=THREE.MathUtils.clamp(values[name],0,lightingLimits[name]);
    }
    godrays?.resetHistory();
  },resetLighting(){Object.assign(lightingSettings,lightingDefaults);godrays?.resetHistory();
  },get lightingView(){return lightingView;},get lightingPreviewGain(){return lightingPreviewGain;},setLightingPreviewGain(value){
    lightingPreviewGain=THREE.MathUtils.clamp(Number.isFinite(value)?value:1,1,16);
  },getLightingDiagnostics(){return {...godrays?.getDiagnostics(),sunlight};
  },impact(value){seabed.setImpact(value);sediment.burst(value);bubbles.burst(value);
  },clearImpact(){seabed.setImpact(null);sediment.clear();bubbles.clearImpact();
  },advanceImpact(dt){if(!saved)return false;const sandMoved=seabed.advance(dt),dustMoved=sediment.advance(dt);return sandMoved||dustMoved;
  },advanceBubbles(dt){if(!saved)return false;return bubbles.advance(dt);
  },floorHeight(x,z){return ground.position.y+seabed.heightAt(x,z);
  },get surfaceY(){return surfaceY;},get enabled(){return !!saved;},setHeight,advance(dt){if(saved)time.value+=Math.min(dt,.1);},setEnabled(enabled){
    if(!!saved!==!!enabled)godrays?.resetHistory();
    group.visible=enabled;
    if(enabled&&!saved){
      saved={background:scene.background,fog:scene.fog,environment:scene.environmentIntensity,material:ground.material,geometry:ground.geometry,groundVisible:ground.visible,shadowVisible:shadow.visible,
        lights:lights.map(l=>({color:l.color.clone(),intensity:l.intensity,position:l.position.clone()})),groundColor:skyLight.groundColor.clone(),radius:key.shadow.radius,normalBias:key.shadow.normalBias,
        shadowCamera:key.shadow.camera.clone(),keyTarget:key.target.position.clone(),shadowType:renderer?.shadowMap.type};
      scene.background=waterColor;scene.fog=new THREE.FogExp2(waterGradientUniforms.waterHorizon.value,.052);scene.environmentIntensity=.18;
      syncSeabed();ground.material=sand;ground.geometry=seabed.geometry;ground.visible=true;shadow.visible=false;
      // Warm sunlight against cool water, with modest red headroom at depth.
      key.color.setRGB(1.25,.92,.56);key.intensity=9;key.shadow.radius=6;
      // Front-face sculpture shadows retain contact under the sand. Give the
      // wide PCF filter enough normal offset to avoid self-shadow banding.
      key.shadow.normalBias=.04;
      // PCF Soft uses a fixed kernel in this Three.js build. PCF honours the
      // radius, giving the sun a genuinely broader, softer shadow footprint.
      if(renderer){renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.needsUpdate=true;}
      Object.assign(key.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:.5,far:50});key.shadow.camera.updateProjectionMatrix();
      setHeight(waterHeight.value-.25);
      rim.color.set(0x8bdad1);rim.intensity=.65;rim.position.set(3,10,-5);
      fill.color.set(0x3faaa7);fill.intensity=.3;
      skyLight.color.set(0x9edbd0);skyLight.groundColor.set(0x193e38);skyLight.intensity=.72;
    }else if(!enabled&&saved){
      lightingView='final';lightingPreviewGain=1;
      scene.background=saved.background;scene.fog=saved.fog;scene.environmentIntensity=saved.environment;
      ground.material=saved.material;ground.geometry=saved.geometry;ground.visible=saved.groundVisible;shadow.visible=saved.shadowVisible;
      lights.forEach((l,i)=>{l.color.copy(saved.lights[i].color);l.intensity=saved.lights[i].intensity;l.position.copy(saved.lights[i].position);});
      key.target.position.copy(saved.keyTarget);key.target.updateMatrixWorld();
      if(renderer){renderer.shadowMap.type=saved.shadowType;renderer.shadowMap.needsUpdate=true;}
      skyLight.groundColor.copy(saved.groundColor);key.shadow.radius=saved.radius;key.shadow.normalBias=saved.normalBias;key.shadow.camera.copy(saved.shadowCamera);saved=null;
    }
  },dispose(){particles.dispose();bubbles.dispose();sediment.dispose();godrays?.dispose();this.setEnabled(false);seabed.dispose();group.removeFromParent();for(const resource of [rocks,pebbles,shells,litter,shells.geometry,shellMaterial,litter.geometry,litterMaterial,backdrop.geometry,backdropMaterial,rockMaterial,rocks.geometry])resource.dispose();}};
}

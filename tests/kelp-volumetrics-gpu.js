import * as THREE from 'three';
import {createKelpGodrays,sunShadowShader} from '../kelp-godrays.js';
import {kelpSunlightShader} from '../kelp-lighting.js';

function rawVolume(renderer,effect){
  const target=effect.getDiagnostics().volumeTarget,half=target.texture.type===THREE.HalfFloatType;
  const buffer=half?new Uint16Array(target.width*target.height*4):new Uint8Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,buffer);
  return Float32Array.from(buffer,value=>half?THREE.DataUtils.fromHalfFloat(value):value/255);
}

// Compare Three's actual surface-shadow function with the volume lookup at
// identical world positions. Their PCF kernels differ at penumbra edges.
export function compareKelpSunVisibility({renderer,environment,scene,attractor,worldPoints}){
  const debug=environment.getLightingDiagnostics(),sun=scene.children.find(o=>o.isDirectionalLight&&o.castShadow);
  const box=attractor.bounds,points=[];
  if(worldPoints)for(const p of worldPoints)points.push(p.x,p.y,p.z,1);
  else for(const y of [box.max.y+.04,attractor.center.y,box.min.y+.1])for(let z=-4;z<=4;z+=.25)for(let x=-4;x<=4;x+=.25)points.push(x,y,z+attractor.center.z,1);
  const count=points.length/4,positions=new THREE.DataTexture(new Float32Array(points),count,1,THREE.RGBAFormat,THREE.FloatType);positions.needsUpdate=true;
  const target=new THREE.WebGLRenderTarget(count,1,{depthBuffer:false});
  const material=new THREE.ShaderMaterial({toneMapped:false,depthTest:false,depthWrite:false,
    defines:{USE_SHADOWMAP:'',SHADOWMAP_TYPE_PCF:''},
    uniforms:{...debug.sunlight,positions:{value:positions},sunShadow:{value:debug.shadowTexture},sunShadowMatrix:{value:debug.shadowMatrix},sunTexel:{value:new THREE.Vector2(1/sun.shadow.map.width,1/sun.shadow.map.height)},shadowEnabled:{value:1},shadowBias:{value:sun.shadow.bias},shadowStrength:{value:sun.shadow.intensity},shadowRadius:{value:sun.shadow.radius}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`varying vec2 vUv;uniform sampler2D positions;
      #include <common>
      #include <packing>
      #include <shadowmap_pars_fragment>
      ${sunShadowShader}
      ${kelpSunlightShader}
      void main(){vec3 p=texture2D(positions,vUv).xyz;
        float surface=getShadow(sunShadow,1.0/sunTexel,shadowStrength,shadowBias,shadowRadius,sunShadowMatrix*vec4(p,1.0));
        gl_FragColor=vec4(surface,sunVisibility(p),waterSunWindow(p),1.0);
      }`});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material),testScene=new THREE.Scene();testScene.add(quad);
  const previous=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissorTest();
  try{
    renderer.setScissorTest(false);renderer.setRenderTarget(target);renderer.render(testScene,new THREE.Camera());
    const pixels=new Uint8Array(count*4);renderer.readRenderTargetPixels(target,0,0,count,1,pixels);
    let error=0,lit=0,shadowed=0,disagreements=0,incident=0;
    for(let i=0;i<pixels.length;i+=4){const surface=pixels[i]/255,volume=pixels[i+1]/255;error+=Math.abs(surface-volume);incident+=volume*pixels[i+2]/255;if(surface>.95&&volume>.95)lit++;if(surface<.05&&volume<.05)shadowed++;if(Math.abs(surface-volume)>.35)disagreements++;}
    return {samples:count,meanError:error/count,lit,shadowed,disagreements,incidentMean:incident/count};
  }finally{renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.setScissorTest(scissor);target.dispose();material.dispose();quad.geometry.dispose();positions.dispose();}
}

// Block only the light path in the real forest. The blocker writes neither
// scene color nor camera depth, so lost raw radiance must come from its shadow.
export function checkKelpCorridor({renderer,environment,scene,attractor,renderScene}){
  renderScene();
  const light=environment.getLightingDiagnostics().sunlight,direction=light.waterSunDirection.value,focus=light.waterLightFocus.value;
  const worldPoints=[];
  for(const rise of [3,5,7])for(const x of [-.5,0,.5])for(const z of [-.4,0,.4])worldPoints.push(focus.clone().addScaledVector(direction,rise/direction.y).add(new THREE.Vector3(x,0,z)));
  const sample=()=>compareKelpSunVisibility({renderer,environment,scene,attractor,worldPoints});
  const lit=sample(),unblocked=rawVolume(renderer,{getDiagnostics:()=>environment.getLightingDiagnostics()});
  const blocker=new THREE.Mesh(new THREE.PlaneGeometry(7,7),new THREE.MeshBasicMaterial({side:THREE.DoubleSide,colorWrite:false,depthWrite:false}));
  blocker.name='Temporary sunlight occluder';blocker.castShadow=true;
  blocker.position.copy(focus).addScaledVector(direction,(light.waterSurface.value-.35-focus.y)/direction.y);
  blocker.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);scene.add(blocker);
  try{
    renderer.shadowMap.needsUpdate=true;renderScene();
    const shadowed=sample(),blocked=rawVolume(renderer,{getDiagnostics:()=>environment.getLightingDiagnostics()});
    let rawLost=0,changed=0;
    for(let i=0;i<blocked.length;i+=4){const delta=(unblocked[i]+unblocked[i+1]+unblocked[i+2]-blocked[i]-blocked[i+1]-blocked[i+2])/3;rawLost+=Math.max(0,delta);if(delta>.0001)changed++;}
    return {lit,shadowed,rawChanged:changed,meanRawLoss:rawLost/(blocked.length/4)};
  }finally{blocker.removeFromParent();blocker.geometry.dispose();blocker.material.dispose();renderer.shadowMap.needsUpdate=true;renderScene();}
}

// Only castShadow changes between images. Both the blocker and backdrop use
// unlit materials, so a pixel difference proves shadows affect the water.
export function checkKelpVolumetricShadows({renderer}){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x03212b);
  const camera=new THREE.PerspectiveCamera(55,1,.1,80);
  const size=renderer.getDrawingBufferSize(new THREE.Vector2());camera.aspect=size.x/size.y;camera.updateProjectionMatrix();
  camera.position.set(0,1.5,11);camera.lookAt(0,4,0);
  const sun=new THREE.DirectionalLight(0xffdc8a,9);sun.position.set(-6,12,-6.5);sun.target.position.set(0,2,0);sun.castShadow=true;
  sun.color.setRGB(1.65,.7,.18);
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12,near:.1,far:40});sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun,sun.target);
  const blocker=new THREE.Mesh(new THREE.PlaneGeometry(5,5),new THREE.MeshBasicMaterial({color:0x061719,side:THREE.DoubleSide}));
  const rise=5-(-2+(10-.25)*.46);
  blocker.rotation.x=-Math.PI/2;blocker.position.set(-.6*rise,5,2.6-.65*rise);blocker.castShadow=true;scene.add(blocker);
  const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(40,30),new THREE.MeshBasicMaterial({color:0x052c36}));backdrop.position.set(0,3,-8);scene.add(backdrop);
  const effect=createKelpGodrays(renderer),gl=renderer.getContext();
  const pixels=(withSun=true,shaftStrength=1)=>{
    renderer.shadowMap.needsUpdate=true;
    effect.render(scene,camera,()=>renderer.render(scene,camera),{top:8,bottom:-2,time:0,sun:withSun?sun:undefined,shaftStrength});
    const p=new Uint8Array(size.x*size.y*4);gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,p);return {pixels:p,volume:rawVolume(renderer,effect)};
  };
  try{
    pixels();const shadowed=pixels();blocker.castShadow=false;const unshadowed=pixels();
    let changed=0,maxDelta=0,total=0,rawChanged=0,rawMaxDelta=0;
    for(let i=0;i<shadowed.pixels.length;i+=4){
      const delta=(unshadowed.pixels[i]+unshadowed.pixels[i+1]+unshadowed.pixels[i+2]-shadowed.pixels[i]-shadowed.pixels[i+1]-shadowed.pixels[i+2])/3;
      if(delta>2)changed++;maxDelta=Math.max(maxDelta,delta);total+=Math.max(0,delta);
    }
    for(let i=0;i<shadowed.volume.length;i+=4){const delta=(unshadowed.volume[i]+unshadowed.volume[i+1]+unshadowed.volume[i+2]-shadowed.volume[i]-shadowed.volume[i+1]-shadowed.volume[i+2])/3;if(delta>.0001)rawChanged++;rawMaxDelta=Math.max(rawMaxDelta,delta);}
    // A white unlit surface loses more red than green/blue with distance.
    blocker.visible=false;backdrop.material.color.setRGB(1,1,1);backdrop.position.z=5;
    const near=pixels(false);backdrop.position.z=-8;const far=pixels(false);
    const center=(Math.floor(size.y/2)*size.x+Math.floor(size.x/2))*4;
    const spectralRatios=[0,1,2].map(channel=>far.pixels[center+channel]/Math.max(1,near.pixels[center+channel]));
    backdrop.material.color.set(0x052c36);
    const withoutShaft=pixels(true,0),withShaft=pixels(true,1);
    const projected=new THREE.Vector3(0,-2+(10-.25)*.46,2.6).project(camera),volume=effect.getDiagnostics().volumeTarget;
    const sx=THREE.MathUtils.clamp(Math.floor((projected.x*.5+.5)*volume.width),0,volume.width-1),sy=THREE.MathUtils.clamp(Math.floor((projected.y*.5+.5)*volume.height),0,volume.height-1);
    const offset=(sy*volume.width+sx)*4,sum=(v)=>v[offset]+v[offset+1]+v[offset+2];
    const shaftGain=sum(withShaft.volume)/Math.max(.000001,sum(withoutShaft.volume));
    blocker.visible=true;blocker.castShadow=true;pixels();
    return {shaftGain,changed,maxDelta,meanDelta:total/(size.x*size.y),rawChanged,rawMaxDelta,spectralRatios,shadowMap:[sun.shadow.map.width,sun.shadow.map.height]};
  }finally{
    effect.dispose();sun.shadow.map?.dispose();for(const mesh of [blocker,backdrop]){mesh.geometry.dispose();mesh.material.dispose();}
    renderer.shadowMap.needsUpdate=true;
  }
}

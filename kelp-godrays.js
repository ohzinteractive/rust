import * as THREE from 'three';
import {oceanShader} from './kelp-water.js';
import {createKelpSunlight,kelpSunlightShader} from './kelp-lighting.js';

// The surface, backdrop and participating water share the same palette.
export const waterGradientShader=`
  uniform vec3 waterDeep,waterHorizon,waterShallow;
  vec3 waterGradient(vec3 direction){
    float elevation=normalize(direction).y;
    return elevation<0.0
      ?mix(waterDeep,waterHorizon,smoothstep(-.85,0.0,elevation))
      :mix(waterHorizon,waterShallow,smoothstep(0.0,1.0,elevation));
  }
`;
export function createWaterGradientUniforms(){
  return {waterDeep:{value:new THREE.Color(0x034351)},waterHorizon:{value:new THREE.Color(0x118b94)},waterShallow:{value:new THREE.Color(0x8cddd4)}};
}
const vertexShader=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const mediumShader=`
  uniform sampler2D sceneDepth;
  uniform mat4 worldFromClip;
  uniform vec3 eye;
  uniform float waterTop,floorY,waterTime;
  ${oceanShader}
  vec3 worldAt(vec2 uv,float z);
  float surfaceDistance(vec3 d,float limit){
    // Trace from the near plane, so a wave can cover only the lower part
    // of the lens instead of switching the entire image at one camera height.
    vec3 lens=worldAt(vUv,0.0);
    float nearDistance=length(lens-eye),previous=nearDistance;
    float initial=lens.y-waterTop-oceanHeight(lens.xz,waterTime);
    for(int i=0;i<25;i++){
      float next=min(limit,nearDistance+.035*(pow(1.43,float(i)+1.0)-1.0));
      vec3 p=eye+d*next;
      float h=p.y-waterTop-oceanHeight(p.xz,waterTime);
      if(h*initial<0.0){
        float lo=previous,hi=next;
        for(int j=0;j<6;j++){float mid=(lo+hi)*.5;vec3 q=eye+d*mid;
          float side=q.y-waterTop-oceanHeight(q.xz,waterTime);
          if(side*initial>0.0)lo=mid;else hi=mid;}
        return (lo+hi)*.5;
      }
      if(next>=limit)break;previous=next;
    }
    return limit;
  }
  const vec3 sigmaS=vec3(.012,.021,.021);
  const vec3 sigmaA=vec3(.045,.010,.005);
  const vec3 sigmaT=sigmaS+sigmaA;
  vec3 worldAt(vec2 uv,float z){vec4 p=worldFromClip*vec4(uv*2.0-1.0,z*2.0-1.0,1.0);return p.xyz/p.w;}
  vec2 waterInterval(vec3 direction,float distanceToScene){
    float crossing=surfaceDistance(direction,distanceToScene);
    vec3 lens=worldAt(vUv,0.0);
    bool submerged=lens.y<waterTop+oceanHeight(lens.xz,waterTime);
    float start=submerged?0.0:crossing,finish=submerged?crossing:distanceToScene;
    if(direction.y<-.0001)finish=min(finish,max(0.0,(floorY-eye.y)/direction.y));
    else if(eye.y<floorY&&direction.y>.0001)start=max(start,(floorY-eye.y)/direction.y);
    return vec2(start,max(start,finish));
  }
`;

export const sunShadowShader=`
  uniform sampler2D sunShadow;
  uniform mat4 sunShadowMatrix;
  uniform vec2 sunTexel;
  uniform float shadowEnabled,shadowBias,shadowStrength,shadowRadius;
      float sunVisibility(vec3 p){
        if(shadowEnabled<.5)return 1.0;
        vec4 projected=sunShadowMatrix*vec4(p,1.0);vec3 q=projected.xyz/projected.w;
        if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,vec3(1.0))))return 1.0;
        float visibility=0.0;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec2 offset=vec2(float(x),float(y))*sunTexel*shadowRadius*.5;
          float blocker=unpackRGBAToDepth(texture2D(sunShadow,q.xy+offset));
          visibility+=step(q.z+shadowBias,blocker)/9.0;
        }
        return mix(1.0,visibility,shadowStrength);
      }
`;

// HDR scene -> half-resolution shadowed scattering -> quarter-resolution
// highlight bloom -> depth-aware full-resolution composite. Depth-reprojected
// history supports slow camera motion; cuts and lighting changes reject it.
export function createKelpGodrays(renderer,sunlight=createKelpSunlight()){
  const size=new THREE.Vector2(),viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
  const type=renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  const target=new THREE.WebGLRenderTarget(1,1,{
    type,samples:Math.min(4,renderer.capabilities.maxSamples),depthTexture:new THREE.DepthTexture(1,1),
  });
  target.texture.name='Linear HDR underwater scene';
  const volumes=Array.from({length:2},()=>new THREE.WebGLRenderTarget(1,1,{type,depthBuffer:false}));
  const blooms=Array.from({length:2},()=>new THREE.WebGLRenderTarget(1,1,{type,depthBuffer:false}));
  volumes.forEach((rt,i)=>{rt.texture.name=`Shadowed water scattering ${i}`;rt.texture.minFilter=rt.texture.magFilter=THREE.NearestFilter;});
  blooms.forEach((rt,i)=>{rt.texture.name=`Underwater highlight glow ${i}`;});
  const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1,THREE.RGBAFormat);white.needsUpdate=true;
  const uniforms={
    sceneColor:{value:target.texture},sceneDepth:{value:target.depthTexture},
    worldFromClip:{value:new THREE.Matrix4()},eye:{value:new THREE.Vector3()},
    waterTop:{value:10},floorY:{value:-1.75},waterTime:{value:0},
    ...createWaterGradientUniforms(),
    sunShadow:{value:white},sunShadowMatrix:{value:new THREE.Matrix4()},sunTexel:{value:new THREE.Vector2(1,1)},
    ...sunlight,sunDirection:sunlight.waterSunDirection,sunRadiance:{value:new THREE.Color()},lightFocus:sunlight.waterLightFocus,
    shadowEnabled:{value:0},shadowBias:{value:0},shadowStrength:{value:1},shadowRadius:{value:1},
    volumeTexture:{value:volumes[0].texture},volumeSize:{value:new THREE.Vector2(1,1)},
    historyTexture:{value:volumes[1].texture},historyWeight:{value:0},
    previousClipFromWorld:{value:new THREE.Matrix4()},previousEye:{value:new THREE.Vector3()},
    shaftStrength:{value:1},scatteringStrength:{value:1},bloomStrength:{value:1},
    bloomTexture:{value:blooms[1].texture},debugView:{value:0},previewGain:{value:1},
  };
  const volumeMaterial=new THREE.ShaderMaterial({name:'Shadowed participating water',depthTest:false,depthWrite:false,toneMapped:false,
    uniforms,vertexShader,
    fragmentShader:`varying vec2 vUv;
      ${mediumShader}
      #include <packing>
      ${sunShadowShader}
      ${kelpSunlightShader}
      uniform sampler2D historyTexture;
      uniform vec3 sunDirection,sunRadiance,lightFocus;
      uniform float historyWeight,debugView,scatteringStrength,shaftStrength;
      uniform mat4 previousClipFromWorld;uniform vec3 previousEye;
      float phaseHG(float cosine,float g){
        return (1.0-g*g)/(12.5663706*pow(max(.001,1.0+g*g-2.0*g*cosine),1.5));
      }
      void main(){
        vec3 delta=worldAt(vUv,texture2D(sceneDepth,vUv).r)-eye;
        float distanceToScene=length(delta);vec3 direction=delta/max(distanceToScene,.0001);
        vec2 segment=waterInterval(direction,distanceToScene);
        segment.y=min(segment.y,segment.x+60.0);
        float stepLength=(segment.y-segment.x)/36.0;
        float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
        vec3 scatter=vec3(0.0);float visibilitySum=0.0;
        // Keep the narrow forward lobe, with a modest broad component so a
        // downward seabed view still receives light scattered through water.
        float cosine=dot(direction,sunDirection);
        float phase=mix(phaseHG(cosine,.2),phaseHG(cosine,.82),.7);
        for(int i=0;i<36;i++){
          float d=segment.x+(float(i)+jitter)*stepLength;
          vec3 p=eye+direction*d;
          float lightPath=max(0.0,waterTop-p.y)/max(sunDirection.y,.15);
          vec3 viewTransmission=exp(-sigmaT*(d-segment.x));
          vec2 surfacePoint=p.xz+sunDirection.xz*lightPath;
          float shimmer=.9+.1*sin(surfacePoint.x*2.8+surfacePoint.y*1.9+waterTime*.5);
          float visibility=sunVisibility(p);visibilitySum+=visibility;
          vec2 shaftOffset=waterLightOffset(p);
          float shaftWidth=1.25+max(0.0,waterTop-p.y)*.035;
          float shaftCore=exp(-dot(shaftOffset,shaftOffset)/(shaftWidth*shaftWidth))*shaftStrength;
          // A little more broad-angle scattering carries the lit opening down
          // the actual sun path, with shadowing applied throughout the column.
          float columnPhase=mix(phase,phaseHG(cosine,.2),shaftCore*.22);
          scatter+=viewTransmission*sigmaS*sunRadiance*waterSunTransmission(p)*
            (visibility*columnPhase*shimmer*stepLength*2.2*(1.0+shaftCore*1.20));
        }
        if(debugView>3.5)scatter=vec3(stepLength>0.0?visibilitySum/36.0:0.0);
        else scatter*=scatteringStrength;
        float encodedDepth=min(distanceToScene,60.0)/60.0;
        vec3 endpoint=eye+delta;
        vec4 previousClip=previousClipFromWorld*vec4(endpoint,1.0);
        vec2 previousUv=previousClip.xy/max(previousClip.w,.00001)*.5+.5;
        float inFrame=step(.00001,previousClip.w)*step(0.0,previousUv.x)*step(previousUv.x,1.0)*step(0.0,previousUv.y)*step(previousUv.y,1.0);
        vec4 history=texture2D(historyTexture,previousUv);
        float previousDepth=min(length(endpoint-previousEye),60.0)/60.0;
        float stable=(1.0-smoothstep(.002,.01,abs(history.a-previousDepth)))*inFrame;
        // Reproject slowly moving views, but never let stale bright water
        // flood a newly shadowed surface or a disoccluded foreground pixel.
        vec3 boundedHistory=clamp(history.rgb,scatter*.75,scatter*1.25+vec3(.00002));
        scatter=mix(scatter,boundedHistory,historyWeight*stable);
        gl_FragColor=vec4(scatter,encodedDepth);
      }`});
  const bloomUniforms={source:{value:target.texture},direction:{value:new THREE.Vector2()},extract:{value:1}};
  const bloomMaterial=new THREE.ShaderMaterial({name:'Restrained HDR sunlight bloom',depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:bloomUniforms,vertexShader,
    fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform vec2 direction;uniform float extract;
      vec3 highlight(vec2 uv){vec3 c=texture2D(source,uv).rgb;float peak=max(c.r,max(c.g,c.b));return c*mix(1.0,smoothstep(1.1,2.5,peak),extract);}
      void main(){vec3 glow=highlight(vUv)*.227027;
        glow+=(highlight(vUv+direction*1.384615)+highlight(vUv-direction*1.384615))*.316216;
        glow+=(highlight(vUv+direction*3.230769)+highlight(vUv-direction*3.230769))*.070270;
        gl_FragColor=vec4(glow,1.0);
      }`});
  const compositeMaterial=new THREE.ShaderMaterial({name:'Underwater absorption and scattering composite',depthTest:false,depthWrite:false,
    uniforms,vertexShader,
    fragmentShader:`varying vec2 vUv;
      ${mediumShader}
      ${waterGradientShader}
      #include <packing>
      ${sunShadowShader}
      uniform float debugView,previewGain,bloomStrength;
      uniform sampler2D sceneColor,volumeTexture,bloomTexture;
      uniform vec2 volumeSize;
      vec3 upsampleVolume(float distanceToScene){
        vec2 pixel=vUv*volumeSize-.5,base=floor(pixel+.5);
        vec3 result=vec3(0.0);float total=0.0;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
          vec2 offset=vec2(float(x),float(y));
          vec4 sampleValue=texture2D(volumeTexture,(base+offset+.5)/volumeSize);
          vec2 delta=base+offset-pixel;
          float depthDelta=abs(sampleValue.a*60.0-min(distanceToScene,60.0));
          float weight=exp(-dot(delta,delta)*.8)*exp(-depthDelta/max(.15,distanceToScene*.015));
          result+=sampleValue.rgb*weight;total+=weight;
        }
        // No matching depth means a thin foreground silhouette. Borrowing
        // a distant bright water sample here causes pale fringes and flashes.
        return total>.00001?result/total:vec3(0.0);
      }
      void main(){
        float depth=texture2D(sceneDepth,vUv).r;
        vec3 end=worldAt(vUv,depth),delta=end-eye;
        float distanceToScene=length(delta);vec3 direction=delta/max(distanceToScene,.0001);
        vec2 segment=waterInterval(direction,distanceToScene);
        vec3 scattering=upsampleVolume(distanceToScene);
        if(debugView>3.5){gl_FragColor=vec4(scattering,1.0);return;}
        if(debugView>.5&&debugView<1.5){
          gl_FragColor=vec4(vec3(sunVisibility(end)),1.0);return;
        }
        if(debugView>1.5&&debugView<2.5){
          // Display the raw radiance buffer: no scene color, absorption,
          // bloom, exposure or tone mapping. Gain affects this preview only.
          gl_FragColor=vec4(scattering*previewGain,1.0);
          #include <colorspace_fragment>
          return;
        }
        if(debugView>2.5){
          gl_FragColor=vec4(texture2D(sceneColor,vUv).rgb,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }
        float waterDistance=segment.y-segment.x;
        vec3 transmission=exp(-sigmaT*waterDistance);
        // Smooth far-field haze hides the finite seabed's edge. It uses only
        // water path length, so neighbouring plants share the same falloff.
        transmission*=exp(-pow(max(0.0,waterDistance-18.0)*.045,2.0));
        vec3 color=texture2D(sceneColor,vUv).rgb;
        vec3 ambient=mix(waterHorizon,waterGradient(direction),smoothstep(18.0,45.0,distanceToScene));
        ambient*=mix(.28,.85,smoothstep(4.0,26.0,waterDistance))*(1.0-.28*smoothstep(18.0,40.0,waterDistance));
        // Shade the actual wave intersection before attenuating its underwater path.
        // The full-resolution boundary stays crisp independently of volume history.
        float hit=surfaceDistance(direction,distanceToScene);
        if(hit<distanceToScene-.001){
          vec3 point=eye+direction*hit;
          vec3 n=oceanNormal(point.xz,waterTime);
          vec3 lens=worldAt(vUv,0.0);
          bool above=lens.y>waterTop+oceanHeight(lens.xz,waterTime);
          float cosine=clamp(abs(dot(-direction,n)),0.0,1.0);
          float fresnel=.02+.98*pow(1.0-cosine,5.0);
          if(above){
            // The scene below remains visible through the reflective skin.
            vec3 below=color*transmission+ambient*(1.0-transmission)+scattering;
            color=mix(below,oceanSky(reflect(direction,n)),fresnel);
            transmission=vec3(1.0);ambient=vec3(0.0);scattering=vec3(0.0);
          }else{
            float internal=1.0-smoothstep(.64,.70,cosine);
            vec3 sky=oceanSky(refract(direction,-n,1.333));
            color=mix(sky,waterGradient(reflect(direction,-n))*.65,max(fresnel,internal));
          }
        }
        color=color*transmission+ambient*(1.0-transmission)+scattering;
        color+=texture2D(bloomTexture,vUv).rgb*.18*bloomStrength*transmission;
        vec3 lensPoint=worldAt(vUv,0.0);
        float lensDepth=waterTop+oceanHeight(lensPoint.xz,waterTime)-lensPoint.y;
        float meniscus=1.0-smoothstep(.002,.018,abs(lensDepth));
        color=mix(color,color*vec3(.65,.86,.90),meniscus*.45);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const passScene=new THREE.Scene(),passCamera=new THREE.Camera();
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),compositeMaterial);quad.frustumCulled=false;passScene.add(quad);
  const previousView=new THREE.Matrix4(),previousProjection=new THREE.Matrix4(),previousSun=new THREE.Matrix4(),previousFocus=new THREE.Vector3(),sunPosition=new THREE.Vector3(),sunTarget=new THREE.Vector3();
  const currentRotation=new THREE.Quaternion(),previousRotation=new THREE.Quaternion(),previousEye=new THREE.Vector3();
  let historyValid=false,previousTime=0,writeIndex=0,previousLighting='';
  function pass(material,destination){quad.material=material;renderer.setRenderTarget(destination);renderer.render(passScene,passCamera);}
  return {
    resetHistory(){historyValid=false;},
    getDiagnostics(){return {sceneTarget:target,volumeTarget:volumes[1-writeIndex],shadowMatrix:uniforms.sunShadowMatrix.value.clone(),shadowTexture:uniforms.sunShadow.value,historyWeight:uniforms.historyWeight.value};},
    render(scene,camera,draw,{top,bottom,time,sun,focus,debugView=0,previewGain=1,scatteringStrength=1,bloomStrength=1,shaftStrength=1}){
      uniforms.debugView.value=debugView;
      uniforms.previewGain.value=previewGain;
      uniforms.shaftStrength.value=shaftStrength;uniforms.scatteringStrength.value=scatteringStrength;uniforms.bloomStrength.value=bloomStrength;
      camera.updateMatrixWorld();renderer.getDrawingBufferSize(size);
      if(size.x<1||size.y<1){historyValid=false;return;}
      if(target.width!==size.x||target.height!==size.y){
        target.setSize(size.x,size.y);
        for(const rt of volumes)rt.setSize(Math.max(1,Math.ceil(size.x/2)),Math.max(1,Math.ceil(size.y/2)));
        for(const rt of blooms)rt.setSize(Math.max(1,Math.ceil(size.x/4)),Math.max(1,Math.ceil(size.y/4)));
        historyValid=false;
      }
      uniforms.worldFromClip.value.copy(camera.projectionMatrixInverse).premultiply(camera.matrixWorld);
      uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld);
      uniforms.waterTop.value=top;uniforms.floorY.value=bottom;uniforms.waterTime.value=time;
      sunlight.waterSurface.value=top;
      if(focus)uniforms.lightFocus.value.copy(focus);
      else uniforms.lightFocus.value.set(0,bottom+(top-bottom-.25)*.46,2.6);
      const fog=scene.fog,previous=renderer.getRenderTarget(),autoClear=renderer.autoClear;
      renderer.getViewport(viewport);renderer.getScissor(scissor);const scissorTest=renderer.getScissorTest();
      try{
        scene.fog=null;renderer.autoClear=true;renderer.setScissorTest(false);
        renderer.setRenderTarget(target);draw();scene.fog=fog;
        // The scene draw creates/updates the sun map using the animated custom
        // depth materials, including the same bite mask as the visible leaves.
        const shadow=sun?.shadow;
        uniforms.shadowEnabled.value=sun?.castShadow&&shadow?.map?1:0;
        uniforms.sunShadow.value=shadow?.map?.texture??white;
        if(sun){
          sun.getWorldPosition(sunPosition);sun.target.getWorldPosition(sunTarget);
          uniforms.sunDirection.value.subVectors(sunPosition,sunTarget).normalize();
          uniforms.sunRadiance.value.copy(sun.color).multiplyScalar(sun.intensity);
        }else uniforms.sunRadiance.value.setRGB(0,0,0);
        if(shadow){
          uniforms.sunShadowMatrix.value.copy(shadow.matrix);uniforms.shadowBias.value=shadow.bias;
          uniforms.sunTexel.value.set(1/(shadow.map?.width??1),1/(shadow.map?.height??1));
          uniforms.shadowStrength.value=shadow.intensity;
          uniforms.shadowRadius.value=shadow.radius;
        }
        const stableCamera=previousView.equals(camera.matrixWorld)&&previousProjection.equals(camera.projectionMatrix);
        currentRotation.setFromRotationMatrix(camera.matrixWorld);
        const slowCamera=uniforms.eye.value.distanceToSquared(previousEye)<.25*.25&&currentRotation.angleTo(previousRotation)<.035&&previousProjection.equals(camera.projectionMatrix);
        const lighting=[top,bottom,debugView,scatteringStrength,shaftStrength,uniforms.sunRadiance.value.r,uniforms.sunRadiance.value.g,uniforms.sunRadiance.value.b,uniforms.shadowStrength.value,uniforms.shadowRadius.value,uniforms.shadowBias.value,uniforms.sunTexel.value.x,uniforms.sunTexel.value.y].join(':');
        const stableLighting=previousSun.equals(uniforms.sunShadowMatrix.value)&&previousFocus.equals(uniforms.lightFocus.value)&&lighting===previousLighting;
        uniforms.historyWeight.value=historyValid&&stableLighting&&(stableCamera||slowCamera)&&time>previousTime&&time-previousTime<.15?(stableCamera?.45:.18):0;
        uniforms.historyTexture.value=volumes[1-writeIndex].texture;
        const volume=volumes[writeIndex];uniforms.volumeSize.value.set(volume.width,volume.height);
        pass(volumeMaterial,volume);uniforms.volumeTexture.value=volume.texture;
        if(debugView===0){
          bloomUniforms.source.value=target.texture;bloomUniforms.extract.value=1;bloomUniforms.direction.value.set(1/blooms[0].width,0);
          pass(bloomMaterial,blooms[0]);
          bloomUniforms.source.value=blooms[0].texture;bloomUniforms.extract.value=0;bloomUniforms.direction.value.set(0,1/blooms[0].height);
          pass(bloomMaterial,blooms[1]);
        }
        renderer.setRenderTarget(previous);renderer.setViewport(viewport);quad.material=compositeMaterial;renderer.render(passScene,passCamera);
        previousView.copy(camera.matrixWorld);previousProjection.copy(camera.projectionMatrix);previousSun.copy(uniforms.sunShadowMatrix.value);previousFocus.copy(uniforms.lightFocus.value);
        uniforms.previousClipFromWorld.value.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
        uniforms.previousEye.value.copy(uniforms.eye.value);previousEye.copy(uniforms.eye.value);previousRotation.copy(currentRotation);
        previousLighting=lighting;previousTime=time;historyValid=true;writeIndex=1-writeIndex;
      }catch(error){historyValid=false;throw error;}
      finally{
        scene.fog=fog;renderer.autoClear=autoClear;renderer.setRenderTarget(previous);
        renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
      }
    },
    dispose(){target.dispose();for(const rt of [...volumes,...blooms])rt.dispose();white.dispose();quad.geometry.dispose();for(const m of [volumeMaterial,bloomMaterial,compositeMaterial])m.dispose();},
  };
}

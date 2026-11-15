import * as THREE from 'three';
import {desertMetersPerUnit,jeddahHeightMeters} from './desert-landmark.js';

export function createDesertMirage({renderer,landmark,reducedMotion=false}){
  const resolution=new THREE.Vector2(),base=new THREE.Vector3(),edge=new THREE.Vector3(),right=new THREE.Vector3();
  const viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
  const uniforms={
    uScene:{value:null},uDepth:{value:null},uResolution:{value:new THREE.Vector2(1,1)},
    uBase:{value:new THREE.Vector2()},uSize:{value:new THREE.Vector2()},uCamera:{value:new THREE.Vector2()},
    uTime:{value:0},uStrength:{value:.7},uTint:{value:new THREE.Color(0xb7c9cc)},uFogColor:{value:new THREE.Color()},uFogDensity:{value:0},
    uWorldFromClip:{value:new THREE.Matrix4()},uTowerBase:{value:new THREE.Vector3()},uTowerHeight:{value:jeddahHeightMeters/desertMetersPerUnit},uSkyToneMapped:{value:0}
  };
  const material=new THREE.ShaderMaterial({name:'Desert heat mirage',depthTest:false,depthWrite:false,blending:THREE.NoBlending,
    uniforms,
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader:`varying vec2 vUv;
      uniform sampler2D uScene,uDepth;
      uniform vec2 uResolution,uBase,uSize,uCamera;
      uniform float uTime,uStrength,uFogDensity;
      uniform vec3 uTint,uFogColor;
      uniform mat4 uWorldFromClip;
      uniform vec3 uTowerBase;
      uniform float uTowerHeight;
      uniform float uSkyToneMapped;
      float viewDepth(vec2 uv){
        float z=texture2D(uDepth,uv).r;
        return uCamera.x*uCamera.y/(uCamera.y-z*(uCamera.y-uCamera.x));
      }
      vec3 sceneColor(vec2 uv){
        float depth=viewDepth(uv);
        vec3 rgb=texture2D(uScene,uv).rgb;
        bool geometry=depth<uCamera.y*.999;
        // Match the normal scene path: HDR Sky and geometry are tone mapped;
        // atmospheric fog is blended after tone mapping and encoding.
        #ifdef TONE_MAPPING
          if(geometry||uSkyToneMapped>.5)rgb=toneMapping(rgb);
        #endif
        rgb=linearToOutputTexel(vec4(rgb,1.0)).rgb;
        if(geometry){
          float density=uFogDensity;
          if(depth>200.0){
            vec4 world=uWorldFromClip*vec4(uv*2.0-1.0,texture2D(uDepth,uv).r*2.0-1.0,1.0);world/=world.w;
            float tower=1.0-smoothstep(24.0,55.0,length(world.xz-uTowerBase.xz));
            float elevation=clamp((world.y-uTowerBase.y)/uTowerHeight,0.0,1.0);
            density*=mix(1.0,mix(1.35,.65,smoothstep(0.0,.9,elevation)),tower);
          }
          float fog=1.0-exp(-density*density*depth*depth);rgb=mix(rgb,uFogColor,fog);
        }
        return rgb;
      }
      void main(){
        vec2 p=(vUv-uBase)/uSize;
        float farMask=smoothstep(60.0,160.0,viewDepth(vUv));
        float widthMask=exp(-pow(abs(p.x),4.0)*1.8);
        float heat=widthMask*exp(-p.y*p.y*.065)*smoothstep(-1.5,-.2,p.y)*farMask*uStrength;
        float row=(vUv.y-uBase.y)*uResolution.y;
        float wave=sin(row*1.7+uTime*2.3+vUv.x*37.0)+.45*sin(row*.63-uTime*1.4+vUv.x*61.0);
        vec2 bend=vec2(wave*1.6,sin(row*.9+uTime*1.8)*.35)*heat/uResolution;
        vec2 sampleUv=clamp(vUv+bend,vec2(.001),vec2(.999));
        // Never smear the nearby palm into the distant heat layer.
        if(viewDepth(sampleUv)<60.0)sampleUv=vUv;
        vec3 color=sceneColor(sampleUv);
        float pool=widthMask*(1.0-smoothstep(-.12,.15,p.y))*smoothstep(-1.25,-.35,p.y)*farMask;
        vec2 reflectedUv=vec2(vUv.x+bend.x*1.6,uBase.y+(uBase.y-vUv.y)*5.0+bend.y);
        reflectedUv=clamp(reflectedUv,vec2(.001),vec2(.999));
        vec2 blur=vec2(1.5,.4)/uResolution;
        vec3 reflected=(sceneColor(reflectedUv)*.5+sceneColor(reflectedUv+blur)*.25+sceneColor(reflectedUv-blur)*.25);
        reflected=mix(reflected,uTint,.18);
        pool*=smoothstep(60.0,160.0,viewDepth(reflectedUv));
        float ripples=.88+.12*sin(row*2.2+uTime*1.6+sin(vUv.x*90.0));
        color=mix(color,reflected,pool*uStrength*.8*ripples);
        gl_FragColor=vec4(color,1.0);
      }`
  });
  const passScene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material),passCamera=new THREE.Camera();
  quad.frustumCulled=false;passScene.add(quad);
  let target=null,enabled=false;
  function render(scene,camera,draw){
    if(!enabled||!landmark.visible||!landmark.children.length){draw();return;}
    camera.updateMatrixWorld();
    landmark.getWorldPosition(base);uniforms.uTowerBase.value.copy(base);right.setFromMatrixColumn(camera.matrixWorld,0);
    uniforms.uWorldFromClip.value.copy(camera.projectionMatrixInverse).premultiply(camera.matrixWorld);
    edge.copy(base).addScaledVector(right,120).project(camera);base.project(camera);
    if(base.z< -1||base.z>1||Math.abs(base.x)>1.8||Math.abs(base.y)>1.8){draw();return;}
    const previousTarget=renderer.getRenderTarget();
    if(previousTarget)resolution.set(previousTarget.width,previousTarget.height);else renderer.getDrawingBufferSize(resolution);
    if(!target){
      target=new THREE.WebGLRenderTarget(resolution.x,resolution.y,{
        type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,
        samples:Math.min(4,renderer.capabilities.maxSamples),depthBuffer:true,stencilBuffer:false
      });
      target.depthTexture=new THREE.DepthTexture(resolution.x,resolution.y,THREE.UnsignedIntType);
      target.texture.name='Linear desert scene';uniforms.uScene.value=target.texture;uniforms.uDepth.value=target.depthTexture;
    }else if(target.width!==resolution.x||target.height!==resolution.y)target.setSize(resolution.x,resolution.y);
    uniforms.uResolution.value.copy(resolution);uniforms.uCamera.value.set(camera.near,camera.far);
    uniforms.uSkyToneMapped.value=scene.userData.skyToneMapped?1:0;
    const fog=scene.fog;
    uniforms.uFogDensity.value=fog?.isFogExp2?fog.density:0;
    if(fog)uniforms.uFogColor.value.copy(fog.color);
    uniforms.uTint.value.set(0xb7c9cc);
    if(!previousTarget&&renderer.outputColorSpace===THREE.SRGBColorSpace){uniforms.uFogColor.value.convertLinearToSRGB();uniforms.uTint.value.convertLinearToSRGB();}
    uniforms.uBase.value.set(base.x*.5+.5,base.y*.5+.5);
    const width=Math.max(.015,Math.abs(edge.x-base.x)*.5);
    uniforms.uSize.value.set(width,Math.max(2/resolution.y,width*resolution.x/resolution.y*.1));
    renderer.getViewport(viewport);renderer.getScissor(scissor);const scissorTest=renderer.getScissorTest(),autoClear=renderer.autoClear;
    try{
      renderer.setScissorTest(false);renderer.autoClear=true;
      renderer.setRenderTarget(target);scene.fog=null;draw();scene.fog=fog;
      renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);
      renderer.render(passScene,passCamera);
    }finally{
      scene.fog=fog;renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.autoClear=autoClear;
    }
  }
  return {render,setEnabled(value){enabled=!!value;},setStrength(value){uniforms.uStrength.value=THREE.MathUtils.clamp(value,0,1);},
    get enabled(){return enabled;},get strength(){return uniforms.uStrength.value;},get time(){return uniforms.uTime.value;},
    advance(dt){if(!enabled||!landmark.visible||!landmark.children.length||reducedMotion||uniforms.uStrength.value===0||!(dt>0))return false;uniforms.uTime.value+=Math.min(dt,.05);return true;},
    dispose(){target?.dispose();quad.geometry.dispose();material.dispose();enabled=false;}
  };
}

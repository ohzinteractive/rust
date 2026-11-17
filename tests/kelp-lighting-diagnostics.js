import * as THREE from 'three';

export function readKelpLightingDiagnostics({renderer,environment,scene,attractor,renderScene}){
  // The browser may discard the default framebuffer between tasks.
  renderScene();
  const debug=environment.getLightingDiagnostics(),size=renderer.getDrawingBufferSize(new THREE.Vector2());
  const pixels=new Uint8Array(size.x*size.y*4),gl=renderer.getContext();gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let luminance=0,black=0,white=0;
  for(let i=0;i<pixels.length;i+=4){const value=(pixels[i]+pixels[i+1]+pixels[i+2])/3;luminance+=value;if(value<2)black++;if(value>253)white++;}
  const target=debug.volumeTarget;
  const buffer=target.texture.type===THREE.HalfFloatType?new Uint16Array(target.width*target.height*4):new Uint8Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,buffer);
  const decode=value=>target.texture.type===THREE.HalfFloatType?THREE.DataUtils.fromHalfFloat(value):value/255;
  let total=0,peak=0,nonzero=0;
  for(let i=0;i<buffer.length;i+=4){let light=0;for(let c=0;c<3;c++){const value=decode(buffer[i+c]);if(!Number.isFinite(value))throw Error('Non-finite volume light');peak=Math.max(peak,value);light+=value/3;}total+=light;if(light>.00001)nonzero++;}
  const sun=scene.children.find(o=>o.isDirectionalLight&&o.castShadow),matrixError=Math.max(...debug.shadowMatrix.elements.map((value,i)=>Math.abs(value-sun.shadow.matrix.elements[i])));
  let shapeInsideShadowFrustum=true;
  if(attractor.hasShape){
    const box=attractor.bounds,p=new THREE.Vector3();
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      p.set(x,y,z).applyMatrix4(debug.shadowMatrix);if(p.x<=0||p.x>=1||p.y<=0||p.y>=1||p.z<=0||p.z>=1)shapeInsideShadowFrustum=false;
    }
  }
  return {meanBrightness:luminance/(size.x*size.y),blackFraction:black/(size.x*size.y),whiteFraction:white/(size.x*size.y),volumeMean:total/(target.width*target.height),volumePeak:peak,volumeNonzeroFraction:nonzero/(target.width*target.height),matrixError,shadowTextureMatches:debug.shadowTexture===sun.shadow.map.texture,shapeInsideShadowFrustum,exposure:renderer.toneMappingExposure,sunIntensity:sun.intensity};
}

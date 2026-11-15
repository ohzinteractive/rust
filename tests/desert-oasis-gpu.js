import * as THREE from 'three';

export function checkDesertOasis({renderer,scene,camera,renderScene,oasis}){
  const size=renderer.getDrawingBufferSize(new THREE.Vector2()),gl=renderer.getContext(),water=oasis.water;
  function pixels(draw){draw();const data=new Uint8Array(size.x*size.y*4);gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
  function changes(a,b){let count=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>3)count++;return count;}
  pixels(renderScene);const on=pixels(renderScene),center=water.getWorldPosition(new THREE.Vector3()).project(camera);
  const index=(Math.round((center.y*.5+.5)*size.y)*size.x+Math.round((center.x*.5+.5)*size.x))*4;
  const poolColor=Array.from(on.slice(index,index+3));
  const shallows=water.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(4.7*.78*Math.cos(Math.PI/4),0,2.8*.78*Math.sin(Math.PI/4))).project(camera);
  const shallowIndex=(Math.round((shallows.y*.5+.5)*size.y)*size.x+Math.round((shallows.x*.5+.5)*size.x))*4;
  const shallowColor=Array.from(on.slice(shallowIndex,shallowIndex+3));
  const key=scene.children.find(light=>light.isDirectionalLight&&light.castShadow),shadowIntensity=key.shadow.intensity;
  key.shadow.intensity=0;const unshadowed=pixels(renderScene);key.shadow.intensity=shadowIntensity;
  let strongShadowPixels=0;
  for(let i=0;i<on.length;i+=4)if((unshadowed[i]+unshadowed[i+1]+unshadowed[i+2]-on[i]-on[i+1]-on[i+2])/3>40)strongShadowPixels++;
  water.visible=false;const off=pixels(renderScene);water.visible=true;
  const time=water.material.uniforms.uTime.value;water.material.uniforms.uTime.value=time+1.2;const ripples=pixels(renderScene);water.material.uniforms.uTime.value=time;
  const copy=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2),material=new THREE.MeshBasicMaterial({map:water.getRenderTarget().texture,toneMapped:false,depthTest:false,depthWrite:false});
  copy.add(new THREE.Mesh(geometry,material));const copyCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,2);copyCamera.position.z=1;
  const reflected=pixels(()=>renderer.render(copy,copyCamera));let reflectedPalms=0;
  for(let i=0;i<reflected.length;i+=4)if(reflected[i+1]>reflected[i]*1.08&&reflected[i+1]>reflected[i+2]*1.08&&reflected[i+1]<210)reflectedPalms++;
  geometry.dispose();material.dispose();renderScene();
  return {poolColor,shallowColor,strongShadowPixels,waterPixels:changes(on,off),ripplePixels:changes(on,ripples),reflectedPalms,reflectionRenders:oasis.stats.reflectionRenders};
}

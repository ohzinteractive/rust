import * as THREE from 'three';

export function checkDarkBackdrop(renderer,backdrop){
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
  camera.position.z=3;camera.updateMatrixWorld();
  const material=new THREE.MeshPhysicalMaterial({color:0xffffff,transmission:1,roughness:0,thickness:0,ior:1});
  const geometry=new THREE.PlaneGeometry(2,2);scene.add(new THREE.Mesh(geometry,material));
  const target=new THREE.WebGLRenderTarget(32,32),previousTarget=renderer.getRenderTarget();
  const previousColor=renderer.getClearColor(new THREE.Color()),previousAlpha=renderer.getClearAlpha();
  function sample(background){
    scene.background=background;renderer.setRenderTarget(target);renderer.render(scene,camera);
    const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,16,16,1,1,pixel);return Array.from(pixel);
  }
  try{
    // Deliberately reproduce the former transparent clear, then verify that
    // the app's explicit backdrop also works in the refraction render target.
    renderer.setClearColor(previousColor,0);
    const transparent=sample(null),dark=sample(backdrop);
    return {transparent,dark,explicit:!!backdrop?.isColor};
  }finally{
    renderer.setRenderTarget(previousTarget);renderer.setClearColor(previousColor,previousAlpha);
    target.dispose();geometry.dispose();material.dispose();
  }
}

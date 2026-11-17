import * as THREE from 'three';

export function createFernStage({scene,ground,key,rim,fill,skyLight}){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(155,155,5,140,140,180);
  gradient.addColorStop(0,'#1c2b20');gradient.addColorStop(.55,'#111c16');gradient.addColorStop(1,'#090f0c');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
  const background=new THREE.CanvasTexture(canvas);background.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshStandardMaterial({color:0x253024,roughness:1});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSoilWorld;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvSoilWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vSoilWorld;
      float soilNoise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float soil(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(soilNoise(i),soilNoise(i+vec2(1,0)),f.x),mix(soilNoise(i+vec2(0,1)),soilNoise(i+vec2(1,1)),f.x),f.y);}
    `).replace('#include <color_fragment>',`#include <color_fragment>
      float soilPatch=soil(vSoilWorld.xz*2.3),grain=soil(vSoilWorld.xz*85.0);
      diffuseColor.rgb*=mix(vec3(.52,.43,.29),vec3(.66,.85,.48),smoothstep(.32,.78,soilPatch))*(.85+.15*grain);
    `).replace('#include <dithering_fragment>',`#include <dithering_fragment>
      float distanceFade=1.0-exp(-pow(length(vSoilWorld.xz-cameraPosition.xz)/25.0,2.0));
      gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.035,.059,.047),distanceFade);
    `);
  };
  const litter=new THREE.InstancedMesh(new THREE.CircleGeometry(.045,5),new THREE.MeshStandardMaterial({color:0x514632,roughness:1,side:THREE.DoubleSide}),28);
  const dummy=new THREE.Object3D();
  for(let i=0;i<28;i++){
    const angle=i*2.39996,r=.18+((i*17)%29)/29*.75;
    dummy.position.set(Math.cos(angle)*r,ground.position.y+.003+i*.00003,Math.sin(angle)*r);
    dummy.rotation.set(-Math.PI/2,0,angle);dummy.scale.set(.5+(i%4)*.25,.18+(i%3)*.12,1);dummy.updateMatrix();litter.setMatrixAt(i,dummy.matrix);
  }
  litter.receiveShadow=true;litter.visible=false;scene.add(litter);
  let saved=null;
  return {setEnabled(enabled){
    litter.visible=enabled;
    if(enabled&&!saved){
      saved={background:scene.background,material:ground.material,lights:[key,rim,fill,skyLight].map(l=>l.intensity),radius:key.shadow.radius};
      scene.background=background;ground.material=material;
      key.intensity=1.9;rim.intensity=.8;fill.intensity=.18;skyLight.intensity=.65;key.shadow.radius=5;
    }else if(!enabled&&saved){
      scene.background=saved.background;ground.material=saved.material;[key,rim,fill,skyLight].forEach((l,i)=>l.intensity=saved.lights[i]);key.shadow.radius=saved.radius;saved=null;
    }
  }};
}

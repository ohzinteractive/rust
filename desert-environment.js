import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';
import {addWindShapedSand} from './desert-sand.js';
import {Sky} from './vendor/Sky.js';

export const defaultDesertSunSettings=Object.freeze({elevation:10,azimuth:322});

function createHorizonDunes(floorY){
  const positions=[],colors=[],indices=[],segments=256,rows=10,color=new THREE.Color();
  for(let row=0;row<=rows;row++)for(let i=0;i<=segments;i++){
    const t=row/rows,angle=i/segments*Math.PI*2,radius=220+t*300;
    const crest=3.7+1.1*Math.sin(angle*13)+.65*Math.sin(angle*29+.8)+.35*Math.sin(angle*47);
    const height=Math.pow(Math.sin(t*Math.PI),1.6)*crest;
    positions.push(Math.cos(angle)*radius,floorY+.002+height,Math.sin(angle)*radius);
    color.set(0xffffff).multiplyScalar(1-.025*Math.sin(t*Math.PI));colors.push(color.r,color.g,color.b);
    if(row<rows&&i<segments){const a=row*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xcab28d,vertexColors:true,roughness:1}));mesh.name='Distant desert dunes';return mesh;
}

function makeSandTexture(){
  const size=512,data=new Uint8Array(size*size*4),random=seededRandom(4197);
  const grids=[4,13,64].map(cells=>({cells,values:Float32Array.from({length:cells*cells},()=>random())}));
  function noise(x,y,{cells,values}){
    const px=x/size*cells,py=y/size*cells,ix=Math.floor(px),iy=Math.floor(py);
    const ux=px-ix,uy=py-iy,sx=ux*ux*(3-2*ux),sy=uy*uy*(3-2*uy);
    const at=(a,b)=>values[(b%cells)*cells+a%cells];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(ix,iy),at(ix+1,iy),sx),THREE.MathUtils.lerp(at(ix,iy+1),at(ix+1,iy+1),sx),sy)-.5;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const broad=noise(x,y,grids[0]),medium=noise(x,y,grids[1]),fine=noise(x,y,grids[2]);
    const grain=(random()-.5)*14,pebble=random()>.997?-24:0;
    const variation=broad*16+medium*10+fine*5+grain+pebble,i=(y*size+x)*4;
    data[i]=202+variation;data[i+1]=178+variation;data[i+2]=141+variation;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  texture.name='Fine desert sand';texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(40,40);
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

// Keep the setting scoped to the palm; leaving it restores the exact studio
// materials, lighting and fog, including settings used by the maze and cloth.
export function createDesertEnvironment({scene,renderer,ground,shadow,skyLight,key,rim,fill,sunSettings:initialSun={}}){
  let saved=null,sand=null,sky=null,material=null,horizon=null;
  const sunSettings={...defaultDesertSunSettings},sunDirection=new THREE.Vector3();
  const lights=[skyLight,key,rim,fill];
  function setSunSettings(values={}){
    if(Number.isFinite(values.elevation))sunSettings.elevation=THREE.MathUtils.clamp(values.elevation,1,85);
    if(Number.isFinite(values.azimuth))sunSettings.azimuth=THREE.MathUtils.clamp(values.azimuth,0,360);
    sunDirection.setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-sunSettings.elevation),THREE.MathUtils.degToRad(sunSettings.azimuth));
    if(sky)sky.material.uniforms.sunPosition.value.copy(sunDirection);
    if(saved){
      key.position.copy(sunDirection).multiplyScalar(30).add(key.target.position);
      const daylight=THREE.MathUtils.smoothstep(sunSettings.elevation,2,25);
      key.color.set(0xffbd7b).lerp(new THREE.Color(0xffedd0),daylight);
      scene.fog.color.set(0xe1ba94).lerp(new THREE.Color(0xe5e2d5),daylight);
      renderer.shadowMap.needsUpdate=true;key.shadow.needsUpdate=true;
    }
  }
  setSunSettings(initialSun);
  function setEnabled(enabled){
    if(enabled===!!saved)return;
    if(enabled){
      saved={background:scene.background,fog:scene.fog,environment:scene.environmentIntensity,exposure:renderer.toneMappingExposure,skyToneMapped:scene.userData.skyToneMapped,
        material:ground.material,groundScale:ground.scale.clone(),shadow:shadow.visible,radius:key.shadow.radius,shadowType:renderer.shadowMap.type,
        shadowBounds:[key.shadow.camera.left,key.shadow.camera.right,key.shadow.camera.top,key.shadow.camera.bottom,key.shadow.camera.far],
        lights:lights.map(light=>({intensity:light.intensity,color:light.color.clone(),groundColor:light.groundColor?.clone(),position:light.position.clone()}))};
      if(!material){
        sand=makeSandTexture();sand.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        sky=new Sky();sky.name='Desert sky';sky.scale.setScalar(3000);sky.frustumCulled=false;sky.renderOrder=-10000;
        sky.material.uniforms.turbidity.value=10;sky.material.uniforms.rayleigh.value=.5;
        sky.material.uniforms.mieCoefficient.value=.01;sky.material.uniforms.mieDirectionalG.value=.8;scene.add(sky);
        material=addWindShapedSand(new THREE.MeshStandardMaterial({name:'Pale desert sand',map:sand,bumpMap:sand,bumpScale:.006,roughness:1,metalness:0}));
        horizon=createHorizonDunes(ground.position.y);scene.add(horizon);
      }
      horizon.visible=true;sky.visible=true;
      ground.material=material;ground.scale.set(20,20,1);sand.repeat.set(800,800);shadow.visible=false;
      scene.background=new THREE.Color(0xe5e2d5);scene.fog=new THREE.FogExp2(0xe5e2d5,.0012);scene.userData.skyToneMapped=true;
      scene.environmentIntensity=.25;renderer.toneMappingExposure=.92;
      skyLight.color.set(0xe0edf5);skyLight.groundColor.set(0xc9ae83);skyLight.intensity=.65;
      key.color.set(0xffedd0);key.intensity=3.8;key.shadow.radius=.65;
      renderer.shadowMap.type=THREE.PCFShadowMap;
      Object.assign(key.shadow.camera,{left:-14,right:14,top:14,bottom:-14,far:80});key.shadow.camera.updateProjectionMatrix();
      rim.color.set(0xdce7e6);rim.intensity=.18;
      fill.color.set(0xffe6bf);fill.intensity=.1;
      setSunSettings();
    }else{
      scene.background=saved.background;scene.fog=saved.fog;scene.environmentIntensity=saved.environment;
      horizon.visible=false;sky.visible=false;
      if(saved.skyToneMapped===undefined)delete scene.userData.skyToneMapped;else scene.userData.skyToneMapped=saved.skyToneMapped;
      renderer.toneMappingExposure=saved.exposure;ground.material=saved.material;ground.scale.copy(saved.groundScale);shadow.visible=saved.shadow;key.shadow.radius=saved.radius;
      renderer.shadowMap.type=saved.shadowType;
      [key.shadow.camera.left,key.shadow.camera.right,key.shadow.camera.top,key.shadow.camera.bottom,key.shadow.camera.far]=saved.shadowBounds;key.shadow.camera.updateProjectionMatrix();
      lights.forEach((light,i)=>{light.intensity=saved.lights[i].intensity;light.color.copy(saved.lights[i].color);light.position.copy(saved.lights[i].position);if(light.groundColor)light.groundColor.copy(saved.lights[i].groundColor);});
      saved=null;
    }
    const materials=new Set();scene.traverse(object=>{for(const material of [object.material].flat().filter(Boolean))materials.add(material);});
    materials.forEach(material=>{material.needsUpdate=true;});renderer.shadowMap.needsUpdate=true;
  }
  return {setEnabled,setSunSettings,get sunSettings(){return {...sunSettings};},get sunDirection(){return sunDirection.clone();},get sky(){return sky;},get enabled(){return !!saved;},
    dispose(){setEnabled(false);sand?.dispose();sky?.geometry.dispose();sky?.material.dispose();sky?.removeFromParent();material?.dispose();horizon?.geometry.dispose();horizon?.material.dispose();horizon?.removeFromParent();}};
}

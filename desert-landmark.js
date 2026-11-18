import * as THREE from 'three';
import {createGLTFLoader} from './gltf-loader.js';

// The roughly four-unit palm is about twenty meters tall. Keep the distant
// kilometer-high landmark in that same coordinate system.
export const desertMetersPerUnit=5;
export const jeddahHeightMeters=1000;

function disposeRoot(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of [object.material].flat().filter(Boolean))materials.add(material);
  });
  for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  textures.forEach(texture=>texture.dispose());materials.forEach(material=>material.dispose());geometries.forEach(geometry=>geometry.dispose());
}

export function createDesertLandmark({scene,floorY=-1.75,invalidate=()=>{},notify=()=>{},loader=createGLTFLoader()}){
  const group=new THREE.Group();group.name='Jeddah building';group.visible=false;
  group.position.set(-465,floorY,-308);group.userData.heightMeters=jeddahHeightMeters;
  scene.add(group);
  let pending=null,disposed=false;
  function load(){
    if(pending)return pending;
    pending=loader.loadAsync(new URL('./samples/jeddah.glb',import.meta.url).href).then(gltf=>{
      const root=gltf.scene;
      if(disposed){disposeRoot(root);return;}
      root.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(root),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      if(!(size.y>0)||!Number.isFinite(size.y)){disposeRoot(root);throw new Error('The building has no height');}
      const scale=jeddahHeightMeters/desertMetersPerUnit/size.y;
      const content=new THREE.Group();content.name='Jeddah tower model';content.scale.setScalar(scale);
      content.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
      root.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
      content.add(root);group.add(content);group.updateMatrixWorld(true);invalidate();
      return root;
    }).catch(()=>{
      pending=null;
      if(!disposed&&group.visible)notify('Could not load the Jeddah building.');
      return null;
    });
    return pending;
  }
  return {group,load,setVisible(visible){if(disposed)return;group.visible=visible;if(visible)load();},
    dispose(){disposed=true;group.removeFromParent();disposeRoot(group);group.clear();}};
}

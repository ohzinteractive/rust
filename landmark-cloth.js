import * as THREE from 'three';
import {createClothSurface} from './cloth-surface.js';

// Keep the existing solver's contact distances and time steps in their usual
// range. Only the rendered drape is scaled back to the landmark's world size.
export function createLandmarkCloth({scene,onSettle=()=>{}}){
  const group=new THREE.Group();group.name='Jeddah tower cloth';group.visible=false;scene.add(group);
  const surface=createClothSurface({scene:group,floorY:0,onSettle});
  function rebuild(root,settings={}){
    root.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(root,true),height=bounds.max.y-bounds.min.y;
    if(!(height>0)||!Number.isFinite(height))throw new Error('The tower has no height to drape.');
    const center=bounds.getCenter(new THREE.Vector3()),scale=height/3;
    group.position.set(center.x,bounds.min.y,center.z);group.scale.setScalar(scale);
    const toLocal=new THREE.Matrix4().makeScale(1/scale,1/scale,1/scale)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z));
    const meshes=[];
    root.traverse(object=>{
      if(!object.isMesh||!object.geometry?.attributes.position)return;
      // Borrow geometry and materials without moving, reparenting or disposing
      // anything owned by the GLB. This also retains instanced mesh transforms.
      const proxy=object.clone(false);proxy.matrixAutoUpdate=false;
      proxy.matrix.multiplyMatrices(toLocal,object.matrixWorld);meshes.push(proxy);
    });
    surface.rebuild(meshes,{...settings,radial:true});group.visible=!!surface.mesh;group.updateMatrixWorld(true);
  }
  return {group,surface,rebuild,clear(){surface.clear();group.visible=false;},dispose(){surface.dispose();group.removeFromParent();}};
}

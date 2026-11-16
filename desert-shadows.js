import * as THREE from 'three';

// A low desert sun sends a kilometer tower's shadow far downwind. Its ground
// projection shares the caster's light-space XY footprint, but needs a much
// deeper shadow camera than the nearby palms.
export function fitDesertShadow(light,bounds,direction,floorY){
  const rotation=new THREE.Matrix4().lookAt(direction,new THREE.Vector3(),new THREE.Vector3(0,1,0)).invert();
  const lightBounds=bounds.clone().applyMatrix4(rotation),center=bounds.getCenter(new THREE.Vector3());
  const point=new THREE.Vector3();let nearestGround=lightBounds.min.z;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    point.set(x,y,z).addScaledVector(direction,-Math.max(0,(y-floorY)/direction.y)).applyMatrix4(rotation);
    nearestGround=Math.min(nearestGround,point.z);
  }
  const size=lightBounds.getSize(new THREE.Vector3()),padding=Math.max(.5,(bounds.max.y-bounds.min.y)*.025);
  light.target.position.copy(center);light.target.updateMatrixWorld(true);
  const centerDepth=point.copy(center).applyMatrix4(rotation).z;
  light.position.copy(center).addScaledVector(direction,lightBounds.max.z-centerDepth+padding);
  Object.assign(light.shadow.camera,{left:-size.x/2-padding,right:size.x/2+padding,
    bottom:-size.y/2-padding,top:size.y/2+padding,near:.5,far:lightBounds.max.z-nearestGround+padding*2});
  // Keep depth bias in world units as the shadow camera becomes much deeper.
  light.shadow.bias=-Math.min(.0004,.02/(light.shadow.camera.far-light.shadow.camera.near));
  light.shadow.camera.updateProjectionMatrix();
}

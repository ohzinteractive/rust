import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {fitDesertShadow}=await import('../desert-shadows.js');

test('the shadow camera covers a kilometer tower and its full ground projection as the sun moves',()=>{
  const scene=new THREE.Scene(),light=new THREE.DirectionalLight();scene.add(light);
  const bounds=new THREE.Box3(new THREE.Vector3(-477,-1.75,-320),new THREE.Vector3(-453,198.25,-296));
  for(const elevation of [1,10,47,85])for(const azimuth of [0,145,240,322]){
    const direction=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-elevation),THREE.MathUtils.degToRad(azimuth));
    fitDesertShadow(light,bounds,direction,-1.75);scene.updateMatrixWorld(true);light.shadow.updateMatrices(light);
    assert(light.position.clone().sub(light.target.position).normalize().distanceTo(direction)<1e-9,'Fitting keeps the light aligned with the sky sun');
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      const caster=new THREE.Vector3(x,y,z),ground=caster.clone().addScaledVector(direction,-(y+1.75)/direction.y);
      for(const point of [caster,ground]){
        point.project(light.shadow.camera);
        assert(Math.max(Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))<=1.000001,`Shadow coverage at ${elevation}° / ${azimuth}°`);
      }
    }
    if(elevation===10)assert(light.shadow.camera.far>1000,'Low sunlight needs a deep volume for the long ground shadow');
    assert(light.shadow.bias<0&&Math.abs(light.shadow.bias)*(light.shadow.camera.far-light.shadow.camera.near)<=.020001,'Bias stays small in world space despite the long shadow');
  }
});

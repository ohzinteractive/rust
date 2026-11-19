import * as THREE from 'three';
import {createFern} from './fern.js';
import {createFernCanopyLODs} from './fern-lod.js';
import {createFernGrowthMaterials} from './fern-growth.js';
import {seededRandom} from './plume-lsystem/random.js';

// Fixed plantings share the fern scene's fiddlehead and frond animation.
// Each site supplies its own root and start time, with no dispersal system.
export function createFernPlanting(parent,sites,{seed=7319,fronds=8,length=1.15,minimumCrownSize=.35,regrow=false}={}){
  const templateGroup=new THREE.Group();
  const template=createFern({scene:templateGroup,floorY:0});
  template.rebuild({seed,fronds,length,density:.42});
  const [near,medium,geometry]=createFernCanopyLODs(template,0);
  near.dispose();
  medium.dispose();
  const growth=createFernGrowthMaterials(template,null,{minimumCrownSize});
  template.dispose();

  const life=new Float32Array(sites.length*4);
  const cohorts=sites.map((site,i)=>{
    const plantSeed=seed+i*37;
    const random=seededRandom(plantSeed+177);
    return {birth:site.delay??0,seed:plantSeed,dry:130+random()*45,period:210+random()*60,generation:-1};
  });
  const lifeAttribute=new THREE.InstancedBufferAttribute(life,4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('fernLife',lifeAttribute);
  const mesh=new THREE.InstancedMesh(geometry,growth.material,sites.length);
  mesh.name='Ferns growing in marble joints';
  mesh.castShadow=true;
  mesh.receiveShadow=true;
  mesh.customDepthMaterial=growth.depthMaterial;
  // Site roots can move after the first render as their supporting tiles lift.
  mesh.frustumCulled=false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parent.add(mesh);

  const transform=new THREE.Object3D();
  let previousAge,previousTime;
  function seek(age,time=age){
    const growthTime=regrow?time*130:Math.min(age*130,78);
    if(age===previousAge&&growthTime===previousTime)return;
    const moved=age!==previousAge;
    previousAge=age;
    previousTime=growthTime;
    growth.setTime(growthTime);
    mesh.visible=false;
    for(const [i,site] of sites.entries()){
      const cohort=cohorts[i];
      const generation=regrow?Math.max(0,Math.floor((growthTime-cohort.birth)/cohort.period)):0;
      const birth=cohort.birth+generation*cohort.period;
      const death=regrow?cohort.dry+26:240;
      if(cohort.generation!==generation){
        cohort.generation=generation;
        life.set([birth,regrow?cohort.dry:200,death,cohort.seed+generation*53],i*4);
        lifeAttribute.needsUpdate=true;
      }
      if(growthTime>=birth+6&&growthTime<birth+death+18)mesh.visible=true;
      if(!moved)continue;
      transform.position.set(site.x,site.heightAt(age),site.z);
      transform.rotation.y=site.rotation??0;
      transform.scale.setScalar(site.scale??1);
      transform.updateMatrix();
      mesh.setMatrixAt(i,transform.matrix);
    }
    if(moved)mesh.instanceMatrix.needsUpdate=true;
  }
  seek(0);
  return {seek,dispose(){
    mesh.removeFromParent();
    mesh.dispose();
    geometry.dispose();
    growth.dispose();
  }};
}

import * as THREE from 'three';

// A damped bend at each attached feather, driven by the player's body capsule.
// The shader weights this offset from zero at the quill to full at the tip.
export function createFeatherBrush(){
  const last=new THREE.Vector3(),travel=new THREE.Vector3(),shaft=new THREE.Vector3(),point=new THREE.Vector3(),body=new THREE.Vector3(),away=new THREE.Vector3(),target=new THREE.Vector3();
  const up=new THREE.Vector3(0,1,0);
  let initialized=false;
  return {
    reset(){initialized=false;},
    update(samples,player,dt,length,isFlying=()=>false,width=1){
      if(!(dt>0))return false;
      dt=Math.min(dt,.05);
      travel.copy(initialized?player:last.copy(player)).sub(last);last.copy(player);initialized=true;
      let moving=false;
      for(const sample of samples){
        target.set(0,0,0);
        const reach=5*sample.scale*length;
        if(!isFlying(sample.index)&&reach>0){
          shaft.set(0,reach,0).applyQuaternion(sample.anchorRotation);
          const horizontal=shaft.x*shaft.x+shaft.z*shaft.z;
          let t=horizontal>1e-12?THREE.MathUtils.clamp(((player.x-sample.anchorPosition.x)*shaft.x+(player.z-sample.anchorPosition.z)*shaft.z)/horizontal,.08,1):.6;
          for(let i=0;i<3;i++){
            point.copy(sample.anchorPosition).addScaledVector(shaft,t);
            body.set(player.x,THREE.MathUtils.clamp(point.y,player.y-.20,player.y+.025),player.z);
            t=THREE.MathUtils.clamp(away.subVectors(body,sample.anchorPosition).dot(shaft)/Math.max(1e-12,shaft.lengthSq()),.08,1);
          }
          point.copy(sample.anchorPosition).addScaledVector(shaft,t);
          body.set(player.x,THREE.MathUtils.clamp(point.y,player.y-.20,player.y+.025),player.z);
          const box=sample.batch?.geometry.boundingBox;
          const halfWidth=(box?Math.max(Math.abs(box.min.x),Math.abs(box.max.x)):1.4)*sample.scale*width;
          away.subVectors(point,body);const distance=away.length(),radius=.028+halfWidth*.6;
          if(distance<radius){
            away.addScaledVector(sample.anchorNormal,-away.dot(sample.anchorNormal));
            if(away.lengthSq()<1e-10)away.copy(travel).addScaledVector(sample.anchorNormal,-travel.dot(sample.anchorNormal));
            if(away.lengthSq()<1e-10)away.crossVectors(up,sample.anchorNormal);
            if(away.lengthSq()>1e-10)target.copy(away).normalize().multiplyScalar(Math.min((reach+halfWidth*.75)*.9,(radius-distance)*3));
          }
        }
        if(!sample.push&&target.lengthSq()===0)continue;
        sample.push??=new THREE.Vector3();sample.pushVelocity??=new THREE.Vector3();
        const bx=sample.push.x,by=sample.push.y,bz=sample.push.z,steps=Math.ceil(dt/.0125),step=dt/steps;
        for(let i=0;i<steps;i++){
          sample.pushVelocity.addScaledVector(away.subVectors(target,sample.push),120*step).multiplyScalar(Math.exp(-20*step));
          sample.push.addScaledVector(sample.pushVelocity,step);
        }
        if(sample.push.distanceToSquared(target)<1e-10&&sample.pushVelocity.lengthSq()<1e-8){sample.push.copy(target);sample.pushVelocity.set(0,0,0);}
        if((sample.push.x-bx)**2+(sample.push.y-by)**2+(sample.push.z-bz)**2>1e-12||sample.pushVelocity.lengthSq()>1e-8)moving=true;
      }
      return moving;
    }
  };
}

import * as THREE from 'three';
import {createMazeRoom} from '../maze-room.js';
import {mazePoint} from '../maze-geometry.js';

// Sample the production sky on either side of the old longitude cut and poles.
export function checkGalaxySeams(renderer){
  const scene=new THREE.Scene(),specimen=new THREE.Group();scene.add(specimen);
  const room=createMazeRoom({scene,specimen,canStand:()=>true});
  const material=room.roof.material.clone();
  material.uniforms.testDirection={value:new THREE.Vector3()};
  material.fragmentShader='uniform vec3 testDirection;\n'+material.fragmentShader.replace('vec3 ray=normalize(vWorld-cameraPosition);','vec3 ray=normalize(testDirection);');
  const geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,material),testScene=new THREE.Scene();testScene.add(quad);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=1;
  const target=new THREE.WebGLRenderTarget(16,16),previous=renderer.getRenderTarget();
  const pairs=[];
  try{
    renderer.setRenderTarget(target);
    function atFlightTime(time){material.uniforms.uSkyTime.value=time/.30;}
    function pixel(direction){material.uniforms.testDirection.value.copy(direction);renderer.render(testScene,camera);const bytes=new Uint8Array(4);renderer.readRenderTargetPixels(target,8,8,1,1,bytes);return [...bytes];}
    for(const y of [-.7,-.17,.03,.26,.6])pairs.push([new THREE.Vector3(-1,y,-.000001),new THREE.Vector3(-1,y,.000001)]);
    for(const y of [-1,1])pairs.push([new THREE.Vector3(-.000001,y,.000001),new THREE.Vector3(.000001,y,-.000001)]);
    const differences=pairs.map(pair=>{const [a,b]=pair.map(pixel);return Math.max(...a.slice(0,3).map((v,i)=>Math.abs(v-b[i])));});
    const moon=pixel(new THREE.Vector3(.35,.65,-.6)),nearby=pixel(new THREE.Vector3(.55,.65,-.6));
    material.uniforms.uOrbitAngle.value=.1;const driftedMoon=pixel(new THREE.Vector3(.35,.65,-.6));
    const orbitContrast=moon.slice(0,3).reduce((sum,value,i)=>sum+value-driftedMoon[i],0)/3;
    const orbitPlanet=pixel(new THREE.Vector3(.9,-1.8,-.45)),orbitBackground=pixel(new THREE.Vector3(.35,.65,-.1));
    const orbitPlanetContrast=orbitPlanet.slice(0,3).reduce((sum,value,i)=>sum+value-orbitBackground[i],0)/3;
    material.uniforms.uOrbitAngle.value=0;
    const moonContrast=moon.slice(0,3).reduce((sum,value,i)=>sum+value-nearby[i],0)/3;
    const planet=pixel(new THREE.Vector3(.9,-1.8,-.45)),offPlanet=pixel(new THREE.Vector3(.35,.65,-.1));
    const planetContrast=planet.slice(0,3).reduce((sum,value,i)=>sum+value-offPlanet[i],0)/3;
    const axis=new THREE.Vector3(.9,-1.8,-.45).normalize(),right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),axis).normalize(),up=new THREE.Vector3().crossVectors(axis,right);
    const center=axis.clone().multiplyScalar(18),radius=18*.82;
    const normal=axis.clone().multiplyScalar(-.95).addScaledVector(up,.30).normalize();
    const entryPoint=center.clone().addScaledVector(normal,radius+.15);
    const incoming=axis.clone().multiplyScalar(.8).addScaledVector(up,-.6).normalize();
    const hitB=normal.dot(incoming)*(radius+.15),hitC=(radius+.15)**2-radius**2;
    const groundDistance=-hitB-Math.sqrt(hitB*hitB-hitC);
    const distanceAt=age=>age<.65?(age-.65)*8/.65:groundDistance*.85*(1-Math.exp(-(age-.65)/.035));
    const headAt=age=>entryPoint.clone().addScaledVector(incoming,distanceAt(age));
    const meteorDirection=headAt(.68).normalize();
    atFlightTime(.68*3.25);const meteor=pixel(meteorDirection);
    atFlightTime(4.2);const afterMeteor=pixel(meteorDirection);
    material.uniforms.uSkyTime.value=.68*3.25;const early=pixel(meteorDirection);
    const slowerArrivalContrast=meteor.slice(0,3).reduce((sum,value,i)=>sum+value-early[i],0)/3;
    const quietPoint=headAt(.2),tailDirection=quietPoint.clone().addScaledVector(incoming,-.3).normalize();
    atFlightTime(.2*3.25);const tail=pixel(tailDirection),quietApproach=pixel(quietPoint.clone().normalize());
    atFlightTime(4.2);const afterTail=pixel(tailDirection),quietBackground=pixel(quietPoint.clone().normalize());
    const vacuumTailDifference=Math.max(...tail.slice(0,3).map((value,i)=>Math.abs(value-afterTail[i])));
    const quietBrightness=quietApproach.slice(0,3).reduce((sum,value,i)=>sum+Math.max(0,value-quietBackground[i]),0)/3;
    const prematureTailDifference=vacuumTailDifference;
    const meteorContrast=meteor.slice(0,3).reduce((sum,value,i)=>sum+value-afterMeteor[i],0)/3;
    const wakeDirection=entryPoint.clone().addScaledVector(incoming,.06).normalize();
    atFlightTime(.69*3.25);const wake=pixel(wakeDirection);
    atFlightTime(4.2);const noWake=pixel(wakeDirection);
    const atmosphericWakeContrast=wake.slice(0,3).reduce((sum,value,i)=>sum+value-noWake[i],0)/3;
    const trainDistance=groundDistance*.85*(1-Math.exp(-.075/.035));
    const trainDirection=entryPoint.clone().addScaledVector(incoming,trainDistance-.025).addScaledVector(right,(.15-.075)*.05).normalize();
    atFlightTime(.80*3.25);const train=pixel(trainDirection);
    atFlightTime(4.2);const noTrain=pixel(trainDirection);
    const afterglowContrast=train.slice(0,3).reduce((sum,value,i)=>sum+value-noTrain[i],0)/3;
    const burnPoint=headAt(.71),entryDirection=burnPoint.clone().normalize();
    atFlightTime(.71*3.25);const hit=pixel(entryDirection);
    atFlightTime(4.2);const quiet=pixel(entryDirection);
    const impactContrast=hit.slice(0,3).reduce((sum,value,i)=>sum+value-quiet[i],0)/3;
    // The actual 3D head must be in front of the first planet intersection.
    const planetB=meteorDirection.dot(center),surfaceDepth=planetB-Math.sqrt(planetB*planetB-(18*18-radius*radius));
    const nearSideMargin=surfaceDepth-headAt(.68).length();
    const frontEntryContrast=meteorContrast,entryContrasts=[];
    for(let i=0;i<8;i++){
      const spread=Math.sin(i*1.7+2*.73)*.25;
      const n=axis.clone().multiplyScalar(-.95).addScaledVector(up,.30).addScaledVector(right,spread).normalize();
      const entry3D=center.clone().addScaledVector(n,radius+.15),relative=entry3D.clone().sub(center);
      const b=relative.dot(incoming),c=relative.lengthSq()-radius*radius;
      const ground=-b-Math.sqrt(b*b-c);
      const point=entry3D.addScaledVector(incoming,ground*.85*(1-Math.exp(-.03/.035))).normalize();
      const time=2*(7+i*.31)+.68*3.25-i*.91;
      atFlightTime(time);const on=pixel(point);atFlightTime(time+2);const off=pixel(point);
      entryContrasts.push(on.slice(0,3).reduce((sum,value,k)=>sum+value-off[k],0)/3);
    }
    atFlightTime(2);
    const nearDirection=new THREE.Vector3(0,.35,-1).normalize(),close=pixel(nearDirection);
    camera.position.x=.25;const shifted=pixel(nearDirection);camera.position.x=0;
    const parallaxContrast=close.slice(0,3).reduce((sum,value,i)=>sum+value-shifted[i],0)/3;
    const side=new THREE.Vector3(.45,0,.9).normalize();
    const farHead=side.multiplyScalar(Math.sin(8*2.399+.83)*7).add(new THREE.Vector3(0,2.46,0));
    const farDirection=farHead.sub(camera.position).normalize();
    atFlightTime(4);const far=pixel(farDirection);
    atFlightTime(6.4);const afterFar=pixel(farDirection);
    const farContrast=far.slice(0,3).reduce((sum,value,i)=>sum+value-afterFar[i],0)/3;
    const belowHead=new THREE.Vector3(.45,0,.9).normalize().multiplyScalar(Math.sin(2*2.399)*1.55);
    belowHead.y=-(.35+.08*Math.sin(2)**2);
    const belowDirection=belowHead.sub(camera.position).normalize();
    atFlightTime(.66);const below=pixel(belowDirection);
    atFlightTime(4.7);const afterBelow=pixel(belowDirection);
    const belowContrast=below.slice(0,3).reduce((sum,value,i)=>sum+value-afterBelow[i],0)/3;
    atFlightTime(0);
    room.setActive(true);
    const view=new THREE.PerspectiveCamera(75,1,.001,80);view.position.copy(mazePoint(15.5,30.8,.02));
    const exteriorAlpha=[];
    for(const direction of [new THREE.Vector3(0,0,1),new THREE.Vector3(1,.2,1),new THREE.Vector3(-1,.2,1),new THREE.Vector3(0,1,1)]){
      view.lookAt(view.position.clone().add(direction));renderer.render(scene,view);
      const bytes=new Uint8Array(4);renderer.readRenderTargetPixels(target,8,8,1,1,bytes);exteriorAlpha.push(bytes[3]);
    }
    return {differences,maxDifference:Math.max(...differences),moonContrast,orbitContrast,orbitPlanetContrast,planetContrast,meteorContrast,vacuumTailDifference,atmosphericWakeContrast,afterglowContrast,quietBrightness,impactContrast,nearSideMargin,frontEntryContrast,entryContrasts,parallaxContrast,farContrast,prematureTailDifference,belowContrast,slowerArrivalContrast,exteriorAlpha};
  }finally{renderer.setRenderTarget(previous);target.dispose();geometry.dispose();material.dispose();room.dispose();}
}

// Read HDR sky pixels before display conversion: invalid meteor arithmetic can
// otherwise turn broad regions black without raising a WebGL error.
export function checkMeteorNumerics(renderer){
  const scene=new THREE.Scene(),specimen=new THREE.Group();scene.add(specimen);
  const room=createMazeRoom({scene,specimen,canStand:()=>true});
  const material=room.roof.material.clone();
  material.vertexShader='varying vec2 skyUV;varying vec3 vWorld;varying vec3 vNormal;varying vec3 vLocal;void main(){skyUV=uv;vWorld=position;vLocal=position;vNormal=vec3(0,0,1);gl_Position=vec4(position.xy,0.0,1.0);}';
  material.fragmentShader='varying vec2 skyUV;\n'+material.fragmentShader.replace('vec3 ray=normalize(vWorld-cameraPosition);',`float longitude=(skyUV.x-.5)*6.2831853,latitude=(skyUV.y-.5)*3.14159265;
    vec3 ray=vec3(cos(latitude)*cos(longitude),sin(latitude),cos(latitude)*sin(longitude));`).replace('float fresnel=pow(1.0-abs(dot(-ray,normalize(vNormal))),4.0);','float fresnel=0.0;');
  const geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,material),testScene=new THREE.Scene();testScene.add(quad);
  const camera=new THREE.Camera(),target=new THREE.WebGLRenderTarget(256,128,{type:THREE.FloatType}),previous=renderer.getRenderTarget();
  const bytes=new Float32Array(256*128*4);let invalid=0,black=0;
  try{
    renderer.setRenderTarget(target);
    for(const eye of [[0,0,0],[0,.02,1.5],[.7,.02,.8],[-.7,.02,.8]]){
    camera.position.set(...eye);
    for(const time of [.01,.12,.35,.65,1.1,2,3.2,4.5,6.9,9.3]){
      material.uniforms.uSkyTime.value=time/.30;renderer.render(testScene,camera);renderer.readRenderTargetPixels(target,0,0,256,128,bytes);
      for(let i=0;i<bytes.length;i+=4){
        if(![bytes[i],bytes[i+1],bytes[i+2]].every(Number.isFinite))invalid++;
        else if(bytes[i]+bytes[i+1]+bytes[i+2]<.0001)black++;
      }
    }
    }
    return {invalid,black,pixels:256*128*40};
  }finally{renderer.setRenderTarget(previous);target.dispose();geometry.dispose();material.dispose();room.dispose();}
}

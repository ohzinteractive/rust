import {createFernFloor} from './fern-floor.js';
import {createChangingWind,createWindmill,windmillCorner} from './fern-wind.js';
import {solveFernContacts,fernContactValue} from './fern-contact.js';
import * as THREE from 'three';
import {createFernGrowthMaterials,fernFrondState,fernFrondPoint,fernCanReleaseSpores,FERN_MATURITY} from './fern-growth.js';
import {createFernCanopyLODs,selectFernLOD} from './fern-lod.js';
import {sampleFernFlow,prepareFernFlow} from './fern-flow.js';
import {seededRandom} from './plume-lsystem/random.js';

const MATURITY=FERN_MATURITY,BURST_INTERVAL=18,POOL_SIZE=960;
export function createFernDispersal({scene,fern,floorY=-1.75,maxColonies=32,camera=null}){
  const group=new THREE.Group();group.name='Windborne fern spores';group.visible=false;scene.add(group);
  const forestFloor=createFernFloor(group,floorY),settledSpores=[];
  const changingWind=createChangingWind(fern.settings.seed+177),windmill=createWindmill(group,floorY);
  let pointerWind=null,surfaceHabitat=null;
  let variableWind=false,actualWind={strength:.25,direction:25};
  const dustMaterial=new THREE.MeshBasicMaterial({color:0xb89c62});
  const green=new THREE.MeshStandardMaterial({color:0x72954f,side:THREE.DoubleSide,roughness:1});
  const sphere=new THREE.SphereGeometry(1,6,4),matrix=new THREE.Matrix4(),identity=new THREE.Quaternion(),scale=new THREE.Vector3();
  const particles=new THREE.InstancedMesh(sphere,dustMaterial,POOL_SIZE);particles.name='Drifting fern spores';particles.frustumCulled=false;particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(particles);
  const beds=new THREE.Group();beds.name='New fern colonies';group.add(beds);
  const canopies=new THREE.Group();canopies.name='Full-size offspring canopies';group.add(canopies);
  const heartShape=new THREE.Shape();
  for(let i=0;i<=48;i++){const t=i/48*Math.PI*2,x=Math.pow(Math.sin(t),3),y=(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/16;i?heartShape.lineTo(x,y):heartShape.moveTo(x,y);}
  const heartGeometry=new THREE.ShapeGeometry(heartShape);
  const capacity=512,renderCapacity=capacity*2+1;maxColonies=THREE.MathUtils.clamp(Math.round(maxColonies),1,capacity);
  let random=seededRandom(1),clock=0,playing=false,wind=.25,direction=25,speed=1,emitted=0,landed=0,airborne=0,grown=0,generation=0,landingCursor=0,living=0,died=0,born=0,nextAgingUpdate=0,ageRandom=seededRandom(1),parentState=null;
  const spores=Array.from({length:POOL_SIZE},()=>({state:'free',position:new THREE.Vector3(),velocity:new THREE.Vector3()}));
  const sources=[],colonies=[],templates=[],emitters=[],landingHistory=[],lodMeshes=[];
  const activeSpores=new Set(),freeSpores=[...spores],growing=new Set(),aging=new Set(),cells=new Map();
  const frustum=new THREE.Frustum(),viewMatrix=new THREE.Matrix4(),lastViewMatrix=new THREE.Matrix4(),cameraPosition=new THREE.Vector3();
  const cullSphere=new THREE.Sphere(),heartMatrix=new THREE.Matrix4();
  const shadowMaterial=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,side:THREE.DoubleSide});
  const hearts=new THREE.InstancedMesh(heartGeometry,green,renderCapacity);hearts.name='Instanced gametophytes';hearts.count=0;hearts.frustumCulled=false;hearts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(hearts);
  const contactData=new Float32Array(32*1025*4),contactTexture=new THREE.DataTexture(contactData,32,1025,THREE.RGBAFormat,THREE.FloatType);
  let nextContactUpdate=0;
  let growthMaterials=null,shadowMesh=null,viewDirty=true,matrixUploads=0,renderStats={visible:0,culled:0,triangles:0,lod:[0,0,0],drawCalls:0};
  const flowFrame={},sporeColor=new THREE.Color();
  const position=new THREE.Vector3(),windVector=new THREE.Vector3();
  function updateParticles(){
    let index=0;for(const p of activeSpores)if(p.state==='airborne'){
      scale.setScalar(.005+.006*(.5+.5*Math.sin(p.phase)));particles.setMatrixAt(index,matrix.compose(p.position,identity,scale));particles.setColorAt(index++,sporeColor.setHex(0xb89c62).multiplyScalar(.35+.65*Math.pow(.5+.5*Math.cos(p.phase),3)));
    }
    particles.count=index;particles.instanceMatrix.needsUpdate=true;if(particles.instanceColor)particles.instanceColor.needsUpdate=true;
  }
  function restoreParent(){
    fern.group.scale.setScalar(1);fern.group.position.y=0;
    for(const frond of fern.group.children)if(frond.name==='Fern frond')frond.visible=true;
  }
  function clear(){
    forestFloor.clear();settledSpores.length=0;
    restoreParent();growthMaterials?.dispose();growthMaterials=null;parentState=null;aging.clear();living=0;died=0;born=0;nextAgingUpdate=0;
    const geometries=new Set();canopies.traverse(mesh=>{if(mesh.isInstancedMesh){mesh.dispose();geometries.add(mesh.geometry);}});for(const geometry of geometries)geometry.dispose();canopies.clear();lodMeshes.length=0;shadowMesh=null;hearts.count=0;viewDirty=true;
    beds.clear();colonies.length=0;sources.length=0;templates.length=0;emitters.length=0;landingHistory.length=0;particles.count=0;
    for(const p of spores)p.state='free';activeSpores.clear();freeSpores.length=0;freeSpores.push(...spores);growing.clear();cells.clear();emitted=0;landed=0;airborne=0;grown=0;generation=0;landingCursor=0;matrixUploads=0;renderStats={visible:0,culled:0,triangles:0,lod:[0,0,0],drawCalls:0};
  }
  function frondState(c,index,pressure=true){const state=fernFrondState(clock-c.bornAt,index,c,pressure);state.contact=fernContactValue(contactData,(c.contactSlot*32+index)*4,clock);return state;}
  function burst(emitter,count){
    if(!freeSpores.length)return;
    const c=emitter.colony??parentState,ready=new Set();
    if(!fernCanReleaseSpores(clock-c.bornAt,c))return;
    for(let i=0;i<templates.length;i++)if(frondState(c,i,false).mature)ready.add(i);
    const fertile=sources.filter(source=>ready.has(source.template.index));
    if(!fertile.length)return;
    for(let i=0;i<count;i++){
      const p=freeSpores.pop();if(!p)break;activeSpores.add(p);
      p.source=fertile[Math.floor(random()*fertile.length)];p.emitter=emitter;p.release=clock+.05+i*.025+random()*.6;p.phase=random()*6.28;p.state='waiting';
    }
  }
  function rebuild(){
    clear();changingWind.reset();
    const reach=fern.settings.length*(surfaceHabitat?.scale??1)*1.8;
    const habitatBounds=surfaceHabitat?.bounds??new THREE.Box3(new THREE.Vector3(-reach,floorY,-reach),new THREE.Vector3(reach,floorY+reach,reach));
    windmillCorner(habitatBounds,floorY,surfaceHabitat?reach:0,windmill.group.position);
    clock=0;nextContactUpdate=0;contactData.fill(0);contactTexture.needsUpdate=true;random=seededRandom(fern.settings.seed+811);ageRandom=seededRandom(fern.settings.seed+991);fern.group.updateMatrixWorld(true);
    for(const frond of fern.group.children){
      const leaf=frond.getObjectByName('Divided fern foliage');if(!leaf)continue;
      const attr=leaf.geometry.attributes.position,count=14;
      const localPosition=frond.position.clone();localPosition.y-=floorY;
      const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),frond.rotation.y);
      const template={index:templates.length,frondData:frond.userData,position:localPosition,rotation,matrix:new THREE.Matrix4().compose(localPosition,rotation,new THREE.Vector3(1,1,1))};
      for(let i=0;i<count;i++){
        const triangle=Math.min(Math.floor(attr.count/3)-1,Math.floor((.15+i/count*.7)*attr.count/3))*3;
        const root=new THREE.Vector3();for(let j=0;j<3;j++)root.add(new THREE.Vector3().fromBufferAttribute(attr,triangle+j));root.multiplyScalar(1/3);root.y-=.003;
        const t=leaf.geometry.attributes.rachisT.getX(triangle);sources.push({point:root,t,template});
      }
      templates.push(template);
    }
    const geometries=createFernCanopyLODs(fern,floorY);growthMaterials=createFernGrowthMaterials(fern,contactTexture);const material=growthMaterials.material;
    if(!surfaceHabitat)forestFloor.setLitterGeometry(geometries[2]);
    for(const geometry of geometries)geometry.setAttribute('fernContactRow',new THREE.InstancedBufferAttribute(new Float32Array(renderCapacity),1));
    for(const geometry of geometries)geometry.setAttribute('fernLife',new THREE.InstancedBufferAttribute(new Float32Array(renderCapacity*4),4).setUsage(THREE.DynamicDrawUsage));
    geometries.forEach((geometry,i)=>{
      const mesh=new THREE.InstancedMesh(geometry,material,renderCapacity);mesh.name=['Detailed fern canopies','Medium fern canopies','Distant fern canopies'][i];mesh.count=0;mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);canopies.add(mesh);lodMeshes.push(mesh);
    });
    const shadowGeometry=geometries[2].clone();shadowGeometry.setAttribute('fernLife',new THREE.InstancedBufferAttribute(new Float32Array(renderCapacity*4),4).setUsage(THREE.DynamicDrawUsage));
    shadowGeometry.setAttribute('fernContactRow',new THREE.InstancedBufferAttribute(new Float32Array(renderCapacity),1));
    shadowMesh=new THREE.InstancedMesh(shadowGeometry,shadowMaterial,renderCapacity);shadowMesh.customDepthMaterial=growthMaterials.depthMaterial;shadowMesh.name='Simplified fern shadows';shadowMesh.count=0;shadowMesh.castShadow=true;shadowMesh.frustumCulled=false;shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);canopies.add(shadowMesh);
    parentState=makeAgeData(-60);parentState.contactSlot=0;parentState.stage='mature';parentState.removed=false;
    parentState.root=new THREE.Vector3(0,floorY,0);parentState.young={visible:true};parentState.heart={visible:false};parentState.renderMatrix=new THREE.Matrix4().makeTranslation(0,floorY,0);parentState.isParent=true;
    if(surfaceHabitat){const anchor=surfaceHabitat.sample(random);if(anchor){parentState.root.copy(anchor.point);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),anchor.normal);parentState.renderMatrix.compose(parentState.root,q,new THREE.Vector3().setScalar(surfaceHabitat.scale));}}
    const parent={colony:null,generation:0,nextBurst:BURST_INTERVAL,active:true};parentState.emitter=parent;emitters.push(parent);burst(parent,90);if(surfaceHabitat)for(let i=0;i<18;i++){const anchor=surfaceHabitat.sample(random);if(anchor)plant({position:anchor.point,normal:anchor.normal,emitter:parent});}applyParent();growthMaterials.setTime(clock);updateParticles();updateView();
  }
  function plant(spore,remember=true){
    const spacing=fern.settings.length*(surfaceHabitat?surfaceHabitat.scale*.8:1.1);
    if(!surfaceHabitat&&Math.hypot(spore.position.x-windmill.group.position.x,spore.position.z-windmill.group.position.z)<.5+fern.settings.length*1.8)return;
    if(parentState&&!parentState.removed&&(!surfaceHabitat||parentState.stage!=='dead')&&parentState.root.distanceTo(spore.position)<spacing)return;
    const cellX=Math.floor(spore.position.x/spacing),cellZ=Math.floor(spore.position.z/spacing);
    for(let x=cellX-1;x<=cellX+1;x++)for(let z=cellZ-1;z<=cellZ+1;z++)for(const c of cells.get(x+','+z)??[]){
      if((surfaceHabitat?c.root.distanceToSquared(spore.position):(c.root.x-spore.position.x)**2+(c.root.z-spore.position.z)**2)<spacing*spacing)return;
    }
    const parentLiving=parentState&&!parentState.removed&&parentState.stage!=='dead'?1:0;
    if(living+(surfaceHabitat?0:parentLiving)>=maxColonies||colonies.length>=renderCapacity){
      // Keep actual landing sites while the population is full. Copy pooled
      // particle data so subsequent flights cannot move these dormant spores.
      if(remember&&!surfaceHabitat){
        if(settledSpores.length>=512)settledSpores.shift();
        settledSpores.push({position:spore.position.clone(),emitter:{generation:spore.emitter.generation},landedAt:clock});
      }
      return;
    }
    const root=spore.position.clone();if(!surfaceHabitat)root.y=forestFloor.height(root.x,root.z);
    const colony=new THREE.Group();colony.name='Spore-grown fern';colony.position.copy(root);if(surfaceHabitat)colony.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),spore.normal??new THREE.Vector3(0,1,0));beds.add(colony);
    const heart=new THREE.Object3D();heart.name='Settled spore gametophyte';heart.rotation.x=-Math.PI/2;heart.position.y=.012;colony.add(heart);
    const young=new THREE.Group();young.name='Growing young fern';young.rotation.y=random()*Math.PI*2;colony.add(young);
    const used=new Set(colonies.map(c=>c.contactSlot));let contactSlot=1;while(used.has(contactSlot))contactSlot++;contactData.fill(0,contactSlot*128,(contactSlot+1)*128);
    const data={...makeAgeData(clock),contactSlot,group:colony,heart,young,root,generation:spore.emitter.generation+1,mature:false,renderMatrix:new THREE.Matrix4(),cellKey:cellX+','+cellZ};
    data.growthDelay=surfaceHabitat ? .5+(data.seed%26)/10 : 4+(data.seed%181)/10;data.landedAt=clock;data.bornAt+=data.growthDelay;
    colony.userData.growthDelay=data.growthDelay;colony.userData.landedAt=clock;
    colony.userData.id=born+1;colony.userData.generation=data.generation;colonies.push(data);living++;born++;growing.add(data);generation=Math.max(generation,data.generation);
    const key=cellX+','+cellZ;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(data);updateColony(data);
  }
  function makeAgeData(bornAt){
    const dryAt=100+ageRandom()*170,dieAt=dryAt+35+ageRandom()*35;
    // Keep the established seed sequence when removing the old size field.
    ageRandom();
    return {bornAt,age:0,frondCount:fern.settings.fronds,dryAt,dieAt,seed:Math.floor(ageRandom()*997),dryness:0,stage:'young',removed:false};
  }
  function agePlant(c){
    c.age=clock-c.bornAt;
    c.dryness=THREE.MathUtils.smoothstep(c.age,c.dryAt,c.dieAt);
    const wasDead=c.stage==='dead';
    c.stage=c.age>=c.dieAt?'dead':c.age>=c.dryAt?'drying':c.age>=MATURITY?'mature':c.age<0?'waiting':'young';
    if(c.stage==='dead'&&!wasDead){
      if(!surfaceHabitat){forestFloor.deposit(c.root,fern.settings.length*.95,c.young.rotation?.y??0);}
      died++;if(!c.isParent){living--;if(c.mature)grown--;releaseCell(c);}
      c.emitter.active=false;
    }

  }
  function updateColony(c){
    agePlant(c);viewDirty=true;
    c.group.userData.stage=c.stage;c.group.userData.age=c.age;c.group.userData.dryness=c.dryness;
    c.heart.scale.setScalar((.015+THREE.MathUtils.smoothstep(clock-c.landedAt,0,4)*.11)*(surfaceHabitat?.scale??1));c.heart.visible=c.age<20;
    c.young.visible=c.age>=6;
    const orientation=c.group.quaternion.clone().multiply(c.young.quaternion);
    c.renderMatrix.compose(c.root,orientation,scale.setScalar(surfaceHabitat?.scale??1));
    if(!c.mature&&c.age>=MATURITY){c.mature=true;grown++;growing.delete(c);aging.add(c);c.emitter={colony:c,generation:c.generation,nextBurst:clock,active:true};emitters.push(c.emitter);}
  }
  function applyParent(){
    if(!parentState)return;
    fern.group.scale.setScalar(1);fern.group.position.y=0;fern.group.visible=!parentState.removed;
    for(const frond of fern.group.children)if(frond.name==='Fern frond')frond.visible=false;
  }
  function writeLife(mesh,index,c){mesh.geometry.attributes.fernContactRow.setX(index,c.contactSlot);mesh.geometry.attributes.fernContactRow.needsUpdate=true;mesh.geometry.attributes.fernLife.setXYZW(index,c.bornAt,c.dryAt,c.dieAt,c.seed);}
  function releaseCell(c){
    const cell=cells.get(c.cellKey);if(!cell)return;
    const index=cell.indexOf(c);if(index>=0)cell.splice(index,1);
    if(!cell.length)cells.delete(c.cellKey);
  }
  function updateAging(){
    if(parentState&&!parentState.removed){agePlant(parentState);if(parentState.age>=parentState.dieAt+18){parentState.removed=true;}}
    for(const c of aging){
      updateColony(c);
      if(c.age>=c.dieAt+18){aging.delete(c);c.removed=true;c.group.removeFromParent();colonies.splice(colonies.indexOf(c),1);}
    }
    // Old spores lose viability. Available slots go to real landing sites,
    // never to an automatic clone of a dead crown.
    while(settledSpores.length&&clock-settledSpores[0].landedAt>180)settledSpores.shift();
    while(settledSpores.length&&living+(parentState&&!parentState.removed&&parentState.stage!=='dead'?1:0)<maxColonies)plant(settledSpores.shift(),false);
    for(let i=emitters.length-1;i>=0;i--)if(!emitters[i].active)emitters.splice(i,1);
  }
  function updateView(viewCamera=camera){
    if(!lodMeshes.length)return;
    if(viewCamera){
      viewCamera.updateMatrixWorld(true);viewMatrix.multiplyMatrices(viewCamera.projectionMatrix,viewCamera.matrixWorldInverse);
      if(!viewDirty&&viewMatrix.equals(lastViewMatrix))return;
      lastViewMatrix.copy(viewMatrix);frustum.setFromProjectionMatrix(viewMatrix);viewCamera.getWorldPosition(cameraPosition);
    }else{if(!viewDirty)return;cameraPosition.set(5,4,7);}
    viewDirty=false;
    const visible=[],counts=[0,0,0],length=fern.settings.length;let heartCount=0,visibleFerns=0;
    for(const c of [...colonies,...(parentState&&!parentState.removed?[parentState]:[])]){
      cullSphere.center.copy(c.root);cullSphere.center.y+=length*.5;cullSphere.radius=length*2.2*(surfaceHabitat?.scale??1);
      if(viewCamera&&!frustum.intersectsSphere(cullSphere))continue;
      if(c.heart.visible){
        position.copy(c.root);position.y+=c.heart.position.y;heartMatrix.compose(position,c.group?c.group.quaternion.clone().multiply(c.heart.quaternion):c.heart.quaternion,c.heart.scale);hearts.setMatrixAt(heartCount++,heartMatrix);
      }
      if(c.young.visible)visible.push({c,distance:cameraPosition.distanceTo(c.root)});
    }
    for(const {c,distance} of visible){
      // Projection includes lens zoom/FOV; no foreground plant is downgraded
      // merely because three other crowns happen to be closer.
      const projection=viewCamera?.projectionMatrix.elements[5]??2.414;
      const projectedSize=viewCamera?.isOrthographicCamera?length*(surfaceHabitat?.scale??1)*.8*projection:length*(surfaceHabitat?.scale??1)*.8*projection/Math.max(.01,distance-length*.5);
      const level=selectFernLOD(projectedSize,c.lodLevel);c.lodLevel=level;
      matrix.copy(c.renderMatrix);lodMeshes[level].setMatrixAt(counts[level],matrix);writeLife(lodMeshes[level],counts[level]++,c);shadowMesh.setMatrixAt(visibleFerns,matrix);writeLife(shadowMesh,visibleFerns++,c);
    }
    lodMeshes.forEach((mesh,i)=>{mesh.count=counts[i];mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.fernLife.needsUpdate=true;});shadowMesh.count=visibleFerns;shadowMesh.instanceMatrix.needsUpdate=true;shadowMesh.geometry.attributes.fernLife.needsUpdate=true;hearts.count=heartCount;hearts.instanceMatrix.needsUpdate=true;matrixUploads++;
    renderStats={visible:visibleFerns,culled:Math.max(0,colonies.length+(parentState&&!parentState.removed?1:0)-visibleFerns),triangles:lodMeshes.reduce((sum,mesh)=>sum+mesh.geometry.attributes.position.count/3*mesh.count,0),lod:counts,drawCalls:counts.filter(Boolean).length+(visibleFerns?1:0)+(heartCount?1:0)};
  }
  function updateContacts(){
    if(surfaceHabitat)return;
    const samples=[];
    for(const c of [...colonies,...(parentState&&!parentState.removed?[parentState]:[])]){
      if(c.stage==='dead'||(camera&&cameraPosition.distanceToSquared(c.root)>(fern.settings.length*35)**2))continue;
      for(const template of templates){
        const state=frondState(c,template.index),f=template.frondData;
        if(!state.visible||state.opening<.5)continue;
        // Measure the uncompressed pose so the response does not repeatedly
        // release and reapply its own contact as a leaf moves downward.
        state.contact=0;
        for(const t of [.35,.55,.75,.95]){
          const theta=f.pitch-f.bend*t;
          const p=new THREE.Vector3(f.length*(Math.sin(f.pitch)-Math.sin(theta))/f.bend,f.length*(Math.cos(theta)-Math.cos(f.pitch))/f.bend,0);
          fernFrondPoint(p,f,t,state,p);p.applyQuaternion(template.rotation);p.applyMatrix4(c.renderMatrix);
          samples.push({plant:c.contactSlot,frond:template.index,t,point:p,radius:f.length*state.size*.12*Math.sin(t*Math.PI)});
        }
      }
    }
    const targets=solveFernContacts(samples,fern.settings.length*.3);
    for(const c of [...colonies,...(parentState&&!parentState.removed?[parentState]:[])])for(let i=0;i<templates.length;i++){
      const offset=(c.contactSlot*32+i)*4,current=fernContactValue(contactData,offset,clock);
      contactData[offset]=current;contactData[offset+1]=targets.get(c.contactSlot+':'+i)??0;contactData[offset+2]=clock;
    }
    contactTexture.needsUpdate=true;
  }
  function stepSimulation(step){
    clock+=step;
    actualWind=pointerWind??changingWind.advance(step,wind,direction,variableWind);
    windVector.set(Math.cos(actualWind.direction*Math.PI/180),0,Math.sin(actualWind.direction*Math.PI/180)).multiplyScalar(actualWind.strength*1.6);
    prepareFernFlow(clock,windVector,actualWind.strength,floorY,flowFrame);
    for(const emitter of emitters)if(emitter.active&&(!emitter.colony||emitter.colony.stage!=='dead')&&clock>=emitter.nextBurst){burst(emitter,emitter.colony?32:50);emitter.nextBurst=clock+BURST_INTERVAL;}
    for(const p of activeSpores){
      if(p.state==='waiting'&&!p.emitter.active){p.state='free';activeSpores.delete(p);freeSpores.push(p);continue;}
      if(p.state==='waiting'&&clock>=p.release){
        const c=p.emitter.colony??parentState,state=frondState(c,p.source.template.index);
        if(!state.mature||!fernCanReleaseSpores(clock-c.bornAt,c)){p.state='free';activeSpores.delete(p);freeSpores.push(p);continue;}
        p.state='airborne';p.flightAge=0;airborne++;
        fernFrondPoint(p.source.point,p.source.template.frondData,p.source.t,state,p.position);p.position.applyMatrix4(p.source.template.matrix);p.position.y-=p.source.template.position.y;p.position.x-=p.source.template.position.x*(1-.003/.035);p.position.z-=p.source.template.position.z*(1-.003/.035);p.position.applyMatrix4(c.renderMatrix);
        p.velocity.copy(windVector).multiplyScalar(.4);p.velocity.y=.13+random()*.07;emitted++;
      }
      if(p.state!=='airborne')continue;
      p.flightAge+=step;
      sampleFernFlow(p.position,clock,windVector,actualWind.strength,floorY,position,flowFrame);
      // Spores follow shared gusts with inertia rather than independent jitter.
      // Small settling differences separate trajectories; late settling bounds
      // flight duration even inside a persistent upward eddy.
      position.y-=.15+.035*(.5+.5*Math.sin(p.phase))+Math.max(0,p.flightAge-10)*.035;
      const drag=1-Math.exp(-step*1.2);
      p.velocity.lerp(position,drag);
      position.copy(p.position);p.position.addScaledVector(p.velocity,step);
      const surfaceHit=surfaceHabitat?.intersect(position,p.position);
      if(surfaceHit){p.position.copy(surfaceHit.point);p.normal=surfaceHit.normal;}
      const landingHeight=surfaceHabitat?floorY:forestFloor.height(p.position.x,p.position.z);
      if(surfaceHit||p.position.y<=landingHeight+.014){
        if(!surfaceHit)p.position.y=landingHeight+.014;landed++;if(landingHistory.length<4096)landingHistory.push(p.position.clone());else{landingHistory[landingCursor].copy(p.position);landingCursor=(landingCursor+1)%4096;}if(!surfaceHabitat||surfaceHit)plant(p);p.state='free';airborne--;activeSpores.delete(p);freeSpores.push(p);
      }
    }
    for(const c of growing)updateColony(c);
    if(clock>=nextAgingUpdate){updateAging();nextAgingUpdate=clock+.5;}
  }
  return {group,
    floorHeight(x,z){return forestFloor.height(x,z);},
    setSurface(value){surfaceHabitat=value;},
    get surfaceMode(){return !!surfaceHabitat;},
    get wind(){return {...actualWind,variable:variableWind,pointer:!!pointerWind};},
    get windIndicator(){return windmill.style;},
    setWindIndicator(value){windmill.setStyle(value);},
    getWindOrigin(out){out.copy(windmill.group.position);out.y+=.85;return out;},
    setPointerWind(value){pointerWind=value;if(value){actualWind={...value};windmill.update(0,value.strength,value.direction);}else actualWind={strength:wind,direction};},
    setVariableWind(value){variableWind=!!value;},
    get playing(){return playing;},get speed(){return speed;},get populationLimit(){return maxColonies;},
    get stats(){return {...forestFloor.stats,dormantSpores:settledSpores.length,airborne,landed,emitted,colonies:living,grown,generation,reproducing:emitters.length,elapsed:clock,drying:colonies.filter(c=>c.stage==='drying').length,dead:colonies.filter(c=>c.stage==='dead').length,died,born,parentStage:parentState?.stage??'mature',parentSize:1,parentDryness:parentState?.dryness??0};},
    get renderStats(){return {...renderStats,lod:[...renderStats.lod],matrixUploads};},
    get landings(){return [...landingHistory.slice(landingCursor),...landingHistory.slice(0,landingCursor)].map(p=>p.clone());},
    getBounds(){const bounds=new THREE.Box3();bounds.expandByPoint(new THREE.Vector3(0,floorY,0));for(const c of colonies)bounds.expandByPoint(c.root);bounds.expandByScalar(fern.settings.length*1.8);bounds.min.y=floorY;bounds.max.y=floorY+fern.settings.length*1.8;return bounds;},
    inspectPlant(id=0){const c=id===0?parentState:colonies.find(c=>c.group.userData.id===id);if(!c)return null;return {age:clock-c.bornAt,growthDelay:c.growthDelay??0,waitingFor:Math.max(0,c.bornAt-clock),stage:c.stage,fronds:templates.map((_,i)=>frondState(c,i))};},
    rebuild,clear,updateView,
    setVisible(value){const changed=group.visible!==!!value;group.visible=!!value;if(value){applyParent();updateView();}else if(changed)restoreParent();},
    setPlaying(value){playing=!!value;},
    setSpeed(value){speed=THREE.MathUtils.clamp(Number.isFinite(value)?value:1,1,32);},
    setPopulationLimit(value){maxColonies=THREE.MathUtils.clamp(Math.round(Number.isFinite(value)?value:32),1,capacity);},
    setWind(strength,angle=direction){wind=THREE.MathUtils.clamp(strength,0,1);direction=angle;actualWind={strength:wind,direction};windmill.update(0,wind,direction);},
    advance(dt){
      if(!group.visible||!playing||!(dt>0))return false;
      // Speed changes elapsed simulation time; small substeps preserve wind
      // paths, landing points and maturity thresholds at every playback rate.
      const duration=Math.min(dt,.1)*speed,steps=Math.ceil(duration/.025),step=duration/steps;
      for(let i=0;i<steps;i++)stepSimulation(step);
      if(clock>=nextContactUpdate){updateContacts();nextContactUpdate=clock+.5;}
      windmill.update(duration,actualWind.strength,actualWind.direction);
      applyParent();growthMaterials?.setTime(clock);updateParticles();updateView();return true;
    },
    dispose(){clear();forestFloor.dispose();windmill.dispose();contactTexture.dispose();particles.dispose();hearts.dispose();shadowMaterial.dispose();sphere.dispose();heartGeometry.dispose();for(const material of [dustMaterial,green])material.dispose();group.removeFromParent();}
  };
}

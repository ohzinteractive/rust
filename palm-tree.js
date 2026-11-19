import * as THREE from 'three';
import {generateFeatherData} from './plume-lsystem/feather-generator.js';
import {seededRandom} from './plume-lsystem/random.js';

export const defaultPalmSettings=Object.freeze({fronds:30,length:1.55,droop:1.1,curve:.65,wind:.25,density:.7,dryFraction:.3,trunkHeight:2.65,trunkRadius:.115,seed:7319});

const frondCycle=24;

export function posePalmFrond(frond,time){
  const {birth,initialPitch}=frond.userData.palmGrowth;
  const age=THREE.MathUtils.euclideanModulo(time-birth,frondCycle);
  const smooth=(start,end)=>THREE.MathUtils.smoothstep(age,start,end);
  const length=smooth(0,4.2)*(1-smooth(19,frondCycle));
  const width=.10+.90*smooth(3.2,8.8);
  frond.visible=length>.001;
  frond.scale.set(length,length,length*width);
  frond.rotation.z=initialPitch*(1-smooth(4.2,12))-.28*smooth(16,21);
}

function createPalmSeedling(floorY){
  const group=new THREE.Group();
  group.position.set(-.55,floorY,0);
  const seedMaterial=new THREE.MeshStandardMaterial({color:0x84502d,roughness:1});
  const seed=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),seedMaterial);
  seed.name='Palm seed';
  seed.rotation.z=-.25;
  seed.castShadow=true;
  group.add(seed);

  const shootMaterial=new THREE.MeshStandardMaterial({color:0x839c42,roughness:.7,side:THREE.DoubleSide});
  const shootGeometry=new THREE.BufferGeometry(),vertices=[],indices=[];
  for(let i=0;i<=16;i++){
    const t=i/16,width=.044*Math.pow(Math.sin(t*Math.PI),.65);
    const x=.12*t*t;
    vertices.push(x-width,.36*t,0,x,.36*t,.018*Math.sin(t*Math.PI),x+width,.36*t,0);
    if(i){
      const a=i*3-3;
      indices.push(a,a+1,a+3,a+1,a+4,a+3,a+1,a+2,a+4,a+2,a+5,a+4);
    }
  }
  shootGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  shootGeometry.setIndex(indices);
  shootGeometry.computeVertexNormals();
  const shoot=new THREE.Mesh(shootGeometry,shootMaterial);
  shoot.name='First palm shoot';
  shoot.castShadow=true;
  group.add(shoot);

  function seek(progress){
    const smooth=(start,end)=>THREE.MathUtils.smoothstep(progress,start,end);
    const seedSize=1-smooth(.12,.29);
    seed.visible=seedSize>.001;
    seed.position.y=.048*seedSize;
    seed.scale.set(.14*seedSize,.059*seedSize,.083*seedSize);
    const shootLength=smooth(.05,.27);
    const fade=1-smooth(.34,.49);
    shoot.visible=shootLength*fade>.001;
    shoot.scale.set(fade*smooth(.08,.27),shootLength*fade,fade);
    shoot.rotation.z=-.95*smooth(.20,.42);
  }
  return {group,seek,dispose(){
    seed.geometry.dispose();shoot.geometry.dispose();seedMaterial.dispose();shootMaterial.dispose();
    group.removeFromParent();
  }};
}

export function createPalmTree({scene,floorY=-1.75,growFronds=false,showDevelopment=false}){
  const group=new THREE.Group();group.name='Feather palm';group.visible=false;scene.add(group);
  const plant=showDevelopment?new THREE.Group():group;
  const seedling=showDevelopment?createPalmSeedling(floorY):null;
  if(seedling)group.add(plant,seedling.group);
  let development=1,developmentRig;
  const bark=new THREE.MeshStandardMaterial({color:0x66503a,roughness:1});
  const scars=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
  const leafMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83,side:THREE.DoubleSide});
  const stemMaterial=new THREE.MeshStandardMaterial({color:0x808347,roughness:.85});
  const dryStemMaterial=new THREE.MeshStandardMaterial({color:0x805735,roughness:1});
  const settings={...defaultPalmSettings},fronds=[],growingFronds=[];let clock=0,leafletCount=0;
  const agingMaterials=[];
  function clear(){for(const material of agingMaterials)material.dispose();agingMaterials.length=0;plant.traverse(object=>{if(object.isInstancedMesh)object.dispose();object.geometry?.dispose();});plant.clear();fronds.length=0;growingFronds.length=0;leafletCount=0;}
  function rebuild(values={}){
    Object.assign(settings,values);settings.fronds=Math.max(12,Math.min(48,Math.round(settings.fronds)));
    settings.density=Math.max(.25,Math.min(1,settings.density));settings.dryFraction=Math.max(0,Math.min(.6,settings.dryFraction));
    settings.trunkHeight=THREE.MathUtils.clamp(settings.trunkHeight,.3,4.5);settings.trunkRadius=THREE.MathUtils.clamp(settings.trunkRadius,.06,.24);
    clear();clock=0;const random=seededRandom(settings.seed),height=settings.trunkHeight,lean=height/2.65;
    const trunk=new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.55,floorY,0),new THREE.Vector3(-.55+.05*lean,floorY+height*.8/2.65,.04*lean),
      new THREE.Vector3(-.55+(.15+settings.curve*.65)*lean,floorY+height*1.8/2.65,.02*lean),new THREE.Vector3(-.55+(.25+settings.curve*1.05)*lean,floorY+height,0)
    ]);
    const trunkGeometry=new THREE.TubeGeometry(trunk,64,settings.trunkRadius,12,false),p=trunkGeometry.attributes.position;
    for(let row=0;row<=64;row++){
      const center=trunk.getPointAt(row/64),radius=1.2-.42*row/64;
      for(let side=0;side<=12;side++){const i=row*13+side,v=new THREE.Vector3().fromBufferAttribute(p,i).sub(center).multiplyScalar(radius).add(center);p.setXYZ(i,v.x,v.y,v.z);}
    }
    trunkGeometry.computeVertexNormals();const trunkMesh=new THREE.Mesh(trunkGeometry,bark);trunkMesh.castShadow=true;trunkMesh.receiveShadow=true;trunkMesh.name='Curved palm trunk';plant.add(trunkMesh);
    const bootRows=Math.max(4,Math.round(28*lean)),thickness=settings.trunkRadius/.115;
    const bootGeometry=new THREE.IcosahedronGeometry(1,0),boots=new THREE.InstancedMesh(bootGeometry,scars,bootRows*10),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
    const bootColor=new THREE.Color(),outward=new THREE.Vector3(0,0,1),roll=new THREE.Quaternion();
    for(let row=0;row<bootRows;row++)for(let side=0;side<10;side++){
      const t=(row+.5+(random()-.5)*.55)/bootRows,angle=(side/10+(row%2)*.05)*Math.PI*2+(random()-.5)*.16,normal=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const position=trunk.getPointAt(t).addScaledVector(normal,settings.trunkRadius*(1.2-.42*t)+.003);
      q.setFromUnitVectors(outward,normal);roll.setFromAxisAngle(outward,(random()-.5)*.55);q.multiply(roll);
      scale.set((.029+random()*.018)*thickness,height/bootRows*(.37+random()*.32),(.007+random()*.012)*thickness);
      boots.setMatrixAt(row*10+side,matrix.compose(position,q,scale));
      boots.setColorAt(row*10+side,bootColor.set(0x806449).multiplyScalar(.65+random()*.5));
    }
    boots.name='Old palm leaf bases';boots.castShadow=true;plant.add(boots);
    const crown=trunk.getPointAt(1);
    const dryCount=Math.round(settings.fronds*settings.dryFraction),liveCount=settings.fronds-dryCount;
    const growthSlots=growFronds&&!showDevelopment?[...new Set([.42,.56,.70].map(f=>Math.round((liveCount-1)*f)))]:[];
    const bud=new THREE.Mesh(new THREE.SphereGeometry(.065,12,8),stemMaterial);bud.name='Palm growing heart';bud.position.copy(crown);bud.scale.y=1.3;bud.castShadow=true;plant.add(bud);
    if(showDevelopment)developmentRig={trunk,trunkMesh,boots,bootRows,bud,leaves:[]};
    for(let index=0;index<settings.fronds;index++){
      const dry=index>=liveCount,age=index/Math.max(1,liveCount-1),spear=!dry&&age<.16,layerIndex=dry?index-liveCount:index;
      // Successive leaves spiral around the heart and open progressively with age.
      // A continuous range of inclinations avoids a separate tuft and umbrella.
      const angle=index*Math.PI*(3-Math.sqrt(5))+(random()-.5)*.3;
      const length=settings.length*(.9+random()*.2)*(dry?.85+random()*.25:.75+.54*Math.sin(age*Math.PI*.76));
      const pitch=1.43-1.08*Math.pow(Math.min(age,1),.75)+(random()-.5)*.16;
      const bend=.26+(1.50+settings.droop*.69)*Math.pow(Math.min(age,1),.94);
      const phase=random()*Math.PI*2,cos=Math.cos(angle),sin=Math.sin(angle);
      const data=generateFeatherData({length:1,spread:spear?.115:dry?.17:.215,density:settings.density*(dry?.85:1),depth:1,seed:settings.seed+index*101,contour:!dry,quillFraction:dry?.08:.14,branchLength:.3});
      leafletCount+=data.barbs.p.length/(7*6);
      const sourceAxis=t=>{
        const f=Math.max(0,Math.min(66,t*66)),i=Math.min(65,Math.floor(f))*6,u=f-Math.min(65,Math.floor(f));
        return [THREE.MathUtils.lerp(data.shaft.p[i],data.shaft.p[i+3],u),THREE.MathUtils.lerp(data.shaft.p[i+2],data.shaft.p[i+5],u)];
      };
      const transform=(x,y,z,leafRoll=0,sag=0)=>{
        const t=Math.max(0,Math.min(1.15,y+.48));
        const [axisX,axisZ]=sourceAxis(t),localX=(x-axisX)*length*(dry?.75:1),localZ=(z-axisZ)*length;
        const theta=pitch-bend*t;
        const out=length*(dry?Math.sin(t*Math.PI*.8)*.38+t*.06:(Math.sin(pitch)-Math.sin(theta))/bend);
        const vertical=dry?.12*Math.sin(t*Math.PI)-(1+settings.droop*.22)*t: length*(Math.cos(theta)-Math.cos(pitch))/bend;
        const twist=leafRoll+Math.sin(t*5+phase)*.28;
        const lateral=localX*Math.cos(twist)-localZ*Math.sin(twist)+axisX*length*.18;
        const lift=localX*Math.sin(twist)+localZ*Math.cos(twist);
        const radial=out-lift*Math.sin(theta),heightAt=Math.max(floorY-crown.y+.3,vertical+lift*Math.cos(theta)-sag);
        return new THREE.Vector3(cos*radial-sin*lateral,heightAt,sin*radial+cos*lateral);
      };
      const positions=[],colors=[],normal=new THREE.Vector3();
      const base=new THREE.Color(dry?(layerIndex%2?0x97713f:0x80552f):0x667044);
      base.multiplyScalar(dry?.85+random()*.35:.82+random()*.28);
      // Each feather barb becomes a narrow palm leaflet. Retain its segmented
      // curvature and alternating placement, replacing the feather's fuzz.
      for(let leaflet=0;leaflet<data.barbs.p.length;leaflet+=42){
        const source=data.barbs.p,rootY=source[leaflet+1],rootT=rootY+.48;
        const rootAxis=sourceAxis(rootT);
        const side=Math.sign(source[leaflet+39]-rootAxis[0]);
        // Opposite leaflets fold down on both sides of the central rib.
        const leafRoll=-side*(.22+.38*Math.min(1,age)+Math.sin(rootT*7+phase)*.10)+(random()-.5)*.16;
        const stretch=.9+random()*.2,sag=(dry?.60:.32+.55*Math.min(age,1))+random()*.12,shade=.85+random()*.3;
        const point=offset=>{
          const y=rootY+(source[offset+1]-rootY)*stretch,t=y+.48,axis=sourceAxis(t);
          const x=axis[0]+(source[offset]-rootAxis[0])*stretch;
          const z=axis[1]+source[offset+2]-rootAxis[1];
          const reach=Math.abs(source[offset]-rootAxis[0])*length;
          return transform(x,y,z,leafRoll,sag*reach*Math.min(1,reach/(length*.16)));
        };
        const points=Array.from({length:8},(_,k)=>point(leaflet+(k===7?39:k*6)));
        const theta=pitch-bend*rootT;
        normal.set(-cos*Math.sin(theta),Math.cos(theta),-sin*Math.sin(theta));
        normal.applyAxisAngle(new THREE.Vector3(cos*Math.cos(theta),Math.sin(theta),sin*Math.cos(theta)),leafRoll);
        const edges=points.map((p,k)=>{
          const u=k/7,width=(dry?.0038:.0044)*length*(.55+Math.sin(u*Math.PI)*.65)*Math.pow(1-u,.7);
          const across=new THREE.Vector3().subVectors(points[Math.min(7,k+1)],points[Math.max(0,k-1)]).cross(normal).normalize().multiplyScalar(width);
          return [p.clone().add(across),p.clone().sub(across)];
        });
        for(let section=0;section<7;section++){
          const [a,b]=edges[section],[c,d]=edges[section+1];
          for(const v of [a,b,c,c,b,d]){positions.push(v.x,v.y,v.z);colors.push(base.r*shade,base.g*shade,base.b*shade);}
        }
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
      const leaf=new THREE.Mesh(geometry,leafMaterial);leaf.castShadow=true;leaf.receiveShadow=true;
      const shaft=[];for(let i=0;i<data.shaft.p.length;i+=6)shaft.push(transform(data.shaft.p[i],data.shaft.p[i+1],data.shaft.p[i+2]));
      const end=data.shaft.p.length;shaft.push(transform(data.shaft.p[end-3],data.shaft.p[end-2],data.shaft.p[end-1]));
      const stem=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shaft),40,dry?.0045:.0055,4,false),dry?dryStemMaterial:stemMaterial);stem.castShadow=true;
      if(showDevelopment){
        for(const mesh of [leaf,stem]){
          mesh.material=mesh.material.clone();
          mesh.material.transparent=true;
          agingMaterials.push(mesh.material);
        }
      }
      const frond=new THREE.Group();frond.name=dry?'Dry palm frond':'Green palm frond';frond.userData.layer=dry?'dry':spear?'spear':'canopy';frond.position.copy(crown);
      frond.position.y+=dry?-.16-random()*.13:.09-age*.13;
      if(dry){frond.position.x+=Math.cos(angle)*.075;frond.position.z+=Math.sin(angle)*.075;}
      if(showDevelopment&&dry)frond.userData.crownOffset=frond.position.clone().sub(crown);
      const slot=growthSlots.indexOf(index);
      if(showDevelopment){
        // Fold across the rachis and pitch in its radial plane, at any azimuth.
        leaf.geometry.rotateY(angle);
        stem.geometry.rotateY(angle);
        const heading=new THREE.Group(),blade=new THREE.Group();
        heading.rotation.y=-angle;
        blade.add(leaf,stem);
        heading.add(blade);
        frond.add(heading);
        const tip=shaft.at(-1);
        const pitchToVertical=1.48-Math.atan2(tip.y,Math.hypot(tip.x,tip.z));
        const restPitch=pitchToVertical-1.48;
        let lowest=0;
        for(const mesh of [leaf,stem]){
          const points=mesh.geometry.attributes.position;
          for(let i=0;i<points.count;i++){
            lowest=Math.min(lowest,points.getX(i)*Math.sin(restPitch)+points.getY(i)*Math.cos(restPitch));
          }
        }
        frond.userData.landing={restPitch,clearance:-lowest};
        if(!dry)developmentRig.leaves.push({frond,blade,pitchToVertical,rank:liveCount-1-index});
      }else if(slot<0)frond.add(leaf,stem);
      else{
        leaf.geometry.rotateY(angle);
        stem.geometry.rotateY(angle);
        const heading=new THREE.Group();
        heading.rotation.y=-angle;
        const growing=new THREE.Group();
        growing.name='Growing palm frond';
        const tip=shaft.at(-1);
        growing.userData.palmGrowth={
          birth:slot*frondCycle/growthSlots.length,
          initialPitch:1.48-Math.atan2(tip.y,Math.hypot(tip.x,tip.z))
        };
        growing.add(leaf,stem);
        heading.add(growing);
        frond.add(heading);
        frond.position.y=crown.y+.045;
        growingFronds.push(growing);
        posePalmFrond(growing,0);
      }
      plant.add(frond);
      fronds.push({group:frond,phase:random()*Math.PI*2,birth:dry?.71+.10*layerIndex/Math.max(1,dryCount-1):.25+age*.37});
    }
    seekDevelopment(development);
    group.updateMatrixWorld(true);
  }
  function seekDevelopment(progress){
    if(!seedling)return;
    development=THREE.MathUtils.clamp(progress,0,1);
    const smooth=(start,end)=>THREE.MathUtils.smoothstep(development,start,end);
    seedling.seek(development);
    const {trunk,trunkMesh,boots,bootRows,bud,leaves}=developmentRig;
    const count=leaves.length;
    // Give the first few leaves longer on screen, then shorten the interval
    // as the palm matures. Each integer marks one new leaf at the growing tip.
    const elapsed=THREE.MathUtils.clamp((development-.15)/.85,0,1);
    const leavesPerRing=3;
    const crownRings=Math.ceil(count/leavesPerRing);
    const ringCount=Math.max(bootRows,crownRings);
    const juvenileCount=(ringCount-crownRings)*leavesPerRing;
    const reusableLeaves=count-count%leavesPerRing;
    const total=juvenileCount+count;
    const leafTime=total*Math.pow(elapsed,1.8);
    // Pack the live crown into short internodes above the exposed trunk.
    const crownStart=ringCount-crownRings;
    const ringHeight=n=>crownStart===0?n/ringCount:n<=crownStart
      ? .94*n/crownStart : .94+.06*(n-crownStart)/crownRings;
    const currentRing=Math.min(ringCount-1,Math.floor(leafTime/leavesPerRing));
    const ringAge=leafTime-currentRing*leavesPerRing;
    // Extend the next internode before its first blade unfolds.
    const rise=THREE.MathUtils.smoothstep(ringAge,0,.23);
    const height=ringHeight(currentRing+rise);
    const width=.22+.78*smooth(.24,.97);
    plant.visible=leafTime>.001;
    plant.scale.set(width,width,width);
    plant.position.set(-.55*(1-width),floorY*(1-width),0);
    trunkMesh.geometry.setDrawRange(0,Math.ceil(64*height)*12*6);
    boots.count=Math.floor(bootRows*height)*10;
    trunk.getPointAt(height,bud.position);
    // Seek the whole shedding motion from age so rewinding also restores the leaf.
    function shed(frond,blade,decay,fall,fade,heading){
      const [leaf,stem]=blade.children;
      leaf.material.color.setRGB(1+.65*decay,1-.48*decay,1-.72*decay);
      stem.material.color.copy(frond.userData.layer==='dry'?dryStemMaterial.color:stemMaterial.color)
        .lerp(dryStemMaterial.color,decay);
      leaf.material.opacity=stem.material.opacity=1-fade;
      const drop=fall*fall;
      frond.position.x+=Math.cos(heading)*settings.length*.42*fall;
      frond.position.z+=Math.sin(heading)*settings.length*.42*fall;
      const {restPitch,clearance}=frond.userData.landing;
      const settle=THREE.MathUtils.smoothstep(fall,0,1);
      blade.rotation.z=THREE.MathUtils.lerp(blade.rotation.z,restPitch,settle);
      const ground=floorY+.003+clearance*blade.scale.y*frond.scale.y;
      frond.position.y=THREE.MathUtils.lerp(frond.position.y,ground,drop);
      frond.visible=frond.visible&&fade<1;
    }
    // Reuse the oldest seedling leaves after they shed. Each leaf stays
    // attached to its own node from its first appearance to senescence.
    for(const {frond,blade,pitchToVertical,rank:birth} of leaves){
      const finalNode=juvenileCount+birth;
      let node=finalNode;
      if(birth<reusableLeaves&&leafTime<finalNode){
        node-=Math.ceil((finalNode-leafTime)/reusableLeaves)*reusableLeaves;
      }
      const ring=Math.floor(node/leavesPerRing);
      const slot=node%leavesPerRing;
      const age=leafTime-node-(slot===0?.23:0);
      frond.visible=node>=0&&age>0;
      if(!frond.visible)continue;
      const life=node===finalNode?0:(leafTime-node)/reusableLeaves;
      const decay=THREE.MathUtils.smoothstep(life,.46,.73);
      const fall=THREE.MathUtils.clamp((life-.73)/.16,0,1);
      const fade=THREE.MathUtils.smoothstep(life,.90,.99);
      const juvenileLength=.46+.54*THREE.MathUtils.smoothstep(ring,0,ringCount*.38);
      const size=juvenileLength*THREE.MathUtils.smoothstep(age,0,.95);
      const open=THREE.MathUtils.smoothstep(age,.18,.95);
      trunk.getPointAt(ringHeight(ring+1),frond.position);
      blade.parent.rotation.y=-(slot*2*Math.PI/3+ring*Math.PI*(3-Math.sqrt(5)));
      blade.scale.set(size,size,size*(.10+.90*open));
      blade.rotation.z=pitchToVertical*(1-open)-decay*.48;
      frond.scale.setScalar(1);
      shed(frond,blade,decay,fall,fade,-blade.parent.rotation.y);
    }
    for(const {group,birth} of fronds){
      if(group.userData.layer!=='dry')continue;
      const size=smooth(birth,birth+.09);
      group.visible=size>.001;
      group.scale.setScalar(size);
      const offset=group.userData.crownOffset;
      const release=birth+.12;
      // Even the last dry frond lands and fades before development stops.
      const dryAge=THREE.MathUtils.clamp((development-release)/.022,0,1);
      // A dead frond belongs to the ring where it first appeared. Following
      // the growing heart would lift it by one internode at every new ring.
      const birthTime=total*Math.pow((birth-.15)/.85,1.8);
      const birthRing=Math.min(ringCount-1,Math.floor(birthTime/leavesPerRing));
      trunk.getPointAt(ringHeight(birthRing+1),group.position).add(offset);
      const blade=group.children[0].children[0];
      blade.rotation.z=0;
      shed(group,blade,1,dryAge,
        THREE.MathUtils.smoothstep(development,release+.025,release+.049),Math.atan2(offset.z,offset.x));
    }
  }
  return {group,rebuild,seekDevelopment,
    get settings(){return {...settings};},get stats(){return {fronds:fronds.length,leaflets:leafletCount};},
    setWind(value){settings.wind=Math.max(0,Math.min(1,value));if(settings.wind===0)for(const frond of fronds)frond.group.rotation.set(0,0,0);},
    advance(dt){
      if(!group.visible||!(dt>0)||(!settings.wind&&!growingFronds.length))return false;
      clock+=Math.min(dt,.05);
      for(const frond of growingFronds)posePalmFrond(frond,clock);
      if(settings.wind>0)for(const frond of fronds){frond.group.rotation.z=Math.sin(clock*.8+frond.phase)*settings.wind*.055;frond.group.rotation.x=Math.cos(clock*.65+frond.phase)*settings.wind*.035;}
      return true;
    },
    dispose(){clear();seedling?.dispose();group.removeFromParent();for(const material of [bark,scars,leafMaterial,stemMaterial,dryStemMaterial])material.dispose();}
  };
}

import * as THREE from 'three';
import {generateFeatherData} from './plume-lsystem/feather-generator.js';
import {seededRandom} from './plume-lsystem/random.js';

export const defaultPalmSettings=Object.freeze({fronds:30,length:1.55,droop:1.1,curve:.65,wind:.25,density:.7,dryFraction:.3,trunkHeight:2.65,trunkRadius:.115,seed:7319});

export function createPalmTree({scene,floorY=-1.75}){
  const group=new THREE.Group();group.name='Feather palm';group.visible=false;scene.add(group);
  const bark=new THREE.MeshStandardMaterial({color:0x66503a,roughness:1});
  const scars=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
  const leafMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83,side:THREE.DoubleSide});
  const stemMaterial=new THREE.MeshStandardMaterial({color:0x808347,roughness:.85});
  const dryStemMaterial=new THREE.MeshStandardMaterial({color:0x805735,roughness:1});
  const settings={...defaultPalmSettings},fronds=[];let clock=0,leafletCount=0;
  function clear(){group.traverse(object=>{if(object.isInstancedMesh)object.dispose();object.geometry?.dispose();});group.clear();fronds.length=0;leafletCount=0;}
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
    trunkGeometry.computeVertexNormals();const trunkMesh=new THREE.Mesh(trunkGeometry,bark);trunkMesh.castShadow=true;trunkMesh.receiveShadow=true;trunkMesh.name='Curved palm trunk';group.add(trunkMesh);
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
    boots.name='Old palm leaf bases';boots.castShadow=true;group.add(boots);
    const crown=trunk.getPointAt(1);
    const dryCount=Math.round(settings.fronds*settings.dryFraction),liveCount=settings.fronds-dryCount;
    const bud=new THREE.Mesh(new THREE.SphereGeometry(.065,12,8),stemMaterial);bud.name='Palm growing heart';bud.position.copy(crown);bud.scale.y=1.3;bud.castShadow=true;group.add(bud);
    for(let index=0;index<settings.fronds;index++){
      const dry=index>=liveCount,age=index/Math.max(1,liveCount-1),spear=!dry&&age<.16,layerIndex=dry?index-liveCount:index;
      // Successive leaves spiral around the heart and open progressively with age.
      // A continuous range of inclinations avoids a separate tuft and umbrella.
      const angle=index*Math.PI*(3-Math.sqrt(5))+(random()-.5)*.3;
      const length=settings.length*(.9+random()*.2)*(dry?.85+random()*.25:.72+.36*Math.sin(age*Math.PI*.8));
      const pitch=1.38-1.5*Math.pow(Math.min(age,1),.85)+(random()-.5)*.16;
      const bend=.18+(1.2+settings.droop*.65)*Math.pow(Math.min(age,1),1.25);
      const phase=random()*Math.PI*2,cos=Math.cos(angle),sin=Math.sin(angle);
      const data=generateFeatherData({length:1,spread:spear?.16:dry?.17:.24,density:settings.density*(dry?.85:1),depth:1,seed:settings.seed+index*101,contour:!dry,quillFraction:dry?.08:.14,branchLength:.3});
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
      const base=new THREE.Color(dry?(layerIndex%2?0x97713f:0x80552f):0x64743d);
      base.multiplyScalar(dry?.85+random()*.35:.82+random()*.28);
      // Each feather barb becomes a narrow palm leaflet. Retain its segmented
      // curvature and alternating placement, replacing the feather's fuzz.
      for(let leaflet=0;leaflet<data.barbs.p.length;leaflet+=42){
        const source=data.barbs.p,rootY=source[leaflet+1],rootT=rootY+.48;
        const rootAxis=sourceAxis(rootT);
        const side=Math.sign(source[leaflet+39]-rootAxis[0]);
        const leafRoll=side*(.4+Math.sin(rootT*7+phase)*.18)+(random()-.5)*.35;
        const stretch=.9+random()*.2,sag=(dry?.25:.12)+random()*.2,shade=.85+random()*.3;
        const point=offset=>{
          const y=rootY+(source[offset+1]-rootY)*stretch,t=y+.48,axis=sourceAxis(t);
          const x=axis[0]+(source[offset]-rootAxis[0])*stretch;
          const z=axis[1]+source[offset+2]-rootAxis[1];
          const reach=Math.abs(source[offset]-rootAxis[0])*length;
          return transform(x,y,z,leafRoll,sag*reach*reach);
        };
        const points=Array.from({length:8},(_,k)=>point(leaflet+(k===7?39:k*6)));
        const theta=pitch-bend*rootT;
        normal.set(-cos*Math.sin(theta),Math.cos(theta),-sin*Math.sin(theta));
        normal.applyAxisAngle(new THREE.Vector3(cos*Math.cos(theta),Math.sin(theta),sin*Math.cos(theta)),leafRoll);
        const edges=points.map((p,k)=>{
          const u=k/7,width=(dry?.005:.01)*length*(.55+Math.sin(u*Math.PI)*.65)*Math.pow(1-u,.7);
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
      const frond=new THREE.Group();frond.name=dry?'Dry palm frond':'Green palm frond';frond.userData.layer=dry?'dry':spear?'spear':'canopy';frond.position.copy(crown);
      frond.position.y+=dry?-.16-random()*.13:.09-age*.13;
      if(dry){frond.position.x+=Math.cos(angle)*.075;frond.position.z+=Math.sin(angle)*.075;}
      frond.add(leaf,stem);group.add(frond);
      fronds.push({group:frond,phase:random()*Math.PI*2});
    }
    group.updateMatrixWorld(true);
  }
  return {group,rebuild,
    get settings(){return {...settings};},get stats(){return {fronds:fronds.length,leaflets:leafletCount};},
    setWind(value){settings.wind=Math.max(0,Math.min(1,value));if(settings.wind===0)for(const frond of fronds)frond.group.rotation.set(0,0,0);},
    advance(dt){
      if(!group.visible||settings.wind===0||!(dt>0))return false;clock+=Math.min(dt,.05);
      for(const frond of fronds){frond.group.rotation.z=Math.sin(clock*.8+frond.phase)*settings.wind*.055;frond.group.rotation.x=Math.cos(clock*.65+frond.phase)*settings.wind*.035;}
      return true;
    },
    dispose(){clear();group.removeFromParent();for(const material of [bark,scars,leafMaterial,stemMaterial,dryStemMaterial])material.dispose();}
  };
}

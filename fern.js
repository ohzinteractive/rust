import * as THREE from 'three';
import {generateFeatherData} from './plume-lsystem/feather-generator.js';
import {seededRandom} from './plume-lsystem/random.js';

export const defaultFernSettings=Object.freeze({fronds:18,length:1.4,density:.7,arch:.65,wind:.25,seed:7319});

// Feather barbs provide the alternating primary branches; each branch carries
// a second tier of tapered, toothed pinnules rather than a palm's simple blade.
export function createFern({scene,floorY=-1.75}){
  const group=new THREE.Group();group.name='Fern crown';group.visible=false;scene.add(group);
  const foliage=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.9});
  const stalk=new THREE.MeshStandardMaterial({color:0x667246,roughness:1});
  const settings={...defaultFernSettings},fronds=[];let clock=0,pinnae=0,pinnules=0;
  function clear(){group.traverse(node=>node.geometry?.dispose());group.clear();fronds.length=0;pinnae=0;pinnules=0;}
  function rebuild(values={}){
    Object.assign(settings,values);
    for(const [key,min,max] of [['fronds',6,32],['length',.5,2.2],['density',.25,1],['arch',0,1],['wind',0,1]]){
      settings[key]=THREE.MathUtils.clamp(Number.isFinite(settings[key])?settings[key]:defaultFernSettings[key],min,max);
    }
    settings.fronds=Math.round(settings.fronds);clear();clock=0;
    const random=seededRandom(settings.seed);
    for(let i=0;i<settings.fronds;i++){
      const angle=i*Math.PI*(3-Math.sqrt(5))+(random()-.5)*.3;
      const age=i/(settings.fronds-1),length=settings.length*(.66+.34*Math.sin(age*Math.PI*.8))*(.9+random()*.2);
      const pitch=1.38-age*.8+(random()-.5)*.16,bend=.25+settings.arch*(.35+age*1.3)+(random()-.5)*.22,phase=random()*Math.PI*2;
      const data=generateFeatherData({length:1,spread:.23,density:.18+settings.density*.2,depth:1,contour:true,quillFraction:.13,seed:settings.seed+i*101});
      const axis=t=>{
        const row=THREE.MathUtils.clamp(t,0,1)*66,index=Math.min(65,Math.floor(row))*6,u=row-Math.min(65,Math.floor(row));
        return new THREE.Vector3(THREE.MathUtils.lerp(data.shaft.p[index],data.shaft.p[index+3],u),(t-.48),THREE.MathUtils.lerp(data.shaft.p[index+2],data.shaft.p[index+5],u));
      };
      const map=p=>{
        const t=p.y+.48,center=axis(t),theta=pitch-bend*t;
        const out=length*(Math.sin(pitch)-Math.sin(theta))/bend;
        const y=length*(Math.cos(theta)-Math.cos(pitch))/bend;
        const lateral=(p.x-center.x)*length,fold=(p.z-center.z)*length+Math.abs(lateral)*.12;
        return new THREE.Vector3(out-fold*Math.sin(theta),Math.max(.015,y+fold*Math.cos(theta)),lateral+center.x*length*.05+Math.sin(t*2.5+phase)*lateral*.12);
      };
      const positions=[],colors=[],rachisT=[],base=new THREE.Color(0x789767).multiplyScalar(.78+random()*.3);
      const triangle=(a,b,c,shade)=>{for(const p of [a,b,c]){const v=map(p);positions.push(v.x,v.y,v.z);rachisT.push(THREE.MathUtils.clamp(p.y+.48,0,1.15));colors.push(base.r*shade,base.g*shade,base.b*shade);}};
      // Toothed pinnules form a visible, twice-divided fern silhouette.
      const blade=(root,tip,width,shade)=>{
        const delta=tip.clone().sub(root),across=new THREE.Vector3(-delta.y,delta.x,0).normalize();
        let left=root.clone(),right=root.clone();
        for(let k=1;k<=8;k++){
          const t=k/8,center=root.clone().addScaledVector(delta,t);
          const w=width*Math.pow(Math.sin(Math.PI*t),.65)*(k%2?.77:1);
          const a=center.clone().addScaledVector(across,w),b=center.clone().addScaledVector(across,-w);
          triangle(left,right,a,shade);triangle(a,right,b,shade*.96);left=a;right=b;
        }
      };
      for(let offset=0;offset<data.barbs.p.length;offset+=42){
        pinnae++;
        const points=Array.from({length:8},(_,k)=>new THREE.Vector3().fromArray(data.barbs.p,offset+(k===7?39:k*6)));
        const sample=u=>{const f=u*7,k=Math.min(6,Math.floor(f));return points[k].clone().lerp(points[k+1],f-k);};
        const reach=points[0].distanceTo(points[7]),count=Math.max(4,Math.round(7+settings.density*5)),side=Math.sign(points[7].x-points[0].x);
        blade(points[0],points[7],.0035,.85);
        for(let j=0;j<count;j++)for(const sign of [-1,1]){
          const u=.07+j/count*.85+(sign===1?.02:0),root=sample(u);
          const size=reach*.29*Math.pow(Math.sin(Math.PI*(.12+u*.86)),.7)*(1-u*.5);
          const tip=root.clone().add(new THREE.Vector3(side*size*.42,sign*size,Math.sin(u*5+phase)*size*.12));
          blade(root,tip,size*.28,.85+random()*.3);pinnules++;
        }
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('rachisT',new THREE.Float32BufferAttribute(rachisT,1));geometry.computeVertexNormals();
      const leaf=new THREE.Mesh(geometry,foliage);leaf.name='Divided fern foliage';leaf.castShadow=true;leaf.receiveShadow=true;
      const curve=new THREE.CatmullRomCurve3(Array.from({length:34},(_,k)=>map(axis(k/33))));
      const stem=new THREE.Mesh(new THREE.TubeGeometry(curve,40,.003*length,4,false),stalk);stem.name='Fern rachis';stem.castShadow=true;
      const frond=new THREE.Group();frond.name='Fern frond';frond.userData={length,pitch,bend};frond.position.set(Math.cos(angle)*.035,floorY+.02,Math.sin(angle)*.035);frond.rotation.y=angle;
      frond.add(leaf,stem);group.add(frond);fronds.push({group:frond,angle,phase});
    }
    group.updateMatrixWorld(true);
  }
  return {group,rebuild,get settings(){return {...settings};},get stats(){return {fronds:fronds.length,pinnae,pinnules};},
    setWind(value){settings.wind=THREE.MathUtils.clamp(value,0,1);if(!settings.wind)for(const f of fronds){f.group.rotation.x=0;f.group.rotation.z=0;}},
    advance(dt){if(!group.visible||!settings.wind||!(dt>0))return false;clock+=Math.min(dt,.05);for(const f of fronds){f.group.rotation.x=Math.sin(clock*.9+f.phase)*settings.wind*.025;f.group.rotation.z=Math.cos(clock*.7+f.phase)*settings.wind*.035;}return true;},
    dispose(){clear();group.removeFromParent();foliage.dispose();stalk.dispose();}
  };
}

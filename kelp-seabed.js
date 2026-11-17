import * as THREE from 'three';
import {mergeVertices} from './vendor/BufferGeometryUtils.js';
import {causticShader} from './kelp-caustics.js';
import {configureKelpSunlight,kelpSunlightShader} from './kelp-lighting.js';

const smooth=t=>t*t*(3-2*t),fract=x=>x-Math.floor(x);
function noise(x,z){
  const ix=Math.floor(x),iz=Math.floor(z),u=smooth(x-ix),v=smooth(z-iz);
  const hash=(a,b)=>fract(Math.sin(a*127.1+b*311.7)*43758.5453);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),u),THREE.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v);
}

// Shared by the visible floor, settled stones and small debris. The sculpture
// clearing remains nearly level; broad dunes and shallow troughs surround it.
export function seabedHeight(x,z){
  const clearing=1-Math.exp(-(x*x+(z-2.5)*(z-2.5))*.16);
  const broad=(noise(x*.23+7,z*.23-3)-.5)*.12+(noise(x*.61,z*.61)-.5)*.035;
  const ripple=Math.sin(x*5.7+z*1.4+noise(x*.28,z*.28)*2.2)*.009;
  return (broad+ripple)*clearing;
}

const sedimentNoiseShader=`
  float sedimentHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float sedimentNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(sedimentHash(i),sedimentHash(i+vec2(1.0,0.0)),f.x),
      mix(sedimentHash(i+vec2(0.0,1.0)),sedimentHash(i+vec2(1.0,1.0)),f.x),f.y);
  }
`;
const reliefNormalShader=`
  vec3 seabedDx=dFdx(-vViewPosition),seabedDy=dFdy(-vViewPosition);
  vec3 seabedRx=cross(seabedDy,normal),seabedRy=cross(normal,seabedDx);
  float seabedDet=dot(seabedDx,seabedRx);
  normal=normalize(abs(seabedDet)*normal-sign(seabedDet)*
    (dFdx(surfaceRelief)*seabedRx+dFdy(surfaceRelief)*seabedRy));
`;

export function createSeabedStoneGeometry(){
  const source=new THREE.IcosahedronGeometry(1,2),position=source.attributes.position,p=new THREE.Vector3();
  for(let i=0;i<position.count;i++){
    p.fromBufferAttribute(position,i);
    const radial=1+.09*Math.sin(p.x*5+p.y*3+p.z*2)+.055*Math.sin(p.y*7-p.z*4);
    p.x*=radial*(1+.12*p.y+.08*p.z);p.z*=radial*(1-.10*p.x);p.y*=radial;
    if(p.y>.55)p.y=.55+(p.y-.55)*.7;
    if(p.y<-.6)p.y=-.6+(p.y+.6)*.6;
    position.setXYZ(i,p.x,p.y,p.z);
  }
  source.deleteAttribute('normal');source.deleteAttribute('uv');
  const welded=mergeVertices(source,1e-4);source.dispose();welded.center();welded.computeVertexNormals();
  const geometry=welded.toNonIndexed();welded.dispose();
  const smoothNormals=geometry.attributes.normal.array.slice();geometry.computeVertexNormals();
  const normals=geometry.attributes.normal;
  for(let i=0;i<normals.count;i++){
    p.fromArray(smoothNormals,i*3).multiplyScalar(.65).addScaledVector(new THREE.Vector3().fromBufferAttribute(normals,i),.35).normalize();
    normals.setXYZ(i,p.x,p.y,p.z);
  }
  geometry.computeBoundingSphere();return geometry;
}

export function createSeabedStoneMaterial({sunlight,time}){
  const material=new THREE.MeshStandardMaterial({color:0x7c8271,roughness:.88});
  configureKelpSunlight(material,sunlight);
  const sunlightCompile=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    sunlightCompile(shader);shader.uniforms.seabedTime=time;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vStoneLocal;varying float vStoneUp;')
      .replace('#include <project_vertex>',`#include <project_vertex>
        vStoneLocal=position;vStoneUp=inverseTransformDirection(transformedNormal,viewMatrix).y;
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vStoneLocal;varying float vStoneUp;uniform float seabedTime;
      ${sedimentNoiseShader}
    `).replace('#include <color_fragment>',`#include <color_fragment>
      float stoneTop=smoothstep(-.12,.8,vStoneUp);
      vec2 stoneCoord=vUnderwaterWorld.xz+vUnderwaterWorld.y*vec2(.63,.37);
      float stoneMottle=sedimentNoise(stoneCoord*2.2);
      float stoneGrain=sedimentNoise(stoneCoord*22.0);
      float stoneDetail=1.0-smoothstep(.35,1.2,length(fwidth(stoneCoord*22.0)));
      float stoneAlgae=smoothstep(.57,.82,sedimentNoise(stoneCoord*.85))*stoneTop;
      vec3 stoneTone=mix(vec3(.42,.52,.52),vec3(1.08,1.05,.90),stoneTop);
      stoneTone*=mix(.65,1.24,stoneMottle)*(0.92+stoneGrain*.16*stoneDetail);
      stoneTone=mix(stoneTone,stoneTone*vec3(.70,.85,.60),stoneAlgae*.28);
      diffuseColor.rgb*=stoneTone;
      float stoneSediment=(1.0-smoothstep(-.18,.14,vStoneLocal.y))*(.35+.45*stoneMottle);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.16,.19,.14),stoneSediment*.7);
      float stonePits=sedimentNoise(stoneCoord*5.0+vStoneLocal.y*vec2(2.3,4.0));
      float surfaceRelief=(stonePits-.5)*.012+(stoneGrain-.5)*.004*stoneDetail+
        sin(vStoneLocal.x*17.0+vStoneLocal.z*9.0+vStoneLocal.y*13.0)*.0018;
    `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(.90+(stoneMottle-.5)*.20-stoneTop*.18+stoneAlgae*.08,.63,1.0);
    `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      ${reliefNormalShader}
    `).replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
      ${causticShader}
      float stoneSunPattern(vec3 p){
        float depth=max(0.0,waterSurface-p.y);
        vec2 caustic=waterCaustics((p.xz-p.y*waterSunSlope())*.65,seabedTime,.72,.006+depth*.0008);
        float pattern=.87+(caustic.x*.47+caustic.y*.08)*exp(-depth*.06);
        return mix(1.0,pattern,smoothstep(0.0,.75,vStoneUp));
      }
    `).replace('waterSunTransmission(vUnderwaterWorld),isSun)','waterSunTransmission(vUnderwaterWorld)*stoneSunPattern(vUnderwaterWorld),isSun)');
  };
  material.customProgramCacheKey=()=>'settled-underwater-stone-v1';return material;
}

export function createKelpSeabed({sunlight,time}){
  const geometry=new THREE.PlaneGeometry(160,160,224,224),position=geometry.attributes.position;
  const contacts=new Float32Array(position.count*2),base=new Float32Array(position.count*2);
  const stretch=t=>Math.sign(t)*(12*Math.abs(t)+68*Math.pow(Math.abs(t),5));
  for(let i=0;i<position.count;i++){
    const x=stretch(position.getX(i)/80),z=stretch(-position.getY(i)/80);
    base[i*2]=x;base[i*2+1]=z;position.setXYZ(i,x,-z,seabedHeight(x,z));
  }
  geometry.setAttribute('seabedSediment',new THREE.BufferAttribute(contacts,2));
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.94});
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,sunlight,{seabedTime:time,
      sandPale:{value:new THREE.Color(0x959b7c)},sandCool:{value:new THREE.Color(0x6b8580)},sandSilt:{value:new THREE.Color(0x76765f)}});
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec2 seabedSediment;varying vec2 vSandContact;varying vec3 vSeabed;
    `).replace('#include <project_vertex>',`#include <project_vertex>
      vSeabed=(modelMatrix*vec4(transformed,1.0)).xyz;vSandContact=seabedSediment;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 vSandContact;varying vec3 vSeabed;
      uniform vec3 sandPale,sandCool,sandSilt;uniform float seabedTime;
      ${sedimentNoiseShader}
      ${kelpSunlightShader}
    `).replace('#include <color_fragment>',`#include <color_fragment>
      vec2 sandCoord=vSeabed.xz;
      float sandRegion=sedimentNoise(sandCoord*.21+vec2(4.0,7.0));
      float sandPatch=sedimentNoise(sandCoord*.67-vec2(3.0,2.0));
      float sandSiltMask=smoothstep(.48,.78,sandPatch)*.55;
      float sandAngle=.16+.42*sedimentNoise(sandCoord*.12);
      float sandAcross=dot(sandCoord,vec2(cos(sandAngle),sin(sandAngle)));
      float sandPhase=sandAcross*12.0+sedimentNoise(sandCoord*.35)*2.6;
      float sandResolved=1.0-smoothstep(.6,2.0,fwidth(sandPhase));
      float clearing=1.0-exp(-dot(sandCoord-vec2(0.0,2.5),sandCoord-vec2(0.0,2.5))*.14);
      float rippleAmplitude=mix(.28,1.0,clearing)*(1.0-vSandContact.y*.65);
      float ripple=sin(sandPhase)*sandResolved*rippleAmplitude;
      vec3 sandTone=mix(sandCool,sandPale,.22+sandRegion*.65);
      sandTone=mix(sandTone,sandSilt,sandSiltMask);
      sandTone=mix(sandTone,sandPale*.93,vSandContact.y*.14);
      sandTone*=.78*(1.0+ripple*.10)*(1.0-vSandContact.x*.26);
      diffuseColor.rgb*=sandTone;
      float grain=sedimentNoise(sandCoord*45.0);
      float grainResolved=1.0-smoothstep(.35,1.0,length(fwidth(sandCoord*45.0)));
      diffuseColor.rgb*=1.0+(grain-.5)*.035*grainResolved;
      float surfaceRelief=ripple*.012+(grain-.5)*.0012*grainResolved;
    `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      roughnessFactor=clamp(.94+(sandPatch-.5)*.07+min(0.0,ripple)*.09-sandSiltMask*.11,.82,1.0);
    `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      ${reliefNormalShader}
    `).replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
      ${causticShader}
      void RE_Direct_Seabed(const in IncidentLight light,const in vec3 position,
        const in vec3 normal,const in vec3 viewDir,const in vec3 coatNormal,
        const in PhysicalMaterial sand,inout ReflectedLight reflected){
        IncidentLight filtered=light;
        vec3 worldLight=inverseTransformDirection(light.direction,viewMatrix);
        float isSun=smoothstep(.98,.999,dot(worldLight,waterSunDirection));
        float depth=max(0.0,waterSurface-vSeabed.y);
        vec2 caustic=waterCaustics((vSeabed.xz-vSeabed.y*waterSunSlope())*.65,seabedTime,1.35,.022+depth*.0015);
        vec3 worldNormal=inverseTransformDirection(normal,viewMatrix);
        float slope=smoothstep(.35,.95,worldNormal.y);
        float pattern=.85+(caustic.x*.37+caustic.y*.23)*exp(-depth*.06)*slope;
        filtered.color*=mix(vec3(1.0),waterSunTransmission(vSeabed)*pattern,isSun);
        RE_Direct_Physical(filtered,position,normal,viewDir,coatNormal,sand,reflected);
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_Seabed
    `);
  };
  material.customProgramCacheKey=()=>'rippled-sediment-banks-v2';
  let rocks=[],impact=null,impactProgress=0;
  let restingHeights=null;
  function sample(x,z){
    let deposits=0,contact=0;
    for(const rock of rocks){
      const dx=x-rock.center.x,dz=z-rock.center.z;
      if(Math.abs(dx)>rock.extentX||Math.abs(dz)>rock.extentZ)continue;
      const u=(rock.c*dx-rock.s*dz)/rock.rx,v=(rock.s*dx+rock.c*dz)/rock.rz,r=Math.hypot(u,v);
      if(r>3.5)continue;
      const angle=Math.atan2(v,u),crest=1.04+.16*Math.sin(angle*3+rock.phase)+.08*Math.sin(angle*5-rock.phase);
      const width=.82+.12*Math.sin(angle*2+rock.phase);
      // Wide skirts overlap into uneven islands around groups of stones.
      // Saturating the combined deposit keeps dense groups from growing spikes.
      deposits+=rock.amplitude*(Math.exp(-Math.pow((r-crest)/width,2))+
        .17*Math.exp(-Math.pow((r-2.05)/.48,2)));
      contact=Math.max(contact,Math.exp(-Math.pow((r-.93)/.14,2)));
    }
    const clearing=THREE.MathUtils.smoothstep(Math.hypot(x,(z-2.5)*.88),1.65,3.0);
    const mound=.27*(1-Math.exp(-deposits/.27))*clearing;
    return {height:seabedHeight(x,z)+mound,mound:mound/.27,contact};
  }
  function setStones(value){
    rocks=value.map(rock=>{
      const c=Math.cos(rock.angle),s=Math.sin(rock.angle),radius=Math.max(rock.rx,rock.rz);
      return {...rock,c,s,extentX:3.5*(Math.abs(c)*rock.rx+Math.abs(s)*rock.rz),extentZ:3.5*(Math.abs(s)*rock.rx+Math.abs(c)*rock.rz),
        amplitude:.30*Math.sqrt(radius)*(.85+.25*noise(rock.center.x*.6,rock.center.z*.6)),phase:rock.center.x*1.73+rock.center.z*2.31};
    });
    for(let i=0;i<position.count;i++){
      const p=sample(base[i*2],base[i*2+1]);position.setZ(i,p.height);contacts[i*2]=p.contact;contacts[i*2+1]=p.mound;
    }
    restingHeights=Float32Array.from({length:position.count},(_,i)=>position.getZ(i));
    if(impact)deform();
    position.needsUpdate=true;geometry.attributes.seabedSediment.needsUpdate=true;
    geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
  }
  function deform(){
    for(let i=0;i<position.count;i++){
      const u=impact?Math.abs((base[i*2]-impact.x)/impact.rx):Infinity;
      const v=impact?Math.abs((base[i*2+1]-impact.z)/impact.rz):Infinity;
      // A rounded square keeps the bank parallel to a cube's sides instead
      // of cutting a circular, wavy lip across its straight bottom edge.
      const r=impact?.footprint==='box'?Math.pow(u**8+v**8,1/8):Math.hypot(u,v);
      // Keep sediment above the buried bottom, including under round shapes.
      // An equally deep crater leaves coplanar faces and a detached-looking base.
      const depression=-Math.exp(-Math.pow(r/.88,4))*(impact?.depth??0)*.55;
      const rim=Math.exp(-Math.pow((r-1.16)/.34,2))*(impact?.depth??0)*.28;
      position.setZ(i,restingHeights[i]+(depression+rim)*impactProgress);
    }
    position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.computeBoundingBox();
  }
  function setImpact(value){
    if(!value&&!impact)return;
    impact=value?{...value,rx:Math.max(.22,value.rx),rz:Math.max(.22,value.rz)}:null;
    impactProgress=value?.quiet?1:0;deform();
  }
  function advance(dt){
    if(!impact||impactProgress>=1||!(dt>0))return false;
    impactProgress=Math.min(1,impactProgress+Math.min(dt,.1)/.65);deform();return true;
  }
  setStones([]);
  // Query the same triangles that are rendered. Debris and swimming clearance
  // use this inexpensive lookup rather than reevaluating every stone's bank.
  const side=225,axis=Float32Array.from({length:side},(_,i)=>base[i*2]);
  function cell(value){let lo=0,hi=side-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(axis[mid]<=value)lo=mid;else hi=mid;}return lo;}
  function heightAt(x,z){
    const column=cell(x),row=cell(z),u=THREE.MathUtils.clamp((x-axis[column])/(axis[column+1]-axis[column]),0,1),v=THREE.MathUtils.clamp((z-axis[row])/(axis[row+1]-axis[row]),0,1);
    const a=(row*side+column)*3+2,data=position.array;
    const h00=data[a],h10=data[a+3],h01=data[a+side*3],h11=data[a+side*3+3];
    return u+v<=1?h00*(1-u-v)+h10*u+h01*v:h11*(u+v-1)+h10*(1-v)+h01*(1-u);
  }
  return {geometry,material,setStones,heightAt,setImpact,advance,dispose(){geometry.dispose();material.dispose();}};
}

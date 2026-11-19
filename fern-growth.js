import * as THREE from 'three';

export const FERN_FROND_INTERVAL=5;
export const FERN_MATURITY=48;

export function fernCanReleaseSpores(age,life){
  if(age<FERN_MATURITY||age>=life.dieAt)return false;
  let fertile=0;
  for(let i=0;i<(life.frondCount??18);i++)if(fernFrondState(age,i,life,false).mature&&++fertile>=3)return true;
  return false;
}
const smooth=(a,b,x)=>THREE.MathUtils.smoothstep(x,a,b);
function frondBirth(age,index,life){
  const period=Math.max(104,(life.frondCount??18)*FERN_FROND_INTERVAL),lifetime=period-10;
  const first=6+index*FERN_FROND_INTERVAL;
  return {lifetime,period,bornAt:first+Math.max(0,Math.floor((Math.min(age,life.dryAt)-first)/period))*period};
}
export function fernFrondState(age,index,life,withPressure=true){
  const {lifetime,period,bornAt}=frondBirth(age,index,life),leafAge=age-bornAt;
  const rise=smooth(0,5,leafAge),unroll=smooth(5,13,leafAge),opening=smooth(13,24,leafAge);
  const stress=smooth(life.dryAt,life.dieAt,age),dry=Math.max(smooth(lifetime*.65,lifetime,leafAge),stress);
  const visibility=smooth(0,.7,leafAge)*(1-smooth(lifetime+2,period,leafAge))*(1-smooth(life.dieAt,life.dieAt+18,age));
  const maxSize=1.2+((life.seed*7)%17)/17*.45;
  const size=(.35+(maxSize-.35)*smooth(6,110,bornAt))*(.08+.92*smooth(0,24,leafAge));
  const count=life.frondCount??18;let pressure=0;
  if(withPressure&&leafAge>=0)for(let k=1;k<=8&&k<count;k++){
    const next=frondBirth(age,(index+k)%count,life),newer=next.bornAt;
    if(newer-next.period>bornAt+.01)pressure+=1;
    else if(newer>bornAt+.01)pressure+=smooth(13,24,age-newer);
  }
  const settle=opening*(.15+.85*smooth(0,4,pressure));
  return {index,bornAt,age:leafAge,rise,unroll,opening,pressure,settle,dryness:dry,visibility,size,lifetime,period,visible:leafAge>=0&&visibility>.005,mature:leafAge>=30&&dry<.6&&visibility>.8};
}

// The CPU counterpart is used for spore attachment, so emitted particles start
// on a fertile, fully opened frond rather than an invisible future leaf.
export function fernFrondPoint(point,frond,t,state,out=new THREE.Vector3()){
  t=THREE.MathUtils.clamp(t,0,1);
  const length=frond.length,pitch=frond.pitch,bend=frond.bend,theta=pitch-bend*t;
  const axisX=length*(Math.sin(pitch)-Math.sin(theta))/bend,axisY=length*(Math.cos(theta)-Math.cos(pitch))/bend;
  const u=.06+.94*state.unroll,growth=.08+.92*smooth(0,24,state.age);
  const p=THREE.MathUtils.lerp(Math.PI/2,.85+.15*pitch-.1*state.settle,state.settle);
  const b=THREE.MathUtils.lerp(.0001,.85+.35*bend+.15*state.settle,state.settle);
  const head=.58*state.rise+.42*state.unroll,at=Math.min(t,u)/u*head,a=p-b*at;
  let x=length*growth*(Math.sin(p)-Math.sin(a))/b,y=length*growth*(Math.cos(a)-Math.cos(p))/b,angle=a;
  if(t>u){
    const k=(t-u)/Math.max(.001,1-u),roll=k*Math.PI*2*(1-state.unroll),r=length*growth*(1-u)*.13*state.rise,rr=r*(1-k*.65);
    x+=Math.cos(a)*Math.sin(roll)*rr-Math.sin(a)*(r-Math.cos(roll)*rr);
    y+=Math.sin(a)*Math.sin(roll)*rr+Math.cos(a)*(r-Math.cos(roll)*rr);angle+=roll;
  }
  const open=smooth(t-.15,t,u)*smooth(13+t*4,20+t*4,state.age),dx=(point.x-axisX)*open*growth,dy=(point.y-axisY)*open*growth,da=angle-theta;
  let localX=x+dx*Math.cos(da)-dy*Math.sin(da),localY=y+dx*Math.sin(da)+dy*Math.cos(da);
  if(t>u){const packed=Math.abs(point.z)*growth*(1-open)*.65*state.rise;localX-=Math.sin(angle)*packed;localY+=Math.cos(angle)*packed;}
  const sag=state.dryness*length*.6*t*t;localX+=sag*.3;localY-=sag;
  const scale=state.size/growth;localX*=scale;localY=Math.max(.001,localY*scale-(state.contact??0)*state.opening*t*t);
  return out.set(localX,localY,point.z*(.025+.975*open)*state.size*state.rise);
}

const shaderFunctions=`
attribute vec2 fernInfo;
attribute float fernPart;
attribute vec4 fernLife;
#ifdef FERN_CONTACTS
attribute float fernContactRow;
uniform sampler2D fernContacts;
#endif
uniform float fernTime;
uniform vec4 fernFronds[32];
uniform float fernFrondCount;
uniform float fernMinimumCrownSize;
varying vec3 vFernTint;
varying float vFernVisibility;
varying float vFernPartThreshold;
struct FernPose { vec3 position; vec3 normal; vec3 tint; float visibility; };
FernPose fernPose(vec3 original,vec3 originalNormal){
  float fi=floor(fernInfo.x),t=clamp(fernInfo.y,0.0,1.0);bool stalk=fract(fernInfo.x)>.25;
  vec4 meta=fernFronds[int(fi)];
  float len=meta.x,angle=meta.y,pitch=meta.z,bend=meta.w;
  float age=fernTime-fernLife.x,seed=fernLife.w;
  float period=max(104.0,fernFrondCount*5.0),life=period-10.0;
  float first=6.0+fi*5.0,cycle=max(0.0,floor((min(age,fernLife.y)-first)/period));
  float birth=first+cycle*period,leafAge=age-birth;
  FernPose result;
  if(leafAge<0.0||leafAge>=period||age>=fernLife.z+18.0){result.position=vec3(0.0,.005,0.0);result.normal=originalNormal;result.tint=vec3(1.0);result.visibility=0.0;return result;}
  float rise=smoothstep(0.0,5.0,leafAge),unfold=smoothstep(5.0,13.0,leafAge),opening=smoothstep(13.0,24.0,leafAge),u=.06+.94*unfold;
  float pressure=0.0;
  for(int k=1;k<=8;k++){
    if(float(k)>=fernFrondCount)break;
    float j=mod(fi+float(k),fernFrondCount),jperiod=period,jfirst=6.0+j*5.0;
    float newer=jfirst+max(0.0,floor((min(age,fernLife.y)-jfirst)/jperiod))*jperiod;
    if(newer-jperiod>birth+.01)pressure+=1.0;
    else if(newer>birth+.01)pressure+=smoothstep(13.0,24.0,age-newer);
  }
  float settle=opening*(.15+.85*smoothstep(0.0,4.0,pressure));
  float stress=smoothstep(fernLife.y,fernLife.z,age),dry=max(smoothstep(life*.65,life,leafAge),stress);
  float visibility=smoothstep(0.0,.7,leafAge)*(1.0-smoothstep(life+2.0,period,leafAge))*(1.0-smoothstep(fernLife.z,fernLife.z+18.0,age));
  float growth=.08+.92*smoothstep(0.0,24.0,leafAge);
  float crownSize=1.2+mod(seed*7.0,17.0)/17.0*.45;
  float size=mix(fernMinimumCrownSize,crownSize,smoothstep(6.0,110.0,birth));
  float co=cos(angle),si=sin(angle);
  vec2 root=vec2(co,si)*.035;
  vec2 crownRoot=vec2(co,si)*.003;
  vec3 local=vec3(co*(original.x-root.x)-si*(original.z-root.y),original.y-.02,si*(original.x-root.x)+co*(original.z-root.y));
  if(stalk)local.y-=.015*(1.0-smoothstep(0.0,.04,t));
  vec3 n=vec3(co*originalNormal.x-si*originalNormal.z,originalNormal.y,si*originalNormal.x+co*originalNormal.z);
  float theta=pitch-bend*t;
  vec2 oldAxis=len*vec2(sin(pitch)-sin(theta),cos(theta)-cos(pitch))/bend;
  float p=mix(1.57079632679,.85+.15*pitch-.1*settle,settle),b=mix(.0001,.85+.35*bend+.15*settle,settle);
  float head=.58*rise+.42*unfold,at=min(t,u)/u*head,a=p-b*at;
  vec2 axis=len*growth*vec2(sin(p)-sin(a),cos(a)-cos(p))/b;
  float tangent=a;
  if(t>u){
    float k=(t-u)/max(.001,1.0-u),roll=k*6.28318531*(1.0-unfold),r=len*growth*(1.0-u)*.13*rise,rr=r*(1.0-k*.65);
    axis+=vec2(cos(a),sin(a))*sin(roll)*rr+vec2(-sin(a),cos(a))*(r-cos(roll)*rr);tangent+=roll;
  }
  float open=smoothstep(t-.15,t,u)*smoothstep(13.0+t*4.0,20.0+t*4.0,leafAge),delta=tangent-theta;
  mat2 rotation=mat2(cos(delta),sin(delta),-sin(delta),cos(delta));
  float thickness=stalk?mix(3.0,1.0,unfold):open;
  vec2 xy=axis+rotation*(local.xy-oldAxis)*thickness*growth;
  if(!stalk&&t>u)xy+=vec2(-sin(tangent),cos(tangent))*abs(local.z)*growth*(1.0-open)*.65*rise;
  xy+=vec2(.3,-1.0)*dry*len*.6*t*t;
  vec3 pos=vec3(xy*size,local.z*(stalk?thickness:(.025+.975*open)*rise)*size*growth);
  #ifdef FERN_CONTACTS
  vec4 contact=texture2D(fernContacts,vec2((fi+.5)/32.0,(fernContactRow+.5)/1025.0));
  float contactDrop=mix(contact.r,contact.g,1.0-exp(-max(0.0,fernTime-contact.b)*3.0));
  pos.y=max(stalk?0.0:.001,pos.y-contactDrop*opening*t*t);
  #endif
  vec2 nn=rotation*n.xy;n.xy=nn;
  result.position=vec3(crownRoot.x+co*pos.x+si*pos.z,pos.y,crownRoot.y-si*pos.x+co*pos.z);
  vec3 rotatedNormal=vec3(co*n.x+si*n.z,n.y,-si*n.x+co*n.z);
  result.normal=dot(rotatedNormal,rotatedNormal)>.000001?normalize(rotatedNormal):vec3(0.0,1.0,0.0);
  result.tint=mix(mix(vec3(.72,.9,.68),vec3(.94,1.02,.65),1.0-opening),vec3(1.05,.62,.26),dry);
  result.tint=mix(result.tint,vec3(.8,.22,.06),smoothstep(life,period,leafAge));
  result.visibility=visibility;
  if(visibility<.001)result.position=vec3(0.0,.005,0.0);
  return result;
}
`;
const discardFragment=`
if(vFernVisibility<vFernPartThreshold)discard;
`;
const sheddingVertex=`
vFernPartThreshold=developed.visibility>.999?0.0:(fernPart<0.0?.02:.08+.84*fract(sin(fernPart*12.9898+fernLife.w*3.17)*43758.5453));
`;

export function createFernGrowthMaterials(fern,contactTexture,{minimumCrownSize=.35}={}){
  const time={value:0},fronds={value:Array.from({length:32},()=>new THREE.Vector4(1,0,1,.5))};
  fern.group.children.filter(f=>f.name==='Fern frond').forEach((f,i)=>fronds.value[i].set(f.userData.length,f.rotation.y,f.userData.pitch,f.userData.bend));
  const material=fern.group.getObjectByName('Divided fern foliage').material.clone();
  const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  function compile(shader,depth){
    shader.uniforms.fernContacts={value:contactTexture};shader.uniforms.fernTime=time;shader.uniforms.fernFronds=fronds;shader.uniforms.fernFrondCount={value:fern.settings.fronds};
    shader.uniforms.fernMinimumCrownSize={value:minimumCrownSize};
    const contacts=contactTexture?'\n#define FERN_CONTACTS\n':'\n';
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>'+contacts+shaderFunctions);
    if(!depth)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nFernPose developed=fernPose(position,objectNormal);objectNormal=developed.normal;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',depth?'FernPose developed=fernPose(position,vec3(0.0,1.0,0.0));vec3 transformed=developed.position;vFernTint=developed.tint;vFernVisibility=developed.visibility;':'vec3 transformed=developed.position;vFernTint=developed.tint;vFernVisibility=developed.visibility;');
    shader.vertexShader=shader.vertexShader.replace('vFernVisibility=developed.visibility;','vFernVisibility=developed.visibility;'+sheddingVertex);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vFernTint;varying float vFernVisibility;varying float vFernPartThreshold;');
    if(!depth)shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=vFernTint;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\n'+discardFragment);
  }
  material.onBeforeCompile=shader=>compile(shader,false);material.customProgramCacheKey=()=> contactTexture?'fern-frond-development-v4':'fern-frond-development-fixed';
  depthMaterial.onBeforeCompile=shader=>compile(shader,true);depthMaterial.customProgramCacheKey=()=> contactTexture?'fern-frond-depth-v4':'fern-frond-depth-fixed';
  return {material,depthMaterial,setTime(value){time.value=value;},dispose(){material.dispose();depthMaterial.dispose();}};
}

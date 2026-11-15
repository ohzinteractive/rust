import * as THREE from 'three';

export const oasisCenter=new THREE.Vector2(-3,3.5),oasisRadii=new THREE.Vector2(4.7,2.8);
const harmonics=[[.065,3,0],[.04,5,Math.PI/2],[.018,9,0],[.025,1,.8]];
const coves=[{angle:.68,width:.24,depth:.16},{angle:-2.5,width:.2,depth:.12},{angle:2.25,width:.23,depth:.08}];

export function oasisOutline(angle){
  let radius=1;
  for(const [amplitude,frequency,phase] of harmonics)radius+=amplitude*Math.sin(angle*frequency+phase);
  for(const cove of coves){const delta=Math.atan2(Math.sin(angle-cove.angle),Math.cos(angle-cove.angle));radius-=cove.depth*Math.exp(-Math.pow(delta/cove.width,2));}
  return radius;
}
export function oasisWaterRadius(x,z){
  const nx=(x-oasisCenter.x)/oasisRadii.x,nz=(z-oasisCenter.y)/oasisRadii.y;
  return Math.hypot(nx,nz)/oasisOutline(Math.atan2(nz,nx));
}

// Generate the CPU geometry and GPU water boundary from the same parameters.
const gl=value=>Number.isInteger(value)?value.toFixed(1):String(value);
export const oasisOutlineGLSL=`float oasisOutline(float angle){
  float radius=1.0;
  ${harmonics.map(([a,f,p])=>`radius+=${gl(a)}*sin(angle*${gl(f)}+${gl(p)});`).join('\n')}
  ${coves.map(({angle,width,depth},i)=>`float delta${i}=atan(sin(angle-(${gl(angle)})),cos(angle-(${gl(angle)})));radius-=${gl(depth)}*exp(-pow(delta${i}/${gl(width)},2.0));`).join('\n')}
  return radius;
}`;

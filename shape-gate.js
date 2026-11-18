import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {swingCenterHeight} from './shape-gate-motion.js';
import {createShapeGate} from './shape-gate-object.js';
import {createGateAmbientOcclusion} from './shape-gate-occlusion.js';
const scene=new T.Scene();scene.background=new T.Color('#abc2bf');scene.fog=new T.Fog('#abc2bf',18,45);
const camera=new T.PerspectiveCamera(42,innerWidth/innerHeight,.1,80);camera.position.set(-6,4,9);
const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;document.body.append(renderer.domElement);
const ambientOcclusion=createGateAmbientOcclusion(renderer);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,swingCenterHeight,0);controls.update();
scene.add(new T.HemisphereLight(0xe8f5ef,0x78634f,2));const light=new T.DirectionalLight(0xfff2df,3);light.position.set(-4,8,5);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-8,right:8,top:8,bottom:-8});scene.add(light);

const model=document.getElementById('model'),cycle=document.getElementById('cycle'),status=document.getElementById('status');
const gate=createShapeGate({scene,renderer,shadowLight:light,
 onShape:value=>{model.value=value;},
 onCycle:enabled=>{cycle.checked=enabled;},
 onStatus:message=>{status.textContent=message;}
});
scene.add(gate.group);
const floorSize=document.getElementById('floor-size');
const floorSizeValue=document.getElementById('floor-size-value');
function updateFloorSize(){
 const {columns,rows}=gate.resizeFloor(floorSize.valueAsNumber);
 floorSizeValue.value=`${columns} × ${rows} tiles`;
 floorSize.setAttribute('aria-valuetext',`${columns} by ${rows} tiles`);
}
floorSize.addEventListener('input',updateFloorSize);
updateFloorSize();
cycle.onchange=()=>gate.setCycle(cycle.checked);
model.onchange=()=>{gate.setCycle(false);gate.load(model.value);};
document.getElementById('upload').onchange=async event=>{
 const file=event.target.files[0];
 if(!file)return;
 gate.setCycle(false);
 const url=URL.createObjectURL(file);
 try{await gate.load('custom',url);}
 finally{URL.revokeObjectURL(url);}
};
const pause=document.getElementById('pause');
let playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;
function sync(){
 pause.textContent=playing?'Pause':'Play';
 pause.setAttribute('aria-pressed',String(!playing));
}
pause.onclick=()=>{playing=!playing;sync();};
sync();
const speed=document.getElementById('speed'),clock=new T.Clock();
renderer.setAnimationLoop(()=>{
 gate.advance(Math.min(clock.getDelta(),.05),camera,playing?speed.valueAsNumber:0);
 gate.captureGoldReflection();
 ambientOcclusion.render(scene,camera);
});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

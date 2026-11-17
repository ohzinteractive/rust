import {createFernSurface} from './fern-surface.js';
import {pointerFernWind} from './fern-wind.js';
import {createFernStage} from './fern-stage.js';
import * as THREE from 'three';
import { createModelImporter } from './model-import.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { createFlakePhysics } from './flake-physics.js';
import { PeelingSurface, noise as cpuNoise } from './peeling-surface.js';
import { createRustMaterial } from './rust-material.js';
import { createCoreGeometry } from './core-geometry.js';
import { createShapeGeometry, shapeNames } from './specimen-shapes.js';
import { createSceneInteractions } from './scene-interactions.js';
import { metalPresets, corrosionRate } from './metal-presets.js';
import { createFeatherSurface } from './feather-surface.js';
import {featherPreset1,defaultFeatherSettings,defaultFeatherDensity} from './feather-presets.js';
import {createFeatherInteractions} from './feather-picking.js';
import {createClothSurface} from './cloth-surface.js';
import {createFernDispersal} from './fern-spores.js';
import {createFernLifeCycle,fernLifeStages} from './fern-life-cycle.js';
import {createFern,defaultFernSettings} from './fern.js';
import {createPalmTree,defaultPalmSettings} from './palm-tree.js';
import {createDesertEnvironment,defaultDesertSunSettings} from './desert-environment.js';
import {createDesertLandmark} from './desert-landmark.js';
import {createDesertMirage} from './desert-mirage.js';
import {createDesertOasis} from './desert-oasis.js';
import {createLandmarkCloth} from './landmark-cloth.js';
import {defaultPlasticSettings,iridescentPlasticSettings} from './cloth-fabric.js';
import { createFeatherRenderer } from './feather-renderer.js';
import { createMazeNavigation } from './maze-navigation.js';
import {getMazeMap,setMazeMap,mazeMaps} from './maze-geometry.js';

const $ = (id) => document.getElementById(id);
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {shape:'cube',mazeMap:getMazeMap(),material:'metal',featherDensity:defaultFeatherDensity,metal:'iron',painted:true,modelAppearance:'paint',flakeFactor:1,age:0,moisture:.72,oxygen:.8,salt:.28,scale:2.4,peel:.68,relief:1,seed:7319,playing:!reducedMotion,rotate:!reducedMotion,speed:10,exploded:0};
const colorKeys=['dark','burnt','orange','gold','teal','tealLight','pink','pinkLight','metal'];
state.featherSettings={...defaultFeatherSettings};
state.palmDesert=true;
state.palmMirage=.7;
state.palmOasis=true;
state.palmSceneView='oasis';
state.palmTowerCloth=false;
state.palmView={fov:48,...defaultDesertSunSettings};
state.clothSettings={breeze:.12,held:true,fabric:'linen',ropes:[],ropePoints:96,autoSettle:true,settleTolerance:.003};
const currentColors={dark:'#241610',burnt:'#70371f',orange:'#b95b28',gold:'#b28a45',teal:'#53645a',tealLight:'#7d8b72',pink:'#efc51a',pinkLight:'#f7d74b',metal:'#343936'};
let paintHold=2.6;

let renderDirty=true,desiredExplode=0;
for(const event of ['input','change','click','keydown'])document.addEventListener(event,()=>{renderDirty=true;});
let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas:$('scene'),antialias:true,alpha:true,powerPreference:'high-performance'});
} catch (error) {
  $('loading').hidden=true; $('webgl-error').hidden=false;
  $('retry').onclick=()=>location.reload();
  console.error(error);
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=.92;
renderer.shadowMap.enabled=true;
renderer.shadowMap.autoUpdate=false;
renderer.shadowMap.needsUpdate=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const backdropColor=0x141613;
renderer.setClearColor(backdropColor,1);

const scene = new THREE.Scene();
// Refraction must see the same dark backdrop as the canvas. A transparent
// clear makes Three.js substitute white behind transmissive surfaces.
scene.background=new THREE.Color(backdropColor);
scene.fog=new THREE.FogExp2(backdropColor,.032);
const fernAtmosphere=new THREE.FogExp2(backdropColor,.002);
let fernSavedView=null;
const camera=new THREE.PerspectiveCamera(33,1,.1,80);
camera.position.set(5.1,6.1,6.6);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,-.22,0);
controls.enableDamping=true;controls.dampingFactor=.07;controls.enablePan=false;
controls.minDistance=4.4;controls.maxDistance=13;controls.maxPolarAngle=Math.PI*.66;
controls.autoRotate=state.rotate;controls.autoRotateSpeed=.35;
controls.rotateSpeed=.65;controls.zoomSpeed=.7;
controls.update();controls.saveState();
controls.addEventListener('change',()=>{renderDirty=true;});

const envGen=new THREE.PMREMGenerator(renderer);
const room=new RoomEnvironment();
const environment=envGen.fromScene(room,.04).texture;
scene.environment=environment;scene.environmentIntensity=.4;
room.dispose();envGen.dispose();
const skyLight=new THREE.HemisphereLight(0xe8f2e2,0x292218,1.1);scene.add(skyLight);
const key=new THREE.DirectionalLight(0xfff0d8,3);key.position.set(-3.5,6,4.5);
key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=5;key.shadow.camera.bottom=-5;key.shadow.camera.near=.5;key.shadow.camera.far=22;key.shadow.bias=-.0004;key.shadow.normalBias=.018;key.shadow.radius=3;
scene.add(key);
const rim=new THREE.DirectionalLight(0xbbe9df,1.25);rim.position.set(4,2,-4);scene.add(rim);
const fill=new THREE.DirectionalLight(0xffcf9d,.45);fill.position.set(-4,0,-2);scene.add(fill);

const specimen=new THREE.Group();specimen.position.y=.12;scene.add(specimen);
function randomizeTilt(){
  const direction=Math.random()*Math.PI*2;
  const angle=THREE.MathUtils.degToRad(10+Math.random()*8);
  specimen.rotation.set(Math.cos(direction)*angle,(Math.random()-.5)*.7,Math.sin(direction)*angle);
  specimen.updateMatrixWorld(true);
}
randomizeTilt();
const uniforms={uPainted:{value:1},uPatina:{value:0},uPassivation:{value:0},uMetalRoughness:{value:.48},uDepositRoughness:{value:.97},uCorrosionRelief:{value:1},uAge:{value:state.age},uScale:{value:state.scale},uSeed:{value:state.seed*.017},uRelief:{value:state.relief}};
for(const name of colorKeys)uniforms['u'+name[0].toUpperCase()+name.slice(1)]={value:new THREE.Color(currentColors[name])};
const coreMat=createRustMaterial(uniforms,false),coatingMat=createRustMaterial(uniforms,true);
const coreGeo=createCoreGeometry(cpuNoise);
const core=new THREE.Mesh(coreGeo,coreMat);core.castShadow=true;core.receiveShadow=true;specimen.add(core);

const floorY=-1.75;
specimen.updateMatrixWorld(true);
const physics=createFlakePhysics({floorY,cubePosition:specimen.position,cubeQuaternion:specimen.quaternion,cubeHalfExtent:1.296});
const surface=new PeelingSurface({parent:specimen,material:coatingMat,physics,state});
const feathers=createFeatherSurface();
const fern=createFern({scene,floorY});
const fernSubstrate=new THREE.MeshStandardMaterial({color:0x283026,roughness:1});
const fernSettings={...defaultFernSettings};
let fernWindDirection=25;
const fernDispersal=createFernDispersal({scene,fern,floorY,camera});
const fernLife=createFernLifeCycle({scene,fern,floorY});
const fernPointer=new THREE.Vector2(),fernWindOrigin=new THREE.Vector3(),fernWindHit=new THREE.Vector3(),fernWindRay=new THREE.Raycaster();
let fernPointerActive=false;
function updateFernPointerWind(){
  if(!fernPointerActive||state.material!=='fern'||fernLife.active)return;
  fernDispersal.getWindOrigin(fernWindOrigin);
  fernDispersal.setPointerWind(pointerFernWind(fernPointer,camera,fernWindOrigin,fernWindRay,fernWindHit));
}
renderer.domElement.addEventListener('pointermove',event=>{
  if(state.material!=='fern'||fernLife.active||event.pointerType==='touch')return;
  const rect=renderer.domElement.getBoundingClientRect();
  fernPointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
  fernPointerActive=true;updateFernPointerWind();syncFernDispersal();renderDirty=true;
});
renderer.domElement.addEventListener('pointerleave',()=>{fernPointerActive=false;fernDispersal.setPointerWind(null);});

const palm=createPalmTree({scene,floorY});
const palmSettings={...defaultPalmSettings,fronds:41,density:.95,dryFraction:.38,length:1.66,droop:1.39,curve:.4,wind:.48};
state.palmSettings=palmSettings;
const specimenCloth=createClothSurface({scene,floorY,onSettle:syncClothPlayback});
const towerCloth=createLandmarkCloth({scene,onSettle:syncClothPlayback});
let cloth=specimenCloth,towerClothLoading=false,towerClothFocusPending=false;
const featherRenderer=createFeatherRenderer({renderer,feathers,shadowLight:key});
let mazeNavigation;
const interactions=createSceneInteractions({canvas:renderer.domElement,camera,controls,core,specimen,surface,physics,enabled:()=>state.material==='metal'&&!mazeNavigation?.active,invalidate(){renderDirty=true;renderer.shadowMap.needsUpdate=true;}});
createFeatherInteractions({canvas:renderer.domElement,camera,feathers,enabled:()=>state.material==='feathers'&&!mazeNavigation?.active,invalidate(){renderDirty=true;}});

// A lit ground receives the real fragments and their shadows. It is also the
// plane used by the collision solver, so settled debris stays on the surface.
const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:0x141a12,roughness:.97,metalness:0}));
ground.rotation.x=-Math.PI/2;ground.position.y=floorY;ground.receiveShadow=true;scene.add(ground);
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=256;
const sc=shadowCanvas.getContext('2d'),sg=sc.createRadialGradient(128,128,5,128,128,128);
sg.addColorStop(0,'rgba(0,0,0,.45)');sg.addColorStop(.45,'rgba(0,0,0,.2)');sg.addColorStop(1,'rgba(0,0,0,0)');sc.fillStyle=sg;sc.fillRect(0,0,256,256);
const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(5.5,5.5),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,opacity:.5}));
shadow.rotation.x=-Math.PI/2;shadow.position.y=floorY+.002;scene.add(shadow);
const fernStage=createFernStage({scene,ground,key,rim,fill,skyLight});
const desert=createDesertEnvironment({scene,renderer,ground,shadow,skyLight,key,rim,fill,sunSettings:state.palmView});
const desertLandmark=createDesertLandmark({scene,floorY,notify:toast,invalidate(){oasis.invalidateReflection();renderDirty=true;renderer.shadowMap.needsUpdate=true;}});
const mirage=createDesertMirage({renderer,landmark:desertLandmark.group,reducedMotion});
const oasis=createDesertOasis({scene,floorY,reducedMotion,primaryPalm:palm});
let desertCamera=null,buildingViewLoading=false;

const models=createModelImporter({scene,uniforms,state,reducedMotion,notify:toast,featherMaterial:feathers.substrate,
  invalidate(){if(state.material==='feathers')feathers.update();renderDirty=true;renderer.shadowMap.needsUpdate=true;},
  onActivate(name,peeling){
    if(state.material==='fern')$('fern-on-object').checked=true;
    state.palm=false;
    mazeNavigation?.exit();$('maze-enter').hidden=true;
    $('model-paint-option').hidden=false;$('basic-paint-option').hidden=true;
    if(state.modelAppearance==='paint')state.painted=true;
    updateMetalFinish();
    interactions.cancel();surface.repaint();specimen.visible=false;setLayerView(0);
    $('layers-view').disabled=!peeling;
    document.querySelectorAll('[data-shape]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
    if(state.material!=='feathers')$('scene').setAttribute('aria-label',`${name}. Drag to orbit, scroll to zoom. Use model controls for materials and animation.`);
    $('horse-shape').classList.toggle('selected',models.sampleKey==='horse');
    $('horse-shape').setAttribute('aria-pressed',String(models.sampleKey==='horse'));
    $('scene').title='Drag to orbit · Scroll to zoom';
    if(state.material==='fern'&&$('fern-on-object').checked){models.setAppearance();rebuildFern();}
    refreshFeathers();
  },
  onClear(){
    $('model-paint-option').hidden=true;$('basic-paint-option').hidden=false;
    $('horse-shape').classList.remove('selected');$('horse-shape').setAttribute('aria-pressed','false');
    specimen.visible=true;$('layers-view').disabled=false;
    $('maze-enter').hidden=state.shape!=='maze';
    document.querySelectorAll('[data-shape]').forEach(b=>{const active=b.dataset.shape===state.shape;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    updateMetalFinish();
    refreshFeathers();
  }
});

let size={w:0,h:0};
function resize(){
  renderDirty=true;
  const rect=$('canvas-wrap').getBoundingClientRect();size={w:rect.width,h:rect.height};
  renderer.setSize(size.w,size.h,false);camera.aspect=size.w/size.h;
  if(mazeNavigation?.active){camera.fov=75;camera.clearViewOffset();camera.updateProjectionMatrix();return;}
  const narrow=size.w<600;
  camera.fov=narrow?Math.max(43,THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(43)/2)*.7/camera.aspect))):35;
  if(desert.enabled)camera.fov=Math.max(55,camera.fov);
  if(oasis.group.visible)camera.fov=Math.max(70,THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(26))/camera.aspect)));
  if(palm.group.visible&&state.palmView.fov!==null)camera.fov=state.palmView.fov;
  camera.setViewOffset(size.w,size.h,0,size.h*(narrow?.04:-.064),size.w,size.h);
  camera.updateProjectionMatrix();
  syncPalmViewUI();
}
new ResizeObserver(resize).observe($('canvas-wrap'));resize();

let toastTimeout;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),2800);}
function paintRange(input){input.style.setProperty('--fill',`${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);}
function updateAgeUI(){
  $('age').value=state.age*100;paintRange($('age'));$('age-value').innerHTML=`${String(Math.round(state.age*100)).padStart(2,'0')}<span>%</span>`;
  const phase=state.age<.1?(state.painted?'Fresh paint':'Fresh metal'):state.age<.4?'First bloom':state.age<.82?'Layer breakdown':'Timeworn';
  $('phase').textContent=phase;
  document.querySelectorAll('[data-age]').forEach(b=>b.classList.toggle('active',(state.age<.1&&b.dataset.age==='0')||(phase==='First bloom'&&b.dataset.age==='32')||(phase==='Layer breakdown'&&b.dataset.age==='64')||(phase==='Timeworn'&&b.dataset.age==='100')));
  uniforms.uAge.value=state.age;
}
function setPlaying(value){
  if(state.material!=='metal')value=false;
  state.playing=value;
  if(!value)updateAgeUI();
  const label=value?'Pause aging':state.age>=1?'Restart aging':'Play aging';
  $('age-play').setAttribute('aria-label',label);$('age-play').title=label;
  $('age-play-icon').setAttribute('d',value?'M8 5v14M16 5v14':'M7 4l14 8-14 8Z');
}
$('age-play').addEventListener('click',()=>{
  if(!state.playing&&state.age>=1)repaint(true);
  else{paintHold=0;setPlaying(!state.playing);}
});
$('age-speed').addEventListener('change',event=>{state.speed=Number(event.target.value);});
function setAge(value){
  state.age=clamp(value);paintHold=0;setPlaying(false);
  updateAgeUI();surface.updateAttached();
}
$('age').addEventListener('input',e=>setAge(+e.target.value/100));
document.querySelectorAll('[data-age]').forEach(b=>{if(b.dataset.age==='0')b.textContent='Fresh paint';b.onclick=()=>setAge(+b.dataset.age/100);});
function repaint(shouldPlay=true){
  interactions.cancel();
  state.age=0;paintHold=2.6;state.exploded=0;setLayerView(0);
  surface.repaint();models.repaint();updateAgeUI();setPlaying(shouldPlay);
}
function setAutoRotation(value){
  state.rotate=value;controls.autoRotate=value;$('rotate').classList.toggle('active',value);$('rotate').setAttribute('aria-pressed',value);$('rotate').setAttribute('aria-label',value?'Pause automatic rotation':'Start automatic rotation');
}
setAutoRotation(state.rotate);
$('rotate').onclick=()=>setAutoRotation(!state.rotate);
$('reset-view').onclick=()=>{if(state.material==='fern')frameFern();else if(palm.group.visible){if(state.palmSceneView==='building'&&desert.enabled)setPalmSceneView('building');else framePalmScene();}else controls.reset();controls.autoRotate=state.rotate;toast('View reset');};
function syncViewMode(){
  const palmMode=state.material==='feathers'&&!!state.palm&&!models.active;
  $('surface-view').parentElement.setAttribute('aria-label',palmMode?'Scene view':'Material view');
  $('surface-view').textContent=palmMode?'Building':'Surface';$('layers-view').textContent=palmMode?'Oasis':'Layers';
  $('surface-view').disabled=palmMode&&(!desert.enabled||buildingViewLoading);
  $('surface-view').setAttribute('aria-busy',String(palmMode&&buildingViewLoading));
  $('layers-view').disabled=!palmMode&&(state.material==='fern'||state.material==='cloth'||state.material==='feathers'||(models.active&&!models.peelingStats));
  const first=palmMode?state.palmSceneView==='building':!desiredExplode;
  for(const [id,active] of [['surface-view',first],['layers-view',!first]]){$(id).classList.toggle('selected',active);$(id).setAttribute('aria-pressed',String(active));}
}
function setLayerView(value){desiredExplode=value;syncViewMode();}
$('surface-view').onclick=()=>{if(palm.group.visible)setPalmSceneView('building');else setLayerView(0);};
$('layers-view').onclick=()=>{if(palm.group.visible)setPalmSceneView('oasis');else setLayerView(1);};
let mazeOverview;
mazeNavigation=createMazeNavigation({camera,controls,specimen,canvas:renderer.domElement,stage:document.querySelector('.stage'),button:$('maze-enter'),panel:$('maze-fpv'),isPaused:()=>!$('feather-options').hidden,
  onEnter(){
    feathers.setFirstPerson(true);
    feathers.setLantern(mazeNavigation.room.light);
    const lights=scene.children.filter(object=>object.isLight);
    mazeOverview={playing:state.playing,exploded:state.exploded,desiredExplode,lights:lights.map(light=>[light,light.intensity]),environment:scene.environmentIntensity,keyAuto:key.shadow.autoUpdate,fog:scene.fog,ground:ground.visible,shadow:shadow.visible};
    scene.fog=null;ground.visible=false;shadow.visible=false;
    for(const light of lights)light.intensity*=light.isHemisphereLight?.3:.12;
    scene.environmentIntensity*=.3;key.shadow.autoUpdate=false;key.shadow.needsUpdate=true;
    interactions.cancel();setPlaying(false);state.exploded=0;setLayerView(0);surface.updateAttached();
    showPaintOptions(false);showFeatherOptions(false);
    $('maze-feather-settings').hidden=state.material!=='feathers';
    if(state.material==='feathers')document.querySelector('.stage').appendChild($('feather-options'));
    refreshFeathers();
  },
  onExit(){
    feathers.setFirstPerson(false);
    feathers.setLantern(null);
    for(const [light,intensity] of mazeOverview.lights)light.intensity=intensity;
    scene.environmentIntensity=mazeOverview.environment;key.shadow.autoUpdate=mazeOverview.keyAuto;key.shadow.needsUpdate=true;
    scene.fog=mazeOverview.fog;ground.visible=mazeOverview.ground;shadow.visible=mazeOverview.shadow;
    showFeatherOptions(false);$('feather-controls').appendChild($('feather-options'));
    state.exploded=mazeOverview.exploded;setLayerView(mazeOverview.desiredExplode);surface.updateAttached();
    setPlaying(mazeOverview.playing);resize();
    refreshFeathers();
  },
  invalidate(shadows=false){renderDirty=true;if(shadows)renderer.shadowMap.needsUpdate=true;}
});
mazeNavigation.room.interior.setReflectionGroup(feathers.group);
function syncMazeMapButton(){
  const index=mazeMaps.findIndex(map=>map.id===getMazeMap()),map=mazeMaps[index];
  const button=document.querySelector('[data-shape="maze"]');
  button.querySelector('span').textContent='Maze '+(index+1)+'/'+mazeMaps.length;
  button.title=map.name+' map · Click again to switch maps';
  button.setAttribute('aria-label','Maze: '+map.name+'. Click again to switch maps.');
}
syncMazeMapButton();
$('copy-settings').onclick=async()=>{
  const settings={...state,exploded:desiredExplode,colors:currentColors,
    model:models.active?{sample:models.sampleKey,name:$('model-name').textContent,animation:Number($('model-animation').value)}:null,
    camera:{position:camera.position.toArray(),target:controls.target.toArray()},
    specimenRotation:specimen.rotation.toArray()};
  try{
    await navigator.clipboard.writeText(JSON.stringify(settings,null,2));
    toast('Settings copied');
  }catch{
    toast('Could not copy settings. Allow clipboard access and try again.');
  }
};
function syncColors(){
  $('picker-paint-color').value=currentColors.pink;
  for(const name of colorKeys)uniforms['u'+name[0].toUpperCase()+name.slice(1)].value.set(currentColors[name]);
}
function lightPaintColor(base){
  return '#'+new THREE.Color(base).lerp(new THREE.Color('#fff2ba'),.27).getHexString();
}

function updateMetalFinish(){
  const profile=metalPresets[state.metal];
  const fernMode=state.material==='fern',featherMode=state.material==='feathers',clothMode=state.material==='cloth',palmMode=featherMode&&!!state.palm&&!models.active;
  document.querySelectorAll('[data-metal]').forEach(button=>{const active=!fernMode&&!featherMode&&!clothMode&&button.dataset.metal===state.metal;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  $('fern-material').classList.toggle('selected',fernMode);$('fern-material').setAttribute('aria-pressed',String(fernMode));
  $('fern-controls').hidden=!fernMode;if(!fernMode)showFernOptions(false);
  $('feather-material').classList.toggle('selected',featherMode&&!palmMode);
  $('feather-material').setAttribute('aria-pressed',String(featherMode&&!palmMode));
  $('oasis-material').classList.toggle('selected',palmMode);$('oasis-material').setAttribute('aria-pressed',String(palmMode));
  $('paint-toggle').classList.toggle('selected',!fernMode&&!featherMode&&!clothMode&&state.painted&&(!models.active||state.modelAppearance==='paint'));
  $('cloth-material').classList.toggle('selected',clothMode);$('cloth-material').setAttribute('aria-pressed',String(clothMode));
  $('cloth-controls').hidden=!clothMode;
  if(!clothMode&&!towerClothActive())showClothOptions(false);
  $('exposure-controls').hidden=fernMode||featherMode||clothMode;
  $('feather-controls').hidden=!featherMode||palmMode;
  $('oasis-controls').hidden=!palmMode;
  if(!palmMode)showOasisOptions(false);
  else showFeatherOptions(false);
  syncViewMode();
  $('paint-enabled').checked=state.painted;
  uniforms.uPainted.value=Number(state.painted);
  uniforms.uPatina.value=profile.patina;
  uniforms.uPassivation.value=profile.passivation;
  uniforms.uMetalRoughness.value=profile.roughness;
  uniforms.uDepositRoughness.value=profile.depositRoughness;
  uniforms.uCorrosionRelief.value=profile.relief;
  state.flakeFactor=state.painted?1:profile.bareFlaking;
  $('metal-symbol').textContent=fernMode?'Fn':clothMode?'Cl':palmMode?'Oa':featherMode?'Pl':profile.symbol;
  $('metal-name').textContent=fernMode?'FERNS':clothMode?$('cloth-fabric-name').textContent.toUpperCase():palmMode?'OASIS':featherMode?'FEATHERS':profile.name.toUpperCase();
  $('scene').setAttribute('aria-label',`${state.painted?'Painted':'Bare'} ${profile.name.toLowerCase()} ${(models.active?'model':shapeNames[state.shape].toLowerCase())} developing ${profile.finish.toLowerCase()}. Tap the specimen to bounce. Drag loose flakes to move them; tap to remove. Drag elsewhere to orbit, scroll to zoom, or use the arrow keys.`);
  document.querySelector('[data-age="0"]').textContent=state.painted?'Fresh paint':'Fresh metal';
  if(fernMode)$('scene').setAttribute('aria-label','Fern crown with arching stems and finely divided green fronds. Drag to orbit and scroll to zoom.');
  if(clothMode)$('scene').setAttribute('aria-label','Ivory cloth draping over the selected geometry. Redrape resets the fabric. Drag to orbit and scroll to zoom.');
  if(featherMode)$('scene').setAttribute('aria-label',state.palm?(state.palmDesert&&state.palmOasis?'Desert oasis with shallow turquoise water, tall palms with young palms beneath them, an opposite dune and distant Jeddah Tower. Drag to orbit, scroll to zoom.':'Palm tree with a curved trunk and feather-grown fronds. Drag to orbit, scroll to zoom.'):'Feathers on textured skin. Click a feather to send the whole coat flying. Use Return feathers in Settings to restore the coat. Drag to orbit, scroll to zoom, or use the arrow keys.');
}
function refreshFeathers(){
  const palmMode=state.material==='feathers'&&!!state.palm&&!models.active;
  const palmChanged=palm.group.visible!==palmMode;
  if(fernLife.active){fernLife.setActive(false);lastFernLifeStage=-1;}
  showFernCycle(false);
  palm.group.visible=palmMode;fern.group.visible=state.material==='fern'&&(!models.active||$('fern-on-object').checked);
  fernDispersal.setVisible(fern.group.visible);specimen.visible=!models.active&&!palmMode&&(!fern.group.visible||$('fern-on-object').checked);
  if(fernSavedView){
    scene.fog=fernSavedView.fog;camera.far=fernSavedView.far;ground.scale.copy(fernSavedView.groundScale);
    camera.position.copy(fernSavedView.position);controls.target.copy(fernSavedView.target);controls.maxDistance=fernSavedView.maxDistance;controls.update();fernSavedView=null;
  }
  fernStage.setEnabled(false);
  syncPalmEnvironment(palmChanged);
  if(state.material==='fern'){
    fernStage.setEnabled(true);
    fernSavedView={fog:scene.fog,far:camera.far,groundScale:ground.scale.clone(),position:camera.position.clone(),target:controls.target.clone(),maxDistance:controls.maxDistance};scene.fog=fernAtmosphere;
  }
  camera.updateProjectionMatrix();
  const active=state.material==='feathers'&&!palmMode;
  const interior=mazeNavigation?.active&&state.shape==='maze'&&!models.active;
  feathers.setCourtyardExclusion(interior?{center:mazeNavigation.room.interior.ritual.center,radius:.44}:null);
  core.material=interior?mazeNavigation.room.interior.wallMaterial:active?feathers.substrate:state.material==='fern'&&$('fern-on-object').checked?fernSubstrate:coreMat;
  surface.mesh.visible=!active&&!interior&&state.material!=='cloth'&&!(state.material==='fern'&&$('fern-on-object').checked);
  if(active){
    const maze=state.shape==='maze'&&!models.active;
    const sources=models.active?models.meshes:maze&&mazeNavigation.active?[core,mazeNavigation.room.floor,mazeNavigation.room.roof]:[core];
    feathers.rebuild(sources,models.active?scene:specimen,state.featherDensity,state.seed,{scale:maze?.025:1,viewport:maze,maze,shadowDistance:maze?.02:Infinity});
    $('maze-feather-help').hidden=!maze;syncFeatherCountUI();
    $('layers-view').disabled=true;
    if(!mazeNavigation?.active)$('scene').title='Click a feather to send the whole coat flying · Drag to orbit · Scroll to zoom';
  }else feathers.clear();
  if(towerClothActive())syncTowerCloth();
  else if(state.material==='cloth'&&!interior){
    cloth.rebuild(models.active?models.meshes:[core],{resolution:innerWidth<600?36:48,held:state.clothSettings.held,fabric:state.clothSettings.fabric,radial:models.active,ropes:state.clothSettings.ropes,ropePoints:state.clothSettings.ropePoints,autoSettle:state.clothSettings.autoSettle,settleTolerance:state.clothSettings.settleTolerance});
    cloth.simulation.breeze=state.clothSettings.breeze;
    syncClothPlayback();
  }else cloth.clear();
  renderer.shadowMap.needsUpdate=true;renderDirty=true;
}
function syncFeatherCountUI(){
  if(palm.group.visible){$('oasis-count').textContent=oasis.group.visible?oasis.stats.maturePalms+' palms + '+oasis.stats.youngPalms+' young':palm.stats.fronds+' palm fronds';return;}
  const stats=feathers.stats,ritual=mazeNavigation?.active&&mazeNavigation.walker.inCourtyard?mazeNavigation.room.interior.ritual:null,text=ritual?`${ritual.stats.total} courtyard feathers`:stats.viewport?`${stats.visibleCount} feathers in view`:`${stats.count} feathers`;
  if($('feather-count').textContent!==text)$('feather-count').textContent=text;
}
function leaveFeathers(){
  if(state.material==='metal')return;
  showFeatherOptions(false);
  state.material='metal';state.palm=false;
  models.setAppearance();refreshFeathers();
}
function selectMetal(metal){
  leaveFeathers();
  state.metal=metal;
  Object.assign(currentColors,metalPresets[state.metal].colors);
  updateMetalFinish();syncColors();repaint(!reducedMotion);
}
document.querySelectorAll('[data-metal]').forEach(button=>button.addEventListener('click',()=>selectMetal(button.dataset.metal)));
$('feather-material').addEventListener('click',()=>{
  if(state.material==='feathers'&&!state.palm){showFeatherOptions($('feather-options').hidden);return;}
  interactions.cancel();showPaintOptions(false);
  state.material='feathers';state.palm=false;repaint(false);
  models.setAppearance();updateMetalFinish();refreshFeathers();
  showFeatherOptions(true);
});
$('oasis-material').addEventListener('click',()=>{
  if(palm.group.visible){showOasisOptions($('oasis-options').hidden);return;}
  growPalm();
});
$('cloth-material').addEventListener('click',()=>{
  if(state.material==='cloth'){showClothOptions($('cloth-options').hidden);return;}
  mazeNavigation.exit();interactions.cancel();showFeatherOptions(false);showPaintOptions(false);
  state.material='cloth';state.palm=false;showClothOptions(true);setPlaying(false);setLayerView(0);surface.repaint();
  models.setAppearance();updateMetalFinish();refreshFeathers();
  const offset=camera.position.clone().sub(controls.target);
  camera.position.copy(controls.target).add(offset.setLength(Math.min(controls.maxDistance,Math.max(12,offset.length()))));controls.update();
});
function showClothOptions(open){
  $('cloth-options').hidden=!open;
  $('cloth-settings-toggle').setAttribute('aria-expanded',String(open));
  $('palm-tower-cloth-settings').setAttribute('aria-expanded',String(open&&towerClothActive()));
  $('cloth-controls').closest('.specimen-dock').classList.toggle('cloth-menu-open',open);
  if(open&&towerClothActive())showOasisOptions(false);
}
$('cloth-settings-toggle').addEventListener('click',()=>showClothOptions($('cloth-options').hidden));
function closeClothOptions(){showClothOptions(false);$(towerClothActive()?'oasis-settings-toggle':'cloth-settings-toggle').focus();}
$('cloth-settings-close').addEventListener('click',closeClothOptions);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('cloth-options').hidden)closeClothOptions();});
document.querySelectorAll('[name="cloth-fabric"]').forEach(input=>input.addEventListener('change',()=>{
  if(!input.checked)return;
  state.clothSettings.fabric=input.value;cloth.setFabric(input.value);
  $('cloth-fabric-name').textContent=cloth.fabric.name;
  syncPlasticControls();
  updateMetalFinish();renderDirty=true;
}));
function syncPlasticControls(){
  $('cloth-plastic-settings').hidden=state.clothSettings.fabric!=='plastic';
  for(const key of ['gloss','translucency','crinkle','iridescence','colorVariation']){
    const value=Math.round(cloth.plasticSettings[key]*100),input=$('cloth-'+key);
    input.value=value;$('cloth-'+key+'-value').value=value+'%';paintRange(input);
  }
  $('cloth-tint').value=cloth.plasticSettings.color;
}
for(const key of ['gloss','translucency','crinkle','iridescence','colorVariation'])$('cloth-'+key).addEventListener('input',event=>{
  cloth.setPlasticSettings({[key]:Number(event.target.value)/100});syncPlasticControls();renderDirty=true;
});
$('cloth-tint').addEventListener('input',event=>{cloth.setPlasticSettings({color:event.target.value});renderDirty=true;});
$('cloth-plastic-reset').addEventListener('click',()=>{cloth.setPlasticSettings(defaultPlasticSettings);syncPlasticControls();renderDirty=true;});
$('cloth-iridescent').addEventListener('click',()=>{cloth.setPlasticSettings(iridescentPlasticSettings);syncPlasticControls();renderDirty=true;});
syncPlasticControls();
$('cloth-rope-points').addEventListener('input',event=>{
  state.clothSettings.ropePoints=Number(event.target.value);cloth.setRopePoints(state.clothSettings.ropePoints);
  $('cloth-rope-points-value').value=event.target.value;paintRange(event.target);renderDirty=true;
});
paintRange($('cloth-rope-points'));
$('cloth-redrape').addEventListener('click',()=>{if(towerClothActive())rebuildTowerCloth();else if(state.material==='cloth')refreshFeathers();});
function syncClothPlayback(){
  const simulation=cloth.simulation;if(!simulation)return;
  const stopped=simulation.paused||simulation.sleeping,label=stopped?'Resume':'Pause';
  const status=simulation.paused?'Paused':simulation.sleeping?'Settled':simulation.autoSettle?'Settling…':'Animating';
  if($('cloth-pause').textContent!==label)$('cloth-pause').textContent=label;
  $('cloth-pause').setAttribute('aria-pressed',String(stopped));
  if($('cloth-settle-status').textContent!==status)$('cloth-settle-status').textContent=status;
}
$('cloth-pause').addEventListener('click',()=>{
  if(!cloth.simulation)return;
  if(cloth.simulation.sleeping)cloth.simulation.wake();else cloth.simulation.paused=!cloth.simulation.paused;
  syncClothPlayback();
});
$('cloth-settle-tolerance').addEventListener('input',event=>{
  state.clothSettings.settleTolerance=Number(event.target.value)/10000;
  if(cloth.simulation)cloth.simulation.settleTolerance=state.clothSettings.settleTolerance;
  $('cloth-settle-tolerance-value').value=(Number(event.target.value)/100).toFixed(2)+'%';paintRange(event.target);syncClothPlayback();
});
paintRange($('cloth-settle-tolerance'));
$('cloth-auto-settle').addEventListener('change',event=>{
  state.clothSettings.autoSettle=event.target.checked;
  if(cloth.simulation)cloth.simulation.autoSettle=event.target.checked;
  syncClothPlayback();
});
function syncClothRopes(){
  const list=$('cloth-rope-list');list.replaceChildren();
  state.clothSettings.ropes.forEach((rope,index)=>{
    const row=document.createElement('div');row.className='cloth-rope-row';row.dataset.ropeId=rope.id;
    const status=document.createElement('span');status.className='cloth-rope-status';status.textContent='Waiting for cloth…';status.setAttribute('role','status');row.appendChild(status);
    const typeField=document.createElement('label'),typeSelect=document.createElement('select');typeField.className='cloth-binding-type';typeField.textContent='Binding';
    for(const [value,label] of [['cord','Round cord'],['ribbon','Spiral ribbon']]){const option=document.createElement('option');option.value=value;option.textContent=label;typeSelect.appendChild(option);}
    typeSelect.value=rope.style??'cord';typeSelect.dataset.ropeControl='style';typeSelect.setAttribute('aria-label',`Binding ${index+1} type`);
    typeSelect.addEventListener('change',()=>{rope.style=typeSelect.value;rope.width??=.07;rope.turns??=3;rope.span??=.4;cloth.setRopes(state.clothSettings.ropes);syncClothRopes();renderDirty=true;});
    typeField.appendChild(typeSelect);row.appendChild(typeField);
    const settings=[['height','Height',3,97],['tightness','Tightness',0,100]];
    if(rope.style==='ribbon')settings.push(['width','Width',1,15],['turns','Turns',1,5],['span','Coverage',10,80]);
    for(const [settingIndex,[key,label,min,max]] of settings.entries()){
      const field=document.createElement('label'),title=document.createElement('span'),output=document.createElement('output'),input=document.createElement('input');
      field.style.gridColumn=String(settingIndex%2+1);
      const scale=key==='turns'?1:100,suffix=key==='turns'?'':'%';
      title.textContent=label;output.textContent=Math.round(rope[key]*scale)+suffix;title.appendChild(output);
      input.type='range';input.min=min;input.max=max;input.step=1;input.value=Math.round(rope[key]*scale);input.dataset.ropeControl=key;input.setAttribute('aria-label',`${rope.style==='ribbon'?'Ribbon':'Rope'} ${index+1} ${label.toLowerCase()}`);input.title={height:'Height from the bottom of the object',tightness:'How closely the binding gathers the cloth',width:'Ribbon width relative to object height',turns:'Number of spiral turns',span:'Vertical coverage relative to object height'}[key];
      input.addEventListener('input',()=>{rope[key]=Number(input.value)/scale;output.textContent=input.value+suffix;cloth.setRopes(state.clothSettings.ropes);renderDirty=true;});
      field.append(title,input);row.appendChild(field);
    }
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${rope.style==='ribbon'?'ribbon':'rope'} ${index+1}`);remove.style.gridColumn='3';remove.style.gridRow='3';
    remove.addEventListener('click',()=>{state.clothSettings.ropes=state.clothSettings.ropes.filter(r=>r.id!==rope.id);cloth.setRopes(state.clothSettings.ropes);syncClothRopes();renderDirty=true;});
    row.appendChild(remove);list.appendChild(row);
  });
}
function syncClothRopeStatus(){
  const labels={waiting:'Waiting for cloth…',queued:'Waiting to wrap…',wrapping:'Wrapping…',tied:'Tied'};
  for(const rope of cloth.ropes?.stats??[]){
    const status=document.querySelector(`[data-rope-id="${rope.id}"] .cloth-rope-status`),text=labels[rope.status];
    if(status&&status.textContent!==text)status.textContent=text;
  }
}
function addClothBinding(style){
  const ropes=state.clothSettings.ropes,id=1+ropes.reduce((max,rope)=>Math.max(max,rope.id),0);
  ropes.push({id,style,height:style==='ribbon'?.65:[.5,.7,.3][ropes.length%3],tightness:.8,width:.07,turns:3,span:.4});
  cloth.setRopes(ropes);syncClothRopes();renderDirty=true;
}
$('cloth-add-rope').addEventListener('click',()=>addClothBinding('cord'));
$('cloth-add-ribbon').addEventListener('click',()=>addClothBinding('ribbon'));
$('cloth-held').addEventListener('change',event=>{state.clothSettings.held=event.target.checked;if(towerClothActive())rebuildTowerCloth();else if(state.material==='cloth')refreshFeathers();});
$('cloth-breeze').addEventListener('input',event=>{state.clothSettings.breeze=Number(event.target.value)/100;if(cloth.simulation)cloth.simulation.breeze=state.clothSettings.breeze;});
$('feather-density').addEventListener('input',event=>{
  state.featherDensity=Number(event.target.value);
  $('feather-density-value').textContent=state.featherDensity+'%';
  event.target.setAttribute('aria-valuetext',state.featherDensity+'%');
  paintRange(event.target);refreshFeathers();
});
const featherPercent=value=>Math.round(value)+'%';
const featherGrammarKeys=['axiom','ruleX','ruleF'];
const featherSettingControls=[
  ['generations',1,value=>Math.round(value)],
  ['branchLength',1,value=>value.toFixed(2)+'×'],
  ['branchRandomness',.01,featherPercent],
  ['length',1,value=>value.toFixed(2)+'×'],
  ['width',1,value=>value.toFixed(2)+'×'],
  ['detail',.01,featherPercent],
  ['angle',1,value=>Math.round(value)+'°'],
  ['opacity',.01,featherPercent],
  ['shadow',.01,featherPercent],
  ['subsurface',.01,featherPercent],
  ['lift',1,value=>Math.round(value)+'°'],
  ['flowDirection',1,value=>`${Math.round(value)}° ${['↓','↘','→','↗','↑','↖','←','↙'][Math.round(value/45)%8]}`],
  ['breeze',.01,featherPercent],
  ['windDirection',1,value=>`${Math.round(value)}° ${['E','NE','N','NW','W','SW','S','SE'][Math.round(value/45)%8]}`]
];
function syncWindDirection(){
  $('feather-wind-arrow').style.transform=`rotate(${-state.featherSettings.windDirection}deg)`;
  $('feather-windDirection').setAttribute('aria-valuetext',$('feather-windDirection-value').textContent+' · direction the breeze blows');
}
function syncFeatherSettingsUI(){
  document.querySelector(`[name="feather-style"][value="${state.featherSettings.style}"]`).checked=true;
  $('feather-density').value=state.featherDensity;
  $('feather-density-value').textContent=state.featherDensity+'%';
  $('feather-density').setAttribute('aria-valuetext',state.featherDensity+'%');
  paintRange($('feather-density'));
  for(const [key,multiplier,format] of featherSettingControls){
    const input=$('feather-'+key),value=state.featherSettings[key]/multiplier;
    input.value=value;paintRange(input);$('feather-'+key+'-value').textContent=format(value);
  }
  syncWindDirection();
  $('feather-skin-color').value=state.featherSettings.skinColor;
  $('feather-layering-summary').textContent=state.featherSettings.lift+'° lift';
  $('feather-lsystem-summary').textContent=state.featherSettings.generations+' generations';
  for(const key of featherGrammarKeys){$('feather-'+key).value=state.featherSettings[key];$('feather-'+key).removeAttribute('aria-invalid');}
  $('feather-grammar-status').textContent='';
}
for(const [key,multiplier,format] of featherSettingControls){
  const input=$('feather-'+key);
  input.addEventListener('input',()=>{
    const value=Number(input.value);state.featherSettings[key]=value*multiplier;
    paintRange(input);$('feather-'+key+'-value').textContent=format(value);
    if(key==='windDirection')syncWindDirection();
    if(key==='lift')$('feather-layering-summary').textContent=value+'° lift';
    if(key==='generations')$('feather-lsystem-summary').textContent=value+' generations';
    feathers.setSettings(state.featherSettings);renderDirty=true;
  });
}
$('feather-skin-color').addEventListener('input',event=>{
  state.featherSettings.skinColor=event.target.value;
  feathers.setSettings(state.featherSettings);renderDirty=true;
});
for(const key of featherGrammarKeys){
  $('feather-'+key).addEventListener('input',()=>{$('feather-'+key).removeAttribute('aria-invalid');$('feather-grammar-status').textContent='';});
  $('feather-'+key).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('feather-grammar-apply').click();}});
}
$('feather-grammar-apply').addEventListener('click',()=>{
  const grammar={};
  for(const key of featherGrammarKeys){
    const input=$('feather-'+key),value=input.value.replace(/\s/g,'');
    let balance=0,balanced=true;
    for(const symbol of value){if(symbol==='[')balance++;if(symbol===']'&&--balance<0){balanced=false;break;}}
    const message=key==='axiom'&&!value?'Enter an axiom, such as X.':!/^[FX+\-\[\]]*$/.test(value)?'Use only F, X, +, -, [ and ].':!balanced||balance?'Match each [ with a closing ].':'';
    if(message){input.setAttribute('aria-invalid','true');$('feather-grammar-status').textContent=message;input.focus();return;}
    grammar[key]=value;
  }
  Object.assign(state.featherSettings,grammar);feathers.setSettings(state.featherSettings);
  for(const key of featherGrammarKeys)$('feather-'+key).value=grammar[key];
  $('feather-grammar-status').textContent='Grammar applied.';renderDirty=true;
});
$('feather-grammar-reset').addEventListener('click',()=>{
  for(const key of [...featherGrammarKeys,'generations','branchLength','branchRandomness'])state.featherSettings[key]=defaultFeatherSettings[key];
  syncFeatherSettingsUI();feathers.setSettings(state.featherSettings);
  $('feather-grammar-status').textContent='Original grammar restored.';renderDirty=true;
});
document.querySelectorAll('[name="feather-style"]').forEach(input=>input.addEventListener('change',()=>{
  state.featherSettings.style=input.value;
  feathers.setSettings(state.featherSettings);renderDirty=true;
}));
function showFeatherOptions(open){
  $('feather-options').hidden=!open;
  $('feather-controls').closest('.specimen-dock').classList.toggle('feather-menu-open',open);
  $('feather-settings-toggle').setAttribute('aria-expanded',String(open));
  $('feather-material').setAttribute('aria-expanded',String(open));
  $('maze-feather-settings').setAttribute('aria-expanded',String(open));
  if(open)showPaintOptions(false);
}
$('feather-settings-toggle').addEventListener('click',()=>showFeatherOptions($('feather-options').hidden));
$('maze-feather-settings').addEventListener('click',()=>showFeatherOptions($('feather-options').hidden));
$('feather-settings-close').addEventListener('click',()=>{showFeatherOptions(false);$(mazeNavigation.active?'maze-feather-settings':'feather-settings-toggle').focus();});
function applyFeatherPreset1(){
  state.featherDensity=featherPreset1.density;Object.assign(state.featherSettings,featherPreset1.settings);
  syncFeatherSettingsUI();feathers.setSettings(state.featherSettings);refreshFeathers();
  syncFeatherFlightUI();
}
function syncFeatherFlightUI(){
  if(palm.group.visible)return;
  const returning=feathers.returningCount>0;
  if($('feather-return').disabled!==returning){$('feather-return').disabled=returning;$('feather-return').textContent=returning?'Returning…':'Return feathers';}
}
function showFernOptions(open){
  if(open)showFernCycle(false);
  $('fern-options').hidden=!open;
  $('fern-controls').closest('.specimen-dock').classList.toggle('fern-menu-open',open);
  for(const id of ['fern-material','fern-settings-toggle'])$(id).setAttribute('aria-expanded',String(open));
}
function frameFern(){
  if($('fern-on-object').checked){core.updateWorldMatrix(true,false);const center=(models.active?models.meshes.reduce((box,mesh)=>box.expandByObject(mesh),new THREE.Box3()):new THREE.Box3().setFromObject(core)).getCenter(new THREE.Vector3());controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(4,3,6));controls.update();return;}
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
  if(fernLife.active&&fernLife.stage!==0){
    controls.target.set(0,floorY+.75,0);camera.position.copy(controls.target).add(new THREE.Vector3(2,1.1,3.4));
  }else{
    if(!fernLife.active){
      const angle=fernWindDirection*Math.PI/180;
      controls.target.set(Math.cos(angle)*1.2,floorY+.5,Math.sin(angle)*1.2);
      camera.position.copy(controls.target).add(new THREE.Vector3(4.3,3.1,6).multiplyScalar(Math.max(.8,fernSettings.length/1.4)));
    }else{
      new THREE.Box3().setFromObject(fern.group).getCenter(controls.target);
      camera.position.copy(controls.target).add(new THREE.Vector3(2.5,2.1,3.2).multiplyScalar(fernSettings.length/1.4));
    }
  }
  controls.update();controls.enableDamping=damping;
  if(!fernLife.active&&fernDispersal.stats.colonies)fitFernSpread();
}
function fitFernSpread(){
  const bounds=fernDispersal.getBounds(),sphere=bounds.getBoundingSphere(new THREE.Sphere());
  const offset=camera.position.clone().sub(controls.target),back=offset.clone().normalize();
  const right=new THREE.Vector3(back.z,0,-back.x).normalize(),up=new THREE.Vector3().crossVectors(back,right);
  const tanVertical=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),tanHorizontal=tanVertical*camera.aspect;
  let distance=0;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    const point=new THREE.Vector3(x,y,z).sub(sphere.center);
    distance=Math.max(distance,point.dot(back)+Math.max(Math.abs(point.dot(right))/tanHorizontal,Math.abs(point.dot(up))/tanVertical));
  }
  distance=Math.max(offset.length(),distance*1.12);
  camera.position.copy(sphere.center).add(offset.setLength(distance));controls.target.copy(sphere.center);
  controls.maxDistance=Math.max(controls.maxDistance,distance*1.5);camera.far=Math.max(camera.far,distance*8+sphere.radius*2+100);camera.updateProjectionMatrix();
  const groundScale=Math.max(1,distance*10/75,Math.abs(bounds.min.x)/75,Math.abs(bounds.max.x)/75,Math.abs(bounds.min.z)/75,Math.abs(bounds.max.z)/75);
  ground.scale.set(groundScale,groundScale,1);controls.update();
}
function rebuildFern(){
  fernDispersal.clear();fern.rebuild(fernSettings);fernDispersal.setSurface($('fern-on-object').checked?createFernSurface(models.active?models.meshes:core):null);fernDispersal.rebuild();fernDispersal.setWind(fernSettings.wind,fernWindDirection);
  fernDispersal.setVariableWind($('fern-variable-wind').checked);
  if(fernLife.active)fernLife.seek(fernLife.progress);$('fern-count').textContent=fern.stats.fronds+' fronds';
  syncFernDispersal();renderDirty=true;renderer.shadowMap.needsUpdate=true;
}
$('fern-material').addEventListener('click',()=>{
  $('fern-on-object').checked=false;
  mazeNavigation.exit();models.clear();interactions.cancel();showPaintOptions(false);
  state.material='fern';models.setAppearance();state.palm=false;setPlaying(false);setLayerView(0);setAutoRotation(false);
  rebuildFern();fernDispersal.setPlaying(!reducedMotion);syncFernDispersal();refreshFeathers();updateMetalFinish();showFernOptions(true);frameFern();
  $('scene').title='Drag to orbit · Scroll to zoom';
});
$('fern-on-object').onchange=()=>{rebuildFern();refreshFeathers();};
$('fern-settings-toggle').onclick=()=>showFernOptions($('fern-options').hidden);
$('fern-settings-close').onclick=()=>{showFernOptions(false);$('fern-settings-toggle').focus();};
$('fern-regrow').onclick=()=>{fernSettings.seed+=101;rebuildFern();};
for(const key of ['fronds','length','density','arch','wind']){
  const input=$('fern-'+key);
  input.addEventListener('input',()=>{
    fernSettings[key]=Number(input.value)/(key==='fronds'?1:100);
    $('fern-'+key+'-value').value=key==='fronds'?input.value:key==='length'?fernSettings[key].toFixed(2):input.value+'%';
    if(key==='wind'){fern.setWind(fernSettings.wind);fernDispersal.setWind(fernSettings.wind,fernWindDirection);}else rebuildFern();
  });
}
$('fern-spores-release').onclick=()=>{
  if(fernLife.active){fernLife.setActive(false);showFernCycle(false);lastFernLifeStage=-1;}
  fernDispersal.rebuild();fernDispersal.setVisible(true);fernDispersal.setPlaying(true);syncFernDispersal();
  showFernOptions(false);renderDirty=true;renderer.shadowMap.needsUpdate=true;
};
$('fern-simulation-speed').oninput=event=>{
  fernDispersal.setSpeed(Number(event.target.value));$('fern-simulation-speed-value').value=fernDispersal.speed+'×';
};
$('fern-population-limit').oninput=event=>{
  fernDispersal.setPopulationLimit(Number(event.target.value));$('fern-population-limit-value').value=fernDispersal.populationLimit;
};
$('fern-spores-pause').onclick=()=>{fernDispersal.setPlaying(!fernDispersal.playing);syncFernDispersal();};
$('fern-variable-wind').onchange=event=>fernDispersal.setVariableWind(event.target.checked);
$('fern-wind-direction').oninput=event=>{
  fernWindDirection=Number(event.target.value);$('fern-wind-direction-value').value=fernWindDirection+'°';
  fernDispersal.setWind(fernSettings.wind,fernWindDirection);
};
function syncFernDispersal(){
  const stats=fernDispersal.stats;
  const air=fernDispersal.wind;$('fern-wind-live').textContent='Wind from '+Math.round((air.direction+180+360)%360)+'° · '+Math.round(air.strength*100)+'% · '+(air.pointer?'following cursor':'windmill faces incoming air');
  if(state.material==='fern'&&!fernLife.active){const fronds=fernDispersal.inspectPlant(0)?.fronds??[];const visible=fronds.filter(f=>f.visible);$('fern-count').textContent=stats.parentStage==='dead'?stats.colonies+' living ferns':visible.length+' fronds · '+visible.filter(f=>f.unroll<.99).length+' coiled';}
  const status=stats.airborne+' drifting · '+stats.colonies+' ferns · '+stats.grown+' mature · '+stats.drying+' drying · '+stats.died+' died · generation '+stats.generation;
  if($('fern-spores-status').textContent!==status)$('fern-spores-status').textContent=status;
  $('fern-spores-pause').textContent=fernDispersal.playing?'Pause dispersal':'Resume dispersal';
  $('fern-spores-pause').setAttribute('aria-pressed',String(!fernDispersal.playing));
}
function showFernCycle(open){
  $('fern-cycle-options').hidden=!open;
  $('fern-cycle-toggle').setAttribute('aria-expanded',String(open));
  $('fern-controls').closest('.specimen-dock').classList.toggle('fern-cycle-open',open);
  if(open){showFernOptions(false);fernDispersal.setVisible(false);if(!fernLife.active)fernLife.setActive(true);syncFernCycle();}
}
let lastFernLifeStage=-1;
function syncFernCycle(){
  const info=fernLifeStages[fernLife.stage];
  $('fern-cycle-progress').value=Math.round(fernLife.progress);
  $('fern-cycle-play').textContent=fernLife.playing?'Pause':'Play cycle';
  $('fern-cycle-play').setAttribute('aria-pressed',String(fernLife.playing));
  if(lastFernLifeStage!==fernLife.stage){
    lastFernLifeStage=fernLife.stage;
    $('fern-cycle-title').textContent=info.title;$('fern-cycle-phase').textContent=info.phase;
    $('fern-cycle-description').textContent=info.text;$('fern-cycle-scale').textContent=info.scale;
    $('fern-count').textContent=info.title;
    $('scene').setAttribute('aria-label',info.title+'. '+info.text+' Drag to orbit and scroll to zoom.');
    document.querySelectorAll('[data-fern-stage]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.fernStage)===fernLife.stage)));
  }
}
function seekFernLife(value){
  fernLife.seek(value);syncFernCycle();renderDirty=true;renderer.shadowMap.needsUpdate=true;
}
$('fern-cycle-toggle').onclick=()=>showFernCycle($('fern-cycle-options').hidden);
$('fern-cycle-close').onclick=()=>{showFernCycle(false);$('fern-cycle-toggle').focus();};
$('fern-cycle-exit').onclick=()=>{
  fernLife.setActive(false);fernDispersal.setVisible(true);showFernCycle(false);lastFernLifeStage=-1;
  $('fern-count').textContent=fern.stats.fronds+' fronds';
  renderDirty=true;renderer.shadowMap.needsUpdate=true;
};
$('fern-cycle-play').onclick=()=>{fernLife.setPlaying(!fernLife.playing);syncFernCycle();};
$('fern-cycle-progress').oninput=event=>{fernLife.setPlaying(false);seekFernLife(Number(event.target.value));};
$('fern-cycle-prev').onclick=()=>seekFernLife((fernLife.stage+6)%7*100);
$('fern-cycle-next').onclick=()=>seekFernLife((fernLife.stage+1)%7*100);
document.querySelectorAll('[data-fern-stage]').forEach(button=>button.onclick=()=>{fernLife.setPlaying(false);seekFernLife(Number(button.dataset.fernStage)*100);});
function growPalm(){
  mazeNavigation.exit();models.clear();interactions.cancel();state.material='feathers';state.palm=true;setPlaying(false);setLayerView(0);
  palm.rebuild(palmSettings);refreshFeathers();updateMetalFinish();showOasisOptions(true);syncFeatherCountUI();
  framePalmScene();renderDirty=true;renderer.shadowMap.needsUpdate=true;
}
function showOasisOptions(open){
  $('oasis-options').hidden=!open;
  $('oasis-controls').closest('.specimen-dock').classList.toggle('oasis-menu-open',open);
  $('oasis-settings-toggle').setAttribute('aria-expanded',String(open));
  $('oasis-material').setAttribute('aria-expanded',String(open));
  if(open){showFeatherOptions(false);showClothOptions(false);showPaintOptions(false);}
}
$('oasis-settings-toggle').addEventListener('click',()=>showOasisOptions($('oasis-options').hidden));
$('oasis-settings-close').addEventListener('click',()=>{showOasisOptions(false);$('oasis-settings-toggle').focus();});
function framePalmScene(){
  state.palmSceneView='oasis';syncViewMode();
  // Clear orbit inertia before placing the camera, so a previous rotation
  // cannot carry the distant landmark out of the reset composition.
  const damping=controls.enableDamping,rotate=controls.autoRotate;
  controls.enableDamping=false;controls.autoRotate=false;controls.update();
  if(oasis.group.visible){controls.maxDistance=45;controls.target.set(-3.5,1,2.7);camera.position.set(8,5,14);}
  else if(desert.enabled){controls.maxDistance=13;controls.target.set(0,1.6,0);camera.position.set(8,.2,8);}
  else{new THREE.Box3().setFromObject(palm.group).getCenter(controls.target);camera.position.copy(controls.target).add(new THREE.Vector3(4,3.2,6));}
  controls.update();controls.enableDamping=damping;controls.autoRotate=rotate;
}
function syncPalmEnvironment(viewChanged=false){
  const enabled=palm.group.visible&&state.palmDesert;
  const changed=enabled!==desert.enabled;
  if(changed&&enabled)desertCamera={position:camera.position.clone(),target:controls.target.clone(),near:camera.near,far:camera.far,rotate:state.rotate,maxDistance:controls.maxDistance};
  desert.setEnabled(enabled);desertLandmark.setVisible(enabled);document.querySelector('.stage').classList.toggle('desert-daylight',enabled);
  mirage.setEnabled(enabled);
  if(enabled&&state.palmOasis)oasis.rebuild(palmSettings);
  oasis.setEnabled(enabled&&state.palmOasis,ground.material);
  oasis.setSunDirection(desert.sunDirection);
  syncTowerCloth();
  if(changed){
    if(enabled){camera.near=1;camera.far=4000;setAutoRotation(false);}
    else if(desertCamera){camera.position.copy(desertCamera.position);controls.target.copy(desertCamera.target);camera.near=desertCamera.near;camera.far=desertCamera.far;controls.maxDistance=desertCamera.maxDistance;setAutoRotation(desertCamera.rotate);desertCamera=null;controls.update();}
  }
  if(changed||viewChanged)resize();else syncPalmViewUI();
}
function syncPalmViewUI(){
  const fov=$('palm-camera-fov');fov.value=camera.fov;$('palm-camera-fov-value').value=Math.round(camera.fov)+'°';paintRange(fov);
  for(const key of ['elevation','azimuth']){
    const input=$('palm-sun-'+key);input.value=state.palmView[key];$('palm-sun-'+key+'-value').value=Math.round(state.palmView[key])+'°';paintRange(input);
  }
  $('palm-sun-settings').disabled=!desert.enabled;$('palm-sun-reset').disabled=!desert.enabled;
  syncViewMode();
}
async function setPalmSceneView(view){
  if(!palm.group.visible||view==='building'&&!desert.enabled)return;
  towerClothFocusPending=false;
  state.palmSceneView=view;
  if(view==='oasis'){framePalmScene();return;}
  if(!desertLandmark.group.children.length){
    buildingViewLoading=true;syncViewMode();
    const root=await desertLandmark.load();buildingViewLoading=false;
    if(!palm.group.visible||!desert.enabled||state.palmSceneView!=='building'){syncViewMode();return;}
    if(!root){framePalmScene();return;}
  }
  frameBuildingScene();
}
function towerClothActive(){return state.material==='feathers'&&!!state.palm&&desert.enabled&&state.palmTowerCloth;}
function rebuildTowerCloth(){
  if(!towerClothActive()||!desertLandmark.group.children.length)return;
  towerCloth.rebuild(desertLandmark.group,{...state.clothSettings,resolution:innerWidth<600?28:36});
  cloth.simulation.breeze=state.clothSettings.breeze;syncClothPlayback();
  oasis.invalidateReflection();renderDirty=true;renderer.shadowMap.needsUpdate=true;
}
function frameBuildingScene(){
  const bounds=new THREE.Box3().setFromObject(desertLandmark.group);
  if(!desert.enabled||bounds.isEmpty())return;
  state.palmSceneView='building';syncViewMode();
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
  bounds.getCenter(controls.target);controls.maxDistance=1500;
  camera.position.copy(controls.target).add(new THREE.Vector3(1,.45,1.35).normalize().multiplyScalar((bounds.max.y-bounds.min.y)*2.5));
  controls.update();controls.enableDamping=damping;renderDirty=true;
}
function syncTowerCloth(){
  const active=towerClothActive(),next=active?towerCloth.surface:specimenCloth;
  if(cloth!==next){
    const plastic=cloth.plasticSettings;cloth.clear();cloth=next;
    cloth.setPlasticSettings(plastic);cloth.setFabric(state.clothSettings.fabric);
    $('cloth-fabric-name').textContent=cloth.fabric.name;syncPlasticControls();syncClothRopes();
  }
  $('palm-tower-cloth').checked=state.palmTowerCloth;$('palm-tower-cloth').disabled=!desert.enabled;
  $('palm-tower-cloth-actions').hidden=!active;
  const panel=$('cloth-options'),parent=active?$('oasis-controls'):$('cloth-controls');
  if(panel.parentElement!==parent){const open=state.material==='cloth'&&!panel.hidden;showClothOptions(false);parent.appendChild(panel);if(open)showClothOptions(true);}
  panel.setAttribute('aria-label',active?'Jeddah Tower cloth settings':'Cloth settings');
  panel.querySelector('h2').textContent=active?'Jeddah Tower cloth':'Cloth settings';
  if(!active){towerCloth.clear();towerClothFocusPending=false;$('palm-tower-cloth-status').textContent='';return;}
  if(desertLandmark.group.children.length){
    if(!cloth.simulation)rebuildTowerCloth();
    $('palm-tower-cloth-status').textContent='Cloth simulation on the 1,000 m tower.';
    if(towerClothFocusPending){towerClothFocusPending=false;frameBuildingScene();}
  }else if(!towerClothLoading){
    towerClothLoading=true;$('palm-tower-cloth-status').textContent='Loading Jeddah Tower…';
    desertLandmark.load().then(root=>{
      towerClothLoading=false;
      if(!towerClothActive())return;
      if(!root)state.palmTowerCloth=false;
      syncTowerCloth();
    });
  }
}
$('palm-tower-cloth').addEventListener('change',event=>{
  state.palmTowerCloth=event.target.checked;towerClothFocusPending=event.target.checked;syncTowerCloth();
  oasis.invalidateReflection();renderDirty=true;renderer.shadowMap.needsUpdate=true;
});
$('palm-tower-cloth-settings').addEventListener('click',()=>showClothOptions(true));
function applyPalmSun(){
  desert.setSunSettings(state.palmView);Object.assign(state.palmView,desert.sunSettings);
  oasis.setSunDirection(desert.sunDirection);syncPalmViewUI();renderDirty=true;
}
$('palm-camera-fov').addEventListener('input',event=>{state.palmView.fov=Number(event.target.value);resize();});
$('palm-camera-auto').addEventListener('click',()=>{state.palmView.fov=null;resize();});
for(const key of ['elevation','azimuth'])$('palm-sun-'+key).addEventListener('input',event=>{state.palmView[key]=Number(event.target.value);applyPalmSun();});
$('palm-sun-reset').addEventListener('click',()=>{Object.assign(state.palmView,defaultDesertSunSettings);applyPalmSun();});
document.querySelectorAll('[name=palm-environment]').forEach(input=>input.addEventListener('change',()=>{
  state.palmDesert=input.value==='desert';syncPalmEnvironment();if(palm.group.visible)framePalmScene();updateMetalFinish();renderDirty=true;
}));
$('palm-oasis').addEventListener('change',event=>{
  state.palmOasis=event.target.checked;syncPalmEnvironment(true);framePalmScene();syncFeatherCountUI();updateMetalFinish();renderDirty=true;renderer.shadowMap.needsUpdate=true;
});
$('palm-mirage').addEventListener('input',event=>{
  state.palmMirage=Number(event.target.value)/100;mirage.setStrength(state.palmMirage);
  $('palm-mirage-value').value=event.target.value+'%';paintRange(event.target);renderDirty=true;
});
paintRange($('palm-mirage'));
$('palm-grow').addEventListener('click',growPalm);
$('palm-exit').addEventListener('click',event=>{event.stopPropagation();$('feather-material').click();});
$('palm-regrow').addEventListener('click',()=>{palmSettings.seed++;palm.rebuild(palmSettings);if(oasis.group.visible)oasis.rebuild(palmSettings);renderDirty=true;renderer.shadowMap.needsUpdate=true;});
for(const [key,scale] of [['fronds',1],['density',.01],['dryFraction',.01],['length',.01],['droop',.01],['curve',.01],['wind',.01]]){
  const input=$('palm-'+key),output=$('palm-'+key+'-value');
  function sync(){
    input.value=palmSettings[key]/scale;paintRange(input);
    output.value=key==='fronds'?input.value:key==='length'?palmSettings[key].toFixed(2):input.value+'%';
  }
  sync();
  input.addEventListener('input',()=>{
    palmSettings[key]=Number(input.value)*scale;sync();
    if(key==='wind'){palm.setWind(palmSettings.wind);oasis.setWind(palmSettings.wind);}else{palm.rebuild(palmSettings);if(oasis.group.visible)oasis.rebuild(palmSettings);}
    renderDirty=true;renderer.shadowMap.needsUpdate=true;syncFeatherCountUI();
  });
}
$('feather-preset-1').addEventListener('click',applyFeatherPreset1);
$('feather-settings-reset').addEventListener('click',applyFeatherPreset1);
$('feather-return').addEventListener('click',()=>{feathers.returnAll();syncFeatherFlightUI();renderDirty=true;});
$('feather-fly-all').addEventListener('click',()=>{if(feathers.launchAll())renderDirty=true;syncFeatherFlightUI();});
syncFeatherSettingsUI();

function showPaintOptions(open){
  $('paint-options').hidden=!open;
  $('paint-toggle').setAttribute('aria-expanded',String(open));
}
$('paint-toggle').addEventListener('click',()=>{
  if(state.material!=='metal'){leaveFeathers();updateMetalFinish();repaint(!reducedMotion);}
  showPaintOptions($('paint-options').hidden);
});
function setModelAppearance(value){
  state.modelAppearance=value;$('model-paint-mode').value=value;
  if(value==='paint')state.painted=true;
  state.age=0;state.exploded=0;setLayerView(0);
  updateMetalFinish();models.setAppearance();repaint(!reducedMotion);
}
$('model-paint-mode').addEventListener('change',event=>setModelAppearance(event.target.value));
$('paint-enabled').addEventListener('change',event=>{
  state.painted=event.target.checked;
  updateMetalFinish();repaint(!reducedMotion);
});
$('picker-paint-color').addEventListener('input',event=>{
  if(models.active&&state.modelAppearance!=='paint')setModelAppearance('paint');
  if(!state.painted){state.painted=true;updateMetalFinish();repaint(!reducedMotion);}
  currentColors.pink=event.target.value;
  currentColors.pinkLight=lightPaintColor(event.target.value);
  syncColors();
});
document.addEventListener('click',event=>{
  if(!$('paint-options').contains(event.target)&&!$('paint-toggle').contains(event.target))showPaintOptions(false);
  if(!$('feather-controls').contains(event.target)&&!$('feather-material').contains(event.target)&&!$('feather-options').contains(event.target)&&!$('maze-feather-settings').contains(event.target))showFeatherOptions(false);
  if(!$('fern-controls').contains(event.target)&&!$('fern-material').contains(event.target)){showFernOptions(false);showFernCycle(false);}
  if(!$('oasis-controls').contains(event.target)&&!$('oasis-material').contains(event.target))showOasisOptions(false);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('paint-options').hidden){showPaintOptions(false);$('paint-toggle').focus();}
  if(event.key==='Escape'&&!$('feather-options').hidden){showFeatherOptions(false);$(mazeNavigation.active?'maze-feather-settings':'feather-settings-toggle').focus();}
  if(event.key==='Escape'&&!$('fern-cycle-options').hidden){showFernCycle(false);$('fern-cycle-toggle').focus();}
  if(event.key==='Escape'&&!$('fern-options').hidden){showFernOptions(false);$('fern-settings-toggle').focus();}
  if(event.key==='Escape'&&!$('oasis-options').hidden){showOasisOptions(false);$('oasis-settings-toggle').focus();}
});

function changeShape(shape){
  state.palm=false;
  mazeNavigation.exit();
  models.clear();
  state.shape=shape;
  $('maze-enter').hidden=shape!=='maze';
  document.querySelectorAll('[data-shape]').forEach(button=>{
    const selected=button.dataset.shape===shape;
    button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',selected);
  });
  const previous=core.geometry;
  core.geometry=state.shape==='cube'?createCoreGeometry(cpuNoise):createShapeGeometry(state.shape);
  previous.dispose();physics.setSpecimenShape(state.shape);
  randomizeTilt();physics.setCubeTransform(specimen.position,specimen.quaternion);
  renderer.shadowMap.needsUpdate=true;renderDirty=true;
}

document.querySelectorAll('[data-shape]').forEach(button=>button.addEventListener('click',()=>{
  if(state.material==='fern')$('fern-on-object').checked=true;
  if(state.palm){state.palm=false;refreshFeathers();updateMetalFinish();}
  if(button.dataset.shape===state.shape&&!models.active&&state.material!=='fern'){
    if(state.shape!=='maze'){models.clear();return;}
    mazeNavigation.exit();
    const next=mazeMaps[(mazeMaps.findIndex(map=>map.id===getMazeMap())+1)%mazeMaps.length];
    setMazeMap(next.id);state.mazeMap=next.id;mazeNavigation.refreshMap();
    mazeNavigation.room.interior.setReflectionGroup(feathers.group);
    syncMazeMapButton();toast('Map: '+next.name);
  }
  interactions.cancel();changeShape(button.dataset.shape);
  if(state.material==='fern')rebuildFern();
  state.age=0;state.exploded=0;setLayerView(0);surface.rebuild();paintHold=2.6;
  refreshFeathers();
  updateMetalFinish();updateAgeUI();setPlaying(state.material==='fern'?false:!reducedMotion);
  renderer.shadowMap.needsUpdate=true;renderDirty=true;
}));

const sampleNames={horse:'Horse statue',glasses:'Glasses',duck:'Duck'};
$('horse-shape').addEventListener('click',async()=>{
  interactions.cancel();
  if(await models.loadSample('horse',sampleNames.horse))repaint(!reducedMotion);
});

$('random-shape').onclick=async()=>{
  interactions.cancel();
  const previousMaterial=state.material==='feathers'?'feathers':state.metal;
  leaveFeathers();
  const previousSeed=state.seed;
  state.seed=Math.floor(Math.random()*90000)+10000;
  if(state.seed===previousSeed)state.seed=10000+(state.seed-9999)%90000;
  uniforms.uSeed.value=state.seed*.017;
  const selected=models.active?models.sampleKey:state.shape;
  const shapes=[...Object.keys(shapeNames),...Object.keys(sampleNames)].filter(shape=>shape!==selected);
  const nextShape=shapes[Math.floor(Math.random()*shapes.length)];
  if(sampleNames[nextShape])models.clear();else changeShape(nextShape);
  const materials=[...Object.keys(metalPresets),'feathers'].filter(material=>material!==previousMaterial);
  const material=materials[Math.floor(Math.random()*materials.length)];
  state.material=material==='feathers'?'feathers':'metal';
  if(state.material==='metal')state.metal=material;
  state.painted=Math.random()<.5;
  const profile=metalPresets[state.metal];
  // Keep corrosion and base-metal colours recognisable, with a fresh variation.
  for(const [key,value] of Object.entries(profile.colors)){
    const color=new THREE.Color(value);
    color.offsetHSL((Math.random()-.5)*.04,(Math.random()-.5)*.12,(Math.random()-.5)*.08);
    currentColors[key]='#'+color.getHexString();
  }
  const hue=Math.random();
  currentColors.pink='#'+new THREE.Color().setHSL(hue,.3+Math.random()*.45,.35+Math.random()*.32).getHexString();
  currentColors.teal='#'+new THREE.Color().setHSL((hue+.2+Math.random()*.4)%1,.15+Math.random()*.35,.25+Math.random()*.35).getHexString();
  currentColors.pinkLight=lightPaintColor(currentColors.pink);
  currentColors.tealLight=lightPaintColor(currentColors.teal);
  state.age=0;state.exploded=0;setLayerView(0);
  updateMetalFinish();syncColors();surface.rebuild();paintHold=2.6;
  $('specimen-number').textContent=String(state.seed).slice(0,3);
  updateAgeUI();
  if(sampleNames[nextShape]) {
    setPlaying(false);
    if(!await models.loadSample(nextShape,sampleNames[nextShape]))return;
  }else refreshFeathers();
  setPlaying(!reducedMotion);
  const appearance=state.material==='feathers'?'Feathered':`${state.painted?'Painted':'Bare'} ${profile.name.toLowerCase()}`;
  toast(`${appearance} ${(sampleNames[nextShape]??shapeNames[state.shape]).toLowerCase()}. New colours, new pattern.`);
};

$('scene').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const offset=camera.position.clone().sub(controls.target);const spherical=new THREE.Spherical().setFromVector3(offset);if(e.key==='ArrowLeft')spherical.theta-=.1;if(e.key==='ArrowRight')spherical.theta+=.1;if(e.key==='ArrowUp')spherical.phi=Math.max(.15,spherical.phi-.1);if(e.key==='ArrowDown')spherical.phi=Math.min(Math.PI-.15,spherical.phi+.1);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();}});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();setPlaying(false);toast('Graphics paused. Reload the page to restore the scene.');});

updateMetalFinish();syncColors();updateAgeUI();setPlaying(state.playing);
let lastTime=performance.now(),lastGeometryTime=0,uiElapsed=0,firstFrame=true;
let lastShadowGeometry=null,lastShadowVersion=-1,lastUIAge=state.age;
const buildingShadowBounds=new THREE.Box3();
function renderScene(){
  if(scene.fog===fernAtmosphere)fernAtmosphere.density=Math.min(.002,.5/Math.max(1,camera.position.distanceTo(controls.target)));
  if(fernDispersal.group.visible)fernDispersal.updateView();
  if(desert.enabled&&state.palmSceneView==='building'&&desertLandmark.group.children.length){
    buildingShadowBounds.setFromObject(desertLandmark.group);
    if(towerCloth.group.visible)buildingShadowBounds.expandByObject(towerCloth.group,true);
    desert.setShadowBounds(buildingShadowBounds);
  }else desert.setShadowBounds(null);
  mirage.render(scene,camera,()=>featherRenderer.render(scene,camera));
}
function animate(time){
  requestAnimationFrame(animate);
  if(document.hidden){lastTime=time;return;}
  const dt=clamp((time-lastTime)/1000,0,.1);lastTime=time;
  let geometryDirty=false;
  if(state.playing&&state.age<1){
    if(paintHold>0){paintHold=Math.max(0,paintHold-dt);}
    else{
      const rate=corrosionRate(state);
      state.age=Math.min(1,state.age+dt*rate);uniforms.uAge.value=state.age;geometryDirty=rate>0;
      if(state.age>=1){setPlaying(false);toast('Timeworn. Restart to begin a fresh transformation.');}
    }
  }
  if(Math.abs(state.exploded-desiredExplode)>.001){state.exploded=THREE.MathUtils.damp(state.exploded,desiredExplode,7,dt);geometryDirty=true;}
  if(state.material==='metal'&&!models.active&&((geometryDirty&&time-lastGeometryTime>45)||(surface.pendingReleaseCount&&time-lastGeometryTime>100))){surface.updateAttached();lastGeometryTime=time;}
  // Physics continues independently of the aging timeline and playback speed.
  if(interactions.update(dt)){renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  if(state.material==='metal'&&!models.active){physics.step(dt);surface.syncPhysics();}
  if(models.update(dt)){if(state.material==='feathers')feathers.update();renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  if(mazeNavigation.active){
    mazeNavigation.update(dt);
    if(mazeNavigation.room.interior.advance(dt,camera))renderDirty=true;
    if(state.material==='feathers'&&feathers.interact(dt,camera))renderDirty=true;
  }
  if(state.material==='feathers'&&feathers.advance(dt,camera,controls.target))renderDirty=true;
  updateFernPointerWind();
  if(fernDispersal.advance(dt)){
    renderDirty=true;renderer.shadowMap.needsUpdate=true;syncFernDispersal();
  }
  if(fernLife.advance(dt)){
    syncFernCycle();renderDirty=true;renderer.shadowMap.needsUpdate=true;
  }
  if(!reducedMotion&&fernLife.active&&(fernLife.stage===0||fernLife.stage===6)&&fern.advance(dt)){renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  if(!reducedMotion&&palm.advance(dt)){renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  if(mirage.advance(dt))renderDirty=true;
  if(oasis.advance(dt))renderDirty=true;
  if((state.material==='cloth'||towerClothActive())&&cloth.advance(dt)){renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  syncFeatherFlightUI();
  uiElapsed+=dt;if(uiElapsed>.15){if(state.material==='cloth'||towerClothActive()){syncClothRopeStatus();syncClothPlayback();}if(state.age!==lastUIAge){updateAgeUI();lastUIAge=state.age;}uiElapsed=0;}
  const geometry=surface.mesh.geometry;
  // Camera orbit and shader-only aging do not change the light-space geometry.
  if(geometry!==lastShadowGeometry||geometry.attributes.position.version!==lastShadowVersion){
    renderer.shadowMap.needsUpdate=true;renderDirty=true;
    lastShadowGeometry=geometry;lastShadowVersion=geometry.attributes.position.version;
  }
  if(geometryDirty)renderDirty=true;
  if(!mazeNavigation.active)controls.update(dt);
  if(renderDirty||firstFrame){renderScene();if(state.material==='feathers')syncFeatherCountUI();renderDirty=false;}
  if(firstFrame){firstFrame=false;$('loading').classList.add('complete');setTimeout(()=>$('loading').remove(),700);}
}
requestAnimationFrame(animate);

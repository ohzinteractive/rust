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
import { createFeatherRenderer } from './feather-renderer.js';
import { createMazeNavigation } from './maze-navigation.js';
import {getMazeMap,setMazeMap,mazeMaps} from './maze-geometry.js';

const $ = (id) => document.getElementById(id);
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {shape:'cube',mazeMap:getMazeMap(),material:'metal',featherDensity:defaultFeatherDensity,metal:'iron',painted:true,modelAppearance:'paint',flakeFactor:1,age:0,moisture:.72,oxygen:.8,salt:.28,scale:2.4,peel:.68,relief:1,seed:7319,playing:!reducedMotion,rotate:!reducedMotion,speed:10,exploded:0};
const colorKeys=['dark','burnt','orange','gold','teal','tealLight','pink','pinkLight','metal'];
state.featherSettings={...defaultFeatherSettings};
const currentColors={dark:'#241610',burnt:'#70371f',orange:'#b95b28',gold:'#b28a45',teal:'#53645a',tealLight:'#7d8b72',pink:'#efc51a',pinkLight:'#f7d74b',metal:'#343936'};
let paintHold=2.6;

let renderDirty=true;
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
renderer.setClearColor(0x141613,0);

const scene = new THREE.Scene();
scene.fog=new THREE.FogExp2(0x141613,.032);
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
scene.add(new THREE.HemisphereLight(0xe8f2e2,0x292218,1.1));
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
const featherRenderer=createFeatherRenderer({renderer,feathers,shadowLight:key});
let mazeNavigation;
const interactions=createSceneInteractions({canvas:renderer.domElement,camera,controls,core,specimen,surface,physics,enabled:()=>state.material!=='feathers'&&!mazeNavigation?.active,invalidate(){renderDirty=true;renderer.shadowMap.needsUpdate=true;}});
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

const models=createModelImporter({scene,uniforms,state,reducedMotion,notify:toast,featherMaterial:feathers.substrate,
  invalidate(){if(state.material==='feathers')feathers.update();renderDirty=true;renderer.shadowMap.needsUpdate=true;},
  onActivate(name,peeling){
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
  camera.setViewOffset(size.w,size.h,0,size.h*(narrow?.04:-.064),size.w,size.h);
  camera.updateProjectionMatrix();
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
  if(state.material==='feathers')value=false;
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
$('rotate').classList.toggle('active',state.rotate);$('rotate').setAttribute('aria-pressed',state.rotate);$('rotate').setAttribute('aria-label',state.rotate?'Pause automatic rotation':'Start automatic rotation');
$('rotate').onclick=()=>{state.rotate=!state.rotate;controls.autoRotate=state.rotate;$('rotate').classList.toggle('active',state.rotate);$('rotate').setAttribute('aria-pressed',state.rotate);$('rotate').setAttribute('aria-label',state.rotate?'Pause automatic rotation':'Start automatic rotation');};
$('reset-view').onclick=()=>{controls.reset();controls.autoRotate=state.rotate;toast('View reset');};
let desiredExplode=0;
function setLayerView(value){desiredExplode=value;for(const [id,active] of [['surface-view',!value],['layers-view',!!value]]){$(id).classList.toggle('selected',active);$(id).setAttribute('aria-pressed',active);}}
$('surface-view').onclick=()=>setLayerView(0);$('layers-view').onclick=()=>setLayerView(1);
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
  const featherMode=state.material==='feathers';
  document.querySelectorAll('[data-metal]').forEach(button=>{const active=!featherMode&&button.dataset.metal===state.metal;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  $('feather-material').classList.toggle('selected',featherMode);
  $('feather-material').setAttribute('aria-pressed',String(featherMode));
  $('paint-toggle').classList.toggle('selected',!featherMode&&state.painted&&(!models.active||state.modelAppearance==='paint'));
  $('exposure-controls').hidden=featherMode;
  $('feather-controls').hidden=!featherMode;
  $('layers-view').disabled=featherMode||(models.active&&!models.peelingStats);
  $('paint-enabled').checked=state.painted;
  uniforms.uPainted.value=Number(state.painted);
  uniforms.uPatina.value=profile.patina;
  uniforms.uPassivation.value=profile.passivation;
  uniforms.uMetalRoughness.value=profile.roughness;
  uniforms.uDepositRoughness.value=profile.depositRoughness;
  uniforms.uCorrosionRelief.value=profile.relief;
  state.flakeFactor=state.painted?1:profile.bareFlaking;
  $('metal-symbol').textContent=featherMode?'Pl':profile.symbol;
  $('metal-name').textContent=featherMode?'FEATHERS':profile.name.toUpperCase();
  $('scene').setAttribute('aria-label',`${state.painted?'Painted':'Bare'} ${profile.name.toLowerCase()} ${(models.active?'model':shapeNames[state.shape].toLowerCase())} developing ${profile.finish.toLowerCase()}. Tap the specimen to bounce. Drag loose flakes to move them; tap to remove. Drag elsewhere to orbit, scroll to zoom, or use the arrow keys.`);
  document.querySelector('[data-age="0"]').textContent=state.painted?'Fresh paint':'Fresh metal';
  if(featherMode)$('scene').setAttribute('aria-label','Feathers on textured skin. Click a feather to send the whole coat flying. Use Return feathers in Settings to restore the coat. Drag to orbit, scroll to zoom, or use the arrow keys.');
}
function refreshFeathers(){
  const active=state.material==='feathers';
  const interior=mazeNavigation?.active&&state.shape==='maze'&&!models.active;
  core.material=interior?mazeNavigation.room.interior.wallMaterial:active?feathers.substrate:coreMat;
  surface.mesh.visible=!active&&!interior;
  if(active){
    const maze=state.shape==='maze'&&!models.active;
    const sources=models.active?models.meshes:maze&&mazeNavigation.active?[core,mazeNavigation.room.floor,mazeNavigation.room.roof]:[core];
    feathers.rebuild(sources,models.active?scene:specimen,state.featherDensity,state.seed,{scale:maze?.025:1,viewport:maze,maze,shadowDistance:maze?.02:Infinity});
    $('maze-feather-help').hidden=!maze;syncFeatherCountUI();
    $('layers-view').disabled=true;
    if(!mazeNavigation?.active)$('scene').title='Click a feather to send the whole coat flying · Drag to orbit · Scroll to zoom';
  }else feathers.clear();
  renderer.shadowMap.needsUpdate=true;renderDirty=true;
}
function syncFeatherCountUI(){
  const stats=feathers.stats,text=stats.viewport?`${stats.visibleCount} feathers in view`:`${stats.count} feathers`;
  if($('feather-count').textContent!==text)$('feather-count').textContent=text;
}
function leaveFeathers(){
  if(state.material!=='feathers')return;
  showFeatherOptions(false);
  state.material='metal';
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
  if(state.material==='feathers'){showFeatherOptions($('feather-options').hidden);return;}
  interactions.cancel();showPaintOptions(false);
  state.material='feathers';repaint(false);
  models.setAppearance();updateMetalFinish();refreshFeathers();
  showFeatherOptions(true);
});
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
  const returning=feathers.returningCount>0;
  if($('feather-return').disabled!==returning){$('feather-return').disabled=returning;$('feather-return').textContent=returning?'Returning…':'Return feathers';}
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
  if(state.material==='feathers'){leaveFeathers();updateMetalFinish();repaint(!reducedMotion);}
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
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('paint-options').hidden){showPaintOptions(false);$('paint-toggle').focus();}
  if(event.key==='Escape'&&!$('feather-options').hidden){showFeatherOptions(false);$(mazeNavigation.active?'maze-feather-settings':'feather-settings-toggle').focus();}
});

function changeShape(shape){
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
  if(button.dataset.shape===state.shape&&!models.active){
    if(state.shape!=='maze'){models.clear();return;}
    mazeNavigation.exit();
    const next=mazeMaps[(mazeMaps.findIndex(map=>map.id===getMazeMap())+1)%mazeMaps.length];
    setMazeMap(next.id);state.mazeMap=next.id;mazeNavigation.refreshMap();
    mazeNavigation.room.interior.setReflectionGroup(feathers.group);
    syncMazeMapButton();toast('Map: '+next.name);
  }
  interactions.cancel();changeShape(button.dataset.shape);
  state.age=0;state.exploded=0;setLayerView(0);surface.rebuild();paintHold=2.6;
  refreshFeathers();
  updateMetalFinish();updateAgeUI();setPlaying(!reducedMotion);
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
  if(state.material!=='feathers'&&!models.active&&((geometryDirty&&time-lastGeometryTime>45)||(surface.pendingReleaseCount&&time-lastGeometryTime>100))){surface.updateAttached();lastGeometryTime=time;}
  // Physics continues independently of the aging timeline and playback speed.
  if(interactions.update(dt)){renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  if(state.material!=='feathers'&&!models.active){physics.step(dt);surface.syncPhysics();}
  if(models.update(dt)){if(state.material==='feathers')feathers.update();renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  if(mazeNavigation.active){
    mazeNavigation.update(dt);
    if(mazeNavigation.room.interior.advance(dt))renderDirty=true;
    if(state.material==='feathers'&&feathers.interact(dt,camera))renderDirty=true;
  }
  if(state.material==='feathers'&&feathers.advance(dt,camera,controls.target))renderDirty=true;
  syncFeatherFlightUI();
  uiElapsed+=dt;if(uiElapsed>.15){if(state.age!==lastUIAge){updateAgeUI();lastUIAge=state.age;}uiElapsed=0;}
  const geometry=surface.mesh.geometry;
  // Camera orbit and shader-only aging do not change the light-space geometry.
  if(geometry!==lastShadowGeometry||geometry.attributes.position.version!==lastShadowVersion){
    renderer.shadowMap.needsUpdate=true;renderDirty=true;
    lastShadowGeometry=geometry;lastShadowVersion=geometry.attributes.position.version;
  }
  if(geometryDirty)renderDirty=true;
  if(!mazeNavigation.active)controls.update(dt);
  if(renderDirty||firstFrame){featherRenderer.render(scene,camera);if(state.material==='feathers')syncFeatherCountUI();renderDirty=false;}
  if(firstFrame){firstFrame=false;$('loading').classList.add('complete');setTimeout(()=>$('loading').remove(),700);}
}
requestAnimationFrame(animate);

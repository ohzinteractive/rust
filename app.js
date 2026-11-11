import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { createFlakePhysics } from './flake-physics.js';
import { PeelingSurface, noise as cpuNoise } from './peeling-surface.js';
import { createRustMaterial } from './rust-material.js';
import { createCoreGeometry } from './core-geometry.js';
import { createShapeGeometry, shapeNames } from './specimen-shapes.js';
import { createSceneInteractions } from './scene-interactions.js';
import { metalPresets, corrosionRate } from './metal-presets.js';

const $ = (id) => document.getElementById(id);
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {shape:'cube',metal:'iron',painted:true,flakeFactor:1,age:0,moisture:.72,oxygen:.8,salt:.28,scale:2.4,peel:.68,relief:1,seed:7319,palette:'yellow',playing:!reducedMotion,rotate:!reducedMotion,speed:10,exploded:0};
const paletteData = {
  yellow:{name:'Yellow / painted',dark:'#241610',burnt:'#70371f',orange:'#b95b28',gold:'#b28a45',teal:'#53645a',tealLight:'#7d8b72',pink:'#efc51a',pinkLight:'#f7d74b',metal:'#343936'},
  oxide:{name:'Oxide / original',dark:'#211711',burnt:'#713822',orange:'#af5129',gold:'#b18a49',teal:'#5b6554',tealLight:'#8a957d',pink:'#b99a56',pinkLight:'#d7bd7a',metal:'#343936'},
  ember:{name:'Ember / warm',dark:'#271712',burnt:'#813c25',orange:'#c46430',gold:'#bd914d',teal:'#785846',tealLight:'#a08464',pink:'#514940',pinkLight:'#b3a082',metal:'#383633'},
  tidal:{name:'Tidal / cool',dark:'#211b16',burnt:'#70452c',orange:'#b36b39',gold:'#ab945d',teal:'#6b8580',tealLight:'#a2b4a4',pink:'#c8bea4',pinkLight:'#f0e7ce',metal:'#303c3d'}
};
const colorKeys=['dark','burnt','orange','gold','teal','tealLight','pink','pinkLight','metal'];
const colorFields={paint:'pink',undercoat:'teal',rust:'orange',oxide:'burnt',metal:'metal'};
const currentColors={...paletteData.yellow};
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
const interactions=createSceneInteractions({canvas:renderer.domElement,camera,controls,core,specimen,surface,physics,invalidate(){renderDirty=true;renderer.shadowMap.needsUpdate=true;}});

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

let size={w:0,h:0};
function resize(){
  renderDirty=true;
  const rect=$('canvas-wrap').getBoundingClientRect();size={w:rect.width,h:rect.height};
  renderer.setSize(size.w,size.h,false);camera.aspect=size.w/size.h;
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
for(const key of ['scale','peel','relief']){
  const el=$(key);paintRange(el);
  el.addEventListener('input',()=>{
    state[key]=key==='scale'?+el.value:+el.value/100;
    $(key+'-value').innerHTML=key==='scale'?`${state.scale.toFixed(1)}<span>×</span>`:`${Math.round(state[key]*100)}<span>%</span>`;
    paintRange(el);
    if(key==='scale')uniforms.uScale.value=state.scale;
    if(key==='relief')uniforms.uRelief.value=state.relief;
    if(key==='peel'||key==='relief')surface.updateAttached();
  });
}
function repaint(shouldPlay=true){
  interactions.cancel();
  state.age=0;paintHold=2.6;state.exploded=0;setLayerView(0);
  surface.repaint();updateAgeUI();setPlaying(shouldPlay);
}
$('restart').onclick=()=>{repaint(!reducedMotion);toast('Fresh surface. The next transformation begins.');};
$('rotate').classList.toggle('active',state.rotate);$('rotate').setAttribute('aria-pressed',state.rotate);$('rotate').setAttribute('aria-label',state.rotate?'Pause automatic rotation':'Start automatic rotation');
$('rotate').onclick=()=>{state.rotate=!state.rotate;controls.autoRotate=state.rotate;$('rotate').classList.toggle('active',state.rotate);$('rotate').setAttribute('aria-pressed',state.rotate);$('rotate').setAttribute('aria-label',state.rotate?'Pause automatic rotation':'Start automatic rotation');};
$('reset-view').onclick=()=>{controls.reset();controls.autoRotate=state.rotate;toast('View reset');};
let desiredExplode=0;
function setLayerView(value){desiredExplode=value;for(const [id,active] of [['surface-view',!value],['layers-view',!!value]]){$(id).classList.toggle('selected',active);$(id).setAttribute('aria-pressed',active);}}
$('surface-view').onclick=()=>setLayerView(0);$('layers-view').onclick=()=>setLayerView(1);
function syncColors(){
  $('picker-paint-color').value=currentColors.pink;
  for(const name of colorKeys)uniforms['u'+name[0].toUpperCase()+name.slice(1)].value.set(currentColors[name]);
  for(const [field,key]of Object.entries(colorFields)){
    $('color-'+field).value=currentColors[key];$('hex-'+field).textContent=currentColors[key].toUpperCase();
  }
}
function deriveColor(base,kind){
  const color=new THREE.Color(base);
  if(kind==='light')color.lerp(new THREE.Color('#fff2ba'),.27);
  if(kind==='gold')color.lerp(new THREE.Color('#b99a60'),.35);
  if(kind==='dark')color.multiplyScalar(.3);
  return '#'+color.getHexString();
}
for(const [field,key]of Object.entries(colorFields)){
  $('color-'+field).addEventListener('input',e=>{
    currentColors[key]=e.target.value;
    if(field==='paint')currentColors.pinkLight=deriveColor(e.target.value,'light');
    if(field==='undercoat')currentColors.tealLight=deriveColor(e.target.value,'light');
    if(field==='rust')currentColors.gold=deriveColor(e.target.value,'gold');
    if(field==='oxide')currentColors.dark=deriveColor(e.target.value,'dark');
    state.palette='custom';$('palette-name').textContent='Custom / individual';
    document.querySelectorAll('[data-palette]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
    syncColors();
  });
}
document.querySelectorAll('[data-palette]').forEach(b=>b.onclick=()=>{
  state.palette=b.dataset.palette;Object.assign(currentColors,paletteData[state.palette]);
  document.querySelectorAll('[data-palette]').forEach(other=>{const active=other===b;other.classList.toggle('selected',active);other.setAttribute('aria-pressed',active);});
  $('palette-name').textContent=currentColors.name;syncColors();
});

function updateMetalFinish(){
  const profile=metalPresets[state.metal];
  document.querySelectorAll('[data-metal]').forEach(button=>{const active=button.dataset.metal===state.metal;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  $('paint-toggle').classList.toggle('selected',state.painted);
  $('paint-enabled').checked=state.painted;
  uniforms.uPainted.value=Number(state.painted);
  uniforms.uPatina.value=profile.patina;
  uniforms.uPassivation.value=profile.passivation;
  uniforms.uMetalRoughness.value=profile.roughness;
  uniforms.uDepositRoughness.value=profile.depositRoughness;
  uniforms.uCorrosionRelief.value=profile.relief;
  state.flakeFactor=state.painted?1:profile.bareFlaking;
  $('metal-symbol').textContent=profile.symbol;
  $('metal-name').textContent=profile.name.toUpperCase();
  $('corrosion-label').textContent=profile.finish;
  for(const field of ['paint','undercoat'])$('color-'+field).disabled=!state.painted;
  $('scene').setAttribute('aria-label',`${state.painted?'Painted':'Bare'} ${profile.name.toLowerCase()} ${shapeNames[state.shape].toLowerCase()} developing ${profile.finish.toLowerCase()}. Tap the specimen to bounce. Drag loose flakes to move them; tap to remove. Drag elsewhere to orbit, scroll to zoom, or use the arrow keys.`);
  document.querySelector('[data-age="0"]').textContent=state.painted?'Fresh paint':'Fresh metal';
  $('restart').innerHTML='<svg><use href="#i-reset"></use></svg>'+(state.painted?'Repaint & restart':'Polish & restart');
}
function selectMetal(metal){
  state.metal=metal;
  Object.assign(currentColors,metalPresets[state.metal].colors);
  state.palette='custom';$('palette-name').textContent=metalPresets[state.metal].name+' / natural';
  document.querySelectorAll('[data-palette]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
  updateMetalFinish();syncColors();repaint(!reducedMotion);
}
document.querySelectorAll('[data-metal]').forEach(button=>button.addEventListener('click',()=>selectMetal(button.dataset.metal)));

function showPaintOptions(open){
  $('paint-options').hidden=!open;
  $('paint-toggle').setAttribute('aria-expanded',String(open));
}
$('paint-toggle').addEventListener('click',()=>showPaintOptions($('paint-options').hidden));
$('paint-enabled').addEventListener('change',event=>{
  state.painted=event.target.checked;
  updateMetalFinish();repaint(!reducedMotion);
});
$('picker-paint-color').addEventListener('input',event=>{
  if(!state.painted){state.painted=true;updateMetalFinish();repaint(!reducedMotion);}
  $('color-paint').value=event.target.value;
  $('color-paint').dispatchEvent(new Event('input'));
});
document.addEventListener('click',event=>{
  if(!$('paint-options').contains(event.target)&&!$('paint-toggle').contains(event.target))showPaintOptions(false);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('paint-options').hidden){showPaintOptions(false);$('paint-toggle').focus();}
});

function changeShape(shape){
  state.shape=shape;
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
  if(button.dataset.shape===state.shape)return;
  interactions.cancel();changeShape(button.dataset.shape);
  state.age=0;state.exploded=0;setLayerView(0);surface.rebuild();paintHold=2.6;
  updateMetalFinish();updateAgeUI();setPlaying(!reducedMotion);
  renderer.shadowMap.needsUpdate=true;renderDirty=true;
}));

$('random-shape').addEventListener('click',()=>$('new-specimen').click());

$('new-specimen').onclick=()=>{
  interactions.cancel();
  const previousSeed=state.seed;
  state.seed=Math.floor(Math.random()*90000)+10000;
  if(state.seed===previousSeed)state.seed=10000+(state.seed-9999)%90000;
  uniforms.uSeed.value=state.seed*.017;
  const shapes=Object.keys(shapeNames).filter(shape=>shape!==state.shape);
  changeShape(shapes[Math.floor(Math.random()*shapes.length)]);
  const metals=Object.keys(metalPresets).filter(metal=>metal!==state.metal);
  state.metal=metals[Math.floor(Math.random()*metals.length)];
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
  currentColors.pinkLight=deriveColor(currentColors.pink,'light');
  currentColors.tealLight=deriveColor(currentColors.teal,'light');
  currentColors.name=profile.name+' / randomized';
  state.palette='custom';$('palette-name').textContent=currentColors.name;
  document.querySelectorAll('[data-palette]').forEach(button=>{button.classList.remove('selected');button.setAttribute('aria-pressed','false');});
  state.age=0;state.exploded=0;setLayerView(0);
  updateMetalFinish();syncColors();surface.rebuild();paintHold=2.6;
  $('seed-value').textContent=`SEED ${state.seed}`;$('specimen-number').textContent=String(state.seed).slice(0,3);
  updateAgeUI();setPlaying(!reducedMotion);
  toast(`${state.painted?'Painted':'Bare'} ${profile.name.toLowerCase()} ${shapeNames[state.shape].toLowerCase()}. New colours, new pattern.`);
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
  if((geometryDirty&&time-lastGeometryTime>45)||(surface.pendingReleaseCount&&time-lastGeometryTime>100)){surface.updateAttached();lastGeometryTime=time;}
  // Physics continues independently of the aging timeline and playback speed.
  if(interactions.update(dt)){renderDirty=true;renderer.shadowMap.needsUpdate=true;}
  physics.step(dt);surface.syncPhysics();
  uiElapsed+=dt;if(uiElapsed>.15){if(state.age!==lastUIAge){updateAgeUI();lastUIAge=state.age;}uiElapsed=0;}
  const geometry=surface.mesh.geometry;
  // Camera orbit and shader-only aging do not change the light-space geometry.
  if(geometry!==lastShadowGeometry||geometry.attributes.position.version!==lastShadowVersion){
    renderer.shadowMap.needsUpdate=true;renderDirty=true;
    lastShadowGeometry=geometry;lastShadowVersion=geometry.attributes.position.version;
  }
  if(geometryDirty)renderDirty=true;
  controls.update(dt);
  if(renderDirty||firstFrame){renderer.render(scene,camera);renderDirty=false;}
  if(firstFrame){firstFrame=false;$('loading').classList.add('complete');setTimeout(()=>$('loading').remove(),700);}
}
requestAnimationFrame(animate);

function showSettings(open){
  $('settings-panel').hidden=!open;
  $('settings-toggle').setAttribute('aria-expanded',String(open));
  if(open)$('settings-close').focus();else $('settings-toggle').focus();
}
$('settings-toggle').addEventListener('click',()=>showSettings($('settings-panel').hidden));
$('settings-close').addEventListener('click',()=>showSettings(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('settings-panel').hidden)showSettings(false);});

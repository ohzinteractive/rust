import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelpGodrays}=await import('../kelp-godrays.js');
const {createKelpEnvironment}=await import('../kelp-environment.js');

function setup(failure){
  const viewport=new THREE.Vector4(3,4,800,600),scissor=new THREE.Vector4(8,9,400,300);
  let target=null,scissorTest=true,width=800,height=600;
  const passes=[];
  const renderer={
    extensions:{has:()=>true},capabilities:{maxSamples:4},outputColorSpace:THREE.SRGBColorSpace,autoClear:false,shadowMap:{type:THREE.PCFSoftShadowMap,needsUpdate:false},
    getDrawingBufferSize:v=>v.set(width,height),getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},
    getViewport:v=>v.copy(viewport),setViewport:v=>viewport.copy(v),
    getScissor:v=>v.copy(scissor),setScissor:v=>scissor.copy(v),
    getScissorTest:()=>scissorTest,setScissorTest:value=>{scissorTest=value;},
    render:scene=>{
      const m=scene.children[0].material;
      passes.push({name:m.name,target,ripples:m.uniforms.surfaceRipples?.value.map(v=>v.toArray()),history:m.uniforms.historyWeight?.value,shadow:m.uniforms.sunShadow?.value,enabled:m.uniforms.shadowEnabled?.value,scattering:m.uniforms.scatteringStrength?.value,bloom:m.uniforms.bloomStrength?.value});
      if(m.name===failure)throw Error('postprocess failed');
    },
  };
  const effect=createKelpGodrays(renderer),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,4/3,.1,120);
  camera.position.set(1,4,12);camera.lookAt(0,3,0);
  const fog=scene.fog=new THREE.FogExp2(0x104c5e,.062),sun=new THREE.DirectionalLight(0xffedb0,5);
  sun.castShadow=true;sun.position.set(-5,12,4);
  const draw=()=>{
    assert.equal(scene.fog,null);assert.equal(target.width,width);assert.equal(target.height,height);
    assert(target.depthTexture);assert.equal(renderer.autoClear,true);assert.equal(scissorTest,false);
    if(failure==='scene')throw Error('scene draw failed');
    sun.shadow.map??=new THREE.WebGLRenderTarget(128,128);
  };
  return {renderer,effect,camera,passes,sun,
    resize(w,h){width=w;height=h;},
    render(time=1,focus,settings={}){effect.render(scene,camera,draw,{top:9.5,bottom:-1.75,time,sun,focus,...settings});},
    checkRestored(){
      assert.equal(scene.fog,fog);assert.equal(target,null);assert.equal(renderer.autoClear,false);assert.equal(scissorTest,true);
      assert.deepEqual(viewport.toArray(),[3,4,800,600]);assert.deepEqual(scissor.toArray(),[8,9,400,300]);
    },dispose(){effect.dispose();sun.shadow.map?.dispose();},
  };
}

for(const failure of [null,'scene','Shadowed participating water','Restrained HDR sunlight bloom','Underwater absorption and scattering composite']){
  test(`volumetric pipeline restores renderer state${failure?' after '+failure+' fails':''}`,()=>{
    const sim=setup(failure);
    if(failure)assert.throws(()=>sim.render(),/failed/);else{
      sim.render();assert.equal(sim.passes.length,4);
      assert.deepEqual(sim.passes.map(p=>p.target?[p.target.width,p.target.height]:null),[[400,300],[200,150],[200,150],null]);
      assert.equal(sim.passes[0].enabled,1);assert.equal(sim.passes[0].shadow,sim.sun.shadow.map.texture,'Binds the shadow texture after the scene creates it');
    }
    sim.checkRestored();sim.dispose();
  });
}

test('history reprojects slow camera motion and resets on cuts, resize, scene reentry and paused frames',()=>{
  const sim=setup(),last=()=>sim.passes.filter(p=>p.name==='Shadowed participating water').at(-1);
  sim.render(1);assert.equal(last().history,0);
  sim.render(1.05);assert(last().history>0);
  sim.camera.position.x+=.1;sim.render(1.1);assert(last().history>0&&last().history<.45,'A slow pan reprojects a conservative amount of history');
  sim.camera.position.x+=1;sim.render(1.12);assert.equal(last().history,0,'A camera cut rejects history');
  sim.render(1.15);assert(last().history>0);
  sim.render(1.15);assert.equal(last().history,0,'Paused redraws use a stable spatial sample');
  sim.resize(801,603);sim.render(1.2);assert.equal(last().history,0);assert.equal(last().target.width,401);assert.equal(last().target.height,302);
  sim.effect.resetHistory();sim.render(1.25);assert.equal(last().history,0);
  sim.render(1.3,new THREE.Vector3(0,0,1.3));assert.equal(last().history,0,'A new sculpture focus cannot reuse the old light column');
  sim.render(1.35,new THREE.Vector3(0,0,1.3));assert(last().history>0);
  sim.checkRestored();sim.dispose();
});

test('direct-only inspection restores indirect lighting after failure and restores shadow filtering on scene exit',()=>{
  const sim=setup(),scene=new THREE.Scene();scene.environmentIntensity=.4;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial());ground.position.y=-1.75;
  const shadow=new THREE.Object3D(),key=new THREE.DirectionalLight(),rim=new THREE.DirectionalLight(),fill=new THREE.DirectionalLight(),skyLight=new THREE.HemisphereLight();
  const water=createKelpEnvironment({renderer:sim.renderer,scene,ground,shadow,key,rim,fill,skyLight});
  const originalNormalBias=key.shadow.normalBias;
  water.setEnabled(true);assert.equal(key.shadow.normalBias,.04);
  water.setLightingSettings({sunlight:2,ambient:.5,shadows:.25});
  const originalKey=key.intensity,originalShadow=key.shadow.intensity;
  const ambientBefore=[rim.intensity,fill.intensity,skyLight.intensity,scene.environmentIntensity];
  assert.throws(()=>water.render(sim.camera,()=>{
    assert.equal(key.intensity,18);assert.equal(key.shadow.intensity,.25);
    assert.deepEqual([rim.intensity,fill.intensity,skyLight.intensity,scene.environmentIntensity],ambientBefore.map(v=>v*.5));
    throw Error('balanced draw failed');
  }),/balanced draw failed/);
  assert.equal(key.intensity,originalKey);assert.equal(key.shadow.intensity,originalShadow);
  assert.deepEqual([rim.intensity,fill.intensity,skyLight.intensity,scene.environmentIntensity],ambientBefore);
  water.setLightingView('direct');
  const before=[rim.intensity,fill.intensity,skyLight.intensity,scene.environmentIntensity];
  assert.equal(sim.renderer.shadowMap.type,THREE.PCFShadowMap);
  assert.throws(()=>water.render(sim.camera,()=>{
    assert.equal(rim.intensity,0);assert.equal(fill.intensity,0);assert.equal(skyLight.intensity,0);assert.equal(scene.environmentIntensity,0);
    assert.equal(key.intensity,18);throw Error('diagnostic draw failed');
  }),/diagnostic draw failed/);
  assert.deepEqual([rim.intensity,fill.intensity,skyLight.intensity,scene.environmentIntensity],before);
  water.setLightingSettings({sunlight:-1,ambient:99,scattering:0,bloom:NaN,shadows:2});
  assert.deepEqual(water.lightingSettings,{sunlight:0,ambient:3,scattering:0,bloom:2.96,shadows:1});
  water.resetLighting();assert.deepEqual(water.lightingSettings,{sunlight:1.72,ambient:.16,scattering:2.81,shadows:.96,bloom:2.96});
  sim.checkRestored();water.setEnabled(false);assert.equal(sim.renderer.shadowMap.type,THREE.PCFSoftShadowMap);assert.equal(scene.environmentIntensity,.4);assert.equal(key.shadow.normalBias,originalNormalBias);
  water.dispose();ground.geometry.dispose();ground.material.dispose();sim.dispose();
});


test('water scattering and bloom strengths reach the rendering passes without stale history',()=>{
  const sim=setup();sim.render(1);
  sim.effect.resetHistory();sim.render(1.05,undefined,{scatteringStrength:0,bloomStrength:2});
  const volume=sim.passes.filter(p=>p.name==='Shadowed participating water').at(-1);
  const composite=sim.passes.at(-1);
  assert.equal(volume.scattering,0);assert.equal(volume.history,0);assert.equal(composite.bloom,2);
  sim.checkRestored();sim.dispose();
});


test('a zero-size frame cannot present an uninitialized volumetric buffer',()=>{
  const sim=setup();sim.render(1);const before=sim.passes.length;
  sim.resize(0,0);sim.render(1.05);assert.equal(sim.passes.length,before);sim.checkRestored();
  sim.resize(800,600);sim.render(1.1);assert.equal(sim.passes.filter(p=>p.name==='Shadowed participating water').at(-1).history,0);
  sim.dispose();
});


test('surface ripples start empty, respond only to near-surface fish, and clear on time reset',()=>{
  const sim=setup(),scene=new THREE.Scene();
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial());ground.position.y=-1.75;
  const shadow=new THREE.Object3D(),key=new THREE.DirectionalLight(),rim=new THREE.DirectionalLight(),fill=new THREE.DirectionalLight(),skyLight=new THREE.HemisphereLight();
  let depth=2;
  const fish={group:{visible:true},settings:{count:1},stats:{count:1},inspectFish:()=>({position:[1,water.surfaceY-depth,2],velocity:[.5,0,0]})};
  const water=createKelpEnvironment({renderer:sim.renderer,scene,ground,shadow,key,rim,fill,skyLight,fish});water.setEnabled(true);
  const ripples=()=>sim.passes.at(-1).ripples;
  water.render(sim.camera,()=>{},0);assert(ripples().every(r=>r[3]===0),'Deep fish do not disturb the surface');
  depth=.1;water.render(sim.camera,()=>{},.7);
  assert.equal(ripples().filter(r=>r[3]>0).length,1);assert.deepEqual(ripples()[0].slice(0,3),[1,2,.7]);
  assert(ripples()[0][3]<.007,'Surface disturbances remain small');
  water.render(sim.camera,()=>{},.8);assert.equal(ripples().filter(r=>r[3]>0).length,1,'Emission is rate limited');
  depth=2;water.render(sim.camera,()=>{},0);assert(ripples().every(r=>r[3]===0));
  water.dispose();ground.geometry.dispose();ground.material.dispose();sim.dispose();
});

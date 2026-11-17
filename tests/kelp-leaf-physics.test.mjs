import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelpLeafPhysics}=await import('../kelp-leaf-physics.js');

test('crossing leaves separate along their ribs while their float attachments remain pinned',()=>{
  const blades=Array.from({length:2},()=>({health:1,widths:Array(33).fill(.065)}));
  let time=0;
  const sample=(leaf,t,out)=>leaf===0?out.set(t*2-1,Math.sin(time)*t*.1,0):out.set(0,Math.sin(time+.3)*t*.1,t*2-1);
  const sim=createKelpLeafPhysics({blades,sample});
  for(let i=0;i<120;i++){time+=1/60;sim.solve(1/60,5);}
  const report=sim.diagnostics();
  assert(report.maxPenetration<.025,JSON.stringify(report));
  for(let leaf=0;leaf<2;leaf++){
    assert(sim.inspect(leaf,0).distanceTo(sample(leaf,0,new THREE.Vector3()))<1e-9);
    for(let row=0;row<=8;row++)assert(sim.inspect(leaf,row).toArray().every(Number.isFinite));
  }
  assert(sim.inspect(0,4).distanceTo(sim.inspect(1,4))>.018,'The blades yield rather than passing through at their crossing');
  const offset=sim.offset(0,.5,new THREE.Vector3());
  assert(sim.inspect(0,4).distanceTo(sample(0,.5,new THREE.Vector3()).add(offset))<1e-6,'Rendered texture offsets match the simulated rib');
  const before=offset.length();blades[1].health=0;
  for(let i=0;i<300;i++)sim.solve(1/60,5);
  assert(sim.offset(0,.5,new THREE.Vector3()).length()<before*.2,'Released leaves ease back to their natural shape');
  sim.dispose();
});

test('a bite removes the eaten section from collision constraints',()=>{
  const blades=Array.from({length:2},()=>({health:1,widths:Array(33).fill(.05)}));
  const sample=(leaf,t,out)=>leaf===0?out.set(t*2,0,0):out.set(1.6,0,t*2-1);
  const sim=createKelpLeafPhysics({blades,sample});
  assert(sim.offset(0,.8,new THREE.Vector3()).length()>.005);
  blades[0].health=.3;
  for(let i=0;i<240;i++)sim.solve(1/60,4);
  assert.equal(sim.diagnostics().contacts,0);sim.dispose();
});

test('contact corrections move continuously between solver ticks without tip snaps',()=>{
  const blades=Array.from({length:2},()=>({health:1,widths:Array(33).fill(.065)}));
  let time=0;
  const sample=(leaf,t,out)=>leaf===0?out.set(t*2-1,Math.sin(time)*t*.12,0):out.set(0,Math.sin(time+.4)*t*.12,t*2-1);
  const sim=createKelpLeafPhysics({blades,sample}),before=sim.texture.image.data.slice();
  let halfFrameChanges=0,maxJump=0;
  for(let frame=0;frame<120;frame++){
    time=frame/60;
    if(frame%2===0)sim.solve(1/30,5,true);
    sim.interpolate(frame%2===0?0:.5);
    const data=sim.texture.image.data;let changed=false;
    for(let i=0;i<data.length;i+=4){
      const distance=Math.hypot(data[i]-before[i],data[i+1]-before[i+1],data[i+2]-before[i+2]);
      maxJump=Math.max(maxJump,distance);if(distance>1e-6)changed=true;
    }
    if(frame%2&&changed)halfFrameChanges++;
    before.set(data);
    assert(Math.hypot(...data.slice(0,3))<1e-9,'The float attachment stays fixed');
  }
  assert(halfFrameChanges>20,'Display frames move between the lower-frequency simulation updates');
  assert(maxJump<.012,'Contact response cannot teleport the tip between display frames: '+maxJump);
  sim.dispose();
});


test('fish targets sample the same contact offsets as the rendered and shadowed leaf',async()=>{
  const {createKelp}=await import('../kelp.js');
  const kelp=createKelp({scene:new THREE.Scene()});kelp.rebuild({strands:4,current:.8});kelp.group.visible=true;
  kelp.advance(.1);kelp.bite(0,.465);
  const target=kelp.getBladeTarget(0,new THREE.Vector3()),rib=kelp.getLeafPhysics().inspect(0,4,true);
  rib.y=Math.min(rib.y,kelp.group.position.y+kelp.settings.height+.2);
  assert(target.distanceTo(rib)<1e-6);kelp.dispose();
});

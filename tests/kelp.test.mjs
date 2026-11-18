import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createKelp}=await import('../kelp.js');
const {createKelpEnvironment}=await import('../kelp-environment.js');
const {kelpSunSlope}=await import('../kelp-lighting.js');

test('kelp branches have paired blades and floats, stable seeds and bounded mesh batches',()=>{
  const scene=new THREE.Scene(),kelp=createKelp({scene});kelp.rebuild({strands:4,generations:2});
  assert(kelp.stats.blades>32&&kelp.stats.blades<64);assert.equal(kelp.stats.floats,kelp.stats.blades);assert.equal(kelp.group.children.length,4);
  const blade=kelp.group.children[1],original=blade.geometry.attributes.position.array.slice();
  for(const mesh of kelp.group.children){
    assert(mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert(mesh.geometry.attributes.normal.array.every(Number.isFinite));
    if(!mesh.isInstancedMesh){assert.equal(mesh.geometry.attributes.kelpInfo.count,mesh.geometry.attributes.position.count);assert.equal(mesh.geometry.attributes.kelpRoot.count,mesh.geometry.attributes.position.count);}
  }
  kelp.group.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(kelp.group);
  assert(box.min.y>=-2.2&&box.min.y< -1.75,'Support stones are partially buried in the seabed');assert(box.max.y>3);
  let geometries=0,materials=0;
  kelp.group.children.forEach(mesh=>{mesh.geometry.addEventListener('dispose',()=>geometries++);mesh.material.addEventListener('dispose',()=>materials++);});
  kelp.rebuild();assert.equal(geometries,4);assert.equal(materials,4);assert.deepEqual(kelp.group.children[1].geometry.attributes.position.array,original);
  kelp.rebuild({seed:20});assert.notDeepEqual(kelp.group.children[1].geometry.attributes.position.array,original);
  kelp.rebuild({strands:100,generations:10});assert.equal(kelp.stats.strands,48);assert(kelp.stats.blades>48*48*.45&&kelp.stats.blades<48*48*.9);
  assert(kelp.stats.triangles<1600000,'Maximum settings remain bounded');assert.equal(kelp.group.children.length,4);
  kelp.dispose();assert.equal(scene.children.length,0);
});

test('current animation shares deformation with shadows and leaves CPU geometry unchanged',()=>{
  const kelp=createKelp({scene:new THREE.Scene()});kelp.rebuild({strands:4});
  assert.equal(kelp.advance(.1),false);kelp.group.visible=true;
  const mesh=kelp.group.children[1],geometry=mesh.geometry,positions=geometry.attributes.position.array.slice(),root=kelp.group.position.clone();
  const shader=()=>({uniforms:{},vertexShader:'#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',fragmentShader:'#include <color_fragment>'});
  const visible=shader(),depth=shader();mesh.material.onBeforeCompile(visible);mesh.customDepthMaterial.onBeforeCompile(depth);
  assert.equal(visible.uniforms.kelpLeafMotion,depth.uniforms.kelpLeafMotion);
  assert(visible.vertexShader.includes('kelpMove(position)+kelpContactOffset()'));assert(depth.vertexShader.includes('kelpMove(position)+kelpContactOffset()'));
  assert.equal(visible.uniforms.kelpTime,depth.uniforms.kelpTime);assert.equal(visible.uniforms.kelpCurrent,depth.uniforms.kelpCurrent);
  kelp.setCurrent(.8,90);assert(Math.abs(visible.uniforms.kelpDirection.value.x)<1e-6);assert.equal(visible.uniforms.kelpDirection.value.y,1);
  for(let i=0;i<60;i++)assert(kelp.advance(1/60));
  assert(kelp.elapsed>.99);assert.equal(mesh.geometry,geometry);assert.deepEqual(geometry.attributes.position.array,positions);assert.deepEqual(kelp.group.position,root);
  kelp.setPlaying(false);const elapsed=kelp.elapsed;assert.equal(kelp.advance(.1),false);assert.equal(kelp.elapsed,elapsed);
  kelp.dispose();
});

test('every stipe meets a stone surface and stays anchored in a strong current',()=>{
  const kelp=createKelp({scene:new THREE.Scene()}),ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),point=new THREE.Vector3();
  for(const seed of [7319,7420]){
    kelp.rebuild({seed,strands:48,current:1});kelp.group.visible=true;kelp.group.updateMatrixWorld(true);
    const stones=kelp.group.getObjectByName('Kelp support stones'),bases=Array.from({length:48},(_,i)=>kelp.getStemBase(i,new THREE.Vector3()));
    assert(stones.isInstancedMesh&&stones.count>0&&stones.count<=48);
    for(const base of bases){
      ray.set(base.clone().add(new THREE.Vector3(0,3,0)),down);
      const hit=ray.intersectObject(stones,false)[0];assert(hit,'A rendered stone supports every stipe');
      assert(Math.abs(base.y-hit.point.y-.012)<1e-5,'The stipe meets the stone rather than starting on sand or inside another boulder');
    }
    const stipes=kelp.group.children[0].geometry,position=stipes.attributes.position,anchors=stipes.attributes.kelpRoot;
    let pinned=0;for(let i=0;i<position.count;i++)if(anchors.getX(i)>kelp.settings.height){assert(position.getY(i)<anchors.getX(i));pinned++;}
    assert(pinned>48*500,'Branching holdfast geometry stays below its fixed deformation anchor');
    const before=kelp.getObstacles().capsules[0].a.clone();
    for(let frame=0;frame<50;frame++){
      kelp.advance(.1);
      bases.forEach((base,i)=>{assert(kelp.getStemPosition(i,base.y,point));assert(point.distanceTo(base)<1e-7);});
    }
    assert(kelp.getObstacles().capsules[0].a.distanceTo(before)<1e-7,'The fish collision guide stays attached too');
  }
  kelp.dispose();
});

test('stipes have a broad continuous bend independent of the spiral node spacing',()=>{
  const kelp=createKelp({scene:new THREE.Scene()});
  kelp.rebuild({strands:4,generations:2,current:0,height:7});
  const sample=()=>{const root=kelp.getStemBase(0,new THREE.Vector3());return Array.from({length:65},(_,i)=>kelp.getStemPosition(0,root.y+(-1.75+7-root.y)*i/64,new THREE.Vector3()));};
  const points=sample(),chord=new THREE.Line3(points[0],points.at(-1)),closest=new THREE.Vector3();
  const deviation=Math.max(...points.map(p=>p.distanceTo(chord.closestPointToPoint(p,true,closest))));
  assert(deviation>.08&&deviation<.4,'The stem has a gentle visible curve, even in still water');
  let largestTurn=0;
  for(let i=1;i<points.length-1;i++){
    const before=points[i].clone().sub(points[i-1]),after=points[i+1].clone().sub(points[i]);
    largestTurn=Math.max(largestTurn,before.angleTo(after));
    assert(points[i].y>points[i-1].y);
  }
  assert(largestTurn<.04,'Adjacent sections follow a smooth tangent without node kinks');
  kelp.rebuild({strands:4,generations:6,current:0});assert.deepEqual(sample(),points,'Changing leaf density does not add bends to the stem');
  kelp.dispose();
});

test('long blades bend with the current direction and stay still in calm water',()=>{
  const kelp=createKelp({scene:new THREE.Scene()});kelp.rebuild({strands:4,current:0});kelp.group.visible=true;
  const target=()=>kelp.getBladeTarget(0,new THREE.Vector3());
  const calm=target(),positions=kelp.group.children[1].geometry.attributes.position;
  const base=new THREE.Vector3().fromBufferAttribute(positions,0).add(kelp.group.position);
  assert(calm.distanceTo(base)>1.7,'The first blade extends well beyond its float');
  assert(calm.y-base.y>1.1,'The blade curves upward toward the surface');
  for(let i=0;i<20;i++)kelp.advance(.1);
  assert.deepEqual(target(),calm,'No flutter when the current is zero');
  kelp.setCurrent(1,0);const east=target();
  kelp.setCurrent(1,180);const west=target();
  assert(east.x-calm.x>.3&&calm.x-west.x>.3,'Leaf tips follow the selected current direction');
  assert(Math.abs((east.x+west.x)/2-calm.x)<1e-8);
  for(let i=0;i<20;i++)kelp.advance(.1);
  assert(target().distanceTo(west)>.1,'Flowing water also produces visible flutter');
  kelp.dispose();
});

test('underwater mode restores the existing lighting, ground, fog and shadows',()=>{
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x141613);scene.fog=new THREE.FogExp2(0x141613,.032);scene.environmentIntensity=.4;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial()),shadow=new THREE.Mesh();ground.position.y=-1.75;
  const key=new THREE.DirectionalLight(0xffeedd,3),rim=new THREE.DirectionalLight(0xbbffee,1),fill=new THREE.DirectionalLight(0xffeebb,.3),skyLight=new THREE.HemisphereLight(0xeeeeff,0x221100,1);
  key.position.set(-3,6,4);
  key.target.position.set(.2,.3,-.7);
  const original={background:scene.background,fog:scene.fog,material:ground.material,geometry:ground.geometry,keyColor:key.color.clone(),keyPosition:key.position.clone(),keyTarget:key.target.position.clone(),groundColor:skyLight.groundColor.clone(),left:key.shadow.camera.left};
  const water=createKelpEnvironment({scene,ground,shadow,key,rim,fill,skyLight});
  for(let i=0;i<3;i++){
    water.setEnabled(true);water.setEnabled(true);water.setHeight(11);water.advance(.1);
    assert.equal(water.surfaceY,ground.position.y+11.25);
    assert(water.enabled&&water.group.visible);assert.equal(shadow.visible,false);assert.notEqual(ground.material,original.material);assert.notEqual(ground.geometry,original.geometry);
    assert(key.position.clone().sub(key.target.position).normalize().distanceTo(new THREE.Vector3(kelpSunSlope.x,1,kelpSunSlope.z).normalize())<1e-8,'Surface light and volume share the same sun direction at every height');
    water.setEnabled(false);water.setEnabled(false);
    assert.equal(scene.background,original.background);assert.equal(scene.fog,original.fog);assert.equal(ground.material,original.material);assert.equal(ground.geometry,original.geometry);
    assert.deepEqual(key.color,original.keyColor);assert.deepEqual(key.position,original.keyPosition);assert.deepEqual(skyLight.groundColor,original.groundColor);
    assert.deepEqual(key.target.position,original.keyTarget,'Studio light target is restored');
    assert.equal(key.shadow.camera.left,original.left);assert.equal(shadow.visible,true);assert.equal(scene.environmentIntensity,.4);
  }
  water.dispose();assert.equal(scene.children.length,0);ground.geometry.dispose();ground.material.dispose();shadow.geometry.dispose();shadow.material.dispose();
});

test('mature kelp reaches the surface while young plants remain below the canopy',()=>{
  const kelp=createKelp({scene:new THREE.Scene()});
  for(const height of [3,7,11]){
    kelp.rebuild({height,strands:8});
    const point=new THREE.Vector3();let canopy=0,understory=0;
    for(let i=0;i<8;i++){
      if(kelp.getStemPosition(i,-1.75+height+.09,point))canopy++;else understory++;
      const base=kelp.getStemBase(i,new THREE.Vector3());
      assert(kelp.getStemPosition(i,base.y+.05,point),'Every plant retains a continuous anchored stipe');
    }
    assert(canopy>=3&&understory>=2,'Tall canopy plants mix with smaller understory plants');
    assert.equal(kelp.getStemPosition(4,-1.75+height*.6,point),null,'Young kelp remains below the main canopy');
    const positions=kelp.group.children[1].geometry.attributes.position;
    for(let i=0;i<positions.count;i++)assert(positions.getY(i)<=height+.201,'Blades remain below the waterline');
  }
  kelp.dispose();
});

test('thin-leaf transmission follows the current sun shadow map and scattering control',()=>{
  const sun=new THREE.DirectionalLight(0xffddaa,9);sun.castShadow=true;
  const kelp=createKelp({scene:new THREE.Scene(),sun});kelp.rebuild({strands:4,generations:2});
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  kelp.group.children[1].material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.shadowEnabled.value,0);
  sun.shadow.map=new THREE.WebGLRenderTarget(128,64);kelp.updateSunlight();
  assert.equal(shader.uniforms.shadowEnabled.value,1);assert.equal(shader.uniforms.sunShadow.value,sun.shadow.map.texture);
  assert.equal(shader.uniforms.sunShadowMatrix.value,sun.shadow.matrix);assert.deepEqual(shader.uniforms.sunTexel.value.toArray(),[1/128,1/64]);
  sun.shadow.map.setSize(256,128);sun.intensity=4;sun.color.setRGB(.7,.8,1);kelp.updateSunlight();
  assert.deepEqual(shader.uniforms.sunTexel.value.toArray(),[1/256,1/128]);assert.deepEqual(shader.uniforms.sunRadiance.value.toArray(),[.7*4,.8*4,4]);
  kelp.setScattering(0);assert.equal(shader.uniforms.kelpSubsurface.value,0);
  kelp.setScattering(.6);assert.equal(shader.uniforms.kelpSubsurface.value,.6);
  kelp.dispose();sun.shadow.map.dispose();
});


test('the viewing corridor bends flexible blade tips while keeping stipes anchored',()=>{
  const kelp=createKelp({scene:new THREE.Scene()});kelp.rebuild({strands:4,current:0});kelp.group.visible=true;
  const before=kelp.getBladeTarget(0,new THREE.Vector3()),root=kelp.getStemBase(0,new THREE.Vector3()),source=kelp.getObstacles(),version=source.version;
  const subject={active:true,center:before.clone(),orbitRadius:1};
  const camera=before.clone().add(new THREE.Vector3(0,.2,8));
  for(let i=0;i<60;i++)kelp.setViewingCorridor(camera,subject,1/30);
  assert(kelp.getBladeTarget(0,new THREE.Vector3()).distanceTo(before)>.03,'Blades yield gently away from the subject viewing corridor');
  assert(kelp.getStemBase(0,new THREE.Vector3()).distanceTo(root)<1e-9);
  assert(kelp.getObstacles().version>version,'Fish collision guides follow the view-dependent bend');
  for(let i=0;i<120;i++)kelp.setViewingCorridor(camera,null,1/30);
  assert(kelp.getBladeTarget(0,new THREE.Vector3()).distanceTo(before)<.001,'Removing the sculpture releases the corridor smoothly');
  kelp.dispose();
});

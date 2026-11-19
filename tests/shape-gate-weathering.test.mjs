import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const T=await import('../vendor/three.module.js');
const {createGateFloor}=await import('../shape-gate-base.js');
const {refineStoneGeometry,createReclaimingPalms,tileRootPressure}=await import('../shape-gate-weathering.js');

test('tiles pitch upward toward a palm on either side of each seam',()=>{
 const trunk={x:1,z:2};
 for(const dx of [-.4,.4])for(const dy of [-.4,.4]){
  const pressure=tileRootPressure(trunk.x+dx,-trunk.z+dy,[trunk]);
  assert(pressure.y*-dx>0,'The edge closer to the trunk rises across X');
  assert(pressure.z*-dy>0,'The edge closer to the trunk rises across the floor depth');
 }
});

test('physical checker tiles leave the wheel well open and carry local root pressure',()=>{
 const age={value:1};
 const stage=createGateFloor({includeGround:false,age});
 stage.advance(0,4);
 const ferns=stage.floor.getObjectByName('Ferns growing in marble joints');
 assert(ferns.visible&&ferns.count>=6);
 const life=ferns.geometry.attributes.fernLife;
 const births=Array.from({length:life.count},(_,i)=>life.getX(i));
 assert(births.some(birth=>birth>130),'New fern cohorts arise after the marble finishes weathering');
 stage.advance(0,0);
 const initial=Array.from({length:life.count},(_,i)=>life.getX(i));
 assert(initial.some(birth=>birth>130)&&initial.some(birth=>birth===0),'Different gaps fill in at different times');
 stage.advance(0,4);
 assert.deepEqual(Array.from({length:life.count},(_,i)=>life.getX(i)),births,'Scrubbing restores the same fern cohorts');
 const matrix=new T.Matrix4();
 for(let i=0;i<ferns.count;i++){
  ferns.getMatrixAt(i,matrix);
  const reach=1.32*1.3*Math.hypot(...matrix.elements.slice(0,3));
  assert(Math.abs(matrix.elements[12])-reach>1.35,'The mature fronds leave the swing lane clear');
  assert(Math.abs(matrix.elements[14])-reach>.24,'The mature fronds leave the wheel faces clear');
 }
 const tiles=stage.floor.getObjectByName('Polished marble tiles');
 const sand=stage.floor.getObjectByName('Sand filling lifted marble gaps');
 const braces=tiles.getObjectByName('Palm roots bracing the raised slabs');
 assert(braces.geometry.attributes.rootTip.count>0,'Raised slabs have visible supports from the palms');
 assert.equal(braces.geometry.attributes.rootTip.count,braces.geometry.attributes.tileSupport.count);
 stage.floor.updateMatrixWorld(true);
 const ray=new T.Raycaster(new T.Vector3(0,1,0),new T.Vector3(0,-1,0));
 assert.equal(ray.intersectObject(tiles).length,0,'No tile covers the wheel well');
 assert.equal(ray.intersectObject(sand).length,0,'Sand leaves the moving wheel well open');
 const shader={uniforms:{},vertexShader:'',fragmentShader:''};tiles.material.onBeforeCompile(shader);
 const {floorTileOrigin:{value:origin},floorTileSize:{value:size}}=shader.uniforms;
 const seamRay=new T.Raycaster(new T.Vector3(size.x-origin.x,1,origin.y-size.y*.5),new T.Vector3(0,-1,0));
 assert.equal(seamRay.intersectObject(tiles).length,0,'A joint is open between the marble tiles');
 const undersideRay=new T.Raycaster(new T.Vector3(size.x*.37-origin.x,-.3,origin.y-size.y*.43),new T.Vector3(0,1,0));
 const underside=undersideRay.intersectObject(tiles,false)[0];
 assert(underside,'A raised slab has an outward-facing marble underside');
 assert(Math.abs(underside.point.y+.1)<1e-6,'The underside closes the slab at its original thickness');
 const sandHits=seamRay.intersectObject(sand);
 assert(sandHits.length>0,'The same open joint has solid sand underneath');
 assert(Math.abs(sandHits[0].point.y+.087)<1e-6,'Sand reaches just below the marble body');
 const roots=stage.floor.getObjectByName('Pink and white crack flowers').geometry.attributes.flowerRoot;
 for(let i=0;i<roots.count;i+=Math.ceil(roots.count/100)){
  assert(roots.getY(i)<-.07,'Plant roots start inside the sand');
  const u=(roots.getX(i)+origin.x)/size.x,v=(-roots.getZ(i)+origin.y)/size.y;
  assert(Math.min(Math.abs(u-Math.round(u))*size.x,Math.abs(v-Math.round(v))*size.y)<.0011,'Plants emerge through the narrow joints');
 }
 const p=tiles.geometry.attributes.position,pressure=tiles.geometry.attributes.tilePressure;
 assert(p.array.every(Number.isFinite));
 assert(pressure.array.every(Number.isFinite));
 let min=Infinity,max=0;
 for(let i=0;i<pressure.count;i++){min=Math.min(min,pressure.getX(i));max=Math.max(max,pressure.getX(i));}
 assert(max>.1,'Tiles near roots lift visibly');
 assert(min<.001,'Distant tiles retain their original level');
 const heave=shader.uniforms.rootHeave;
 stage.advance(0,0);
 assert.equal(heave.value,0,'Extra tilt waits for the palms to mature');
 stage.advance(0,1);
 const earlyHeave=heave.value;
 stage.advance(0,600/110-1);
 assert(heave.value>earlyHeave,'Slabs keep tilting after the marble finishes weathering');
 let steepest=0;
 for(let i=0;i<pressure.count;i++){
  const influence=T.MathUtils.smoothstep(pressure.getX(i),.045,.128);
  const slope=Math.hypot(pressure.getY(i),pressure.getZ(i))*(1+heave.value*influence);
  steepest=Math.max(steepest,slope);
 }
 assert(steepest>1,'The strongest local slope exceeds 45 degrees');
 stage.advance(0,0);
 assert.equal(heave.value,0,'Rewinding removes the late heave');
 for(const border of [2,0]){
  stage.resize(border);stage.floor.updateMatrixWorld(true);
  assert.equal(ray.intersectObject(tiles).length,0,'Expansion retains the opening');
  assert.equal(ray.intersectObject(sand).length,0,'Expansion retains the opening in the sand');
  assert.equal(tiles.geometry.attributes.tilePressure.count,tiles.geometry.attributes.position.count);
 }
});

test('stone refinement retains the seal contour and creates finite unit normals',()=>{
 const shape=new T.Shape([new T.Vector2(-1,-1),new T.Vector2(1,-1),new T.Vector2(1,1),new T.Vector2(-1,1)]);
 const geometry=refineStoneGeometry(new T.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:false}),.15);
 assert.equal(geometry.parameters.shapes,shape);
 const p=geometry.attributes.position,n=geometry.attributes.normal;
 assert(p.array.every(Number.isFinite));
 for(let i=0;i<p.count;i+=3){
  const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,i+j));
  for(let j=0;j<3;j++)assert(vertices[j].distanceTo(vertices[(j+1)%3])<=.150001);
 }
 for(let i=0;i<n.count;i++)assert(Math.abs(new T.Vector3().fromBufferAttribute(n,i).length()-1)<1e-5);
});

test('palm age can be scrubbed backward without accumulating growth',()=>{
 const parent=new T.Group(),age={value:0};
 const reclaim=createReclaimingPalms(parent,[{x:1,z:1,phase:0}],age);
 const growth=reclaim.group.children[0].children.find(c=>c.children.some(p=>p.name==='Feather palm'));
 const original=growth.scale.clone();
 const crown=[],dryFronds=[];
 growth.traverse(object=>{
  if(object.name==='Green palm frond')crown.push(object);
  if(object.name==='Dry palm frond')dryFronds.push(object);
 });
 assert(growth.getObjectByName('Palm seed'));
 age.value=.36;reclaim.advance(0);
 const juvenile=crown.filter(frond=>frond.visible).length;
 assert(juvenile>0&&juvenile<crown.length);
 age.value=1;reclaim.advance(0);
 const heart=growth.getObjectByName('Palm growing heart');
 const weatheredHeight=heart.position.y;
 reclaim.advance(0,4);
 assert.equal(growth.scale.y,1);
 assert(heart.position.y>weatheredHeight&&crown.every(frond=>frond.visible));
 assert(dryFronds.length>0&&dryFronds.every(frond=>!frond.visible),'All shed fronds finish falling before the timeline stops');
 reclaim.advance(0);
 assert.equal(heart.position.y,weatheredHeight);
 age.value=0;reclaim.advance(0);assert.deepEqual(growth.scale,original);
});

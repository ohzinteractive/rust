import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE = await import('../vendor/three.module.js');
const {createSurfaceSampler, readFeatherAnchor} = await import('../feather-sampling.js');
const {seededRandom} = await import('../plume-lsystem/random.js');
const {createFeatherSurface:createDefaultFeatherSurface} = await import('../feather-surface.js');
const {generateFeatherData, rewriteFeatherGrammar} = await import('../plume-lsystem/feather-generator.js');
const {plumageFrame,createContourVane} = await import('../plumage-frame.js');

// Keep geometry regression fixtures independent of the viewer's chosen preset.
function createFeatherSurface() {
  const effect=createDefaultFeatherSurface();
  effect.setSettings({style:'layered',length:1,width:1,detail:.38,angle:26,shadow:.35});
  return effect;
}

function fixture(geometry = new THREE.SphereGeometry(1, 32, 24)) {
  const parent = new THREE.Group(), mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  parent.add(mesh); parent.updateMatrixWorld(true);
  return {parent, mesh};
}

test('maze scale shrinks feathers and follicles, while viewport batches retain stable roots and only draw visible instances',()=>{
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  effect.rebuild([mesh],parent,100,71);
  const baseline=effect.group.children.find(batch=>batch.isLineSegments).geometry.attributes.featherScale.getX(0);
  const before=new THREE.Matrix4();effect.follicleGroup.children[0].getMatrixAt(0,before);
  effect.rebuild([mesh],parent,100,71,{scale:.025,viewport:true,shadowDistance:.02});
  assert.equal(effect.shadowContactDistance,.02,'Maze contact shadows must remain shorter than a passage width');
  const batches=()=>effect.group.children.filter(batch=>batch.isLineSegments);
  assert.equal(effect.stats.visibleCount,0,'No instances are submitted before visibility is known');
  assert.equal(effect.stats.count,0,'Offscreen surfaces must not be sampled in advance');
  const camera=new THREE.PerspectiveCamera(25,1,.001,20);camera.position.set(0,0,2);camera.lookAt(0,0,0);
  effect.updateView(camera);
  const count=effect.stats.count,visible=effect.stats.visibleCount;
  assert(visible>0&&visible<=count&&count<effect.stats.surfaceArea*100,'Only the visible surface and feather bounds receive roots');
  assert(batches().every(batch=>batch.userData.allAnchors.every(sample=>sample.scale<baseline*.033)));
  const roots=()=>batches().flatMap(batch=>batch.userData.anchors.map(sample=>sample.key)).sort();
  const original=roots(),version=effect.shadowVersion;
  effect.updateView(camera);assert.equal(effect.shadowVersion,version,'A still camera must reuse its compacted batches');
  for(const batch of effect.group.children){
    assert.equal(batch.geometry.instanceCount,batch.userData.anchors.length);
    for(let i=0;i<batch.geometry.instanceCount;i++){
      assert.equal(batch.userData.anchors[i].slot,i);
      assert(new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.featherPosition,i).distanceTo(batch.userData.anchors[i].anchorPosition)<1e-6);
    }
  }
  const follicles=effect.follicleGroup.children[0],after=new THREE.Matrix4();
  assert(follicles.count>0&&follicles.count<=count);follicles.getMatrixAt(0,after);
  assert.equal(effect.substrate.userData.skinDetailScale.value,40,'Maze skin detail must match its miniature follicles');
  assert(after.getMaxScaleOnAxis()<before.getMaxScaleOnAxis()*.04,'Follicle openings must shrink too');
  camera.lookAt(0,0,4);effect.updateView(camera);
  assert.equal(effect.stats.visibleCount,0);assert.equal(follicles.count,0);
  camera.lookAt(0,0,0);effect.updateView(camera);assert.deepEqual(roots(),original,'Turning back must restore the same roots');
  effect.setSettings({style:'plume',length:2,detail:.2});effect.updateView(camera);
  assert(effect.stats.visibleCount>0);assert(effect.stats.count>=count,'A longer feather may require roots just outside the frame');
  camera.lookAt(0,0,4);effect.updateView(camera);
  assert.equal(effect.stats.count,0);assert.equal(effect.launchAll(),0,'Hidden surfaces must have no feathers or simulation bodies');
  camera.lookAt(0,0,0);effect.updateView(camera);
  const launched=effect.stats.count;assert.equal(effect.launchAll(),launched);
  camera.lookAt(0,0,4);effect.updateView(camera);
  assert.equal(effect.flyingCount,launched,'Explicitly launched feathers retain their flight across camera changes');
  effect.advance(1/60,camera,new THREE.Vector3());effect.updateView(camera);
  for(const batch of batches())for(const name of ['featherPosition','featherRotation','featherScale'])assert(batch.geometry.attributes[name].array.every(Number.isFinite));
  effect.returnAll();
  for(let i=0;i<1800&&effect.flyingCount;i++){effect.advance(1/60,camera,new THREE.Vector3());if(i%30===0)effect.updateView(camera);}
  assert.equal(effect.flyingCount,0,'Visible-only roots must still return after the camera turns away');
  effect.updateView(camera);assert.equal(effect.stats.count,0,'Settled offscreen roots must be released');
  effect.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('a feather remains when its root leaves the frame but its tip is still visible',()=>{
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  effect.setSettings({length:2,lift:22});effect.rebuild([mesh],parent,500,71,{scale:.025,viewport:true});
  const camera=new THREE.PerspectiveCamera(25,1,.001,20);camera.position.set(0,0,2);camera.lookAt(0,0,0);effect.updateView(camera);
  const all=()=>effect.group.children.filter(batch=>batch.isLineSegments).flatMap(batch=>batch.userData.allAnchors);
  const sample=all().find(sample=>Math.abs(sample.anchorPosition.x)<.2&&sample.anchorPosition.y>0&&sample.anchorPosition.y<.3);
  assert(sample);
  const tip=new THREE.Vector3(0,5*sample.scale*2,0).applyQuaternion(sample.anchorRotation).add(sample.anchorPosition);
  const halfHeight=Math.tan(THREE.MathUtils.degToRad(25/2))*2;
  camera.position.y=(sample.anchorPosition.y+tip.y)/2-halfHeight;camera.lookAt(0,camera.position.y,0);camera.updateMatrixWorld();
  assert(sample.anchorPosition.clone().project(camera).y>1,'The root has left the viewport');
  assert(Math.abs(tip.clone().project(camera).y)<1,'The tip remains on screen');
  effect.updateView(camera);
  assert(all().some(current=>current.key===sample.key&&current.slot>=0),'Visible feather geometry must survive root-only clipping');
  camera.position.y-=4;camera.lookAt(0,camera.position.y,0);effect.updateView(camera);assert.equal(effect.stats.count,0);
  effect.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('the first-person body drives shared feather and shadow bending attributes while preserving roots',()=>{
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  effect.rebuild([mesh],parent,1000,71,{scale:.025,viewport:true});effect.setFirstPerson(true);
  const camera=new THREE.PerspectiveCamera(75,1.25,.001,20);camera.position.set(0,.02,.017);camera.lookAt(0,.02,0);effect.updateView(camera);
  const roots=new Map(effect.group.children.filter(batch=>batch.isLineSegments).flatMap(batch=>batch.userData.allAnchors.map(sample=>[sample.key,sample.anchorPosition.clone()])));
  for(let i=0;i<60;i++){effect.interact(1/60,camera);effect.updateView(camera);}
  assert(effect.group.children.some(batch=>batch.isLineSegments&&batch.geometry.attributes.featherPush.array.some(value=>Math.abs(value)>.001)));
  for(const batch of effect.group.children){
    for(const sample of batch.userData.anchors)if(roots.has(sample.key))assert(sample.anchorPosition.equals(roots.get(sample.key)));
    if(batch.userData.sourceBatch)assert.equal(batch.geometry.attributes.featherPush,batch.userData.sourceBatch.geometry.attributes.featherPush);
  }
  effect.setFirstPerson(false);effect.updateView(camera);
  assert(effect.group.children.every(batch=>batch.userData.anchors.every(sample=>!sample.push||sample.push.length()===0)));
  effect.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('sampling uses transformed area, material visibility and draw ranges', () => {
  const geometry = new THREE.PlaneGeometry(2, 3).toNonIndexed();
  geometry.clearGroups(); geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  const {parent, mesh} = fixture(geometry);
  mesh.material = [mesh.material, new THREE.MeshBasicMaterial({visible:false})];
  mesh.scale.set(2, 3, 1);
  assert.equal(createSurfaceSampler([mesh], parent).area, 18);
  geometry.setDrawRange(3, 3);
  const empty = createSurfaceSampler([mesh], parent);
  assert.equal(empty.area, 0); assert.deepEqual(empty.sample(10), []);
  geometry.setDrawRange(0, 6); mesh.visible = false;
  assert.equal(createSurfaceSampler([mesh], parent).area, 0);
});

test('uneven tessellation does not attract roots, and best candidates improve spacing', () => {
  const parent = new THREE.Group();
  const sparse = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  const dense = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 32, 32), sparse.material);
  sparse.position.x = -.5; dense.position.x = .5; parent.add(sparse, dense);
  const sampler = createSurfaceSampler([sparse, dense], parent), samples = sampler.sample(200, 43);
  const left = samples.filter(sample => sample.position.x < 0).length;
  assert(left >= 85 && left <= 115, `${left} of 200 roots landed on the sparsely tessellated half`);
  function nearestMean(points) {
    return points.reduce((sum, point, i) => sum + Math.sqrt(Math.min(...points.filter((_, j) => j !== i).map(other => point.distanceToSquared(other)))), 0) / points.length;
  }
  const random = seededRandom(43), points = Array.from({length:200}, () => new THREE.Vector3(random() * 2 - 1, random() - .5, 0));
  assert(nearestMean(samples.map(s => s.position)) > nearestMean(points) * 1.35);
  assert.deepEqual(sampler.sample(100, 43).map(s => s.position), samples.slice(0, 100).map(s => s.position));
});

test('smooth roots face outward under nonuniform scale, and attachments follow morphs', () => {
  const {parent, mesh} = fixture();
  mesh.scale.set(2, 1, .5); mesh.rotation.z = .7;
  const sample = createSurfaceSampler([mesh], parent).sample(1, 71)[0];
  const position = new THREE.Vector3(), normal = new THREE.Vector3();
  readFeatherAnchor(sample, parent, position, normal);
  assert(Math.abs(normal.length() - 1) < 1e-10);
  assert(normal.dot(position.clone().normalize()) > .4);

  const plane = fixture(new THREE.PlaneGeometry(2, 2));
  const attribute = plane.mesh.geometry.attributes.position;
  const morph = attribute.clone();
  for (let i = 0; i < morph.count; i++) morph.setZ(i, 2);
  plane.mesh.geometry.morphAttributes.position = [morph];
  plane.mesh.updateMorphTargets();
  const anchor = createSurfaceSampler([plane.mesh], plane.parent).sample(1)[0];
  plane.mesh.morphTargetInfluences[0] = .5;
  readFeatherAnchor(anchor, plane.parent, position, normal);
  assert(Math.abs(position.z - 1.018) < 1e-6);
  assert(normal.dot(new THREE.Vector3(0, 0, 1)) > .99999);
});

test('feather instances follow normals, preserve roots across density changes and dispose old buffers', () => {
  const {parent, mesh} = fixture(new THREE.BoxGeometry(2, 2, 2));
  const effect = createFeatherSurface();
  effect.setSettings({lift:90});
  assert.equal(effect.rebuild([mesh], parent, 2, 73).count, 48);
  assert.equal(effect.group.children.length, 8);
  let disposed = 0;
  const roots = effect.group.children.flatMap(batch => {
    batch.geometry.addEventListener('dispose', () => disposed++);
    const p = batch.geometry.attributes.featherPosition, q = batch.geometry.attributes.featherRotation;
    return Array.from({length:p.count}, (_, i) => {
      const root = new THREE.Vector3().fromBufferAttribute(p, i);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.getX(i), q.getY(i), q.getZ(i), q.getW(i)));
      assert(axis.dot(root) > .99, 'Shaft must point away from the cube');
      return root.toArray().join(',');
    });
  });
  assert.equal(effect.rebuild([mesh], parent, 4, 73).count, 96);
  assert.equal(disposed, 8);
  const denserRoots = effect.group.children.flatMap(batch => {
    const p = batch.geometry.attributes.featherPosition;
    return Array.from({length:p.count}, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i).toArray().join(','));
  });
  assert(roots.every(root => denserRoots.includes(root)));
  assert.equal(effect.rebuild([mesh], parent, 0, 73).count, 0);
  assert.equal(effect.group.children.length, 0);
  effect.rebuild([mesh], parent, 100, 73);
  assert.equal(effect.stats.count, 2400);
  assert.equal(effect.group.children.filter(batch => batch.isLineSegments).reduce((sum, batch) => sum + batch.geometry.instanceCount, 0), 2400);
  assert.equal(effect.rebuild([mesh], parent, 50, 73).count, 1200);
  assert.equal(effect.rebuild([mesh], parent, 99, 73).count, 2376);
  const small=fixture(new THREE.PlaneGeometry(.2,.2));
  assert.equal(effect.rebuild([small.mesh],small.parent,100,73).count,4);
  assert.equal(effect.rebuild([small.mesh],small.parent,1000,73).count,40,'Extended density must add ten times as many roots');
  effect.clear(); assert.equal(effect.group.parent, null);
});

test('barycentric attachments follow skeletal animation and transformed instances', () => {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
  const parent = new THREE.Group(); parent.add(mesh);
  const sample = createSurfaceSampler([mesh], parent).sample(1)[0];
  const position = new THREE.Vector3(), normal = new THREE.Vector3();
  bone.position.z = 1; bone.rotation.x = Math.PI / 2;
  parent.updateMatrixWorld(true); mesh.skeleton.update();
  readFeatherAnchor(sample, parent, position, normal);
  assert(Math.abs(normal.y + 1) < 1e-6);
  assert(Math.abs(position.y + .018) < 1e-6);

  const instanced = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), mesh.material, 2);
  instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 0, 0));
  parent.add(instanced);
  const sampler = createSurfaceSampler([instanced], parent);
  assert.equal(sampler.area, 8);
  const samples = sampler.sample(30);
  assert(samples.some(s => s.position.x > 3));
  for (const anchor of samples) {
    readFeatherAnchor(anchor, parent, position, normal);
    assert(position.distanceTo(anchor.position) - .018 < 1e-6);
    assert(normal.z > .999);
  }
});

test('shared L-system generator is deterministic, finite and honors grammar', () => {
  const opts = {length:5, spread:1.15, seed:71, variation:2, depth:2, density:.38};
  const data = generateFeatherData(opts);
  assert.deepEqual(data, generateFeatherData(opts));
  for (const layer of [data.shaft, data.barbs, data.hairs]) {
    assert.equal(layer.p.length, layer.c.length);
    assert(layer.p.length > 0); assert(layer.p.every(Number.isFinite));
  }
  assert.equal(rewriteFeatherGrammar({axiom:'X', X:'F[+X][-X]', F:'FF'}, 1), 'F[+X][-X]');
  const longer=generateFeatherData({...opts,branchLength:2});
  assert.notDeepEqual(longer.hairs.p,data.hairs.p);
  assert.deepEqual(longer.barbs.p,data.barbs.p);assert.deepEqual(longer.shaft.p,data.shaft.p);
  const regular=generateFeatherData({...opts,branchRandomness:0});
  assert.notDeepEqual(regular.hairs.p,data.hairs.p);assert.deepEqual(regular.barbs.p,data.barbs.p);
  assert(regular.hairs.p.every(Number.isFinite));
  assert.deepEqual(generateFeatherData({...opts,branchRandomness:10}),data);
  assert.deepEqual(generateFeatherData({...opts,branchRandomness:-1}),regular);
});

test('grammar and generation edits rebuild branching geometry without moving mesh roots',()=>{
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  effect.setSettings({style:'plume'});effect.rebuild([mesh],parent,2,73);
  const roots=()=>effect.group.children.map(batch=>[...batch.geometry.attributes.featherPosition.array]);
  const before=roots(),geometry=effect.group.children[0].geometry,vertices=geometry.attributes.position.count;
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  effect.launchAll();assert.equal(effect.flyingCount,effect.stats.count);
  effect.setSettings({axiom:'F',ruleF:'F[+F]F[-F]F',generations:3,branchLength:2,branchRandomness:0});
  assert.equal(effect.flyingCount,0);assert.equal(disposed,1);assert.deepEqual(roots(),before);
  assert(effect.group.children[0].geometry.attributes.position.count>vertices);
  for(const batch of effect.group.children)assert(batch.geometry.attributes.position.array.every(Number.isFinite));
  effect.setSettings({generations:0,axiom:'X'});assert.deepEqual(roots(),before);
  effect.dispose();
});

test('settings change feather appearance while retaining roots and size updates reuse geometry', () => {
  const {parent, mesh} = fixture(new THREE.BoxGeometry(2, 2, 2));
  const effect = createFeatherSurface();
  effect.rebuild([mesh], parent, 2, 73);
  const geometry = effect.group.children[0].geometry;
  const roots = effect.group.children.map(batch => [...batch.geometry.attributes.featherPosition.array]);
  const originalVertices = geometry.attributes.position.count;
  effect.setSettings({length:1.5, width:.5, opacity:.4});
  assert.equal(effect.group.children[0].geometry, geometry);
  assert.equal(effect.group.children[0].material.opacity, .4);
  assert.equal(effect.group.children[0].material.blending, THREE.NormalBlending);
  assert.equal(effect.group.children[0].material.toneMapped, true);
  assert.equal(effect.group.children[0].material.transparent, true);
  assert.equal(effect.group.children[0].material.depthWrite, false);
  assert([...geometry.attributes.color.array].every(value => value >= 0 && value <= 1));
  const shader = {uniforms:{}, vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
  effect.group.children[0].material.onBeforeCompile(shader);
  assert.deepEqual(shader.uniforms.uFeatherSize.value.toArray(), [.5, 1.5]);
  effect.setSettings({detail:.8, angle:45});
  assert(effect.group.children[0].geometry.attributes.position.count > originalVertices);
  assert.deepEqual(effect.group.children.map(batch => [...batch.geometry.attributes.featherPosition.array]), roots);
  effect.rebuild([mesh], parent, 3, 73);
  const nextShader = {uniforms:{}, vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
  effect.group.children[0].material.onBeforeCompile(nextShader);
  assert.deepEqual(nextShader.uniforms.uFeatherSize.value.toArray(), [.5, 1.5]);
  assert.equal(effect.group.children[0].material.opacity, .4);
  effect.setSettings({opacity:1});
  assert.equal(effect.group.children[0].material.transparent, false);
  assert.equal(effect.group.children[0].material.depthWrite, true);
  assert.equal(effect.translucent, false);
  effect.setSettings({opacity:10});
  assert.equal(effect.group.children[0].material.opacity,1,'Out-of-range opacity must clamp to a valid alpha');
  assert.equal(effect.group.children[0].material.transparent,false);
  effect.setSettings({opacity:.4});
  effect.setHashedTransparency(true);
  assert.equal(effect.group.children[0].material.transparent, false);
  assert.equal(effect.group.children[0].material.alphaHash, true);
  assert.equal(effect.group.children[0].material.depthWrite, true);
  effect.setSettings({opacity:0});
  assert.equal(effect.translucent, false);
  assert(effect.group.children.every(batch => !batch.visible));
  effect.clear();
});

test('switching to original plumes preserves attachments and wind while replacing and disposing geometry', () => {
  const {parent,mesh}=fixture(new THREE.BoxGeometry(2,2,2)),effect=createFeatherSurface();
  effect.setSettings({breeze:.6,windDirection:90,opacity:.45,length:1.3});
  effect.rebuild([mesh],parent,2,73);
  const roots=()=>effect.group.children.filter(batch=>batch.isLineSegments).map(batch=>
    ['featherPosition','featherRotation','featherScale'].map(key=>[...batch.geometry.attributes[key].array]));
  const before=roots(),follicles=effect.follicleGroup.children[0],count=effect.stats.count;
  const layered=effect.group.children[0].geometry.attributes.position.count;
  let disposed=0;
  for(const batch of effect.group.children)batch.geometry.addEventListener('dispose',()=>disposed++);
  const version=effect.shadowVersion;
  effect.setSettings({style:'plume'});
  assert.equal(disposed,8);assert(effect.shadowVersion>version);
  assert.equal(effect.stats.count,count);assert.equal(effect.follicleGroup.children[0],follicles);
  assert.deepEqual(roots(),before);
  assert.equal(effect.group.children.length,4);
  assert(effect.group.children.every(batch=>batch.isLineSegments&&batch.customDepthMaterial));
  const data=generateFeatherData({variation:1,seed:73,density:.38,depth:2});
  const expected=[data.hairs,data.barbs,data.shaft].flatMap(layer=>layer.p.map((value,index)=>index%3===1?value+2.4:value));
  assert.deepEqual([...effect.group.children[0].geometry.attributes.position.array],[...new Float32Array(expected)]);
  assert(effect.group.children[0].geometry.attributes.position.count>layered);
  for(const batch of effect.group.children){
    assert.equal(batch.material.opacity,.45);assert(batch.customDepthMaterial.alphaHash);
    const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
    batch.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uFeatherBreeze.value,.6);assert.equal(shader.uniforms.uFeatherSize.value.y,1.3);
    assert(Math.abs(shader.uniforms.uFeatherWind.value.z+1)<1e-9);
    batch.geometry.addEventListener('dispose',()=>disposed++);
  }
  effect.setSettings({style:'layered'});
  assert.equal(disposed,12);assert.equal(effect.group.children.length,8);
  assert.equal(effect.group.children[0].geometry.attributes.position.count,layered);
  assert.deepEqual(roots(),before);
  effect.dispose();
});

test('the full coat flies in world space and returns to its mesh roots', () => {
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  effect.rebuild([mesh],parent,2,73);
  const poses=()=>effect.group.children.filter(batch=>batch.isLineSegments).map(batch=>[...batch.geometry.attributes.featherPosition.array]);
  const rest=poses(),follicles=[...effect.follicleGroup.children[0].instanceMatrix.array];
  assert.equal(effect.launchAll(),effect.stats.count);assert.equal(effect.launchAll(),0);
  assert.equal(effect.flyingCount,effect.stats.count);
  for(let i=0;i<60;i++)assert(effect.advance(1/60));
  assert.notDeepEqual(poses(),rest);
  assert.deepEqual([...effect.follicleGroup.children[0].instanceMatrix.array],follicles);
  const batch=effect.group.children[0],before=new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.featherPosition,0).applyMatrix4(parent.matrixWorld);
  parent.position.x=3;parent.rotation.y=.4;effect.update();
  const after=new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.featherPosition,0).applyMatrix4(parent.matrixWorld);
  assert(before.distanceTo(after)<1e-5,'Moving the source mesh must not teleport a detached feather');
  effect.returnAll();assert.equal(effect.returningCount,effect.stats.count);
  for(let i=0;i<1800&&effect.flyingCount;i++)effect.advance(1/60);
  assert.equal(effect.flyingCount,0);assert.equal(effect.advance(.02),false);
  assert.deepEqual(poses(),rest);
  const returned=new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.featherPosition,0).applyMatrix4(parent.matrixWorld);
  assert(returned.distanceTo(before)>2,'Returned feathers must follow the source mesh in its current pose');
  effect.launchAll();effect.setSettings({style:'plume'});assert.equal(effect.flyingCount,0);
  effect.launchAll();effect.rebuild([mesh],parent,1,73);assert.equal(effect.flyingCount,0);
  assert.equal(effect.launchAll(),effect.stats.count);
  assert.equal(effect.launchAll(),0,'Launching the flock twice must not duplicate bodies');
  for(let i=0;i<60;i++)effect.advance(1/60);
  assert.equal(effect.flyingCount,effect.stats.count);
  for(const batch of effect.group.children)assert([...batch.geometry.attributes.featherPosition.array].every(Number.isFinite));
  effect.returnAll();
  for(let i=0;i<1800&&effect.flyingCount;i++)effect.advance(1/60);
  assert.equal(effect.flyingCount,0);assert.equal(effect.advance(.02),false);
  effect.dispose();
});

test('instance picking finds real filaments and respects opaque mesh occlusion', () => {
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  mesh.material.side=THREE.DoubleSide;
  effect.setSettings({style:'plume'});effect.rebuild([mesh],parent,1,73);
  const batch=effect.group.children[0],a=batch.geometry.attributes;
  const target=new THREE.Vector3().fromBufferAttribute(a.position,a.position.count-1).multiplyScalar(a.featherScale.getX(0));
  target.applyQuaternion(new THREE.Quaternion().fromBufferAttribute(a.featherRotation,0)).add(new THREE.Vector3().fromBufferAttribute(a.featherPosition,0));
  const ray=new THREE.Raycaster(target.clone().add(new THREE.Vector3(0,0,2)),new THREE.Vector3(0,0,-1));
  assert.notEqual(effect.pick(ray),null);
  ray.set(new THREE.Vector3(target.x,target.y,-2),new THREE.Vector3(0,0,1));
  if(Math.abs(target.x)<1&&Math.abs(target.y)<1)assert.equal(effect.pick(ray),null);
  effect.setSettings({opacity:0});assert.equal(effect.pick(ray),null);effect.dispose();
});

test('breeze advances only while active, preserves roots and keeps wind fixed in world space', () => {
  const {parent, mesh} = fixture(new THREE.BoxGeometry(2, 2, 2));
  parent.rotation.set(.3, .6, -.4);
  const effect = createFeatherSurface();
  effect.rebuild([mesh], parent, 5, 73);
  const geometry = effect.group.children[0].geometry;
  const roots = [...geometry.attributes.featherPosition.array];
  const shader = {uniforms:{}, vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
  effect.group.children[0].material.onBeforeCompile(shader);
  assert.equal(effect.advance(.05), false);
  assert.equal(shader.uniforms.uFeatherTime.value, 0);

  effect.setSettings({breeze:.65, windDirection:90});
  assert.equal(shader.uniforms.uFeatherBreeze.value, .65);
  assert.equal(effect.advance(.05), true);
  assert.equal(shader.uniforms.uFeatherTime.value, .05);
  let worldWind = shader.uniforms.uFeatherWind.value.clone().transformDirection(parent.matrixWorld);
  assert(worldWind.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-10);
  parent.rotation.y += 1;
  effect.advance(10);
  assert(Math.abs(shader.uniforms.uFeatherTime.value - .15) < 1e-10, 'Suspended frames have bounded simulation steps');
  worldWind = shader.uniforms.uFeatherWind.value.clone().transformDirection(parent.matrixWorld);
  assert(worldWind.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-10);
  effect.setSettings({windDirection:270});
  worldWind = shader.uniforms.uFeatherWind.value.clone().transformDirection(parent.matrixWorld);
  assert(worldWind.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-10);
  assert.equal(effect.group.children[0].geometry, geometry);
  assert.deepEqual([...geometry.attributes.featherPosition.array], roots);
  effect.setSettings({breeze:0});
  assert.equal(effect.advance(.1), false);
  assert.equal(shader.uniforms.uFeatherBreeze.value, 0);
  effect.setSettings({breeze:1});
  effect.rebuild([mesh], parent, 0, 73);
  assert.equal(effect.advance(.1), false, 'Empty feather surfaces do not animate');
  effect.clear();
  assert.equal(effect.advance(.1), false);
});

test('contour feathers lean into a coherent surface flow, including at its poles', () => {
  const quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const normals = [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(.2,.8,.3).normalize()];
  for (const normal of normals) {
    plumageFrame(normal, 22, 0, 0, quaternion);
    assert([...quaternion].every(Number.isFinite));
    const axis = up.clone().applyQuaternion(quaternion), front = new THREE.Vector3(0,0,1).applyQuaternion(quaternion);
    assert(Math.abs(axis.dot(normal) - Math.sin(22 * Math.PI / 180)) < 1e-6);
    assert(front.dot(normal) > .9, 'The vane face must point away from the skin');
  }
  const normal = new THREE.Vector3(0,0,1);
  plumageFrame(normal,22,0,0,quaternion);assert(up.clone().applyQuaternion(quaternion).y < -.9);
  plumageFrame(normal,22,180,0,quaternion);assert(up.clone().applyQuaternion(quaternion).y > .9);
});

test('skin follicles match their feather roots, and lift and color edits retain attachments', () => {
  const {parent,mesh} = fixture(new THREE.PlaneGeometry(2,2));
  const effect = createFeatherSurface();effect.rebuild([mesh],parent,10,73);
  assert.equal(effect.substrate.name,'Feather skin');assert.equal(effect.substrate.metalness,0);
  const follicles = effect.follicleGroup.children[0], matrix = new THREE.Matrix4();
  assert.equal(follicles.count,effect.stats.count);
  const roots = effect.group.children.map(batch=>[...batch.geometry.attributes.featherPosition.array]);
  for(const batch of effect.group.children.filter(batch=>batch.isLineSegments)) {
    batch.userData.anchors.forEach((sample,index)=>{
      follicles.getMatrixAt(sample.index,matrix);
      const follicle = new THREE.Vector3().setFromMatrixPosition(matrix), root = new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.featherPosition,index);
      assert(root.distanceTo(follicle)<1e-7);assert(Math.abs(root.z-.001)<1e-6);
    });
  }
  assert(effect.group.children.some(batch=>batch.isMesh&&batch.geometry.index.count>0));
  const originalRotation = [...effect.group.children[0].geometry.attributes.featherRotation.array];
  effect.setSettings({lift:60,flowDirection:180,skinColor:'#a17264'});
  assert.notDeepEqual([...effect.group.children[0].geometry.attributes.featherRotation.array],originalRotation);
  assert.deepEqual(effect.group.children.map(batch=>[...batch.geometry.attributes.featherPosition.array]),roots);
  assert.equal(effect.substrate.color.getHexString(),'a17264');
  effect.setSettings({opacity:0});assert.equal(effect.follicleGroup.children[0].visible,true);
  effect.clear();assert.equal(effect.follicleGroup.parent,null);effect.dispose();
});

test('mesh feathers have a bare quill below their contour vane', () => {
  const data = generateFeatherData({length:5,density:.38,depth:2,quillFraction:.18});
  assert(data.barbs.p.length>0);
  for(let row=0;row<data.barbs.p.length;row+=84)assert(data.barbs.p[row+1]+2.4>=.9);
  assert(Math.abs(data.shaft.p[1]+2.4)<1e-10);
});

test('contour outlines vary smoothly, have a sparse short fringe and close at the tip', () => {
  for (const variation of [1,2,3,4]) {
    const data = generateFeatherData({length:5,spread:1.15,density:.38,depth:2,quillFraction:.18,contour:true,variation});
    const widths=[];
    for (let row=0;row<data.barbs.p.length;row+=84) {
      const t=data.barbs.p[row+1]/5+.48;
      const envelope=Math.pow(Math.sin((t-.18)/.82*Math.PI),.77);
      widths.push((data.barbs.p[row]-data.barbs.p[row+39])/(1.15*.91*envelope));
    }
    assert(Math.max(...widths)-Math.min(...widths)<.08,'The vane edge should not jump independently at each row');
    assert(data.hairs.p.length<data.barbs.p.length,'Fringe should remain sparser than the main barbs');
    for(let i=0;i<data.hairs.p.length;i+=6)assert(Math.hypot(data.hairs.p[i+3]-data.hairs.p[i],data.hairs.p[i+4]-data.hairs.p[i+1],data.hairs.p[i+5]-data.hairs.p[i+2])<.08);
    const vane=createContourVane(data.barbs,data.shaft),tip=vane.attributes.position.count-1,end=data.shaft.p.length-3;
    assert(Math.abs(vane.attributes.position.getY(tip)-(data.shaft.p[end+1]+2.4))<1e-6);
    assert([...vane.index.array].includes(tip));vane.dispose();
  }
});

test('plumage direction stays continuous across nearly upward-facing normals', () => {
  const first=new THREE.Vector3(.049,Math.sqrt(1-.049**2),0),second=new THREE.Vector3(.051,Math.sqrt(1-.051**2),0);
  const a=new THREE.Quaternion(),b=new THREE.Quaternion();
  plumageFrame(first,22,0,0,a);plumageFrame(second,22,0,0,b);
  const forwardA=new THREE.Vector3(0,1,0).applyQuaternion(a),forwardB=new THREE.Vector3(0,1,0).applyQuaternion(b);
  assert(forwardA.dot(forwardB)>.9999,'Cap orientation should not jump at a projection threshold');
  assert(forwardA.z>.9&&forwardB.z>.9,'Cap feathers should continue toward the front instead of fanning sideways');
  const backA=new THREE.Vector3(.001,.001,-1).normalize(),backB=new THREE.Vector3(-.001,.001,-1).normalize();
  plumageFrame(backA,22,0,0,a);plumageFrame(backB,22,0,0,b);
  assert(new THREE.Vector3(0,1,0).applyQuaternion(a).dot(new THREE.Vector3(0,1,0).applyQuaternion(b))>.999,'Small normal variations on a flat back face must not flip the flow');
});

test('shadow strength reuses geometry, and shadow casters follow opacity and breeze', () => {
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  effect.rebuild([mesh],parent,5,73);
  const vane=effect.group.children.find(batch=>batch.isMesh),geometry=vane.geometry;
  const colorShader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
  const depthShader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:''};
  vane.material.onBeforeCompile(colorShader);vane.customDepthMaterial.onBeforeCompile(depthShader);
  assert.equal(colorShader.uniforms.uFeatherTime,depthShader.uniforms.uFeatherTime);
  assert.equal(colorShader.uniforms.uFeatherSize,depthShader.uniforms.uFeatherSize);
  const version=effect.shadowVersion;
  effect.setSettings({shadow:.6});
  assert.equal(effect.shadowVersion,version);assert.equal(vane.geometry,geometry);
  assert.equal(colorShader.uniforms.uFeatherShadowStrength.value,.6);
  effect.setSettings({opacity:.45});assert(vane.customDepthMaterial.alphaHash);assert(effect.shadowVersion>version);
  effect.setSettings({breeze:.6});const before=effect.shadowVersion;effect.advance(.1);
  assert(effect.shadowVersion>before);assert.equal(depthShader.uniforms.uFeatherTime.value,.1);
  effect.setSettings({shadow:0});assert.equal(effect.shadowEnabled,false);
  let disposed=0;vane.customDepthMaterial.addEventListener('dispose',()=>disposed++);
  effect.clear();assert.equal(disposed,1);effect.dispose();
});

test('skin scattering updates live without changing opacity, roots or shadow geometry', () => {
  const {parent,mesh}=fixture(new THREE.PlaneGeometry(2,2)),effect=createFeatherSurface();
  effect.rebuild([mesh],parent,5,73);
  const material=effect.substrate,uniform=material.userData.skinSubsurface,version=material.version,shadowVersion=effect.shadowVersion;
  const roots=effect.group.children.map(batch=>[...batch.geometry.attributes.featherPosition.array]);
  assert.equal(uniform.value,.35);
  effect.setSettings({subsurface:0});assert.equal(uniform.value,0);
  effect.setSettings({subsurface:1});assert.equal(uniform.value,1);
  assert.equal(material.userData.skinSubsurface,uniform);assert.equal(material.version,version);
  assert.equal(material.opacity,1);assert.equal(material.transparent,false);assert.equal(material.transmission,0);
  assert.equal(effect.shadowVersion,shadowVersion);
  assert.deepEqual(effect.group.children.map(batch=>[...batch.geometry.attributes.featherPosition.array]),roots);
  effect.setSettings({subsurface:10,shadow:10,opacity:10,branchRandomness:10});
  assert.equal(uniform.value,1);assert.equal(effect.shadowUniforms.uFeatherShadowStrength.value,1);
  assert.equal(effect.group.children[0].material.opacity,1);
  effect.setSettings({subsurface:-1,shadow:-1,opacity:-1,branchRandomness:-1});
  assert.equal(uniform.value,0);assert.equal(effect.shadowUniforms.uFeatherShadowStrength.value,0);
  assert(effect.group.children.every(batch=>!batch.visible&&batch.material.opacity===0));
  effect.dispose();
});

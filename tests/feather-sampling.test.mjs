import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE = await import('../vendor/three.module.js');
const {createSurfaceSampler, readFeatherAnchor} = await import('../feather-sampling.js');
const {seededRandom} = await import('../plume-lsystem/random.js');
const {createFeatherSurface} = await import('../feather-surface.js');
const {generateFeatherData, rewriteFeatherGrammar} = await import('../plume-lsystem/feather-generator.js');
const {plumageFrame,createContourVane} = await import('../plumage-frame.js');

function fixture(geometry = new THREE.SphereGeometry(1, 32, 24)) {
  const parent = new THREE.Group(), mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  parent.add(mesh); parent.updateMatrixWorld(true);
  return {parent, mesh};
}

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
  effect.dispose();
});

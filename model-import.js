import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { FBXLoader } from './vendor/FBXLoader.js';
import { createRustMaterial } from './rust-material.js';
import { metalPresets } from './metal-presets.js';
import { ImportedPeelingSurface } from './imported-peeling.js';
import { retargetAnimation } from './model-animation.js';

export function disposeModel(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.skeleton) skeletons.add(o.skeleton);
    for (const m of [o.material].flat().filter(Boolean)) materials.add(m);
  });
  for (const m of materials) for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose()); skeletons.forEach(s => s.dispose());
}

export function createModelImporter({ scene, uniforms, state, onActivate, onClear, invalidate, reducedMotion, notify = () => {} }) {
  const $ = id => document.getElementById(id);
  let current = null, revision = 0;
  const loader = new GLTFLoader();
  const status = message => {
    $('model-status').textContent = message;
    if(document.querySelector('.model-panel').hidden && /^(Could not|Choose |Import a)/.test(message))notify(message);
  };
  function clear(invalidatePending = true) {
    if (invalidatePending) revision++;
    if (current) {
      current.peeling?.dispose();
      current.mixer.stopAllAction(); current.mixer.uncacheRoot(current.root);
      scene.remove(current.wrapper);
      current.slots.forEach(s => { s.rust.dispose(); s.substrate.dispose(); });
      current.root.traverse(o => { if (o.isMesh) o.material = current.originals.get(o); });
      disposeModel(current.root); current = null;
    }
    $('model-details').hidden = true; $('material-slots').replaceChildren();
    status('Drop a GLB here, or import a file.'); onClear(); invalidate();
  }
  function play(index) {
    if (!current) return;
    current.mixer.stopAllAction(); current.action = null;
    if (index >= 0 && current.clips[index]) {
      current.action = current.mixer.clipAction(current.clips[index]);
      current.action.reset().play(); current.action.paused = reducedMotion;
    }
    $('animation-toggle').disabled = !current.action;
    $('animation-toggle').textContent = current.action && !current.action.paused ? 'Pause animation' : 'Play animation';
    current.mixer.update(0); invalidate();
  }
  function listClips(selected = -1) {
    $('model-animation').replaceChildren(new Option('Rest pose', '-1'));
    current.clips.forEach((clip, i) => $('model-animation').add(new Option(`${i + 1}. ${clip.name || 'Animation'}`, String(i))));
    $('model-animation').value = String(selected); play(selected);
  }
  function finishMaterial(source, finish, coating = true) {
    const local = { ...uniforms };
    if (finish !== 'global') {
      const p = metalPresets[finish];
      for (const [key, value] of Object.entries({uPatina:p.patina,uPassivation:p.passivation,uMetalRoughness:p.roughness,uDepositRoughness:p.depositRoughness,uCorrosionRelief:p.relief})) local[key] = {value};
      for (const [key, value] of Object.entries(p.colors)) local['u'+key[0].toUpperCase()+key.slice(1)] = {value:new THREE.Color(value)};
    }
    // Paint uses the shared color uniforms, independent of texture pigment and
    // vertex colors. Keep source sidedness, opacity and alpha-mask behavior.
    const paintSource={...source,color:new THREE.Color(0xffffff),map:null,vertexColors:false};
    const material = createRustMaterial(local, coating, paintSource);
    return material;
  }
  function configurePeeling() {
    current.peeling?.dispose(); current.peeling=null;
    const {root,slots,originals}=current;
    for(const slot of slots)if(slot.select)slot.select.disabled=state.modelAppearance==='original';
    if(state.modelAppearance==='original') {
      root.traverse(mesh=>{if(originals.has(mesh))mesh.material=originals.get(mesh);});
      $('layers-view').disabled=true;
      $('model-peeling-note').textContent='Original materials. Choose Paint coat in Paint to add a colored, peelable coating.';
      return;
    }
    let triangles=0;
    const reasons=new Set(), meshEligible=new Map();
    root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const count=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
      triangles+=count;
      const animated=current.clips.length>0||mesh.isSkinnedMesh||mesh.isInstancedMesh||Object.keys(mesh.geometry.morphAttributes).length>0;
      meshEligible.set(mesh,!animated);
      if(animated)reasons.add('animated or deforming meshes');
    });
    const withinBudget=triangles<=150000;
    if(!withinBudget)reasons.add(`${triangles.toLocaleString()} triangles exceeds the 150,000-triangle limit`);
    let hasPeeling=false;
    const entries=[];
    root.updateWorldMatrix(true,true);
    root.traverse(mesh=>{
      if(!originals.has(mesh))return;
      const sources=[originals.get(mesh)].flat();
      const materialIndices=sources.map(source=>slots.findIndex(s=>s.source===source));
      const eligible=materialIndices.map(i=>{
        const s=slots[i],opaque=!s.source.transparent&&!s.source.alphaTest;
        if(!opaque)reasons.add('transparent or cutout materials');
        return withinBudget&&meshEligible.get(mesh)&&opaque&&s.finish!=='original';
      });
      const supported=eligible.some(Boolean);hasPeeling ||= supported;
      const materials=materialIndices.map((i,j)=>slots[i].finish==='original'?slots[i].source:eligible[j]?slots[i].substrate:slots[i].rust);
      mesh.material=Array.isArray(originals.get(mesh))?materials:materials[0];
      const layer=mesh.geometry.attributes.layer;layer.array.fill(1);
      const groups=mesh.geometry.groups.length?mesh.geometry.groups:[{start:0,count:mesh.geometry.index?.count??layer.count,materialIndex:0}];
      for(const group of groups)if(eligible[group.materialIndex??0])for(let k=group.start;k<group.start+group.count;k++)layer.setX(mesh.geometry.index?mesh.geometry.index.getX(k):k,0);
      layer.needsUpdate=true;
      if(supported)entries.push({mesh,materialIndices:materialIndices.map((i,j)=>eligible[j]?i:-1)});
    });
    if(hasPeeling) {
      try { current.peeling=new ImportedPeelingSurface({scene,entries,materials:slots.map(s=>s.rust),state}); }
      catch(error) {
        reasons.add(error.message);console.warn('Peeling unavailable:',error);
        root.traverse(mesh=>{
          if(!originals.has(mesh))return;
          const materials=[originals.get(mesh)].flat().map(source=>{const s=slots.find(s=>s.source===source);return s.finish==='original'?source:s.rust;});
          mesh.material=Array.isArray(originals.get(mesh))?materials:materials[0];
          mesh.geometry.attributes.layer.array.fill(1);mesh.geometry.attributes.layer.needsUpdate=true;
        });
      }
    }
    $('layers-view').disabled=!current.peeling;
    $('model-peeling-note').textContent=current.peeling
      ? `Generated ${current.peeling.flakes.length} patches from the model geometry. Increase Exposure to peel.${reasons.size?' Some parts use shader weathering: '+[...reasons].join('; ')+'.':''}`
      : `Peeling unavailable: ${reasons.size?[...reasons].join('; '):'choose a rust finish instead of Original material'}.`;
  }
  async function loadModel(input, name, sampleKey = null) {
    const ticket = ++revision;
    status(`Loading ${name}…`);
    try {
      const gltf = typeof input === 'string' ? await loader.loadAsync(input) : await loader.parseAsync(await input.arrayBuffer(), '');
      if (ticket !== revision) { disposeModel(gltf.scene); return false; }
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root, true), size = bounds.getSize(new THREE.Vector3());
      let count = 0; root.traverse(o => { if (o.isMesh) count++; });
      if (!count || bounds.isEmpty() || !Number.isFinite(size.length()) || size.length() === 0) {
        disposeModel(root); throw new Error('The GLB contains no renderable mesh.');
      }
      clear(false);
      const wrapper = new THREE.Group(), center = bounds.getCenter(new THREE.Vector3());
      const scale = 3 / Math.max(size.x, size.y, size.z);
      wrapper.scale.setScalar(scale);
      wrapper.position.set(-center.x * scale, -1.65 - bounds.min.y * scale, -center.z * scale);
      wrapper.add(root);
      const originals = new Map(), byMaterial = new Map(), slots = [], sourceGeometries = new Set();
      root.traverse(mesh => {
        if (!mesh.isMesh) return;
        originals.set(mesh, mesh.material);
        sourceGeometries.add(mesh.geometry);
        const geometry = mesh.geometry = mesh.geometry.clone(), position = geometry.attributes.position;
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        // Sample noise in normalized bind space so it follows skinning/morphs.
        const rest = position.clone(); const v = new THREE.Vector3();
        for (let i = 0; i < rest.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).sub(center).multiplyScalar(scale);
          rest.setXYZ(i, v.x, v.y, v.z);
        }
        geometry.setAttribute('restPosition', rest);
        for (const [key, value] of [['layer',1],['underside',0],['coatEdge',0],['flakeAge',-1]]) geometry.setAttribute(key, new THREE.Float32BufferAttribute(new Float32Array(position.count).fill(value), 1));
        const convert = source => {
          if (!byMaterial.has(source)) {
            const slot = {source, finish:'global', rust:finishMaterial(source, 'global'), substrate:finishMaterial(source, 'global', false)};
            byMaterial.set(source, slot); slots.push(slot);
          }
          return byMaterial.get(source).rust;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
      });
      sourceGeometries.forEach(geometry => geometry.dispose());
      current = {sampleKey,root, wrapper, originals, slots, clips:gltf.animations, mixer:new THREE.AnimationMixer(root), action:null};
      for (const [i, slot] of slots.entries()) {
        const row = document.createElement('label'), label = document.createElement('span'), select = document.createElement('select');
        label.textContent = slot.source.name || `Material ${i + 1}`;
        for (const [value, text] of [['global','Rust · current metal'], ...Object.entries(metalPresets).map(([key,p]) => [key,p.name]), ['original','Original material']]) select.add(new Option(text, value));
        select.setAttribute('aria-label', `${label.textContent} finish`);slot.select=select;
        select.onchange = () => {
          slot.rust.dispose(); slot.substrate.dispose(); slot.finish = select.value;
          slot.rust = finishMaterial(slot.source, slot.finish === 'original' ? 'global' : slot.finish);
          slot.substrate = finishMaterial(slot.source, slot.finish === 'original' ? 'global' : slot.finish, false);
          configurePeeling(); invalidate();
        };
        row.append(label, select); $('material-slots').append(row);
      }
      scene.add(wrapper); configurePeeling(); $('model-details').hidden = false;
      $('model-name').textContent = name; listClips(); onActivate(name, !!current.peeling);
      status(`${count} meshes · ${slots.length} materials · ${gltf.animations.length} animations`); invalidate();
      return true;
    } catch (error) { if (ticket === revision || current === null) status(`Could not import: ${error.message}`); console.error(error); return false; }
  }
  async function loadAnimation(input, name) {
    const model = current;
    if (!model) { status('Import a GLB character before adding an FBX animation.'); return; }
    status(`Retargeting ${name}…`);
    let source;
    try {
      const buffer = typeof input === 'string' ? await fetch(input).then(r => { if (!r.ok) throw new Error('Animation file not found.'); return r.arrayBuffer(); }) : await input.arrayBuffer();
      if (current !== model) return;
      source = new FBXLoader().parse(buffer, '');
      if (!source.animations.length) throw new Error('This FBX contains no animation clips.');
      model.mixer.stopAllAction(); model.action = null; model.mixer.update(0);
      $('animation-toggle').disabled = true;
      // Retarget in the asset's coordinate system, independent of display framing.
      model.wrapper.remove(model.root); model.root.updateMatrixWorld(true);
      let clips;
      try { clips = source.animations.map(clip => retargetAnimation(model.root, source, clip)); }
      finally { model.wrapper.add(model.root); }
      const index = model.clips.length;
      clips.forEach((clip, i) => { clip.name = clips.length === 1 ? name.replace(/\.fbx$/i, '') : `${name} · ${i + 1}`; model.clips.push(clip); });
      listClips(index); status(`Added ${name}.`); invalidate();
    } catch (error) { status(`Could not add animation: ${error.message}`); console.error(error); }
    finally { if (source) disposeModel(source); }
  }
  async function files(files) {
    const list = [...files], model = list.find(f => /\.glb$/i.test(f.name));
    const previous = current;
    if (model) await loadModel(model, model.name);
    if (model && current === previous) return;
    if(model && current) {
      const panel=document.querySelector('.model-panel');panel.hidden=false;panel.open=true;
    }
    const animation = list.find(f => /\.fbx$/i.test(f.name));
    if (animation) await loadAnimation(animation, animation.name);
    if (!model && !animation) status('Choose a .glb model or an .fbx animation.');
  }
  $('import-model').onclick = () => $('model-file').click();
  $('model-file').onchange = e => { files(e.target.files); e.target.value = ''; };
  $('import-animation').onclick = () => $('animation-file').click();
  $('animation-file').onchange = e => { files(e.target.files); e.target.value = ''; };
  $('remove-model').onclick = clear;
  $('model-animation').onchange = e => play(Number(e.target.value));
  $('animation-toggle').onclick = () => { if (current?.action) { current.action.paused = !current.action.paused; $('animation-toggle').textContent = current.action.paused ? 'Play animation' : 'Pause animation'; invalidate(); } };
  let depth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); depth++; document.body.classList.add('file-drag'); } });
  window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('file-drag'); } });
  window.addEventListener('drop', e => { e.preventDefault(); depth = 0; document.body.classList.remove('file-drag'); files(e.dataTransfer.files); });
  return {
    clear,
    loadSample(key,name) { return loadModel(`./samples/${key}.glb`,name,key); },
    get sampleKey() { return current?.sampleKey ?? null; },
    get active() { return !!current; },
    get peelingStats() { return current?.peeling?.stats() ?? null; },
    repaint() { current?.peeling?.repaint(); },
    setAppearance() { if(current){configurePeeling();invalidate();} },
    update(dt) {
      let dirty=current?.peeling?.update(dt)??false;
      if(current?.action&&!current.action.paused) { current.mixer.update(dt);dirty=true; }
      return dirty;
    }
  };
}

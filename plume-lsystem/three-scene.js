import { generateFeatherData, rewriteFeatherGrammar } from './feather-generator.js';
import { makeFlight, advanceFlight } from './flight.js';
import * as THREE from 'https://esm.sh/three@0.170.0?target=es2022';
import { OrbitControls } from 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js?target=es2022';
import { EffectComposer } from 'https://esm.sh/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js?target=es2022';
import { RenderPass } from 'https://esm.sh/three@0.170.0/examples/jsm/postprocessing/RenderPass.js?target=es2022';
import { UnrealBloomPass } from 'https://esm.sh/three@0.170.0/examples/jsm/postprocessing/UnrealBloomPass.js?target=es2022';
import { OutputPass } from 'https://esm.sh/three@0.170.0/examples/jsm/postprocessing/OutputPass.js?target=es2022';

const DEG = Math.PI / 180;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setClearColor(0x020307, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0, 24);
scene.add(camera);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.75;
controls.minDistance = 12;
controls.maxDistance = 38;
controls.target.set(0, 0, 0);
controls.update();

const root = new THREE.Group();
scene.add(root);
const helperGroup = new THREE.Group();
scene.add(helperGroup);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.15, 0.72, 0.18);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let seed = 41102;
let depth = 3;
let density = 0.78;
let wind = 0.30;
let spacing = 0.95;
let branchAngle = 26 * DEG;
let drawableSize = false;
let lastWidth = 0;
let lastHeight = 0;
let activeHandle = null;
let hoverHandle = null;
let pointerHeld = false;
const holdPointer = new THREE.Vector3();
let heldPointerId = null;

const initialSpline = [
  new THREE.Vector3(-3.8, -5.0, 0),
  new THREE.Vector3(-2.1, -2.0, 0),
  new THREE.Vector3(-0.4, 0.8, 0),
  new THREE.Vector3(1.5, 3.2, 0),
  new THREE.Vector3(3.4, 5.9, 0)
];
const state = {
  points: initialSpline.map((p) => p.clone()),
  grammar: { axiom: 'X', X: 'F[+X][-X]', F: 'FF' },
  feathers: [],
  handles: [],
  pickable: [],
  curveLine: null,
  curve: null
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const scratch = new THREE.Vector3();
const clock = new THREE.Clock();

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lineObject(store, alpha) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(store.p, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(store.c, 3));
  geo.computeBoundingSphere();
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: alpha,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  return new THREE.LineSegments(geo, mat);
}
function rewriteGrammar() { return rewriteFeatherGrammar(state.grammar, depth); }
function makeSparkTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 64;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,249,217,1)');
  grad.addColorStop(0.13, 'rgba(255,226,172,.83)');
  grad.addColorStop(0.42, 'rgba(255,190,118,.28)');
  grad.addColorStop(1, 'rgba(255,181,112,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cvs);
}
const sparkMaterial = new THREE.PointsMaterial({
  color: 0xffd5a0,
  size: 0.18,
  transparent: true,
  opacity: 0.75,
  map: makeSparkTexture(),
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true
});
function generateFeather(length, spread, variation, phrase) {
  const {shaft, barbs, hairs, particles} = generateFeatherData({length, spread, variation, phrase, seed, depth, density, branchAngle});
  const g = new THREE.Group();
  g.add(lineObject(hairs, 0.58));
  g.add(lineObject(barbs, 0.66));
  g.add(lineObject(shaft, 0.83));
  if (particles.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(particles, 3));
    g.add(new THREE.Points(geo, sparkMaterial));
  }
  return g;
}
function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material && obj.material !== sparkMaterial) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}
function rebuildCurve() {
  const curve = new THREE.CatmullRomCurve3(state.points.map((p) => p.clone()), false, 'catmullrom', 0.5);
  state.curve = curve;
  const samplePoints = curve.getPoints(220);
  if (!state.curveLine) {
    const geo = new THREE.BufferGeometry().setFromPoints(samplePoints);
    const mat = new THREE.LineBasicMaterial({ color: 0xe8c696, transparent: true, opacity: 0.42, toneMapped: false });
    state.curveLine = new THREE.Line(geo, mat);
    helperGroup.add(state.curveLine);
  } else {
    state.curveLine.geometry.dispose();
    state.curveLine.geometry = new THREE.BufferGeometry().setFromPoints(samplePoints);
  }
  for (let i = 0; i < state.points.length; i++) {
    const handle = state.handles[i];
    if (handle) handle.position.copy(state.points[i]);
  }
}
function updatePointCount() {
  document.getElementById('pointCount').textContent = `(${state.points.length})`;
}
function rebuildFeathers(reseed = false, regenerateGeometry = true) {
  if (reseed) seed = Math.floor(Math.random() * 900000) + 10000;
  rebuildCurve();
  const phrase = regenerateGeometry ? rewriteGrammar() : '';
  if (regenerateGeometry) {
    for (const f of state.feathers) { root.remove(f.group); disposeGroup(f.group); }
    state.feathers.length = 0;
  }
  const total = state.curve.getLength();
  const count = clamp(Math.floor(total / spacing) + 1, 2, 65);
  for (let i = 0; i < count; i++) {
    const dist = Math.min(total, i * spacing);
    const t = total > 0 ? dist / total : 0;
    const point = state.curve.getPointAt(t);
    const tangent = state.curve.getTangentAt(t).normalize();
    const angle = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
    let f = state.feathers[i];
    if (!f) {
      const envelope = Math.pow(Math.sin(t * Math.PI), 0.72);
      const length = 3.9 + envelope * 1.55;
      const spread = 0.84 + envelope * 0.42;
      const group = generateFeather(length, spread, i + 1, phrase || rewriteGrammar());
      root.add(group);
      f = {
        group,
        basePosition: point.clone(),
        angle,
        phase: i * 1.37,
        flight: makeFlight(seed, i, point.x, point.y, point.z, angle),
        t
      };
      group.position.copy(point);
      group.rotation.z = angle;
      state.feathers[i] = f;
    }
    f.basePosition.copy(point);
    f.angle = angle;
    f.t = t;
  }
  while (state.feathers.length > count) {
    const f = state.feathers.pop();
    root.remove(f.group);
    disposeGroup(f.group);
  }
  document.getElementById('featherCount').textContent = String(state.feathers.length).padStart(2, '0') + ' feathers';
  updatePointCount();
}
function insertSplinePoint(t) {
  if (state.points.length >= 36) return;
  const segments = state.points.length - 1;
  const localT = clamp(t, 0.001, 0.999);
  const index = Math.min(segments - 1, Math.floor(localT * segments));
  const position = state.curve.getPoint(localT);
  state.points.splice(index + 1, 0, position.clone());
  buildHandles();
  rebuildFeathers(false, false);
}
function insertMidpoint() {
  if (state.points.length >= 36) return;
  let bestIndex = 0;
  let longest = -1;
  for (let i = 0; i < state.points.length - 1; i++) {
    const d = state.points[i].distanceTo(state.points[i + 1]);
    if (d > longest) { longest = d; bestIndex = i; }
  }
  insertSplinePoint((bestIndex + 0.5) / (state.points.length - 1));
}
function closestCurve(event) {
  if (!drawableSize) return -1;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let bestD2 = 20 * 20;
  let bestT = -1;
  camera.updateMatrixWorld();
  for (let i = 1; i < 300; i++) {
    const t = i / 300;
    const projected = state.curve.getPoint(t).project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const px = (projected.x * 0.5 + 0.5) * rect.width;
    const py = (-projected.y * 0.5 + 0.5) * rect.height;
    const d2 = (px - x) ** 2 + (py - y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; bestT = t; }
  }
  return bestT;
}
function buildHandles() {
  while (state.handles.length) {
    const handle = state.handles.pop();
    helperGroup.remove(handle);
    disposeGroup(handle);
  }
  state.pickable.length = 0;
  const geometry = new THREE.SphereGeometry(0.16, 16, 16);
  for (let i = 0; i < state.points.length; i++) {
    const material = new THREE.MeshBasicMaterial({ color: 0xe4bd84, transparent: true, opacity: 0.95, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(state.points[i]);
    mesh.userData.handleIndex = i;
    helperGroup.add(mesh);
    state.handles.push(mesh);
    state.pickable.push(mesh);
  }
}
function resize() {
  const box = canvas.getBoundingClientRect();
  const w = Math.floor(box.width);
  const h = Math.floor(box.height);
  if (w < 2 || h < 2) {
    drawableSize = false;
    return;
  }
  if (w === lastWidth && h === lastHeight && drawableSize) return;
  lastWidth = w;
  lastHeight = h;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  drawableSize = true;
}
function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}
function pickHandle(event) {
  setPointer(event);
  const intersects = raycaster.intersectObjects(state.pickable, false);
  return intersects.length ? intersects[0].object : null;
}
function dragIntersection() {
  if (!raycaster.ray.intersectPlane(dragPlane, scratch)) return null;
  return scratch.clone();
}
function updateHandleMaterials() {
  for (const handle of state.handles) {
    const active = activeHandle === handle;
    const hover = hoverHandle === handle;
    handle.material.color.set(active ? 0xffefcd : hover ? 0xf3d4a9 : 0xe4bd84);
  }
}
function bindSlider(id, format, callback, rebuild = false) {
  const input = document.getElementById(id);
  const output = document.getElementById(id + 'Value');
  const update = () => {
    const value = Number(input.value);
    output.textContent = format(value);
    callback(value);
    if (rebuild) rebuildFeathers(false, rebuild === 'geometry');
  };
  input.addEventListener('input', update);
  update();
}
function debounce(fn, delay = 180) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
function bindText(id, key) {
  const input = document.getElementById(id);
  state.grammar[key] = input.value;
  input.addEventListener('input', debounce(() => {
    state.grammar[key] = input.value || '';
    rebuildFeathers(false);
  }, 160));
}

window.addEventListener('resize', resize, { passive: true });
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
resize();
buildHandles();
rebuildFeathers(false);

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  setPointer(event);
  const point = dragIntersection();
  if (point) holdPointer.copy(point);
  if (event.shiftKey && !pickHandle(event)) {
    const t = closestCurve(event);
    if (t >= 0) {
      insertSplinePoint(t);
      event.preventDefault();
      return;
    }
  }
  const handle = pickHandle(event);
  if (!handle) {
    if (heldPointerId === null) {
      pointerHeld = true;
      heldPointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    }
    return;
  }
  activeHandle = handle;
  hoverHandle = handle;
  controls.enabled = false;
  canvas.setPointerCapture(event.pointerId);
  updateHandleMaterials();
  event.preventDefault();
});
canvas.addEventListener('pointermove', (event) => {
  setPointer(event);
  const planePoint = dragIntersection();
  if (planePoint) holdPointer.copy(planePoint);
  if (activeHandle) {
    if (planePoint) {
      state.points[activeHandle.userData.handleIndex].copy(planePoint);
      rebuildFeathers(false, false);
    }
  } else {
    const handle = pickHandle(event);
    hoverHandle = handle;
    canvas.style.cursor = handle ? 'grab' : 'default';
    updateHandleMaterials();
  }
});
function release(event) {
  if (heldPointerId === event.pointerId) {
    pointerHeld = false;
    heldPointerId = null;
  }
  activeHandle = null;
  controls.enabled = true;
  updateHandleMaterials();
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', () => {
  pointerHeld = false;
  heldPointerId = null;
  activeHandle = null;
  controls.enabled = true;
  updateHandleMaterials();
});
window.addEventListener('blur', () => {
  pointerHeld = false;
  heldPointerId = null;
  activeHandle = null;
  controls.enabled = true;
});
canvas.addEventListener('dblclick', (event) => {
  if (pickHandle(event)) return;
  const t = closestCurve(event);
  if (t >= 0) {
    insertSplinePoint(t);
    event.preventDefault();
  }
});

bindSlider('depth', (n) => String(n), (n) => { depth = n; }, 'geometry');
bindSlider('density', (n) => `${n}%`, (n) => { density = n / 100; }, 'geometry');
bindSlider('spacing', (n) => Number(n).toFixed(2), (n) => { spacing = n; }, 'layout');
bindSlider('angle', (n) => `${n}°`, (n) => { branchAngle = n * DEG; }, 'geometry');
bindSlider('wind', (n) => `${n}%`, (n) => { wind = n / 100; });
bindSlider('glow', (n) => `${n}%`, (n) => { bloom.strength = 0.2 + n * 0.013; });
bindText('axiom', 'axiom');
bindText('ruleX', 'X');
bindText('ruleF', 'F');

document.getElementById('regenerate').addEventListener('click', () => rebuildFeathers(true, true));
document.getElementById('addPoint').addEventListener('click', insertMidpoint);
document.getElementById('resetSpline').addEventListener('click', () => {
  state.points = initialSpline.map((p) => p.clone());
  buildHandles();
  rebuildFeathers(false, false);
});
window.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (tag && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
  if (event.key.toLowerCase() === 'r') rebuildFeathers(true, true);
});

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  controls.update();
  for (const f of state.feathers) {
    const motion = reducedMotion ? 0 : wind;
    const sway = Math.sin(t * 0.47 + f.phase) * 0.09 * motion;
    const bob = Math.cos(t * 0.59 + f.phase * 0.7) * 0.082 * motion;
    advanceFlight(f.flight, {
      x: f.basePosition.x + sway,
      y: f.basePosition.y + bob,
      z: f.basePosition.z,
      angle: f.angle + Math.sin(t * 0.55 + f.phase) * motion * 0.06
    }, {
      dt, time: t, held: pointerHeld, wind,
      pointerX: holdPointer.x, pointerY: holdPointer.y
    });
    f.group.position.set(f.flight.x, f.flight.y, f.flight.z);
    f.group.rotation.z = f.flight.angle;
    f.group.rotation.y = Math.sin(t * 0.39 + f.phase) * motion * 0.13 +
      (pointerHeld ? Math.sin(t * 0.9 + f.phase) * 0.22 : 0);
    f.group.rotation.x = Math.cos(t * 0.32 + f.phase) * motion * 0.09 +
      (pointerHeld ? Math.cos(t * 1.2 + f.phase) * 0.14 : 0);
  }
  if (!drawableSize) resize();
  if (drawableSize && !document.hidden) composer.render();
}
animate();
document.getElementById('loading').classList.add('hidden');
setTimeout(() => document.getElementById('loading')?.remove(), 1100);

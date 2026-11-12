import { makeFlight, advanceFlight } from './flight.js';
import {seededRandom} from './random.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: true });

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const TAN_HALF_FOV = Math.tan((38 * DEG) / 2);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let seed = 41102;
let depth = 3;
let density = 0.78;
let wind = 0.30;
let glow = 0.75;
let spacing = 0.95;
let branchAngle = 26 * DEG;
let zoom = 23;
let viewW = 0;
let viewH = 0;
let viewDPR = 1;
let scale = 1;
let time = 0;
let frameTime = performance.now();
let hoverHandle = -1;
let activeHandle = -1;
let pointerHeld = false;
let holdPointer = { x: 0, y: 0 };
let heldPointerId = null;

const initialSpline = [
  { x: -3.8, y: -5.0 },
  { x: -2.1, y: -2.0 },
  { x: -0.4, y: 0.8 },
  { x: 1.5, y: 3.2 },
  { x: 3.4, y: 5.9 }
];
const state = {
  points: initialSpline.map((p) => ({ ...p })),
  grammar: { axiom: 'X', X: 'F[+X][-X]', F: 'FF' },
  feathers: [],
  curve: null
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function formatFixed(n) { return Number(n).toFixed(2); }
function makeStore() { return { spine: [], barbs: [], hairs: [], sparks: [] }; }
function pushSeg(target, a, b) { target.push(a.x, a.y, b.x, b.y); }
function catmull(points, t) {
  const n = points.length - 1;
  const scaled = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(scaled));
  const local = scaled - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(points.length - 1, i + 2)];
  const tt = local * local;
  const ttt = tt * local;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * local + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * local + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt)
  };
}
function catmullTangent(points, t) {
  const n = points.length - 1;
  const scaled = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(scaled));
  const local = scaled - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(points.length - 1, i + 2)];
  const tt = local * local;
  return {
    x: 0.5 * ((-p0.x + p2.x) + 2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * local + 3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt),
    y: 0.5 * ((-p0.y + p2.y) + 2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * local + 3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt)
  };
}
function buildCurveTable(points, samples = 320) {
  const table = [];
  let prev = catmull(points, 0);
  let total = 0;
  table.push({ t: 0, len: 0, point: prev });
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const point = catmull(points, t);
    total += Math.hypot(point.x - prev.x, point.y - prev.y);
    table.push({ t, len: total, point });
    prev = point;
  }
  return { table, total };
}
function sampleCurve(curve, dist) {
  const d = clamp(dist, 0, curve.total);
  const table = curve.table;
  let lo = 0;
  let hi = table.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid].len < d) lo = mid + 1;
    else hi = mid;
  }
  const b = table[lo];
  const a = table[Math.max(0, lo - 1)];
  const span = Math.max(1e-6, b.len - a.len);
  const mix = clamp((d - a.len) / span, 0, 1);
  const t = lerp(a.t, b.t, mix);
  const point = catmull(state.points, t);
  const tangent = catmullTangent(state.points, t);
  return { t, point, tangent };
}

function rewriteGrammar() {
  const rules = state.grammar;
  let symbols = (rules.axiom || 'X').trim() || 'X';
  for (let generation = 0; generation < depth; generation++) {
    let next = '';
    for (const symbol of symbols) next += rules[symbol] ?? symbol;
    if (next.length > 16000) {
      symbols = next.slice(0, 16000);
      break;
    }
    symbols = next;
  }
  return symbols;
}
function lsystemSprig(store, base, angle, step, phrase, random, vitality, phase) {
  let x = base.x;
  let y = base.y;
  let heading = angle;
  const stack = [];
  for (let i = 0; i < phrase.length; i++) {
    const symbol = phrase[i];
    if (symbol === 'F') {
      const s = step * (0.84 + random() * 0.3);
      const nx = x + Math.cos(heading) * s;
      const ny = y + Math.sin(heading) * s;
      pushSeg(store.hairs, { x, y }, { x: nx, y: ny });
      x = nx;
      y = ny;
    } else if (symbol === '+') {
      heading += branchAngle * (0.7 + random() * 0.6);
    } else if (symbol === '-') {
      heading -= branchAngle * (0.7 + random() * 0.6);
    } else if (symbol === '[') {
      stack.push([x, y, heading]);
    } else if (symbol === ']') {
      const last = stack.pop();
      if (last) [x, y, heading] = last;
    }
  }
}
function geometry(length, spread, id, phrase) {
  const random = seededRandom(seed * 199 + id * 6389 + 91);
  const store = makeStore();
  const bow = (random() - 0.5) * 0.8;
  const curl = (random() - 0.5) * 0.32;
  const twist = random() * Math.PI * 2;
  const axis = (t) => ({
    x: bow * t * t + Math.sin(t * 4.5 + twist) * 0.12 * t + curl * Math.pow(t, 3),
    y: (t - 0.48) * length
  });
  for (let i = 0; i < 66; i++) pushSeg(store.spine, axis(i / 66), axis((i + 1) / 66));

  const rows = Math.round((83 + depth * 12) * density);
  for (let row = 0; row < rows; row++) {
    const t = (row + 0.8) / (rows + 1);
    const axisPos = axis(t);
    const envelope = Math.pow(Math.sin(t * Math.PI), 0.77);
    const breakup = 0.77 + 0.44 * random();
    const luminance = 0.6 + 0.38 * Math.sin(t * Math.PI) + 0.22 * random();
    for (const side of [-1, 1]) {
      const reach = spread * envelope * breakup * (0.85 + random() * 0.3) * (side === 1 ? 1 : 0.91);
      const yLean = reach * (0.34 + 0.2 * t) * (side === 1 ? 1.0 : 0.83);
      const waviness = (random() - 0.5) * 0.16;
      const barbPoint = (u) => {
        const ease = Math.pow(u, 0.83);
        return {
          x: axisPos.x + side * reach * ease + Math.sin(u * Math.PI) * waviness,
          y: axisPos.y + yLean * u + Math.sin(u * Math.PI) * reach * 0.085
        };
      };
      let previous = axisPos;
      for (let k = 1; k <= 7; k++) {
        const u = k / 7;
        const point = barbPoint(u);
        pushSeg(store.barbs, previous, point);
        previous = point;
      }
      const fuzzCount = 5 + Math.round(density * 3);
      for (let k = 0; k < fuzzCount; k++) {
        const u = 0.15 + 0.81 * (k + random() * 0.25) / fuzzCount;
        const start = barbPoint(u);
        const hairLength = (0.11 + random() * 0.3) * envelope * (0.65 + random() * 0.45);
        const dy = hairLength * (random() - 0.30);
        const dx = side * hairLength * (0.34 + random() * 0.65);
        const mid = { x: start.x + dx * 0.56, y: start.y + dy * 0.37 };
        const end = { x: start.x + dx, y: start.y + dy };
        pushSeg(store.hairs, start, mid);
        pushSeg(store.hairs, mid, end);
        if (random() > 0.982) store.sparks.push(end.x, end.y);
      }
      if (row % 3 === 0 && t > 0.065 && t < 0.965) {
        const sprigBase = barbPoint(0.39 + random() * 0.29);
        const heading = side === 1 ? (0.32 + random() * 0.64) : (Math.PI - 0.32 - random() * 0.64);
        const step = (0.036 + 0.037 * envelope) * (spread / 1.15);
        lsystemSprig(store, sprigBase, heading, step, phrase, random, luminance * 0.58, twist + t * 5);
      }
      if (row % 6 === 0 && random() > 0.45) {
        const p = barbPoint(0.67 + random() * 0.3);
        store.sparks.push(p.x, p.y);
      }
    }
  }
  return store;
}
function makeCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}
function drawLines(context, flat, width, color) {
  if (!flat.length) return;
  context.lineWidth = width;
  context.strokeStyle = color;
  context.beginPath();
  for (let i = 0; i < flat.length; i += 4) {
    context.moveTo(flat[i], flat[i + 1]);
    context.lineTo(flat[i + 2], flat[i + 3]);
  }
  context.stroke();
}
function bakeFeather(length, spread, id, phrase) {
  const g = geometry(length, spread, id, phrase);
  const w = Math.ceil((spread * 3.5 + 2.3) * 110);
  const h = Math.ceil((length + 3.1) * 110);
  const bright = makeCanvas(w, h);
  const b = bright.getContext('2d', { alpha: true });
  b.translate(w / 2, h / 2);
  b.scale(110, -110);
  b.lineCap = 'round';
  b.lineJoin = 'round';
  b.globalCompositeOperation = 'lighter';
  drawLines(b, g.hairs, 0.008, 'rgba(250,192,122,.31)');
  drawLines(b, g.barbs, 0.012, 'rgba(249,197,137,.55)');
  drawLines(b, g.spine, 0.018, 'rgba(255,218,160,.88)');
  b.fillStyle = 'rgba(255,235,185,.69)';
  for (let i = 0; i < g.sparks.length; i += 2) {
    b.beginPath();
    b.arc(g.sparks[i], g.sparks[i + 1], 0.013, 0, TAU);
    b.fill();
  }
  const halo = makeCanvas(w, h);
  const hctx = halo.getContext('2d', { alpha: true });
  hctx.filter = 'blur(12px)';
  hctx.globalAlpha = 0.98;
  hctx.drawImage(bright, 0, 0);
  hctx.filter = 'blur(31px)';
  hctx.globalCompositeOperation = 'lighter';
  hctx.globalAlpha = 0.72;
  hctx.drawImage(bright, 0, 0);
  return { bright, halo, w, h, worldW: w / 110, worldH: h / 110 };
}
function updatePointCount() {
  document.getElementById('pointCount').textContent = `(${state.points.length})`;
}
function rebuildSystem(reseed = false, rebuildGeometry = true) {
  if (reseed) seed = Math.floor(Math.random() * 900000) + 10000;
  state.curve = buildCurveTable(state.points);
  const phrase = rebuildGeometry ? rewriteGrammar() : '';
  const old = rebuildGeometry ? [] : state.feathers;
  const feathers = [];
  const total = state.curve.total;
  const count = clamp(Math.floor(total / spacing) + 1, 2, 65);
  for (let i = 0; i < count; i++) {
    const dist = Math.min(total, i * spacing);
    const sample = sampleCurve(state.curve, dist);
    const tangent = sample.tangent;
    const angle = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
    let feather = old[i];
    if (!feather) {
      const envelope = Math.pow(Math.sin(sample.t * Math.PI), 0.72);
      const length = 3.9 + envelope * 1.55;
      const spread = 0.84 + envelope * 0.42;
      const sprite = bakeFeather(length, spread, i + 1, phrase || rewriteGrammar());
      feather = {
        id: i + 1,
        length,
        spread,
        sprite,
        flight: makeFlight(seed, i, sample.point.x, sample.point.y, 0, angle),
        phase: i * 1.37
      };
    }
    feather.baseX = sample.point.x;
    feather.baseY = sample.point.y;
    feather.baseAngle = angle;
    feather.t = sample.t;
    feathers.push(feather);
  }
  state.feathers = feathers;
  document.getElementById('featherCount').textContent = String(feathers.length).padStart(2, '0') + ' feathers';
  updatePointCount();
}
function insertSplinePoint(t) {
  if (state.points.length >= 36) return;
  const segmentCount = state.points.length - 1;
  const localT = clamp(t, 0.001, 0.999);
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(localT * segmentCount));
  const point = catmull(state.points, localT);
  state.points.splice(segmentIndex + 1, 0, point);
  rebuildSystem(false, false);
}
function insertMidpoint() {
  if (state.points.length >= 36) return;
  let selectedIndex = 0;
  let maxLength = -1;
  for (let i = 0; i < state.points.length - 1; i++) {
    const a = state.points[i];
    const b = state.points[i + 1];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > maxLength) { maxLength = d; selectedIndex = i; }
  }
  insertSplinePoint((selectedIndex + 0.5) / (state.points.length - 1));
}
function closestCurve(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let bestDist2 = 20 * 20;
  let bestT = -1;
  for (const item of state.curve.table) {
    const s = worldToScreen(item.point);
    const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d2 < bestDist2) { bestDist2 = d2; bestT = item.t; }
  }
  return bestT;
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    viewW = 0;
    viewH = 0;
    return;
  }
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.7);
  if (viewW !== w || viewH !== h || viewDPR !== dpr) {
    viewW = w;
    viewH = h;
    viewDPR = dpr;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
  }
  scale = h / (2 * zoom * TAN_HALF_FOV) * Math.min(1, Math.max(0.57, (w / h) * 1.2));
}
function worldToScreen(p) {
  return { x: viewW / 2 + p.x * scale, y: viewH / 2 - p.y * scale };
}
function screenToWorld(x, y) {
  return { x: (x - viewW / 2) / scale, y: -(y - viewH / 2) / scale };
}
function handleHit(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best = -1;
  let dist = 14;
  for (let i = 0; i < state.points.length; i++) {
    const s = worldToScreen(state.points[i]);
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}
function drawSprite(image, size, alpha) {
  if (alpha <= 0) return;
  const sw = size.worldW * scale;
  const sh = size.worldH * scale;
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, -sw * 0.5, -sh * 0.5, sw, sh);
}
function draw(now) {
  requestAnimationFrame(draw);
  const dt = Math.min(0.05, Math.max(0, (now - frameTime) / 1000));
  frameTime = now;
  if (document.hidden || viewW < 2 || viewH < 2) return;
  time += dt;
  ctx.setTransform(viewDPR, 0, 0, viewDPR, 0, 0);
  ctx.clearRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const feather of state.feathers) {
    const motion = reducedMotion ? 0 : wind;
    const sway = Math.sin(time * 0.47 + feather.phase) * 0.09 * motion;
    const bob = Math.cos(time * 0.59 + feather.phase * 0.7) * 0.082 * motion;
    advanceFlight(feather.flight, {
      x: feather.baseX + sway,
      y: feather.baseY + bob,
      z: 0,
      angle: feather.baseAngle + Math.sin(time * 0.55 + feather.phase) * motion * 0.06
    }, {
      dt, time, held: pointerHeld, wind,
      pointerX: holdPointer.x, pointerY: holdPointer.y
    });
    ctx.save();
    ctx.translate(viewW / 2 + feather.flight.x * scale, viewH / 2 - feather.flight.y * scale);
    ctx.rotate(-feather.flight.angle);
    drawSprite(feather.sprite.halo, feather.sprite, Math.min(1, glow * (0.92 + (pointerHeld ? 0.1 : 0))));
    drawSprite(feather.sprite.bright, feather.sprite, 0.92);
    ctx.restore();
  }
  ctx.restore();

  if (state.curve) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(232, 198, 150, 0.35)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const p = worldToScreen(catmull(state.points, i / 180));
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    for (let i = 0; i < state.points.length; i++) {
      const p = worldToScreen(state.points[i]);
      ctx.beginPath();
      ctx.fillStyle = i === activeHandle ? 'rgba(255,231,193,0.98)' : (i === hoverHandle ? 'rgba(243,212,169,0.92)' : 'rgba(228,189,132,0.88)');
      ctx.strokeStyle = 'rgba(74,56,40,0.95)';
      ctx.lineWidth = 2;
      ctx.arc(p.x, p.y, 7, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
function bindSlider(id, format, callback, rebuild = false) {
  const input = document.getElementById(id);
  const output = document.getElementById(id + 'Value');
  const update = () => {
    const value = Number(input.value);
    output.textContent = format(value);
    callback(value);
    if (rebuild) rebuildSystem(false, rebuild === 'geometry');
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
  const commit = debounce(() => {
    state.grammar[key] = input.value || '';
    rebuildSystem(false, true);
  }, 160);
  input.addEventListener('input', commit);
  state.grammar[key] = input.value;
}

window.addEventListener('resize', resize, { passive: true });
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
resize();

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  holdPointer.x = world.x;
  holdPointer.y = world.y;
  if (event.shiftKey && handleHit(event) < 0) {
    const t = closestCurve(event);
    if (t >= 0) {
      insertSplinePoint(t);
      event.preventDefault();
      return;
    }
  }
  const hit = handleHit(event);
  activeHandle = hit;
  hoverHandle = hit;
  if (hit >= 0) {
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  } else if (heldPointerId === null) {
    pointerHeld = true;
    heldPointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
  }
});
canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const world = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  holdPointer.x = world.x;
  holdPointer.y = world.y;
  if (activeHandle >= 0) {
    state.points[activeHandle].x = world.x;
    state.points[activeHandle].y = world.y;
    rebuildSystem(false, false);
  } else {
    hoverHandle = handleHit(event);
    canvas.style.cursor = hoverHandle >= 0 ? 'grab' : 'default';
  }
});
function releaseHandle(event) {
  if (heldPointerId === event.pointerId) {
    pointerHeld = false;
    heldPointerId = null;
  }
  activeHandle = -1;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup', releaseHandle);
canvas.addEventListener('pointercancel', releaseHandle);
canvas.addEventListener('lostpointercapture', () => {
  pointerHeld = false;
  heldPointerId = null;
  activeHandle = -1;
});
window.addEventListener('blur', () => { pointerHeld = false; heldPointerId = null; activeHandle = -1; });
canvas.addEventListener('dblclick', (event) => {
  if (handleHit(event) >= 0) return;
  const t = closestCurve(event);
  if (t >= 0) {
    insertSplinePoint(t);
    event.preventDefault();
  }
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoom = clamp(zoom + event.deltaY * 0.015, 16, 38);
  resize();
}, { passive: false });

bindSlider('depth', (n) => String(n), (n) => { depth = n; }, 'geometry');
bindSlider('density', (n) => n + '%', (n) => { density = n / 100; }, 'geometry');
bindSlider('spacing', (n) => formatFixed(n), (n) => { spacing = n; }, 'layout');
bindSlider('angle', (n) => n + '°', (n) => { branchAngle = n * DEG; }, 'geometry');
bindSlider('wind', (n) => n + '%', (n) => { wind = n / 100; });
bindSlider('glow', (n) => n + '%', (n) => { glow = n / 100; });
bindText('axiom', 'axiom');
bindText('ruleX', 'X');
bindText('ruleF', 'F');

document.getElementById('regenerate').addEventListener('click', () => rebuildSystem(true, true));
document.getElementById('addPoint').addEventListener('click', insertMidpoint);
document.getElementById('resetSpline').addEventListener('click', () => {
  state.points = initialSpline.map((p) => ({ ...p }));
  rebuildSystem(false, false);
});
window.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (tag && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
  if (event.key.toLowerCase() === 'r') rebuildSystem(true, true);
});

rebuildSystem(false);
requestAnimationFrame(draw);
const loading = document.getElementById('loading');
loading?.classList.add('hidden');
setTimeout(() => loading?.remove(), 1100);

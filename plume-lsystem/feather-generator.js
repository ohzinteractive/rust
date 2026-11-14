import {seededRandom} from './random.js';

// Shared filament geometry for the spline study and mesh feather material.
function makeStore() { return { p: [], c: [] }; }
function seg(store, a, b, powerA, powerB, warmth = 0) {
  const r = 1.19 + warmth * 0.17;
  const g = 0.78 + warmth * 0.09;
  const blue = 0.48 + warmth * 0.08;
  store.p.push(a.x, a.y, a.z, b.x, b.y, b.z);
  store.c.push(r * powerA, g * powerA, blue * powerA, r * powerB, g * powerB, blue * powerB);
}
export function rewriteFeatherGrammar(rules, depth = 3) {
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
function lsystemSprig(store, base, angle, step, phrase, random, vitality, phase, branchAngle, randomness) {
  let x = base.x;
  let y = base.y;
  let z = base.z;
  let heading = angle;
  const stack = [];
  for (let i = 0; i < phrase.length; i++) {
    const symbol = phrase[i];
    if (symbol === 'F') {
      const jitter = 0.84 + random() * 0.3;
      const s = step * (jitter + (1 - jitter) * (1 - randomness));
      const nx = x + Math.cos(heading) * s;
      const ny = y + Math.sin(heading) * s;
      const nz = z + Math.sin(phase + i * 0.25) * s * 0.18 * randomness;
      seg(store, { x, y, z }, { x: nx, y: ny, z: nz }, vitality * (0.77 + random() * 0.2), vitality * (0.48 + random() * 0.2), 0.25);
      x = nx;
      y = ny;
      z = nz;
    } else if (symbol === '+') {
      const jitter = 0.7 + random() * 0.6;
      heading += branchAngle * (jitter + (1 - jitter) * (1 - randomness));
    } else if (symbol === '-') {
      const jitter = 0.7 + random() * 0.6;
      heading -= branchAngle * (jitter + (1 - jitter) * (1 - randomness));
    } else if (symbol === '[') {
      stack.push([x, y, z, heading]);
    } else if (symbol === ']') {
      const last = stack.pop();
      if (last) [x, y, z, heading] = last;
    }
  }
}
export function generateFeatherData({length = 5, spread = 1.15, variation = 1, seed = 41102,
  depth = 3, density = .78, branchAngle = 26 * Math.PI / 180, quillFraction = 0, contour = false, branchLength = 1, branchRandomness = 1,
  phrase = rewriteFeatherGrammar({axiom:'X', X:'F[+X][-X]', F:'FF'}, depth)} = {}) {
  branchRandomness = Math.max(0,Math.min(1,branchRandomness));
  const random = seededRandom(seed * 199 + variation * 6389 + 91);
  const shaft = makeStore();
  const barbs = makeStore();
  const hairs = makeStore();
  const particles = [];
  const bow = (random() - 0.5) * 0.8;
  const curl = (random() - 0.5) * 0.32;
  const twist = random() * Math.PI * 2;
  const axis = (t) => ({
    x: bow * t * t + Math.sin(t * 4.5 + twist) * 0.12 * t + curl * Math.pow(t, 3),
    y: (t - 0.48) * length,
    z: Math.sin(t * 5 + twist) * 0.22 * t
  });
  for (let i = 0; i < 66; i++) seg(shaft, axis(i / 66), axis((i + 1) / 66), 0.88 + Math.sin(i / 66 * Math.PI) * 0.55, 0.85 + Math.sin((i + 1) / 66 * Math.PI) * 0.56, 0.5);
  const rows = Math.round((83 + depth * 12) * density);
  for (let row = 0; row < rows; row++) {
    const t = (row + 0.8) / (rows + 1);
    if (t < quillFraction) continue;
    const axisPos = axis(t);
    const envelope = Math.pow(Math.sin((t - quillFraction) / (1 - quillFraction) * Math.PI), 0.77);
    const breakup = contour ? 1 + .022 * Math.sin(t * 13 + twist) + .012 * Math.sin(t * 27 + twist * .7) : 0.77 + 0.44 * random();
    const luminance = 0.6 + 0.38 * Math.sin(t * Math.PI) + 0.22 * random();
    for (const side of [-1, 1]) {
      const reach = spread * envelope * breakup * (contour ? 1 : 0.85 + random() * 0.3) * (side === 1 ? 1 : 0.91);
      const yLean = reach * (0.34 + 0.2 * t) * (side === 1 ? 1.0 : 0.83);
      const waviness = contour ? Math.sin(t * 8 + twist) * .02 : (random() - 0.5) * 0.16;
      const barbPoint = (u) => {
        const ease = Math.pow(u, 0.83);
        return {
          x: axisPos.x + side * reach * ease + Math.sin(u * Math.PI) * waviness,
          y: axisPos.y + yLean * u + Math.sin(u * Math.PI) * reach * 0.085,
          z: axisPos.z + Math.sin(u * 2.4 + twist + t * 5 + side) * reach * 0.15
        };
      };
      let previous = axisPos;
      for (let k = 1; k <= 7; k++) {
        const u = k / 7;
        const point = barbPoint(u);
        const power = luminance * (1 - u * 0.42);
        seg(barbs, previous, point, power * 1.12, power * 0.96, 0.28);
        previous = point;
      }
      const fuzzCount = contour ? 2 + Math.round(density) : 5 + Math.round(density * 3);
      for (let k = 0; k < fuzzCount; k++) {
        const u = (contour ? .96 : .15) + (contour ? .035 : .81) * (k + random() * .25) / fuzzCount;
        const start = barbPoint(u);
        const hairLength = (contour ? .018 + random() * .035 : 0.11 + random() * 0.3) * envelope * (0.65 + random() * 0.45);
        const dy = hairLength * (random() - 0.30);
        const dx = side * hairLength * (0.34 + random() * 0.65);
        const mid = { x: start.x + dx * 0.56, y: start.y + dy * 0.37, z: start.z + (random() - 0.5) * (contour ? hairLength * .12 : .11) };
        const end = { x: start.x + dx, y: start.y + dy, z: start.z + (random() - 0.5) * (contour ? hairLength * .2 : .24) };
        seg(hairs, start, mid, luminance * (0.52 + random() * 0.28), luminance * 0.34, 0.05);
        seg(hairs, mid, end, luminance * 0.3, luminance * 0.08, 0.05);
        if (random() > 0.982) particles.push(end.x, end.y, end.z);
      }
      if (row % (contour ? 8 : 3) === 0 && t > 0.065 && t < 0.965) {
        const sprigBase = barbPoint((contour ? .97 : .39) + random() * (contour ? .025 : .29));
        const heading = side === 1 ? (0.32 + random() * 0.64) : (Math.PI - 0.32 - random() * 0.64);
        const step = (0.036 + 0.037 * envelope) * (spread / 1.15) * (contour ? .18 : 1) * branchLength;
        lsystemSprig(hairs, sprigBase, heading, step, phrase, random, luminance * 0.58, twist + t * 5, branchAngle, branchRandomness);
      }
      if (row % 6 === 0 && random() > 0.45) {
        const p = barbPoint(0.67 + random() * 0.3);
        particles.push(p.x, p.y, p.z);
      }
    }
  }
  return {shaft, barbs, hairs, particles};
}

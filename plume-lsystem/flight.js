/**
 * Small, dependency-free, deterministic flock-like wind simulation.
 * Shared by Three.js and Canvas so their interactions feel the same.
 *
 * Each feather keeps its own velocity, wandering phase and angular velocity.
 * A slowly varying shared gust gives flocking/coherence, while individual
 * curl/noise and a modest pointer repulsion make paths unpredictable.
 * Releasing the pointer switches to a damped spring around the spline anchor.
 */
export function makeFlight(seed, index, x, y, z, angle) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  const rand = () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    x, y, z, angle,
    vx: 0, vy: 0, vz: 0, angularVelocity: 0,
    phase: rand() * Math.PI * 2,
    phase2: rand() * Math.PI * 2,
    phase3: rand() * Math.PI * 2,
    rate: 0.67 + rand() * 0.67,
    flutter: (rand() - 0.5) * 2,
    lift: 0.65 + rand() * 0.75,
    spread: 0.76 + rand() * 0.6,
    flying: false
  };
}

export function advanceFlight(f, anchor, options) {
  const dt = Math.min(Math.max(options.dt, 0), 1 / 24);
  if (!dt) return;
  const time = options.time;
  const held = options.held;
  const wind = options.wind;
  const t = f.rate * time;
  const dx = f.x - options.pointerX;
  const dy = f.y - options.pointerY;
  const distance = Math.max(0.8, Math.hypot(dx, dy));
  const fromAnchorX = f.x - anchor.x;
  const fromAnchorY = f.y - anchor.y;
  const fromAnchorZ = f.z - anchor.z;

  if (held) {
    // One coherent gust, slowly shifting direction across the flock.
    const gustX = Math.sin(time * 0.37 + 0.3) * 2.1 + Math.cos(time * 0.19 + 1.9) * 1.2;
    const gustY = Math.cos(time * 0.29 - 0.5) * 1.55 + Math.sin(time * 0.46) * 0.9;

    // Spatially- and temporally-varying curl field, different for each feather.
    const curlX = Math.cos(f.y * 0.34 + t * 1.17 + f.phase) * 2.4
      + Math.sin(t * 0.65 + f.phase2) * 1.3;
    const curlY = Math.sin(f.x * 0.33 - t * 0.94 + f.phase3) * 2.3
      + Math.cos(t * 0.51 + f.phase) * 1.1;
    const escape = 2.5 / Math.max(1, distance * 0.65);
    const strength = (0.78 + wind * 1.05) * f.spread;

    let ax = strength * (gustX * 0.46 + curlX) + dx / distance * escape;
    let ay = strength * (gustY * 0.45 + curlY + f.lift * 0.48) + dy / distance * escape;
    let az = strength * (Math.sin(t * 0.77 + f.phase2) * 2.1
      + Math.cos(time * 0.38 + f.phase3) * 0.7);

    // Loose flocking/cohesion: bounded, but not attached to static targets.
    const away = Math.hypot(fromAnchorX, fromAnchorY, fromAnchorZ * 0.75);
    if (away > 9.5) {
      const pull = Math.min(2.8, (away - 9.5) * 0.5);
      ax -= fromAnchorX / away * pull;
      ay -= fromAnchorY / away * pull;
      az -= fromAnchorZ / away * pull;
    }
    // Small lift as soon as the flock starts, rather than snapping to a fixed offset.
    if (!f.flying) {
      f.vx += Math.cos(f.phase) * 0.85;
      f.vy += Math.sin(f.phase2) * 0.75 + 0.3;
      f.vz += Math.sin(f.phase3) * 0.5;
      f.angularVelocity += Math.sin(f.phase) * 0.3;
    }
    f.flying = true;
    f.vx += ax * dt;
    f.vy += ay * dt;
    f.vz += az * dt;
    const drag = Math.exp(-0.63 * dt);
    f.vx *= drag;
    f.vy *= drag;
    f.vz *= drag;
    const speed = Math.hypot(f.vx, f.vy, f.vz);
    const maxSpeed = 4.8 + 2.0 * wind;
    if (speed > maxSpeed) {
      const factor = maxSpeed / speed;
      f.vx *= factor;
      f.vy *= factor;
      f.vz *= factor;
    }
    const turn = (Math.sin(t * 1.48 + f.phase) * 1.3
      + Math.cos(time * 0.52 + f.phase3) * 0.8) * f.spread;
    f.angularVelocity = (f.angularVelocity + turn * dt) * Math.exp(-1.35 * dt);
    f.angularVelocity = Math.max(-1.8, Math.min(1.8, f.angularVelocity));
  } else {
    // Damped spring back to the spline; velocities are preserved at release.
    const spring = 15.0;
    const damping = 7.1;
    f.vx += ((anchor.x - f.x) * spring - f.vx * damping) * dt;
    f.vy += ((anchor.y - f.y) * spring - f.vy * damping) * dt;
    f.vz += ((anchor.z - f.z) * spring - f.vz * damping) * dt;
    const angleDelta = Math.atan2(Math.sin(anchor.angle - f.angle), Math.cos(anchor.angle - f.angle));
    f.angularVelocity += (angleDelta * spring - f.angularVelocity * damping) * dt;
    f.flying = false;
  }

  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.z += f.vz * dt;
  f.angle += f.angularVelocity * dt;

  if (!held) {
    // Snap tiny residual noise to rest; avoids permanent subpixel jitter.
    if (Math.hypot(anchor.x - f.x, anchor.y - f.y, anchor.z - f.z) < 0.0006
      && Math.hypot(f.vx, f.vy, f.vz) < 0.0015) {
      f.x = anchor.x;
      f.y = anchor.y;
      f.z = anchor.z;
      f.vx = f.vy = f.vz = 0;
    }
  }
}

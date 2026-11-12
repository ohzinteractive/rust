import * as CANNON from './vendor/cannon-es.js';

const FIXED_STEP = 1 / 60;
const MAX_FRAME_TIME = 0.05;
const MAX_SUBSTEPS = 3;
const SLIDING_DAMPING = Math.exp(-7 * FIXED_STEP);
const ANGULAR_DAMPING = Math.exp(-6 * FIXED_STEP);
const STATIC_GROUP = 1;
const FLAKE_GROUP = 2;
const SETTLED_GROUP = 4;

function vector(value, name, fallback) {
  const source = value ?? fallback;
  if (!source || !['x', 'y', 'z'].every(key => Number.isFinite(source[key]))) {
    throw new TypeError(`${name} must have finite x, y and z coordinates.`);
  }
  return new CANNON.Vec3(source.x, source.y, source.z);
}

function outwardFaces(vertices, faces) {
  if (!Array.isArray(faces) || faces.length < 4) throw new TypeError('A closed convex hull needs at least four faces.');
  const center = new CANNON.Vec3();
  for (const vertex of vertices) center.vadd(vertex, center);
  center.scale(1 / vertices.length, center);
  return faces.map((face, faceIndex) => {
    if (!Array.isArray(face) || face.length < 3 || !face.every(index => Number.isInteger(index) && index >= 0 && index < vertices.length)) {
      throw new TypeError(`Invalid convex face ${faceIndex}.`);
    }
    const copy = face.slice();
    const a = vertices[copy[0]], b = vertices[copy[1]], c = vertices[copy[2]];
    const ab = b.vsub(a), ac = c.vsub(a), normal = ab.cross(ac);
    if (normal.lengthSquared() < 1e-24) throw new TypeError(`Degenerate convex face ${faceIndex}.`);
    // Three.js ConvexHull produces outward faces. This also accepts a caller's
    // opposite winding without introducing inward Cannon collision normals.
    if (normal.dot(a.vsub(center)) < 0) copy.reverse();
    return copy;
  });
}

/**
 * Persistent rigid-body flake simulation. Coordinates use Three.js's Y-up axes.
 *
 * Hull vertices are centered body-local coordinates already aligned with the
 * world at release. Consequently each new body starts with identity rotation.
 * The caller retains the source vertex/material mapping and renders body poses.
 *
 * There are no timers, DOM dependencies, visibility fades, cleanup quotas or
 * automatic removals. Call step() even while corrosion/aging is paused. Only
 * clear() removes flakes; the static floor and cube remain in the world.
 */
export function createFlakePhysics({
  floorY = -1.66,
  cubePosition = { x: 0, y: 0.12, z: 0 },
  cubeQuaternion = { x: 0, y: 0, z: 0, w: 1 },
  cubeHalfExtent = 1.296,
} = {}) {
  if (!Number.isFinite(floorY)) throw new TypeError('floorY must be finite.');
  if (!Number.isFinite(cubeHalfExtent) || cubeHalfExtent <= 0) throw new TypeError('cubeHalfExtent must be positive.');
  if (!['x', 'y', 'z', 'w'].every(key => Number.isFinite(cubeQuaternion[key]))) {
    throw new TypeError('cubeQuaternion must have finite x, y, z and w components.');
  }
  const quaternionLength = Math.hypot(cubeQuaternion.x, cubeQuaternion.y, cubeQuaternion.z, cubeQuaternion.w);
  if (quaternionLength < 1e-8) throw new TypeError('cubeQuaternion must not be zero.');

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true });
  // Only moving flakes can form new contacts. Avoid visiting every pair of
  // settled fragments, and reject thin hulls using their tighter AABBs.
  world.broadphase = new class extends CANNON.Broadphase {
    constructor() { super(); this.useBoundingBoxes = true; }
    collisionPairs(world, pairs1, pairs2) {
      for (const body of activeBodies) {
        for (const other of world.bodies) {
          if (body === other || (activeBodies.has(other) && body.id > other.id)) continue;
          if (this.needBroadphaseCollision(body, other)) this.intersectionTest(body, other, pairs1, pairs2);
        }
      }
    }
  }();
  // A hull can contribute many coplanar contact points. Average their friction
  // rather than multiplying it by contact count and welding thin flakes down.
  world.narrowphase.enableFrictionReduction = true;
  world.solver.iterations = 14;
  world.solver.tolerance = 1e-7;
  world.defaultContactMaterial.friction = 0.55;
  world.defaultContactMaterial.restitution = 0.08;

  const floorMaterial = new CANNON.Material('oxide-floor');
  const cubeMaterial = new CANNON.Material('oxide-core');
  const flakeMaterial = new CANNON.Material('oxide-flakes');
  const contacts = [
    // Floor contacts damp the final bounce, then hold settled fragments still.
    [flakeMaterial, floorMaterial, { friction: 0.65, restitution: 0.12 }],
    // Released top-face pieces can slide off the specimen before hitting the
    // floor. A small outward tangential velocity must be supplied at release.
    [flakeMaterial, cubeMaterial, { friction: 0.05, restitution: 0.08 }],
    // Retained bodies remain collidable, so subsequent flakes can form a pile.
    [flakeMaterial, flakeMaterial, { friction: 0.58, restitution: 0.06 }],
  ];
  for (const [a, b, options] of contacts) {
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, {
      ...options,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 4,
      frictionEquationStiffness: 1e7,
      frictionEquationRelaxation: 4,
    }));
  }

  const floor = new CANNON.Body({ mass: 0, material: floorMaterial, collisionFilterGroup: STATIC_GROUP, collisionFilterMask: FLAKE_GROUP });
  floor.addShape(new CANNON.Plane());
  floor.position.set(0, floorY, 0);
  // Cannon Plane's default normal is +Z; rotate it onto +Y.
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);

  const cube = new CANNON.Body({ mass: 0, material: cubeMaterial, collisionFilterGroup: STATIC_GROUP, collisionFilterMask: FLAKE_GROUP });
  cube.addShape(new CANNON.Box(new CANNON.Vec3(cubeHalfExtent, cubeHalfExtent, cubeHalfExtent)));
  cube.position.copy(vector(cubePosition, 'cubePosition'));
  cube.quaternion.set(cubeQuaternion.x, cubeQuaternion.y, cubeQuaternion.z, cubeQuaternion.w);
  cube.quaternion.normalize();
  world.addBody(cube);

  const bodies = new Set();
  const activeBodies = new Set();
  const heldBodies = new Set();
  const supported = new Set();
  const settledBodies = new Set();
  const groundedBodies = new Set();
  const quietContactTime = new Map();
  const floorPoint = new CANNON.Vec3();
  let accumulator = 0;

  function constrainFloor(body, resting = false) {
    let lowest = Infinity;
    for (const vertex of body.shapes[0].vertices) {
      body.quaternion.vmult(vertex, floorPoint);
      lowest = Math.min(lowest, floorPoint.y + body.position.y);
    }
    // Keep a submillimetre contact margin while moving so Cannon still resolves
    // contact/friction on its next step. Resting pieces finish above the plane.
    const target = floorY + (resting ? 0.0005 : -0.0001);
    if (lowest < (resting ? target : floorY - 0.006)) {
      const correction = target - lowest;
      body.position.y += correction;
      body.previousPosition.y += correction;
      if (body.velocity.y < 0) body.velocity.y *= -0.1;
      body.aabbNeedsUpdate = true;
    }
  }

  function settle(body) {
    if (settledBodies.has(body)) return;
    constrainFloor(body, true);
    body.sleep();
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.updateMassProperties();
    body.collisionFilterGroup = SETTLED_GROUP;
    body.collisionFilterMask = FLAKE_GROUP;
    settledBodies.add(body);
    activeBodies.delete(body);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    quietContactTime.delete(body);
  }

  function addFlake({ vertices, faces, position, velocity, angularVelocity, mass = 0.015 }) {
    if (!Array.isArray(vertices) || vertices.length < 4) throw new TypeError('A solid convex hull needs at least four vertices.');
    if (!Number.isFinite(mass) || mass <= 0) throw new TypeError('Flake mass must be positive.');
    const hullVertices = vertices.map((vertex, index) => vector(vertex, `vertices[${index}]`));
    const hullFaces = outwardFaces(hullVertices, faces);
    const shape = new CANNON.ConvexPolyhedron({ vertices: hullVertices, faces: hullFaces });
    const body = new CANNON.Body({
      mass,
      material: flakeMaterial,
      shape,
      position: vector(position, 'position'),
      velocity: vector(velocity, 'velocity', { x: 0, y: 0, z: 0 }),
      angularVelocity: vector(angularVelocity, 'angularVelocity', { x: 0, y: 0, z: 0 }),
      linearDamping: 0.22,
      angularDamping: 0.5,
      allowSleep: true,
      sleepSpeedLimit: 0.16,
      sleepTimeLimit: 0.65,
      collisionFilterGroup: FLAKE_GROUP,
      // Thin airborne sheets may pass one another. They collide with the cube,
      // floor and retained pile, avoiding unstable sheet-on-sheet chatter.
      collisionFilterMask: STATIC_GROUP | SETTLED_GROUP,
    });
    // Avoid an interpolation snap to the origin on the first rendered frame.
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.addEventListener('sleep', () => {
      // A fully settled fragment becomes a fixed part of the accumulated pile.
      // New pieces can hit it without waking an entire bed of thin fragments.
      settle(body);
    });
    body.flakeMass=mass;
    world.addBody(body);
    bodies.add(body);
    activeBodies.add(body);
    return body;
  }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    if (!activeBodies.size) { accumulator = 0; return 0; }
    accumulator += Math.min(dt, MAX_FRAME_TIME);
    let substeps = 0;
    // Explicit fixed stepping avoids Cannon's wall-clock-dependent catch-up
    // cutoff and makes headless checks repeatable. Large suspended-tab deltas
    // are bounded rather than creating a long catch-up burst or teleport.
    while (accumulator + 1e-10 >= FIXED_STEP && substeps < MAX_SUBSTEPS) {
      world.step(FIXED_STEP);
      // A positional floor constraint prevents a thin spinning hull or a pile
      // contact from crossing the plane between fixed collision steps.
      for (const body of activeBodies) constrainFloor(body);
      // Contact drag accounts for rough paint rubbing along the floor or a
      // resting flake. It does not affect airborne pieces or sliding on iron.
      supported.clear();
      for (const contact of world.contacts) {
        if ((contact.bi === floor || settledBodies.has(contact.bi)) && bodies.has(contact.bj) && contact.bj.mass > 0) supported.add(contact.bj);
        if ((contact.bj === floor || settledBodies.has(contact.bj)) && bodies.has(contact.bi) && contact.bi.mass > 0) supported.add(contact.bi);
        if ((contact.bi === floor || (settledBodies.has(contact.bi) && groundedBodies.has(contact.bi))) && bodies.has(contact.bj)) groundedBodies.add(contact.bj);
        if ((contact.bj === floor || (settledBodies.has(contact.bj) && groundedBodies.has(contact.bj))) && bodies.has(contact.bi)) groundedBodies.add(contact.bi);
      }
      for (const body of supported) {
        const sliding = SLIDING_DAMPING;
        body.velocity.x *= sliding;
        body.velocity.z *= sliding;
        body.angularVelocity.scale(ANGULAR_DAMPING, body.angularVelocity);
        // Very thin convex shells can retain tiny solver oscillations. Use
        // sustained supported low motion as an additional sleep criterion.
        const quiet = body.velocity.lengthSquared() < 0.12 && body.angularVelocity.lengthSquared() < 0.25;
        const duration = quiet ? (quietContactTime.get(body) || 0) + FIXED_STEP : 0;
        quietContactTime.set(body, duration);
        if (duration > 0.4) settle(body);
      }
      for (const body of quietContactTime.keys()) if (!supported.has(body)) quietContactTime.delete(body);
      accumulator -= FIXED_STEP;
      substeps++;
    }
    accumulator = Math.max(0, Math.min(accumulator, FIXED_STEP));
    const alpha = accumulator / FIXED_STEP;
    for (const body of activeBodies) {
      body.previousPosition.lerp(body.position, alpha, body.interpolatedPosition);
      body.previousQuaternion.slerp(body.quaternion, alpha, body.interpolatedQuaternion);
    }
    return substeps;
  }

  function removeFlake(body){
    if(!bodies.delete(body))return;
    world.removeBody(body);activeBodies.delete(body);settledBodies.delete(body);
    heldBodies.delete(body);groundedBodies.delete(body);quietContactTime.delete(body);
  }
  function grabFlake(body){
    if(!bodies.has(body))return false;
    activeBodies.delete(body);settledBodies.delete(body);groundedBodies.delete(body);quietContactTime.delete(body);
    heldBodies.add(body);body.sleep();body.type=CANNON.Body.STATIC;body.mass=0;body.updateMassProperties();
    body.collisionFilterGroup=SETTLED_GROUP;body.collisionFilterMask=FLAKE_GROUP;
    return true;
  }
  function moveFlake(body,position){
    if(!heldBodies.has(body))return;
    body.position.copy(vector(position,'position'));constrainFloor(body,true);
    body.previousPosition.copy(body.position);body.interpolatedPosition.copy(body.position);
    body.aabbNeedsUpdate=true;
  }
  function releaseFlake(body){
    if(!heldBodies.delete(body)||!bodies.has(body))return;
    body.mass=body.flakeMass;body.type=CANNON.Body.DYNAMIC;body.updateMassProperties();
    body.collisionFilterGroup=FLAKE_GROUP;body.collisionFilterMask=STATIC_GROUP|SETTLED_GROUP;
    body.wakeUp();activeBodies.add(body);
  }
  const importedColliders=[];
  function setSpecimenHulls(hulls){
    for(const body of importedColliders)world.removeBody(body);
    importedColliders.length=0;
    for(const shape of [...cube.shapes])cube.removeShape(shape);
    cube.updateBoundingRadius();cube.aabbNeedsUpdate=true;
    for(const hull of hulls){
      const vertices=hull.vertices.map(v=>vector(v,'hull vertex'));
      const body=new CANNON.Body({mass:0,material:cubeMaterial,collisionFilterGroup:STATIC_GROUP,collisionFilterMask:FLAKE_GROUP});
      body.addShape(new CANNON.ConvexPolyhedron({vertices,faces:outwardFaces(vertices,hull.faces)}));
      body.position.copy(vector(hull.position,'hull position'));world.addBody(body);importedColliders.push(body);
    }
  }
  function setSpecimenShape(shape){
    for(const body of importedColliders)world.removeBody(body);
    importedColliders.length=0;
    for(const collider of [...cube.shapes])cube.removeShape(collider);
    if(shape==='sphere')cube.addShape(new CANNON.Sphere(1.432));
    else if(shape==='pill'){
      cube.addShape(new CANNON.Cylinder(.802,.802,1.3,24));
      cube.addShape(new CANNON.Sphere(.802),new CANNON.Vec3(0,.65,0));
      cube.addShape(new CANNON.Sphere(.802),new CANNON.Vec3(0,-.65,0));
    }else if(shape==='cone'){
      const vertices=[];
      for(let i=0;i<32;i++){const angle=i/32*Math.PI*2;vertices.push(new CANNON.Vec3(Math.cos(angle)*1.332,-1.382,Math.sin(angle)*1.332));}
      vertices.push(new CANNON.Vec3(0,1.382,0));
      const faces=[Array.from({length:32},(_,i)=>i)];
      for(let i=0;i<32;i++)faces.push([i,(i+1)%32,32]);
      cube.addShape(new CANNON.ConvexPolyhedron({vertices,faces:outwardFaces(vertices,faces)}));
    }else if(shape==='plus'){
      for(const [x,y] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]])cube.addShape(new CANNON.Box(new CANNON.Vec3(.45,.45,.45)),new CANNON.Vec3(x*.9,y*.9,0));
    }else cube.addShape(new CANNON.Box(new CANNON.Vec3(cubeHalfExtent,cubeHalfExtent,cubeHalfExtent)));
    cube.updateBoundingRadius();cube.aabbNeedsUpdate=true;
  }
  function setCubeTransform(position,quaternion){
    cube.position.copy(position);cube.quaternion.copy(quaternion);cube.aabbNeedsUpdate=true;
  }
  function clear() {
    for (const body of bodies) world.removeBody(body);
    bodies.clear();
    activeBodies.clear();
    heldBodies.clear();
    supported.clear();
    settledBodies.clear();
    groundedBodies.clear();
    quietContactTime.clear();
    accumulator = 0;
    world.accumulator = 0;
  }

  function stats() {
    const sleeping = settledBodies.size;
    return { total: bodies.size, awake: activeBodies.size, sleeping, held:heldBodies.size, grounded: groundedBodies.size, simulationSeconds: world.time };
  }

  return { world, addFlake, removeFlake, grabFlake, moveFlake, releaseFlake, setCubeTransform, setSpecimenShape, setSpecimenHulls, step, clear, stats };
}

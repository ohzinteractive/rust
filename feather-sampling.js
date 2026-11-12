import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';

function axisValue(point, axis) {
  return axis === 0 ? point.x : axis === 1 ? point.y : point.z;
}

function insertSample(root, point) {
  if (!root) return {point, axis:0, left:null, right:null};
  let node = root;
  while (true) {
    const branch = axisValue(point, node.axis) < axisValue(node.point, node.axis) ? 'left' : 'right';
    if (!node[branch]) {
      node[branch] = {point, axis:(node.axis + 1) % 3, left:null, right:null};
      return root;
    }
    node = node[branch];
  }
}

function nearestSample(root, point, nearest, rejectDistance) {
  if (!root) return nearest;
  nearest = Math.min(nearest, point.distanceToSquared(root.point));
  if (nearest <= rejectDistance) return nearest;
  const delta = axisValue(point, root.axis) - axisValue(root.point, root.axis);
  const first = delta < 0 ? root.left : root.right, second = delta < 0 ? root.right : root.left;
  nearest = nearestSample(first, point, nearest, rejectDistance);
  if (nearest > rejectDistance && delta * delta < nearest) nearest = nearestSample(second, point, nearest, rejectDistance);
  return nearest;
}

// Sample actual triangle area in the effect parent's coordinates. This avoids
// concentrating feathers wherever a model happens to have more vertices.
export function createSurfaceSampler(meshes, parent) {
  parent.updateWorldMatrix(true, false);
  const inverse = parent.matrixWorld.clone().invert();
  const triangles = [], cumulative = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const edge = new THREE.Vector3(), instance = new THREE.Matrix4();
  let area = 0;
  for (const mesh of meshes) {
    let visible = true;
    for (let node = mesh; node; node = node.parent) visible &&= node.visible;
    if (!visible || !mesh.geometry?.attributes.position) continue;
    mesh.updateWorldMatrix(true, false);
    mesh.skeleton?.update();
    const geometry = mesh.geometry, index = geometry.index;
    const count = index?.count ?? geometry.attributes.position.count;
    const groups = geometry.groups.length ? geometry.groups : [{start:0, count, materialIndex:0}];
    const start = geometry.drawRange.start, end = Math.min(count, start + geometry.drawRange.count);
    for (let instanceIndex = 0; instanceIndex < (mesh.isInstancedMesh ? mesh.count : 1); instanceIndex++) {
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(instanceIndex, instance); matrix.multiply(instance); }
      for (const group of groups) {
        const material = Array.isArray(mesh.material) ? mesh.material[group.materialIndex ?? 0] : mesh.material;
        if (!material || !material.visible) continue;
        for (let i = Math.max(start, group.start); i + 2 < Math.min(end, group.start + group.count); i += 3) {
          const indices = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
          mesh.getVertexPosition(indices[0], a).applyMatrix4(matrix);
          mesh.getVertexPosition(indices[1], b).applyMatrix4(matrix);
          mesh.getVertexPosition(indices[2], c).applyMatrix4(matrix);
          const weight = edge.subVectors(b, a).cross(c.clone().sub(a)).length() * .5;
          if (!Number.isFinite(weight) || weight <= 1e-12) continue;
          area += weight;
          triangles.push({mesh, indices, instanceIndex, a:a.clone(), b:b.clone(), c:c.clone()});
          cumulative.push(area);
        }
      }
    }
  }
  function candidate(random) {
    const target = random() * area;
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (target < cumulative[mid]) hi = mid; else lo = mid + 1; }
    const triangle = triangles[lo], r = Math.sqrt(random()), v = random();
    const weights = [1 - r, r * (1 - v), r * v];
    const position = triangle.a.clone().multiplyScalar(weights[0]).addScaledVector(triangle.b, weights[1]).addScaledVector(triangle.c, weights[2]);
    return {triangle, weights, position};
  }
  return {
    area,
    sample(count, seed = 7319) {
      if (!triangles.length || count <= 0) return [];
      const random = seededRandom(seed), samples = [];
      let tree = null;
      // Progressive best-candidate sampling spreads roots apart while keeping
      // existing placements stable when the density slider adds more feathers.
      // A spatial tree avoids scanning every previous root for every candidate
      // as uncapped surface counts grow.
      for (let i = 0; i < count; i++) {
        let best, bestDistance = -1;
        for (let j = 0; j < 20; j++) {
          const sample = candidate(random);
          const nearest = nearestSample(tree, sample.position, Infinity, bestDistance);
          if (nearest > bestDistance) { best = sample; bestDistance = nearest; }
        }
        samples.push(best);
        tree = insertSample(tree, best.position);
      }
      return samples;
    }
  };
}

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const edge = new THREE.Vector3(), matrix = new THREE.Matrix4(), inverse = new THREE.Matrix4();
const instance = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), n = new THREE.Vector3();

// Re-evaluate barycentric attachments so roots follow skinning, morphs and
// object animation. Static meshes retain their interpolated smooth normals.
export function readFeatherAnchor(sample, parent, position, normal) {
  const {mesh, indices, instanceIndex} = sample.triangle, weights = sample.weights;
  inverse.copy(parent.matrixWorld).invert();
  matrix.multiplyMatrices(inverse, mesh.matrixWorld);
  if (mesh.isInstancedMesh) { mesh.getMatrixAt(instanceIndex, instance); matrix.multiply(instance); }
  mesh.getVertexPosition(indices[0], a);
  mesh.getVertexPosition(indices[1], b);
  mesh.getVertexPosition(indices[2], c);
  position.copy(a).multiplyScalar(weights[0]).addScaledVector(b, weights[1]).addScaledVector(c, weights[2]).applyMatrix4(matrix);
  const attribute = mesh.geometry.attributes.normal;
  if (attribute && !mesh.isSkinnedMesh && !mesh.geometry.morphAttributes.position?.length && !mesh.geometry.morphAttributes.normal?.length) {
    normal.set(0, 0, 0);
    indices.forEach((index, i) => normal.addScaledVector(n.fromBufferAttribute(attribute, index), weights[i]));
  } else normal.subVectors(b, a).cross(edge.subVectors(c, a));
  normal.applyMatrix3(normalMatrix.getNormalMatrix(matrix)).normalize();
  if (normal.lengthSq() === 0) normal.set(0, 1, 0);
  return position.addScaledVector(normal, .018);
}

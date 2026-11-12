import * as THREE from 'three';

const guide = new THREE.Vector3(), tangent = new THREE.Vector3(), capFlow = new THREE.Vector3();
const side = new THREE.Vector3(), axis = new THREE.Vector3(), vaneNormal = new THREE.Vector3();
const basis = new THREE.Matrix4();

// A common tangent flow lays contour vanes over their neighbours. Local +Y
// follows the quill, +X spans the vane and +Z faces away from the skin.
export function plumageFrame(normal, liftDegrees, directionDegrees, variation, quaternion, restPosition) {
  const heading = directionDegrees * Math.PI / 180, lift = liftDegrees * Math.PI / 180;
  guide.set(Math.sin(heading), -Math.cos(heading), 0);
  const alignment = guide.dot(normal);
  tangent.copy(guide).addScaledVector(normal, -alignment);
  // Blend a crown flow in before the body-flow projection becomes singular.
  // A stable front/back part in bind space keeps both body faces pointing down
  // and lets the coat sweep over caps without a random pole on a flat face.
  const part = restPosition?.z < 0 ? -1 : 1;
  capFlow.set(0,0,part * (alignment > 0 ? -1 : 1));
  capFlow.addScaledVector(normal,-capFlow.dot(normal));
  tangent.addScaledVector(capFlow,2 * Math.pow(alignment,4));
  if(tangent.lengthSq()<1e-10){
    capFlow.set(1,0,0);tangent.copy(capFlow).addScaledVector(normal,-capFlow.dot(normal));
  }
  tangent.normalize().applyAxisAngle(normal, variation);
  side.crossVectors(tangent, normal).normalize();
  axis.copy(tangent).multiplyScalar(Math.cos(lift)).addScaledVector(normal, Math.sin(lift)).normalize();
  vaneNormal.crossVectors(side, axis).normalize();
  return quaternion.setFromRotationMatrix(basis.makeBasis(side, axis, vaneNormal));
}

export function createContourVane(barbs, shaft) {
  const positions = [], colors = [], indices = [];
  const rows = barbs.p.length / 84, columns = 15;
  for (let row = 0; row < rows; row++) {
    const offset = row * 84;
    const rowPoints = [];
    for (let k = 7; k >= 1; k--) rowPoints.push(offset + (k - 1) * 6 + 3);
    rowPoints.push(offset);
    for (let k = 1; k <= 7; k++) rowPoints.push(offset + 42 + (k - 1) * 6 + 3);
    // Match every curved barb segment; a single flat strip would cut through
    // those filaments and create depth speckling across the vane.
    for (const index of rowPoints) {
      positions.push(barbs.p[index], barbs.p[index + 1] + 2.4, barbs.p[index + 2] - .025);
      const shade = .55 + row / Math.max(1, rows - 1) * .17;
      colors.push(shade, shade * .82, shade * .62);
    }
    if (row) {
      const previous = (row - 1) * columns, current = row * columns;
      for (let k = 0; k < columns - 1; k++) indices.push(previous+k, previous+k+1, current+k, previous+k+1, current+k+1, current+k);
    }
  }
  if (rows && shaft?.p.length) {
    const end = shaft.p.length - 3, tip = positions.length / 3;
    positions.push(shaft.p[end], shaft.p[end + 1] + 2.4, shaft.p[end + 2] - .025);
    colors.push(.72, .72 * .82, .72 * .62);
    const last = (rows - 1) * columns;
    for (let k = 0; k < columns - 1; k++) indices.push(last+k, last+k+1, tip);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

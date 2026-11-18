import {gateCrossingRate, phaseForClearance, swingLength, swingPivotHeight} from './shape-gate-motion.js';

export const gateRadius = 3;
export const gateDepth = .12;
export const gateBevel = .015;
export const cordSlotHalfWidth = .055;

const resolution = .0045;
const edgeClearance = .027;
const faceDepth = gateDepth / 2 + gateBevel;

// Bound the wheel rotation while this part of the model is inside the plate.
export function crossingRotation(y, depth) {
 const radius = swingLength - y;
 const tilt = Math.atan2(depth, radius) + Math.asin(faceDepth / radius);
 return gateCrossingRate * phaseForClearance(tilt);
}

// Clip one triangle to a column of the silhouette. The resulting polygon
// has at most five vertices.
function clipColumn(source, count, target, x, side) {
 let length = 0;
 for (let i = 0; i < count; i++) {
  const a = 3 * ((i + count - 1) % count), b = 3 * i;
  const from = side * (source[a] - x), to = side * (source[b] - x);
  if ((from < 0) !== (to < 0)) {
   const t = from / (from - to);
   target[3 * length] = x;
   target[3 * length + 1] = source[a + 1] + (source[b + 1] - source[a + 1]) * t;
   target[3 * length + 2] = source[a + 2] + (source[b + 2] - source[a + 2]) * t;
   length++;
  }
  if (to >= 0) {
   target[3 * length] = source[b];
   target[3 * length + 1] = source[b + 1];
   target[3 * length + 2] = source[b + 2];
   length++;
  }
 }
 return length;
}

function projectedSpan(polygon, count, span) {
 let far = 0, near = Infinity;
 for (let i = 0; i < count; i++) {
  const a = 3 * i, b = 3 * ((i + 1) % count);
  const y = swingLength - polygon[a + 1], z = polygon[a + 2];
  far = Math.max(far, y * y + z * z);
  // Closest point on the edge in the plane of rotation. The pivot is
  // above the whole polygon, so the radial minimum lies on a boundary.
  const dy = polygon[a + 1] - polygon[b + 1], dz = polygon[b + 2] - z;
  const lengthSquared = dy * dy + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, -(y * dy + z * dz) / lengthSquared)) : 0;
  near = Math.min(near, (y + dy * t) ** 2 + (z + dz * t) ** 2);
 }
 span[0] = swingPivotHeight - Math.sqrt(far);
 span[1] = swingPivotHeight - Math.sqrt(Math.max(0, near - faceDepth ** 2));
}

function widenMask(mask, width, height, radius) {
 const result = mask.slice();
 const widths = Array.from({length: 2 * radius + 1}, (_, y) => Math.floor(Math.sqrt(radius ** 2 - (y - radius) ** 2)));
 for (let y = radius; y < height - radius; y++) for (let x = radius; x < width - radius; x++) {
  const i = y * width + x;
  if (!mask[i] || (mask[i - 1] && mask[i + 1] && mask[i - width] && mask[i + width])) continue;
  for (let dy = -radius; dy <= radius; dy++) {
   const center = i + dy * width, reach = widths[dy + radius];
   result.fill(1, center - reach, center + reach + 1);
  }
 }
 return result;
}

// Trace the boundary with the opening on its right. At a corner shared by
// diagonal pixels, turn right to keep the two contours separate.
function traceOutlines(mask, width, height) {
 const pitch = width + 1, edges = new Uint8Array(pitch * (height + 1));
 const steps = [1, pitch, -1, -pitch];
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const cell = y * width + x, vertex = y * pitch + x;
  if (!mask[cell]) continue;
  if (!y || !mask[cell - width]) edges[vertex + 1] |= 1 << 2;
  if (!x || !mask[cell - 1]) edges[vertex] |= 1 << 1;
  if (y === height - 1 || !mask[cell + width]) edges[vertex + pitch] |= 1;
  if (x === width - 1 || !mask[cell + 1]) edges[vertex + pitch + 1] |= 1 << 3;
 }

 const outlines = [];
 for (let start = 0; start < edges.length; start++) while (edges[start]) {
  let vertex = start, direction = Math.log2(edges[start] & -edges[start]);
  const points = [];
  do {
   points.push([vertex % pitch, Math.floor(vertex / pitch)]);
   edges[vertex] &= ~(1 << direction);
   vertex += steps[direction];
   for (const turn of [3, 0, 1, 2]) {
    const next = (direction + turn) % 4;
    if (edges[vertex] & (1 << next)) {
     direction = next;
     break;
    }
   }
  } while (vertex !== start && edges[vertex]);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
   const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
   area += ax * by - bx * ay;
  }
  // Positive loops are free islands of disk material. The disk opening
  // follows the outer profiles and keeps the plate in one piece.
  if (vertex === start && area < 0) outlines.push(points);
 }
 return outlines;
}

function simplifyOutline(points, tolerance) {
 const closed = [...points, points[0]];
 const kept = new Uint8Array(closed.length);
 const stack = [[0, closed.length - 1]];
 kept[0] = kept[closed.length - 1] = 1;
 while (stack.length) {
  const [first, last] = stack.pop();
  const [ax, ay] = closed[first], [bx, by] = closed[last];
  const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
  let index = -1, greatest = tolerance ** 2;
  for (let i = first + 1; i < last; i++) {
   const x = closed[i][0] - ax, y = closed[i][1] - ay;
   const t = lengthSquared ? Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared)) : 0;
   const distance = (x - dx * t) ** 2 + (y - dy * t) ** 2;
   if (distance > greatest) {
    greatest = distance;
    index = i;
   }
  }
  if (index >= 0) {
   kept[index] = 1;
   stack.push([first, index], [index, last]);
  }
 }
 return points.filter((_, i) => kept[i]);
}

function smoothOutline(points, originX, originY) {
 const softened = points.map(([x, y], i) => {
  const previous = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
  return [x * .5 + (previous[0] + next[0]) * .25, y * .5 + (previous[1] + next[1]) * .25];
 });
 const simplified = simplifyOutline(softened, 1.1);
 return (simplified.length >= 3 ? simplified : softened).map(([x, y]) => [originX + x * resolution, originY + y * resolution]);
}

export function traceMeshAperture(triangles, anchorHeight) {
 let minX = -cordSlotHalfWidth, maxX = cordSlotHalfWidth;
 const knotY = swingPivotHeight - swingLength + anchorHeight;
 let minY = knotY, maxY = knotY, maxDepth = 0, highestY = anchorHeight;
 for (let i = 0; i < triangles.length; i += 3) {
  const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
  minX = Math.min(minX, x);
  maxX = Math.max(maxX, x);
  minY = Math.min(minY, swingPivotHeight - Math.hypot(swingLength - y, z));
  maxY = Math.max(maxY, swingPivotHeight - swingLength + y);
  maxDepth = Math.max(maxDepth, Math.abs(z));
  highestY = Math.max(highestY, y);
 }
 const reach = Math.hypot(Math.max(-minX, maxX), Math.max(Math.abs(minY), Math.abs(maxY)) + resolution);
 const pad = edgeClearance + 3 * resolution + reach * crossingRotation(highestY, maxDepth);
 const originX = Math.floor((minX - pad) / resolution) * resolution;
 const originY = Math.floor((minY - pad) / resolution) * resolution;
 const cap = maxY + pad + .045;
 const width = Math.ceil((maxX + pad - originX) / resolution);
 const height = Math.ceil((cap + 3 * resolution - originY) / resolution);
 const mask = new Uint8Array(width * height);
 const clipped = new Float64Array(18), polygon = new Float64Array(18), span = [0, 0];

 for (let i = 0; i < triangles.length; i += 9) {
  const triangle = triangles.subarray(i, i + 9);
  const rotation = crossingRotation(Math.max(triangle[1], triangle[4], triangle[7]),
   Math.max(Math.abs(triangle[2]), Math.abs(triangle[5]), Math.abs(triangle[8])));
  const sideways = Math.sin(rotation), inward = 1 - Math.cos(rotation);
  const start = Math.floor((Math.min(triangle[0], triangle[3], triangle[6]) - originX) / resolution);
  const end = Math.floor((Math.max(triangle[0], triangle[3], triangle[6]) - originX) / resolution);
  for (let col = start; col <= end; col++) {
   const x = originX + col * resolution;
   const leftCount = clipColumn(triangle, 3, clipped, x, 1);
   if (!leftCount) continue;
   const count = clipColumn(clipped, leftCount, polygon, x + resolution, -1);
   if (!count) continue;
   projectedSpan(polygon, count, span);
   // The opposite swing directions turn the projected column to either
   // side. Cover that sweep before tracing the opening's boundary.
   const maxAbsX = Math.max(Math.abs(x), Math.abs(x + resolution));
   const maxAbsY = Math.max(Math.abs(span[0]), Math.abs(span[1]));
   const extraCols = Math.ceil((maxAbsY * sideways + maxAbsX * inward) / resolution);
   const shiftY = maxAbsX * sideways + maxAbsY * inward;
   const bottom = Math.floor((span[0] - shiftY - originY) / resolution);
   const top = Math.floor((span[1] + shiftY - originY) / resolution);
   for (let row = bottom; row <= top; row++) {
    mask.fill(1, row * width + col - extraCols, row * width + col + extraCols + 1);
   }
  }
 }

 const cutout = widenMask(mask, width, height, Math.ceil(edgeClearance / resolution));
 const slotLeft = Math.floor((-cordSlotHalfWidth - resolution - originX) / resolution);
 const slotRight = Math.ceil((cordSlotHalfWidth + resolution - originX) / resolution);
 const slotBottom = Math.floor((knotY - .02 - originY) / resolution);
 const slotTop = Math.floor((cap - originY) / resolution);
 for (let row = slotBottom; row <= slotTop; row++) cutout.fill(1, row * width + slotLeft, row * width + slotRight);

 // The slot cap is above every silhouette, so the highest contour is
 // the one to join to the outside edge of the disk.
 const outlines = traceOutlines(cutout, width, height);
 const highest = points => points.reduce((top, point) => Math.max(top, point[1]), -Infinity);
 outlines.sort((a, b) => highest(b) - highest(a));
 if (!outlines.length) throw new Error('The model has no sweep silhouette.');
 const [outline, ...holes] = outlines.map(points => smoothOutline(points, originX, originY));
 return {outline, holes};
}

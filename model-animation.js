import * as THREE from 'three';

const boneKey = name => name.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

// Transfer world-space motion between bind poses, including Blender's armature
// axis conversion. Only the hip translates; target limb proportions stay intact.
export function retargetAnimation(target, source, clip) {
  const sourceBones = new Map(), targets = [];
  source.updateMatrixWorld(true); target.updateMatrixWorld(true);
  source.traverse(b => { if (b.isBone) sourceBones.set(boneKey(b.name), b); });
  target.traverse(b => { if (b.isBone && sourceBones.has(boneKey(b.name))) targets.push(b); });
  if (!targets.some(b => boneKey(b.name) === 'hips') || targets.length < 12) {
    throw new Error('This animation needs a compatible humanoid skeleton (such as Mixamo).');
  }
  const data = targets.map(b => {
    const s = sourceBones.get(boneKey(b.name));
    return { b, s, rest: b.quaternion.clone(), position: b.position.clone(),
      offset: s.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(b.getWorldQuaternion(new THREE.Quaternion())),
      values: [], positions: [] };
  });
  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
  const frames = Math.max(2, Math.ceil(clip.duration * 30)), times = [];
  const q = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  const hip = data.find(d => boneKey(d.b.name) === 'hips');
  const targetHeight = hip.b.getWorldPosition(new THREE.Vector3()).length();
  let firstHip;
  try {
    for (let i = 0; i <= frames; i++) {
      const time = Math.min(i / frames * clip.duration, clip.duration);
      times.push(time); mixer.setTime(time); source.updateMatrixWorld(true);
      const sourceHip = hip.s.getWorldPosition(new THREE.Vector3());
      if (!firstHip) firstHip = sourceHip.clone();
      const ratio = targetHeight / Math.max(firstHip.length(), .001);
      for (const d of data) {
        d.s.getWorldQuaternion(q).multiply(d.offset);
        if (d.b.parent) q.premultiply(d.b.parent.getWorldQuaternion(parentQ).invert());
        d.b.quaternion.copy(q); d.values.push(q.x, q.y, q.z, q.w);
        if (d === hip) {
          const delta = sourceHip.clone().sub(firstHip).multiplyScalar(ratio);
          const origin = d.b.parent.getWorldPosition(new THREE.Vector3());
          d.b.parent.worldToLocal(delta.add(origin));
          d.b.position.copy(d.position).add(delta);
          d.positions.push(...d.b.position.toArray());
        }
        d.b.updateMatrixWorld(true);
      }
    }
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(source);
    for (const d of data) { d.b.quaternion.copy(d.rest); d.b.position.copy(d.position); }
    target.updateMatrixWorld(true);
  }
  const tracks = data.map(d => new THREE.QuaternionKeyframeTrack(`${d.b.uuid}.quaternion`, times, d.values));
  tracks.push(new THREE.VectorKeyframeTrack(`${hip.b.uuid}.position`, times, hip.positions));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

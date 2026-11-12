import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE = await import('../vendor/three.module.js');
const { retargetAnimation } = await import('../model-animation.js');

function rig(prefix, rotated = false) {
  const root = new THREE.Group(), armature = new THREE.Group();
  if (rotated) armature.rotation.x = Math.PI / 2;
  root.add(armature);
  let parent = armature;
  for (const name of ['Hips','Spine','Spine1','Spine2','Neck','Head','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand']) {
    const bone = new THREE.Bone(); bone.name = prefix + name; bone.position.y = 1;
    parent.add(bone); parent = bone;
  }
  root.updateMatrixWorld(true); return root;
}

test('FBX motion transfers through a rotated armature without changing the rest pose or limb lengths', () => {
  const source = rig('mixamorig'), target = rig('mixamorig:', true);
  const hip = target.getObjectByName('mixamorig:Hips');
  const rest = hip.position.clone(), rotation = hip.quaternion.clone();
  const clip = new THREE.AnimationClip('Phone', 1, [
    new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', [0,1], [0,0,0,1,0,Math.sin(.3),0,Math.cos(.3)]),
    new THREE.VectorKeyframeTrack('mixamorigHips.position', [0,1], [0,1,0,1,1,0])
  ]);
  const output = retargetAnimation(target, source, clip);
  assert(hip.position.equals(rest)); assert(hip.quaternion.equals(rotation));
  assert.equal(output.tracks.length,13);
  assert(output.tracks.every(t => [...t.values].every(Number.isFinite)));
  const mixer = new THREE.AnimationMixer(target); mixer.clipAction(output).play(); mixer.update(.5);
  target.updateMatrixWorld(true);
  const actual = hip.getWorldQuaternion(new THREE.Quaternion());
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.3)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  assert(actual.angleTo(expected)<1e-5);
  assert(Math.abs(hip.position.x-.5)<1e-5);
  assert(target.getObjectByName('mixamorig:Spine').position.equals(new THREE.Vector3(0,1,0)));
});

test('unrelated skeletons are rejected with an actionable message', () => {
  assert.throws(()=>retargetAnimation(new THREE.Group(), rig('mixamorig'), new THREE.AnimationClip()), /compatible humanoid skeleton/);
});

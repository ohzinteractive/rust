import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createClothCollider}=await import('../cloth-collider.js');
const {createClothRopes}=await import('../cloth-rope.js');

test('rope detail can change on an existing tie without moving cloth or losing attachments',()=>{
  const scene=new THREE.Scene(),body=new THREE.Mesh(new THREE.BoxGeometry(1,2,1)),columns=24,rows=4,positions=new Float32Array((columns+1)*(rows+1)*3);
  for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
    const i=(row*(columns+1)+col)*3,angle=col/columns*Math.PI*2;
    positions[i]=Math.cos(angle)*1.1;positions[i+1]=1.5-row/rows*3;positions[i+2]=Math.sin(angle)*1.1;
  }
  const ropes=createClothRopes({scene,collider:createClothCollider([body]),positions,columns,rows});
  ropes.setRopes([{id:1,height:.5,tightness:.8}]);
  for(let i=0;i<720;i++)ropes.advance(1/90);
  ropes.render();assert.equal(ropes.stats[0].status,'tied');assert(ropes.stats[0].attachments>8);
  const before=positions.slice(),stats=ropes.stats[0],mesh=ropes.group.getObjectByName('Cloth binding rope');
  let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);
  for(const points of [192,384,96]){
    ropes.setPointCount(points);
    assert.equal(ropes.pointCount,points);assert.equal(mesh.geometry.attributes.position.count,(points+1)*8);
    assert.equal(ropes.stats[0].status,'tied');assert.equal(ropes.stats[0].attachments,stats.attachments);
    assert(Math.abs(ropes.stats[0].radius-stats.radius)<.01);
    assert.deepEqual(positions,before,'Detail changes preserve the cloth pose');
    const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
    assert(p.array.every(Number.isFinite)&&n.array.every(Number.isFinite));
    for(let side=0;side<8;side++)for(let axis=0;axis<3;axis++)assert(Math.abs(p.array[side*3+axis]-p.array[(points*8+side)*3+axis])<1e-6,'The closed rope has no seam gap');
  }
  assert.equal(disposed,1,'Replaced geometry is released');
  ropes.setPointCount(9999);assert.equal(ropes.pointCount,384);
  for(let i=0;i<30;i++)ropes.solve();
  assert(positions.every(Number.isFinite),'The higher-resolution profile remains stable while binding');
  ropes.setRopes([{id:2,height:.6,tightness:.7}]);
  assert.equal(ropes.group.getObjectByName('Cloth binding rope').geometry.attributes.position.count,385*8,'New ropes use the selected detail');
  for(let i=0;i<180;i++)ropes.advance(1/90);
  assert.equal(ropes.stats[0].status,'wrapping');
  const attachments=ropes.stats[0].attachments;ropes.setPointCount(192);
  assert.equal(ropes.stats[0].status,'wrapping');assert.equal(ropes.stats[0].attachments,attachments);
  for(let i=0;i<270;i++)ropes.advance(1/90);
  assert.equal(ropes.stats[0].status,'tied','Changing detail does not restart wrapping');
  ropes.dispose();body.geometry.dispose();body.material.dispose();
});

import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createClothCollider}=await import('../cloth-collider.js');
const {createClothRopes}=await import('../cloth-rope.js');
const {createClothSurface}=await import('../cloth-surface.js');

test('a satin ribbon makes a flat multi-turn spiral and binds cloth along its changing height',()=>{
  const scene=new THREE.Scene(),body=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,3,32)),columns=48,rows=16;
  const positions=new Float32Array((columns+1)*(rows+1)*3);
  for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
    const i=(row*(columns+1)+col)*3,angle=col/columns*Math.PI*2;
    positions[i]=Math.cos(angle)*1.1;positions[i+1]=1.6-row/rows*3.2;positions[i+2]=Math.sin(angle)*1.1;
  }
  const ropes=createClothRopes({scene,collider:createClothCollider([body]),positions,columns,rows});
  const settings={id:1,style:'ribbon',height:.65,tightness:.85,width:.07,turns:3,span:.4};ropes.setRopes([settings]);
  for(let i=0;i<720;i++)ropes.advance(1/90);
  for(let i=0;i<16;i++)ropes.solve();ropes.render();
  assert.equal(ropes.stats[0].status,'tied');assert(ropes.stats[0].attachments>20);assert(ropes.stats[0].heightError<.03);
  const ribbon=ropes.group.getObjectByName('Cloth binding ribbon'),p=ribbon.geometry.attributes.position;
  assert.equal(p.count,(96*3+1)*8);assert(p.array.every(Number.isFinite));
  const center=i=>new THREE.Vector3().fromBufferAttribute(p,i*8).add(new THREE.Vector3().fromBufferAttribute(p,i*8+4)).multiplyScalar(.5);
  assert(Math.abs(center(96*3).y-center(0).y-1.2)<1e-5,'The wrap climbs through the selected vertical coverage');
  let angle=0;
  for(let i=1;i<=96*3;i++){const a=center(i-1),b=center(i);angle+=Math.atan2(a.x*b.z-a.z*b.x,a.x*b.x+a.z*b.z);}
  assert(Math.abs(angle-Math.PI*6)<.01,'The band winds around the object three times');
  const width=new THREE.Vector3().fromBufferAttribute(p,2).distanceTo(new THREE.Vector3().fromBufferAttribute(p,6));
  const thickness=new THREE.Vector3().fromBufferAttribute(p,0).distanceTo(new THREE.Vector3().fromBufferAttribute(p,4));
  assert(width>thickness*25,'The binding has a wide, flat ribbon cross section');
  const before=positions.slice(),attachments=ropes.stats[0].attachments;
  settings.width=.12;ropes.setRopes([settings]);ropes.setPointCount(192);
  assert.equal(ropes.stats[0].status,'tied');assert.equal(ropes.stats[0].attachments,attachments);assert.deepEqual(positions,before);
  assert.equal(ribbon.geometry.attributes.position.count,(192*3+1)*8);
  settings.style='cord';ropes.setRopes([settings]);
  assert(ropes.group.getObjectByName('Cloth binding rope'));assert.equal(ribbon.geometry.attributes.position.count,193*8);
  ropes.dispose();body.geometry.dispose();body.material.dispose();
});

test('spiral ribbon constrains an actively draping sheet and releases its resources',()=>{
  const scene=new THREE.Scene(),body=new THREE.Mesh(new THREE.CapsuleGeometry(.8,1.3,8,24));scene.add(body);
  const cloth=createClothSurface({scene});cloth.rebuild([body],{resolution:12,ropes:[{id:1,style:'ribbon',height:.65,tightness:.8,width:.07,turns:3,span:.4}]});
  for(let frame=0;frame<720;frame++)cloth.advance(1/60);
  const stats=cloth.ropes.stats[0];assert.equal(stats.status,'tied',JSON.stringify(stats));assert(stats.attachments>8);assert(stats.heightError<.2,JSON.stringify(stats));
  assert(cloth.simulation.positions.every(Number.isFinite));
  const ribbon=cloth.ropes.group.getObjectByName('Cloth binding ribbon');assert(ribbon.geometry.attributes.position.array.every(Number.isFinite));
  let disposed=0;ribbon.geometry.addEventListener('dispose',()=>disposed++);cloth.setRopes([]);assert.equal(disposed,1);assert.equal(cloth.ropes.group.children.length,0);
  cloth.dispose();body.geometry.dispose();body.material.dispose();
});

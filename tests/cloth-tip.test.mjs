import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createClothCollider}=await import('../cloth-collider.js');
const {createClothSurface}=await import('../cloth-surface.js');

function specimen(){
  const body=new THREE.Mesh(new THREE.BoxGeometry(3,2,2),new THREE.MeshBasicMaterial()),tip=new THREE.Mesh(new THREE.ConeGeometry(.006,.7,6),new THREE.MeshBasicMaterial());
  body.position.y=-.2;tip.position.set(.137,1.15,.173);
  return {body,tip,dispose(){for(const mesh of [body,tip]){mesh.geometry.dispose();mesh.material.dispose();}}};
}
function surfaceHeight(mesh,x,z){
  mesh.updateWorldMatrix(true,false);
  const hits=new THREE.Raycaster(new THREE.Vector3(x,4,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh,false);
  assert(hits.length,'Cloth covers the position of the tip');return hits[0].point.y;
}

test('the holding point clears an apex too narrow for the sampled height field',()=>{
  const source=specimen(),collider=createClothCollider([source.body,source.tip]);
  assert(collider.hasTipContacts,'Exact top features survive missing the raster grid');
  assert(collider.support.y>collider.bounds.max.y+.05,'The holding point uses the actual model bounds');
  source.dispose();
});

test('a tip contacts the interior of a cloth triangle even when all three nodes miss it',()=>{
  const source=specimen(),collider=createClothCollider([source.body,source.tip]);
  const positions=new Float32Array([.08,1.46,.10,.25,1.46,.10,.08,1.46,.25]),previous=positions.slice(),history=positions.slice();
  for(let i=0;i<positions.length;i+=3)assert(!collider.containsSurface(positions,i),'No cloth vertex is inside the needle');
  assert(collider.projectTipFace(positions,0,3,6,.08,{history,previous}));
  const triangle=new THREE.Triangle(new THREE.Vector3().fromArray(positions,0),new THREE.Vector3().fromArray(positions,3),new THREE.Vector3().fromArray(positions,6));
  const hit=new THREE.Ray(new THREE.Vector3(.137,4,.173),new THREE.Vector3(0,-1,0)).intersectTriangle(triangle.a,triangle.b,triangle.c,false,new THREE.Vector3());
  assert(hit&&hit.y>collider.bounds.max.y+.075,'The face clears the tip, not just its three vertices');
  assert.deepEqual(previous,positions,'Contact correction does not inject artificial velocity');
  const underside=new Float32Array([.08,-1.5,.10,.25,-1.5,.10,.08,-1.5,.25]);
  assert.equal(collider.projectTipFace(underside,0,3,6,.08),false,'An unrelated hem underneath the object stays in place');
  source.dispose();
});

test('a draping sheet keeps the tip below both the simulated and displayed cloth faces',()=>{
  const source=specimen(),scene=new THREE.Scene();scene.add(source.body,source.tip);
  const cloth=createClothSurface({scene});cloth.rebuild([source.body,source.tip],{resolution:12,fabric:'plastic'});
  for(let i=0;i<360;i++)cloth.advance(1/60);
  assert(cloth.simulation.positions.every(Number.isFinite));
  assert(surfaceHeight(cloth.mesh,.137,.173)>cloth.collider.bounds.max.y+.03,'The visible wrapper covers the apex');
  const n=cloth.simulation.columns,indices=[];
  for(let row=0;row<n;row++)for(let col=0;col<n;col++){const a=row*(n+1)+col,b=a+n+1;indices.push(a,b,a+1,b,b+1,a+1);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(cloth.simulation.positions,3));geometry.setIndex(indices);
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);
  assert(surfaceHeight(mesh,.137,.173)>cloth.collider.bounds.max.y+.02,'The solver also supports the face over the apex');
  geometry.dispose();material.dispose();cloth.dispose();source.dispose();
});

test('slender upright imports keep a regular sheet around their small top contact',()=>{
  const scene=new THREE.Scene(),body=new THREE.Mesh(new THREE.CylinderGeometry(.17,.5,3,24),new THREE.MeshBasicMaterial());scene.add(body);
  const cloth=createClothSurface({scene});cloth.rebuild([body],{resolution:12,radial:true,fabric:'plastic'});
  assert.equal(cloth.simulation.radial,false,'A narrow cap does not collapse a complete row of cloth nodes');
  assert(cloth.simulation.positions.every(Number.isFinite));
  cloth.dispose();body.geometry.dispose();body.material.dispose();
});

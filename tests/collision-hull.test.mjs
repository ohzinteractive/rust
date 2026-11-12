import {registerHooks} from 'node:module';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const CANNON=await import('../vendor/cannon-es.js');
const {GLTFLoader}=await import('../vendor/GLTFLoader.js');
const {ImportedPeelingSurface}=await import('../imported-peeling.js');
const {buildCollisionHull}=await import('../collision-hull.js');
const {optimizeCollisionAxes}=await import('../flake-physics.js');

function assertClosed(shape){
  const edges=new Map();
  shape.faces.forEach((face,index)=>{
    const neighbors=shape.faces.filter((f,j)=>j!==index&&f.some(v=>face.includes(v)));
    assert(neighbors.length>=face.length,'Every contact face needs all neighboring planes');
    for(let i=0;i<face.length;i++){
      const a=face[i],b=face[(i+1)%face.length],key=a<b?`${a},${b}`:`${b},${a}`;
      const edge=edges.get(key)??{count:0,winding:0};edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);
    }
  });
  for(const edge of edges.values()){
    assert.equal(edge.count,2,'Collision hull must have no open edges');
    assert.equal(edge.winding,0,'Adjacent faces must use opposite edge winding');
  }
  assert.equal(shape.vertices.length-edges.size+shape.faces.length,2);
}

test('actual horse colliders remain closed and stable through sustained full-exposure peeling',async()=>{
  const bytes=await readFile(new URL('../samples/horse.glb',import.meta.url));
  const {scene:root}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  root.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(root,true),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const scale=3/Math.max(size.x,size.y,size.z),scene=new THREE.Scene(),wrapper=new THREE.Group();
  wrapper.scale.setScalar(scale);wrapper.position.set(-center.x*scale,-1.65-bounds.min.y*scale,-center.z*scale);wrapper.add(root);scene.add(wrapper);scene.updateMatrixWorld(true);
  const entries=[],material=new THREE.MeshBasicMaterial();
  root.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.setAttribute('restPosition',mesh.geometry.attributes.position.clone());entries.push({mesh,materialIndices:[0]});}});
  const state={age:0,seed:7319,peel:.68,flakeFactor:1,exploded:0};
  const surface=new ImportedPeelingSurface({scene,entries,materials:[material],state});
  const checked=new Set();
  function checkHulls(){
    for(const body of surface.physics.world.bodies)for(const shape of body.shapes){
      if(!shape.vertices||checked.has(shape))continue;assertClosed(shape);checked.add(shape);
    }
  }
  try{
    checkHulls();state.age=1;
    for(let frame=0;frame<600;frame++){
      surface.update(1/60);checkHulls();assert(surface.physics.stats().awake<=24);
      for(const body of surface.physics.world.bodies)assert([body.position.x,body.position.y,body.position.z].every(Number.isFinite));
    }
    assert(surface.detachedCount>30);assert(surface.physics.stats().sleeping>0);
    for(const flake of surface.flakes)if(flake.body)for(const vertex of flake.body.shapes[0].vertices){
      assert(flake.body.quaternion.vmult(vertex).y+flake.body.position.y>=-1.757,'Fragments remain above the floor');
    }
  }finally{
    surface.dispose();material.dispose();
    root.traverse(o=>{o.geometry?.dispose();for(const m of [o.material].flat().filter(Boolean))m.dispose();});
  }
});

test('deduplicated SAT directions preserve collision results and reduce projection work',()=>{
  const points=[];
  for(let i=0;i<40;i++){const t=i*.7;points.push({x:Math.cos(t)*(.2+i*.002),y:Math.sin(t)*.09,z:Math.sin(i*1.3)*.04});}
  const hull=buildCollisionHull(points);
  const make=()=>new CANNON.ConvexPolyhedron({vertices:hull.vertices.map(p=>new CANNON.Vec3(p.x,p.y,p.z)),faces:hull.faces.map(f=>[...f])});
  const original=[make(),make()],optimized=[optimizeCollisionAxes(make()),optimizeCollisionAxes(make())];
  assertClosed(original[0]);assertClosed(optimized[0]);
  assert.deepEqual(optimized[0].vertices,original[0].vertices);assert.deepEqual(optimized[0].faces,original[0].faces);
  assert(optimized[0].uniqueEdges.length<original[0].uniqueEdges.length);
  const project=CANNON.ConvexPolyhedron.project;let calls=0,baselineCalls=0,optimizedCalls=0;
  CANNON.ConvexPolyhedron.project=function(...args){calls++;return project.apply(this,args);};
  try{
    for(let i=0;i<80;i++){
      const pA=new CANNON.Vec3(),pB=new CANNON.Vec3(Math.sin(i*.8)*.5,Math.cos(i*.7)*.12,Math.sin(i*.5)*.08);
      const qA=new CANNON.Quaternion(),qB=new CANNON.Quaternion();qA.setFromEuler(i*.01,i*.02,0);qB.setFromEuler(.1,i*.03,i*.02);
      calls=0;const a=original[0].findSeparatingAxis(original[1],pA,qA,pB,qB,new CANNON.Vec3());baselineCalls+=calls;
      calls=0;const b=optimized[0].findSeparatingAxis(optimized[1],pA,qA,pB,qB,new CANNON.Vec3());optimizedCalls+=calls;
      assert.equal(a,b,`Collision result differs for pose ${i}`);
    }
  }finally{CANNON.ConvexPolyhedron.project=project;}
  assert(optimizedCalls<baselineCalls*.5,'Redundant projections should fall by at least half');
});

import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {ImportedPeelingSurface,readSurfaceTriangles,partitionTriangles,refineSurfaceTriangles}=await import('../imported-peeling.js');
function fixture() {
  const scene=new THREE.Scene(),geometry=new THREE.SphereGeometry(1,28,20);
  geometry.setAttribute('restPosition',geometry.attributes.position.clone());
  const material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(geometry,material);
  mesh.scale.set(1,.9,.7);mesh.position.set(.3,0,-.2);scene.add(mesh);scene.updateMatrixWorld(true);
  const state={age:0,seed:7319,peel:.68,flakeFactor:1,exploded:0};
  const surface=new ImportedPeelingSurface({scene,entries:[{mesh,materialIndices:[0]}],materials:[material],state});
  return {scene,mesh,surface,state};
}
test('imported coating preserves UVs and smooth source normals, and partitions every triangle once',()=>{
  const {mesh,surface}=fixture();
  const triangles=readSurfaceTriangles([{mesh,materialIndices:[0]}]);
  const patches=partitionTriangles(triangles,30,123);
  assert.equal(patches.flat().length,triangles.length);
  assert.equal(new Set(patches.flat()).size,triangles.length);
  assert(surface.flakes.length>20&&surface.flakes.length<=500);
  for(const flake of surface.flakes)for(const info of flake.infos){
    if(info.wall)continue;
    const normal=new THREE.Vector3().fromBufferAttribute(surface.mesh.geometry.attributes.normal,info.index);
    assert(normal.dot(info.surfaceNormal)*(info.back?-1:1)>.999);
  }
  const uv=surface.mesh.geometry.attributes.uv;
  assert([...uv.array].every(x=>Number.isFinite(x)&&x>=0&&x<=1));
  surface.dispose();
});
test('zero peel stays attached; aged flakes detach with bounded bodies, settle above the floor, and repaint restores them',()=>{
  const {surface,state,scene}=fixture();
  state.age=1;state.peel=0;surface.update(.05);assert.equal(surface.detachedCount,0);
  state.peel=.8;
  for(let i=0;i<180;i++){surface.update(1/60);assert(surface.physics.stats().awake<=24);}
  assert(surface.detachedCount>0);assert(surface.detachedCount<=surface.flakes.length);
  const position=surface.mesh.geometry.attributes.position;
  assert([...position.array].every(Number.isFinite));
  for(const flake of surface.flakes.filter(f=>f.body))for(const info of flake.infos)assert(position.getY(info.index)>-1.77);
  state.age=0;surface.update(.05);
  assert.equal(surface.detachedCount,0);assert.equal(surface.physics.stats().total,0);
  for(const f of surface.flakes)for(const info of f.infos) {
    const p=new THREE.Vector3().fromBufferAttribute(position,info.index);
    const expected=info.base.clone();if(info.wall&&!info.back)expected.addScaledVector(info.surfaceNormal,-surface.thickness);
    assert(p.distanceTo(expected)<1e-6);
  }
  const parent=surface.parent;surface.dispose();assert(!scene.children.includes(parent));assert.equal(surface.physics.stats().total,0);
});
test('patches do not cross material boundaries or join disconnected components',()=>{
  const vertices=[new THREE.Vector3(0,0,0),new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0)];
  const t={vertices:vertices.map(position=>({position})),keys:['a','b','c'],material:0,mesh:0};
  const triangles=[t,{...t,material:1},{...t,keys:['d','e','f']}];
  const patches=partitionTriangles(triangles,1,1);
  assert.equal(patches.length,3);
});

test('vertex colors survive patching and release, including normalized RGBA attributes',()=>{
  const {scene,mesh,surface,state}=fixture();surface.dispose();
  const count=mesh.geometry.attributes.position.count,colors=new Uint8Array(count*4);
  for(let i=0;i<count;i++)colors.set([i%256,64,192,255],i*4);
  mesh.geometry.setAttribute('color',new THREE.Uint8BufferAttribute(colors,4,true));
  mesh.material.vertexColors=true;
  const entries=[{mesh,materialIndices:[0]}],triangles=readSurfaceTriangles(entries);
  const expected=new Set(triangles.flatMap(t=>t.vertices.map(v=>v.color.map(x=>Math.round(x*255)).join(','))));
  const peeling=new ImportedPeelingSurface({scene,entries,materials:[mesh.material],state});
  const attribute=peeling.mesh.geometry.attributes.color;
  for(let i=0;i<attribute.count;i++)assert(expected.has([attribute.getX(i),attribute.getY(i),attribute.getZ(i),attribute.getW(i)].map(x=>Math.round(x*255)).join(',')));
  const initial=attribute.array.slice();state.age=1;peeling.update(.05);
  assert(peeling.detachedCount>0);assert.deepEqual(attribute.array,initial);peeling.dispose();
});

test('an isolated triangle gets a closed collision hull and can peel',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,.02,0,0,0,.02,0],3));
  geometry.computeVertexNormals();geometry.setAttribute('restPosition',geometry.attributes.position.clone());
  const material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(geometry,material);scene.add(mesh);scene.updateMatrixWorld(true);
  const state={age:0,seed:1,peel:1,flakeFactor:1,exploded:0};
  const surface=new ImportedPeelingSurface({scene,entries:[{mesh,materialIndices:[0]}],materials:[material],state});
  assert.equal(surface.flakes.length,1);state.age=1;surface.update(.05);assert.equal(surface.detachedCount,1);surface.dispose();
});

test('sparse plinth faces gain crack detail without changing area, UVs or material boundaries',()=>{
  const geometry=new THREE.PlaneGeometry(2,.3,1,1);
  geometry.setAttribute('restPosition',geometry.attributes.position.clone());
  const mesh=new THREE.Mesh(geometry);mesh.updateMatrixWorld(true);
  const original=readSurfaceTriangles([{mesh,materialIndices:[0]}]);
  const refined=refineSurfaceTriangles(original);
  const area=triangles=>triangles.reduce((sum,t)=>sum+new THREE.Vector3().subVectors(t.vertices[1].position,t.vertices[0].position).cross(new THREE.Vector3().subVectors(t.vertices[2].position,t.vertices[0].position)).length()/2,0);
  assert(refined.length>50);assert(Math.abs(area(original)-area(refined))<1e-8);
  for(const t of refined)for(let i=0;i<3;i++) {
    const v=t.vertices[i];assert(v.position.distanceTo(t.vertices[(i+1)%3].position)<=.100001);
    assert(Math.abs(v.uv.x-(v.position.x/2+.5))<1e-6);
    assert(Math.abs(v.uv.y-(v.position.y/.3+.5))<1e-6);
    assert.equal(t.material,0);
  }
  const patches=partitionTriangles(refined,24,7319);
  assert(patches.length>=20);
  assert(Math.max(...patches.map(p=>area(p)))<area(original)*.15);
  assert.equal(new Set(patches.flat()).size,refined.length);
  const repeat=partitionTriangles(refined,24,7319);assert.deepEqual(patches,repeat);
});

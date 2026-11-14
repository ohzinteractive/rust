import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createClothSurface}=await import('../cloth-surface.js');
const {createClothCollider}=await import('../cloth-collider.js');

test('a broad roof holds cloth near its center despite small raised corner details',()=>{
  const roof=new THREE.Mesh(new THREE.BoxGeometry(3,3,2));
  const trim=new THREE.Mesh(new THREE.BoxGeometry(.2,.06,.2));trim.position.set(1.3,1.53,.8);
  const collider=createClothCollider([roof,trim]);
  assert(Math.hypot(collider.support.x,collider.support.z)<.06,'A small roof ornament must not pull the whole sheet to one corner');
  assert(collider.support.y>1.5,'The holding point stays above the roof');
  const contact=[1.3,1.52,.8];
  assert(collider.projectRoof(contact),'Roof detail corrects a nearby cloth sample');
  assert(contact[1]>1.6,'The cloth clears the raised trim and its thickness');
  assert.equal(collider.projectRoof([10,1.52,10]),false,'Roof contacts do not extend outside the specimen');
  const scene=new THREE.Scene(),cloth=createClothSurface({scene});cloth.rebuild([roof,trim],{resolution:12,radial:true});
  assert.equal(cloth.simulation.radial,false,'A broad roof uses a sheet without a radial pole');cloth.dispose();
  for(const mesh of [roof,trim]){mesh.geometry.dispose();mesh.material.dispose();}
});

test('radial display preserves simulated folds and attachment positions instead of flattening rows',()=>{
  const scene=new THREE.Scene(),body=new THREE.Mesh(new THREE.SphereGeometry(1,16,12));scene.add(body);
  const cloth=createClothSurface({scene});cloth.rebuild([body],{resolution:8,radial:true});
  const sim=cloth.simulation,n=sim.columns;assert(sim.radial);
  // Keep this asymmetric sheet clear of the collider so contact correction
  // cannot conceal an unwanted display-only change to the simulated shape.
  for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
    const i=(row*(n+1)+col)*3,angle=col/n*Math.PI*2;
    sim.positions[i]=Math.cos(angle)*row/n*3;
    sim.positions[i+1]=3+Math.sin(angle)*row/n*.6;
    sim.positions[i+2]=Math.sin(angle)*row/n*2;
  }
  const before=sim.positions.slice();cloth.setFabric('linen');
  assert.deepEqual(sim.positions,before,'Refreshing the display must preserve the solver state');
  const geometry=cloth.mesh.geometry,p=geometry.attributes.position,uv=geometry.attributes.uv;
  for(let i=0;i<p.count;i++){
    const x=uv.getX(i)*n,z=(1-uv.getY(i))*n;
    if(Math.abs(x-Math.round(x))>1e-6||Math.abs(z-Math.round(z))>1e-6)continue;
    const source=(Math.round(z)*(n+1)+Math.round(x))*3;
    assert(Math.hypot(p.getX(i)-before[source],p.getY(i)-before[source+1],p.getZ(i)-before[source+2])<1e-5,'Visible simulation nodes retain their physical positions');
  }
  cloth.dispose();body.geometry.dispose();body.material.dispose();
});

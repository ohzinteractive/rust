import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const THREE=await import('../vendor/three.module.js');
const {createCoreGeometry}=await import('../core-geometry.js');
const {noise}=await import('../peeling-surface.js');
const {createClothSurface}=await import('../cloth-surface.js');

function fixture(ropes=[]){
  const scene=new THREE.Scene(),mesh=new THREE.Mesh(createCoreGeometry(noise),new THREE.MeshBasicMaterial());mesh.rotation.set(.16,.23,.12);scene.add(mesh);
  const cloth=createClothSurface({scene});cloth.rebuild([mesh],{resolution:32,ropes});
  return {cloth,dispose(){cloth.dispose();mesh.geometry.dispose();mesh.material.dispose();}};
}
const settings=[{id:1,height:.5,tightness:.8},{id:2,height:.7,tightness:.8}];

test('ropes leave the initial drape untouched, wait a second after edits and wrap one at a time',()=>{
  const tied=fixture(settings),free=fixture();
  for(let i=0;i<180;i++){tied.cloth.advance(1/60);free.cloth.advance(1/60);}
  assert.deepEqual(tied.cloth.simulation.positions,free.cloth.simulation.positions,'Pending ropes must not affect the falling sheet');
  assert(tied.cloth.ropes.stats.every(r=>r.status==='waiting'&&r.attachments===0));
  assert(tied.cloth.ropes.group.children.every(c=>!c.visible));
  for(let i=0;i<50;i++)tied.cloth.advance(1/60);
  assert.equal(tied.cloth.ropes.stats[0].status,'wrapping');assert.equal(tied.cloth.ropes.stats[1].status,'waiting');
  for(let i=0;i<600;i++){
    tied.cloth.advance(1/60);assert(tied.cloth.ropes.stats.filter(r=>r.status==='wrapping').length<=1,'Ties cannot compete during tightening');
  }
  assert(tied.cloth.ropes.stats.every(r=>r.status==='tied'&&r.attachments>8));
  tied.cloth.setRopes([{...settings[0],height:.55},settings[1]]);
  for(let i=0;i<45;i++)tied.cloth.advance(1/60);assert.equal(tied.cloth.ropes.stats[0].status,'waiting');
  for(let i=0;i<30;i++)tied.cloth.advance(1/60);assert.equal(tied.cloth.ropes.stats[0].status,'wrapping');
  tied.dispose();free.dispose();
});

test('two settled ties on a sharp cube do not produce large frame jumps or extreme edge stretching',()=>{
  const f=fixture();for(let i=0;i<180;i++)f.cloth.advance(1/60);f.cloth.setRopes(settings);
  for(let i=0;i<600;i++)f.cloth.advance(1/60);
  const p=f.cloth.simulation.positions,old=p.slice();let maxMove=0,meanMove=0,edges=0,maxEdge=0;
  // Use the original sheet spacing, independent of its settled shape.
  const size=f.cloth.collider.bounds.getSize(new THREE.Vector3()),width=size.x+(f.cloth.collider.bounds.max.y+1.75)*1.35,spacing=width/32;
  for(let frame=0;frame<120;frame++){
    f.cloth.advance(1/60);
    for(let i=0;i<p.length;i+=3){
      const moved=Math.hypot(p[i]-old[i],p[i+1]-old[i+1],p[i+2]-old[i+2]);maxMove=Math.max(maxMove,moved);meanMove+=moved;
      if((i/3)%33<32)maxEdge=Math.max(maxEdge,Math.hypot(p[i+3]-p[i],p[i+4]-p[i+1],p[i+5]-p[i+2]));edges++;
    }
    old.set(p);
  }
  assert(p.every(Number.isFinite));assert(maxMove<.2,`Frame jump ${maxMove}`);assert(meanMove/edges<.004,`Mean motion ${meanMove/edges}`);assert(maxEdge/spacing<1.9,`Edge stretch ${maxEdge/spacing}`);
  let inside=0;for(let i=0;i<p.length;i+=3)if(f.cloth.collider.contains(p,i))inside++;assert(inside<4);
  const visible=f.cloth.mesh.geometry.attributes.position.array;
  assert(visible.length>p.length,'The visible sheet refines coarse collision faces');
  let visibleInside=0;for(let i=0;i<visible.length;i+=3)if(f.cloth.collider.contains(visible,i))visibleInside++;
  assert.equal(visibleInside,0,'Refined cloth vertices stay outside the underlying object');
  for(const cord of f.cloth.ropes.group.children.filter(c=>c.name==='Cloth binding rope')){
    const attribute=cord.geometry.attributes.position,loop=[];
    for(let i=0;i<96;i++)loop.push([(attribute.getX(i*8)+attribute.getX(i*8+4))/2,(attribute.getZ(i*8)+attribute.getZ(i*8+4))/2]);
    const y=attribute.getY(0);let crossings=0;
    const indices=f.cloth.mesh.geometry.index;
    for(let edge=0;edge<indices.count;edge++){
      const triangle=edge-edge%3,a=indices.getX(edge)*3,b=indices.getX(triangle+(edge%3+1)%3)*3,ya=visible[a+1],yb=visible[b+1];
      if((ya-y)*(yb-y)>0||Math.abs(yb-ya)<1e-8)continue;
      const t=(y-ya)/(yb-ya),px=visible[a]*(1-t)+visible[b]*t,pz=visible[a+2]*(1-t)+visible[b+2]*t;
      for(let j=0;j<96;j++){
        const start=loop[j],end=loop[(j+1)%96],side=(end[0]-start[0])*(pz-start[1])-(end[1]-start[1])*(px-start[0]);
        assert(side>-.004,'The visible rope encloses the cloth folds');
      }
      crossings++;
    }
    assert(crossings>8);
  }

  f.dispose();
});

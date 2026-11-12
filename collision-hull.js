const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(a[0],a[1],a[2]);
const distance2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
const normalize=a=>mul(a,1/length(a));
const point=a=>[a.x,a.y,a.z];
const KEY_EPS=1e-8;
const PLANE_EPS=1e-10;
const key=p=>p.map(x=>Math.round(x/KEY_EPS)).join(',');

function clean(poly){
  const out=[];
  for(const p of poly)if(!out.length||distance2(p,out[out.length-1])>KEY_EPS*KEY_EPS)out.push(p);
  if(out.length>1&&distance2(out[0],out[out.length-1])<=KEY_EPS*KEY_EPS)out.pop();
  return out;
}

function capPolygon(points,normal){
  const unique=[...new Map(points.map(p=>[key(p),p])).values()];
  if(unique.length<3)return null;
  const center=mul(unique.reduce(add,[0,0,0]),1/unique.length);
  const n=normalize(normal);
  const reference=Math.abs(n[0])<.7?[1,0,0]:[0,1,0];
  const x=normalize(cross(reference,n)),y=cross(n,x);
  unique.sort((a,b)=>Math.atan2(dot(sub(a,center),y),dot(sub(a,center),x))-Math.atan2(dot(sub(b,center),y),dot(sub(b,center),x)));
  return clean(unique);
}

function clipPolyhedron(polygons,normal,support){
  let anyOutside=false;
  for(const poly of polygons)for(const p of poly)if(dot(normal,p)-support>PLANE_EPS){anyOutside=true;break;}
  if(!anyOutside)return polygons;
  const result=[],cap=[];
  for(const polygon of polygons){
    const clipped=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      let da=dot(normal,a)-support,db=dot(normal,b)-support;
      if(Math.abs(da)<PLANE_EPS)da=0;
      if(Math.abs(db)<PLANE_EPS)db=0;
      const insideA=da<=0,insideB=db<=0;
      if(insideA)clipped.push(a);
      if(insideA!==insideB){
        const t=da/(da-db);
        const p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])];
        clipped.push(p);cap.push(p);
      }
    }
    const poly=clean(clipped);
    if(poly.length>=3)result.push(poly);
  }
  const face=capPolygon(cap,normal);
  if(face&&face.length>=3)result.push(face);
  return result;
}

/**
 * Build a conservative 26-direction k-DOP collision hull around render vertices.
 *
 * `points` are body-local coordinates already aligned to the world at release.
 * `basis` contains the world-oriented, orthonormal source-face axes {u,v,n}.
 * They need not align with the global XYZ axes. The internal space is scaled
 * by its bounds before choosing diagonal directions, so a thin curled sheet
 * receives useful bevel planes rather than a nearly rectangular global hull.
 *
 * Every clipping plane is an outward support plane of *all* input vertices,
 * expanded by `skin` world units. Output polygons remain planar polygons;
 * they are never triangulated. There can be at most26 faces, and typically
 * about40–48 vertices, independent of source tessellation density.
 */
export function buildCollisionHull(points,basis={u:{x:1,y:0,z:0},v:{x:0,y:1,z:0},n:{x:0,y:0,z:1}},skin=.001){
  if(!Array.isArray(points)||points.length<4)throw new TypeError('A collision hull needs at least four input points.');
  if(!Number.isFinite(skin)||skin<=0)throw new TypeError('Collision skin must be positive.');
  const axes=[basis.u,basis.v,basis.n].map((axis,index)=>{
    if(!axis||!['x','y','z'].every(k=>Number.isFinite(axis[k])))throw new TypeError(`Invalid basis axis ${index}.`);
    const p=point(axis);if(length(p)<1e-8)throw new TypeError('Basis axes must be nonzero.');return normalize(p);
  });
  if(Math.max(Math.abs(dot(axes[0],axes[1])),Math.abs(dot(axes[1],axes[2])),Math.abs(dot(axes[0],axes[2])))>1e-5)throw new TypeError('Basis axes must be orthogonal.');
  // Reversing one face basis would reverse every face winding in world space.
  const handedness=dot(cross(axes[0],axes[1]),axes[2]);
  const source=points.map((p,index)=>{
    if(!['x','y','z'].every(k=>Number.isFinite(p[k])))throw new TypeError(`Invalid hull point ${index}.`);
    const q=point(p);return axes.map(axis=>dot(q,axis));
  });
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const p of source)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
  const center=lo.map((x,i)=>(x+hi[i])*.5);
  const scale=lo.map((x,i)=>Math.max((hi[i]-x)*.5,skin));
  const normalized=source.map(p=>p.map((x,i)=>(x-center[i])/scale[i]));
  const lower=lo.map((x,i)=>(x-center[i]-skin)/scale[i]);
  const upper=hi.map((x,i)=>(x-center[i]+skin)/scale[i]);
  const corners=[
    [lower[0],lower[1],lower[2]],[upper[0],lower[1],lower[2]],
    [upper[0],upper[1],lower[2]],[lower[0],upper[1],lower[2]],
    [lower[0],lower[1],upper[2]],[upper[0],lower[1],upper[2]],
    [upper[0],upper[1],upper[2]],[lower[0],upper[1],upper[2]],
  ];
  let polygons=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]].map(face=>face.map(i=>corners[i]));
  // Six axis support planes already form the starting box. The remaining
  // twelve edge-diagonal and eight corner-diagonal support planes bevel it.
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    if((x!==0)+(y!==0)+(z!==0)<2)continue;
    const normal=[x,y,z];
    const support=Math.max(...normalized.map(p=>dot(normal,p)))+skin*Math.hypot(x/scale[0],y/scale[1],z/scale[2]);
    polygons=clipPolyhedron(polygons,normal,support);
  }
  const vertices=[],faces=[],normalizedVertices=[];
  for(const polygon of polygons){
    const ids=[];
    for(const p of polygon){
      // Independent plane intersections can land on opposite sides of a hash
      // cell boundary even when they describe the same corner. Weld by actual
      // distance in normalized space so every face shares the same vertex IDs.
      let index=normalizedVertices.findIndex(q=>distance2(p,q)<=KEY_EPS*KEY_EPS*4);
      if(index===-1){
        const local=p.map((x,i)=>x*scale[i]+center[i]);
        const q=axes.reduce((sum,axis,i)=>add(sum,mul(axis,local[i])),[0,0,0]);
        index=vertices.length;normalizedVertices.push(p);vertices.push({x:q[0],y:q[1],z:q[2]});
      }
      if(!ids.length||ids[ids.length-1]!==index)ids.push(index);
    }
    if(ids[0]===ids[ids.length-1])ids.pop();
    if(ids.length<3)continue;
    if(handedness<0)ids.reverse();
    // Cannon determines a polygon normal from its first three vertices. Choose
    // the strongest consecutive turn so redundant collinear points are safe.
    let start=0,strongest=0;
    for(let i=0;i<ids.length;i++){
      const a=point(vertices[ids[i]]),b=point(vertices[ids[(i+1)%ids.length]]),c=point(vertices[ids[(i+2)%ids.length]]);
      const strength=length(cross(sub(b,a),sub(c,a)));
      if(strength>strongest){strongest=strength;start=i;}
    }
    if(strongest<1e-14)throw new Error('Collision hull has a collapsed face.');
    faces.push([...ids.slice(start),...ids.slice(0,start)]);
  }
  if(faces.length<4||faces.length>26)throw new Error('Collision hull construction failed.');
  // Cannon's contact clipping requires a closed polyhedron. Catch malformed
  // adjacency here rather than letting a collision fail during animation.
  const edges=new Map();
  for(const face of faces)for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length],id=a<b?`${a},${b}`:`${b},${a}`;
    edges.set(id,(edges.get(id)??0)+1);
  }
  if([...edges.values()].some(count=>count!==2))throw new Error('Collision hull has an open or non-manifold edge.');
  return {vertices,faces};
}

import * as THREE from 'three';

export const mazeMaps=Object.freeze([{id:'garden',name:'Garden'},{id:'observatory',name:'Observatory'}]);
let activeMap='garden';
export function getMazeMap(){return activeMap;}
export function setMazeMap(id){
  if(!mazeMaps.some(map=>map.id===id))throw new RangeError('Unknown maze map: '+id);
  if(activeMap===id)return false;
  activeMap=id;layout=undefined;return true;
}
function createGardenPlan(){
  const cells=15,size=31,walls=Array.from({length:size},()=>new Uint8Array(size).fill(1));
  const courtyard={left:5,right:9,top:5,bottom:10};
  const inside=(x,z)=>x>=courtyard.left&&x<=courtyard.right&&z>=courtyard.top&&z<=courtyard.bottom;
  const visited=Array.from({length:cells},()=>new Uint8Array(cells));
  for(let z=11;z<=21;z++)for(let x=11;x<=19;x++)walls[z][x]=0;
  let seed=1941;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const stack=[{x:7,z:14,dx:0,dz:-1}];visited[14][7]=1;walls[29][15]=0;
  while(stack.length){
    const current=stack.at(-1);
    const options=[[0,-1],[1,0],[0,1],[-1,0]].filter(([dx,dz])=>{
      const x=current.x+dx,z=current.z+dz;
      return x>=0&&z>=0&&x<cells&&z<cells&&!inside(x,z)&&!visited[z][x];
    });
    if(!options.length){stack.pop();continue;}
    const straight=options.find(([dx,dz])=>dx===current.dx&&dz===current.dz);
    const [dx,dz]=straight&&random()<.68?straight:options[Math.floor(random()*options.length)];
    const x=current.x+dx,z=current.z+dz;
    walls[current.z*2+1+dz][current.x*2+1+dx]=0;walls[z*2+1][x*2+1]=0;
    visited[z][x]=1;stack.push({x,z,dx,dz});
  }
  walls[30][15]=0;walls[22][15]=0;
  return {size,walls,courtyard,entry:{x:15,z:29},goal:{x:15,z:16},goalLabel:'central courtyard'};
}
export function createMazePlan(){return activeMap==='garden'?createGardenPlan():createObservatoryPlan();}

// Room-and-passage plan inspired by the supplied dungeon drawing. Outside
// cells are distinct from structural walls, preserving the irregular silhouette.
function createObservatoryPlan(){
  const size=31,walls=Array.from({length:size},()=>new Uint8Array(size).fill(2));
  function polygon(points){
    for(let z=0;z<size;z++)for(let x=0;x<size;x++){
      const px=x+.5,pz=z+.5;let inside=false;
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const [ax,az]=points[i],[bx,bz]=points[j];
        if((az>pz)!==(bz>pz)&&px<(bx-ax)*(pz-az)/(bz-az)+ax)inside=!inside;
      }
      if(inside)walls[z][x]=0;
    }
  }
  function room(x,z,width,depth){polygon([[x,z],[x+width,z],[x+width,z+depth],[x,z+depth]]);}
  function corridor(points){
    for(let i=1;i<points.length;i++){
      const [ax,az]=points[i-1],[bx,bz]=points[i];
      for(let z=Math.min(az,bz);z<=Math.max(az,bz);z++)for(let x=Math.min(ax,bx);x<=Math.max(ax,bx);x++)walls[z][x]=0;
    }
  }
  polygon([[15.5,1],[21,6.5],[21,10],[10,10],[10,6.5]]);
  room(4,2,3,4);room(2,7,5,4);
  polygon([[23,5],[26,8],[26,13],[21,13],[21,8]]);
  room(9,11,10,6);room(5,12,4,4);room(20,13,6,3);
  room(27,16,3,4);room(3,20,5,4);room(10,21,6,7);
  room(18,20,5,4);room(18,27,4,2);room(26,22,3,5);
  corridor([[6,4],[11,4],[11,7]]);corridor([[6,8],[12,8]]);
  corridor([[19,7],[23,7]]);corridor([[15,9],[15,12]]);
  corridor([[18,14],[22,14]]);corridor([[25,14],[25,18],[28,18]]);
  corridor([[12,16],[12,22]]);corridor([[11,17],[11,20],[7,20]]);
  corridor([[17,16],[17,18],[20,18],[20,21]]);
  corridor([[20,23],[20,28]]);corridor([[25,18],[26,18],[26,23]]);
  corridor([[21,26],[27,26]]);corridor([[15,27],[15,30]]);
  // A few structural piers articulate the larger chambers without closing doors.
  for(const [x,z] of [[13,6],[17,6],[11,13],[16,13],[11,15],[16,15],[5,21],[6,22],[12,24],[14,24],[20,21]])walls[z][x]=1;
  const open=walls.map(row=>row.slice());
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)if(open[z][x]===2){
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(open[z+dz]?.[x+dx]===0)walls[z][x]=1;
  }
  return {size,walls,courtyard:{left:5,right:9,top:0,bottom:4},entry:{x:15,z:29},goal:{x:15,z:6},goalLabel:'northern observatory'};
}

export const mazeDimensions=Object.freeze({size:31,unit:3.3/31,hinge:14,height:.38});
const {unit,hinge,height}=mazeDimensions;
export function mazePoint(x,z,y=0){
  const taper=1-.28*Math.max(0,(z-hinge)/(31-hinge));
  return new THREE.Vector3((x-15.5)*unit*taper,y,(z-15.5)*unit);
}
const point=mazePoint;

let layout;
export function getMazeLayout(){
  if(layout)return layout;
  const {size,walls}=createMazePlan(),used=Array.from({length:size},()=>new Uint8Array(size)),rectangles=[],patches=[];
  // Greedy rectangles remove internal faces. Split at the taper hinge so every
  // cap and collider remains planar and convex.
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    if(walls[z][x]!==1||used[z][x])continue;
    let width=1,depth=1;
    while(x+width<size&&walls[z][x+width]===1&&!used[z][x+width])width++;
    const end=z<hinge?hinge:size;
    while(z+depth<end&&Array.from({length:width},(_,i)=>walls[z+depth][x+i]===1&&!used[z+depth][x+i]).every(Boolean))depth++;
    for(let j=z;j<z+depth;j++)for(let i=x;i<x+width;i++)used[j][i]=1;
    rectangles.push({x,z,width,depth});
  }
  function quad(corners){
    const u=corners[1].clone().sub(corners[0]).normalize();
    const n=new THREE.Vector3().crossVectors(u,corners[3].clone().sub(corners[0])).normalize();
    const v=new THREE.Vector3().crossVectors(n,u).normalize();
    const area=new THREE.Triangle(corners[0],corners[1],corners[2]).getArea()+new THREE.Triangle(corners[0],corners[2],corners[3]).getArea();
    patches.push({corners,n,u,v,area});
  }
  for(const {x,z,width,depth} of rectangles){
    quad([point(x,z,height/2),point(x,z+depth,height/2),point(x+width,z+depth,height/2),point(x+width,z,height/2)]);
    quad([point(x,z,-height/2),point(x+width,z,-height/2),point(x+width,z+depth,-height/2),point(x,z+depth,-height/2)]);
  }
  // Only exposed cell edges become vertical walls; adjoining wall cells share
  // a solid volume, with no hidden overlapping box faces or blocked passages.
  for(const [dx,dz] of [[0,-1],[1,0],[0,1],[-1,0]])for(let line=0;line<size;line++){
    let start=-1;
    for(let i=0;i<=size;i++){
      const x=dx?line:i,z=dx?i:line;
      const exposed=i<size&&walls[z]?.[x]===1&&walls[z+dz]?.[x+dx]!==1;
      if(start!==-1&&(!exposed||(dx&&i===hinge))){
        let a=dx?[line+(dx>0?1:0),start]:[start,line+(dz>0?1:0)];
        let b=dx?[a[0],i]:[i,a[1]];
        if(dx<0||dz>0)[a,b]=[b,a];
        quad([point(...a,height/2),point(...b,height/2),point(...b,-height/2),point(...a,-height/2)]);
        start=-1;
      }
      if(exposed&&start===-1)start=i;
    }
  }
  const hulls=rectangles.map(({x,z,width,depth})=>{
    const vertices=[];
    for(const y of [-height/2,height/2])for(const [a,b] of [[x,z],[x+width,z],[x+width,z+depth],[x,z+depth]])vertices.push(point(a,b,y));
    return {vertices,faces:[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]};
  });
  return layout={patches,hulls};
}

export function createMazeGeometry(){
  const positions=[],normals=[],uv=[];
  for(const {corners,n} of getMazeLayout().patches)for(const i of [0,1,2,0,2,3]){
    positions.push(...corners[i]);normals.push(...n);uv.push(...[[0,0],[1,0],[1,1],[0,1]][i]);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  return geometry;
}

// One indexed plane follows the occupied footprint instead of spanning empty
// space between annexes. The room reuses it for its ceiling and mirror floor.
export function createMazeFloorGeometry(){
  const {walls,size}=createMazePlan(),positions=[],indices=[];
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)if(walls[z][x]!==2){
    const start=positions.length/3;
    for(const [a,b] of [[x,z],[x,z+1],[x+1,z+1],[x+1,z]]){const p=mazePoint(a,b);positions.push(p.x,-p.z,0);}
    indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

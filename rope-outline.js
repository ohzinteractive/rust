const TAU=Math.PI*2;

// A taut cord follows the convex envelope of its contacts. Round that envelope
// outward, then reserve extra samples for bends instead of casting equally
// spaced rays from the center (which misses small corner arcs).
export function sampleRopeOutline(points,count,padding=.014){
  const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const unique=sorted.filter((p,i)=>!i||Math.hypot(p[0]-sorted[i-1][0],p[1]-sorted[i-1][1])>1e-7);
  if(unique.length<3)return null;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const lower=[],upper=[];
  for(const p of unique){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(let i=unique.length-1;i>=0;i--){const p=unique[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  const hull=lower.slice(0,-1).concat(upper.slice(0,-1));if(hull.length<3)return null;
  const edges=hull.map((a,i)=>{
    const b=hull[(i+1)%hull.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    return {dx,dz,length,nx:dz/length,nz:-dx/length};
  });
  const perimeter=edges.reduce((sum,edge)=>sum+edge.length,0),pieces=[];
  let total=0;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],incoming=edges[(i+hull.length-1)%hull.length],edge=edges[i];
    const angle=Math.atan2(incoming.nz,incoming.nx),turn=(Math.atan2(edge.nz,edge.nx)-angle+TAU)%TAU;
    const arcWeight=turn*(padding+perimeter*.25/TAU);
    if(arcWeight>1e-10){pieces.push({arc:true,a,angle,turn,start:total,weight:arcWeight});total+=arcWeight;}
    pieces.push({arc:false,a,edge,start:total,weight:edge.length});total+=edge.length;
  }
  const samples=new Float32Array(count*4);let cursor=0;
  for(let i=0;i<count;i++){
    const distance=i/count*total;
    while(cursor<pieces.length-1&&distance>=pieces[cursor].start+pieces[cursor].weight)cursor++;
    const piece=pieces[cursor],t=(distance-piece.start)/piece.weight;
    let x,z,nx,nz;
    if(piece.arc){
      const angle=piece.angle+piece.turn*t;nx=Math.cos(angle);nz=Math.sin(angle);
      x=piece.a[0]+nx*padding;z=piece.a[1]+nz*padding;
    }else{
      const edge=piece.edge;nx=edge.nx;nz=edge.nz;
      x=piece.a[0]+edge.dx*t+nx*padding;z=piece.a[1]+edge.dz*t+nz*padding;
    }
    samples.set([x,z,nx,nz],i*4);
  }
  return samples;
}

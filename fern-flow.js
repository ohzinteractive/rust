// A shared analytic flow field: three curl-like modes produce coherent eddies
// without a voxel grid, pressure solve, particle neighbours or allocations.
// Coordinates follow the mean wind, so changing direction rotates the flow.
export function sampleFernFlow(point,time,windVector,strength,floorY,out){
  const magnitude=Math.hypot(windVector.x,windVector.z);
  const dx=magnitude>0?windVector.x/magnitude:1,dz=magnitude>0?windVector.z/magnitude:0;
  const along=point.x*dx+point.z*dz-time*magnitude*.55;
  const across=-point.x*dz+point.z*dx,height=Math.max(0,point.y-floorY);
  const a=along*1.25+time*.38,b=across*1.1-time*.27,c=height*1.4+time*.31;
  // Each component omits its own spatial coordinate, giving a divergence-free
  // eddy field before the near-ground vertical damping is applied.
  const swirlAlong=Math.sin(b)+.55*Math.cos(c);
  const swirlAcross=Math.sin(c)+.55*Math.cos(a);
  const swirlUp=Math.sin(a)+.55*Math.cos(b);
  const gust=1+.2*Math.sin(time*.63)+.1*Math.sin(time*1.17+.8);
  const turbulence=strength*.34,ground=Math.min(1,height/.35);
  const forward=magnitude*gust+turbulence*swirlAlong,lateral=turbulence*swirlAcross;
  return out.set(dx*forward-dz*lateral,turbulence*swirlUp*ground, dz*forward+dx*lateral);
}

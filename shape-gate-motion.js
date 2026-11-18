export const swingRate = .8;
export const swingPivotHeight = 15;
export const swingCenterHeight = 1.5;
export const swingLength = swingPivotHeight - swingCenterHeight;
// Keep the model's depth of travel with the higher pivot.
export const swingAmplitude = Math.asin(2.12 / swingLength);
const diskSeparation = .18;
export const gateTurnClearance = .55;
// Radians of wheel travel per radian of swing phase while passing the plate.
export const gateCrossingRate = .14;

export function morphEase(t){
 return t*t*t*(t*(t*6-15)+10);
}

// Integrate a steady cruising speed with smooth ramps at either end.
function cruiseDistance(time,width,ramp){
 function rampDistance(x){
  const t=x/ramp;
  return ramp*t*t*t*(1-t/2);
 }
 if(time<ramp)return rampDistance(time);
 if(time>width-ramp)return width-ramp-rampDistance(width-time);
 return time-ramp/2;
}

// Each half swing gets exactly one revolution. A small positive speed
// through the crossing preserves motion while keeping the slot aligned.
export function gateMotion(elapsed,returnClearance=gateTurnClearance,departureClearance=gateTurnClearance){
 const phase=elapsed*swingRate;
 const step=Math.floor(phase/Math.PI),half=phase-step*Math.PI;
 const width=Math.PI-departureClearance-returnClearance;
 const ramp=Math.min(.29,width/3);
 const cruiseTime=Math.max(0,Math.min(width,half-departureClearance));
 const cruise=(Math.PI*2-gateCrossingRate*Math.PI)/(width-ramp);
 const disk=step*Math.PI*2+gateCrossingRate*half+cruise*cruiseDistance(cruiseTime,width,ramp);
 return {swing:-Math.sin(phase)*swingAmplitude,disk};
}

// Find the closest safe swing angle from either side. The margin includes
// the thickness of the disk and keeps the cord clear above the shape.
export function createSwingClearance(separation=diskSeparation){
 const angle={front:0,back:0},sin={front:0,back:0},cos={front:1,back:1};
 function include(side,radius,depth){
  if(radius*sin[side]+depth*cos[side]>=separation)return;
  const tilt=Math.asin(separation/Math.hypot(radius,depth))-Math.atan2(depth,radius);
  angle[side]=tilt;
  sin[side]=Math.sin(tilt);
  cos[side]=Math.cos(tilt);
 }
 return {
  angle,
  add(y,z){
   const radius=swingLength-y;
   include('front',radius,z);
   include('back',radius,-z);
  }
 };
}

export function phaseForClearance(angle){
 return Math.asin(Math.min(.98,angle/swingAmplitude));
}

// Fit the morph onto the ordinary swing. A growing shape can change as
// it leaves the plate, and a shrinking one can change on the way in.
export function planNearDiskMorph(step,clearances,earliest=step*Math.PI/swingRate){
 const distances=clearances.map(phaseForClearance),last=distances.length-1;
 const halfStart=step*Math.PI,halfEnd=halfStart+Math.PI;
 const maxDistance=Math.PI/2-.13;
 let best=null,bestScore=Infinity;
 for(const direction of [-1,1])for(const span of [.24,.28,.32,.36,.40,.44,.48,.52]){
  let startDistance=0;
  for(let i=0;i<=last;i++){
   // Each prepared mesh is visible for half a frame on either side of
   // its sampled progress. Use the part closest to the disk.
   const nearProgress=Math.max(0,Math.min(1,(i-direction*.5)/last));
   startDistance=Math.max(startDistance,distances[i]-direction*span*nearProgress);
  }
  startDistance+=.016;
  const endDistance=startDistance+direction*span;
  if(Math.max(startDistance,endDistance)>maxDistance)continue;
  const start=(direction===1?halfStart+startDistance:halfEnd-startDistance)/swingRate;
  if(start<earliest)continue;
  let excess=0,totalExcess=0;
  for(let i=0;i<=last;i++){
   const gap=startDistance+direction*span*i/last-distances[i];
   excess=Math.max(excess,gap);
   totalExcess+=gap;
  }
  const score=excess+.12*totalExcess/(last+1)+(direction===1?.012:0)-.06*span;
  if(score>=bestScore)continue;
  bestScore=score;
  best={step,start,duration:span/swingRate};
 }
 return best;
}

import * as T from 'three';
import {cordSlotHalfWidth,gateDepth,gateRadius} from './shape-gate-aperture.js';

export const gateRimDepth = .36;
export const gateRimRadius = gateRadius + .035;
const rimBevel = .024;
export const gateRimInnerRadius = gateRimRadius - .24 - 2 * rimBevel;

export function createGateRimGeometry(){
 const bevel = rimBevel;
 const outer = gateRimRadius - bevel;
 const inner = gateRimInnerRadius + bevel;
 // Give the cord more room where it crosses the thicker edge.
 const halfSlot = cordSlotHalfWidth + bevel + .009;
 const outerAngle = Math.acos(halfSlot / outer);
 const innerAngle = Math.acos(halfSlot / inner);
 const shape = new T.Shape();
 shape.moveTo(-halfSlot, outer * Math.sin(outerAngle));
 shape.absarc(0,0,outer,Math.PI-outerAngle,Math.PI*2+outerAngle,false);
 shape.lineTo(halfSlot, inner * Math.sin(innerAngle));
 shape.absarc(0,0,inner,innerAngle,-Math.PI-innerAngle,true);
 shape.closePath();

 const depth = gateRimDepth - 2 * bevel;
 const geometry = new T.ExtrudeGeometry(shape,{
  depth, curveSegments:48, bevelEnabled:true, bevelSize:bevel, bevelThickness:bevel, bevelSegments:3
 });
 return geometry.translate(0,0,(gateDepth-depth)/2);
}

// Join the silhouette to the outside edge with a real open cord slot.
// The clockwise silhouette follows the long way around its bottom edge.
export function createSlottedGateShape(clockwiseOutline,radius=gateRadius,halfSlot=cordSlotHalfWidth){
  const outline=clockwiseOutline, crossings=[];
  for(const x of [halfSlot,-halfSlot]){
    let best=null;
    for(let i=0;i<outline.length;i++){
      const a=outline[i],b=outline[(i+1)%outline.length];
      if(Math.abs(b.x-a.x)<1e-12)continue;
      const t=(x-a.x)/(b.x-a.x);
      if(t<0||t>1)continue;
      const y=a.y+(b.y-a.y)*t;
      if(!best||y>best.point.y)best={edge:i,point:new T.Vector2(x,y)};
    }
    if(!best)throw Error('The model silhouette is too narrow for the string slot.');
    crossings.push(best);
  }
  const [right,left]=crossings,angle=Math.acos(halfSlot/radius),top=Math.sqrt(radius*radius-halfSlot*halfSlot);
  const shape=new T.Shape();shape.moveTo(-radius,0);shape.absarc(0,0,radius,Math.PI,Math.PI*2,false);
  shape.absarc(0,0,radius,0,angle,false);shape.lineTo(right.point.x,right.point.y);
  let edge=(right.edge+1)%outline.length;
  // A shared top edge still requires the full loop around the opening.
  do{shape.lineTo(outline[edge].x,outline[edge].y);if(edge===left.edge)break;edge=(edge+1)%outline.length;}while(edge!==(right.edge+1)%outline.length);
  shape.lineTo(left.point.x,left.point.y);shape.lineTo(-halfSlot,top);
  shape.absarc(0,0,radius,Math.PI-angle,Math.PI,false);shape.closePath();
  return shape;
}

export function createProfiledGateShape({outline, holes}) {
  const points = contour => contour.map(([x,y]) => new T.Vector2(x,y));
  const shape = createSlottedGateShape(points(outline));
  for (const hole of holes) {
    const path = new T.Path(points(hole));
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

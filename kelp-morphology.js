import * as THREE from 'three';

// A narrow pedicel grows into an asymmetric gas bladder, then tapers into the
// flattened blade neck. The two narrow ends avoid a bead threaded onto a stalk.
export function createKelpFloatGeometry(length,radius){
  const profile=[[0,0],[.025,.10],[.14,.24],[.32,.64],[.53,.97],[.70,1],[.84,.78],[.94,.43],[1,.25],[1.025,0]];
  const points=profile.map(([t,r])=>new THREE.Vector2(r*radius,t*length));
  return new THREE.LatheGeometry(points,12);
}

export function kelpBladeEnvelope(t){
  t=THREE.MathUtils.clamp(t,0,1);
  return Math.pow(Math.sin(Math.PI*t),.44)*(1-.26*t)+.09*Math.exp(-t*30)*(1-t);
}

// Shared by direct lighting and transmitted sunlight. Thick ribs absorb much
// more light than the surrounding thin tissue; vein detail fades below a pixel.
export const kelpLeafTissueShader=`
  float kelpMidgroundGain(float distanceToCamera,float facing){
    float band=smoothstep(2.0,5.0,distanceToCamera)*(1.0-smoothstep(14.0,24.0,distanceToCamera));
    return 1.0+.25*band*pow(clamp(facing,0.0,1.0),.6);
  }
  float kelpMidrib(vec2 uv){return 1.0-smoothstep(.025,.115,abs(uv.y));}
  float kelpSideVeins(vec2 uv){
    float phase=uv.x*68.0-abs(uv.y)*5.0+.3*sin(uv.x*11.0);
    float resolved=1.0-smoothstep(.5,1.8,fwidth(phase));
    return (1.0-smoothstep(.05,.32,abs(sin(phase))))*resolved*smoothstep(.10,.28,abs(uv.y));
  }
  float kelpTissueThickness(vec2 uv){
    return .085+.72*kelpMidrib(uv)+.16*kelpSideVeins(uv)+.13*(1.0-smoothstep(.0,.14,uv.x));
  }
  vec3 kelpLeafTransmittance(vec2 uv){
    return exp(-vec3(1.35,2.1,6.5)*kelpTissueThickness(uv))*vec3(1.0,.80,.23);
  }
`;

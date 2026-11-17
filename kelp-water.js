// Shared world-space waves keep the waterline and optical path in agreement.
export const oceanShader=`
  float oceanHeight(vec2 p,float t){
    return sin(p.x*.62+p.y*.27+t*.65)*.12
      +sin(p.y*1.05-p.x*.21-t*.43)*.055
      +sin(p.x*1.8+p.y*1.3+t*.82)*.018;
  }
  vec3 oceanNormal(vec2 p,float t){
    float e=.035;
    return normalize(vec3(oceanHeight(p-vec2(e,0),t)-oceanHeight(p+vec2(e,0),t),2.0*e,
      oceanHeight(p-vec2(0,e),t)-oceanHeight(p+vec2(0,e),t)));
  }
  vec3 oceanSky(vec3 d){
    d=d/max(length(d),.0001);
    vec3 sky=mix(vec3(.22,.52,.74),vec3(.055,.28,.60),smoothstep(0.0,.85,d.y));
    vec2 p=d.xz/max(.12,d.y)*1.7;
    float cloud=sin(p.x*.75+sin(p.y*.8))*sin(p.y*1.2)+.32*sin(p.x*2.4+p.y*1.7);
    cloud=smoothstep(.40,.94,cloud)*smoothstep(.02,.22,d.y);
    sky=mix(sky,vec3(1.05,1.07,1.02),cloud*.78);
    float sun=max(0.0,dot(d,normalize(vec3(-.14,1.0,-.52))));
    return sky+vec3(1.0,.89,.68)*(pow(sun,550.0)*8.0+pow(sun,20.0)*.18);
  }
`;

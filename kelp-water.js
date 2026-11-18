// Shared world-space waves keep the waterline and optical path in agreement.
export const oceanShader=`
  float oceanHeight(vec2 p,float t){
    return sin(p.x*.62+p.y*.27+t*.65)*.12
      +sin(p.y*1.05-p.x*.21-t*.43)*.055
      +sin(p.x*1.8+p.y*1.3+t*.82)*.018;
  }
  vec3 oceanFilteredNormal(vec2 p,float t,float footprint){
    vec2 k1=vec2(.62,.27),k2=vec2(-.21,1.05),k3=vec2(1.8,1.3);
    vec2 slope=k1*cos(dot(p,k1)+t*.65)*.12*exp(-pow(footprint*length(k1)*.6,2.0))
      +k2*cos(dot(p,k2)-t*.43)*.055*exp(-pow(footprint*length(k2)*.6,2.0))
      +k3*cos(dot(p,k3)+t*.82)*.018*exp(-pow(footprint*length(k3)*.6,2.0));
    return normalize(vec3(-slope.x,1.0,-slope.y));
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
  vec3 oceanReflection(vec3 d){
    d=normalize(d);
    // A rough water footprint sees broad sky radiance. Projecting detailed
    // clouds through 1/d.y makes razor-thin stripes at grazing angles.
    vec3 sky=mix(vec3(.22,.52,.74),vec3(.055,.28,.60),smoothstep(0.0,.85,d.y));
    float cloud=sin(d.x*3.0+sin(d.z*2.0))*sin(d.z*4.0-d.x);
    float cloudFootprint=max(length(dFdx(d)),length(dFdy(d)))*4.0;
    cloud=smoothstep(.25,.85,cloud)*smoothstep(.10,.45,d.y)*exp(-cloudFootprint*cloudFootprint);
    return mix(sky,vec3(.72,.82,.84),cloud*.30);
  }
`;

// Optical detail is separate from the large waves used to locate the boundary.
// This avoids changing the waterline whenever a tiny capillary ripple moves.
export const waterOpticsShader=`
  uniform vec4 surfaceRipples[8];
  float rippleHeight(vec2 p,float t){
    float h=0.0;
    for(int i=0;i<8;i++){
      vec4 ripple=surfaceRipples[i];float age=t-ripple.z;
      if(ripple.w<=0.0||age<0.0||age>3.0)continue;
      float r=length(p-ripple.xy),ring=r-age*.7;
      h+=sin(ring*32.0)*exp(-ring*ring*60.0)*exp(-age*1.8)*ripple.w;
    }
    return h;
  }
  float waterDetail(vec2 p,float t,float footprint){
    vec2 wind=vec2(p.x*.92+p.y*.39,-p.x*.39+p.y*.92);
    return sin(wind.x*13.0+t*1.7)*sin(wind.y*7.0-t*.8)*.0035*exp(-pow(footprint*15.0*.6,2.0))
      +sin(wind.x*23.0+wind.y*9.0+t*2.1)*.0012*exp(-pow(footprint*25.0*.6,2.0))
      +rippleHeight(p,t)*exp(-pow(footprint*32.0*.6,2.0));
  }
  vec3 waterOpticalNormal(vec2 p,float t){
    float e=.012;
    // Suppress frequencies smaller than a screen pixel, especially near
    // the horizon. Otherwise micro-waves turn into white dash patterns.
    float footprint=max(length(dFdx(p)),length(dFdy(p)));
    vec3 n=oceanFilteredNormal(p,t,footprint);
    vec2 slope=vec2(waterDetail(p-vec2(e,0),t,footprint)-waterDetail(p+vec2(e,0),t,footprint),
      waterDetail(p-vec2(0,e),t,footprint)-waterDetail(p+vec2(0,e),t,footprint))/(2.0*e);
    return normalize(n+vec3(slope.x,0.0,slope.y));
  }
  float waterFresnel(float cosine){return .02+.98*pow(1.0-clamp(cosine,0.0,1.0),5.0);}
  float waterSunGlint(vec3 n,vec3 view,vec3 sun){
    float nv=max(0.0,dot(n,view)),nl=max(0.0,dot(n,sun));
    if(nv<=0.0||nl<=0.0)return 0.0;
    vec3 halfVector=normalize(view+sun);
    float nh=max(0.0,dot(n,halfVector)),vh=max(0.0,dot(view,halfVector));
    vec3 dx=dFdx(n),dy=dFdy(n);
    float variance=.25*(dot(dx,dx)+dot(dy,dy));
    float a2=max(.0001,variance);
    float denominator=nh*nh*(a2-1.0)+1.0;
    float distribution=a2/(3.14159265*denominator*denominator);
    float gv=2.0*nv/(nv+sqrt(a2+(1.0-a2)*nv*nv));
    float gl=2.0*nl/(nl+sqrt(a2+(1.0-a2)*nl*nl));
    float specular=distribution*waterFresnel(vh)*gv*gl/max(.001,4.0*nv);
    return (.8*specular/(.8+specular))*.012;
  }
`;

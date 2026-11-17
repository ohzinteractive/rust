// Moving cellular ridges: broad halos around a bright core. Shared by the
// surface and seabed so the light feels projected through the same waves.
export const causticShader=`
  vec2 causticHash(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
  vec2 waterCaustics(vec2 p,float t,float width,float softness){
    p+=vec2(sin(p.y*.65+t*.31),cos(p.x*.57-t*.27))*.28;
    vec2 cell=floor(p),f=fract(p);float first=9.0,second=9.0;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec2 offset=vec2(float(x),float(y)),seed=causticHash(cell+offset);
      vec2 site=.5+.32*sin(t*vec2(.48,.39)+seed*6.28318);
      vec2 delta=offset+site-f;float d=dot(delta,delta);
      if(d<first){second=first;first=d;}else second=min(second,d);
    }
    float edge=max(0.0,sqrt(second)-sqrt(first));
    float aa=max(fwidth(edge),softness);
    float core=1.0-smoothstep(.025*width-aa,.075*width+aa,edge);
    float halo=1.0-smoothstep(.045*width,.22*width,edge);
    return vec2(core,halo);
  }
`;


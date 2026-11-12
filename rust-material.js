import * as THREE from 'three';

const noiseGLSL=`
  uniform float uAge,uScale,uSeed,uRelief;
  uniform float uPainted,uPatina,uPassivation,uMetalRoughness,uDepositRoughness,uCorrosionRelief;
  uniform vec3 uDark,uBurnt,uOrange,uGold,uTeal,uTealLight,uPink,uPinkLight,uMetal;
  varying vec3 vRest;
  varying float vLayer,vUnderside,vFlakeAge,vCoatEdge;
  float hash3(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
  vec3 noiseGradient(vec3 cell){
    float h=hash3(cell);
    return normalize(fract(h*vec3(1.0,57.0,113.0))*2.0-1.0+vec3(.001));
  }
  float noise3(vec3 p){
    // Rotated gradient noise avoids the square islands of axis-aligned value noise.
    p=mat3(.00,.80,.60,-.80,.36,-.48,-.60,-.48,.64)*p;
    vec3 i=floor(p),f=fract(p),w=f*f*f*(f*(f*6.0-15.0)+10.0);
    float a=dot(noiseGradient(i),f);
    float b=dot(noiseGradient(i+vec3(1,0,0)),f-vec3(1,0,0));
    float c=dot(noiseGradient(i+vec3(0,1,0)),f-vec3(0,1,0));
    float d=dot(noiseGradient(i+vec3(1,1,0)),f-vec3(1,1,0));
    float e=dot(noiseGradient(i+vec3(0,0,1)),f-vec3(0,0,1));
    float g=dot(noiseGradient(i+vec3(1,0,1)),f-vec3(1,0,1));
    float h=dot(noiseGradient(i+vec3(0,1,1)),f-vec3(0,1,1));
    float j=dot(noiseGradient(i+vec3(1,1,1)),f-vec3(1,1,1));
    return clamp(.5+.85*mix(mix(mix(a,b,w.x),mix(c,d,w.x),w.y),mix(mix(e,g,w.x),mix(h,j,w.x),w.y),w.z),0.0,1.0);
  }
  float filteredNoise(vec3 p){
    float footprint=max(length(dFdx(p)),length(dFdy(p)));
    return mix(noise3(p),.5,smoothstep(.35,1.0,footprint));
  }
  float fbm(vec3 p){float a=.53;float v=0.0;for(int i=0;i<4;i++){v+=a*noise3(p);p=p*2.03+vec3(3.2,5.7,1.6);a*=.49;}return v;}
  float strata(vec3 p){
    vec3 q=p*uScale+vec3(uSeed,0.0,uSeed*.33);
    // Low-frequency warp needs one smooth sample per axis, not three
    // additional four-octave fractals. Keep four octaves in the final field.
    vec3 warp=vec3(noise3(q*.8+3.1),noise3(q*.8+7.3),noise3(q*.8+11.6));
    return fbm(q+warp*2.25);
  }
  // Small fracture cells are shading detail, not extra physics bodies.
  float fineCracks(vec2 p){
    vec2 cell=floor(p),f=fract(p);
    float nearest=10.0,second=10.0;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec2 neighbor=vec2(float(x),float(y));
      vec2 id=cell+neighbor;
      vec2 jitter=vec2(hash3(vec3(id,uSeed)),hash3(vec3(id,uSeed+19.0)));
      vec2 delta=neighbor+jitter-f;
      float d=dot(delta,delta);
      if(d<nearest){second=nearest;nearest=d;}else{second=min(second,d);}
    }
    float edge=second-nearest;
    float aa=max(fwidth(edge),.015);
    return 1.0-smoothstep(.018,.018+aa,edge);
  }
  vec3 perturbSurface(vec3 surfPos,vec3 surfNorm,float h){
    vec3 q0=dFdx(surfPos);vec3 q1=dFdy(surfPos);
    vec3 r1=cross(q1,surfNorm);vec3 r2=cross(surfNorm,q0);
    float det=dot(q0,r1);
    vec3 grad=sign(det)*(dFdx(h)*r1+dFdy(h)*r2);
    return normalize(abs(det)*surfNorm-grad);
  }
`;

export function createRustMaterial(uniforms,isCoating=false,source=null){
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.64,metalness:.04,side:isCoating?THREE.DoubleSide:THREE.FrontSide,envMapIntensity:.45});
  if(source){
    material.color.copy(source.color || new THREE.Color(0xffffff));
    for(const key of ['map','alphaMap','transparent','opacity','alphaTest','side','depthWrite','vertexColors'])if(source[key]!==undefined)material[key]=source[key];
  }
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>\nattribute vec3 restPosition;attribute float layer;attribute float underside;attribute float flakeAge;attribute float coatEdge;varying vec3 vRest;varying float vLayer,vUnderside,vFlakeAge,vCoatEdge;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\nvRest=restPosition;vLayer=layer;vUnderside=underside;vFlakeAge=flakeAge;vCoatEdge=coatEdge;`);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>\n${noiseGLSL}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        // A released flake keeps the weathering it had at the moment it tore off.
        float age=vFlakeAge<0.0?uAge:vFlakeAge;
        float field=strata(vRest);
        float grain=filteredNoise(vRest*103.0+uSeed);
        float grit=filteredNoise(vRest*217.0+uSeed);
        float detail=filteredNoise(vRest*26.0+uSeed);
        // Broad stains, granular deposits and isolated pits; no periodic bands.
        float deposits=noise3(vRest*8.0+vec3(uSeed,17.0,3.0));
        float localStart=.10+smoothstep(.25,.75,field)*.66;
        float edgeWear=smoothstep(.7,1.0,vCoatEdge)*smoothstep(.10,.65,age);
        float bloom=smoothstep(localStart,localStart+.30,age*.88+edgeWear*.16);
        float pit=smoothstep(.67-fwidth(grain),.88+fwidth(grain),grain)*smoothstep(.42,.70,detail);
        float pinholes=pit*smoothstep(.16,.55,age);
        float corrosion=max(bloom,pinholes*.65);
        // Copper alloys tarnish before patina; aluminum forms a thin dull film.
        corrosion=mix(corrosion,smoothstep(.03,.65,age)*(.5+.35*deposits),uPassivation);
        float powder=smoothstep(.43,.72,deposits*.65+detail*.35);
        vec3 rustColor=mix(uBurnt,uOrange,powder*.78);
        rustColor=mix(rustColor,uGold,smoothstep(.67,.88,detail)*powder*.28);
        rustColor=mix(rustColor,uDark,smoothstep(.52,.78,field)*(1.0-powder)*.65);
        rustColor*=.82+grain*.24+grit*.08;
        rustColor=mix(rustColor,uDark,pit*.55);
        rustColor=mix(rustColor,mix(uBurnt,rustColor,smoothstep(.24,.80,age)),uPatina);
        float rustHeight=deposits*.065+detail*.035+grain*.025+grit*.009-pit*.045;
        rustHeight*=uCorrosionRelief;
        float paintWeathering=smoothstep(.08,.35,age);
        vec3 freshPaint=mix(uMetal,uPink,uPainted)*mix(1.0,.96+grain*.04,paintWeathering);
        freshPaint *= ${source ? "diffuseColor.rgb" : "vec3(1.0)"};
        float materialHeight=0.0;
        float surfaceRoughness=.44;
        float surfaceMetalness=.0;
        if(vLayer>0.5){
          // Keep islands of paint distinct from the rust beneath and at tears.
          float underReveal=uPainted*edgeWear*(1.0-corrosion)*(.12+.20*(1.0-step(1.5,vLayer)));
          vec3 paint=mix(freshPaint,mix(uTeal,uTealLight,detail*.2),underReveal);
          float edgeRust=mix(uCorrosionRelief,1.0,uPainted)*edgeWear*smoothstep(.30,.65,deposits)*.70;
          corrosion=max(corrosion,edgeRust);
          diffuseColor.rgb=mix(paint,rustColor,corrosion);
          materialHeight=mix(grain*.004*paintWeathering,rustHeight,corrosion);
          materialHeight+=edgeRust*(.025+detail*.025)*uCorrosionRelief;
          vec3 axis=abs(vRest);
          vec2 uv=axis.x>axis.y&&axis.x>axis.z?vRest.yz:(axis.y>axis.z?vRest.xz:vRest.xy);
          vec2 warped=uv*32.0+vec2(detail,noise3(vRest*12.0+uSeed))*1.8;
          float fracture=fineCracks(warped);
          float crackPatch=smoothstep(.40,.67,noise3(vRest*3.8+uSeed));
          float crazing=fracture*crackPatch*smoothstep(.12,.48,age)*mix(1.0-max(uPatina,uPassivation),1.0,uPainted);
          diffuseColor.rgb=mix(diffuseColor.rgb,mix(uDark,uBurnt,.4),crazing*.65);
          materialHeight-=crazing*.025;
          surfaceRoughness=mix(mix(uMetalRoughness,.44+.18*paintWeathering,uPainted),uDepositRoughness,corrosion);
          surfaceMetalness=(1.0-uPainted)*(1.0-corrosion)*.85;
          if(!gl_FrontFacing||vUnderside>.5){
            // Dark, dirty backing with granular oxide concentrated at torn rims.
            float backingRust=smoothstep(.12,.65,age)*(.25+.65*edgeWear);
            vec3 backing=mix(uMetal*.38,uDark,.6);
            diffuseColor.rgb=mix(backing,mix(uBurnt,uOrange,powder*.25),backingRust);
            diffuseColor.rgb*=.72+grain*.28;
            materialHeight=grain*.025+grit*.009-pit*.04+edgeWear*detail*.035;
            surfaceRoughness=.96;
          }
        }else{
          // Exposed iron retains dark metallic islands between accumulated rust.
          float coreRust=smoothstep(.20,.78,age*.65+deposits*.42-field*.23);
          coreRust=mix(coreRust,smoothstep(.03,.65,age)*(.5+.35*deposits),uPassivation);
          vec3 iron=uMetal*mix(.55+detail*.35,1.0,1.0-uPainted);
          vec3 substrate=mix(iron,rustColor,coreRust);
          float reveal=mix(1.0,smoothstep(.035,.19,age),uPainted);
          diffuseColor.rgb=mix(freshPaint,substrate,reveal);
          materialHeight=mix(0.0,mix(grain*.012-pit*.025,rustHeight,coreRust),reveal);
          surfaceRoughness=mix(.44,mix(uMetalRoughness,uDepositRoughness,coreRust),reveal);
          surfaceMetalness=reveal*(1.0-coreRust)*.72;
        }
      `)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\nroughnessFactor=surfaceRoughness;`)
      .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>\nmetalnessFactor=surfaceMetalness;`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\nnormal=perturbSurface(-vViewPosition,normal,materialHeight*uRelief*.075);`);
  };
  material.customProgramCacheKey=()=>`${isCoating?'oxide-peeling-v9':'oxide-substrate-v9'}${source?'-imported':''}`;
  return material;
}

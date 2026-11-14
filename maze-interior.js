import * as THREE from 'three';
import {Reflector} from './vendor/Reflector.js';
import {createMazePlan,getMazeLayout,mazeDimensions,mazePoint} from './maze-geometry.js';

// A directional, procedural sky: the glazing looks out into the same star field
// from every passage. It also writes depth, preserving wall/feather occlusion.
const galaxyShader=`
uniform float uSkyTime;
uniform float uOrbitAngle;
const float METEOR_SPEED=.30;
uniform mat4 uMazeInverse;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
}
float cloud(vec2 p){return noise(p)*.5+noise(p*2.03)*.25+noise(p*4.07)*.125+noise(p*8.11)*.0625;}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),
                 mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
                 mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float cloud3(vec3 p){return noise3(p)*.5+noise3(p*2.03)*.25+noise3(p*4.07)*.125+noise3(p*8.11)*.0625;}
vec3 stars(vec2 p,float layer){
  vec2 cell=floor(p),f=fract(p)-.5;
  float seed=hash(cell+layer*19.0),radius=layer<.5?.045:.025;
  float footprint=max(fwidth(p.x),fwidth(p.y));
  float star=(1.0-smoothstep(radius,radius+footprint*.65,length(f)))*radius/max(radius,footprint*.6);
  return star*step(.972,seed)*mix(vec3(.3,.47,.9),vec3(1.8,1.45,.95),hash(cell+53.0));
}
// Finite 3D flybys use the viewer's position, creating parallax through the
// glazing. Paths pass above the ceiling or below the floor, outside the walking volume.
vec3 nearbyMeteors(vec3 worldRay){
  vec3 origin=(uMazeInverse*vec4(cameraPosition,1.0)).xyz;
  vec3 ray=normalize(mat3(uMazeInverse)*worldRay),color=vec3(0);
  vec3 forward=normalize(vec3(.9,-.025,-.45)),side=normalize(vec3(.45,0,.9));
  for(int i=0;i<12;i++){
    float index=float(i),farField=step(8.0,index),period=6.0+index*.17;
    float clock=uSkyTime*METEOR_SPEED+index*.67,cycle=floor(clock/period),age=mod(clock,period)/4.0;
    float fade=smoothstep(0.0,.06,age)*(1.0-smoothstep(.85,1.0,age));
    if(fade<=0.0)continue;
    float seed=index*2.399+cycle*.83;
    float lateral=sin(seed)*mix(1.55,7.0,farField);
    float height=mix(.35+.08*sin(index)*sin(index),1.5+index*.12,farField);
    if(mod(index,4.0)>=2.0)height=-height;
    // Comparable physical speeds: distance alone makes far flybys look slower.
    vec3 head=forward*((age-.5)*7.0)+side*lateral+vec3(0,height,0);
    vec3 offset=head-origin;
    float depth=dot(offset,ray),width=mix(.0035,.009,farField);
    vec3 gap=ray*max(0.0,depth)-offset;
    float rock=exp(-dot(gap,gap)/(width*width*6.0))*step(0.0,depth);
    // Sunlit bodies in vacuum have no fireball or luminous wake.
    color+=fade*rock*vec3(.065,.055,.045);
  }
  return color;
}
vec3 galaxy(vec3 d){
  // A planet-facing orbital frame: distant celestial objects move past the
  // station while the planet remains beneath the walkable interior.
  vec3 viewRay=d,orbitAxis=normalize(vec3(.45,0,.9));
  float orbitCos=cos(uOrbitAngle),orbitSin=sin(uOrbitAngle);
  d=d*orbitCos+cross(orbitAxis,d)*orbitSin+orbitAxis*dot(orbitAxis,d)*(1.0-orbitCos);
  // Sample the direction in 3D: longitude wrapping and the poles have no seam.
  float mist=cloud3(d*4.0+7.0),band=exp(-pow((d.y+.36*d.x*d.z)*3.5,2.0));
  vec3 color=vec3(.003,.006,.022)+band*pow(mist,2.7)*vec3(.12,.12,.38);
  color+=band*pow(cloud3(d*9.0-3.0),4.0)*vec3(.34,.09,.28);
  vec3 weights=pow(abs(d),vec3(8.0));weights/=weights.x+weights.y+weights.z;
  for(int layer=0;layer<2;layer++){
    float scale=layer==0?95.0:180.0;
    color+=weights.x*stars(d.yz*scale,float(layer))
          +weights.y*stars(d.zx*scale,float(layer))
          +weights.z*stars(d.xy*scale,float(layer));
  }
  // Two distant spiral galaxies ensure a recognizable view on either side
  // of the maze. Perspective rays, rather than wall UVs, define their scale.
  for(int i=0;i<2;i++){
    vec3 axis=normalize(i==0?vec3(.65,.32,-1.0):vec3(-.75,.48,.8));
    vec3 right=normalize(cross(vec3(0,1,0),axis)),up=cross(axis,right);
    float facing=dot(d,axis);
    vec2 p=vec2(dot(d,right),dot(d,up))/max(.1,facing);
    p=mat2(.92,-.39,.39,.92)*p;p.y*=2.5;
    float r=length(p),angle=atan(p.y,p.x);
    float arms=pow(.5+.5*cos(angle*2.0-log(r+.025)*5.0+cloud(p*18.0)*1.4),5.0);
    float dust=cloud(p*35.0);
    float disc=exp(-r*5.0)*smoothstep(.018,.09,r)*(.10+arms)*dust*dust;
    color+=smoothstep(.25,.45,facing)*(disc*vec3(.5,.55,1.25)+exp(-r*24.0)*vec3(2.5,1.35,.56));
  }
  vec3 moonAxis=normalize(vec3(.35,.65,-.6));
  vec3 moonRight=normalize(cross(vec3(0,1,0),moonAxis)),moonUp=cross(moonAxis,moonRight);
  vec2 moonUV=vec2(dot(d,moonRight),dot(d,moonUp))/.065;
  float moonRadius=length(moonUV),edge=max(.001,fwidth(moonRadius));
  vec3 moonNormal=vec3(moonUV,sqrt(max(0.0,1.0-dot(moonUV,moonUV))));
  float facets=noise3(floor(moonNormal*14.0)*.73);
  float moonMask=(1.0-smoothstep(1.0-edge,1.0+edge,moonRadius))*step(.9,dot(d,moonAxis));
  color+=vec3(.035,.055,.1)*exp(-moonRadius*moonRadius*.8)*step(.9,dot(d,moonAxis));
  color=mix(color,vec3(.72,.82,1.05)*(.65+.35*facets)*(.65+.35*max(0.0,dot(moonNormal,normalize(vec3(-.4,.5,1))))),moonMask);
  d=viewRay;
  // A large banded planet, lit from the same fixed celestial direction.
  vec3 planetAxis=normalize(vec3(.9,-1.8,-.45));
  vec3 planetRight=normalize(cross(vec3(0,1,0),planetAxis)),planetUp=cross(planetAxis,planetRight);
  vec2 planetUV=vec2(dot(d,planetRight),dot(d,planetUp))/.82;
  float planetRadius=length(planetUV),planetEdge=max(.001,fwidth(planetRadius));
  vec3 planetNormal=vec3(planetUV,sqrt(max(0.0,1.0-dot(planetUV,planetUV))));
  vec3 surfaceNormal=vec3(planetNormal.x,planetNormal.y*orbitCos-planetNormal.z*orbitSin,planetNormal.y*orbitSin+planetNormal.z*orbitCos);
  float clouds=cloud3(surfaceNormal*7.0);
  float bands=.5+.5*sin(surfaceNormal.y*38.0+clouds*7.0);
  vec3 surface=mix(vec3(.10,.25,.39),vec3(.42,.32,.56),bands);
  surface=mix(surface,vec3(.5,.65,.73),smoothstep(.57,.77,clouds)*.7);
  float sunlight=max(0.0,dot(planetNormal,normalize(vec3(-.6,.35,.8))));
  float planetMask=(1.0-smoothstep(1.0-planetEdge,1.0+planetEdge,planetRadius))*step(0.0,dot(d,planetAxis));
  color=mix(color,surface*(.10+sunlight*1.7),planetMask);
  float atmosphere=exp(-abs(planetRadius-1.0)*65.0)*step(0.0,dot(d,planetAxis));
  color+=vec3(.10,.3,.65)*atmosphere*.35;
  // Parallel 3D trajectories target the viewer-facing hemisphere. Compare
  // depths against the near surface instead of masking the planet silhouette.
  vec3 planetCenter=planetAxis*18.0;
  float radius=18.0*.82,planetB=dot(d,planetCenter);
  float discriminant=planetB*planetB-(324.0-radius*radius);
  float surfaceDepth=discriminant>=0.0&&planetB>0.0?planetB-sqrt(max(0.0,discriminant)):1e6;
  vec3 incoming=normalize(planetAxis*.8-planetUp*.6);
  for(int i=0;i<8;i++){
    float index=float(i),period=7.0+index*.31,clock=uSkyTime*METEOR_SPEED+index*.91;
    float cycle=floor(clock/period),age=mod(clock,period)/3.25;
    float envelope=smoothstep(0.0,.04,age)*(1.0-smoothstep(.90,1.0,age));
    if(envelope<=0.0)continue;
    float spread=sin(index*1.7+cycle*.73)*.25;
    vec3 normal=normalize(-planetAxis*.95+planetUp*.30+planetRight*spread);
    vec3 entryPoint=planetCenter+normal*(radius+.15);
    vec3 relative=entryPoint-planetCenter;
    float hitB=dot(relative,incoming),hitC=dot(relative,relative)-radius*radius;
    float groundDistance=-hitB-sqrt(max(0.0,hitB*hitB-hitC));
    float entryAge=.65,elapsed=max(0.0,age-entryAge);
    float distance=age<entryAge?(age-entryAge)*8.0/entryAge:groundDistance*.85*(1.0-exp(-elapsed/.035));
    vec3 head=entryPoint+incoming*distance;
    float headDepth=dot(head,d);vec3 gap=d*max(0.0,headDepth)-head;
    float heat=smoothstep(entryAge-.012,entryAge+.012,age);
    float burnout=1.0-smoothstep(entryAge+.06,entryAge+.075,age);
    float visible=step(0.0,headDepth)*step(headDepth,surfaceDepth+.001);
    float spark=exp(-dot(gap,gap)/.00007);
    color+=envelope*visible*burnout*spark*(vec3(.065,.055,.045)+heat*vec3(3.0,2.3,1.4));
    // This emitted train is entirely above the visible surface. It remains
    // after burnout and drifts slowly rather than disappearing behind Earth.
    float wakeDistance=groundDistance*.85*(1.0-exp(-min(elapsed,.075)/.035));
    vec3 wind=planetRight*max(0.0,elapsed-.075)*.05;
    vec3 wakeHead=entryPoint+incoming*wakeDistance+wind;
    float length=max(.00001,wakeDistance);
    float rayDot=dot(d,incoming),rayOffset=dot(d,-wakeHead),pathOffset=dot(incoming,-wakeHead);
    float along=clamp((rayDot*rayOffset-pathOffset)/max(.00001,1.0-rayDot*rayDot),0.0,length);
    vec3 wakePoint=wakeHead-incoming*along;
    float wakeDepth=dot(wakePoint,d);vec3 wakeGap=d*max(0.0,wakeDepth)-wakePoint;
    float tail=exp(-dot(wakeGap,wakeGap)/.00005)*pow(clamp(1.0-along/length,0.0,1.0),.6);
    float persistence=exp(-max(0.0,elapsed-.075)*16.0);
    color+=envelope*heat*persistence*tail*step(0.0,wakeDepth)*step(wakeDepth,surfaceDepth+.001)*vec3(.4,.65,.95);
    vec3 burnPoint=entryPoint+incoming*(groundDistance*.85*(1.0-exp(-.06/.035)));
    float burnDepth=dot(burnPoint,d);vec3 burnGap=d*max(0.0,burnDepth)-burnPoint;
    float flash=exp(-dot(burnGap,burnGap)/.0003)*exp(-pow((elapsed-.06)/.012,2.0));
    color+=envelope*flash*step(burnDepth,surfaceDepth+.001)*vec3(1.8,.85,.3);
    if(mod(index,3.0)<.5&&elapsed>.06&&elapsed<.16){
      for(int fragment=0;fragment<3;fragment++){
        float f=float(fragment)-1.0;
        vec3 debris=burnPoint+normal*(elapsed-.06)*.12+planetRight*f*(elapsed-.06)*.08;
        float depth=dot(debris,d);vec3 delta=d*max(0.0,depth)-debris;
        color+=exp(-dot(delta,delta)/.000025)*exp(-(elapsed-.06)*45.0)*step(depth,surfaceDepth+.001)*vec3(.7,.3,.08);
      }
    }
  }
  return color+nearbyMeteors(d);
}`;

function glazing(roof=false,time={value:0},inverse={value:new THREE.Matrix4()},orbit={value:0}){
  return new THREE.ShaderMaterial({name:roof?'Galaxy skylight':'Galaxy glass',
    uniforms:{roof:{value:roof?1:0},uSkyTime:time,uMazeInverse:inverse,uOrbitAngle:orbit},
    vertexShader:`varying vec3 vWorld;varying vec3 vNormal;varying vec3 vLocal;
      void main(){vLocal=position;vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;
        vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`uniform float roof;varying vec3 vWorld;varying vec3 vNormal;varying vec3 vLocal;
      ${galaxyShader}
      void main(){
        vec3 ray=normalize(vWorld-cameraPosition);
        float fresnel=pow(clamp(1.0-abs(dot(-ray,normalize(vNormal))),0.0,1.0),4.0);
        vec3 color=galaxy(ray)*1.4+vec3(.035,.055,.085)*fresnel;
        // Ivory plinth and cornice frame each glass partition.
        if(roof<.5){
          float solid=step(vLocal.y,-.151)+step(.174,vLocal.y);
          color=mix(color,vec3(.43,.37,.27),min(1.0,solid));
          float trim=1.0-smoothstep(.0006,.0015,min(abs(vLocal.y+.15),abs(vLocal.y-.173)));
          color=mix(color,vec3(.72,.43,.15),trim);
        }
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}

export function createMazeInterior({group,floor,roof,canStand}){
  group.updateWorldMatrix(true,false);
  const inverse={value:group.matrixWorld.clone().invert()};
  const skyTime={value:0},orbit={value:0},wallMaterial=glazing(false,skyTime,inverse,orbit);
  roof.material=glazing(true,skyTime,inverse,orbit);
  const skyMaterial=glazing(true,skyTime,inverse,orbit);skyMaterial.side=THREE.BackSide;skyMaterial.depthWrite=false;
  const sky=new THREE.Mesh(new THREE.SphereGeometry(20,24,16),skyMaterial);
  sky.name='Continuous celestial backdrop';sky.renderOrder=1000;sky.frustumCulled=false;group.add(sky);
  const architecture=new THREE.Group();architecture.name='Art Deco architecture';group.add(architecture);
  const ivory=new THREE.MeshStandardMaterial({color:0xe4ddc9,roughness:.32,metalness:.12,emissive:0x8c795b,emissiveIntensity:.22});
  const gold=new THREE.MeshStandardMaterial({color:0xd5a346,roughness:.19,metalness:.88,envMapIntensity:1.5,emissive:0x9f6b2d,emissiveIntensity:.18});
  const glow=new THREE.MeshBasicMaterial({color:new THREE.Color(2.0,1.25,.55)});
  // A baked warm wash fades upward from every arch base without adding
  // hundreds of point lights. Physical directional lighting supplies the edges.
  for(const material of [ivory,gold]){
    material.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vDecoPosition;\n'+shader.vertexShader.replace('#include <project_vertex>',`
        vec4 decoPosition=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          decoPosition=instanceMatrix*decoPosition;
        #endif
        vDecoPosition=decoPosition.xyz;
        #include <project_vertex>`);
      shader.fragmentShader='varying vec3 vDecoPosition;\n'+shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
        float uplight=exp(-max(0.0,vDecoPosition.y+.145)*16.0);
        totalEmissiveRadiance+=vec3(.20,.085,.022)*uplight;`);
    };
    material.customProgramCacheKey=()=> 'deco-base-uplighting-v1';
  }
  const transforms=[[],[],[]],ornaments=[[],[],[]],unit=mazeDimensions.unit;
  const basis=new THREE.Matrix4(),ornamentRotation=new THREE.Quaternion();
  function ornament(center,tangent,normal,width,height,depth,type,angle=0){
    const vertical=new THREE.Vector3(0,1,0),horizontal=tangent.clone();
    if(new THREE.Vector3().crossVectors(horizontal,vertical).dot(normal)<0)horizontal.negate();
    basis.makeBasis(horizontal,vertical,normal);
    ornamentRotation.setFromRotationMatrix(basis).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle));
    ornaments[type].push(new THREE.Matrix4().compose(center,ornamentRotation,new THREE.Vector3(width,height,depth)));
  }
  function fan(center,tangent,normal,height=.022){
    for(let i=-2;i<=2;i++)ornament(center,tangent,normal,height*.38,height*(1-Math.abs(i)*.10),.003,0,-i*.27);
  }
  const up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3(),mid=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
  function beam(a,b,width,type=0){
    direction.subVectors(b,a);const length=direction.length();if(length<1e-8)return;
    quaternion.setFromUnitVectors(up,direction.multiplyScalar(1/length));mid.addVectors(a,b).multiplyScalar(.5);scale.set(width,length,width);
    transforms[type].push(new THREE.Matrix4().compose(mid,quaternion,scale));
  }
  function path(points,width,type,closed=false){
    for(let i=1;i<points.length;i++)beam(points[i-1],points[i],width,type);
    if(closed)beam(points.at(-1),points[0],width,type);
  }
  for(const patch of getMazeLayout().patches){
    if(Math.abs(patch.n.y)>.5)continue;
    const a=patch.corners[0],b=patch.corners[1],length=a.distanceTo(b),segments=Math.max(1,Math.round(length/(unit*1.8)));
    const tangent=b.clone().sub(a).normalize(),width=length/segments;
    function at(x,y,depth=.002){return a.clone().addScaledVector(tangent,x).addScaledVector(patch.n,depth).setY(y);}
    for(let i=0;i<segments;i++){
      const left=i*width+.004,right=(i+1)*width-.004,cut=Math.min(.017,width*.2);
      const outline=[[left,-.15],[left,.132],[left+cut,.171],[right-cut,.171],[right,.132],[right,-.15]];
      path(outline.map(([x,y])=>at(x,y)),.0055,0);
      path(outline.map(([x,y])=>at(x,y,.0078)),.0011,2);
      beam(at(left,-.142),at(right,-.142),.0012,1);
      beam(at(left,-.158),at(right,-.158),.002,1);
      // Slim illuminated flutes, stepped capitals, and small diamond inlays.
      for(const x of [left,right]){
        beam(at(x,-.13,.0058),at(x,.115,.0058),.0017,1);
        beam(at(x,-.127,.007),at(x,.112,.007),.00065,2);
        for(let tier=0;tier<3;tier++){
          const y=.121+tier*.004;
          beam(at(x,y),at(x,y+.003),.007+tier*.0015,0);
          beam(at(x,y,.006),at(x,y+.0008,.006),.007+tier*.0015,1);
        }
        for(const y of [-.03,.095])path([[x,y+.004],[x+.002,y],[x,y-.004],[x-.002,y]].map(([dx,dy])=>at(dx,dy,.0075)),.0006,1,true);
      }
      const cx=(left+right)/2;
      beam(at(cx,.164,.0048),at(cx,.175,.0048),.0045,1);
      fan(at(cx,.17,.0048),tangent,patch.n,.018);
      for(const y of [-.145,-.075]){
        beam(at(left,y,.005),at(right,y,.005),.0025,1);
        beam(at(left,y),at(left,y+.007),.009,0);
      }
      for(const t of [-1,-.5,0,.5,1])beam(at(cx,-.14,.005),at(cx+t*(right-left)*.46,-.079,.005),.0009,1);
      // Center the crystal and its setting on the same column-mounted socket.
      beam(at(left,.008,.004),at(left,.078,.004),.004,1);
      ornament(at(left,.043,.0068),tangent,patch.n,.007,.033,.0045,1);
      ornament(at(left,.043,.0068),tangent,patch.n,.0045,.028,.0025,2);
    }
  }
  const {walls,size,entry,goal}=createMazePlan();
  for(let z=1;z<size-1;z++)for(let x=1;x<size-1;x++){
    if(walls[z][x]!==0||(x+z)%3!==0)continue;
    const alongZ=walls[z][x-1]&&walls[z][x+1],alongX=walls[z-1][x]&&walls[z+1][x];
    if(!alongZ&&!alongX)continue;
    function point(t,y){return mazePoint(x+.5+(alongZ?t:0),z+.5+(alongZ?0:t),y);}
    const portal=[[-.46,-.15],[-.46,.126],[-.30,.177],[.30,.177],[.46,.126],[.46,-.15]];
    path(portal.map(([t,y])=>point(t,y)),.006,0);
    path(portal.map(([t,y])=>point(t*.88,y-.006)),.0012,1);
    const tangent=point(.5,0).sub(point(0,0)).normalize(),normal=new THREE.Vector3().crossVectors(tangent,new THREE.Vector3(0,1,0));
    fan(point(0,.174).addScaledVector(normal,.0038),tangent,normal,.014);
    fan(point(0,.174).addScaledVector(normal,-.0038),tangent,normal,.014);
    path(portal.map(([t,y])=>point(t*.82,y-.009)),.0015,2);
  }
  // Sunburst ceiling sculpture over the courtyard, with nested diamond rings.
  const center=mazePoint(goal.x+.5,goal.z+.5,.167);
  for(const radius of [.095,.13,.165])path([[0,-1],[1,0],[0,1],[-1,0]].map(([x,z])=>center.clone().add(new THREE.Vector3(x*radius,0,z*radius))),.002,1,true);
  for(let i=0;i<32;i++){
    const angle=i*Math.PI/16,d=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
    beam(center.clone().addScaledVector(d,.042),center.clone().addScaledVector(d,i%2?.085:.115),.0018,2);
  }
  // A small number of warm, shadow-free lights adds depth to the flat faces.
  const keyLight=new THREE.DirectionalLight(0xffe3af,1.45);
  keyLight.name='Warm architectural light';keyLight.position.set(-1,2,1);
  const lightTarget=new THREE.Object3D();group.add(lightTarget);keyLight.target=lightTarget;group.add(keyLight);
  const beacon=new THREE.PointLight(0xffcc7a,.018,.65,2);
  beacon.name='Courtyard beacon';beacon.position.copy(mazePoint(goal.x+.5,goal.z+.5,.1));group.add(beacon);
  for(const radius of [.045,.068])path([[0,-1],[1,0],[0,1],[-1,0]].map(([x,z])=>mazePoint(goal.x+.5,goal.z+.5,-.1888).add(new THREE.Vector3(x*radius,0,z*radius))),radius<.05?.0012:.0018,radius<.05?2:1,true);
  ornament(mazePoint(goal.x+.5,goal.z+.5,.105),new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,1),.009,.032,.009,1);
  ornament(mazePoint(goal.x+.5,goal.z+.5,.105),new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,1),.006,.027,.006,2);
  // Sparse chevrons follow the actual entrance route, including its turns.
  const queue=[[goal.x,goal.z]],toward=new Map([[goal.x+','+goal.z,null]]);
  for(let i=0;i<queue.length;i++){
    const [x,z]=queue[i];
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,nz=z+dz,key=nx+','+nz;
      if(walls[nz]?.[nx]!==0||toward.has(key))continue;
      toward.set(key,[x,z]);queue.push([nx,nz]);
    }
  }
  let routeIndex=0;
  for(let cell=[entry.x,entry.z];cell&&toward.get(cell.join(','));cell=toward.get(cell.join(','))){
    const next=toward.get(cell.join(','));
    if(routeIndex++%4!==0)continue;
    const p=mazePoint(cell[0]+.5,cell[1]+.5,-.1889),nextPoint=mazePoint(next[0]+.5,next[1]+.5,-.1889);
    const forward=nextPoint.sub(p).normalize(),side=new THREE.Vector3(-forward.z,0,forward.x);
    const tip=p.clone().addScaledVector(forward,.009);
    for(const sign of [-1,1])beam(p.clone().addScaledVector(forward,-.006).addScaledVector(side,sign*.006),tip,.0008,2);
  }
  // Tile seams stop at the annex edges instead of floating across exterior voids.
  for(let z=0;z<size;z++)for(let x=0;x<size;x++)if(walls[z][x]!==2){
    beam(mazePoint(x,z,-.1896),mazePoint(x+1,z,-.1896),.00035,1);
    beam(mazePoint(x,z,-.1896),mazePoint(x,z+1,-.1896),.00035,1);
  }

  const beamGeometry=new THREE.BoxGeometry(1,1,1);
  for(const [i,material] of [ivory,gold,glow].entries()){
    const mesh=new THREE.InstancedMesh(beamGeometry,material,transforms[i].length);
    mesh.name=['Ivory stepped frames','Champagne inlay','Geometric lights'][i];
    transforms[i].forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));mesh.computeBoundingSphere();architecture.add(mesh);
  }

  const decorations=new THREE.Group();decorations.name='Fan crowns and crystal lights';group.add(decorations);
  const blade=new THREE.Shape();blade.moveTo(0,0);blade.lineTo(-.4,1);blade.lineTo(.4,1);blade.closePath();
  const bladeGeometry=new THREE.ExtrudeGeometry(blade,{depth:1,bevelEnabled:false});bladeGeometry.translate(0,0,-.5);
  const crystalGeometry=new THREE.OctahedronGeometry(1),goldCage=gold.clone();
  goldCage.wireframe=true;goldCage.onBeforeCompile=gold.onBeforeCompile;goldCage.customProgramCacheKey=gold.customProgramCacheKey;
  for(const [i,geometry] of [bladeGeometry,crystalGeometry,crystalGeometry].entries()){
    const mesh=new THREE.InstancedMesh(geometry,[gold,goldCage,glow][i],ornaments[i].length);
    mesh.name=['Sculpted fan crowns','Crystal gold settings','Faceted crystal sconces'][i];
    ornaments[i].forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));mesh.computeBoundingSphere();decorations.add(mesh);
  }

  const mirror=new Reflector(floor.geometry,{textureWidth:768,textureHeight:768,color:0x888d99,multisample:0,clipBias:.00001});
  mirror.name='Mirror floor';
  // Reuse the walking mesh for sampling and picking, and render its material
  // through the reflection helper so its floor/ceiling API remains unchanged.
  floor.material=mirror.material;
  let reflectionGroup=null;
  floor.onBeforeRender=function(renderer,scene,camera){
    if(scene.overrideMaterial)return;
    mirror.matrixWorld.copy(floor.matrixWorld);
    const visible=floor.visible,viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
    const featherVisible=reflectionGroup?.visible;
    const scissorTest=renderer.getScissorTest();renderer.getViewport(viewport);renderer.getScissor(scissor);
    const resolution=camera.aspect<.75?384:768,target=mirror.getRenderTarget();
    if(target.width!==resolution)target.setSize(resolution,resolution);
    floor.visible=false;
    // Weighted transparency temporarily hides feathers for its opaque pass.
    // Include them in the mirror's ordinary alpha-blended scene render.
    if(reflectionGroup?.parent)reflectionGroup.visible=true;
    try{renderer.setScissorTest(false);mirror.onBeforeRender(renderer,scene,camera);}
    finally{
      floor.visible=visible;if(reflectionGroup)reflectionGroup.visible=featherVisible;
      renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    }
  };
  return {wallMaterial,architecture,mirror,
    advance(dt,camera){if(!(dt>0))return false;const step=Math.min(dt,.05);skyTime.value+=step;orbit.value=(orbit.value+step*Math.PI*2/5400)%(Math.PI*2);group.updateWorldMatrix(true,false);inverse.value.copy(group.matrixWorld).invert();return true;},
    setReflectionGroup(value){reflectionGroup=value;},
    dispose(){mirror.getRenderTarget().dispose();wallMaterial.dispose();}
  };
}

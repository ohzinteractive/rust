import * as THREE from 'three';
import {generateFeatherData,rewriteFeatherGrammar} from './plume-lsystem/feather-generator.js';
import {seededRandom} from './plume-lsystem/random.js';
import {causticShader} from './kelp-caustics.js';
import {sunShadowShader} from './kelp-godrays.js';
import {createKelpSunlight,kelpSunlightShader} from './kelp-lighting.js';
import {createKelpFloatGeometry,kelpBladeEnvelope,kelpLeafTissueShader} from './kelp-morphology.js';
import {createKelpLeafPhysics} from './kelp-leaf-physics.js';
import {createKelpHoldfasts} from './kelp-holdfasts.js';

export const defaultKelpSettings=Object.freeze({strands:48,height:11,generations:4,current:1,direction:60,scattering:1,seed:7319});
// S extends a stipe; B adds one float and its blade. Eight nodes per
// generation rotate around the growing stem in 22.5° steps: 16 pairs per turn.
export const kelpGrammar=Object.freeze({axiom:'X',X:'SBSBSBSBSBSBSBSBX'});

export function createKelp({scene,floorY=-1.75,sun=null,sunlight:waterSunlight=createKelpSunlight()}){
  const group=new THREE.Group();group.name='L-system kelp forest';group.position.y=floorY;group.visible=false;scene.add(group);
  const settings={...defaultKelpSettings},time={value:0},current={value:settings.current},direction={value:new THREE.Vector2()},height={value:settings.height};
  let playing=true,stats={strands:0,blades:0,floats:0,triangles:0},materials=[],revision=0,consumed=0,support=null;
  const bladeRecords=[],stems=[],healthTexture={value:null},bladeCount={value:1};
  const obstacles={version:0,capsules:[]};
  let leafPhysics=null,leafDamageRevision=0,leafAccumulator=0;
  const leafMotion={value:null},leafRows={value:9},leafOffset=new THREE.Vector3();
  const corridorStart={value:new THREE.Vector3()},corridorEnd={value:new THREE.Vector3()},corridorRadius={value:1.4},corridorStrength={value:0};
  const corridorTargetStart=new THREE.Vector3(),corridorTargetEnd=new THREE.Vector3();
  let corridorRevision=0;
  let obstacleKey='',damageRevision=0;
  const obstacleA=new THREE.Vector3(),obstacleB=new THREE.Vector3();
  const sunlight={
    sunShadow:{value:null},sunShadowMatrix:{value:sun?.shadow.matrix??new THREE.Matrix4()},sunTexel:{value:new THREE.Vector2(1,1)},
    shadowEnabled:{value:0},shadowBias:{value:0},shadowStrength:{value:1},shadowRadius:{value:1},
    sunRadiance:{value:new THREE.Color(0)},sunDirection:waterSunlight.waterSunDirection,
  };
  const sunPosition=new THREE.Vector3(),sunTarget=new THREE.Vector3();
  function updateSunlight(){
    if(!sun)return;
    sun.getWorldPosition(sunPosition);sun.target.getWorldPosition(sunTarget);
    sunlight.sunDirection.value.subVectors(sunPosition,sunTarget).normalize();
    sunlight.sunRadiance.value.copy(sun.color).multiplyScalar(sun.intensity);
    sunlight.sunShadow.value=sun.shadow.map?.texture??null;
    sunlight.shadowEnabled.value=sun.castShadow&&sun.shadow.map?1:0;
    sunlight.sunTexel.value.set(1/(sun.shadow.map?.width??1),1/(sun.shadow.map?.height??1));
    sunlight.shadowBias.value=sun.shadow.bias;sunlight.shadowStrength.value=sun.shadow.intensity;sunlight.shadowRadius.value=sun.shadow.radius;
  }
  const deformation=`
    attribute vec2 kelpInfo;attribute float kelpRoot;
    uniform float kelpTime,kelpCurrent,kelpHeight;
    uniform vec2 kelpDirection;
    uniform vec3 kelpCorridorStart,kelpCorridorEnd;uniform float kelpCorridorRadius,kelpCorridorStrength;
    vec3 kelpCorridor(vec3 p){
      if(kelpInfo.y<=0.0||kelpCorridorStrength<.00001)return p;
      vec3 ray=kelpCorridorEnd-kelpCorridorStart;
      float along=clamp(dot(p-kelpCorridorStart,ray)/max(.001,dot(ray,ray)),0.0,1.0);
      vec3 closest=kelpCorridorStart+ray*along;
      vec2 side=vec2(-ray.z,ray.x);side/=max(length(side),.0001);
      float lateral=dot(p.xz-closest.xz,side),vertical=(p.y-closest.y)*1.3;
      float distanceToView=length(vec2(lateral,vertical));
      float influence=(1.0-smoothstep(kelpCorridorRadius*.5,kelpCorridorRadius,distanceToView))*(1.0-smoothstep(.78,.96,along));
      float amount=.30*kelpCorridorStrength*clamp(kelpInfo.y*.7,0.0,1.0)*influence;
      p.xz+=side*(smoothstep(-.45,.45,lateral+sin(kelpInfo.x)*.08)*2.0-1.0)*amount;
      return p;
    }
    vec3 kelpMove(vec3 p){
      float h=max(0.0,p.y-kelpRoot)/max(.1,kelpHeight-kelpRoot),phase=kelpInfo.x;
      float bladeWave=kelpTime*.95+phase-dot(p,vec3(.65,.3,.5));
      float swell=sin(kelpTime*.65-h*2.4+phase)*.62+sin(kelpTime*.33+h*3.1+phase*.7)*.24;
      float sway=kelpCurrent*pow(h,1.35)*swell;
      p.xz+=kelpDirection*sway+vec2(-kelpDirection.y,kelpDirection.x)*sway*.24;
      // Flex grows from zero at the float to the blade's length at its tip.
      // Steady drag follows the current; travelling waves ripple across it.
      p.xz+=(kelpDirection*(.32+.12*sin(bladeWave))+
        vec2(-kelpDirection.y,kelpDirection.x)*.085*sin(bladeWave*.8+1.7))*kelpInfo.y*kelpCurrent;
      p.y+=sin(bladeWave+.8)*kelpInfo.y*kelpCurrent*.065;
      p=kelpCorridor(p);p.y=min(p.y,kelpHeight+.20);
      return p;
    }
  `;
  function configure(material,depth=false,blade=false){
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{kelpTime:time,kelpCurrent:current,kelpHeight:height,kelpDirection:direction,kelpCorridorStart:corridorStart,kelpCorridorEnd:corridorEnd,kelpCorridorRadius:corridorRadius,kelpCorridorStrength:corridorStrength});
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+deformation);
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','vec3 transformed=kelpMove(position);');
      if(blade){
        Object.assign(shader.uniforms,{kelpHealth:healthTexture,kelpBladeCount:bladeCount,kelpLeafMotion:leafMotion,kelpLeafRows:leafRows});
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
          attribute vec3 kelpBlade;uniform sampler2D kelpHealth;uniform float kelpBladeCount;varying vec3 vKelpBite;
          uniform sampler2D kelpLeafMotion;uniform float kelpLeafRows;
          vec3 kelpContactOffset(){
            float row=clamp(kelpBlade.y,0.0,1.0)*(kelpLeafRows-1.0),lo=min(kelpLeafRows-2.0,floor(row));
            float y=(kelpBlade.x+.5)/kelpBladeCount;
            vec3 a=texture2D(kelpLeafMotion,vec2((max(0.0,lo-1.0)+.5)/kelpLeafRows,y)).xyz;
            vec3 b=texture2D(kelpLeafMotion,vec2((lo+.5)/kelpLeafRows,y)).xyz;
            vec3 c=texture2D(kelpLeafMotion,vec2((lo+1.5)/kelpLeafRows,y)).xyz;
            vec3 d=texture2D(kelpLeafMotion,vec2((min(kelpLeafRows-1.0,lo+2.0)+.5)/kelpLeafRows,y)).xyz;
            float u=row-lo;
            return .5*(2.0*b+(-a+c)*u+(2.0*a-5.0*b+4.0*c-d)*u*u+(-a+3.0*b-3.0*c+d)*u*u*u);
          }`);
        shader.vertexShader=shader.vertexShader.replace('vec3 transformed=kelpMove(position);',`vec3 transformed=kelpMove(position)+kelpContactOffset();
          transformed.y=min(transformed.y,kelpHeight+.20);
          vKelpBite=vec3(kelpBlade.yz,texture2D(kelpHealth,vec2((kelpBlade.x+.5)/kelpBladeCount,.5)).r);`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vKelpBite;')
          .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
          float biteEdge=vKelpBite.z-.028*(.5+.5*sin(vKelpBite.y*21.0+vKelpBite.z*33.0));
          if(vKelpBite.z<.001||(vKelpBite.z<.999&&vKelpBite.x>biteEdge))discard;
          // Small triangular teeth cut the real visible and shadow silhouettes.
          float toothPhase=fract(vKelpBite.x*72.0+(vKelpBite.y>0.0?.37:0.0));
          float tooth=pow(1.0-abs(toothPhase*2.0-1.0),4.0);
          float toothResolution=1.0-smoothstep(.35,1.0,fwidth(vKelpBite.x*72.0));
          float toothedMargin=toothResolution*smoothstep(.025,.09,vKelpBite.x)*(1.0-smoothstep(.92,1.0,vKelpBite.x));
          if(abs(vKelpBite.y)>1.0-(1.0-tooth)*.045*toothedMargin)discard;`);
      }
      if(!depth){
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
          varying vec3 vKelpWorld;varying float vKelpWaterDepth;`)
          .replace('#include <project_vertex>',`#include <project_vertex>
          vKelpWorld=(modelMatrix*vec4(transformed,1.0)).xyz;vKelpWaterDepth=max(0.0,kelpHeight-transformed.y);`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
          varying vec3 vKelpWorld;varying float vKelpWaterDepth;uniform float kelpTime;
          ${kelpSunlightShader}
          ${causticShader}`);
        Object.assign(shader.uniforms,waterSunlight);
        shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
          vec3 dy=(kelpMove(position+vec3(0.0,.01,0.0))-kelpMove(position))/.01;
          objectNormal=normalize(vec3(objectNormal.x,objectNormal.y-dot(objectNormal.xz,dy.xz),objectNormal.z));`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          diffuseColor.rgb*=gl_FrontFacing?1.0:1.14;`);
        if(blade){
          updateSunlight();Object.assign(shader.uniforms,sunlight);
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+kelpLeafTissueShader);
          shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
            ${sunShadowShader.replace('sunTexel*shadowRadius*.5','sunTexel*min(shadowRadius,2.0)*.5')}
            uniform vec3 sunRadiance,sunDirection;`)
            .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
            // Step sunward past the zero-thickness leaf itself. Other leaves
            // still occlude this lookup, preserving canopy/contact shadows.
            vec3 leafWorldNormal=inverseTransformDirection(normal,viewMatrix);
            float leafBacklight=smoothstep(-.1,.8,dot(-leafWorldNormal,sunDirection));
            float leafVisibility=sunVisibility(vKelpWorld+sunDirection*.065);
            vec3 leafTransmission=waterSunTransmission(vKelpWorld)*kelpLeafTransmittance(vKelpBite.xy);
            reflectedLight.directDiffuse+=sunRadiance*leafTransmission*
              (leafBacklight*leafVisibility*.34*kelpSubsurface);
            float midgroundGain=kelpMidgroundGain(length(vViewPosition),dot(normal,normalize(vViewPosition)));
            reflectedLight.directDiffuse*=midgroundGain;
            reflectedLight.indirectDiffuse*=.72*midgroundGain;
          `);
          // Blade coordinates keep the wrinkles attached as the kelp sways.
          // Filter the ridges by pixel footprint to avoid distant shimmer.
          shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            vec2 bladeUV=vKelpBite.xy;
            diffuseColor.rgb*=1.0-.24*kelpMidrib(bladeUV)-.055*kelpSideVeins(bladeUV);
            float wrinklePhase=bladeUV.x*14.0+1.3*sin(bladeUV.x*7.0)+bladeUV.y*1.8;
            float crossPhase=bladeUV.y*7.0+.6*sin(bladeUV.x*12.0);
            float wrinkleFilter=1.0-smoothstep(.8,3.0,fwidth(wrinklePhase));
            float crossFilter=1.0-smoothstep(.8,3.0,fwidth(crossPhase));
            float ridges=sin(wrinklePhase)*wrinkleFilter;
            float crumples=sin(crossPhase)*crossFilter;
            float wrinkleFade=smoothstep(0.0,.09,bladeUV.x);
            float bladeRelief=(ridges*.00045+crumples*.00015)*wrinkleFade;
            diffuseColor.rgb*=1.0+(ridges*.016+crumples*.008)*wrinkleFade;
          `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
            vec3 bladeDx=dFdx(-vViewPosition),bladeDy=dFdy(-vViewPosition);
            // Derivative normals follow the contact bends as well as the wave.
            vec3 contactNormal=normalize(cross(bladeDx,bladeDy));
            normal=normalize(mix(normal,contactNormal,.18));
            vec3 bladeRx=cross(bladeDy,normal),bladeRy=cross(normal,bladeDx);
            float bladeDet=dot(bladeDx,bladeRx);
            normal=normalize(abs(bladeDet)*normal-sign(bladeDet)*
              (dFdx(bladeRelief)*bladeRx+dFdy(bladeRelief)*bladeRy));
          `);
        }
        // The feather skin's wrapped diffuse and attenuated back-scattering,
        // tuned for golden-green tissue. Keep it in the direct-light response
        // so the existing light colors and shadow maps also affect scattering.
        {
          shader.uniforms.kelpSubsurface=material.userData.kelpSubsurface??{value:0};
          shader.fragmentShader=`uniform float kelpSubsurface;\n${shader.fragmentShader}`
            .replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
            void RE_Direct_Kelp(const in IncidentLight light, const in vec3 position,
              const in vec3 normal, const in vec3 viewDir, const in vec3 coatNormal,
              const in PhysicalMaterial tissue, inout ReflectedLight reflected) {
              vec3 previousDiffuse=reflected.directDiffuse;
              IncidentLight waterLight=light;
              vec3 worldLight=inverseTransformDirection(light.direction,viewMatrix);
              float isSun=smoothstep(.98,.999,dot(worldLight,waterSunDirection));
              float softness=mix(.004,.025,clamp(vKelpWaterDepth/11.0,0.0,1.0));
              vec2 caustics=waterCaustics((vKelpWorld.xz-vKelpWorld.y*waterSunSlope())*.65,kelpTime,1.0,softness);
              float pattern=.78+(caustics.x*.45+caustics.y*.1)*exp(-vKelpWaterDepth*.07);
              vec3 sunFilter=waterSunTransmission(vKelpWorld)*pattern;
              waterLight.color*=mix(vec3(1.0),sunFilter,isSun);
              RE_Direct_Physical(waterLight,position,normal,viewDir,coatNormal,tissue,reflected);
              if(kelpSubsurface<=0.0)return;
              float nDotL=dot(normal,light.direction);
              vec3 widths=vec3(.35,.6,.2);
              vec3 wrapped=max(vec3(nDotL)+widths,vec3(0.0))/((1.0+widths)*(1.0+widths));
              float thickness=${blade?'kelpTissueThickness(vKelpBite.xy)':'.65'};
              vec3 attenuation=${blade?'kelpLeafTransmittance(vKelpBite.xy)':'exp(-vec3(1.5,.7,3.5)*thickness)'};
              vec3 throughDirection=normalize(light.direction+normal*.35);
              float viewLobe=pow(clamp(dot(viewDir,-throughDirection),0.0,1.0),3.0);
              float backlight=max(-nDotL,0.0)*(.18+.32*viewLobe);
              vec3 scattered=waterLight.color*tissue.diffuseColor*RECIPROCAL_PI*
                (wrapped*vec3(.85,1.0,.7)+attenuation*backlight);
              vec3 standardDiffuse=reflected.directDiffuse-previousDiffuse;
              reflected.directDiffuse=previousDiffuse+mix(standardDiffuse,scattered,clamp(kelpSubsurface,0.0,1.0));
            }
            #undef RE_Direct
            #define RE_Direct RE_Direct_Kelp
          `);
        }
      }
    };
    material.customProgramCacheKey=()=>depth?(blade?'kelp-smooth-current-depth-v6':'kelp-depth-v2'):blade?'kelp-smooth-current-tissue-v13':material.userData.kelpSubsurface?'kelp-float-caustics-v4':'kelp-sway-v5';materials.push(material);return material;
  }
  function clear(){leafPhysics?.dispose();leafPhysics=null;leafAccumulator=0;leafMotion.value=null;for(const mesh of group.children){mesh.geometry.dispose();if(mesh.isInstancedMesh)mesh.dispose();}group.clear();for(const m of materials)m.dispose();materials=[];support=null;healthTexture.value?.dispose();healthTexture.value=null;bladeRecords.length=0;stems.length=0;consumed=0;}
  function rebuild(values={}){
    Object.assign(settings,values);
    for(const [key,min,max] of [['strands',4,48],['height',3,11],['generations',2,6],['current',0,1],['direction',0,360],['scattering',0,1]])settings[key]=THREE.MathUtils.clamp(Number.isFinite(settings[key])?settings[key]:defaultKelpSettings[key],min,max);
    settings.strands=Math.round(settings.strands);settings.generations=Math.round(settings.generations);
    clear();time.value=0;height.value=settings.height;setCurrent(settings.current,settings.direction);
    const random=seededRandom(settings.seed),stores=Array.from({length:3},()=>({p:[],n:[],c:[],info:[],root:[],blade:[]}));
    support=createKelpHoldfasts({count:settings.strands,seed:settings.seed,sunlight:waterSunlight,time});materials.push(support.mesh.material);
    let blades=0,rootHeight=0,broadBlades=0,narrowBlades=0,shortPlants=0;
    function vertex(store,p,normal,color,phase,flex=0,anchor=rootHeight){store.p.push(p.x,p.y,p.z);store.n.push(normal.x,normal.y,normal.z);store.c.push(color.r,color.g,color.b);store.info.push(phase,flex);store.root.push(anchor);}
    function append(store,geometry,color,phase,anchor=rootHeight){
      const p=geometry.attributes.position,n=geometry.attributes.normal,index=geometry.index,point=new THREE.Vector3(),normal=new THREE.Vector3();
      for(let i=0;i<(index?.count??p.count);i++){const k=index?index.getX(i):i;vertex(store,point.fromBufferAttribute(p,k),normal.fromBufferAttribute(n,k),color,phase,0,anchor);}
      geometry.dispose();
    }
    const stemColor=new THREE.Color(0x777039),floatColor=new THREE.Color(0xb6a14b);
    function tube(points,radius,phase,segments=8){append(stores[0],new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),segments,radius,5,false),stemColor,phase);}
    function holdfast(points,radius,phase){
      const curve=new THREE.CatmullRomCurve3(points),segments=(points.length-1)*2;
      const geometry=new THREE.TubeGeometry(curve,segments,radius,5,false),positions=geometry.attributes.position,center=new THREE.Vector3(),point=new THREE.Vector3();
      for(let row=0;row<=segments;row++){
        const t=row/segments;curve.getPointAt(t,center);
        for(let column=0;column<=5;column++){
          const k=row*6+column;point.fromBufferAttribute(positions,k).sub(center).multiplyScalar(.15+.85*Math.pow(1-t,.7)).add(center);
          positions.setXYZ(k,point.x,point.y,point.z);
        }
      }
      geometry.computeVertexNormals();append(stores[0],geometry,new THREE.Color(0x727035),phase,settings.height+1);
    }
    // Feather shafts supply the curved central ribs. Fill their contours into
    // broad corrugated blades instead of the fern's divided pinnules.
    const profiles=Array.from({length:8},(_,i)=>generateFeatherData({length:1,spread:.2,density:.15,depth:1,contour:true,seed:settings.seed+i*101}).shaft.p);
    const phrase=rewriteFeatherGrammar(kelpGrammar,settings.generations);
    const roots=Array.from({length:settings.strands},(_,plant)=>{
      const azimuth=plant*2.39996,radius=2.8+Math.sqrt(plant/settings.strands)*4.1;
      const root=new THREE.Vector3(Math.cos(azimuth)*radius,0,Math.sin(azimuth)*radius);
      // Clear the front centre for the shoal, while retaining framing plants.
      if(root.z> -6&&Math.abs(root.x)<3.1){
        root.x=(root.x<0?-1:1)*(4.2+(plant%5)*.45+.12*Math.sin(plant*1.9));
        root.z+=Math.sin(plant*1.47)*.6;
      }
      // Reuse the same plants across several depth planes, rather than
      // collecting every background stipe against the edge of the clearing.
      if(settings.strands>=16&&root.z< -2)root.z-=3.5+(plant%4)*2;
      return root;
    });
    support.prepare(roots);
    for(let plant=0;plant<settings.strands;plant++){
      const root=roots[plant],phase=random()*6.28;
      const attachment=support.attach(root,phase);rootHeight=root.y;
      // Pigment variation is independent of depth; distance fog supplies the
      // visibility falloff rather than darkening plants by their world z.
      const juvenile=plant%7===4,distant=root.z< -2&&plant%3!==0,plantScale=juvenile?.72:distant?.84:1,plantTint=juvenile?.85:.72+.06*Math.sin(plant*1.7);
      if(juvenile||distant)shortPlants++;
      const density=root.z>2?.85:root.z< -2?.70:.55;
      const tall=juvenile?Math.max(rootHeight+.35,settings.height*(.22+random()*.12)):(settings.height+.16-random()*.06)*(distant?.62+.25*(.5+.5*Math.sin(plant*2.31)):1),lean=new THREE.Vector3((random()-.5)*.15,1,(random()-.5)*.15).normalize();
      // One broad S bend for the whole stipe, independent of leaf spacing.
      // Linear control-point heights keep y a reliable parameter for fish.
      const bend=new THREE.Vector3(Math.cos(phase),0,Math.sin(phase)).multiplyScalar(tall*(.11+random()*.025));
      const tip=root.clone().addScaledVector(lean,(tall-rootHeight)/lean.y);
      const curve=new THREE.CubicBezierCurve3(root.clone(),root.clone().lerp(tip,1/3).sub(bend),root.clone().lerp(tip,2/3).add(bend),tip);
      stems.push({curve,height:tall,rootY:rootHeight,phase,stone:attachment.stone});
      const nodes=settings.generations*8,segments=nodes*4;
      const stemGeometry=new THREE.TubeGeometry(curve,segments,.025*plantScale,6,false),stemPositions=stemGeometry.attributes.position;
      const center=new THREE.Vector3(),point=new THREE.Vector3();
      for(let i=0;i<=segments;i++){
        const t=i/segments;curve.getPointAt(t,center);
        for(let j=0;j<=6;j++){
          const k=i*7+j;point.fromBufferAttribute(stemPositions,k).sub(center).multiplyScalar((1-.32*t)*(1+1.1*Math.exp(-t*(tall-rootHeight)/.13))).add(center);
          stemPositions.setXYZ(k,point.x,point.y,point.z);
        }
      }
      stemGeometry.computeVertexNormals();append(stores[0],stemGeometry,stemColor,phase);
      let pos=root.clone(),node=0,segment=0;
      attachment.paths.forEach((points,index)=>holdfast(points,index%3===0?.032:.014,phase));
      for(const symbol of phrase){
        if(symbol==='S'){
          segment++;
          const fraction=segment/nodes,spacing=Math.sin(fraction*Math.PI)*Math.sin(segment*2.17+plant*1.37)*.12/nodes;
          curve.getPoint(THREE.MathUtils.clamp(fraction+spacing,0,1),pos);
        }else if(symbol==='B'){
          const a=node++*(Math.PI*2/16)+phase+.22*Math.sin(node*2.3+plant*1.7),forward=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),side=new THREE.Vector3(-Math.sin(a),0,Math.cos(a));
          // Retain dense framing plants, with fewer midground pairs and
          // irregular gaps between clusters. The mask is stable across rebuilds with the same seed.
          const occupancy=Math.sin(plant*127.1+node*311.7+settings.seed*.17)*43758.5453;
          const h=pos.y/settings.height,upperWindow=THREE.MathUtils.smoothstep(h,.35,.55)*(1-THREE.MathUtils.smoothstep(h,.85,.98));
          if(node>1&&occupancy-Math.floor(occupancy)>density*(1-.28*upperWindow))continue;
          // Retain the existing canopy opening; the steeper light now uses
          // the open corridor without removing or adding vegetation.
          // Stipes remain as thin shadow casters inside this light window.
          const sunHeight=pos.y+.6-settings.height*.46;
          const sunX=pos.x+forward.x*.9+.6*sunHeight,sunZ=pos.z+forward.z*.9-2.6+.65*sunHeight;
          if(h>.5&&sunX*sunX+sunZ*sunZ<1.1*1.1)continue;
          // One stalk → float → blade at every successive spiral node.
          // Align the oval float with the stalk so the blade joins its tip.
          const rise=Math.min(.6,Math.max(0,(settings.height+.19-pos.y)/.49));
          const axis=forward.clone().multiplyScalar(Math.sqrt(1-rise*rise));axis.y=rise;
          const stalkTip=pos.clone().addScaledVector(axis,.16);
          tube([pos.clone(),pos.clone().lerp(stalkTip,.5).add(new THREE.Vector3(0,-.025,0)),stalkTip],.009,phase,4);
          const floatSize=plantScale*(1+.07*Math.sin(node*1.7+phase)),floatLength=.30*floatSize;
          const base=stalkTip.clone().addScaledVector(axis,floatLength);
          const floatGeometry=createKelpFloatGeometry(floatLength,.079*floatSize);
          floatGeometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis));
          floatGeometry.translate(stalkTip.x,stalkTip.y,stalkTip.z);append(stores[2],floatGeometry,floatColor.clone().multiplyScalar((.85+random()*.25)*plantTint),phase);
          // Smaller, narrower blades between full ribbons leave small windows
          // through the canopy without removing floats or spiral nodes.
          const opening=(node+plant*3)%9===0,foregroundRight=root.x>0&&root.z>0;
          const broad=node>1&&(node+plant*2)%5===1,narrow=(node+plant)%7===3&&!broad;
          if(broad)broadBlades++;else if(narrow)narrowBlades++;
          const baseLength=1.15+random()*.7,length=baseLength*1.65*(opening?.78:1)*(broad?.66:narrow?1.07:1)*(juvenile?.78:distant?.87:1);
          const plantWidth=.78+.35*(.5+.5*Math.sin(plant*2.1));
          const width=baseLength*(.11+random()*.06)*(opening?.55:foregroundRight?.84:1)*plantWidth*(broad?1.42:narrow?.67:1)*plantScale,roll=(random()-.5)*2.3;
          const bendStart=Math.asin(rise)*.8+.06+random()*.12,bendAngle=.60+random()*.60,arch=.04+random()*.06;
          const profile=profiles[node%profiles.length],shade=new THREE.Color().setHSL(.105+random()*.035,.55+random()*.16,.27+random()*.10);
          const points=[];
          for(let row=0;row<=32;row++){
            const t=row/32,index=Math.min(65,Math.floor(t*66))*6;
            const envelope=kelpBladeEnvelope(t)*(1+.025*Math.sin(t*19+phase));
            // An upward-curving ribbon: leave the float at a shallow angle,
            // then turn the tip toward the surface while preserving length.
            const angle=bendStart+t*bendAngle,curveRadius=length/bendAngle;
            const rib=base.clone().addScaledVector(forward,curveRadius*(Math.sin(angle)-Math.sin(bendStart)));
            // Sink the wider leaf neck into the float for a continuous join.
            rib.addScaledVector(axis,-.012*Math.exp(-t*24));
            rib.y+=curveRadius*(Math.cos(bendStart)-Math.cos(angle))+Math.sin(t*Math.PI)*arch+profile[index+2]*.26;
            rib.addScaledVector(side,profile[index]*.22);
            // Bend inward-reaching blades around the shoal's swimming lane.
            // Fade the deflection at the attachment and above/below the fish.
            const lane=THREE.MathUtils.smoothstep(rib.z,-.5,.5)*(1-THREE.MathUtils.smoothstep(rib.z,5.3,6.8));
            const fishBand=1-THREE.MathUtils.smoothstep(Math.abs(rib.y-settings.height*.46),settings.height*.1,settings.height*.25);
            rib.x+=(base.x<0?-1:1)*Math.max(0,3.7-Math.abs(rib.x))*lane*fishBand*THREE.MathUtils.smoothstep(t,0,.35);
            for(let column=0;column<=6;column++){
              const v=column/3-1,twist=roll+.32*Math.sin(t*Math.PI)*Math.sin(t*4+phase);
              const w=v*width*envelope*(1+.045*v*Math.sin(t*17+phase)),p=rib.clone().addScaledVector(side,w*Math.cos(twist));
              const edgeFold=(Math.sin(t*15+phase)*.10+Math.sin(t*31+phase*1.7)*.035)*width;
              p.y+=w*Math.sin(twist)+edgeFold*Math.pow(Math.abs(v),2)+v*v*width*.09;
              p.y=Math.min(p.y,settings.height+.20);points.push(p);
            }
          }
          const normals=points.map((p,k)=>{
            const row=Math.floor(k/7),column=k%7;
            const along=points[Math.min(32,row+1)*7+column].clone().sub(points[Math.max(0,row-1)*7+column]);
            const across=points[row*7+Math.min(6,column+1)].clone().sub(points[row*7+Math.max(0,column-1)]);
            if(across.lengthSq()<1e-10)across.copy(side);
            return along.cross(across).normalize();
          });
          for(let row=0;row<32;row++)for(let column=0;column<6;column++){
            const i=row*7+column;
            for(const k of [i,i+7,i+1,i+1,i+7,i+8]){
              const t=Math.floor(k/7)/32,v=k%7/3-1;
              const ribTint=Math.abs(v)<.1?1.07:1-.055*Math.abs(v);
              vertex(stores[1],points[k],normals[k],shade.clone().multiplyScalar(ribTint*plantTint),phase,t*t*length);
              stores[1].blade.push(blades,t,v);
            }
          }
          bladeRecords.push({phase,rootY:rootHeight,length,health:1,anchor:pos.clone(),floatTip:base.clone(),
            rib:Array.from({length:33},(_,i)=>points[i*7+3].clone()),
            sides:Array.from({length:33},(_,row)=>points[row*7+6].clone().sub(points[row*7]).normalize()),
            widths:Array.from({length:33},(_,row)=>Math.max(...points.slice(row*7,row*7+7).map(p=>p.distanceTo(points[row*7+3])))),
          });blades++;
        }
      }
    }
    const depth=configure(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}),true);
    const bladeDepth=configure(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}),true,true);
    bladeCount.value=blades;
    healthTexture.value=new THREE.DataTexture(new Float32Array(blades*4).fill(1),blades,1,THREE.RGBAFormat,THREE.FloatType);
    healthTexture.value.needsUpdate=true;
    leafPhysics=createKelpLeafPhysics({blades:bladeRecords,sample:sampleBladeFree});
    leafMotion.value=leafPhysics.texture;leafRows.value=leafPhysics.rows;leafDamageRevision=damageRevision;
    stores.forEach((store,i)=>{
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(store.p,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(store.n,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(store.c,3));geometry.setAttribute('kelpInfo',new THREE.Float32BufferAttribute(store.info,2));geometry.setAttribute('kelpRoot',new THREE.Float32BufferAttribute(store.root,1));geometry.computeBoundingSphere();geometry.boundingSphere.radius+=4;
      if(i===1)geometry.setAttribute('kelpBlade',new THREE.Float32BufferAttribute(store.blade,3));
      const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:i===2?.55:.72,metalness:0});
      if(i>0){
        material.userData.kelpScatteringScale=i===1?1:.45/.65;
        material.userData.kelpSubsurface={value:settings.scattering*material.userData.kelpScatteringScale};
      }
      configure(material,false,i===1);
      const mesh=new THREE.Mesh(geometry,material);mesh.name=['Kelp stipes and holdfasts','Rippled kelp blades','Buoyant kelp floats'][i];mesh.castShadow=true;mesh.receiveShadow=true;mesh.customDepthMaterial=i===1?bladeDepth:depth;group.add(mesh);
    });
    support.finish();group.add(support.mesh);
    stats={strands:settings.strands,blades,floats:blades,broadBlades,narrowBlades,shortPlants,triangles:stores.reduce((sum,s)=>sum+s.p.length/9,0)+support.mesh.count*(support.mesh.geometry.index?.count??support.mesh.geometry.attributes.position.count)/3};
    revision++;
  }
  // Matches kelpMove in the shader so a fish bites the moving blade, not its
  // undeformed rest position. The same health mask also clips its shadow.
  function movePoint(point,phase,flex=0,rootY=0){
    const h=Math.max(0,point.y-rootY)/Math.max(.1,height.value-rootY);
    const bladeWave=time.value*.95+phase-point.x*.65-point.y*.3-point.z*.5;
    const swell=Math.sin(time.value*.65-h*2.4+phase)*.62+Math.sin(time.value*.33+h*3.1+phase*.7)*.24;
    const sway=current.value*Math.pow(h,1.35)*swell;
    point.x+=(direction.value.x-direction.value.y*.24)*sway;point.z+=(direction.value.y+direction.value.x*.24)*sway;
    const drag=(.32+.12*Math.sin(bladeWave))*flex*current.value;
    const flutter=.085*Math.sin(bladeWave*.8+1.7)*flex*current.value;
    point.x+=direction.value.x*drag-direction.value.y*flutter;
    point.z+=direction.value.y*drag+direction.value.x*flutter;
    point.y+=Math.sin(bladeWave+.8)*flex*current.value*.065;
    if(corridorStrength.value>0&&flex>0){
      const start=corridorStart.value,end=corridorEnd.value,rx=end.x-start.x,ry=end.y-start.y,rz=end.z-start.z;
      const along=THREE.MathUtils.clamp(((point.x-start.x)*rx+(point.y-start.y)*ry+(point.z-start.z)*rz)/Math.max(.001,rx*rx+ry*ry+rz*rz),0,1);
      const length=Math.max(.0001,Math.hypot(rx,rz)),sx=-rz/length,sz=rx/length;
      const lateral=(point.x-start.x-rx*along)*sx+(point.z-start.z-rz*along)*sz,vertical=(point.y-start.y-ry*along)*1.3;
      const influence=(1-THREE.MathUtils.smoothstep(Math.hypot(lateral,vertical),corridorRadius.value*.5,corridorRadius.value))*(1-THREE.MathUtils.smoothstep(along,.78,.96));
      const amount=.30*corridorStrength.value*Math.min(1,flex*.7)*influence*(THREE.MathUtils.smoothstep(lateral+Math.sin(phase)*.08,-.45,.45)*2-1);
      point.x+=sx*amount;point.z+=sz*amount;
    }
    point.y=Math.min(point.y,height.value+.20);return point.add(group.position);
  }
  function sampleBladeFree(index,t,out){
    const blade=bladeRecords[index],row=THREE.MathUtils.clamp(t,0,1)*32,low=Math.floor(row);
    out.copy(blade.rib[low]).lerp(blade.rib[Math.min(32,low+1)],row-low);
    return movePoint(out,blade.phase,t*t*blade.length,blade.rootY);
  }
  function getBladeTarget(index,out){
    const blade=bladeRecords[index];if(!blade||blade.health<=0)return null;
    const t=Math.max(.02,blade.health-.035);sampleBladeFree(index,t,out);
    if(leafPhysics)out.add(leafPhysics.offset(index,t,leafOffset));
    out.y=Math.min(out.y,group.position.y+height.value+.20);return out;
  }
  function bite(index,amount){
    const blade=bladeRecords[index];if(!blade||!Number.isFinite(amount)||amount<=0)return 0;
    const previous=blade.health;blade.health=Math.max(0,previous-amount);if(blade.health<.045)blade.health=0;
    consumed+=previous-blade.health;damageRevision++;healthTexture.value.image.data[index*4]=blade.health;healthTexture.value.needsUpdate=true;return previous-blade.health;
  }
  function restore(){for(const blade of bladeRecords)blade.health=1;consumed=0;damageRevision++;if(healthTexture.value){healthTexture.value.image.data.fill(1);healthTexture.value.needsUpdate=true;}}
  function getObstacles(){
    const key=[revision,current.value>0?time.value:0,current.value,direction.value.x,direction.value.y,damageRevision,leafPhysics?.version,corridorRevision].join(':');
    if(key===obstacleKey)return obstacles;
    obstacleKey=key;let count=0;
    function capsule(a,b,radius,leaf=-1){
      const item=obstacles.capsules[count]??(obstacles.capsules[count]={a:new THREE.Vector3(),b:new THREE.Vector3(),radius:0,leaf:-1});
      item.a.copy(a);item.b.copy(b);item.radius=radius;item.leaf=leaf;count++;
    }
    for(const stem of stems)for(let i=0;i<16;i++){
      stem.curve.getPoint(i/16,obstacleA);movePoint(obstacleA,stem.phase,0,stem.rootY);
      stem.curve.getPoint((i+1)/16,obstacleB);movePoint(obstacleB,stem.phase,0,stem.rootY);
      capsule(obstacleA,obstacleB,.055);
    }
    function bladePoint(index,t,out){
      sampleBladeFree(index,t,out);
      if(leafPhysics)out.add(leafPhysics.offset(index,t,leafOffset));
      out.y=Math.min(out.y,group.position.y+height.value+.20);return out;
    }
    bladeRecords.forEach((blade,index)=>{
      movePoint(obstacleA.copy(blade.anchor),blade.phase,0,blade.rootY);movePoint(obstacleB.copy(blade.floatTip),blade.phase,0,blade.rootY);
      capsule(obstacleA,obstacleB,.075,index);
      for(let i=0;i<8&&i/8<blade.health;i++){
        const start=i/8,end=Math.min((i+1)/8,blade.health);
        bladePoint(index,start,obstacleA);bladePoint(index,end,obstacleB);
        let radius=0;for(let row=Math.floor(start*32);row<=Math.ceil(end*32);row++)radius=Math.max(radius,blade.widths[row]);
        capsule(obstacleA,obstacleB,radius+.035+current.value*.06,index);
      }
    });
    for(const stone of support?.stones??[])for(const center of stone.collisionCenters){obstacleA.copy(center).add(group.position);capsule(obstacleA,obstacleA,stone.height);}
    obstacles.capsules.length=count;obstacles.version++;return obstacles;
  }
  function getStemPosition(index,y,out){
    const stem=stems[index];if(!stem)return null;
    const localY=y-group.position.y;if(localY<stem.rootY-1e-7||localY>stem.height+1e-7)return null;
    stem.curve.getPoint(THREE.MathUtils.clamp((localY-stem.rootY)/(stem.height-stem.rootY),0,1),out);return movePoint(out,stem.phase,0,stem.rootY);
  }
  function getStemBase(index,out){const stem=stems[index];if(!stem)return null;return stem.curve.getPoint(0,out).add(group.position);}
  function setCurrent(value,angle=settings.direction){settings.current=THREE.MathUtils.clamp(value,0,1);settings.direction=angle;current.value=settings.current;direction.value.set(Math.cos(angle*Math.PI/180),Math.sin(angle*Math.PI/180));}
  function setViewingCorridor(cameraPosition,subject,dt=1/60){
    const enabled=!!subject?.active;
    if(!enabled&&corridorStrength.value===0)return false;
    const alpha=1-Math.exp(-Math.min(.1,Math.max(0,dt))*4);
    const viewAlpha=1-Math.exp(-Math.min(.1,Math.max(0,dt))*.8);
    const before=corridorStrength.value;
    corridorStrength.value=THREE.MathUtils.lerp(before,enabled?1:0,alpha);
    if(!enabled&&corridorStrength.value<.0001)corridorStrength.value=0;
    let changed=Math.abs(corridorStrength.value-before)>1e-6;
    if(enabled){
      corridorTargetStart.copy(subject.center).sub(group.position);corridorTargetEnd.copy(cameraPosition).sub(group.position);
      changed=changed||corridorStart.value.distanceToSquared(corridorTargetStart)>.000001||corridorEnd.value.distanceToSquared(corridorTargetEnd)>.000001;
      corridorStart.value.lerp(corridorTargetStart,viewAlpha);corridorEnd.value.lerp(corridorTargetEnd,viewAlpha);
      const radius=THREE.MathUtils.clamp(subject.orbitRadius+.4,1.05,2.05);
      changed=changed||Math.abs(corridorRadius.value-radius)>.0001;
      corridorRadius.value=THREE.MathUtils.lerp(corridorRadius.value,radius,alpha);
    }
    if(changed)corridorRevision++;return changed;
  }
  function setScattering(value){
    settings.scattering=THREE.MathUtils.clamp(Number.isFinite(value)?value:defaultKelpSettings.scattering,0,1);
    for(const material of materials)if(material.userData.kelpSubsurface)material.userData.kelpSubsurface.value=settings.scattering*material.userData.kelpScatteringScale;
  }
  return {group,rebuild,setCurrent,setScattering,setViewingCorridor,updateSunlight,getBladeTarget,getLeafPhysics(){return leafPhysics;},getStemPosition,getStemBase,getObstacles,bite,restore,getSupportStones(){return support?.stones??[];},getBladeHealth(index){return bladeRecords[index]?.health??0;},get revision(){return revision;},get settings(){return {...settings};},get stats(){return {...stats,remaining:stats.blades?THREE.MathUtils.clamp(1-consumed/stats.blades,0,1):1,eaten:bladeRecords.reduce((n,b)=>n+(b.health===0),0)};},get playing(){return playing;},setPlaying(value){playing=!!value;},get elapsed(){return time.value;},advance(dt){if(!group.visible||!playing||!(dt>0))return false;time.value+=Math.min(dt,.1);
      const step=1/30;
      leafAccumulator=Math.min(.1,leafAccumulator+Math.min(dt,.1));
      if(leafPhysics&&(current.value>0||leafDamageRevision!==damageRevision)&&
        (leafAccumulator+1e-9>=step||leafDamageRevision!==damageRevision)){
        leafPhysics.solve(Math.min(.05,Math.max(1/60,leafAccumulator)),3,true);
        const ticks=Math.floor((leafAccumulator+1e-9)/step);
        leafAccumulator=ticks?Math.max(0,leafAccumulator-ticks*step):0;leafDamageRevision=damageRevision;
      }
      leafPhysics?.interpolate(Math.min(1,leafAccumulator/step));
      return true;},dispose(){clear();obstacles.capsules.length=0;group.removeFromParent();}};
}

import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';
import {createKelpAvoidance} from './kelp-avoidance.js';
import {fishSpecies,speciesForFish,fishBodyProfile,addFishSpeciesGeometry,fishSpeciesVertexGLSL,fishSpeciesPigmentGLSL,fishMarkingsGLSL} from './fish-species.js';
import {createFishScaleLife,fishScaleLifeGLSL} from './fish-scale-life.js';
import {createKelpSunlight,kelpSunlightShader} from './kelp-lighting.js';
import {sunShadowShader} from './kelp-godrays.js';

export const defaultFishSettings=Object.freeze({count:20,speed:1,feeding:1});
const capacity=500,fragmentCapacity=160,step=1/30,cellSize=1.6;
const cellKey=(x,y,z)=>(x+32)+(y+32)*64+(z+32)*4096;

function fishGeometry(){
  const p=[],n=[],c=[],skin=[],parts=[];
  const silver=new THREE.Color(0xb7cbd0),back=new THREE.Color(0x234b58),belly=new THREE.Color(0xd5dfdc),fin=new THREE.Color(0x72949f),eye=new THREE.Color(0x07191c);
  function append(geometry,color,scales=0,part=scales>0?1:0){
    const positions=geometry.attributes.position,normals=geometry.attributes.normal,index=geometry.index;
    for(let i=0;i<(index?.count??positions.count);i++){
      const k=index?index.getX(i):i,x=positions.getX(k),y=positions.getY(k),z=positions.getZ(k);
      p.push(x,y,z);n.push(normals.getX(k),normals.getY(k),normals.getZ(k));skin.push(scales);parts.push(part);
      const shade=typeof color==='function'?color(y,x,z):color;c.push(shade.r,shade.g,shade.b);
    }
    geometry.dispose();
  }
  // An elongated body with a narrow caudal peduncle and a tapered snout.
  const profile=fishBodyProfile;
  const interpolant=new THREE.CubicInterpolant(Float32Array.from(profile,r=>r[0]),Float32Array.from(profile.flatMap(r=>r.slice(1))),2);
  const positions=[],indices=[],rows=28,sides=16;
  for(let row=0;row<=rows;row++){
    const t=row/rows,x=-.26+t*.535,r=interpolant.evaluate(x),h=Math.max(0,r[0]),w=Math.max(0,r[1]);
    for(let side=0;side<=sides;side++){
      const a=side/sides*Math.PI*2;
      positions.push(x,Math.cos(a)*h+Math.sin(t*Math.PI)*.003,Math.sin(a)*w);
      if(row<rows&&side<sides){const i=row*(sides+1)+side,j=i+sides+1;indices.push(i,i+1,j,i+1,j+1,j);}
    }
  }
  const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));body.setIndex(indices);body.computeVertexNormals();
  const normals=body.attributes.normal,normal=new THREE.Vector3(),other=new THREE.Vector3();
  for(let row=0;row<=rows;row++){
    const a=row*(sides+1),b=a+sides;
    if(row===0||row===rows){for(let side=0;side<=sides;side++)normals.setXYZ(a+side,row===0?-1:1,0,0);}
    else{normal.fromBufferAttribute(normals,a).add(other.fromBufferAttribute(normals,b)).normalize();normals.setXYZ(a,normal.x,normal.y,normal.z);normals.setXYZ(b,normal.x,normal.y,normal.z);}
  }
  const shade=new THREE.Color();append(body,y=>shade.copy(silver).lerp(back,THREE.MathUtils.smoothstep(y,-.005,.067)).lerp(belly,1-THREE.MathUtils.smoothstep(y,-.06,-.018)),1);
  function membrane(shape,transform=null){
    const geometry=new THREE.ShapeGeometry(shape,10);if(transform)transform(geometry);
    append(geometry,fin);
  }
  // Curved, swept fin outlines replace the large arrow-like triangles.
  const tail=new THREE.Shape();tail.moveTo(-.245,0);tail.bezierCurveTo(-.29,.025,-.36,.10,-.425,.12);
  tail.bezierCurveTo(-.407,.082,-.355,.025,-.333,0);tail.bezierCurveTo(-.355,-.025,-.407,-.082,-.425,-.12);
  tail.bezierCurveTo(-.36,-.10,-.29,-.025,-.245,0);membrane(tail);
  const dorsal=new THREE.Shape();dorsal.moveTo(.065,.063);dorsal.bezierCurveTo(.016,.077,-.037,.132,-.069,.130);
  dorsal.bezierCurveTo(-.075,.095,-.115,.066,-.170,.038);dorsal.quadraticCurveTo(-.06,.065,.065,.063);membrane(dorsal);
  const anal=new THREE.Shape();anal.moveTo(-.035,-.061);anal.quadraticCurveTo(-.095,-.075,-.132,-.111);anal.quadraticCurveTo(-.130,-.062,-.19,-.030);anal.closePath();membrane(anal);
  for(const side of [-1,1]){
    const pectoral=new THREE.Shape();pectoral.moveTo(.12,0);pectoral.bezierCurveTo(.071,.012,-.015,.073,-.065,.095);
    pectoral.quadraticCurveTo(-.024,.042,.07,-.008);pectoral.closePath();
    membrane(pectoral,g=>{g.rotateX(side*1.05);g.translate(0,-.018,side*.025);});
    for(const [rx,ry,rz,x,y,z,color] of [[.010,.009,.0028,.185,.015,side*.0305,new THREE.Color(0x819b9f)],[.006,.0065,.0018,.185,.015,side*.0333,eye],[.0018,.0018,.0008,.188,.018,side*.0352,new THREE.Color(0xd9e6e3)]]){
      const e=new THREE.SphereGeometry(1,10,6);e.scale(rx,ry,rz);e.translate(x,y,z);append(e,color,0,2);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(c,3));geometry.setAttribute('fishSkin',new THREE.Float32BufferAttribute(skin,1));geometry.setAttribute('fishPart',new THREE.Float32BufferAttribute(parts,1));
  return geometry;
}

export function createKelpFish({scene,kelp,floorY=-1.75,sun=null,sunlight=createKelpSunlight()}){
  const group=new THREE.Group();group.name='Kelp fish school';group.visible=false;scene.add(group);
  const scaleLife=createFishScaleLife();
  const settings={...defaultFishSettings},time={value:0},swim=new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2);
  const geometry=fishGeometry();addFishSpeciesGeometry(geometry);geometry.setAttribute('fishSwim',swim);
  const species=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('fishSpecies',species);
  const appearance=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('fishRoughness',appearance);
  const material=new THREE.MeshPhysicalMaterial({vertexColors:true,side:THREE.DoubleSide,metalness:.50,roughness:.30,clearcoat:.16,clearcoatRoughness:.24,envMapIntensity:1.0});
  const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
  const rimUniforms={...sunlight,fishSunRadiance:{value:new THREE.Color()},fishRimGain:{value:.085},sunShadow:{value:white},sunShadowMatrix:{value:new THREE.Matrix4()},sunTexel:{value:new THREE.Vector2(1,1)},shadowEnabled:{value:0},shadowBias:{value:0},shadowStrength:{value:1},shadowRadius:{value:1}};
  const depth=new THREE.MeshDepthMaterial({side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking});
  for(const m of [material,depth]){
    m.onBeforeCompile=shader=>{
      shader.uniforms.fishTime=time;
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec2 fishSwim;uniform float fishTime;
        ${fishSpeciesVertexGLSL}`)
        .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        objectNormal=fishSpeciesNormal(objectNormal);`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
        transformed=fishSpeciesPosition(position);
        vec2 tailTraits=fishTailTraits();
        float tail=pow(max(0.0,-position.x+.08)/.5,2.0);
        transformed.z+=sin(fishTime*(7.0+fishSwim.y*5.0)*tailTraits.x+fishSwim.x+position.x*8.0)*tail*.075*tailTraits.y;`);
      if(m===material){
        Object.assign(shader.uniforms,rimUniforms,scaleLife.uniforms);
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
          attribute float fishRoughness,fishSkin,fishPart;varying float vFishRoughness,vFishSkin,vFishPart,vFishSpecies;varying vec3 vFishSurface,vFishWorld;varying vec4 vFishBody;`)
          .replace('#include <project_vertex>',`#include <project_vertex>
          vFishWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;
          vFishBody=vec4((modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz,length(instanceMatrix[0].xyz));`)
          .replace('#include <begin_vertex>',`#include <begin_vertex>
          vFishRoughness=fishRoughness;vFishSkin=fishSkin;vFishPart=fishPart;vFishSpecies=fishSpecies;vFishSurface=position;`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
          varying float vFishRoughness,vFishSkin,vFishPart,vFishSpecies;varying vec3 vFishSurface,vFishWorld;varying vec4 vFishBody;
          uniform vec3 fishSunRadiance;uniform float fishRimGain;
          ${kelpSunlightShader}
          ${fishScaleLifeGLSL}
          ${fishMarkingsGLSL}`)
          .replace('#include <lights_physical_pars_fragment>',`#include <lights_physical_pars_fragment>
          ${sunShadowShader.replace('sunTexel*shadowRadius*.5','sunTexel*min(shadowRadius,2.0)*.5')}`)
          .replace('#include <color_fragment>',`#include <color_fragment>
          float fishPigment=sin(vFishSurface.x*38.0+vFishRoughness*17.0)*sin(vFishSurface.y*65.0+vFishSurface.z*29.0);
          // Staggered rows wrap around the body in its undeformed coordinates,
          // so overlapping scale lips stay attached through the tail stroke.
          vec2 scaleUV=vec2((.25-vFishSurface.x)*42.0,
            atan(vFishSurface.y/.075,vFishSurface.z/.056+.00001)*3.1830989);
          float scaleFootprint=max(fwidth(scaleUV.x),fwidth(scaleUV.y));
          float scaleResolved=1.0-smoothstep(.35,1.1,scaleFootprint);
          float scaleMask=vFishSkin*smoothstep(-.245,-.17,vFishSurface.x)*(1.0-smoothstep(.10,.20,vFishSurface.x));
          vec2 scaleCell=fract(vec2(scaleUV.x+mod(floor(scaleUV.y),2.0)*.5,scaleUV.y))-.5;
          float scaleArc=length(vec2(scaleCell.x+.18,scaleCell.y*.92));
          float scaleLip=(1.0-smoothstep(.025,.085,abs(scaleArc-.48)))*smoothstep(-.25,.08,scaleCell.x);
          float scaleDome=max(0.0,1.0-dot(scaleCell*vec2(1.55,2.0),scaleCell*vec2(1.55,2.0)));
          vec2 fishColony=fishScaleColony(floor(vec2(scaleUV.x+mod(floor(scaleUV.y),2.0)*.5,scaleUV.y)),vFishSpecies,vFishRoughness);
          ${fishSpeciesPigmentGLSL}
          float colonyMask=scaleMask*scaleResolved*step(.5,vFishSpecies);
          float scaleRelief=(scaleDome*.00016+scaleLip*.000085)*scaleMask*scaleResolved*mix(.8,1.4,fishColony.y);
          diffuseColor.rgb*=1.0+(fishColony.x-.45)*.19*colonyMask;
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.82,.96,1.02),fishColony.y*colonyMask*.25);
          diffuseColor.rgb*=1.0+fishPigment*.015+(scaleDome*.02-scaleLip*.025)*scaleMask*scaleResolved;
          float tailFin=1.0-smoothstep(-.245,-.20,vFishSurface.x);
          float finMask=(1.0-vFishSkin)*max(tailFin,max(smoothstep(.075,.095,abs(vFishSurface.y)),smoothstep(.060,.080,abs(vFishSurface.z))));
          float finPhase=mix(atan(abs(vFishSurface.y)-.05,.07-vFishSurface.x+.0001),atan(vFishSurface.y,-.245-vFishSurface.x+.0001),tailFin)*22.0;
          float finResolved=1.0-smoothstep(.5,1.5,fwidth(finPhase));
          diffuseColor.rgb*=1.0+cos(finPhase)*.045*finMask*finResolved;
          float lineAA=max(.0005,fwidth(vFishSurface.x));
          float sideMask=smoothstep(.010,.025,abs(vFishSurface.z))*vFishSkin;
          float gillCurve=.125-.032*pow((vFishSurface.y+.002)/.069,2.0);
          float gill=(1.0-smoothstep(.0008+lineAA,.0025+lineAA,abs(vFishSurface.x-gillCurve)))*sideMask;
          float mouth=(1.0-smoothstep(.0006+lineAA,.0017+lineAA,abs(vFishSurface.y+.003)))*smoothstep(.22,.247,vFishSurface.x)*sideMask;
          float lateralY=-.008+.006*sin((vFishSurface.x+.2)*5.0);
          float lateral=(1.0-smoothstep(.0005+lineAA,.0015+lineAA,abs(vFishSurface.y-lateralY)))*scaleMask;
          diffuseColor.rgb*=1.0-gill*.32-mouth*.38-lateral*.10;`)
          .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
          float scaleGloss=clamp(roughnessFactor+vFishRoughness*.6+fishPigment*.025
            -scaleLip*.022*scaleMask*scaleResolved+.045*(1.0-scaleResolved),.23,.42);
          scaleGloss+=vFishSpecies>1.5&&vFishSpecies<2.5?.20:0.0;
          scaleGloss+=(fishColony.y*.05-fishColony.x*.035)*colonyMask;
          roughnessFactor=mix(.50,scaleGloss,vFishSkin);`)
          .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
          float speciesMetal=vFishSpecies<.5?metalnessFactor:(vFishSpecies<1.5?.20:(vFishSpecies<2.5?.015:.15));
          metalnessFactor=mix(.08,speciesMetal,vFishSkin);`)
          .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          vec3 fishDx=dFdx(-vViewPosition),fishDy=dFdy(-vViewPosition);
          vec3 fishRx=cross(fishDy,normal),fishRy=cross(normal,fishDx);
          float fishDet=dot(fishDx,fishRx);
          vec3 fishGradient=dFdx(scaleRelief)*fishRx+dFdy(scaleRelief)*fishRy;
          if(abs(fishDet)>1e-12){
            vec3 perturbed=normal-sign(fishDet)*fishGradient/max(abs(fishDet),1e-8);
            float normalLength=dot(perturbed,perturbed);
            if(normalLength>1e-12&&normalLength<1e12)normal=perturbed*inversesqrt(normalLength);
          }`)
          .replace('#include <lights_physical_fragment>',`#include <lights_physical_fragment>
          #ifdef USE_CLEARCOAT
            material.clearcoat*=vFishSkin;
          #endif`)
          .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          vec3 fishWorldNormal=inverseTransformDirection(normal,viewMatrix);
          float fishRim=pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),3.0);
          float litEdge=smoothstep(-.2,.65,dot(fishWorldNormal,waterSunDirection));
          float visibility=sunVisibility(vFishWorld+waterSunDirection*.05);
          // A little transmitted sunlight keeps thin, pigmented bodies readable
          // in backlight. It uses the same water attenuation and real shadows.
          float transmissionVisibility=sunVisibility(vFishBody.xyz+waterSunDirection*(vFishBody.w*.48+.03));
          reflectedLight.directDiffuse+=fishSpeciesBacklight*fishSunRadiance*waterSunTransmission(vFishWorld)*transmissionVisibility;
          reflectedLight.directSpecular+=fishSunRadiance*waterSunTransmission(vFishWorld)*vec3(.58,.80,.95)*
            (fishRim*litEdge*visibility*fishRimGain*vFishSkin);`);
      }
    };
    m.customProgramCacheKey=()=>m===depth?'fish-community-depth-v4':'fish-natural-disc-anatomy-v11';
  }
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name='Mixed schooling fish';mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;mesh.customDepthMaterial=depth;group.add(mesh);
  mesh.onBeforeRender=()=>{
    const shadow=sun?.shadow;
    rimUniforms.sunShadow.value=shadow?.map?.texture??white;rimUniforms.shadowEnabled.value=sun?.castShadow&&shadow?.map?1:0;
    if(shadow){rimUniforms.sunShadowMatrix.value.copy(shadow.matrix);rimUniforms.sunTexel.value.set(1/(shadow.map?.width??1),1/(shadow.map?.height??1));rimUniforms.shadowBias.value=shadow.bias;rimUniforms.shadowStrength.value=shadow.intensity;rimUniforms.shadowRadius.value=shadow.radius;}
    if(sun)rimUniforms.fishSunRadiance.value.copy(sun.color).multiplyScalar(sun.intensity);else rimUniforms.fishSunRadiance.value.setRGB(0,0,0);
  };
  material.userData.fishRimGain=rimUniforms.fishRimGain;
  material.userData.fishSunRadiance=rimUniforms.fishSunRadiance;
  material.userData.scaleLife=scaleLife;
  const fragments=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.035,0),new THREE.MeshStandardMaterial({color:0x819442,roughness:.85}),fragmentCapacity);
  fragments.name='Bitten kelp fragments';fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);fragments.frustumCulled=false;fragments.visible=false;group.add(fragments);
  const fish=Array.from({length:capacity},()=>({p:new THREE.Vector3(),previous:new THREE.Vector3(),v:new THREE.Vector3(),force:new THREE.Vector3(),face:new THREE.Vector3(1,0,0),previousFace:new THREE.Vector3(1,0,0),wander:new THREE.Vector3(),wanderWait:0,foliageSpeed:1,orbitCheck:new THREE.Vector3(),orbitTime:0,detourTime:0,target:-1,cooldown:0,biteWait:0,huntTime:0,bites:0,size:1,phase:0,kind:0}));
  const debris=Array.from({length:fragmentCapacity},()=>({p:new THREE.Vector3(),v:new THREE.Vector3(),age:10,spin:0}));
  const grid=new Map(),buckets=[],claimed=new Map(),dummy=new THREE.Object3D(),basis=new THREE.Matrix4(),up=new THREE.Vector3(),side=new THREE.Vector3(),facing=new THREE.Vector3(),target=new THREE.Vector3(),candidate=new THREE.Vector3(),mouth=new THREE.Vector3();
  const schoolHeading=new THREE.Vector3(1,0,0);
  const shapeNormal=new THREE.Vector3(),shapeProbe=new THREE.Vector3(),orbitTangent=new THREE.Vector3();
  const kelpNormal=new THREE.Vector3(),kelpTangent=new THREE.Vector3(),avoidance=createKelpAvoidance(kelp);
  let attractor=null,roaming=false,terrainHeight=null;
  function cruisingSpeed(f){return (.9+f.size*.3)*settings.speed*fishSpecies[f.kind].speed;}
  function floorAt(point,padding=.25){
    const terrain=terrainHeight?.(point.x,point.z);
    return Math.max(floorY,Number.isFinite(terrain)?terrain:floorY)+padding;
  }
  function clearPoint(point,clearance,ignoreLeaf=-1){
    for(let i=0;i<2;i++){
      avoidance.project(point,clearance,kelpNormal,ignoreLeaf,floorAt(point));
      if(attractor?.active)attractor.project(point,clearance,shapeNormal);
    }
    point.y=Math.max(floorAt(point),point.y);
  }
  function keepClear(f,includePrevious=false){
    const clearance=.48*f.size+.08;
    for(let i=0;i<2;i++){
      if(avoidance.project(f.p,clearance,kelpNormal,f.target,floorAt(f.p)))f.v.addScaledVector(kelpNormal,-Math.min(0,f.v.dot(kelpNormal)));
      if(attractor?.active&&attractor.project(f.p,clearance,shapeNormal))f.v.addScaledVector(shapeNormal,-Math.min(0,f.v.dot(shapeNormal)));
    }
    f.p.y=Math.max(floorAt(f.p),f.p.y);
    if(includePrevious)clearPoint(f.previous,clearance,f.target);
  }
  function setAttractor(value){
    attractor=value;if(attractor?.active)roaming=false;avoidance.update();
    for(let i=0;i<settings.count;i++){
      const f=fish[i];if(attractor?.active&&f.target>=0)release(f);keepClear(f,true);
      f.orbitCheck.copy(f.p);f.orbitTime=(i%23)/23*2.5;f.detourTime=0;
    }
    updateMeshes();
  }
  function pickWander(f){
    for(let i=0;i<10;i++){
      f.wander.set(THREE.MathUtils.clamp(f.p.x+(random()-.5)*11,-9.5,9.5),THREE.MathUtils.clamp(f.p.y+(random()-.5)*5,floorY+.7,floorY+height-.35),THREE.MathUtils.clamp(f.p.z+(random()-.5)*11,-9.5,9.5));
      f.wander.y=Math.max(f.wander.y,floorAt(f.wander,.7));
      if(avoidance.isClear(f.wander,.48*f.size+.08)&&(!attractor?.active||attractor.distanceTo(f.wander)>.48*f.size+.08))break;
      if(i===9)f.wander.copy(f.p);
    }
    f.wanderWait=3+random()*5;
  }
  function pickOrbitDetour(f,clearance){
    const dx=f.p.x-attractor.center.x,dz=f.p.z-attractor.center.z,angle=Math.atan2(dz,dx);
    orbitTangent.set(-Math.sin(angle),0,Math.cos(angle));
    const nearby=avoidance.nearest(f.p,clearance+1.5,kelpNormal);
    if(!Number.isFinite(nearby))kelpNormal.set(Math.cos(angle),0,Math.sin(angle));
    // Commit to an elevated opening for several seconds instead of switching
    // sides at each leaf contact. No position changes bypass collision checks.
    for(const rise of [1.0,1.8,2.7])for(const distance of [1.4,2.3])for(const lateral of [0,1,-1]){
      shapeProbe.copy(f.p).addScaledVector(orbitTangent,distance).addScaledVector(kelpNormal,.8);
      shapeProbe.x+=Math.cos(angle)*lateral;shapeProbe.z+=Math.sin(angle)*lateral;
      shapeProbe.y=Math.min(floorY+height-.4,Math.max(floorAt(shapeProbe,.8),f.p.y+rise+.2*Math.sin(f.phase)));
      if(shapeProbe.distanceToSquared(f.p)<.5||!avoidance.isClear(shapeProbe,clearance+.12)||attractor.distanceTo(shapeProbe)<clearance+.2)continue;
      f.wander.copy(shapeProbe);f.detourTime=6;return;
    }
  }
  function setRoaming(value){
    roaming=!!value;avoidance.update();
    for(let i=0;i<settings.count;i++){
      const f=fish[i];if(f.target>=0)release(f);f.detourTime=0;
      if(roaming){pickWander(f);candidate.subVectors(f.wander,f.p).normalize().multiplyScalar(settings.speed);f.v.lerp(candidate,.65);}
      keepClear(f,true);
    }
    updateMeshes();
  }
  let random=seededRandom(1),elapsed=0,accumulator=0,version=-1,biteCount=0,cursor=0,activeDebris=0,height=7,bladeTotal=0;
  function initialize(i){
    const f=fish[i],angle=random()*Math.PI*2,r=Math.sqrt(random());
    f.p.set(Math.cos(angle)*r*2.0,floorY+height*.46+(random()-.5)*1.6,2.9+Math.sin(angle)*r*1.1);
    f.v.set(.9+(random()-.5)*.2,(random()-.5)*.1,-.15);f.face.copy(f.v).normalize();f.target=-1;
    f.previous.copy(f.p);f.previousFace.copy(f.face);f.huntTime=0;f.foliageSpeed=1;
    f.cooldown=1+random()*8;f.biteWait=0;f.bites=0;f.kind=speciesForFish(i);f.size=(.75+random()*.5)*fishSpecies[f.kind].size;f.phase=random()*6.28;species.setX(i,f.kind);
    if(i%13===0&&f.kind===0)f.size*=1.35;
    swim.setXY(i,f.phase,f.size*settings.speed);mesh.setColorAt(i,new THREE.Color().setScalar(.85+random()*.3));
    appearance.setX(i,Math.sin(f.phase*7.13+i*1.7)*.1);
    keepClear(f,true);f.orbitCheck.copy(f.p);f.orbitTime=(i%23)/23*2.5;f.detourTime=0;
    if(roaming)pickWander(f);
  }
  function release(f){if(claimed.get(f.target)===f)claimed.delete(f.target);f.target=-1;f.bites=0;f.cooldown=10+random()*14;}
  function reset(){
    version=kelp.revision;height=kelp.settings.height;const stats=kelp.stats;bladeTotal=stats.blades;
    random=seededRandom(kelp.settings.seed+811);scaleLife.reset(kelp.settings.seed+811);elapsed=0;time.value=0;accumulator=0;biteCount=0;cursor=0;claimed.clear();
    avoidance.update();
    for(let i=0;i<settings.count;i++)initialize(i);
    for(const d of debris)d.age=10;activeDebris=0;fragments.visible=false;swim.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    appearance.needsUpdate=true;species.needsUpdate=true;mesh.count=settings.count;updateMeshes();
  }
  function setSettings(values={}){
    avoidance.update();
    const old=settings.count;
    for(const [name,min,max] of [['count',0,capacity],['speed',.05,2],['feeding',0,1]])if(Number.isFinite(values[name]))settings[name]=THREE.MathUtils.clamp(values[name],min,max);
    settings.count=Math.round(settings.count);
    for(let i=settings.count;i<old;i++)release(fish[i]);
    for(let i=old;i<settings.count;i++)initialize(i);
    for(let i=0;i<settings.count;i++){swim.setY(i,fish[i].size*settings.speed);if(!settings.feeding&&fish[i].target>=0)release(fish[i]);}
    mesh.count=settings.count;swim.needsUpdate=true;appearance.needsUpdate=true;species.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;updateMeshes();
  }
  function foodFor(f){
    let nearest=-1,distance=5.5*5.5;
    for(let j=0;j<bladeTotal;j++){
      if(claimed.has(j)||!kelp.getBladeTarget(j,candidate))continue;
      if(Math.abs(candidate.x)>7.7||Math.abs(candidate.z)>7.7)continue;
      const d=f.p.distanceToSquared(candidate);
      if(d<distance){
        shapeProbe.subVectors(f.p,candidate).normalize().multiplyScalar(.45).add(candidate);
        if(!avoidance.isClear(shapeProbe,.48*f.size+.08,j))continue;
        distance=d;nearest=j;
      }
    }
    if(nearest>=0){f.target=nearest;f.bites=0;f.huntTime=0;claimed.set(nearest,f);}
    else f.cooldown=2+random()*3;
  }
  function emit(position){
    for(let i=0;i<4;i++){
      const d=debris[cursor++%fragmentCapacity];d.p.copy(position);d.v.set((random()-.5)*.3,.08+random()*.15,(random()-.5)*.3);d.age=0;d.spin=random()*6.28;
    }
  }
  function simulate(dt){
    elapsed+=dt;time.value=elapsed;scaleLife.advance(dt);
    // Reuse bucket arrays; neighbour queries inspect only adjacent cells.
    grid.clear();let bucketCount=0;
    for(let i=0;i<settings.count;i++){
      const p=fish[i].p,k=cellKey(Math.floor(p.x/cellSize),Math.floor(p.y/cellSize),Math.floor(p.z/cellSize));
      let bucket=grid.get(k);if(!bucket){bucket=buckets[bucketCount]??(buckets[bucketCount]=[]);bucket.length=0;bucketCount++;grid.set(k,bucket);}bucket.push(i);
    }
    const goalX=Math.sin(elapsed*.13)*1.1,goalY=floorY+height*(.46+.12*Math.sin(elapsed*.17)),goalZ=2.6+Math.cos(elapsed*.13)*.6;
    schoolHeading.set(Math.cos(elapsed*.13),.035*Math.cos(elapsed*.17),-.55*Math.sin(elapsed*.13)).normalize();
    for(let i=0;i<settings.count;i++){
      const f=fish[i],p=f.p,v=f.v,force=f.force;force.set(0,0,0);f.cooldown-=dt;f.biteWait-=dt;f.previousFace.copy(f.face);
      if(f.target>=0){f.huntTime+=dt;if(roaming||attractor?.active||!kelp.getBladeHealth(f.target)||!settings.feeding||f.huntTime>16)release(f);}
      // Stagger excursions: part of the shoal feeds while the rest keeps moving.
      if(!roaming&&!attractor?.active&&f.target<0&&settings.feeding>0&&f.cooldown<=0&&i%4===Math.floor(elapsed/12)%4)foodFor(f);
      const feeding=f.target>=0,scout=i%19===0,cohesion=roaming?.08:feeding?.07:attractor?.active?.18:scout?.35:1;
      const cx=Math.floor(p.x/cellSize),cy=Math.floor(p.y/cellSize),cz=Math.floor(p.z/cellSize);
      let neighbours=0,px=0,py=0,pz=0,vx=0,vy=0,vz=0,sx=0,sy=0,sz=0;
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
        const bucket=grid.get(cellKey(cx+x,cy+y,cz+z));if(!bucket)continue;
        for(const j of bucket){
          if(i===j)continue;const other=fish[j],dx=p.x-other.p.x,dy=p.y-other.p.y,dz=p.z-other.p.z,d2=dx*dx+dy*dy+dz*dz;
          if(d2>cellSize*cellSize)continue;
          neighbours++;px+=other.p.x;py+=other.p.y;pz+=other.p.z;vx+=other.v.x;vy+=other.v.y;vz+=other.v.z;
          if(d2<.55*.55){const weight=1/(d2+.008);sx+=dx*weight;sy+=dy*weight;sz+=dz*weight;}
        }
      }
      if(neighbours){
        force.set((px/neighbours-p.x)*.18+(vx/neighbours-v.x)*1.8,(py/neighbours-p.y)*.18+(vy/neighbours-v.y)*1.8,(pz/neighbours-p.z)*.18+(vz/neighbours-v.z)*1.8).multiplyScalar(cohesion);
      }
      force.x+=sx*.23;force.y+=sy*.23;force.z+=sz*.23;
      // Start easing down outside the body envelope, before contact forces
      // have to push a fish away. Open-water cruising keeps its usual speed.
      const clearance=.48*f.size+.08;
      const nearby=avoidance.nearest(p,clearance+1.15,kelpNormal,f.target);
      const passage=THREE.MathUtils.smoothstep(nearby,clearance+.12,clearance+1.05);
      const desiredSpeed=THREE.MathUtils.lerp(feeding?.55:attractor?.active&&!roaming?.4:.22,1,passage);
      f.foliageSpeed+=(desiredSpeed-f.foliageSpeed)*(1-Math.exp(-dt*(desiredSpeed<f.foliageSpeed?5:1.8)));
      const speed=cruisingSpeed(f)*f.foliageSpeed;
      if(roaming){
        f.wanderWait-=dt;if(f.wanderWait<=0||p.distanceToSquared(f.wander)<.5*.5)pickWander(f);
        candidate.subVectors(f.wander,p).multiplyScalar(1.2).clampLength(0,speed);
        force.addScaledVector(candidate,2.5).addScaledVector(v,-2.5);
        if(v.lengthSq()>.001)f.face.lerp(candidate.copy(v).normalize(),Math.min(1,dt*4)).normalize();
      }else if(attractor?.active){
        // Follow the local tangent instead of chasing a clock-driven slot.
        // Slowing for a leaf no longer leaves a target on the far side of the
        // sculpture and pulls the fish back through an obstructed shortcut.
        const dx=p.x-attractor.center.x,dz=p.z-attractor.center.z;
        const distance=Math.hypot(dx,dz),angle=distance>.001?Math.atan2(dz,dx):f.phase;
        const radialX=Math.cos(angle),radialZ=Math.sin(angle);
        orbitTangent.set(-radialZ,0,radialX);
        const radius=attractor.orbitRadius+.65+.48*f.size+(i%7)*.13;
        const ty=Math.max(floorAt(p,.7),attractor.center.y+attractor.halfHeight*(.15+.65*(i*37%101)/101)+Math.sin(elapsed*.22+f.phase)*.12);
        const radialSpeed=THREE.MathUtils.clamp((radius-distance)*.85,-speed*.6,speed*.6);
        candidate.copy(orbitTangent).multiplyScalar(speed*.85);
        candidate.x+=radialX*radialSpeed;candidate.z+=radialZ*radialSpeed;
        candidate.y=THREE.MathUtils.clamp((ty-p.y)*1.2,-speed*.65,speed*.65);
        candidate.clampLength(0,speed);
        if(f.detourTime>0){
          f.detourTime=Math.max(0,f.detourTime-dt);
          if(p.distanceToSquared(f.wander)<.4*.4)f.detourTime=0;
          else candidate.subVectors(f.wander,p).clampLength(0,speed);
        }
        // Preserve full separation while easing only the flock's cohesion.
        force.addScaledVector(candidate,3.5).addScaledVector(v,-3.5);
        if(candidate.lengthSq()>.001)f.face.lerp(candidate.normalize(),Math.min(1,dt*4)).normalize();
      }else if(feeding&&kelp.getBladeTarget(f.target,target)){
        const distance=p.distanceTo(target),approach=Math.min(speed,distance*2.3);
        candidate.copy(target).sub(p).normalize();f.face.lerp(candidate,Math.min(1,dt*7)).normalize();
        force.addScaledVector(candidate,approach*3.4).addScaledVector(v,-3.4);
        // Test the mouth against the swaying blade tip before removing tissue.
        mouth.copy(p).addScaledVector(f.face,.23*f.size);
        if(mouth.distanceToSquared(target)<.22*.22&&distance<.55&&f.biteWait<=0){
          const removed=kelp.bite(f.target,.055+settings.feeding*.19);
          if(removed){biteCount++;f.bites++;emit(target);}
          f.biteWait=.55+random()*.25;
          if(f.bites>=5||!kelp.getBladeHealth(f.target))release(f);
        }
      }else{
        // Soft moving slots form an elongated shoal rather than attracting
        // every fish to the same point. The last few occupy a trailing ribbon.
        const u=(i+.5)/settings.count,angle=i*2.39996,trail=u>.88;
        const along=trail?-2.4-(u-.88)*13:(u/.88-.5)*4.2;
        const envelope=trail?.3:Math.sqrt(Math.max(.05,1-Math.pow(along/2.5,2)));
        const radius=envelope*(.35+.65*((i*37%101)/101));
        const dx=schoolHeading.x,dz=schoolHeading.z;
        const lateral=Math.sin(angle)*radius*(scout?1.5:.85);
        const tx=goalX+along*dx-lateral*dz;
        const ty=goalY+Math.cos(angle)*radius*(scout?1.2:.65)+Math.sin(elapsed*.4+along)*.08;
        const tz=goalZ+along*dz+lateral*dx;
        candidate.set((tx-p.x)*1.1+Math.cos(elapsed*.13)*.143,(ty-p.y)*1.1+height*.0204*Math.cos(elapsed*.17),(tz-p.z)*1.1-Math.sin(elapsed*.13)*.078).clampLength(0,speed);
        force.addScaledVector(candidate,1.7).addScaledVector(v,-1.7);
        // Slot corrections can briefly reverse velocity. Keep cruising fish
        // aligned with the shoal's travel direction while they settle back in.
        candidate.copy(v).normalize().multiplyScalar(scout?.22:.12).add(schoolHeading).normalize();
        f.face.lerp(candidate,Math.min(1,dt*4)).normalize();
      }
      // Look along the intended route as well as the current velocity. Slide
      // along the leaf edge rather than reversing sharply away from it.
      kelpTangent.copy(f.face).multiplyScalar(Math.max(.4,v.length()*.9));
      shapeProbe.copy(p).add(kelpTangent);
      const kelpSafe=clearance+.42;
      const kelpDistance=avoidance.nearest(shapeProbe,kelpSafe+.35,kelpNormal,f.target);
      if(kelpDistance<kelpSafe){
        const urgency=THREE.MathUtils.clamp((kelpSafe-kelpDistance)/.6,0,1);
        kelpTangent.copy(f.face).addScaledVector(kelpNormal,-f.face.dot(kelpNormal));
        if(kelpTangent.lengthSq()<.04){
          kelpTangent.set(-kelpNormal.z,.35*Math.sin(f.phase),kelpNormal.x);
          if(attractor?.active&&!roaming){if(kelpTangent.dot(orbitTangent)<0)kelpTangent.negate();}
          else if(Math.cos(f.phase)<0)kelpTangent.negate();
        }
        kelpTangent.normalize().multiplyScalar(speed);
        force.lerp(candidate.copy(kelpTangent).sub(v).multiplyScalar(2.8),urgency*.85);
        force.addScaledVector(kelpNormal,urgency*1.5);
      }
      if(attractor?.active){
        shapeProbe.copy(p).addScaledVector(v,.55);
        const distance=attractor.distanceTo(shapeProbe,shapeNormal),safe=.48*f.size+.7;
        if(distance<safe)force.addScaledVector(shapeNormal,(safe-distance)*7);
      }
      const edge=roaming?9:7;
      if(Math.abs(p.x)>edge)force.x-=Math.sign(p.x)*(Math.abs(p.x)-edge)*3;
      if(Math.abs(p.z)>edge)force.z-=Math.sign(p.z)*(Math.abs(p.z)-edge)*3;
      if(p.y<floorAt(p,.7))force.y+=(floorAt(p,.7)-p.y)*5;
      if(p.y>floorY+height+.5)force.y-=(p.y-floorY-height-.5)*5;
      force.clampLength(0,4.5*settings.speed);
    }
    // Integrate together so each boid sees the same neighbour snapshot.
    for(let i=0;i<settings.count;i++){
      const f=fish[i],max=cruisingSpeed(f)*f.foliageSpeed;f.previous.copy(f.p);f.v.addScaledVector(f.force,dt).clampLength(0,max);f.p.addScaledVector(f.v,dt);
      const edge=roaming?10.5:8.5;
      for(const axis of ['x','z'])if(Math.abs(f.p[axis])>edge){f.p[axis]=Math.sign(f.p[axis])*edge;f.v[axis]*=-.5;}
      const bottom=floorAt(f.p);if(f.p.y<bottom){f.p.y=bottom;f.v.y=Math.abs(f.v.y);}
      if(f.p.y>floorY+height+1){f.p.y=floorY+height+1;f.v.y=-Math.abs(f.v.y);}
      keepClear(f);
      if(attractor?.active&&!roaming){
        f.orbitTime+=dt;
        if(f.orbitTime>=2.5){
          const expected=cruisingSpeed(f)*Math.max(.4,f.foliageSpeed)*2.5;
          if(!f.detourTime&&f.p.distanceTo(f.orbitCheck)<Math.max(.04,expected*.25))pickOrbitDetour(f,.48*f.size+.08);
          f.orbitCheck.copy(f.p);f.orbitTime=0;
        }
      }
      if((attractor?.active||f.foliageSpeed<.9)&&f.target<0&&f.v.lengthSq()>.002){
        candidate.copy(f.v).normalize();f.face.lerp(candidate,1-Math.exp(-dt*3)).normalize();
      }
    }
    const water=kelp.settings,a=water.direction*Math.PI/180;
    activeDebris=0;
    for(const d of debris){
      if(d.age>=5)continue;d.age+=dt;activeDebris++;
      d.v.x+=(Math.cos(a)*water.current*.13-d.v.x)*dt;d.v.z+=(Math.sin(a)*water.current*.13-d.v.z)*dt;d.v.y+=(-.16-d.v.y)*dt*.7;
      d.p.addScaledVector(d.v,dt);d.p.y=Math.max(floorAt(d.p,.02),d.p.y);
    }
  }
  function updateMeshes(alpha=1){
    time.value=Math.max(0,elapsed-step+alpha*step);
    for(let i=0;i<settings.count;i++){
      const f=fish[i];facing.lerpVectors(f.previousFace,f.face,alpha).normalize();side.set(-facing.z,0,facing.x).normalize();if(side.lengthSq()<.001)side.set(0,0,1);up.crossVectors(side,facing).normalize();
      basis.makeBasis(facing,up,side);dummy.quaternion.setFromRotationMatrix(basis);dummy.position.lerpVectors(f.previous,f.p,alpha);
      // Interpolation around a corner must preserve clearance too.
      clearPoint(dummy.position,.48*f.size+.08,f.target);
      dummy.scale.setScalar(f.size);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate=true;fragments.visible=activeDebris>0;
    if(fragments.visible){
      for(let i=0;i<fragmentCapacity;i++){
        const d=debris[i];dummy.position.copy(d.p);dummy.rotation.set(d.spin+d.age,d.spin*.7,d.age*.4);dummy.scale.setScalar(d.age<5?(1-d.age/5)*1.4:0);dummy.updateMatrix();fragments.setMatrixAt(i,dummy.matrix);
      }
      fragments.instanceMatrix.needsUpdate=true;
    }
  }
  return {group,reset,setSettings,setAttractor,setRoaming,setFloorHeight(sample){terrainHeight=typeof sample==='function'?sample:null;avoidance.update();for(let i=0;i<settings.count;i++)keepClear(fish[i],true);updateMeshes();},get roaming(){return roaming;},get settings(){return {...settings};},get stats(){return {count:settings.count,feeding:fish.slice(0,settings.count).reduce((n,f)=>n+(f.target>=0),0),bites:biteCount,fragments:activeDebris};},
    setVisible(value){group.visible=value;if(value&&version!==kelp.revision)reset();},
    inspectFish(i){const f=i>=0&&i<settings.count?fish[i]:null;return f?{position:f.p.toArray(),velocity:f.v.toArray(),facing:f.face.toArray(),size:f.size,target:f.target,foliageSpeed:f.foliageSpeed,species:fishSpecies[f.kind].id}:null;},
    advance(dt){
      if(!group.visible||!Number.isFinite(dt)||dt<=0)return false;
      if(version!==kelp.revision)reset();
      const moved=avoidance.update();if(moved)for(let i=0;i<settings.count;i++)keepClear(fish[i],true);
      if(!kelp.playing){if(moved)updateMeshes();return moved;}
      if(!settings.count&&!activeDebris)return false;
      accumulator+=Math.min(dt,.1);
      while(accumulator+1e-9>=step){simulate(step);accumulator=Math.max(0,accumulator-step);}
      avoidance.update();
      // Interpolate the fixed simulation steps for smooth display-rate motion.
      updateMeshes(accumulator/step);return true;
    },dispose(){scaleLife.dispose();white.dispose();group.removeFromParent();for(const resource of [mesh,fragments,geometry,material,depth,fragments.geometry,fragments.material])resource.dispose();}
  };
}

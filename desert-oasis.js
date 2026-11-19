import * as THREE from 'three';
import {Reflector} from './vendor/Reflector.js';
import {createPalmTree,defaultPalmSettings,posePalmFrond} from './palm-tree.js';
import {seededRandom} from './plume-lsystem/random.js';
import {oasisCenter as center,oasisRadii as radii,oasisOutline,oasisWaterRadius,oasisOutlineGLSL} from './oasis-shape.js';
import {createDesertGroundcover} from './desert-groundcover.js';

export {oasisOutline,oasisWaterRadius};

// Water occupies the low, flat valley floor. Sand rises gradually from its
// edge into asymmetric dune ridges, then blends back into the distant desert.
export function oasisTerrainHeight(x,z,floorY=-1.75){
  const dx=x-center.x,dz=z-center.y,radius=oasisWaterRadius(x,z);
  const gaussian=value=>Math.exp(-value*value);
  const left=2.6*gaussian((dx+10+dz*.2)/5.5)*gaussian(dz/22);
  const right=1.8*gaussian((dx-12+dz*.3)/6.5)*gaussian((dz-2)/24);
  const rear=.45*gaussian((dz+11+Math.sin(dx*.18)*1.8)/5.5)*gaussian(dx/24);
  // The open bank has the main crest, with a steeper slope facing the pool
  // and a longer windward slope extending into the foreground desert.
  const crest=dz-7.5-Math.sin(dx*.23)*1.35;
  const opposite=4.2*gaussian(crest/(crest<0?2.8:5.2))*gaussian((dx+2)/10);
  const basin=.7*THREE.MathUtils.smoothstep(radius,1,3.5);
  const ridges=(left+right+rear+opposite)*THREE.MathUtils.smoothstep(radius,1.3,3.8);
  const ripples=.07*(.5+.5*Math.sin(dx*.7+dz*.23+Math.sin(dz*.3)))*THREE.MathUtils.smoothstep(radius,1.6,3);
  const edge=Math.max(Math.abs(dx),Math.abs(dz))/40,fade=1-THREE.MathUtils.smoothstep(edge,.72,1);
  const bankDetail=.025*Math.sin(dx*5)*Math.sin(dz*4)*gaussian(dx/6)*gaussian((dz+4)/2.5)*THREE.MathUtils.smoothstep(radius,1.1,1.4);
  return floorY+.002+Math.max(0,basin+ridges+ripples+bankDetail)*fade;
}

function shorelineGeometry(floorY){
  const positions=[],colors=[],indices=[],segments=160,rows=8;
  const wet=new THREE.Color(0x827556),dry=new THREE.Color(0xcab28d),color=new THREE.Color();
  for(let row=0;row<=rows;row++)for(let i=0;i<=segments;i++){
    const t=row/rows,angle=i/segments*Math.PI*2,radius=oasisOutline(angle)*(1+t*.15);
    const x=center.x+Math.cos(angle)*radii.x*radius,z=center.y+Math.sin(angle)*radii.y*radius;
    positions.push(x,oasisTerrainHeight(x,z,floorY)+.022*(1-t)+Math.sin(t*Math.PI)*.012,z);
    const wetness=(.3+.7*Math.pow(.5+.5*Math.sin(angle*3+.7),2))*Math.exp(-t*4);
    color.copy(dry).lerp(wet,wetness);colors.push(color.r,color.g,color.b,1-THREE.MathUtils.smoothstep(t,.6,1));
    if(row<rows&&i<segments){const a=row*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

const waterShader={name:'Oasis turquoise water',uniforms:{
  ...THREE.UniformsLib.fog,...THREE.UniformsLib.lights,color:{value:new THREE.Color(0x258e88)},tDiffuse:{value:null},textureMatrix:{value:new THREE.Matrix4()},
  uTime:{value:0},uDeep:{value:new THREE.Color(0x238f90)},uShallow:{value:new THREE.Color(0x86bcaa)},uSand:{value:new THREE.Color(0xcabb8c)},uSunDirection:{value:new THREE.Vector3(-3.5,6,4.5).normalize()}
},vertexShader:`
  uniform mat4 textureMatrix;
  varying vec4 vReflection;
  varying vec3 vWorld;
  varying vec2 vPool;
  #include <common>
  #include <fog_pars_vertex>
  #include <shadowmap_pars_vertex>
  void main(){
    vReflection=textureMatrix*vec4(position,1.0);vPool=vec2(position.x/4.7,-position.y/2.8);
    vec4 worldPosition=modelMatrix*vec4(position,1.0);vWorld=worldPosition.xyz;
    vec3 transformedNormal=normalMatrix*normal;
    vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
    #include <shadowmap_vertex>
  }`,fragmentShader:`
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform vec3 uDeep,uShallow,uSand,uSunDirection;
  varying vec4 vReflection;
  varying vec3 vWorld;
  varying vec2 vPool;
  #include <common>
  #include <packing>
  #include <fog_pars_fragment>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  ${oasisOutlineGLSL}
  void main(){
    float angle=atan(vPool.y,vPool.x);
    float boundary=oasisOutline(angle);
    float shore=1.0-length(vPool)/boundary;
    float depth=smoothstep(.03,.9,shore)*.62;
    vec2 waves=vec2(sin(vWorld.x*9.0+vWorld.z*5.0+uTime*.8),cos(vWorld.z*12.0-vWorld.x*4.0+uTime*.65));
    vec2 uv=vReflection.xy/vReflection.w+waves*.0009;
    vec3 reflected=texture2D(tDiffuse,clamp(uv,vec2(.001),vec2(.999))).rgb;
    vec3 view=normalize(cameraPosition-vWorld),normal=normalize(vec3(waves.x*.025,1.0,waves.y*.025));
    float fresnel=pow(1.0-max(dot(view,normal),0.0),3.0);
    float sandGrain=sin(vWorld.x*73.0+sin(vWorld.z*57.0))*sin(vWorld.z*89.0+vWorld.x*23.0);
    float sandRidges=sin(vWorld.x*18.0+vWorld.z*6.0+sin(vWorld.z*3.0));
    vec3 bed=uSand*(.94+sandGrain*.035+sandRidges*.025);
    vec3 water=mix(bed,mix(uShallow,uDeep,depth),smoothstep(.0,.55,shore)*.84);
    float caustic=pow(.5+.5*sin(vWorld.x*15.0+sin(vWorld.z*11.0+uTime*.5)),8.0);
    water+=vec3(.035,.055,.04)*caustic*(1.0-depth);
    water*=mix(.38,1.0,getShadowMask());
    water=mix(water,reflected,(.08+fresnel*.2)*smoothstep(.02,.24,shore));
    vec3 sun=normalize(uSunDirection);
    float sparkle=pow(max(dot(reflect(-sun,normal),view),0.0),150.0);
    water+=vec3(.8,.7,.45)*sparkle*.55;
    gl_FragColor=vec4(water,smoothstep(.0,.055,shore));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`};

export function createDesertOasis({scene,floorY=-1.75,reducedMotion=false,primaryPalm=null}){
  const group=new THREE.Group();group.name='Palm oasis';group.visible=false;scene.add(group);
  const shape=new THREE.Shape();
  for(let i=0;i<=160;i++){
    const angle=i/160*Math.PI*2,radius=oasisOutline(angle),x=Math.cos(angle)*radii.x*radius,y=-Math.sin(angle)*radii.y*radius;
    if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);
  }
  const water=new Reflector(new THREE.ShapeGeometry(shape),{shader:waterShader,textureWidth:512,textureHeight:512,multisample:0,clipBias:.003});
  water.name='Oasis water';water.rotation.x=-Math.PI/2;water.position.set(center.x,floorY+.02,center.y);
  water.material.transparent=true;water.material.fog=true;water.material.lights=true;water.receiveShadow=true;water.renderOrder=2;group.add(water);
  const shoreMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,transparent:true,depthWrite:false});
  const shore=new THREE.Mesh(shorelineGeometry(floorY),shoreMaterial);shore.name='Oasis sandy shoreline';shore.receiveShadow=true;group.add(shore);
  shore.renderOrder=1;
  const terrainGeometry=new THREE.PlaneGeometry(80,80,192,192);terrainGeometry.rotateX(-Math.PI/2);
  const p=terrainGeometry.attributes.position,uv=terrainGeometry.attributes.uv;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i)+center.x,z=p.getZ(i)+center.y;
    p.setXYZ(i,x,oasisTerrainHeight(x,z,floorY),z);uv.setXY(i,.5+x/3200,.5-z/3200);
  }
  terrainGeometry.computeVertexNormals();const terrain=new THREE.Mesh(terrainGeometry,shoreMaterial);terrain.name='Oasis sand drifts';terrain.receiveShadow=true;group.add(terrain);
  const groundcover=createDesertGroundcover({heightAt:(x,z)=>oasisTerrainHeight(x,z,floorY)});group.add(groundcover.group);
  const library=new THREE.Group(),templates=Array.from({length:3},()=>createPalmTree({scene:library,floorY:0,growFronds:!reducedMotion}));
  const youngTemplates=Array.from({length:2},()=>createPalmTree({scene:library,floorY:0,growFronds:!reducedMotion}));
  const grove=new THREE.Group();grove.name='Oasis palm grove';group.add(grove);
  const understory=new THREE.Group();understory.name='Young oasis palms';group.add(understory);
  const growingGrove=new THREE.Group();growingGrove.name='Growing oasis palms';growingGrove.visible=false;group.add(growingGrove);
  const bankPalms=[],growingTrees=[];
  let groveProgress=null;
  // Three loose family clumps occupy the low bank. Trunk height describes
  // age; diameter stays substantial even on the shorter palms.
  const roots=[[-6.1,-.4,0],[-4.9,-.15,0],[-5.3,-1.9,1],[-3.4,-.45,0],[-2.3,-1.4,1],[-3.8,-2.05,2],[.05,-.35,2],[2.15,.9,1]];
  const youngSites=[{parent:1,offset:[-.58,.25]},{parent:1,offset:[.28,.54]},{parent:1,offset:[.56,-.22]},
    {parent:null,offset:[-.6,.35]},{parent:null,offset:[.4,.45]},{parent:7,offset:[-.45,-.05]},{parent:7,offset:[.25,.6]}];
  let settings={...defaultPalmSettings},signature='',clock=0,fronds=[],growingFronds=[],reflectionDirty=true,reflectionTime=-1,reflectionRenders=0,primaryY=null;
  const reflectionWorld=new THREE.Matrix4(),reflectionProjection=new THREE.Matrix4(),renderReflection=water.onBeforeRender;
  water.getRenderTarget().isPlanarReflection=true;
  water.onBeforeRender=function(renderer,scene,camera){
    const target=renderer.getRenderTarget();
    if(target?.isPlanarReflection||target?.isWebGLCubeRenderTarget)return;
    if(reflectionDirty||!reflectionWorld.equals(camera.matrixWorld)||!reflectionProjection.equals(camera.projectionMatrix)||clock-reflectionTime>=.05){
      renderReflection.call(water,renderer,scene,camera);reflectionWorld.copy(camera.matrixWorld);reflectionProjection.copy(camera.projectionMatrix);
      reflectionDirty=false;reflectionTime=clock;reflectionRenders++;
    }
  };
  function clearGrove(){
    for(const layer of [grove,understory]){layer.traverse(object=>{if(object.isInstancedMesh)object.dispose();});layer.clear();}fronds=[];growingFronds=[];
    for(const tree of growingTrees)tree.dispose();
    growingTrees.length=0;bankPalms.length=0;
  }
  function setGroveGrowth(progress){
    if(progress===groveProgress&&(progress===null||growingTrees.length))return;
    if((progress===null)!==(groveProgress===null))reflectionDirty=true;
    groveProgress=progress;
    const growing=progress!==null;
    grove.visible=understory.visible=!growing;
    growingGrove.visible=growing;
    if(!growing)return;
    if(!growingTrees.length){
      for(const {specimen,profile} of bankPalms){
        const tree=createPalmTree({scene:growingGrove,floorY:0,showDevelopment:true});
        tree.rebuild({...profile,wind:settings.wind});
        tree.group.position.copy(specimen.position);
        tree.group.quaternion.copy(specimen.quaternion);
        tree.group.scale.copy(specimen.scale);
        tree.group.visible=true;
        growingTrees.push(tree);
      }
    }
    for(const [i,tree] of growingTrees.entries()){
      const stagger=(i*7%11)/10;
      const start=.39+.18*stagger;
      const age=THREE.MathUtils.lerp(start,1,THREE.MathUtils.clamp(progress/(.88+.12*stagger),0,1));
      tree.seekDevelopment(age);
    }
  }
  function rebuild(values={}){
    settings={...settings,...values};const key=JSON.stringify({...settings,wind:0});
    if(key===signature)return;signature=key;clearGrove();reflectionDirty=true;
    const random=seededRandom(settings.seed+881);
    templates.forEach((tree,i)=>tree.rebuild({...settings,trunkHeight:settings.trunkHeight*[.65,1,1.23][i],trunkRadius:settings.trunkRadius*[1.05,1,1.08][i],length:settings.length*[.8,.92,1][i],fronds:Math.max(12,Math.round(settings.fronds*.85)),density:settings.density*.9,curve:.25+random()*.65,seed:settings.seed+i*157+83}));
    roots.forEach(([anchorX,anchorZ,variant],i)=>{
      const x=anchorX+(random()-.5)*.24,z=anchorZ+(random()-.5)*.24;
      const tree=templates[variant].group.clone(true),scale=.88+random()*.16,angle=random()*Math.PI*2;
      tree.name='Oasis palm '+(i+1);tree.visible=true;tree.scale.setScalar(scale);tree.rotation.y=angle;
      // Palm geometry starts at x=-.55; compensate so the actual root sits on its bank.
      const y=oasisTerrainHeight(x,z,floorY);
      tree.position.set(x+.55*scale*Math.cos(angle),y,z-.55*scale*Math.sin(angle));tree.userData.root=[x,y,z];
      tree.traverse(object=>{
        if(object.userData.layer)fronds.push({group:object,phase:random()*Math.PI*2});
        if(object.userData.palmGrowth)growingFronds.push({group:object,offset:i*3.7});
      });
      grove.add(tree);
      bankPalms.push({specimen:tree,profile:templates[variant].settings});
    });
    youngTemplates.forEach((tree,i)=>tree.rebuild({...settings,trunkHeight:[.38,.58][i],trunkRadius:settings.trunkRadius*[.92,.98][i],fronds:14,density:Math.max(.25,settings.density*.7),length:settings.length*[.55,.65][i],curve:.18,droop:.65,dryFraction:0,seed:settings.seed+i*223+1481}));
    const youngRandom=seededRandom(settings.seed+1984);
    youngSites.forEach(({parent,offset},i)=>{
      const parentRoot=parent===null?[-.55,oasisTerrainHeight(-.55,0,floorY),0]:grove.children[parent].userData.root;
      let x=parentRoot[0]+offset[0]+(youngRandom()-.5)*.16,z=parentRoot[2]+offset[1]+(youngRandom()-.5)*.16;
      const radius=oasisWaterRadius(x,z);if(radius<1.1){x=center.x+(x-center.x)*1.1/radius;z=center.y+(z-center.y)*1.1/radius;}
      const tree=youngTemplates[i%youngTemplates.length].group.clone(true),scale=.8+youngRandom()*.24,angle=youngRandom()*Math.PI*2;
      tree.name='Young oasis palm '+(i+1);tree.visible=true;tree.scale.setScalar(scale);tree.rotation.y=angle;
      const y=oasisTerrainHeight(x,z,floorY);
      tree.position.set(x+.55*scale*Math.cos(angle),y,z-.55*scale*Math.sin(angle));tree.userData.root=[x,y,z];tree.userData.parentRoot=[...parentRoot];
      tree.traverse(object=>{
        if(object.userData.layer)fronds.push({group:object,phase:youngRandom()*Math.PI*2});
        if(object.userData.palmGrowth)growingFronds.push({group:object,offset:i*5.1});
      });
      understory.add(tree);
      bankPalms.push({specimen:tree,profile:youngTemplates[i%youngTemplates.length].settings});
    });
    if(groveProgress!==null)setGroveGrowth(groveProgress);
    groundcover.rebuild(settings.seed,[...grove.children,...understory.children].map(tree=>tree.userData.root));
    group.updateMatrixWorld(true);
  }
  function groundPrimary(enabled){
    if(!primaryPalm)return;
    if(enabled){if(primaryY===null)primaryY=primaryPalm.group.position.y;primaryPalm.group.position.y=primaryY+oasisTerrainHeight(-.55,0,floorY)-floorY;}
    else if(primaryY!==null){primaryPalm.group.position.y=primaryY;primaryY=null;}
  }
  return {group,water,grove,understory,groundcover,rebuild,setGroveGrowth,
    get stats(){return {palms:grove.children.length+1+understory.children.length,maturePalms:grove.children.length+1,youngPalms:understory.children.length,reflectionRenders};},
    setEnabled(value,sandMaterial){
      if(group.visible!==!!value)reflectionDirty=true;group.visible=!!value;
      groundPrimary(!!value);
      if(value){terrain.material=sandMaterial;if(!grove.children.length)rebuild(settings);}
    },
    invalidateReflection(){reflectionDirty=true;},
    setSunDirection(value){water.material.uniforms.uSunDirection.value.copy(value).normalize();reflectionDirty=true;},
    setWind(value){settings.wind=value;reflectionDirty=true;for(const tree of growingTrees)tree.setWind(value);if(value===0)for(const frond of fronds)frond.group.rotation.set(0,0,0);},
    advance(dt){
      if(!group.visible||reducedMotion||!(dt>0))return false;clock+=Math.min(dt,.05);water.material.uniforms.uTime.value=clock;
      if(groveProgress!==null){
        for(const tree of growingTrees)tree.advance(dt);
        return true;
      }
      for(const {group,offset} of growingFronds)posePalmFrond(group,clock+offset);
      if(settings.wind>0)for(const frond of fronds){frond.group.rotation.z=Math.sin(clock*.8+frond.phase)*settings.wind*.055;frond.group.rotation.x=Math.cos(clock*.65+frond.phase)*settings.wind*.035;}
      return true;
    },
    dispose(){groundPrimary(false);clearGrove();[...templates,...youngTemplates].forEach(tree=>tree.dispose());groundcover.dispose();water.dispose();water.geometry.dispose();shore.geometry.dispose();shoreMaterial.dispose();terrainGeometry.dispose();group.removeFromParent();}
  };
}

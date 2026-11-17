import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';

export const fernLifeStages=Object.freeze([
  {title:'Mature fern',phase:'Sporophyte · 2n',text:'The familiar leafy fern is the spore-producing generation. Mature fertile fronds carry clusters of spore cases on their undersides.',scale:'Plant view'},
  {title:'Sori & spore cases',phase:'Meiosis · 2n → n',text:'Each brown cluster, called a sorus, contains many sporangia. Inside these cases, meiosis produces haploid spores. The cases open to release them.',scale:'Enlarged underside of a leaflet'},
  {title:'Spore dispersal',phase:'Spores · n',text:'Tiny spores travel on air currents. A spore that lands in a suitable moist place can germinate and begin the next generation.',scale:'Spores enlarged for visibility'},
  {title:'Germination',phase:'Growing gametophyte · n',text:'The spore divides by mitosis, producing a short green filament. It develops into a small gametophyte, anchored by hairlike rhizoids.',scale:'Microscopic stage enlarged'},
  {title:'Heart-shaped gametophyte',phase:'Gametophyte · n',text:'The tiny green prothallus is a separate plant, usually only millimeters across. It produces eggs in archegonia and sperm in antheridia on its underside.',scale:'Magnified underside · rhizoids below'},
  {title:'Fertilization',phase:'Fertilization · n + n → 2n',text:'A film of water lets sperm swim to an egg in an archegonium. Their nuclei unite to form a diploid zygote, which develops into an embryo.',scale:'Magnified schematic · blue indicates water'},
  {title:'Young fern',phase:'New sporophyte · 2n',text:'The young sporophyte grows from the gametophyte, forming roots and unfurling fronds. It becomes independent and matures into a fern that produces spores again.',scale:'Young plant enlarged · returns to mature fern'}
]);

export function createFernLifeCycle({scene,fern,floorY=-1.75}){
  const group=new THREE.Group();group.name='Fern life cycle';group.position.y=floorY+.04;group.visible=false;scene.add(group);
  const green=new THREE.MeshStandardMaterial({color:0x75965c,roughness:.9,side:THREE.DoubleSide});
  const brown=new THREE.MeshStandardMaterial({color:0xa96d34,roughness:.95});
  const pale=new THREE.MeshStandardMaterial({color:0xd8cb8b,roughness:.8});
  const water=new THREE.MeshStandardMaterial({color:0x528a9b,transparent:true,opacity:.28,roughness:.3,depthWrite:false,side:THREE.DoubleSide});
  const eggMaterial=new THREE.MeshStandardMaterial({color:0xe5bb67,roughness:.7});
  let active=false,playing=false,progress=0,stage=0;
  const views=[],sperm=[],spores=[];
  const sphere=new THREE.SphereGeometry(1,10,7);
  function ball(parent,name,x,y,z,r,material){const mesh=new THREE.Mesh(sphere,material);mesh.name=name;mesh.position.set(x,y,z);mesh.scale.setScalar(r);parent.add(mesh);return mesh;}
  function tube(parent,name,points,r,material){const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),32,r,5,false),material);mesh.name=name;parent.add(mesh);return mesh;}
  function leaf(parent,name,outline,material=green){const shape=new THREE.Shape();outline.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),material);mesh.name=name;mesh.rotation.x=-Math.PI/2;mesh.position.y=.1;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  for(let i=0;i<7;i++){const view=new THREE.Group();view.name=fernLifeStages[i].title;view.visible=false;group.add(view);views.push(view);}
  const leaflet=leaf(views[1],'Fertile leaflet',[[-.03,-.95],[-.32,-.65],[-.43,-.3],[-.4,.18],[-.23,.65],[0,1.05],[.23,.65],[.4,.18],[.43,-.3],[.32,-.65]]);
  leaflet.rotation.x=0;leaflet.position.y=1.1;
  for(let i=0;i<6;i++)for(const sign of [-1,1]){
    const y=.45+i*.22,x=sign*(.18+.04*Math.sin(i));
    for(let j=0;j<6;j++){const a=j*Math.PI/3;ball(views[1],'Sporangium',x+Math.cos(a)*.04,y+Math.sin(a)*.04,.025,.026,brown);}
  }
  tube(views[1],'Leaflet vein',[new THREE.Vector3(0,.15,.04),new THREE.Vector3(0,1,.04),new THREE.Vector3(0,2.1,.04)],.009,pale);
  const random=seededRandom(4821);
  for(let i=0;i<55;i++){
    const origin=new THREE.Vector3((random()-.5)*.9,.3+random()*1.5,(random()-.5)*.7);
    const mesh=ball(views[2],'Airborne spore',origin.x,origin.y,origin.z,.018+random()*.014,brown);spores.push({mesh,origin,phase:random()*6.28});
  }
  ball(views[3],'Germinating spore',-.55,.09,0,.095,brown);
  tube(views[3],'Green filament',Array.from({length:12},(_,i)=>new THREE.Vector3(-.5+i*.09,.1+i*.035,Math.sin(i*.5)*.04)),.037,green);
  for(let i=0;i<7;i++)ball(views[3],'Dividing filament cell',-.45+i*.13,.12+i*.05,0,.046,green);
  function prothallus(parent){
    // Heart-shaped underside, tilted toward the viewer to expose the sex organs.
    const outline=[];
    for(let i=0;i<=80;i++){const t=i/80*Math.PI*2;outline.push([16*Math.pow(Math.sin(t),3)/22,(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/22]);}
    const heart=leaf(parent,'Prothallus',outline);heart.rotation.x=-.65;heart.position.y=.7;
    for(let i=0;i<15;i++){const x=(random()-.5)*.45; tube(parent,'Rhizoid',[new THREE.Vector3(x,.5,.15),new THREE.Vector3(x*.9,.18,.3),new THREE.Vector3(x+(random()-.5)*.2,.02,.45+random()*.1)],.005,brown);}
    for(let i=0;i<5;i++)ball(parent,'Antheridium',-.25+i*.12,.49,.18,.034,brown);
    ball(parent,'Archegonium',0,.94,-.1,.06,green);
    ball(parent,'Egg',0,.94,-.05,.033,eggMaterial);
    return heart;
  }
  prothallus(views[4]);prothallus(views[5]);
  const film=leaf(views[5],'Water film',[[-1,-.8],[1,-.8],[1,.8],[-1,.8]],water);film.position.y=.03;
  for(let i=0;i<7;i++){
    const swimmer=new THREE.Group();swimmer.name='Swimming sperm';ball(swimmer,'Sperm cell',0,0,0,.018,pale);
    tube(swimmer,'Flagellum',[new THREE.Vector3(0,0,0),new THREE.Vector3(-.035,-.015,0),new THREE.Vector3(-.065,.015,0),new THREE.Vector3(-.1,0,0)],.003,pale);
    views[5].add(swimmer);sperm.push(swimmer);
  }
  const embryo=ball(views[5],'Zygote',0,.94,-.04,.047,eggMaterial);embryo.visible=false;
  const youngBed=new THREE.Group();youngBed.name='Supporting gametophyte';views[6].add(youngBed);
  prothallus(youngBed);youngBed.scale.setScalar(.2);youngBed.rotation.x=-.5;youngBed.position.z=.12;
  for(let i=0;i<3;i++){
    const angle=i*2.1,points=[];
    for(let j=0;j<=50;j++){
      const t=j/50,a=t<.6?0:(t-.6)/.4*Math.PI*1.75;
      points.push(new THREE.Vector3(Math.cos(angle)*(.05+t*.16+Math.sin(a)*.07),.1+t*.65+Math.cos(a)*.07,Math.sin(angle)*(.05+t*.16+Math.sin(a)*.07)));
    }
    tube(views[6],'Unfurling fiddlehead',points,.018,green);
  }
  function apply(){
    stage=Math.min(6,Math.floor(progress/100));const fraction=(progress%100)/100;
    views.forEach((view,i)=>view.visible=active&&i===stage);
    fern.group.visible=active&&(stage===0||stage===6);
    const scale=stage===6?.2+fraction*.55:1;
    fern.group.scale.setScalar(scale);fern.group.position.y=floorY*(1-scale);
    fern.group.children.forEach((frond,i)=>frond.visible=stage!==6||i<3+Math.floor(fraction*9));
    group.visible=active;
    views[3].scale.setScalar(.35+fraction*.65);
    views[4].scale.setScalar(.7+fraction*.3);
    embryo.visible=stage===5&&fraction>.72;
    for(let i=0;i<sperm.length;i++){
      const t=((fraction+i*.11)%1)/.73,u=Math.min(1,t);
      sperm[i].position.set((-.6+i*.14)*(1-u)+Math.sin(u*15+i)*.04*(1-u),.2+u*.74,.38-u*.43);
      sperm[i].visible=fraction<=.72;
    }
    for(const spore of spores){const t=(fraction+spore.phase/6.28)%1;spore.mesh.position.copy(spore.origin);spore.mesh.position.x+=Math.sin(t*6+spore.phase)*.3;spore.mesh.position.y=.05+(spore.origin.y+.3)*(1-t);}
  }
  return {group,get active(){return active;},get playing(){return playing;},get progress(){return progress;},get stage(){return stage;},
    setActive(value){active=!!value;playing=false;if(active)apply();else{group.visible=false;fern.group.visible=true;fern.group.scale.setScalar(1);fern.group.position.y=0;fern.group.children.forEach(frond=>frond.visible=true);}},
    seek(value){progress=THREE.MathUtils.clamp(Number.isFinite(value)?value:0,0,699);apply();},
    setPlaying(value){playing=active&&!!value;},
    advance(dt){if(!active||!playing||!(dt>0))return false;progress=(progress+Math.min(dt,.1)*100/7)%700;apply();return true;},
    dispose(){group.traverse(node=>{if(node.geometry&&node.geometry!==sphere)node.geometry.dispose();});sphere.dispose();for(const m of [green,brown,pale,water,eggMaterial])m.dispose();group.removeFromParent();}
  };
}

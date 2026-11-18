import * as THREE from 'three';

// A balanced mobile: three independent vertical bearings carry the paddles.
export function createFernKinetic(parent){
  const group=new THREE.Group();group.name='Kinetic wind sculpture';parent.add(group);
  const materials=[];
  function material(color){const value=new THREE.MeshStandardMaterial({color,roughness:.62,metalness:.15});materials.push(value);return value;}
  const black=material(0x202022),wire=material(0x514a40);
  function mesh(geometry,surface,owner=group){const node=new THREE.Mesh(geometry,surface);node.castShadow=true;node.receiveShadow=true;owner.add(node);return node;}
  function plate(shape,depth,surface,owner){const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:18});geometry.translate(0,0,-depth/2);return mesh(geometry,surface,owner);}
  const stand=new THREE.Shape();stand.moveTo(-.09,0);stand.lineTo(.09,0);stand.lineTo(0,.66);stand.closePath();
  plate(stand,.012,black,group);
  const foot=plate(stand,.008,black,group);foot.rotation.y=Math.PI/2;foot.scale.set(.7,.27,1);
  const up=new THREE.Vector3(0,1,0);
  function rod(owner,a,b){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);const node=mesh(new THREE.CylinderGeometry(.0018,.0018,delta.length(),6),wire,owner);node.position.copy(start.add(end).multiplyScalar(.5));node.quaternion.setFromUnitVectors(up,delta.normalize());}
  function pivot(owner,name,x,y,z){const node=new THREE.Group();node.name=name;node.position.set(x,y,z);owner.add(node);const hub=mesh(new THREE.SphereGeometry(.005,8,6),wire,node);hub.scale.y=1.5;return node;}
  function paddle(owner,color,x,y,width,height,angle=0){
    const shape=new THREE.Shape();shape.moveTo(0,0);
    shape.bezierCurveTo(-width*.42,height*.16,-width*.66,height*.65,-width*.3,height*.88);
    shape.bezierCurveTo(width*.2,height*1.13,width*.65,height*.91,width*.48,height*.56);
    shape.bezierCurveTo(width*.32,height*.22,width*.12,0,0,0);
    const node=plate(shape,.003,material(color),owner);node.position.set(x,y,0);node.rotation.z=angle;return node;
  }
  const balance=pivot(group,'Sculpture balance arm',0,.66,0);
  rod(balance,[-.15,-.045,0],[.22,.045,0]);
  paddle(balance,0x171d59,-.15,-.045,.18,.25,1.22);
  const upper=pivot(balance,'Sculpture red bearing',.22,.045,0);
  rod(upper,[0,-.19,0],[0,.13,0]);paddle(upper,0xce1625,0,.13,.085,.19,-.1);
  const lower=pivot(upper,'Sculpture lower balance',0,-.19,0);
  rod(lower,[-.07,-.065,0],[.15,.12,0]);
  paddle(lower,0xeee9db,-.07,-.065,.11,.14,2.8);
  paddle(lower,0xf0ce20,.15,.12,.075,.14,-.8);
  let time=0,heading=0,initialized=false;
  function pose(){balance.rotation.set(.07*Math.sin(time*.7),heading+time*.32,.06*Math.sin(time*.83));upper.rotation.y=-time*.79;lower.rotation.y=time*1.17+.4;lower.rotation.z=.12*Math.sin(time*.91);}
  pose();
  return {group,update(dt,strength,direction){
    const desired=-direction*Math.PI/180;
    if(!initialized){heading=desired;initialized=true;}
    if(dt>0&&strength>0){
      const delta=Math.atan2(Math.sin(desired-heading),Math.cos(desired-heading));
      heading+=delta*(1-Math.exp(-dt*strength*2));time+=dt*strength*2.4;pose();
    }
  },dispose(){group.traverse(node=>node.geometry?.dispose());for(const surface of materials)surface.dispose();group.removeFromParent();}};
}

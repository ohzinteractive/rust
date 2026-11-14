const STEP=1/90;

// Position-based cloth: structural, shear and bending distances preserve the
// sheet while gravity and contact gather the spare fabric into folds.
export function createClothSimulation({columns=48,rows=48,width=7,depth=7,centerX=0,centerZ=0,height=2,floorY=-1.75,collider,pin=null,held=true,radial=false}){
  const spacing=Math.max(width/columns,depth/rows);let contactPadding=.035,damping=.96;
  const count=(columns+1)*(rows+1),positions=new Float32Array(count*3),previous=new Float32Array(count*3),links=[];
  for(let z=0;z<=rows;z++)for(let x=0;x<=columns;x++){
    const i=(z*(columns+1)+x)*3,px=(x/columns-.5)*width,pz=(z/rows-.5)*depth;
    if(radial){
      const t=z/rows,angle=x/columns*Math.PI*2,cos=Math.cos(angle),sin=Math.sin(angle),radius=Math.min(width*.5/Math.max(1e-8,Math.abs(cos)),depth*.5/Math.max(1e-8,Math.abs(sin)))*t;
      const cx=(pin?.x??centerX)*(1-t)+centerX*t,cz=(pin?.z??centerZ)*(1-t)+centerZ*t;
      positions[i]=cx+cos*radius;positions[i+1]=height+.012*Math.sin(angle*9)*t;positions[i+2]=cz+sin*radius;
    }else{positions[i]=centerX+px;positions[i+1]=height+.025*Math.sin(px*13+pz*3);positions[i+2]=centerZ+pz;}
  }
  const pinIndex=pin?Math.max(0,Math.min(rows,Math.round(((pin.z-centerZ)/depth+.5)*rows)))*(columns+1)*3+Math.max(0,Math.min(columns,Math.round(((pin.x-centerX)/width+.5)*columns)))*3:-1;
  function hold(){
    if(!pin||!held)return;
    if(radial){for(let x=0;x<=columns;x++){const i=x*3;positions[i]=previous[i]=pin.x;positions[i+1]=previous[i+1]=pin.y;positions[i+2]=previous[i+2]=pin.z;}}
    else if(pinIndex>=0){positions[pinIndex]=previous[pinIndex]=pin.x;positions[pinIndex+1]=previous[pinIndex+1]=pin.y;positions[pinIndex+2]=previous[pinIndex+2]=pin.z;}
  }
  function closeSeam(){
    if(!radial)return;
    for(let z=0;z<=rows;z++){
      const a=z*(columns+1)*3,b=a+columns*3;
      for(let k=0;k<3;k++){positions[a+k]=positions[b+k]=(positions[a+k]+positions[b+k])*.5;previous[a+k]=previous[b+k]=(previous[a+k]+previous[b+k])*.5;}
    }
  }
  hold();previous.set(positions);
  function link(x,z,dx,dz,stiffness){
    if(x+dx<0||x+dx>columns||z+dz>rows)return;
    const a=(z*(columns+1)+x)*3,b=((z+dz)*(columns+1)+x+dx)*3;
    const rest=radial?Math.hypot(positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]):Math.hypot(dx*width/columns,dz*depth/rows);
    links.push(a,b,rest,stiffness);
  }
  for(let z=0;z<=rows;z++)for(let x=0;x<=columns;x++){
    link(x,z,1,0,1);link(x,z,0,1,1);
    link(x,z,1,1,.55);link(x,z,-1,1,.55);
    link(x,z,2,0,.03);link(x,z,0,2,.03);
  }
  if(radial)for(let z=0;z<=rows;z++)links.push(z*(columns+1)*3,(z*(columns+1)+columns)*3,0,1);
  const constraints=new Float32Array(links);let accumulator=0,time=0,paused=false,breeze=.12;
  const probe=new Float64Array(3);let ties=null;
  function faceContact(a,b,c){
    probe[0]=(positions[a]+positions[b]+positions[c])/3;
    probe[1]=(positions[a+1]+positions[b+1]+positions[c+1])/3;
    probe[2]=(positions[a+2]+positions[b+2]+positions[c+2])/3;
    const x=probe[0],y=probe[1],z=probe[2];
    const slope=probe[1]>(ties?.ceiling??-Infinity)?(collider?.projectDrape(probe,0,.065)??-1):-1,solid=collider?.project(probe,0,contactPadding)??-1;
    if(slope<0&&solid<0)return;
    let dx=probe[0]-x,dy=probe[1]-y,dz=probe[2]-z;
    const length=Math.hypot(dx,dy,dz),limit=spacing*.04;
    if(length>limit){dx*=limit/length;dy*=limit/length;dz*=limit/length;}
    for(let k=0;k<3;k++){
      const i=k===0?a:k===1?b:c;
      positions[i]+=dx;positions[i+1]+=dy;positions[i+2]+=dz;
      previous[i]+=dx;previous[i+1]+=dy;previous[i+2]+=dz;
    }
  }
  function faceContacts(){
    for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
      const a=(z*(columns+1)+x)*3,b=a+(columns+1)*3,c=b+3,d=a+3;
      faceContact(a,b,d);faceContact(b,c,d);
    }
  }
  function contacts(){
    for(let i=0;i<positions.length;i+=3){
      const x=positions[i],y=positions[i+1],z=positions[i+2];
      const axis=y>(ties?.ceiling??-Infinity)?(collider?.projectDrape(positions,i,.055)??-1):-1,solid=collider?.project(positions,i,contactPadding)??-1;
      if(axis>=0||solid>=0){
        previous[i]+=positions[i]-x;previous[i+1]+=positions[i+1]-y;previous[i+2]+=positions[i+2]-z;
        const n=collider.contactNormal,vx=positions[i]-previous[i],vy=positions[i+1]-previous[i+1],vz=positions[i+2]-previous[i+2],inward=Math.min(0,vx*n[0]+vy*n[1]+vz*n[2]);
        previous[i]+=n[0]*inward+(vx-n[0]*inward)*.12;
        previous[i+1]+=n[1]*inward+(vy-n[1]*inward)*.12;
        previous[i+2]+=n[2]*inward+(vz-n[2]*inward)*.12;
      }
      if(positions[i+1]<floorY+.012){
        positions[i+1]=floorY+.012;previous[i+1]=positions[i+1];
        previous[i]+=(positions[i]-previous[i])*.32;previous[i+2]+=(positions[i+2]-previous[i+2])*.32;
      }
    }
  }
  function step(){
    time+=STEP;ties?.advance(STEP);
    for(let i=0;i<positions.length;i+=3){
      const x=positions[i],y=positions[i+1],z=positions[i+2];
      positions[i]+=(x-previous[i])*damping+Math.sin(time*.9+z*.8)*breeze*STEP*STEP;
      positions[i+1]+=(y-previous[i+1])*damping-9.81*STEP*STEP;
      positions[i+2]+=(z-previous[i+2])*damping+Math.cos(time*.7+x)*breeze*.4*STEP*STEP;
      previous[i]=x;previous[i+1]=y;previous[i+2]=z;
    }
    // Give the sheet time to relax between tie corrections rather than
    // repeatedly pulling the same corners against collision constraints.
    const iterations=ties?.active?16:8;
    for(let iteration=0;iteration<iterations;iteration++){
      // Reverse the solve direction on alternating passes to avoid a bias.
      for(let j=0;j<constraints.length;j+=4){
        const k=iteration%2?constraints.length-4-j:j,a=constraints[k],b=constraints[k+1];
        const dx=positions[b]-positions[a],dy=positions[b+1]-positions[a+1],dz=positions[b+2]-positions[a+2];
        const length=Math.sqrt(dx*dx+dy*dy+dz*dz);if(length<1e-8)continue;
        const correction=(length-constraints[k+2])/length*.5*constraints[k+3];
        positions[a]+=dx*correction;positions[a+1]+=dy*correction;positions[a+2]+=dz*correction;
        positions[b]-=dx*correction;positions[b+1]-=dy*correction;positions[b+2]-=dz*correction;
      }
      if(iteration>=iterations-2)faceContacts();
      contacts();
      if(ties?.active&&iteration%2===1){ties.solve();contacts();}
      hold();
    }
    closeSeam();
    // Imported silhouettes need an extra envelope for narrow limbs missed by
    // coarse samples. Primitive contacts already match their solid geometry.
    for(let i=0;i<positions.length;i+=3){
      const x=positions[i],y=positions[i+1],z=positions[i+2];
      if(radial&&collider?.projectWrap(positions,i,.03,((i/3)%(columns+1))/columns*Math.PI*2)){
        previous[i]+=positions[i]-x;previous[i+1]+=positions[i+1]-y;previous[i+2]+=positions[i+2]-z;
      }
    }
    hold();
  }
  return {positions,columns,rows,get contactPadding(){return contactPadding;},radial,
    setFabric({bend=.03,damping:drag=.96,thickness=.008}={}){
      damping=drag;contactPadding=.035+Math.max(0,thickness-.008)*.5;
      for(let i=0;i<constraints.length;i+=4)if(constraints[i+3]<.5)constraints[i+3]=bend;
    },
    setTies(value){ties=value;},
    get held(){return held;},set held(value){held=!!value;},
    get time(){return time;},get paused(){return paused;},set paused(value){paused=!!value;accumulator=0;},
    set breeze(value){breeze=Math.max(0,Math.min(1,value));},
    advance(dt){
      if(paused||!(dt>0))return false;
      accumulator=Math.min(accumulator+Math.min(dt,.05),STEP*4);let updated=false;
      while(accumulator>=STEP){step();accumulator-=STEP;updated=true;}
      return updated;
    }
  };
}

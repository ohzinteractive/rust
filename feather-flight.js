import * as CANNON from './vendor/cannon-es.js';

const STEP=1/120;
const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,x));
const ease=x=>{x=clamp(x);return x*x*x*(10+x*(-15+x*6));};
function halton(index,base){
  let result=0,fraction=1;
  while(index){fraction/=base;result+=fraction*(index%base);index=Math.floor(index/base);}
  return result;
}
function limit(vector,max){const length=vector.length();if(length>max)vector.scale(max/length,vector);}

// Rigid proxies handle airborne contacts. Eased departure and landing allow
// the intentional overlaps in the attached coat without a collision impulse.
export function createFeatherFlight({floorY=-1.75}={}) {
  const world=new CANNON.World({gravity:new CANNON.Vec3(0,0,0)});
  world.broadphase=new CANNON.SAPBroadphase(world);world.broadphase.useBoundingBoxes=true;
  world.solver.iterations=12;
  Object.assign(world.defaultContactMaterial,{friction:.15,restitution:.01,contactEquationStiffness:1e5,contactEquationRelaxation:6});
  const floor=new CANNON.Body({mass:0,shape:new CANNON.Plane()});
  floor.quaternion.setFromEuler(-Math.PI/2,0,0);floor.position.y=floorY;world.addBody(floor);
  const flights=new Map(),wind=new CANNON.Vec3(),goal=new CANNON.Vec3(),offset=new CANNON.Vec3(),approach=new CANNON.Vec3();
  let space={origin:{x:0,y:1,z:9},forward:{x:0,y:0,z:-1},right:{x:1,y:0,z:0},up:{x:0,y:1,z:0},
    xScale:.5,yScale:.4,xOffset:0,yOffset:0,near:3,far:14};
  let time=0,environment=null,motionScale=1;
  let cameraBody=null,cameraScale=.025;
  const cameraTarget=new CANNON.Vec3(),cameraUp=new CANNON.Vec3(0,1,0),cameraAway=new CANNON.Vec3(),cameraRelative=new CANNON.Vec3();

  function clearCamera(){if(cameraBody)world.removeBody(cameraBody);cameraBody=null;}
  function pushFromCamera(f){
    if(!cameraBody||f.returning)return false;
    const b=f.body,unit=cameraScale/.025;
    b.position.vsub(cameraBody.position,cameraAway);
    const height=clamp(cameraAway.dot(cameraUp),-.085*unit,.085*unit);
    cameraUp.scale(height,cameraRelative);cameraAway.vsub(cameraRelative,cameraAway);
    const distance=cameraAway.length(),radius=.026*unit+b.boundingRadius;
    if(distance>=radius)return false;
    if(distance>1e-7)cameraAway.scale(1/distance,cameraAway);
    else{
      cameraAway.copy(cameraBody.velocity);
      if(cameraAway.lengthSquared()<1e-8)cameraAway.set(Math.cos(f.phase),0,Math.sin(f.phase));
      cameraAway.normalize();
    }
    cameraBody.velocity.vsub(b.velocity,cameraRelative);
    const acceleration=Math.min(.9*unit,(radius-distance)*75+Math.max(0,cameraRelative.dot(cameraAway))*6);
    cameraAway.scale(b.mass*acceleration,cameraRelative);b.force.vadd(cameraRelative,b.force);
    return true;
  }

  function airTarget(f){
    if(environment){environment.target(f,time,goal);return;}
    const t=time+f.phase;
    const x=clamp(f.u+Math.sin(t*.23)*.12,-.9,.9),y=clamp(f.v+Math.cos(t*.19)*.12,-.84,.88);
    const depth=space.near+(space.far-space.near)*clamp(f.depth+Math.sin(t*.13)*.08,.03,.97);
    const horizontal=(x+space.xOffset)*space.xScale*depth,vertical=(y+space.yOffset)*space.yScale*depth;
    goal.set(space.origin.x+space.forward.x*depth+space.right.x*horizontal+space.up.x*vertical,
      space.origin.y+space.forward.y*depth+space.right.y*horizontal+space.up.y*vertical,
      space.origin.z+space.forward.z*depth+space.right.z*horizontal+space.up.z*vertical);
    goal.y=Math.max(floorY+f.body.boundingRadius+.12,goal.y);
  }

  world.addEventListener('preStep',()=>{
    time+=STEP;
    let cellSize=.1*motionScale;
    for(const f of flights.values())cellSize=Math.max(cellSize,f.body.boundingRadius*2+.8*motionScale);
    const grid=new Map();
    for(const f of flights.values()){
      const p=f.body.position,v=f.body.velocity;
      f.future=[p.x+v.x*.3,p.y+v.y*.3,p.z+v.z*.3];
      f.cell=f.future.map(x=>Math.floor(x/cellSize));
      const key=f.cell.join(',');if(!grid.has(key))grid.set(key,[]);grid.get(key).push(f);
    }
    for(const f of flights.values()){
      const b=f.body,p=b.position,v=b.velocity;
      f.age+=STEP;
      const departure=ease((f.age-f.delay)/1.6);
      airTarget(f);
      const spread=ease((f.age-f.delay-1)/3.2);
      const releaseDistance=.65*motionScale+b.boundingRadius*.5;
      goal.set((1-spread)*(f.start.x+f.normal.x*releaseDistance*departure)+spread*goal.x,
        (1-spread)*(f.start.y+f.normal.y*releaseDistance*departure)+spread*goal.y,
        (1-spread)*(f.start.z+f.normal.z*releaseDistance*departure)+spread*goal.z);
      if(f.resumeAge!==null){
        f.resumeAge+=STEP;const blend=ease(f.resumeAge/1.5);
        f.resumeStart.lerp(goal,blend,goal);if(blend===1)f.resumeAge=null;
      }
      let stiffness=1.5,damping=2.45;
      if(f.returning)f.returnAge+=STEP;
      const blend=f.returning?ease(f.returnAge/.8):0;
      f.separation=departure;
      if(f.returning){
        const clearance=f.returnClearance;
        approach.set(f.target.x+f.normal.x*clearance,f.target.y+f.normal.y*clearance,f.target.z+f.normal.z*clearance);
        environment?.constrainApproach(f,approach);
        if(!environment&&clearance>.05)approach.y=Math.max(floorY+b.boundingRadius+.02,approach.y);
        if(f.landingAge===null&&p.distanceTo(approach)<.3*motionScale&&v.distanceTo(f.targetVelocity)<.5*motionScale)f.landingAge=0;
        if(f.landingAge!==null)f.landingAge+=STEP;
        const lift=1-ease((f.landingAge??0)/2.2);
        goal.set(goal.x*(1-blend)+(f.target.x+(approach.x-f.target.x)*lift)*blend,
          goal.y*(1-blend)+(f.target.y+(approach.y-f.target.y)*lift)*blend,
          goal.z*(1-blend)+(f.target.z+(approach.z-f.target.z)*lift)*blend);
        stiffness=3.2;damping=3.6;
        f.separation=clamp((p.distanceTo(f.target)-clearance)/(1.2*motionScale));
      }
      const pairContacts=f.returning?f.separation>.3:f.age>f.delay+2.5;
      // The attached coat intentionally overlaps its substrate. Allow only
      // the final, nearby docking motion to restore that original pose.
      const docking=f.returning&&f.landingAge>1&&p.distanceTo(f.target)<b.boundingRadius*1.5;
      b.collisionFilterMask=(environment&&!docking?1:0)|(pairContacts?(environment?2:3):0)|(cameraBody&&!f.returning?4:0);
      b.force.set(b.mass*((goal.x-p.x)*stiffness-(v.x-f.targetVelocity.x*blend)*damping+wind.x*.35*motionScale*(1-blend)*departure),
        b.mass*((goal.y-p.y)*stiffness-(v.y-f.targetVelocity.y*blend)*damping),
        b.mass*((goal.z-p.z)*stiffness-(v.z-f.targetVelocity.z*blend)*damping+wind.z*.35*motionScale*(1-blend)*departure));
      const flutter=departure*(1-blend)*b.mass*.006*motionScale*motionScale;
      b.torque.set(flutter*Math.sin(time*1.3+f.phase),flutter*Math.cos(time*.9+f.phase),flutter*Math.sin(time*1.1+f.phase));
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
        const neighbours=grid.get([f.cell[0]+x,f.cell[1]+y,f.cell[2]+z].join(','));
        if(!neighbours)continue;
        for(const other of neighbours){
          if(other===f)continue;
          let sx=f.future[0]-other.future[0],sy=f.future[1]-other.future[1],sz=f.future[2]-other.future[2];
          let d=Math.hypot(sx,sy,sz);const spacing=(b.boundingRadius+other.body.boundingRadius)*1.05;
          if(d>=spacing)continue;
          const overlap=spacing-d;if(d<1e-6){sx=f.id<other.id?-1:1;sy=0;sz=0;d=1;}
          const push=b.mass*Math.min(2*motionScale,overlap*4)*Math.min(f.separation,other.separation)/d;
          b.force.x+=sx*push;b.force.y+=sy*push;b.force.z+=sz*push;
        }
      }
      limit(b.force,b.mass*2.4*motionScale);
      const cameraContact=pushFromCamera(f);
      limit(v,cameraContact?Math.max(2.2*motionScale,.5*cameraScale/.025):2.2*motionScale);limit(b.angularVelocity,.8);
    }
  });
  world.addEventListener('postStep',()=>{
    for(const f of flights.values()){
      if(!f.returning)continue;
      const blend=ease(f.returnAge/.8);
      f.body.quaternion.slerp(f.targetQuaternion,1-Math.exp(-2.8*STEP*blend),f.body.quaternion);
      f.body.angularVelocity.scale(Math.exp(-5*STEP*blend),f.body.angularVelocity);f.body.aabbNeedsUpdate=true;
      const q=f.body.quaternion,t=f.targetQuaternion;
      f.settled=f.landingAge>2.2&&f.body.position.distanceTo(f.target)<.004*motionScale&&
        f.body.velocity.distanceTo(f.targetVelocity)<.025*motionScale&&1-Math.abs(q.x*t.x+q.y*t.y+q.z*t.z+q.w*t.w)<1e-5;
    }
  });
  return {
    get count(){return flights.size;},
    get returningCount(){let count=0;for(const f of flights.values())if(f.returning)count++;return count;},
    get entries(){return flights.values();},
    get(id){return flights.get(id);},
    setSpace(next){space=next;},
    setCamera(position,up={x:0,y:1,z:0},scale=.025){
      if(!position){clearCamera();return;}
      if(cameraBody&&scale!==cameraScale)clearCamera();
      cameraScale=scale;const unit=scale/.025;
      cameraUp.copy(up);cameraUp.normalize();
      cameraTarget.set(position.x-cameraUp.x*.085*unit,position.y-cameraUp.y*.085*unit,position.z-cameraUp.z*.085*unit);
      if(!cameraBody){
        cameraBody=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC,collisionFilterGroup:4,collisionFilterMask:2,linearDamping:0});
        cameraBody.addShape(new CANNON.Cylinder(.018*unit,.018*unit,.17*unit,8));
        for(const height of [-.085,.085])cameraBody.addShape(new CANNON.Sphere(.018*unit),new CANNON.Vec3(0,height*unit,0));
        cameraBody.position.copy(cameraTarget);world.addBody(cameraBody);
      }
      // Restarts and scene changes relocate the camera without sweeping a
      // collider across unrelated passages. Normal walking transfers momentum.
      if(cameraBody.position.distanceTo(cameraTarget)>.05*unit){cameraBody.position.copy(cameraTarget);cameraBody.velocity.setZero();}
      cameraBody.quaternion.setFromVectors(new CANNON.Vec3(0,1,0),cameraUp);cameraBody.aabbNeedsUpdate=true;
    },
    setEnvironment(next){
      this.clear();
      for(const body of environment?.bodies??[])world.removeBody(body);
      environment=next;motionScale=next?.scale??1;
      floor.collisionFilterMask=next?0:-1;
      for(const body of next?.bodies??[])world.addBody(body);
    },
    launch({id,position,quaternion,center,half,normal}){
      if(flights.has(id)||environment&&!environment.canLaunch(position,normal))return false;
      const body=new CANNON.Body({mass:.015,shape:new CANNON.Box(new CANNON.Vec3(half.x,half.y,half.z)),linearDamping:.15,angularDamping:.8,collisionFilterGroup:2,collisionFilterMask:environment?1:0});
      body.quaternion.copy(quaternion);body.quaternion.vmult(center,offset);
      body.position.set(position.x+offset.x,position.y+offset.y,position.z+offset.z);
      const sequenceX=halton(id+1,2);
      flights.set(id,{id,body,center:new CANNON.Vec3(center.x,center.y,center.z),normal:new CANNON.Vec3(normal.x,normal.y,normal.z),
        start:body.position.clone(),target:body.position.clone(),targetQuaternion:body.quaternion.clone(),targetVelocity:new CANNON.Vec3(),
        phase:id*2.399,u:sequenceX*1.6-.8,v:halton(id+1,3)*1.5-.75,depth:.08+halton(id+1,5)*.84,
        age:0,delay:sequenceX*.5,returning:false,returnAge:0,landingAge:null,resumeAge:null,separation:0,settled:false});
      world.addBody(body);return true;
    },
    setReturnTarget(id,position,quaternion,normal,dt=0){
      const f=flights.get(id);if(!f)return;
      f.targetQuaternion.copy(quaternion);f.targetQuaternion.vmult(f.center,offset);
      offset.x+=position.x;offset.y+=position.y;offset.z+=position.z;
      if(dt>0){offset.vsub(f.target,f.targetVelocity);f.targetVelocity.scale(1/dt,f.targetVelocity);limit(f.targetVelocity,10);}
      else f.targetVelocity.setZero();
      f.target.copy(offset);f.normal.copy(normal);
    },
    returnAll(){
      for(const f of flights.values())if(!f.returning){
        f.returning=true;f.returnAge=0;f.returnClearance=Math.min(f.body.boundingRadius+.6*motionScale,f.body.position.distanceTo(f.target));
        f.landingAge=f.returnClearance<.05*motionScale?0:null;
      }
    },
    resumeAll(){
      let count=0;
      for(const f of flights.values())if(f.returning){f.returning=false;f.settled=false;f.age=f.delay+4.2;f.resumeStart=f.body.position.clone();f.resumeAge=0;count++;}
      return count;
    },
    step(dt,direction,strength){
      if(!flights.size||!(dt>0))return false;
      environment?.sync();
      if(cameraBody){
        cameraTarget.vsub(cameraBody.position,cameraBody.velocity);
        cameraBody.velocity.scale(1/Math.max(STEP,Math.min(dt,.05)),cameraBody.velocity);
        limit(cameraBody.velocity,.5*cameraScale/.025);
      }
      wind.set(direction.x*strength,direction.y*strength,direction.z*strength);
      world.step(STEP,Math.min(dt,.05),6);
      for(const [id,f] of flights)if(f.settled){world.removeBody(f.body);flights.delete(id);}
      return true;
    },
    clear(){for(const f of flights.values())world.removeBody(f.body);flights.clear();clearCamera();world.accumulator=0;time=0;}
  };
}

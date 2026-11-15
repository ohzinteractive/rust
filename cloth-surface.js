import * as THREE from 'three';
import {createClothCollider} from './cloth-collider.js';
import {createClothRopes} from './cloth-rope.js';
import {createClothSimulation} from './cloth-simulation.js';
import {createFabricFinish} from './cloth-fabric.js';

export function createClothSurface({scene,floorY=-1.75,onSettle=()=>{}}){
  const finish=createFabricFinish(),material=finish.front;
  let lining=null,hem=null,hemEdges=[];
  let mesh=null,simulation=null,collider=null,ropes=null,parameters=[],triangles=[];
  function buildDisplayGeometry(values){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(values??new Float32Array(parameters.length/2*3),3).setUsage(THREE.DynamicDrawUsage));
    const uv=new Float32Array(parameters.length);for(let i=0;i<parameters.length;i+=2){uv[i]=parameters[i];uv[i+1]=1-parameters[i+1];}
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(triangles);geometry.userData.adaptive=true;
    mesh.geometry.dispose();mesh.geometry=geometry;
    if(lining)lining.geometry=geometry;
    // Only boundary edges need side walls; interior triangle edges are shared.
    const edges=new Map();
    for(let i=0;i<triangles.length;i+=3)for(let j=0;j<3;j++){
      const a=triangles[i+j],b=triangles[i+(j+1)%3],key=a<b?a+':'+b:b+':'+a;
      if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);
    }
    hemEdges=Array.from(edges.values());
    if(hem){hem.geometry.dispose();const side=new THREE.BufferGeometry();side.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(hemEdges.length*18),3));hem.geometry=side;}
  }
  function initializeDisplay(){
    parameters=[];triangles=[];const fine=simulation.columns*2;
    for(let z=0;z<=fine;z++)for(let x=0;x<=fine;x++){
      parameters.push(x/fine,z/fine);
      if(x<fine&&z<fine){const a=z*(fine+1)+x,b=a+fine+1,c=b+1,d=a+1;if(simulation.radial)triangles.push(a,d,b,b,d,c);else triangles.push(a,b,d,b,c,d);}
    }
    buildDisplayGeometry();
  }
  function evaluate(u,v,target,index){
    const source=simulation.positions,n=simulation.columns,x=u*n,z=v*n,column=Math.min(n-1,Math.floor(x)),row=Math.min(n-1,Math.floor(z)),fx=x-column,fz=z-row;
    const a=(row*(n+1)+column)*3,b=a+3,c=a+(n+1)*3,d=c+3;
    for(let axis=0;axis<3;axis++)target[index+axis]=(source[a+axis]*(1-fx)+source[b+axis]*fx)*(1-fz)+(source[c+axis]*(1-fx)+source[d+axis]*fx)*fz;
    // Preserve the simulated folds; contact correction only moves samples
    // that would otherwise intersect the specimen between simulation nodes.
    collider.project(target,index,.08);collider.projectWrap(target,index,.065);
    if(collider.topCoverage>=.35&&target[index+1]>collider.bounds.max.y-.2)collider.projectRoof(target,index,.065);
    target[index+1]=Math.max(floorY+.012,target[index+1]);
  }
  function refineDisplay(){
    const bounds=collider.bounds,upper=bounds.min.y-.1;let values=mesh.geometry.attributes.position.array,changed=false;
    const key=(a,b)=>a<b?a+':'+b:b+':'+a;
    for(let pass=0;pass<5&&parameters.length/2<28000;pass++){
      const splits=new Map();let work=null;
      function mark(a,b){
        const ai=a*3,bi=b*3;
        if(Math.max(values[ai+1],values[bi+1])<upper||Math.min(values[ai+1],values[bi+1])>bounds.max.y+.15)return;
        if(Math.max(values[ai],values[bi])<bounds.min.x-.15||Math.min(values[ai],values[bi])>bounds.max.x+.15||Math.max(values[ai+2],values[bi+2])<bounds.min.z-.15||Math.min(values[ai+2],values[bi+2])>bounds.max.z+.15)return;
        if((values[ai]-values[bi])**2+(values[ai+1]-values[bi+1])**2+(values[ai+2]-values[bi+2])**2<.08**2)return;
        const edge=key(a,b);if(splits.has(edge))return;if(!work)work=Array.from(values);
        const u=(parameters[a*2]+parameters[b*2])/2,v=(parameters[a*2+1]+parameters[b*2+1])/2,index=parameters.length/2;
        parameters.push(u,v);work.push(0,0,0);evaluate(u,v,work,index*3);splits.set(edge,index);
      }
      for(let i=0;i<triangles.length;i+=3){mark(triangles[i],triangles[i+1]);mark(triangles[i+1],triangles[i+2]);mark(triangles[i+2],triangles[i]);}
      if(!splits.size)break;
      const refined=[];
      for(let i=0;i<triangles.length;i+=3){
        const a=triangles[i],b=triangles[i+1],c=triangles[i+2],ab=splits.get(key(a,b)),bc=splits.get(key(b,c)),ca=splits.get(key(c,a));
        const count=Number(ab!==undefined)+Number(bc!==undefined)+Number(ca!==undefined);
        if(!count)refined.push(a,b,c);
        else if(count===3)refined.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
        else if(count===1){if(ab!==undefined)refined.push(a,ab,c,ab,b,c);else if(bc!==undefined)refined.push(b,bc,a,bc,c,a);else refined.push(c,ca,b,ca,a,b);}
        else if(ca===undefined)refined.push(b,bc,ab,a,ab,c,ab,bc,c);
        else if(ab===undefined)refined.push(c,ca,bc,b,bc,a,bc,ca,a);
        else refined.push(a,ab,ca,c,ca,b,ca,ab,b);
      }
      triangles=refined;values=work;changed=true;
    }
    if(changed)buildDisplayGeometry(values);
  }
  function syncGeometry(){
    if(!mesh||!simulation)return;
    const target=mesh.geometry.attributes.position.array;
    for(let i=0;i<parameters.length;i+=2)evaluate(parameters[i],parameters[i+1],target,i/2*3);
    refineDisplay();
    if(collider.hasTipContacts){
      const values=mesh.geometry.attributes.position.array;
      for(let i=0;i<triangles.length;i+=3)collider.projectTipFace(values,triangles[i]*3,triangles[i+1]*3,triangles[i+2]*3,.08);
    }
    mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.computeVertexNormals();
    if(hem){
      const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,out=hem.geometry.attributes.position.array,half=finish.preset.thickness*.5;
      let cursor=0;
      for(const [a,b] of hemEdges)for(const vertex of [a,a,b,b,a,b]){
        out[cursor++]=p.getX(vertex)+n.getX(vertex)*half;out[cursor++]=Math.max(floorY+.001,p.getY(vertex)+n.getY(vertex)*half);out[cursor++]=p.getZ(vertex)+n.getZ(vertex)*half;
      }
      hem.geometry.attributes.position.needsUpdate=true;hem.geometry.computeVertexNormals();
    }
  }
  function clear(){hem?.geometry.dispose();hem=null;lining=null;hemEdges=[];ropes?.dispose();ropes=null;mesh?.removeFromParent();mesh?.geometry.dispose();mesh=null;simulation=null;collider=null;parameters=[];triangles=[];}
  return {
    get mesh(){return mesh;},get simulation(){return simulation;},get collider(){return collider;},get ropes(){return ropes;},
    get fabric(){return finish.preset;},
    get plasticSettings(){return finish.plasticSettings;},
    setPlasticSettings(values){finish.setPlasticSettings(values);},
    setFabric(key){finish.setFabric(key);simulation?.setFabric(finish.preset);if(lining)lining.visible=!finish.preset.transmission;if(mesh)syncGeometry();},
    setRopes(settings){ropes?.setRopes(settings);},
    setRopePoints(value){ropes?.setPointCount(value);},
    rebuild(meshes,{resolution=48,held=true,radial=false,fabric='linen',ropes:ropeSettings=[],ropePoints=96,autoSettle=true,settleTolerance=.003}={}){
      clear();finish.setFabric(fabric);if(!meshes.length)return;
      collider=createClothCollider(meshes);
      const imported=radial,bounds=collider.bounds,size=bounds.getSize(new THREE.Vector3());
      // Use a regular sheet for roofs and slender uprights. Collapsing a full
      // radial row onto a small bottle tip makes its contact faces unstable.
      radial=radial&&collider.topCoverage<.35&&Math.max(size.x,size.z)>size.y*.55;
      const center=bounds.getCenter(new THREE.Vector3()),drop=bounds.max.y-floorY,overhang=drop*(imported?2.1:1.35);
      simulation=createClothSimulation({columns:resolution,rows:resolution,width:Math.max(3,size.x+overhang),depth:Math.max(3,size.z+overhang),centerX:center.x,centerZ:center.z,height:bounds.max.y+.28,floorY,collider,pin:collider.support,held,radial,autoSettle,settleTolerance,onSettle});
      simulation.setFabric(finish.preset);
      ropes=createClothRopes({scene,collider,positions:simulation.positions,columns:resolution,rows:resolution,clearance:simulation.contactPadding,points:ropePoints});ropes.setRopes(ropeSettings);simulation.setTies(ropes);
      const geometry=new THREE.BufferGeometry();
      mesh=new THREE.Mesh(geometry,material);mesh.name='Draped cloth';
      lining=new THREE.Mesh(geometry,finish.back);lining.name='Fabric reverse';lining.frustumCulled=false;lining.visible=!finish.preset.transmission;mesh.add(lining);
      hem=new THREE.Mesh(new THREE.BufferGeometry(),finish.edge);hem.name='Fabric hem';hem.frustumCulled=false;mesh.add(hem);
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);initializeDisplay();syncGeometry();
    },
    advance(dt){if(!simulation?.advance(dt))return false;syncGeometry();ropes.render(mesh.geometry.attributes.position.array,0,0,mesh.geometry.index.array);return true;},
    clear,dispose(){clear();finish.dispose();}
  };
}

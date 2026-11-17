import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';

// A fixed pool: coarse grains settle quickly, fine silt drifts in the water.
export function createKelpSediment({parent}){
  const count=480,geometry=new THREE.BufferGeometry();
  const positions=new Float32Array(count*3),alpha=new Float32Array(count),sizes=new Float32Array(count);
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('sedimentAlpha',new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('sedimentSize',new THREE.BufferAttribute(sizes,1));
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:true,
    uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader:`attribute float sedimentAlpha,sedimentSize;varying float vAlpha;
      #include <fog_pars_vertex>
      void main(){vec4 mvPosition=modelViewMatrix*vec4(position,1.0);vAlpha=sedimentAlpha;
        gl_Position=projectionMatrix*mvPosition;
        gl_PointSize=clamp(sedimentSize*projectionMatrix[1][1]*650.0/max(.1,-mvPosition.z),1.0,100.0);
        #include <fog_vertex>
      }`,
    fragmentShader:`varying float vAlpha;
      #include <fog_pars_fragment>
      void main(){float r=length(gl_PointCoord-.5)*2.0;
        float opacity=exp(-r*r*4.5)*(1.0-smoothstep(.65,1.0,r))*vAlpha;
        gl_FragColor=vec4(.34,.40,.29,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`});
  const points=new THREE.Points(geometry,material);points.name='Impact sand and drifting silt';
  points.frustumCulled=false;points.visible=false;parent.add(points);
  let particles=[],age=0,sequence=0;
  function clear(){particles=[];points.visible=false;}
  function burst(impact){
    clear();if(impact.quiet)return;
    const random=seededRandom(871+sequence++*193);age=0;
    for(let i=0;i<count;i++){
      const angle=random()*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),fine=i<120;
      const speed=.35+random()*1.1,rx=Math.max(.22,impact.rx),rz=Math.max(.22,impact.rz);
      particles.push({x:impact.x+c*rx*(.85+random()*.25),z:impact.z+s*rz*(.85+random()*.25),
        y:impact.y+.025,vx:c*speed,vz:s*speed,vy:.35+random()*.95,
        life:fine?3.5+random()*2.0:1.1+random()*1.5,fine});
      sizes[i]=fine?.13+random()*.22:.009+random()*.019;
    }
    geometry.attributes.sedimentSize.needsUpdate=true;points.visible=true;advance(0);
  }
  function advance(dt){
    if(!points.visible)return false;age+=Math.min(Math.max(dt,0),.1);
    let alive=false;
    particles.forEach((p,i)=>{
      const drag=p.fine?1.9:1.1,travel=(1-Math.exp(-drag*age))/drag;
      const rise=p.vy*travel-(p.fine?.065:.65)*age*age;
      positions[i*3]=p.x+p.vx*travel+age*.045;
      positions[i*3+1]=Math.max(p.y,p.y+rise);
      positions[i*3+2]=p.z+p.vz*travel;
      const t=age/p.life,fade=Math.pow(Math.max(0,1-t),1.6);
      alpha[i]=t>=1||(!p.fine&&rise<0)?0:fade*(p.fine?.13:.8)*Math.min(1,.2+age*14);
      if(alpha[i]>.001)alive=true;
    });
    geometry.attributes.position.needsUpdate=true;geometry.attributes.sedimentAlpha.needsUpdate=true;
    points.visible=alive;return true;
  }
  return {points,burst,clear,advance,dispose(){clear();points.removeFromParent();geometry.dispose();material.dispose();}};
}

import * as THREE from 'three';

export const clothFabrics={
  linen:{name:'Ivory linen',color:0xeee8d9,reverse:0xe2dccf,thickness:.008,bend:.03,damping:.96,roughness:.86,sheen:.7,quilt:0},
  wool:{name:'Heavy wool',color:0x9c7864,reverse:0x79645a,thickness:.045,bend:.24,damping:.94,roughness:.98,sheen:1,quilt:0},
  duvet:{name:'Two-sided duvet',color:0xf1eadb,reverse:0x698590,thickness:.085,bend:.18,damping:.93,roughness:.92,sheen:.8,quilt:.035}
};

// The solver keeps a middle surface. Separate faces and a closed hem give
// the displayed fabric real thickness without duplicating simulation nodes.
export function createFabricFinish(){
  const uniforms={thickness:{value:.008},quilt:{value:0}};
  const texture=new THREE.DataTexture(new Uint8Array(128*128*4),128,128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const value=Math.round(128+35*Math.sin(x*Math.PI/2)*Math.sin(y*Math.PI/2)),i=(y*128+x)*4;
    texture.image.data.set([value,value,value,255],i);
  }
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(24,24);texture.needsUpdate=true;
  function make(side,sign){
    const material=new THREE.MeshPhysicalMaterial({side,roughness:.9,sheen:1,sheenColor:0xfff4df,bumpMap:texture,bumpScale:.003});
    material.defines={USE_UV:''};
    material.onBeforeCompile=shader=>{
      shader.uniforms.fabricThickness=uniforms.thickness;shader.uniforms.fabricQuilt=uniforms.quilt;
      shader.vertexShader='uniform float fabricThickness;\nuniform float fabricQuilt;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        vec2 cell=fract(uv*12.0);
        float loft=pow(max(0.0,sin(cell.x*3.14159265)*sin(cell.y*3.14159265)),.65);
        transformed+=objectNormal*${sign.toFixed(1)}*(fabricThickness*.5+fabricQuilt*loft);`);
      shader.fragmentShader='uniform float fabricQuilt;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        vec2 cell=fract(vUv*12.0);
        vec2 width=max(fwidth(vUv*12.0),vec2(.007));
        vec2 line=smoothstep(vec2(0.0),width*1.5,min(cell,1.0-cell));
        diffuseColor.rgb*=mix(1.0,.88+.12*min(line.x,line.y),step(.001,fabricQuilt));`);
    };
    material.customProgramCacheKey=()=>`cloth-shell-${sign}`;
    return material;
  }
  const front=make(THREE.FrontSide,1),back=make(THREE.BackSide,-1),edge=new THREE.MeshStandardMaterial({color:0xe2dccf,roughness:.95,side:THREE.DoubleSide});
  let preset=clothFabrics.linen;
  return {front,back,edge,
    get preset(){return preset;},
    setFabric(key){
      preset=clothFabrics[key]??clothFabrics.linen;
      uniforms.thickness.value=preset.thickness;uniforms.quilt.value=preset.quilt;
      for(const [material,color] of [[front,preset.color],[back,preset.reverse]]){
        material.name=preset.name;material.color.setHex(color);material.roughness=preset.roughness;material.sheen=preset.sheen;material.bumpScale=preset===clothFabrics.wool ? .012 : .003;
      }
      edge.color.setHex(preset.reverse);
    },
    dispose(){front.dispose();back.dispose();edge.dispose();texture.dispose();}
  };
}

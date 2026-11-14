import * as THREE from 'three';

export const defaultPlasticSettings=Object.freeze({gloss:.83,translucency:.68,crinkle:.35,iridescence:0,colorVariation:.65,color:'#e8e9ed'});
export const iridescentPlasticSettings=Object.freeze({gloss:.9,translucency:.5,crinkle:.25,iridescence:1,colorVariation:.8,color:'#eef0ff'});

export const clothFabrics={
  plastic:{name:'Pearl plastic',color:0xe8e9ed,reverse:0xe8e9ed,thickness:.003,bend:.012,damping:.97,roughness:.17,sheen:0,quilt:0,transmission:.68},
  linen:{name:'Ivory linen',color:0xeee8d9,reverse:0xe2dccf,thickness:.008,bend:.03,damping:.96,roughness:.86,sheen:.7,quilt:0},
  wool:{name:'Heavy wool',color:0x9c7864,reverse:0x79645a,thickness:.045,bend:.24,damping:.94,roughness:.98,sheen:1,quilt:0},
  duvet:{name:'Two-sided duvet',color:0xf1eadb,reverse:0x698590,thickness:.085,bend:.18,damping:.93,roughness:.92,sheen:.8,quilt:.035}
};

// The solver keeps a middle surface. Separate faces and a closed hem give
// the displayed fabric real thickness without duplicating simulation nodes.
export function createFabricFinish(){
  const uniforms={thickness:{value:.008},quilt:{value:0},rainbow:{value:0},variation:{value:.65}};
  const texture=new THREE.DataTexture(new Uint8Array(128*128*4),128,128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const value=Math.round(128+35*Math.sin(x*Math.PI/2)*Math.sin(y*Math.PI/2)),i=(y*128+x)*4;
    texture.image.data.set([value,value,value,255],i);
  }
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(24,24);texture.needsUpdate=true;
  // Irregular crease bands catch narrow highlights like crumpled bag film.
  // Keep this separate from the woven bump map used by the fabric finishes.
  const film=new THREE.DataTexture(new Uint8Array(256*256*4),256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const u=x/256*Math.PI*2,v=y/256*Math.PI*2;
    const fold=Math.sin(u*9+Math.sin(v*3)*1.7+Math.sin(u*2-v*2)*.6);
    const cross=Math.sin(v*13+Math.sin(u*4)*1.2);
    const value=Math.round(128+76*Math.pow(Math.abs(fold),.35)+25*cross),i=(y*256+x)*4;
    film.image.data.set([value,value,value,255],i);
  }
  film.wrapS=film.wrapT=THREE.RepeatWrapping;film.repeat.set(3,3);film.needsUpdate=true;
  const interference=new THREE.DataTexture(new Uint8Array(256*256*4),256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const u=x/256*Math.PI*2,v=y/256*Math.PI*2;
    const value=Math.round(127.5+127.5*Math.sin(u*2+v+Math.sin(v*2)*.7+Math.sin(u-v)*.3));
    interference.image.data.set([value,value,value,255],(y*256+x)*4);
  }
  interference.wrapS=interference.wrapT=THREE.RepeatWrapping;interference.needsUpdate=true;
  function make(side,sign){
    const material=new THREE.MeshPhysicalMaterial({side,roughness:.9,sheen:1,sheenColor:0xfff4df,bumpMap:texture,bumpScale:.003});
    material.defines={...material.defines,USE_UV:''};
    material.onBeforeCompile=shader=>{
      shader.uniforms.fabricThickness=uniforms.thickness;shader.uniforms.fabricQuilt=uniforms.quilt;
      shader.uniforms.fabricRainbow=uniforms.rainbow;shader.uniforms.fabricRainbowVariation=uniforms.variation;
      shader.vertexShader='uniform float fabricThickness;\nuniform float fabricQuilt;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        vec2 cell=fract(uv*12.0);
        float loft=pow(max(0.0,sin(cell.x*3.14159265)*sin(cell.y*3.14159265)),.65);
        transformed+=objectNormal*${sign.toFixed(1)}*(fabricThickness*.5+fabricQuilt*loft);`);
      shader.fragmentShader='uniform float fabricQuilt;\nuniform float fabricRainbow;\nuniform float fabricRainbowVariation;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        vec2 cell=fract(vUv*12.0);
        vec2 width=max(fwidth(vUv*12.0),vec2(.007));
        vec2 line=smoothstep(vec2(0.0),width*1.5,min(cell,1.0-cell));
        diffuseColor.rgb*=mix(1.0,.88+.12*min(line.x,line.y),step(.001,fabricQuilt));`);
      // Diffractive wrapping film has broad color bands as well as the native
      // thin-film reflections. Anchor the bands to the sheet and bend their
      // phase with the viewing angle and the final crinkled surface normal.
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        if(fabricRainbow>0.0){
          float facing=abs(dot(normal,normalize(vViewPosition)));
          float phase=(vUv.x*1.6+vUv.y*.55)*(.3+fabricRainbowVariation*1.7)
            +(1.0-facing)*1.1+sin(vUv.y*6.2831853)*.16;
          vec3 spectrum=.58+.42*cos(6.2831853*(phase+vec3(0.0,.3333333,.6666667)));
          diffuseColor.rgb*=mix(vec3(1.0),spectrum,fabricRainbow*.82);
        }`);
    };
    material.customProgramCacheKey=()=>`cloth-shell-${sign}`;
    return material;
  }
  const front=make(THREE.FrontSide,1),back=make(THREE.BackSide,-1),edge=new THREE.MeshStandardMaterial({color:0xe2dccf,roughness:.95,side:THREE.DoubleSide});
  let preset=clothFabrics.linen;
  const plasticSettings={...defaultPlasticSettings};
  function applyPlastic(){
    if(preset!==clothFabrics.plastic)return;
    uniforms.rainbow.value=plasticSettings.iridescence;uniforms.variation.value=plasticSettings.colorVariation;
    for(const material of [front,back]){
      const transmitted=material.transmission>0;
      material.roughness=Math.max(.03,1-plasticSettings.gloss);
      material.clearcoatRoughness=Math.max(.03,(1-plasticSettings.gloss)*.7);
      material.transmission=plasticSettings.translucency;material.bumpScale=plasticSettings.crinkle*.1;
      material.iridescence=plasticSettings.iridescence;material.iridescenceIOR=1.35;
      const spread=300*plasticSettings.colorVariation;
      material.iridescenceThicknessRange=[400-spread,400+spread];
      material.clearcoat=1-.65*plasticSettings.iridescence;
      material.color.set(plasticSettings.color);
      if(transmitted!==(material.transmission>0))material.needsUpdate=true;
    }
    edge.color.set(plasticSettings.color);
  }
  return {front,back,edge,
    get preset(){return preset;},
    get plasticSettings(){return {...plasticSettings};},
    setPlasticSettings(values){
      for(const key of ['gloss','translucency','crinkle','iridescence','colorVariation'])if(Number.isFinite(values[key]))plasticSettings[key]=Math.max(0,Math.min(1,values[key]));
      if(/^#[\da-f]{6}$/i.test(values.color??''))plasticSettings.color=values.color;
      applyPlastic();
    },
    setFabric(key){
      preset=clothFabrics[key]??clothFabrics.linen;
      uniforms.thickness.value=preset.thickness;uniforms.quilt.value=preset.quilt;
      const plastic=!!preset.transmission;
      uniforms.rainbow.value=0;
      for(const [material,color] of [[front,preset.color],[back,preset.reverse]]){
        material.name=preset.name;material.color.setHex(color);material.roughness=preset.roughness;material.sheen=preset.sheen;material.bumpScale=preset===clothFabrics.wool ? .012 : .003;
        material.bumpMap=plastic?film:texture;material.bumpScale=plastic?.035:material.bumpScale;
        material.transmission=preset.transmission??0;material.thickness=plastic?.018:0;material.ior=1.46;
        material.clearcoat=plastic?1:0;material.clearcoatRoughness=.12;
        material.iridescence=0;material.iridescenceThicknessMap=plastic?interference:null;
        material.envMapIntensity=plastic?1.35:1;material.specularIntensity=plastic?1.2:1;
        material.side=plastic?THREE.DoubleSide:material===front?THREE.FrontSide:THREE.BackSide;
        material.needsUpdate=true;
      }
      edge.color.setHex(preset.reverse);
      applyPlastic();
    },
    dispose(){front.dispose();back.dispose();edge.dispose();texture.dispose();film.dispose();interference.dispose();}
  };
}

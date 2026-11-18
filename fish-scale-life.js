import * as THREE from 'three';
import {seededRandom} from './plume-lsystem/random.js';

export const scaleLifeTileSize=64;
const rules=[{birth:1<<3,survive:(1<<2)|(1<<3)},
  {birth:(1<<3)|(1<<6),survive:(1<<2)|(1<<3)},
  {birth:1<<3,survive:62},{birth:1<<3,survive:496}];

// Life-like binary automata on a torus. Different birth/survival rules produce
// islands, branching colonies and coral-like edges for the four fish types.
export function evolveLifeGrid(current,next,width,height,{birth=1<<3,survive=(1<<2)|(1<<3)}={}){
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let count=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy)count+=current[((y+dy+height)%height)*width+(x+dx+width)%width];
    const i=y*width+x;next[i]=((current[i]?survive:birth)&(1<<count))?1:0;
  }
}

export function createFishScaleLife({seed=811,interval=1.2}={}){
  const tile=scaleLifeTileSize,side=tile*2,data=new Uint8Array(side*side*4);
  const texture=new THREE.DataTexture(data,side,side,THREE.RGBAFormat);
  texture.name='Fish scale cellular colonies';texture.minFilter=texture.magFilter=THREE.NearestFilter;
  texture.generateMipmaps=false;texture.colorSpace=THREE.NoColorSpace;
  const uniforms={fishLifeTexture:{value:texture},fishLifeBlend:{value:0}};
  const fields=rules.map(()=>({cells:new Uint8Array(tile*tile),next:new Uint8Array(tile*tile),age:new Uint8Array(tile*tile)}));
  let phase=0,generation=0,uploads=0,disposed=false;
  function atlasIndex(kind,i){return (((Math.floor(kind/2)*tile)+Math.floor(i/tile))*side+(kind%2)*tile+i%tile)*4;}
  function seedField(field,kind,salt=0){
    const random=seededRandom(seed+kind*7919+salt*193);
    for(let i=0;i<field.cells.length;i++){field.cells[i]=random()<(.28+kind*.025)?1:0;field.age[i]=0;}
    for(let pass=0;pass<20;pass++){evolveLifeGrid(field.cells,field.next,tile,tile,rules[kind]);[field.cells,field.next]=[field.next,field.cells];}
    for(let i=0;i<field.cells.length;i++)field.age[i]=field.cells[i]?96:0;
  }
  function reset(value=seed){
    if(disposed)return;seed=value;phase=0;generation=0;
    fields.forEach((field,kind)=>{
      seedField(field,kind);
      for(let i=0;i<field.cells.length;i++){const j=atlasIndex(kind,i);data[j]=data[j+1]=field.cells[i]*255;data[j+2]=data[j+3]=field.age[i];}
    });
    uniforms.fishLifeBlend.value=0;texture.needsUpdate=true;uploads++;
  }
  function step(){
    generation++;let changed=false;
    fields.forEach((field,kind)=>{
      evolveLifeGrid(field.cells,field.next,tile,tile,rules[kind]);
      let live=0;for(const cell of field.next)live+=cell;
      // Extinct colonies are reseeded into the next generation; the atlas's
      // previous/current channels crossfade the return instead of popping.
      if(live<12){
        const cells=field.cells.slice(),age=field.age.slice();
        seedField(field,kind,generation);field.next.set(field.cells);field.cells.set(cells);field.age.set(age);
      }
      for(let i=0;i<field.cells.length;i++){
        const j=atlasIndex(kind,i),age=field.next[i]?Math.min(255,field.age[i]+12):Math.max(0,field.age[i]-8);
        const a=field.cells[i]*255,b=field.next[i]*255,c=field.age[i];
        if(data[j]!==a||data[j+1]!==b||data[j+2]!==c||data[j+3]!==age)changed=true;
        data[j]=a;data[j+1]=b;data[j+2]=c;data[j+3]=age;field.age[i]=age;
      }
      [field.cells,field.next]=[field.next,field.cells];
    });
    if(changed){texture.needsUpdate=true;uploads++;}
  }
  reset();
  return {texture,uniforms,reset,
    advance(dt){
      if(disposed||!Number.isFinite(dt)||dt<=0)return;
      phase+=Math.min(dt,.25);
      while(phase+1e-9>=interval){phase=Math.max(0,phase-interval);step();}
      uniforms.fishLifeBlend.value=THREE.MathUtils.smoothstep(phase/interval,0,1);
    },
    get stats(){return {generation,uploads,live:fields.map(field=>field.cells.reduce((a,b)=>a+b,0))};},
    dispose(){if(!disposed){disposed=true;texture.dispose();}},
  };
}

export const fishScaleLifeGLSL=`
  uniform sampler2D fishLifeTexture;
  uniform float fishLifeBlend;
  vec2 fishScaleColony(vec2 cell,float species,float seed){
    vec2 tile=vec2(mod(species,2.0),floor(species/2.0));
    vec2 offset=floor(vec2(seed*379.0,seed*997.0));
    vec2 wrapped=mod(cell+offset,${scaleLifeTileSize.toFixed(1)});
    vec4 colony=texture2D(fishLifeTexture,(tile*${scaleLifeTileSize.toFixed(1)}+wrapped+.5)/${(scaleLifeTileSize*2).toFixed(1)});
    return vec2(mix(colony.r,colony.g,fishLifeBlend),mix(colony.b,colony.a,fishLifeBlend));
  }
`;

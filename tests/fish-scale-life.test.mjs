import {registerHooks} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){return next(s==='three'?new URL('../vendor/three.module.js',import.meta.url).href:s,c);}});
const {evolveLifeGrid,createFishScaleLife}=await import('../fish-scale-life.js');

test('the scale simulation follows Conway births and survival rather than random noise',()=>{
  const cells=new Uint8Array(25),next=new Uint8Array(25),again=new Uint8Array(25);
  for(const x of [1,2,3])cells[2*5+x]=1;
  evolveLifeGrid(cells,next,5,5);
  assert.deepEqual([...next.entries()].filter(([,v])=>v).map(([i])=>i),[7,12,17]);
  evolveLifeGrid(next,again,5,5);assert.deepEqual(again,cells,'A blinker returns to its starting state');
  const block=new Uint8Array(25);for(const i of [6,7,11,12])block[i]=1;
  evolveLifeGrid(block,next,5,5);assert.deepEqual(next,block,'Stable colonies remain stable');
});

test('colonies wrap across texture boundaries without a seam',()=>{
  const cells=new Uint8Array(25),next=new Uint8Array(25);
  for(const x of [4,0,1])cells[x]=1;
  evolveLifeGrid(cells,next,5,5);
  assert.deepEqual([...next.entries()].filter(([,v])=>v).map(([i])=>i),[0,5,20]);
});

test('atlas evolution is seeded, deterministic, interpolated and independent of frame subdivision',()=>{
  const a=createFishScaleLife({seed:17}),b=createFishScaleLife({seed:17}),texture=a.texture,initial=a.texture.image.data.slice();
  assert.deepEqual(a.texture.image.data,b.texture.image.data);
  for(let i=0;i<100;i++)a.advance(.1);for(let i=0;i<200;i++)b.advance(.05);
  assert.deepEqual(a.texture.image.data,b.texture.image.data);assert.equal(a.stats.generation,8);
  assert(Math.abs(a.uniforms.fishLifeBlend.value-b.uniforms.fishLifeBlend.value)<1e-8);
  assert(a.texture.image.data.some((value,i)=>value!==initial[i]));assert(a.stats.live.every(n=>n>=12));
  assert(a.uniforms.fishLifeBlend.value>=0&&a.uniforms.fishLifeBlend.value<=1);
  assert(a.stats.uploads<=a.stats.generation+1,'Texture uploads happen at automaton rate, not once per fish or frame');
  const frozen=a.texture.image.data.slice();a.advance(0);a.advance(NaN);assert.deepEqual(a.texture.image.data,frozen);
  a.reset(17);assert.equal(a.texture,texture);assert.deepEqual(a.texture.image.data,initial);
  a.dispose();b.dispose();
});

test('all species retain living colonies over a long run and release their texture once',()=>{
  const life=createFishScaleLife();for(let i=0;i<1500;i++)life.advance(.25);
  assert(life.stats.generation>300);assert(life.stats.live.every(n=>n>=12&&n<=4096));
  let disposed=0;life.texture.addEventListener('dispose',()=>disposed++);life.dispose();life.dispose();assert.equal(disposed,1);
});

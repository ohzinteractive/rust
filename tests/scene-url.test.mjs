import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSceneURL,writeSceneURL,createSceneURLSync} from '../scene-url.js';

test('scene links round trip settings and preserve unrelated query/hash values',()=>{
  const state={scene:'oasis',object:'gate',view:'shape-gate',settings:{inputs:{'palm-wind':'72','radio:cloth-fabric':'wool'},rotate:false}};
  const url=writeSceneURL('https://rust.ohzi.dev/?utm_source=test#info',state);
  assert.equal(url.searchParams.get('utm_source'),'test');assert.equal(url.hash,'#info');
  assert.equal(url.searchParams.get('set.palm-wind'),'72');assert.equal(url.searchParams.get('radio.cloth-fabric'),'wool');
  assert(!url.href.includes('%22'));assert(!url.searchParams.has('settings'));
  assert.deepEqual(readSceneURL(url),{...state,metal:null,map:null});
  const next=writeSceneURL(url,{scene:'kelp',object:'none'});
  assert.equal(next.searchParams.has('view'),false);assert.equal(next.searchParams.has('settings'),false);
});

test('camera, seeds, checkbox values, colors and ropes use readable parameters',()=>{
  const settings={camera:{position:[4.326558703900333,7.02714041482955,8.529938193764856],target:[0,-.22,0]},rotate:false,
    inputs:{'paint-enabled':false,'feather-axiom':'F[+X]&X','text':'true'},seeds:{palm:123},colors:{pink:'#faff12'},rotation:[.1,-.2,0],
    ropes:[{id:1,style:'cord',height:.5,tightness:.8,width:.07,turns:3,span:.4}]};
  const url=writeSceneURL('https://rust.ohzi.dev/?scene=cloth&object=maze',{scene:'cloth',object:'maze',map:'garden',settings});
  assert(url.href.includes('camera=4.327,7.027,8.53'));
  assert(url.href.includes('target=0,-0.22,0'));assert(url.href.includes('color.pink=faff12'));
  assert.deepEqual(readSceneURL(url).settings,{...settings,camera:{...settings.camera,position:[4.327,7.027,8.53]}});
  const next=writeSceneURL(url,{scene:'oasis',object:'gate'});
  assert.deepEqual([...next.searchParams.keys()],['scene','object']);
});

test('legacy JSON links restore and convert to readable links without losing settings',()=>{
  const settings={camera:{position:[4.3,7,8.5],target:[0,-.22,0]},rotate:false};
  const legacy='https://rust.ohzi.dev/?scene=cloth&object=maze&settings='+encodeURIComponent(JSON.stringify(settings))+'&map=garden';
  const state=readSceneURL(legacy),url=writeSceneURL(legacy,state);
  assert.deepEqual(state.settings,settings);assert.deepEqual(readSceneURL(url),state);
  assert(!url.href.includes('%22'));assert(!url.searchParams.has('settings'));
});

test('invalid readable values are ignored and prototype-like keys stay plain data',()=>{
  const state=readSceneURL('https://rust.ohzi.dev/?camera=1,no,3&target=0,0,0&rotate=maybe&seed.palm=no&set.__proto__=safe');
  assert.deepEqual(state.settings,{inputs:{['__proto__']:'safe'}});
  assert.equal({}.safe,undefined);
});

test('malformed settings fall back to defaults',()=>{
  for(const value of ['{','null','[]','3'])assert.deepEqual(readSceneURL('https://rust.ohzi.dev/?scene=oasis&settings='+encodeURIComponent(value)).settings,{});
});

test('section changes push history while setting changes replace it',async()=>{
  const calls=[],events={};let state={scene:'metal',object:'cube',settings:{}};
  const window={location:{href:'https://rust.ohzi.dev/',reload(){calls.push('reload');}},
    history:Object.fromEntries(['pushState','replaceState'].map(method=>[method,(_state,_title,url)=>{calls.push(method);window.location.href=url.href;}])),
    addEventListener(name,listener){events[name]=listener;}};
  const sync=createSceneURLSync({window,getState:()=>state,restore:async value=>assert.equal(value.scene,null)});
  await sync.start();assert.deepEqual(calls,['replaceState']);
  state={scene:'oasis',object:'gate',settings:{}};sync.flush();
  state.settings={inputs:{'palm-wind':'80'}};sync.flush();sync.flush();
  assert.deepEqual(calls,['replaceState','pushState','replaceState']);
  sync.schedule();events.popstate();assert.equal(calls.at(-1),'reload');
});

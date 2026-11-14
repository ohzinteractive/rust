import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleRopeOutline} from '../rope-outline.js';

const square=[[-1,-1],[1,-1],[1,1],[-1,1],[0,0],[0,.8]];
const boxDistance=(x,z)=>Math.hypot(Math.max(0,Math.abs(x)-1),Math.max(0,Math.abs(z)-1));

test('additional rope points refine rounded bends instead of only subdividing flat faces',()=>{
  const measures=[];
  for(const count of [96,384]){
    const samples=sampleRopeOutline(square,count);assert.equal(samples.length,count*4);
    let curved=0,largestTurn=0;
    for(let i=0;i<count;i++){
      const a=i*4,b=((i+1)%count)*4,x=samples[a],z=samples[a+1],nx=samples[a+2],nz=samples[a+3];
      if(Math.abs(nx)>.1&&Math.abs(nz)>.1)curved++;
      const dot=nx*samples[b+2]+nz*samples[b+3];largestTurn=Math.max(largestTurn,Math.acos(Math.max(-1,Math.min(1,dot))));
      assert(Math.hypot(x-samples[b],z-samples[b+1])>1e-7,'Every selected point occupies a distinct position');
      assert(Math.abs(boxDistance(x,z)-.014)<1e-6,'The curve follows the rounded exterior of the contacts');
      assert(boxDistance((x+samples[b])/2,(z+samples[b+1])/2)>.012,'Even straight chords between points leave room for the rope thickness');
    }
    measures.push({curved,largestTurn});
  }
  assert(measures[1].curved>measures[0].curved*3,'Higher detail spends substantially more points on the bends');
  assert(measures[1].largestTurn<measures[0].largestTurn*.4,'Corner curvature becomes visibly smoother');
});

test('contact order and duplicate triangle crossings do not change the rope outline',()=>{
  const expected=sampleRopeOutline(square,192);
  assert.deepEqual(sampleRopeOutline([...square].reverse().concat(square),192),expected);
  assert.equal(sampleRopeOutline([[0,0],[0,0]],96),null);
  assert.equal(sampleRopeOutline([[0,0],[1,0],[2,0]],96),null);
});

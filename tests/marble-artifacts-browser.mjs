import assert from 'node:assert/strict';

export async function checkMarbleArtifacts({run}){
  await run("document.getElementById('kelp-material').click();peelDebug.kelp.rebuild({strands:4,generations:2});peelDebug.kelp.setPlaying(false);peelDebug.kelp.group.visible=false;peelDebug.kelpFish.setVisible(false);peelDebug.controls.enableDamping=false;peelDebug.controls.minDistance=.05;void 0");
  assert(await run("peelDebug.kelpAttractor.loadSample('jeddah')"));
  const geometry=await run(`(()=>{const g=peelDebug.kelpAttractor.group.children[0].geometry,n=g.attributes.normal;let invalid=0;for(let i=0;i<n.count;i++){const l=n.getX(i)**2+n.getY(i)**2+n.getZ(i)**2;if(!Number.isFinite(l)||Math.abs(l-1)>.001)invalid++;}return {vertices:n.count,invalid}})()`);
  assert.equal(geometry.invalid,0,'Every imported Jeddah normal must be finite and unit length');
  let frames=0;
  for(const size of [.25,1,3])for(const angle of [0,.02,.15,1.2,2.4,4.7]){
    const result=await run(`import('./vendor/three.module.js').then(T=>{
      const d=peelDebug;d.kelpAttractor.setModelSize(${size});
      d.controls.target.copy(d.kelpAttractor.center);
      d.camera.position.copy(d.controls.target).add(new T.Vector3(Math.sin(${angle})*4.5,2.8,Math.cos(${angle})*4.5).multiplyScalar(${size}));
      d.controls.update();d.renderer.shadowMap.needsUpdate=true;d.renderScene();
      const t=d.kelpEnvironment.getLightingDiagnostics().sceneTarget,half=t.texture.type===T.HalfFloatType;
      const b=half?new Uint16Array(t.width*t.height*4):new Uint8Array(t.width*t.height*4);
      d.renderer.readRenderTargetPixels(t,0,0,t.width,t.height,b);
      let invalid=0;if(half)for(let i=0;i<b.length;i++)if((b[i]&0x7c00)===0x7c00)invalid++;
      const gl=d.renderer.getContext(),pixels=new Uint8Array(t.width*t.height*4);gl.readPixels(0,0,t.width,t.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let black=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]===0&&pixels[i+1]===0&&pixels[i+2]===0)black++;
      return {invalid,black};
    })`);
    assert.equal(result.invalid,0,`No NaN or infinity at size ${size}, angle ${angle}`);
    assert.equal(result.black,0,`No solid black artifact pixels at size ${size}, angle ${angle}`);frames++;
  }
  console.log('PASS: Jeddah has no invalid normals; '+frames+' rendered views across three sizes contain no invalid HDR values or solid black pixels.');
}

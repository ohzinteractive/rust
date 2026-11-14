import {writeFile} from 'node:fs/promises';

export async function checkCloth({run,call,delay,assert,mobile=false}){
  await run("document.querySelector('[data-shape=sphere]').click();document.getElementById('cloth-material').click()");
  assert(await run("peelDebug.state.material==='cloth'&&peelDebug.cloth.mesh.visible&&!peelDebug.surface.mesh.visible&&!document.getElementById('cloth-controls').hidden&&document.getElementById('exposure-controls').hidden"));
  for(const shape of ['sphere','pill','horse']){
    if(shape==='pill')await run("document.querySelector('[data-shape=pill]').click()");
    if(shape==='horse'){
      await run("document.getElementById('horse-shape').click()");
      for(let i=0;i<100&&!(await run("peelDebug.models.sampleKey==='horse'"));i++)await delay(100);
      assert(await run("peelDebug.models.sampleKey==='horse'"));
    }
    const result=await run(`(()=>{
      for(let i=0;i<300;i++)peelDebug.cloth.advance(1/60);
      peelDebug.featherRenderer.render(peelDebug.scene,peelDebug.camera);
      const p=peelDebug.cloth.simulation.positions;let min=Infinity,max=-Infinity,inside=0;
      for(let i=0;i<p.length;i+=3){min=Math.min(min,p[i+1]);max=Math.max(max,p[i+1]);if(peelDebug.cloth.collider.contains(p,i))inside++;}
      return {finite:p.every(Number.isFinite),min,max,inside,count:p.length/3};
    })()`);
    assert(result.finite&&result.min>=-1.739&&result.max-result.min>.6,shape+': '+JSON.stringify(result));
    assert(result.inside<8,shape+' cloth must remain outside the collision envelope: '+JSON.stringify(result));
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(`/private/tmp/oxide-cloth-${shape}${mobile?'-mobile':''}.png`,Buffer.from(shot.result.data,'base64'));
    await run("document.getElementById('cloth-pause').click()");assert(await run('peelDebug.cloth.simulation.paused'));
    assert.equal(await run('peelDebug.cloth.advance(1)'),false);
    await run("document.getElementById('cloth-redrape').click()");assert(await run('!peelDebug.cloth.simulation.paused&&peelDebug.cloth.simulation.time<.5'));
  }
  assert(await run("document.getElementById('model-animation').disabled"),'Cloth uses a still import pose');
  await run("document.querySelector('[data-metal=iron]').click()");
  assert(await run("peelDebug.state.material==='metal'&&peelDebug.cloth.mesh===null&&!document.getElementById('model-animation').disabled"),'Changing material removes the cloth and restores animation controls');
  await run("document.querySelector('[data-shape=cube]').click();document.getElementById('cloth-material').click();document.getElementById('feather-material').click()");
  assert(await run("peelDebug.cloth.mesh===null&&peelDebug.state.material==='feathers'&&document.getElementById('cloth-controls').hidden"));
  await run("document.querySelector('[data-metal=iron]').click()");
}

export async function checkClothRopes({run,call,delay,assert,mobile=false}){
  await run("document.querySelector('[data-shape=sphere]').click();document.getElementById('cloth-material').click()");
  for(const shape of ['sphere','pill','horse']){
    if(shape==='pill')await run("document.querySelector('[data-shape=pill]').click()");
    if(shape==='horse'){
      await run("document.getElementById('horse-shape').click()");
      for(let i=0;i<100&&!(await run("peelDebug.models.sampleKey==='horse'"));i++)await delay(100);
      assert(await run("peelDebug.models.sampleKey==='horse'"));
    }
    await run('for(let i=0;i<180;i++)peelDebug.cloth.advance(1/60)');
    await run("document.getElementById('cloth-add-rope').click();var h=document.querySelector('[data-rope-control=height]');h.value=35;h.dispatchEvent(new Event('input'));var t=document.querySelector('[data-rope-control=tightness]');t.value=0;t.dispatchEvent(new Event('input'));for(let i=0;i<180;i++)peelDebug.cloth.advance(1/60)");
    const loose=await run('peelDebug.cloth.ropes.stats[0]');
    await run("var t=document.querySelector('[data-rope-control=tightness]');t.value=100;t.dispatchEvent(new Event('input'));for(let i=0;i<300;i++)peelDebug.cloth.advance(1/60);peelDebug.featherRenderer.render(peelDebug.scene,peelDebug.camera)");
    const tight=await run('peelDebug.cloth.ropes.stats[0]');
    assert(tight.attachments>8&&tight.clothRadius<loose.clothRadius-.03,shape+': the rope must gather cloth: '+JSON.stringify({loose,tight}));
    assert(tight.heightError<.15,shape+': the binding stays at its chosen level: '+JSON.stringify(tight));
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-cloth-rope-${shape}${mobile?'-mobile':''}.png`,Buffer.from(shot.result.data,'base64'));
    await run("document.getElementById('cloth-add-rope').click();for(let i=0;i<180;i++)peelDebug.cloth.advance(1/60)");
    assert(await run('peelDebug.cloth.ropes.stats.length===2&&peelDebug.cloth.simulation.positions.every(Number.isFinite)'));
    await run("document.getElementById('cloth-redrape').click();for(let i=0;i<660;i++)peelDebug.cloth.advance(1/60)");
    assert(await run('peelDebug.cloth.ropes.stats.length===2&&peelDebug.cloth.ropes.stats.every(r=>r.attachments>8)'),'Bindings survive redraping');
    await run("while(document.querySelector('#cloth-rope-list button'))document.querySelector('#cloth-rope-list button').click()");
    assert(await run('peelDebug.cloth.ropes.stats.length===0&&peelDebug.cloth.ropes.group.children.length===0'));
  }
  await run("document.querySelector('[data-metal=iron]').click();document.querySelector('[data-shape=cube]').click()");
  assert(await run("peelDebug.scene.getObjectsByProperty('name','Cloth ropes').length===0"));
}

export async function checkDelayedWrapping({run,call,assert,mobile=false}){
  await run("document.querySelector('[data-shape=cube]').click();document.getElementById('cloth-material').click();document.getElementById('cloth-add-rope').click();document.getElementById('cloth-add-rope').click()");
  assert(await run("peelDebug.cloth.ropes.stats.every(r=>r.status==='waiting'&&r.attachments===0)&&document.querySelector('.cloth-rope-status').textContent==='Waiting for cloth…'"),'Adding ties must allow the cloth to drape first');
  await run('for(let i=0;i<135;i++)peelDebug.cloth.advance(1/60)');
  assert(await run("peelDebug.cloth.ropes.stats.every(r=>r.status==='waiting')"));
  await run('for(let i=0;i<90;i++)peelDebug.cloth.advance(1/60)');
  assert(await run("peelDebug.cloth.ropes.stats[0].status==='wrapping'&&peelDebug.cloth.ropes.stats[1].status==='waiting'"),'The second tie must wait for the first');
  await run("for(let i=0;i<660;i++)peelDebug.cloth.advance(1/60);peelDebug.featherRenderer.render(peelDebug.scene,peelDebug.camera)");
  assert(await run("peelDebug.cloth.ropes.stats.every(r=>r.status==='tied'&&r.attachments>8)&&peelDebug.cloth.simulation.positions.every(Number.isFinite)"));
  const result=await run(`(()=>{
    const p=peelDebug.cloth.simulation.positions,old=p.slice();let maxMove=0,inside=0;
    for(let frame=0;frame<90;frame++){
      peelDebug.cloth.advance(1/60);
      for(let i=0;i<p.length;i+=3)maxMove=Math.max(maxMove,Math.hypot(p[i]-old[i],p[i+1]-old[i+1],p[i+2]-old[i+2]));old.set(p);
    }
    for(let i=0;i<p.length;i+=3)if(peelDebug.cloth.collider.contains(p,i))inside++;
    peelDebug.featherRenderer.render(peelDebug.scene,peelDebug.camera);return {maxMove,inside};
  })()`);
  assert(result.maxMove<.2&&result.inside<4,'Tied cube remains stable and outside the mesh: '+JSON.stringify(result));
  const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-cloth-wrapping${mobile?'-mobile':''}.png`,Buffer.from(shot.result.data,'base64'));
  await run("document.getElementById('cloth-redrape').click()");
  assert(await run("peelDebug.cloth.ropes.stats.every(r=>r.status==='waiting'&&r.attachments===0)"),'Redrape must repeat the delayed sequence');
  await run("while(document.querySelector('#cloth-rope-list button'))document.querySelector('#cloth-rope-list button').click();document.querySelector('[data-metal=iron]').click()");
}

export async function checkHorseClothContacts({run,call,delay,assert,mobile=false}){
  await run("document.getElementById('horse-shape').click()");
  for(let i=0;i<100&&!(await run("peelDebug.models.sampleKey==='horse'"));i++)await delay(100);
  assert(await run("peelDebug.models.sampleKey==='horse'"));
  await run("document.getElementById('cloth-material').click();document.getElementById('cloth-add-rope').click();document.getElementById('cloth-add-rope').click();for(let i=0;i<900;i++)peelDebug.cloth.advance(1/60)");
  const result=await run(`(()=>{
    const cloth=peelDebug.cloth,p=cloth.simulation.positions,display=cloth.mesh.geometry.attributes.position,index=cloth.mesh.geometry.index,probe=new Float64Array(3);
    let simulationInside=0,displayInside=0,facesInside=0,hemAboveFloor=0,contacts=[];
    const uv=cloth.mesh.geometry.attributes.uv;
    for(let i=0;i<uv.count;i++)if(uv.getY(i)<1e-6&&display.getY(i)>-1.73)hemAboveFloor++;
    for(let i=0;i<p.length;i+=3)if(cloth.collider.containsSurface(p,i))simulationInside++;
    for(let i=0;i<display.array.length;i+=3)if(cloth.collider.containsSurface(display.array,i))displayInside++;
    for(let i=0;i<index.count;i+=3){
      const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
      probe[0]=(display.getX(a)+display.getX(b)+display.getX(c))/3;probe[1]=(display.getY(a)+display.getY(b)+display.getY(c))/3;probe[2]=(display.getZ(a)+display.getZ(b)+display.getZ(c))/3;
      if(cloth.collider.containsSurface(probe)){facesInside++;if(contacts.length<5)contacts.push(Array.from(probe));}
    }
    return {simulationInside,displayInside,facesInside,hemAboveFloor,vertices:display.count,contacts,ropes:cloth.ropes.stats};
  })()`);
  console.log('Horse triangle contacts',JSON.stringify(result));
  for(let view=0;view<4;view++){
    await run(`(()=>{const {camera,controls,featherRenderer,scene}=peelDebug;controls.autoRotate=false;controls.enableDamping=false;camera.position.set(8*Math.sin(${view}*Math.PI/2),5,8*Math.cos(${view}*Math.PI/2)).add(controls.target);controls.update();featherRenderer.render(scene,camera);})()`);
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/oxide-horse-contact-${view}${mobile?'-mobile':''}.png`,Buffer.from(shot.result.data,'base64'));
  }
  assert(result.hemAboveFloor===0,'The hem must reach below the horse’s lowest limbs');
  assert(result.simulationInside<4&&result.displayInside<4&&result.facesInside<4,'The cloth must stay outside actual horse triangles: '+JSON.stringify(result));
  await run("while(document.querySelector('#cloth-rope-list button'))document.querySelector('#cloth-rope-list button').click();document.querySelector('[data-metal=iron]').click();document.querySelector('[data-shape=cube]').click()");
}

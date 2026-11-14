export async function checkMazeMaps({run,call,assert}){
  await run("document.querySelector('[data-shape=maze]').click();document.getElementById('feather-material').click();document.getElementById('maze-enter').click()");
  assert(await run("peelDebug.state.mazeMap==='garden'&&document.querySelector('[data-shape=maze] span').textContent==='Maze 1/2'&&peelDebug.mazeNavigation.active"));
  await run(`window.previousMazeRoom=peelDebug.mazeNavigation.room;window.gardenVertices=peelDebug.core.geometry.attributes.position.count;window.roomDisposed=0;previousMazeRoom.floor.geometry.addEventListener('dispose',()=>roomDisposed++);peelDebug.feathers.launchAll();document.querySelector('[data-shape=maze]').click()`);
  assert(await run("peelDebug.state.mazeMap==='observatory'&&!peelDebug.mazeNavigation.active&&peelDebug.feathers.flyingCount===0&&roomDisposed===1&&previousMazeRoom.group.parent===null&&previousMazeRoom.lantern.parent===null"),'Switching removes the old room and airborne feathers');
  assert(await run("peelDebug.core.geometry.attributes.position.count!==gardenVertices&&document.querySelector('[data-shape=maze] span').textContent==='Maze 2/2'"),'The second map changes the actual geometry and label');
  await run("document.getElementById('maze-enter').click()");
  assert(await run("peelDebug.mazeNavigation.active&&peelDebug.mazeNavigation.walker.goalLabel==='northern observatory'&&peelDebug.mazeNavigation.walker.canStand(peelDebug.mazeNavigation.walker.position.x,peelDebug.mazeNavigation.walker.position.z)&&peelDebug.core.material===peelDebug.mazeNavigation.room.interior.wallMaterial"),'The alternative map has fresh navigation and space materials');
  const before=await run('peelDebug.mazeNavigation.walker.position.toArray()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
  await run('for(let i=0;i<25;i++)peelDebug.mazeNavigation.update(1/60)');
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});
  assert(await run(`Math.hypot(peelDebug.mazeNavigation.walker.position.x-${before[0]},peelDebug.mazeNavigation.walker.position.z-${before[2]})>.03`));
  await run("document.querySelector('[data-fpv-exit]').click();document.querySelector('[data-shape=maze]').click()");
  assert(await run("peelDebug.state.mazeMap==='garden'&&peelDebug.core.geometry.attributes.position.count===gardenVertices"),'Cycling restores the original map');
  await run("for(let i=0;i<4;i++)document.querySelector('[data-shape=maze]').click()");
  assert(await run("peelDebug.scene.getObjectsByProperty('name','Maze interior').length===1&&peelDebug.scene.getObjectsByProperty('name','Carried lantern').length===1"),'Repeated switching does not accumulate rooms or lights');
  await run("document.querySelector('[data-metal=iron]').click();document.querySelector('[data-shape=cube]').click()");
}


export async function checkCourtyardShortcut({run,assert}){
  await run("document.querySelector('[data-shape=maze]').click()");
  for(const id of ['garden','observatory']){
    await run("document.getElementById('maze-enter').click();document.querySelector('[data-fpv-courtyard]').click()");
    assert(await run(`peelDebug.state.mazeMap==='${id}'&&peelDebug.mazeNavigation.active&&peelDebug.mazeNavigation.walker.inCourtyard`),'The shortcut reaches the destination on '+id);
    assert(await run("document.querySelector('#maze-fpv [role=status]').textContent==='Destination reached'&&peelDebug.mazeNavigation.room.interior.ritual.stats.total>0"),'The ritual is visible immediately after clicking the shortcut');
    await run('for(let i=0;i<600;i++)peelDebug.mazeNavigation.room.interior.advance(1/60,peelDebug.camera);peelDebug.featherRenderer.render(peelDebug.scene,peelDebug.camera)');
    assert(await run('peelDebug.mazeNavigation.room.interior.ritual.stats.total===36'),'The full ritual awakens from the shortcut');
    await run("document.querySelector('[data-fpv-restart]').click()");
    assert(await run('!peelDebug.mazeNavigation.walker.inCourtyard'),'Back to entrance restores exploration');
    await run("document.querySelector('[data-fpv-courtyard]').click();document.querySelector('[data-fpv-exit]').click();document.querySelector('[data-shape=maze]').click()");
  }
  await run("document.querySelector('[data-shape=cube]').click()");
}

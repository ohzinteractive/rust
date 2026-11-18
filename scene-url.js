// Keep URL handling independent of the renderer so links can be tested without WebGL.
const routeKeys=['scene','object','view','metal','map'];
const booleanKeys=['rotate','playing','roaming','autoFov','cyclePlaying'];
const vectorKeys=['camera','target','rotation'];
const settingPrefixes=['set.','toggle.','radio.','seed.','color.','rope.'];
const ownsSetting=key=>booleanKeys.includes(key)||vectorKeys.includes(key)||settingPrefixes.some(prefix=>key.startsWith(prefix));
function readVector(value){
  const parts=value.split(',');
  return parts.length===3&&parts.every(part=>part.trim()!==''&&Number.isFinite(Number(part)))?parts.map(Number):null;
}
export function readSceneURL(href){
  const params=new URL(href).searchParams;
  const route=Object.fromEntries(routeKeys.map(key=>[key,params.get(key)]));
  let settings={};
  try{
    const value=JSON.parse(params.get('settings')??'{}');
    if(value&&typeof value==='object'&&!Array.isArray(value))settings=value;
  }catch{/* An incomplete or edited settings parameter falls back to defaults. */}
  // Read the old JSON format too, so existing shared links continue to open.
  const inputs=[],seeds=[],colors=[],ropes=[];
  for(const [key,value] of params){
    if(key.startsWith('set.'))inputs.push([key.slice(4),value]);
    if(key.startsWith('radio.'))inputs.push(['radio:'+key.slice(6),value]);
    if(key.startsWith('toggle.')&&['true','false'].includes(value))inputs.push([key.slice(7),value==='true']);
    if(key.startsWith('seed.')&&value.trim()!==''&&Number.isSafeInteger(Number(value)))seeds.push([key.slice(5),Number(value)]);
    if(key.startsWith('color.')&&/^[\da-f]{6}$/i.test(value))colors.push([key.slice(6),'#'+value]);
    if(/^rope\.\d+$/.test(key)){
      const [id,style,...numbers]=value.split(',');
      if(numbers.length===5&&numbers.every(number=>number.trim()!==''&&Number.isFinite(Number(number)))&&Number.isSafeInteger(Number(id))){
        const [height,tightness,width,turns,span]=numbers.map(Number);
        ropes.push({id:Number(id),style,height,tightness,width,turns,span});
      }
    }
  }
  if(inputs.length)settings.inputs={...settings.inputs,...Object.fromEntries(inputs)};
  if(seeds.length)settings.seeds={...settings.seeds,...Object.fromEntries(seeds)};
  if(colors.length)settings.colors={...settings.colors,...Object.fromEntries(colors)};
  if(ropes.length)settings.ropes=ropes;
  for(const key of booleanKeys)if(['true','false'].includes(params.get(key)))settings[key]=params.get(key)==='true';
  const position=readVector(params.get('camera')??''),target=readVector(params.get('target')??'');
  if(position&&target)settings.camera={position,target};
  const rotation=readVector(params.get('rotation')??'');
  if(rotation)settings.rotation=rotation;
  return {...route,settings};
}

export function writeSceneURL(href,{settings={},...route}){
  const url=new URL(href);
  for(const key of [...url.searchParams.keys()])if(key==='settings'||ownsSetting(key))url.searchParams.delete(key);
  for(const key of routeKeys){
    if(route[key])url.searchParams.set(key,route[key]);else url.searchParams.delete(key);
  }
  for(const [key,value] of Object.entries(settings.inputs??{})){
    const name=key.startsWith('radio:')?'radio.'+key.slice(6):typeof value==='boolean'?'toggle.'+key:'set.'+key;
    url.searchParams.set(name,String(value));
  }
  for(const [key,value] of Object.entries(settings.seeds??{}))url.searchParams.set('seed.'+key,String(value));
  for(const [key,value] of Object.entries(settings.colors??{}))url.searchParams.set('color.'+key,value.replace(/^#/,''));
  for(const [index,rope] of (settings.ropes??[]).entries()){
    url.searchParams.set('rope.'+index,[rope.id,rope.style,rope.height,rope.tightness,rope.width,rope.turns,rope.span].join(','));
  }
  for(const key of booleanKeys)if(typeof settings[key]==='boolean')url.searchParams.set(key,String(settings[key]));
  if(settings.camera){
    const coordinates=vector=>vector.map(value=>Number(value.toFixed(3))).join(',');
    url.searchParams.set('camera',coordinates(settings.camera.position));
    url.searchParams.set('target',coordinates(settings.camera.target));
  }
  if(settings.rotation)url.searchParams.set('rotation',settings.rotation.join(','));
  // Commas are valid in query values; leave vector coordinates readable.
  url.search=url.search.replace(/%2C/gi,',');
  return url;
}

export function createSceneURLSync({window,getState,restore}){
  let timer,ready=false,lastRoute;
  const routeKey=value=>JSON.stringify(routeKeys.map(key=>value[key]??null));
  function flush(){
    clearTimeout(timer);
    if(!ready)return;
    const value=getState(),nextRoute=routeKey(value),url=writeSceneURL(window.location.href,value);
    if(url.href!==window.location.href){
      // Section/object changes are navigable; sliders replace the current entry.
      const method=lastRoute!==undefined&&nextRoute!==lastRoute?'pushState':'replaceState';
      window.history[method](null,'',url);
    }
    lastRoute=nextRoute;
  }
  function schedule(){if(ready){clearTimeout(timer);timer=setTimeout(flush,120);}}
  async function start(){
    await restore(readSceneURL(window.location.href));
    ready=true;flush();
    // A fresh load resets simulations and applies the destination's settings cleanly.
    window.addEventListener('popstate',()=>{ready=false;clearTimeout(timer);window.location.reload();});
    window.addEventListener('pagehide',flush);
  }
  return {start,schedule,flush};
}

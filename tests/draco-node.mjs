// Run the vendored decoder's worker code in a Node VM for geometry/physics tests.
// The browser suite exercises the same code in real Web Workers.
import {readFile} from 'node:fs/promises';
import {resolveObjectURL} from 'node:buffer';
import {runInNewContext} from 'node:vm';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {DRACOLoader} from '../vendor/DRACOLoader.js';

class DecoderWorker{
  constructor(url){
    const self={WebAssembly,console,TextDecoder,TextEncoder,postMessage:message=>queueMicrotask(()=>this.onmessage?.({data:message}))};
    self.self=self;
    this.ready=resolveObjectURL(url).text().then(source=>{
      runInNewContext(source,self);
      return self;
    });
  }
  postMessage(message){this.ready.then(self=>self.onmessage({data:message}));}
  terminate(){}
}
globalThis.Worker??=DecoderWorker;

class NodeDRACOLoader extends DRACOLoader{
  async _loadLibrary(name,type){
    const bytes=await readFile(new URL('../vendor/draco/'+name,import.meta.url));
    return type==='text'?bytes.toString():bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  }
}

export async function parseGLB(bytes){
  const decoder=new NodeDRACOLoader().setWorkerLimit(1);
  try{
    return await new GLTFLoader().setDRACOLoader(decoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  }finally{decoder.dispose();}
}

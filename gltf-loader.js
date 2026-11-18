import {GLTFLoader} from './vendor/GLTFLoader.js';
import {DRACOLoader} from './vendor/DRACOLoader.js';

// One worker pool and decoder download shared by every scene. Decoder libraries
// are fetched lazily, only when a model actually uses Draco compression.
const dracoLoader=new DRACOLoader()
  .setDecoderPath(new URL('./vendor/draco/',import.meta.url).href)
  .setWorkerLimit(2);

export function createGLTFLoader(manager){
  return new GLTFLoader(manager).setDRACOLoader(dracoLoader);
}

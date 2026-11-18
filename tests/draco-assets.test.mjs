import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';

test('bundled GLBs require Draco and preserve usable fallback textures',async()=>{
  const folder=new URL('../samples/',import.meta.url);
  for(const name of (await readdir(folder)).filter(name=>name.endsWith('.glb'))){
    const bytes=await readFile(new URL(name,folder));
    assert.equal(bytes.readUInt32LE(8),bytes.length,name+': valid GLB length');
    const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
    assert(json.extensionsRequired.includes('KHR_draco_mesh_compression'),name+': uses Draco');
    for(const mesh of json.meshes)for(const primitive of mesh.primitives){
      const draco=primitive.extensions.KHR_draco_mesh_compression;
      assert(json.bufferViews[draco.bufferView].byteLength>0,name+': encoded geometry');
    }
    for(const texture of json.textures??[]){
      if(texture.extensions?.KHR_texture_basisu&&!json.extensionsRequired.includes('KHR_texture_basisu')){
        assert(['image/png','image/jpeg'].includes(json.images[texture.source]?.mimeType),name+': JPEG/PNG fallback for optional KTX2');
      }
    }
  }
});

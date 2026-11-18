import {traceMeshAperture} from './shape-gate-aperture.js';

self.onmessage = ({data:{triangles, anchorHeight}}) => {
 try {
  self.postMessage({aperture:traceMeshAperture(triangles, anchorHeight)});
 } catch (error) {
  self.postMessage({error:error.message});
 }
};

import * as T from 'three';

const fullscreenVertex=`
 varying vec2 vUv;
 void main(){
  vUv=uv;
  gl_Position=vec4(position.xy,0.0,1.0);
 }
`;

const depthGLSL=`
 #include <packing>
 uniform sampler2D sceneDepth;
 uniform vec2 depthSize;
 uniform vec2 clipPlanes;
 varying vec2 vUv;
 ivec2 depthPixel(vec2 uv){
  return clamp(ivec2(floor(uv*depthSize)),ivec2(0),ivec2(depthSize)-1);
 }
 float readDepth(ivec2 pixel){
  return texelFetch(sceneDepth,pixel,0).r;
 }
 float viewDepth(float depth){
  return perspectiveDepthToViewZ(depth,clipPlanes.x,clipPlanes.y);
 }
`;

const occlusionFragment=`
 ${depthGLSL}
 uniform vec2 projectionScale;

 vec3 viewPosition(ivec2 pixel,float depth){
  float z=viewDepth(depth);
  vec2 sampleCenter=(vec2(pixel)+.5)/depthSize;
  return vec3((sampleCenter*2.0-1.0)*(-z)/projectionScale,z);
 }
 vec3 viewPosition(ivec2 pixel){
  pixel=clamp(pixel,ivec2(0),ivec2(depthSize)-1);
  return viewPosition(pixel,readDepth(pixel));
 }

 void main(){
  ivec2 pixel=depthPixel(vUv);
  float depth=readDepth(pixel);
  if(depth>=1.0){gl_FragColor=vec4(1.0);return;}
  vec3 center=viewPosition(pixel,depth);
  float fade=1.0-smoothstep(13.0,18.0,-center.z);
  if(fade<=0.0){gl_FragColor=vec4(1.0);return;}
  ivec2 dx=ivec2(1,0),dy=ivec2(0,1);
  vec3 left=center-viewPosition(pixel-dx),right=viewPosition(pixel+dx)-center;
  vec3 down=center-viewPosition(pixel-dy),up=viewPosition(pixel+dy)-center;
  // Use the nearer neighbor in each axis to keep normals stable at silhouettes.
  vec3 normal=cross(abs(left.z)<abs(right.z)?left:right,abs(down.z)<abs(up.z)?down:up);
  normal=normalize(normal+vec3(0.0,0.0,1e-12));

  const float radius=.29;
  vec2 screenRadius=projectionScale*(radius/(-2.0*center.z));
  float rotation=6.2831853*fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
  float blocked=0.0;
  for(int i=0;i<12;i++){
   float turn=rotation+float(i)*2.3999632;
   float reach=.10+.90*pow((float(i)+.5)/12.0,1.25);
   vec2 uv=vUv+vec2(cos(turn),sin(turn))*screenRadius*reach;
   if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))continue;
   ivec2 samplePixel=depthPixel(uv);
   float sampleDepth=readDepth(samplePixel);
   if(sampleDepth>=1.0)continue;
   vec3 delta=viewPosition(samplePixel,sampleDepth)-center;
   float distanceToPoint=length(delta);
   float angle=max(0.0,(dot(normal,delta)-.009)/max(distanceToPoint,.001));
   blocked+=angle*(1.0-smoothstep(.025,radius,distanceToPoint));
  }
  float light=1.0-min(blocked*.29,.50)*fade;
  gl_FragColor=vec4(vec3(light),1.0);
 }
`;

const compositeFragment=`
 ${depthGLSL}
 uniform sampler2D sceneColor;
 uniform sampler2D ambientOcclusion;
 uniform vec2 occlusionSize;
 uniform vec2 fogRange;
 uniform vec3 sceneFogColor;

 void main(){
  vec4 color=texture2D(sceneColor,vUv);
  float depth=readDepth(depthPixel(vUv));
  float fog=0.0;
  if(depth<1.0){
   float referenceZ=viewDepth(depth);
   fog=smoothstep(fogRange.x,fogRange.y,-referenceZ);
   // The scene target stores linear fog. Restore it after display tone mapping.
   color.rgb=max(vec3(0.0),(color.rgb-sceneFogColor*fog)/max(.01,1.0-fog));
   vec2 pixel=vUv*occlusionSize;
   vec2 lowCenter=floor(pixel)+.5;
   float weightedLight=0.0,totalWeight=0.0;
   for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 samplePoint=lowCenter+vec2(float(x),float(y));
    vec2 uv=samplePoint/occlusionSize;
    float sampleZ=viewDepth(readDepth(depthPixel(uv)));
    float difference=abs(referenceZ-sampleZ);
    float depthWeight=1.0-smoothstep(.015,.11,difference);
    vec2 offset=samplePoint-pixel;
    float weight=depthWeight/(1.0+dot(offset,offset));
    weightedLight+=texture2D(ambientOcclusion,uv).r*weight;
    totalWeight+=weight;
   }
   if(totalWeight>.001)color.rgb*=weightedLight/totalWeight;
  }
  gl_FragColor=color;
  if(depth<1.0){
   #include <tonemapping_fragment>
  }
  #include <colorspace_fragment>
  gl_FragColor.rgb=mix(gl_FragColor.rgb,linearToOutputTexel(vec4(sceneFogColor,1.0)).rgb,fog);
 }
`;

export function createGateAmbientOcclusion(renderer){
 const sceneTarget=new T.WebGLRenderTarget(1,1,{
  type:T.HalfFloatType,depthTexture:new T.DepthTexture(1,1,T.UnsignedIntType),
  samples:Math.min(2,renderer.capabilities.maxSamples)
 });
 const aoTarget=new T.WebGLRenderTarget(1,1,{
  depthBuffer:false,minFilter:T.NearestFilter,magFilter:T.NearestFilter
 });
 const clipPlanes={value:new T.Vector2()}, depthSize={value:new T.Vector2(1,1)};
 const projectionScale={value:new T.Vector2()}, occlusionSize={value:new T.Vector2(1,1)};
 const fogRange={value:new T.Vector2()}, sceneFogColor={value:new T.Color()};
 const sceneDepth={value:sceneTarget.depthTexture};
 const settings={vertexShader:fullscreenVertex,depthTest:false,depthWrite:false};
 const estimate=new T.ShaderMaterial({
  ...settings,fragmentShader:occlusionFragment,toneMapped:false,
  uniforms:{sceneDepth,clipPlanes,depthSize,projectionScale}
 });
 const composite=new T.ShaderMaterial({
  ...settings,fragmentShader:compositeFragment,
  uniforms:{sceneDepth,clipPlanes,depthSize,occlusionSize,fogRange,sceneFogColor,sceneColor:{value:sceneTarget.texture},
   ambientOcclusion:{value:aoTarget.texture}}
 });
 const screen=new T.Scene(), screenCamera=new T.Camera();
 const quad=new T.Mesh(new T.PlaneGeometry(2,2),estimate);
 quad.frustumCulled=false;
 screen.add(quad);
 const size=new T.Vector2();

 return {
  render(scene,camera){
   renderer.getDrawingBufferSize(size);
   if(sceneTarget.width!==size.x||sceneTarget.height!==size.y){
    sceneTarget.setSize(size.x,size.y);
    aoTarget.setSize(Math.max(1,Math.ceil(size.x/2)),Math.max(1,Math.ceil(size.y/2)));
    depthSize.value.copy(size);
    occlusionSize.value.set(aoTarget.width,aoTarget.height);
   }
   clipPlanes.value.set(camera.near,camera.far);
   projectionScale.value.set(camera.projectionMatrix.elements[0],camera.projectionMatrix.elements[5]);
   fogRange.value.set(scene.fog?.near??camera.far,scene.fog?.far??camera.far+1);
   if(scene.fog)sceneFogColor.value.copy(scene.fog.color);

   renderer.setRenderTarget(sceneTarget);
   renderer.render(scene,camera);
   quad.material=estimate;
   renderer.setRenderTarget(aoTarget);
   renderer.render(screen,screenCamera);
   quad.material=composite;
   renderer.setRenderTarget(null);
   renderer.render(screen,screenCamera);
  }
 };
}

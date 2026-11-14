export const featherPreset1 = Object.freeze({
  density:4,
  settings:Object.freeze({style:'plume',length:2,width:1.9,detail:1,angle:46,opacity:1,
    shadow:.84,subsurface:.35,breeze:0,windDirection:0,lift:22,flowDirection:0,skinColor:'#c68f79',
    generations:2,axiom:'X',ruleX:'F[+X][-X]',ruleF:'FF',branchLength:1,branchRandomness:1})
});

export const defaultFeatherDensity = featherPreset1.density;
export const defaultFeatherSettings = featherPreset1.settings;

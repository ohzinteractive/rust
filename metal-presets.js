// Artistic material profiles. Rates are relative animation speeds, not physical units.
export const metalPresets = {
  iron: {name:'Iron',symbol:'Fe',finish:'Rust',rate:1,patina:0,passivation:0,roughness:.48,depositRoughness:.97,relief:1,bareFlaking:1,
    colors:{metal:'#343936',dark:'#241610',burnt:'#70371f',orange:'#b95b28',gold:'#b28a45'}},
  copper: {name:'Copper',symbol:'Cu',finish:'Patina',rate:.65,patina:1,passivation:0,roughness:.27,depositRoughness:.87,relief:.35,bareFlaking:0,
    colors:{metal:'#c58253',dark:'#203b30',burnt:'#643b25',orange:'#468d76',gold:'#8fbba0'}},
  bronze: {name:'Bronze',symbol:'Cu–Sn',finish:'Patina',rate:.5,patina:1,passivation:0,roughness:.35,depositRoughness:.91,relief:.45,bareFlaking:0,
    colors:{metal:'#a58a49',dark:'#283828',burnt:'#54442a',orange:'#627d49',gold:'#9aa36b'}},
  aluminum: {name:'Aluminum',symbol:'Al',finish:'Oxide',rate:.4,patina:0,passivation:1,roughness:.24,depositRoughness:.76,relief:.13,bareFlaking:0,
    colors:{metal:'#bbc3c6',dark:'#646c70',burnt:'#959d9f',orange:'#c4c9c7',gold:'#e0e2dc'}}
};

export function corrosionRate(state) {
  const profile=metalPresets[state.metal]??metalPresets.iron;
  const slowing=profile.passivation?1/(1+state.age*4):1;
  return .0055*state.moisture*state.oxygen*(1+state.salt*2.6)*state.speed*profile.rate*slowing;
}

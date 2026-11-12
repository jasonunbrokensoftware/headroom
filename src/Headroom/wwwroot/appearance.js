// Theme ids match the portable settings allowlist. CSS owns the surface colors;
// these palettes are also used for account identities and their history plots.
export const themes = Object.freeze([
  {id:'ember',name:'Ember',description:'Copper, sand, and warm charcoal',swatches:['#f0ac78','#d4d788','#241e19'],chart:['#f0ac78','#d4d788','#e8a9bc','#81c9c0','#d4b2ed','#dbcbad','#df9589']},
  {id:'orchard',name:'Orchard',description:'Olive, citrus, and soft peach',swatches:['#c5db6a','#f0b17f','#202516'],chart:['#c5db6a','#f0b17f','#dba6cb','#83d0c0','#d9d6a7','#aabcea','#e6958b']},
  {id:'lagoon',name:'Lagoon',description:'Deep teal, sea glass, and coral',swatches:['#6dd4c7','#f2b785','#14292a'],chart:['#6dd4c7','#f2b785','#e4a1b3','#c9d78b','#a8b8ec','#ded1aa','#b9a4cf']},
  {id:'rosewood',name:'Rosewood',description:'Wine, dusty rose, and brass',swatches:['#e8a2ad','#dec17b','#302027'],chart:['#e8a2ad','#dec17b','#a8c9ad','#a9bfdc','#ccafe5','#e1ba9b','#aad6cf']},
  {id:'classic',name:'Classic',description:'Original slate, periwinkle, and mint',swatches:['#b2c1ff','#94ddbe','#191e27'],chart:['#aebeff','#92ddbd','#f2c785','#d2a5f4','#87cced','#ed9db3','#b9d58b']},
  {id:'graphite',name:'Graphite',description:'Simple black, gray, and silver',swatches:['#e0e0e0','#aaaaaa','#181818'],chart:['#e2e2e2','#9d9d9d','#c4c4c4','#818181','#b0b0b0','#f5f5f5','#8c8c8c']}
]);
export const resolveTheme = id => themes.find(theme=>theme.id===id) || themes[0];

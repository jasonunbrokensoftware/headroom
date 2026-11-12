// Theme ids match the portable settings allowlist. CSS owns the surface colors;
// these palettes are also used for account identities and their history plots.
export const themes = Object.freeze([
  {id:'ember',name:'Ember',description:'Copper, sand, and warm charcoal',swatches:['#f0ac78','#d4d788','#241e19'],chart:['#f0ac78','#d4d788','#e8a9bc','#81c9c0','#d4b2ed','#dbcbad','#df9589']},
  {id:'orchard',name:'Orchard',description:'Olive, citrus, and soft peach',swatches:['#c5db6a','#f0b17f','#202516'],chart:['#c5db6a','#f0b17f','#dba6cb','#83d0c0','#d9d6a7','#aabcea','#e6958b']},
  {id:'lagoon',name:'Lagoon',description:'Deep teal, sea glass, and coral',swatches:['#6dd4c7','#f2b785','#14292a'],chart:['#6dd4c7','#f2b785','#e4a1b3','#c9d78b','#a8b8ec','#ded1aa','#b9a4cf']},
  {id:'rosewood',name:'Rosewood',description:'Wine, dusty rose, and brass',swatches:['#e8a2ad','#dec17b','#302027'],chart:['#e8a2ad','#dec17b','#a8c9ad','#a9bfdc','#ccafe5','#e1ba9b','#aad6cf']}
]);
export const resolveTheme = id => themes.find(theme=>theme.id===id) || themes[0];

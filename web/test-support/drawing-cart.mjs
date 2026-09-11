// Tiny dependency-free WASM builder for ABI behavioral tests and browser upload.
const uleb = (value) => {
  const out=[]; do { const byte=value&127; value>>>=7; out.push(byte|(value?128:0)); } while(value); return out;
};
const sleb = (value) => {
  const out=[]; value|=0;
  while(true) { const byte=value&127; value>>=7; const done=(value===0 && !(byte&64)) || (value===-1 && !!(byte&64)); out.push(byte|(done?0:128)); if(done) return out; }
};
const vector = (items) => [...uleb(items.length),...items.flat()];
const name = (s) => {const b=[...new TextEncoder().encode(s)];return [...uleb(b.length),...b];};
const section = (id,b) => [id,...uleb(b.length),...b];
const arities={set_color_mode:1,rgba_cls:1,rgba_rect:5,rgba_text:6,clip:4,clip_reset:0,blit_region:14,set_palette:2,pixel:3,rect:5,cls:1,blit:8};
export function drawingCart({start=[['set_color_mode',1]],update=[['rgba_cls',0x123456ff]],data=[],instantiateStart=false}={}) {
  const imports=[...new Set([...start,...update].map(c=>c[0]))];
  const types=imports.map(n=>[0x60,...vector(Array(arities[n]).fill([0x7f])),0]);
  types.push([0x60,0,0]);
  const body = (calls) => {
    const b=[0,...calls.flatMap(([n,...args])=>[...args.flatMap(v=>[0x41,...sleb(v)]),0x10,...uleb(imports.indexOf(n))]),0x0b];
    return [...uleb(b.length),...b];
  };
  return new Uint8Array([0,97,115,109,1,0,0,0,
    ...section(1,vector(types)),
    ...section(2,vector(imports.map((n,i)=>[...name('calyx'),...name(n),0,...uleb(i)]))),
    ...section(3,vector([[...uleb(imports.length)],[...uleb(imports.length)]])),
    ...section(5,[1,1,1,...uleb(1024)]),
    ...section(7,vector([[...name('start'),0,...uleb(imports.length)],[...name('update'),0,...uleb(imports.length+1)],[...name('memory'),2,0]])),
    ...(instantiateStart?section(8,uleb(imports.length)):[]),
    ...section(10,vector([body(start),body(update)])),
    ...(data.length?section(11,[1,0,0x41,0,0x0b,...uleb(data.length),...data]):[]),
  ]);
}

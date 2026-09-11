import test from 'node:test';
import assert from 'node:assert/strict';
import { Framebuffer } from '../src/framebuffer.mjs';
import { Palette } from '../src/palette.mjs';
import { present } from '../src/canvas.mjs';

test('RGBA byte source-over, tint, opacity and palette fallback are exact', () => {
  const fb = new Framebuffer(3, 1, new Palette());
  fb.setColorMode(1);
  fb.rgbaCls(0x20406000);
  fb.rgbaRect(0,0,1,1,0xff000080);
  assert.deepEqual([...fb.px.slice(0,4)], [144,32,48,255]);
  fb.blitRegion(new Uint8Array([100,200,50,128]),1,1,0,0,1,1,1,0,1,1,8,0x80ff80,128);
  assert.deepEqual([...fb.px.slice(4,8)], [37,98,78,255]);
  fb.set(2,0,1);
  assert.deepEqual([...fb.px.slice(8)], [255,255,255,255]);
});

test('clip replaces scissor, clear bypasses it, reset and mode reset restore screen', () => {
  const fb = new Framebuffer(4,2);
  fb.clip(1,0,1,1); fb.rect(0,0,4,2,3);
  assert.deepEqual([...fb.px], [0,3,0,0,0,0,0,0]);
  fb.clip(3,1,1,1); fb.rect(0,0,4,2,4);
  assert.equal(fb.px[7],4);
  fb.cls(2); assert.ok(fb.px.every(v=>v===2));
  fb.clipReset(); fb.set(0,0,5); assert.equal(fb.px[0],5);
  fb.clip(0,0,0,0); fb.setColorMode(1); fb.rgbaRect(0,0,4,2,0xff0000ff);
  assert.equal(fb.px[0],255);
});

test('source region flip scaling and destination clipping preserve source coordinates', () => {
  const fb = new Framebuffer(4,1);
  fb.blitRegion(new Uint8Array([9,1,2,3,9]),5,1,1,0,3,1,-1,0,6,1,1,0xffffff,255);
  assert.deepEqual([...fb.px],[3,2,2,1]);
  fb.blit(new Uint8Array([7]),1,1,-2147483646,0,2147483647,1,0);
  assert.equal(fb.px[0],7);
});

test('truecolor canvas copies canonical RGBA bytes', () => {
  const fb = new Framebuffer(1,1); fb.setColorMode(1); fb.rgbaCls(0x12345600);
  let out;
  present({createImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData:img=>out=img.data},fb,new Palette());
  assert.deepEqual([...out],[18,52,86,255]);
});

import { drawingCart } from '../test-support/drawing-cart.mjs';
import { createHost, run } from '../src/runtime.mjs';
import { inspectLocalCart } from '../src/local-cart-profile.mjs';

test('bounded truecolor cart uploads at Classic resolution and reports its color', async () => {
  const wasm=drawingCart();
  assert.equal(WebAssembly.validate(wasm),true);
  inspectLocalCart(wasm);
  const host=await createHost(wasm);
  assert.equal(host.start(),null); assert.equal(host.stepLive(0).fault,undefined);
  assert.equal(host.fb.w,320); assert.equal(host.fb.h,240);
  assert.equal(host.fb.px.length,320*240*4);
  assert.deepEqual([...host.fb.px.slice(0,4)],[18,52,86,255]);
  assert.equal((await run(wasm,{frames:1})).color,'rgba8888');
  assert.equal(Object.hasOwn(await run(drawingCart({start:[],update:[]}),{frames:1}),'color'),false);
});

test('color selection traps outside actual start, on repeat and for unknown modes', async () => {
  await assert.rejects(createHost(drawingCart({instantiateStart:true})),/outside start/);
  for(const start of [[['set_color_mode',2]],[['set_color_mode',1],['set_color_mode',1]]]) {
    const host=await createHost(drawingCart({start})); assert.equal(host.start().kind,'trap');
  }
  const host=await createHost(drawingCart({start:[],update:[['set_color_mode',1]]}));
  assert.equal(host.start(),null); assert.equal(host.stepLive(0).fault.kind,'trap');
});

test('new draw validation traps even for empty or offscreen destination', async () => {
  const args=[0,1,1,0,0,1,1,999,999,0,0,8,0xffffff,255];
  for (const mutate of [a=>a[0]=65536,a=>a[11]=12,a=>a[12]=-1,a=>a[13]=256,a=>a[5]=2]) {
    const a=args.slice(); mutate(a);
    const h=await createHost(drawingCart({update:[['blit_region',...a]]}));
    assert.equal(h.start(),null); assert.equal(h.stepLive(0).fault.kind,'trap');
  }
  for(const update of [[['rgba_cls',0]],[['rgba_rect',0,0,0,0,0]],[['blit_region',...args]]]) {
    const h=await createHost(drawingCart({start:[],update})); h.start(); assert.equal(h.stepLive(0).fault.kind,'trap');
  }
});

test('alpha endpoints, opacity rounding and custom palette are exact through imports', async () => {
  for(const opacity of [0,1,127,128,254,255]) {
    const wasm=drawingCart({start:[['set_color_mode',1],['set_palette',0,1]],data:[100,200,50,200,100,50,128],
      update:[['rgba_cls',0x204060ff],['blit_region',3,1,1,0,0,1,1,0,0,1,1,8,0xffffff,opacity],['pixel',1,0,0]]});
    const h=await createHost(wasm,{w:2,h:1}); h.start(); assert.equal(h.stepLive(0).fault,undefined);
    const a=Math.floor((128*opacity+127)/255);
    assert.deepEqual([...h.fb.px],[...([200,100,50].map((s,i)=>Math.floor((s*a+[32,64,96][i]*(255-a)+127)/255))),255,100,200,50,255]);
  }
});

test('RGBA text shares glyph geometry and clips scaled blocks without unbounded loops', async () => {
  const rgba=await createHost(drawingCart({data:[65],update:[['rgba_text',0,0,0,1,0xffffffff,2]]}),{w:30,h:30});
  rgba.start(); assert.equal(rgba.stepLive(0).fault,undefined);
  const reference=new Framebuffer(30,30);
  const {Font,drawText}=await import('../src/font.mjs');
  drawText(reference,new Font(),0,0,new Uint8Array([65]),1,2);
  assert.deepEqual([...rgba.fb.px].filter((_,i)=>i%4===0),[...reference.px].map(v=>v?255:0));
  const huge=await createHost(drawingCart({data:[65],update:[['clip',1,1,1,1],['rgba_text',-2147483647,-2147483647,0,1,0xffffffff,2147483647]]}),{w:3,h:3});
  huge.start(); assert.equal(huge.stepLive(0).fault,undefined);
});

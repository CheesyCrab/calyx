// Host-owned indexed or canonical RGBA8888 framebuffer (ABI v1.6).
// RGB arithmetic is byte-exact, straight-alpha source-over onto opaque output.
import { hashBytes } from './fnv.mjs';
import { Palette } from './palette.mjs';

const rounded255 = (n) => Math.floor((n + 127) / 255);
// The uncommon huge-coordinate path must agree with Rust's integer division.
const nearest = (offset, extent, size) => {
  const product = offset * extent;
  // Below 2^52 division cannot round a fractional quotient up to an integer.
  return product <= 2 ** 52 ? Math.floor(product / size)
    : Number(BigInt(offset) * BigInt(extent) / BigInt(size));
};

export class Framebuffer {
  constructor(w, h, palette = new Palette()) {
    this.w = w;
    this.h = h;
    this.palette = palette;
    this.colorMode = 0;
    this.px = new Uint8Array(Math.max(0,w) * Math.max(0,h));
    this.clipReset();
  }

  setColorMode(mode) {
    this.colorMode = mode;
    this.px = new Uint8Array(Math.max(0,this.w) * Math.max(0,this.h) * (mode === 1 ? 4 : 1));
    this.clipReset();
    if (mode === 1) this.rgbaCls(0);
  }

  clipReset() { this.scissor = [0, 0, Math.max(0,this.w), Math.max(0,this.h)]; }
  clip(x,y,w,h) {
    this.scissor = w <= 0 || h <= 0 ? [0,0,0,0]
      : [Math.max(0,x),Math.max(0,y),Math.min(this.w,x+w),Math.min(this.h,y+h)];
  }
  bounds(x,y,w,h) {
    if (w <= 0 || h <= 0) return null;
    const [cx0,cy0,cx1,cy1] = this.scissor;
    const b = [Math.max(cx0,x),Math.max(cy0,y),Math.min(cx1,x+w),Math.min(cy1,y+h)];
    return b[0] < b[2] && b[1] < b[3] ? b : null;
  }
  set(x,y,idx) {
    if (!this.bounds(x,y,1,1)) return;
    const at = y*this.w+x;
    if (this.colorMode === 0) this.px[at] = idx & 255;
    else {
      const [r,g,b] = this.palette.rgb(idx & 255);
      this.writeRgb(at,r,g,b,255);
    }
  }
  writeRgb(pixel,r,g,b,a) {
    if (a === 0) return;
    const at = pixel*4;
    if (a === 255) { this.px[at]=r; this.px[at+1]=g; this.px[at+2]=b; }
    else {
      const inverse = 255-a;
      this.px[at]=rounded255(r*a+this.px[at]*inverse);
      this.px[at+1]=rounded255(g*a+this.px[at+1]*inverse);
      this.px[at+2]=rounded255(b*a+this.px[at+2]*inverse);
    }
    this.px[at+3]=255;
  }
  cls(idx) {
    if (this.colorMode === 0) this.px.fill(idx & 255);
    else {
      const [r,g,b] = this.palette.rgb(idx & 255);
      this.rgbaCls((r<<24)|(g<<16)|(b<<8));
    }
  }
  rgbaCls(rgba) {
    const r=rgba>>>24, g=(rgba>>>16)&255, b=(rgba>>>8)&255;
    for (let at=0;at<this.px.length;at+=4) {
      this.px[at]=r;this.px[at+1]=g;this.px[at+2]=b;this.px[at+3]=255;
    }
  }
  rect(x,y,w,h,idx) {
    const b=this.bounds(x,y,w,h); if(!b) return;
    if (this.colorMode === 1) {
      const [r,g,blue]=this.palette.rgb(idx&255);
      this.rgbaRect(x,y,w,h,(r<<24)|(g<<16)|(blue<<8)|255); return;
    }
    const [x0,y0,x1,y1]=b;
    for(let yy=y0;yy<y1;yy++) this.px.fill(idx&255,yy*this.w+x0,yy*this.w+x1);
  }
  rgbaRect(x,y,w,h,rgba) {
    const b=this.bounds(x,y,w,h); if(!b) return;
    const [x0,y0,x1,y1]=b;
    const r=rgba>>>24,g=(rgba>>>16)&255,blue=(rgba>>>8)&255,a=rgba&255;
    for(let yy=y0;yy<y1;yy++) for(let xx=x0;xx<x1;xx++) this.writeRgb(yy*this.w+xx,r,g,blue,a);
  }
  hline(x,y,w,idx) { this.rect(x,y,w,1,idx); }
  vline(x,y,h,idx) { this.rect(x,y,1,h,idx); }

  blit(src,sw,sh,x,y,dw,dh,flags) {
    this.blitRegion(src,sw,sh,0,0,sw,sh,x,y,dw,dh,flags&7,0xffffff,255);
  }
  // Host validates memory, source rectangle and flags before entering this loop.
  blitRegion(src,sw,sh,sx,sy,rw,rh,x,y,dw,dh,flags,tint,opacity) {
    if(sw<=0 || sh<=0 || rw<=0 || rh<=0) return;
    const b=this.bounds(x,y,dw,dh); if(!b) return;
    const [x0,y0,x1,y1]=b;
    const flipX=!!(flags&1),flipY=!!(flags&2),key=!!(flags&4),rgba=!!(flags&8);
    const tr=(tint>>>16)&255,tg=(tint>>>8)&255,tb=tint&255;
    // Preserve the indexed row-copy path used by existing HD carts.
    if(this.colorMode===0 && !flipX && !key && dw===rw && dh===rh) {
      for(let yy=y0;yy<y1;yy++) {
        const iy=sy+(flipY?rh-1-(yy-y):yy-y);
        const start=iy*sw+sx+x0-x;
        const count=Math.max(0,Math.min(x1-x0,src.length-start));
        if(count) this.px.set(src.subarray(start,start+count),yy*this.w+x0);
      }
      return;
    }
    for(let yy=y0;yy<y1;yy++) {
      let iy=nearest(yy-y,rh,dh); if(flipY) iy=rh-1-iy;
      iy+=sy;
      for(let xx=x0;xx<x1;xx++) {
        let ix=nearest(xx-x,rw,dw); if(flipX) ix=rw-1-ix;
        ix+=sx;
        const sourceAt=(iy*sw+ix)*(rgba?4:1);
        if(sourceAt<0 || sourceAt+(rgba?4:1)>src.length) continue;
        const index=src[sourceAt]; if(key && index===0) continue;
        const pixel=yy*this.w+xx;
        if(this.colorMode===0) {this.px[pixel]=index;continue;}
        const [r,g,blue]=rgba ? [index,src[sourceAt+1],src[sourceAt+2]] : this.palette.rgb(index);
        const a=rounded255((rgba?src[sourceAt+3]:255)*opacity);
        this.writeRgb(pixel,rounded255(r*tr),rounded255(g*tg),rounded255(blue*tb),a);
      }
    }
  }
  hash() { return hashBytes(this.px); }
}

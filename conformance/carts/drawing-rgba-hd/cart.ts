// Direct ABI fixture, independent from Sunny's convenience wrappers.
@external("calyx", "set_color_mode") declare function mode(m:i32):void;
@external("calyx", "rgba_cls") declare function clear(c:i32):void;
@external("calyx", "rgba_rect") declare function rect(x:i32,y:i32,w:i32,h:i32,c:i32):void;
@external("calyx", "rgba_text") declare function text(x:i32,y:i32,p:i32,n:i32,c:i32,s:i32):void;
@external("calyx", "clip") declare function clip(x:i32,y:i32,w:i32,h:i32):void;
@external("calyx", "clip_reset") declare function reset():void;
@external("calyx", "blit_region") declare function region(p:i32,sw:i32,sh:i32,sx:i32,sy:i32,rw:i32,rh:i32,x:i32,y:i32,dw:i32,dh:i32,f:i32,t:i32,o:i32):void;
@external("calyx", "blit") declare function blit(p:i32,sw:i32,sh:i32,x:i32,y:i32,dw:i32,dh:i32,f:i32):void;
@external("calyx", "set_palette") declare function palette(p:i32,n:i32):void;
@external("calyx", "rect") declare function indexed(x:i32,y:i32,w:i32,h:i32,c:i32):void;
@external("calyx", "cls") declare function cls(c:i32):void;
@external("calyx", "frame") declare function frame():i32;
const rgba:StaticArray<u8>=[255,0,0,0, 0,255,0,1, 0,0,255,127, 255,255,0,128, 0,255,255,254, 255,0,255,255];
const indices:StaticArray<u8>=[0,1,2,3,2,1];
const colors:StaticArray<u8>=[7,19,31, 211,23,17, 43,197,61, 71,83,229];
export function start():void { mode(1); palette(changetype<i32>(colors),4); }
export function update():void {
 const f=frame(); reset(); clear(0x112233ff);
 indexed(0,0,23,19,2);
 rect(2,3,18,14,0xef7f2180); rect(7,6,17,13,0x137deb7f);
 clip(4,4,49,31);
 region(changetype<i32>(rgba),3,2,1,0,2,2,-3+f,8,31,23,8|(f&3),0x80ccff,127+f);
 region(changetype<i32>(indices),3,2,0,0,3,2,24,6,27,25,4|(f&3),0xff80cc,254);
 const msg=String.UTF8.encode("RGBA"); text(8,22,changetype<i32>(msg),msg.byteLength,0xf0d06080,1);
 reset(); blit(changetype<i32>(indices),3,2,60,8,29,17,f&7);
 // Extreme endpoints must stay bounded by the screen, with exact mapping.
 region(changetype<i32>(rgba),3,2,0,0,3,2,2147483647,0,2147483647,2147483647,8,0xffffff,255);
 clip(0,0,0,1); rect(0,0,2147483647,2147483647,-1); reset();
 rect(72+f,36,5,7,0xdeadbeff);
}

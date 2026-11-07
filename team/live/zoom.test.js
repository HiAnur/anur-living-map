import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf("canvas.addEventListener('wheel'"), html.indexOf('\nfunction enter(id)'));
function harness(){
  let wheel;
  const cam = {x:20,y:30,z:1};
  vm.runInNewContext(source, {
    cam, canvas:{addEventListener(type,handler){wheel=handler;}, getBoundingClientRect:()=>({left:10,top:15,height:800})},
    toStage:(x,y)=>[(x-10-cam.x)/cam.z,(y-15-cam.y)/cam.z], place(){},
  });
  return {cam, wheel:(deltaY,extra={})=>wheel({deltaX:0,deltaY,deltaMode:0,ctrlKey:true,clientX:400,clientY:300,preventDefault(){},...extra})};
}
describe('trackpad zoom',()=>{
  it('makes tiny pinches small and independent of event frequency',()=>{
    const small=harness();small.wheel(-1);expect(small.cam.z).toBeGreaterThan(1);expect(small.cam.z).toBeLessThan(1.003);
    const many=harness(),one=harness();for(let i=0;i<20;i++)many.wheel(-1);one.wheel(-20);
    expect(many.cam.z).toBeCloseTo(one.cam.z,12);expect(many.cam.z).toBeLessThan(1.05);
  });
  it('keeps the point under the pointer still and reverses equal gestures',()=>{
    const h=harness();h.wheel(-20);
    expect((400-10-h.cam.x)/h.cam.z).toBeCloseTo(370);expect((300-15-h.cam.y)/h.cam.z).toBeCloseTo(255);
    h.wheel(20);expect(h.cam.z).toBeCloseTo(1);expect(h.cam.x).toBeCloseTo(20);expect(h.cam.y).toBeCloseTo(30);
    h.wheel(0);expect(h.cam.z).toBeCloseTo(1);
  });
  it('normalizes wheel units and limits extreme events and total zoom',()=>{
    const lines=harness(),pixels=harness();lines.wheel(-1,{deltaMode:1});pixels.wheel(-16);expect(lines.cam.z).toBeCloseTo(pixels.cam.z);
    const h=harness();h.wheel(-10000);expect(h.cam.z).toBeLessThan(1.18);
    for(let i=0;i<100;i++)h.wheel(-10000);expect(h.cam.z).toBe(2.5);
    for(let i=0;i<100;i++)h.wheel(10000);expect(h.cam.z).toBe(.3);
  });
  it('keeps two-finger scrolling as pan without changing zoom',()=>{
    const h=harness();h.wheel(12,{ctrlKey:false,deltaX:7});expect(h.cam).toEqual({x:13,y:18,z:1});
  });
});

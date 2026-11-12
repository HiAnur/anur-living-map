import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('/** Frames the view:'),html.indexOf('// a database is drawn'));
describe('fitting a narrow map',()=>{
  for(const width of [318,360,600]) it(`fits inside the ${width}px canvas without subtracting the docked pane twice`,()=>{
    const nodes=[{x:100,y:100},{x:310,y:100},{x:310,y:185}],cam={};
    const ctx=vm.createContext({cam,flowBox:()=>null,diagramBox:()=>null,scope:()=>({nodes}),edgesEl:{getBBox:()=>({width:0})},canvas:{getBoundingClientRect:()=>({width,height:700,top:80})},$:()=>({getBoundingClientRect:()=>({width:186,bottom:120}),classList:{contains:()=>true}}),prsOpen:false,place(){}});
    vm.runInContext(source,ctx);ctx.fit();expect(cam.z).toBeGreaterThan(0);
    for(const n of nodes){expect((n.x-70)*cam.z+cam.x).toBeGreaterThanOrEqual(0);expect((n.x+70)*cam.z+cam.x).toBeLessThanOrEqual(width);expect((n.y+25)*cam.z+cam.y).toBeLessThan(540);}
  });
});

describe('the reset zoom button', () => {
  const canvas = { getBoundingClientRect: () => ({ width: 1000, height: 800, top: 80 }) };
  const run = (nodes, cam) => {
    const ctx = vm.createContext({ cam, flowBox: () => null, diagramBox: () => null, scope: () => ({ nodes }), edgesEl: { getBBox: () => ({ width: 0 }) }, canvas, prsOpen: false, place() {} });
    vm.runInContext(source, ctx);
    ctx.readingSize();
    return cam;
  };
  // a map far larger than the screen: 4000 wide, 3000 tall
  const big = [{ x: 0, y: 0 }, { x: 4000, y: 3000 }];

  it('goes to 70% and keeps what was in the middle of the screen there', () => {
    // zoomed out to 20%, with the map point (2000, 1500) in the middle of the room the map has (508, 335)
    const cam = run(big, { z: 0.2, x: 508 - 2000 * 0.2, y: 335 - 1500 * 0.2 });
    expect(cam.z).toBe(0.7);
    expect(2000 * 0.7 + cam.x).toBeCloseTo(508);
    expect(1500 * 0.7 + cam.y).toBeCloseTo(335);
  });

  it('fills the screen to the edge of the map when the view was past it', () => {
    // the view had drifted far past the map's right and bottom edges
    const cam = run(big, { z: 0.5, x: -9000, y: -9000 });
    expect(cam.z).toBe(0.7);
    expect((4000 + 120) * 0.7 + cam.x).toBeCloseTo(1000 - 24);
    expect((3000 + 100) * 0.7 + cam.y).toBeCloseTo(800 - 160);
  });

  it('centres a map smaller than the screen, at 70% rather than enlarged', () => {
    const cam = run([{ x: 100, y: 100 }, { x: 300, y: 200 }], { z: 0.3, x: 700, y: -50 });
    expect(cam.z).toBe(0.7);
    expect(200 * 0.7 + cam.x).toBeCloseTo(508);
    expect(160 * 0.7 + cam.y).toBeCloseTo(335);
  });
});

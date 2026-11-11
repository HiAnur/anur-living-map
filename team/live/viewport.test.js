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

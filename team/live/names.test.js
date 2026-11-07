import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
describe('full topic names',()=>{
  it('counts every wrapped line including long words and explicit line breaks',()=>{
    const ctx=vm.createContext({W:()=>124,wraps:new Map(),ruler:{measureText:s=>({width:s.length*10})},document:{documentElement:{}},getComputedStyle:()=>({getPropertyValue:()=>''})});
    vm.runInContext(html.slice(html.indexOf('const nameLines ='),html.indexOf('document.fonts?.ready'))+'\nthis.lines=nameLines;',ctx);
    expect(ctx.lines({label:'short'})).toBe(1);
    expect(ctx.lines({label:'one two three four five six seven eight'})).toBe(5);
    expect(ctx.lines({label:'x'.repeat(80)})).toBe(8);
    expect(ctx.lines({label:'first\nsecond\nthird'})).toBe(3);
  });
});

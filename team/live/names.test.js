import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
describe('full topic names',()=>{
  it('counts every wrapped line including long words and explicit line breaks',()=>{
    const ctx=vm.createContext({W:()=>126,wraps:new Map(),ruler:{measureText:s=>({width:s.length*10})},document:{documentElement:{}},getComputedStyle:()=>({getPropertyValue:()=>''})});
    vm.runInContext(html.slice(html.indexOf('const nameLines ='),html.indexOf('document.fonts?.ready'))+'\nthis.lines=nameLines;',ctx);
    expect(ctx.lines({label:'short'})).toBe(1);
    expect(ctx.lines({label:'one two three four five six seven eight'})).toBe(5);
    expect(ctx.lines({label:'x'.repeat(80)})).toBe(8);
    expect(ctx.lines({label:'first\nsecond\nthird'})).toBe(3);
  });
});

describe('topic width',()=>{
  it('includes borders and fractional text widths before wrapping short titles',()=>{
    const ctx=vm.createContext({document:{documentElement:{},createElement:()=>({getContext:()=>({measureText:s=>({width:s.length*6.2})})})},getComputedStyle:()=>({getPropertyValue:()=>''})});
    vm.runInContext(html.slice(html.indexOf('const BASE ='),html.indexOf('document.fonts?.ready'))+'\nthis.width=W;this.lines=nameLines;',ctx);
    for(const label of ['Local rules and money','Partners and people','The 4-slot gifting box']){
      expect(ctx.width({label})-26).toBeGreaterThan(label.length*6.2);
      expect(ctx.lines({label})).toBe(1);
    }
    expect(ctx.width({label:'A very long title that should still wrap into multiple lines'})).toBe(220);
    expect(ctx.lines({label:'A very long title that should still wrap into multiple lines'})).toBeGreaterThan(1);
  });
});

describe('compact box details', () => {
  it('keeps descriptions out of box sizing and hides restricted summaries', () => {
    const ctx = vm.createContext({ nameLines: () => 1, locked: n => !!n.locked });
    vm.runInContext(html.slice(html.indexOf('const HT ='), html.indexOf('const { fanPts, planTopicInsert }')) + '\nthis.height=HT;this.summary=boxSummary;', ctx);
    expect(ctx.height({ label: 'Sign in', sub: 'Long description '.repeat(40) })).toBe(ctx.height({ label: 'Sign in' }));
    expect(ctx.summary({ sub: 'A keeper makes an account' })).toBe('A keeper makes an account');
    expect(ctx.summary({ desc: 'Full details' })).toBe('Full details');
    expect(ctx.summary({ locked: true, sub: 'Private summary', note: 'Private note', state: 'assumed-gone' })).toBe('');
    expect(ctx.summary({ desc: 'a'.repeat(601) })).toBe('a'.repeat(600) + '…');
  });
});

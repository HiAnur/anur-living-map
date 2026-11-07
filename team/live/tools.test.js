import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
describe('pointer tool shortcut',()=>{
  it('switches Hand to Select, clears temporary panning and updates the toolbar',()=>{
    let handler;const classes=new Set(['hand','grabbing','spacepan']),active=new Set();
    const ctx=vm.createContext({tool:'hand',spaceDown:true,panning:{},draft:null,PREVIEW:null,render(){},
      canvas:{classList:{remove(...names){names.forEach(n=>classes.delete(n));},toggle(n,on){if(on)classes.add(n);else classes.delete(n);}}},
      document:{addEventListener(type,f){handler=f;},querySelectorAll:()=>['select','hand'].map(tool=>({dataset:{tool},classList:{toggle(n,on){if(on)active.add(tool);else active.delete(tool);}}}))},
    });
    vm.runInContext(html.slice(html.indexOf('function setTool('),html.indexOf('\n',html.indexOf('function setTool('))),ctx);
    vm.runInContext(html.slice(html.indexOf('const TOOL_KEYS ='),html.indexOf("document.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ draft")),ctx);
    handler({key:'v',code:'KeyV',target:{closest:()=>false},preventDefault(){}});
    expect(ctx.tool).toBe('select');expect(ctx.spaceDown).toBe(false);expect(ctx.panning).toBeNull();expect([...active]).toEqual(['select']);expect(classes.size).toBe(0);
    ctx.tool='hand';handler({key:'v',code:'KeyV',target:{closest:()=>true},preventDefault(){}});expect(ctx.tool).toBe('hand');
  });
});

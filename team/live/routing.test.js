import { describe, expect, it } from 'vitest';

import { layoutFor } from './page-layout.js';

const ctx=/** @type {any} */ (layoutFor({W:n=>n.w,HT:n=>n.h||50}));

describe('shared branch stems',()=>{
  it.each([1,-1])('keeps two unequal children on one stem facing %s',dir=>{
    const parent={x:0,y:0,w:140},widePeer={x:0,y:-200,w:220};
    const top={x:210*dir,y:-43,w:140},bottom={x:210*dir,y:42,w:188};
    const nodes=[parent,widePeer,top,bottom];
    const a=ctx.fanPts(parent,top,nodes),b=ctx.fanPts(parent,bottom,nodes);
    expect(a).not.toBeNull();expect(b).not.toBeNull();
    expect(a[1][0]).toBe(b[1][0]);expect(a[2][0]).toBe(b[2][0]);
    expect(a[1][0]*dir).toBeGreaterThanOrEqual(84);
    expect(b.at(-1)[0]*dir-b[2][0]*dir).toBeGreaterThanOrEqual(14);
  });
  it('keeps obstacle routing when a shared stem would cross a box',()=>{
    const parent={x:0,y:0,w:140},child={x:250,y:150,w:140},obstacle={x:84,y:75,w:30,h:30};
    expect(ctx.fanPts(parent,child,[parent,child,obstacle])).toBeNull();
  });
});

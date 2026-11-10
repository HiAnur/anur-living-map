import { describe, expect, it } from 'vitest';

import { imageExportSize } from './page-share.js';

const ctx={ imageExportSize };
describe('map image export size',()=>{
  it('renders ordinary maps at double resolution',()=>{
    expect(ctx.imageExportSize(600,400)).toEqual({width:1200,height:800});
  });
  it('keeps wide and tall maps within browser image limits',()=>{
    for(const [width,height] of [[100000,500],[500,100000],[20000,20000]]){
      const size=ctx.imageExportSize(width,height);
      expect(size.width).toBeLessThanOrEqual(8192);expect(size.height).toBeLessThanOrEqual(8192);
      expect(size.width*size.height).toBeLessThanOrEqual(16000000);
      expect(Math.abs(size.width-width*(size.height/height))).toBeLessThanOrEqual(width/height+1);
    }
  });
});

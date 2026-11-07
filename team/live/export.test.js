import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function imageExportSize('),html.indexOf('const blobDataURL =')),ctx);
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

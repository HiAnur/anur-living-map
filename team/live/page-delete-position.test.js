import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('function positionDeletePrompt(');
const source = html.slice(start, html.indexOf('\n}', start) + 2);

describe('the delete confirmation stays on the canvas', () => {
  for (const z of [0.4, 1, 2.5]) {
    it(`fits all four edges without accumulating offsets at zoom ${z}`, () => {
      const bounds = { left: 40, top: 60, right: 640, bottom: 460, width: 600, height: 400 };
      const base = { left: -80, top: -30, width: 220, height: 110 };
      const style = { transform: '', maxWidth: '', maxHeight: '', overflow: '' };
      const rect = () => {
        const shift = /calc\(-50% \+ ([-\d.]+)px\), ([-\d.]+)px/.exec(style.transform);
        const left = base.left + Number(shift?.[1] || 0) * z, top = base.top + Number(shift?.[2] || 0) * z;
        const width = Math.min(base.width, parseFloat(style.maxWidth) * z), height = Math.min(base.height, parseFloat(style.maxHeight) * z);
        return { left, top, width, height, right: left + width, bottom: top + height };
      };
      const ctx = vm.createContext({ cam: { z }, canvas: { querySelector: () => ({ style, getBoundingClientRect: rect }), getBoundingClientRect: () => bounds } });
      vm.runInContext(source, ctx);
      for (const [left, top] of [[-80, -30], [600, 430], [200, 200]]) {
        Object.assign(base, { left, top });
        ctx.positionDeletePrompt();
        const first = rect();
        expect(first.left).toBeGreaterThanOrEqual(bounds.left + 12);
        expect(first.top).toBeGreaterThanOrEqual(bounds.top + 12);
        expect(first.right).toBeLessThanOrEqual(bounds.right - 12);
        expect(first.bottom).toBeLessThanOrEqual(bounds.bottom - 12);
        ctx.positionDeletePrompt();
        expect(rect()).toEqual(first);
      }
    });
  }
});

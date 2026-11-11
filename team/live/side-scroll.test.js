import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('function renderSide(){');
const source = html.slice(start, html.indexOf('  const calls = S.calls.filter', start)) + '}';

describe('leaving Side Chat', () => {
  for (const kind of ['proposal', 'restricted', 'closed']) {
    it(`clears the chat-only layout when opening ${kind}`, () => {
      const classes = new Set(['on', 'sc']);
      const pane = { innerHTML: '', classList: {
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      } };
      const box = { id: 'box', label: 'Review proposal', sub: 'A long description', desc: 'Details' };
      const ctx = vm.createContext({
        $: id => id === 'side' ? pane : null,
        keyboardSelection: false, selected: kind === 'closed' ? null : 'box', sideRename: null,
        nodeById: () => kind === 'restricted' ? box : null,
        proposedBox: () => kind === 'proposal' ? box : null,
        locked: () => kind === 'restricted',
        esc: s => s, prose: s => s, notes: s => s,
        proposalOf: () => '<button>Apply</button>',
        S: { people: [] }, ICON: { lock: '' }, me: () => ({ sees: 'one branch' }),
      });
      vm.runInContext(source, ctx);
      ctx.renderSide();
      expect(classes.has('sc')).toBe(false);
      expect(classes.has('on')).toBe(kind !== 'closed');
      if (kind === 'proposal') expect(pane.innerHTML).toContain('<button>Apply</button>');
    });
  }
});

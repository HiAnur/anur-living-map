import { describe, expect, it } from 'vitest';

import { drawingPanel } from './page-drawing.js';

// The panel over a system map while it is drawn from code.

const esc = (/** @type {unknown} */ t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
const text = (/** @type {string} */ html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const now = 1_000_000;

describe('the drawing panel', () => {
  it('shows how far it is, how long it has taken and about how long is left, with Cancel, and no cost', () => {
    const html = drawingPanel({ status: 'running', at: now - 95_000, repos: 4, progress: [
      { repo: 'api', stage: 'done', facts: 170, boxes: 20, ms: 60_000, cost: { value: 0.21 } },
      { repo: 'bot', stage: 'drawing', facts: 766 },
      { repo: 'app', stage: 'waiting', facts: 17 },
      { repo: 'jobs', stage: 'reading' },
    ] }, { esc, now, mine: true });
    expect(text(html)).toContain('Drawing this map from code 1 of 4 repos · 1 min 35 s · about 1 min left');
    expect(text(html)).toContain('api 20 boxes from 170 facts');
    expect(html).not.toContain('$');
    expect(text(html)).toContain('bot Claude is grouping 766 facts');
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain('data-sd-cancel');
  });
  it('says what failed and why, offers to draw again, and lists what code could not read', () => {
    const html = drawingPanel({ status: 'failed', at: now - 9_000, ms: 9_000, repos: 2, cost: { value: 0 }, unread: [{ repo: 'ts', why: 'run `npx cdk synth` in it' }], progress: [
      { repo: 'api', stage: 'failed', error: 'Claude Code is signed out.' },
      { repo: 'ts', stage: 'done', boxes: 3, reused: true },
    ] }, { esc, now, mine: true });
    expect(text(html)).toContain('Some repos could not be drawn 2 of 2 repos · 9 s');
    expect(text(html)).toContain('api Claude Code is signed out.');
    expect(text(html)).toContain('ts 3 boxes, kept from the last drawing');
    expect(text(html)).toContain('ts: run `npx cdk synth` in it');
    expect(html).toContain('data-sd-ask');
  });
  it('says how much Claude proposed that code did not show, once done', () => {
    const html = drawingPanel({ status: 'done', at: 0, ms: 140_000, repos: 1, rejected: 2, cost: { value: 2.16 }, progress: [{ repo: 'api', stage: 'done', boxes: 20 }, { repo: 'platform', stage: 'done', boxes: 5 }] }, { esc, now, mine: true });
    expect(text(html)).toContain('Drawn from code 1 of 1 repos · 2 min 20 s');
    expect(text(html)).toContain('How the repos connect');
    expect(text(html)).toContain('2 things Claude proposed were left off: the code does not show them.');
    expect(html).toContain('data-sd-close');
    // Draw again asks first, saying it replaces what was changed by hand
    expect(html).toContain('data-sd-ask');
    expect(html).not.toContain('data-sd-retry');
    const asking = drawingPanel({ status: 'done', at: 0, ms: 1, repos: 1, progress: [] }, { esc, now, mine: true, asking: true });
    expect(asking).toContain('data-sd-retry');
    expect(text(asking)).toContain('What people changed stays');
  });
  it('offers nothing to someone who may only look', () => {
    const html = drawingPanel({ status: 'running', at: now, repos: 1, progress: [] }, { esc, now, mine: false });
    expect(html).not.toMatch(/data-sd-/);
  });
  it('says which repos have new commits since the drawing, once it is done', () => {
    const d = { status: 'done', at: now - 9_000, ms: 9_000, repos: 2, progress: [{ repo: 'api', stage: 'done', boxes: 3 }, { repo: 'site', stage: 'done', boxes: 2 }] };
    expect(text(drawingPanel(d, { esc, now, mine: true, changed: ['api'] }))).toContain('1 repo has new commits since this drawing: api.');
    expect(text(drawingPanel(d, { esc, now, mine: true, changed: ['api', 'site'] }))).toContain('2 repos have new commits since this drawing: api, site.');
    expect(text(drawingPanel({ ...d, status: 'running' }, { esc, now, mine: true, changed: ['api'] }))).not.toContain('new commits');
  });
  it('lists a redraw\'s changes for review, with Apply and Keep for whoever may redraw', () => {
    const d = { status: 'done', at: now - 9_000, ms: 9_000, repos: 1, progress: [{ repo: 'api', stage: 'done', boxes: 3 }] };
    const redraw = { count: 2, changes: [{ what: 'changed', kind: 'box', label: 'Order service', was: 'Orders' }, { what: 'gone', kind: 'line', label: 'web → api' }] };
    const html = drawingPanel(d, { esc, now, mine: true, redraw });
    expect(text(html)).toContain('Code no longer finds 2 things They stay on the map until applied');
    expect(text(html)).toContain('Changes Orders → Order service');
    expect(text(html)).toContain('Takes away the line web → api');
    expect(html).toContain('data-sd-apply'); expect(html).toContain('data-sd-dismiss');
    expect(html).not.toContain('data-sd-ask');
    expect(drawingPanel(d, { esc, now, mine: false, redraw })).not.toContain('data-sd-apply');
  });
});

describe('closing the panel', () => {
  const done = { status: 'done', at: 0, ms: 1, repos: 1, progress: [{ repo: 'api', stage: 'done', boxes: 3 }] };
  it('offers a close at the top to anyone once the drawing is done', () => {
    expect(drawingPanel(done, { esc, now, mine: false })).toMatch(/<div class="sd-h">.*data-sd-close/s);
    expect(drawingPanel(done, { esc, now, mine: true })).toMatch(/<div class="sd-h">.*data-sd-close/s);
  });
  it('offers none while drawing, nor on a redraw waiting for whoever may apply it', () => {
    expect(drawingPanel({ ...done, status: 'running', at: now }, { esc, now, mine: true })).not.toContain('data-sd-close');
    const redraw = { count: 1, changes: [{ what: 'gone', kind: 'box', label: 'Old' }] };
    expect(drawingPanel(done, { esc, now, mine: true, redraw })).not.toContain('data-sd-close');
    expect(drawingPanel(done, { esc, now, mine: false, redraw })).toContain('data-sd-close');
  });
});

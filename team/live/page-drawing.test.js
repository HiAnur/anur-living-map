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
});

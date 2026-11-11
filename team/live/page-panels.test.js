import { describe, expect, it } from 'vitest';

import { commentScreens } from './page-comments.js';
import { historyScreens } from './page-history.js';

// The comments' and History's HTML, called as the page calls them, with its helpers stood in for.

const esc = (/** @type {unknown} */ s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const comments = commentScreens({ me: 'Duy', esc, pcol: () => '#123456', label: (id) => ({ web: 'Web' })[/** @type {'web'} */ (id)] });
const thread = { id: 7, x: 10, y: 20, view: 'system', node: 'web', resolved: false,
  msgs: [{ who: 'Ana', text: 'Ask @Duy <now>', at: Date.now() - 120_000 }, { who: 'Duy', text: 'Done', at: Date.now() }] };

describe('the comments', () => {
  it('pin a thread with its first writer and how many wrote', () => {
    const pin = comments.pin(thread, true);
    expect(pin).toContain('class="pinc on ');
    expect(pin).toContain('data-pin="7"');
    expect(pin).toContain('<span class="cnt">2</span>');
    expect(comments.draftPin({ x: 1, y: 2 })).toContain('>D</i>');
  });
  it('show a thread\'s messages safely, with mentions, and the box for a new one', () => {
    const open = comments.thread(thread);
    expect(open).toContain('<span class="at">Duy</span> &lt;now&gt;');
    expect(open).toContain('data-reply="7"');
    expect(open).toContain('2 minutes ago');
    expect(comments.thread(null)).toContain('data-new');
  });
  it('list threads in the panel with their box, and say so when there are none', () => {
    const panel = comments.panel({ comments: [thread], resolved: 1, query: 'a"b', showResolved: false, open: 7 });
    expect(panel).toContain('#7 · Web');
    expect(panel).toContain('Show resolved (1)');
    expect(panel).toContain('value="a&quot;b"');
    expect(panel).toContain('1 reply');
    expect(comments.panel({ comments: [], resolved: 0, query: '', showResolved: false, open: null })).toContain('No comments yet');
  });
});

describe('History', () => {
  const view = { me: 'Duy', admin: false, live: true, esc, vtime: (/** @type {number} */ t) => `at ${t}`, statusLabel: () => 'Blocked' };
  const archived = [{ box: { id: 'trial', label: 'Free <trial>', action: { by: 'Duy', stage: 'blocked' } }, by: 'Duy', at: 5 }];
  const versions = [{ id: 'v2', at: 2, what: 'Duy archived Free trial' }, { id: 'v1', at: 1, what: 'The map when its history began' }];
  it('lists archived Actions above the versions, with Put back for their author', () => {
    const panel = historyScreens(view).panel({ archived, versions, current: 'v2' });
    expect(panel.indexOf('Archived Actions')).toBeLessThan(panel.indexOf('Versions'));
    expect(panel).toContain('Blocked · archived by Duy, at 5');
    expect(panel).toContain('Free &lt;trial&gt;');
    expect(panel).toContain('data-unarchive="trial"');
    expect(panel).toContain('class="hv on" data-hver="v2"><span class="hv-t">Now</span>');
    expect(panel).toContain('<span class="hv-t">at 1</span>');
  });
  it('offers Put back only to its author or an Admin, and never on a view link', () => {
    expect(historyScreens({ ...view, me: 'Sam' }).panel({ archived, versions, current: 'v2' })).not.toContain('data-unarchive');
    expect(historyScreens({ ...view, me: 'Sam', admin: true }).panel({ archived, versions, current: 'v2' })).toContain('data-unarchive');
    expect(historyScreens({ ...view, live: false }).panel({ archived, versions, current: 'v2' })).not.toContain('data-unarchive');
  });
  it('says when there are no changes yet, and draws the bar over a version or a saved file', () => {
    const h = historyScreens(view);
    expect(h.panel({ archived: [], versions: [], current: null })).toContain('No changes yet.');
    expect(h.bar({ preview: { at: 3, what: 'Moved <Web>' }, file: null })).toContain('at 3 · Moved &lt;Web&gt;');
    expect(h.bar({ preview: null, file: 1 })).toContain('Load into Living Map');
    expect(h.bar({ preview: null, file: null })).toBe('');
  });
});

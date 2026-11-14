// The panel over a system map while it is drawn from code: a bar, each repo's stage, how long it has taken and
// about how long is left, and Cancel or Draw again; ✕ closes it once drawn. A page module (see page-modules.js):
// the page hands in the map's `drawing` (system-job.js) and what it needs of the page, as `view`:
//   esc   how the page writes text into HTML     now   the time it draws at     mine   they may stop or retry it
//   asking  Draw again was pressed and waits to be confirmed     changed  the repos with newer commits than it read
//   redraw  what a finished redraw would change, waiting for an Engineer to apply it (system-merge.js)

/** @param {any} d the map's drawing @param {{ esc: (t: unknown) => string, now: number, mine: boolean, asking?: boolean, changed?: string[], redraw?: any }} view */
export function drawingPanel(d, view){
  const { esc } = view;
  const progress = /** @type {any[]} */ (d.progress || []);
  const repos = progress.filter((p) => p.repo !== 'platform'), platform = progress.find((p) => p.repo === 'platform');
  const total = Math.max(d.repos || 0, repos.length);
  const ended = repos.filter((p) => ['done', 'failed', 'cancelled'].includes(p.stage)).length;
  const running = d.status === 'running';
  const secs = (/** @type {number} */ ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
  const elapsed = running ? view.now - d.at : d.ms || 0;
  // about how long is left: the repos still to draw, three at a time, at the pace of those drawn so far, and the platform
  const paced = repos.filter((p) => p.stage === 'done' && !p.reused && p.ms);
  const each = paced.length ? paced.reduce((n, p) => n + p.ms, 0) / paced.length : 60_000;
  const left = running ? (platform ? 25_000 : Math.ceil((total - ended) / 3) * each + 25_000) : 0;
  const share = running ? Math.min(0.97, (ended + (platform?.stage === 'done' ? 1 : 0)) / (total + 1)) : 1;
  /** what one repo is doing, in a few words @param {any} p */
  const stage = (p) => p.stage === 'waiting' ? `Waiting, ${p.facts || 0} facts read`
    : p.stage === 'downloading' ? 'Downloading from GitHub'
    : p.stage === 'downloaded' ? 'Downloaded, waiting its turn'
    : p.stage === 'reading' ? 'Reading its code'
    : p.stage === 'drawing' ? (p.repo === 'platform' ? 'Claude is joining the repos by what code links' : `Claude is grouping ${p.facts || 0} facts`)
    : p.stage === 'checking' ? 'Checking every box against the code'
    : p.stage === 'done' ? (p.reused ? `${p.boxes} boxes, kept from the last drawing` : `${p.boxes ?? 0} boxes${p.facts ? ` from ${p.facts} facts` : ''}`)
    : p.stage === 'cancelled' ? 'Stopped' : p.error || 'Not drawn';
  const title = running ? 'Drawing this map from code' : d.status === 'done' ? 'Drawn from code' : d.status === 'cancelled' ? 'Drawing stopped'
    : d.status === 'stopped' ? 'The drawing stopped' : 'Some repos could not be drawn';
  const facts = [`${ended} of ${total} repos`, secs(elapsed), ...(running ? [`about ${secs(left).replace(/ \d+ s$/, '')} left`] : [])];
  const notes = [
    ...(d.error ? [d.error] : []),
    ...(d.status === 'done' && d.rejected ? [`${d.rejected} ${d.rejected === 1 ? 'thing' : 'things'} Claude proposed ${d.rejected === 1 ? 'was' : 'were'} left off: the code does not show ${d.rejected === 1 ? 'it' : 'them'}.`] : []),
    ...(d.unread || []).map((/** @type {any} */ u) => `${u.repo}: ${u.why}`),
    ...(!running && view.changed?.length ? [`${view.changed.length} ${view.changed.length === 1 ? 'repo has' : 'repos have'} new commits since this drawing: ${view.changed.join(', ')}.`] : []),
  ];
  // a redraw's changes wait for review: what code would add, take away or rename, and Apply or keep the map as it is
  const review = !running && view.redraw ? (() => {
    const r = view.redraw, cs = /** @type {any[]} */ (r.changes || []);
    const say = (/** @type {any} */ c) => `${c.what === 'added' ? 'Adds' : c.what === 'gone' ? 'Takes away' : 'Changes'} ${c.kind === 'line' ? 'the line ' : ''}${c.was ? `${c.was} → ` : ''}${c.label}`;
    return `<div class="sd-h"><b>${r.count ? `Code no longer finds ${r.count} ${r.count === 1 ? 'thing' : 'things'}` : 'Nothing you can see changes'}</b><span>They stay on the map until applied</span></div>
      <ul class="sd-c">${cs.slice(0, 60).map((c) => `<li class="sd-${esc(c.what)}" data-content>${esc(say(c))}</li>`).join('')}${cs.length > 60 ? `<li>and ${cs.length - 60} more</li>` : ''}</ul>`;
  })() : '';
  const act = !view.mine ? '' : running ? '<button data-sd-cancel>Cancel</button>'
    : review ? '<button data-sd-dismiss>Keep the map as it is</button><button data-sd-apply>Apply the changes</button>'
    : view.asking ? '<button data-sd-nevermind>Keep this map</button><button data-sd-retry>Draw again</button>'
    : '<button data-sd-ask>Draw again</button>';
  if (view.asking) notes.push('Draw again reads the newest code and draws the repos that changed or could not be drawn; the rest stay as drawn. What people changed stays: boxes they added, their words and moves on drawn boxes, Actions and the lines they drew.');
  // anyone may put a finished drawing's panel away; a redraw waiting for review stays for whoever may apply it
  const shut = running || (review && view.mine) ? '' : '<button class="sd-x" data-sd-close aria-label="Close" title="Close">✕</button>';
  return `<div class="sd-h"><b>${title}</b><span>${esc(facts.join(' · '))}</span>${shut}</div>
    <div class="sd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(share * 100)}"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
    <ol class="sd-r">${[...repos, ...(platform ? [platform] : [])].map((p) => `<li class="sd-${esc(p.stage)}"><span data-content>${esc(p.repo === 'platform' ? 'How the repos connect' : p.repo)}</span><span>${esc(stage(p))}</span></li>`).join('')}</ol>
    ${notes.map((n) => `<p class="sd-n">${esc(n)}</p>`).join('')}${review}
    ${act ? `<div class="sd-a">${act}</div>` : ''}`;
}

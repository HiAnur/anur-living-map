// What a chat draws and builds on the map: its plan, its pull request, Build the plan and plan.md, quick changes from
// the map's tools, and the memory people may reword or take away. The map passes in its state and the helpers each needs.
import { waitsForApply } from './draw.js';
import { levelAfter, notOneTree, treeSaid } from './one-tree.js';

/**
 * @param {{ getState: () => any, name: string, nodeOf: (id: any) => any, seesOf: (by: any) => string, draw: Function,
 *   stamp: () => string, waiters: any[], tell: Function, relayout: () => void, keepMemory: Function,
 *   isAnswering: (session: unknown) => boolean, proposeFor: (a: any) => boolean }} deps `proposeFor`: a change made one of a
 *   linked chat's proposals (its `session`), for its owner to Apply
 */
export function planActs({ getState, name, nodeOf, seesOf, draw, stamp, waiters, tell, relayout, keepMemory, isAnswering, proposeFor }) {
  return {
    // an agent draws its plan: boxes, lines and calls are added or updated by id,
    // so Claude Code (or Codex) can put "Billing" on the map from a chat
    /** @param {Act<'plan'>} a */
    plan(a) {
      // what a chat draws is that chat's: changes people make to it go back to that chat
      const who = String(a.session || '').slice(0, 80);
      if (who) { for (const it of [...(a.nodes || []), ...(a.calls || [])]) it.session = who; getState().owner = who; }
      // a plan that asks something new waits for answers again before anyone can press Build the plan
      if ((a.calls || []).some((/** @type {any} */ c) => c.status === 'open')) getState().executed = null;
      draw(a, a.by, { kind: 'plan', ...(who ? { session: who } : {}) });
      Object.assign(getState().answers, a.answers || {});
      // the ask behind the plan shows on the map's top line; a named map takes the plan's title
      if (a.title && name && !getState().renamed) getState().title = String(a.title).slice(0, 60);
      if (a.ticket) getState().ticket = String(a.ticket).slice(0, 40);
      if (a.prompt) getState().prompt = String(a.prompt).slice(0, 300);
      getState().log.push({ at: Date.now(), who: a.by, action: 'drew', text: a.note || `${(a.nodes || []).length} boxes, ${(a.calls || []).length} calls` });
      tell(`${a.by} drew on the map: ${a.note || 'a plan'}`);
      return true;
    },
    // the plan's pull request, posted by the chat that drew it: a draft holding the plan while it waits for
    // answers, then open, with what the map checked, once the code is on it
    /** @param {Act<'pr'>} a */
    pr(a) {
      const id = String(a.id || '').slice(0, 20); if (!id) return false;
      const had = (getState().prs ||= []).find((/** @type {any} */ p) => p.id === id), s = (/** @type {any} */ v, /** @type {any} */ n) => String(v ?? '').slice(0, n);
      const pr = { id, title: s(a.title || had?.title, 120), url: s(a.url || had?.url, 300),
        status: ['draft', 'open', 'merged', 'closed'].includes(a.status) ? a.status : had?.status || 'draft',
        agent: s(a.agent || had?.agent || 'Claude Code', 40), by: a.by,
        checks: Array.isArray(a.checks) ? a.checks.slice(0, 12).map((/** @type {any} */ c) => ({ name: s(c.name, 120), ok: !!c.ok, ...(c.detail ? { detail: s(c.detail, 200) } : {}) })) : had?.checks || [],
        files: Array.isArray(a.files) ? a.files.slice(0, 30).map((/** @type {any} */ f) => s(f, 120)) : had?.files || [] };
      if (had) Object.assign(had, pr); else getState().prs.push(pr);
      getState().pr = id;
      tell(`${a.by} ${had ? 'updated' : 'opened'} pull request ${id}${pr.title ? `: ${pr.title}` : ''} (${pr.status})`);
      return true;
    },
    // Build the plan: the map's admin says go once nothing on the plan waits on anyone. The chat that drew the plan builds
    // it when it is listening; when that chat has gone quiet, the chat listening on this map now builds it instead,
    // so pressing Build the plan never lands in an empty inbox
    /** @param {Act<'execute'>} a */
    execute(a) {
      if (getState().executed || !(getState().prompt || getState().owner) || getState().calls.some((/** @type {any} */ c) => c.status === 'open')) return false;
      getState().executed = { by: a.by, at: stamp() };
      const pr = getState().prs?.find((/** @type {any} */ p) => p.id === getState().pr), to = getState().owner && waiters.some((/** @type {any} */ w) => w.who === getState().owner) ? getState().owner : '*';
      tell(`${a.by} pressed Build the plan: every question on the map is answered. Build the plan now from what was decided${pr ? `, on pull request ${pr.id}'s branch` : ''}.`, to);
      return true;
    },
    // Give me plan.md: instead of building, the same chat writes the plan out as plan.md at the repo's root,
    // and the map links to it; Build the plan stays for when the admin is ready
    /** @param {Act<'planmd'>} a */
    planmd(a) {
      if (getState().executed || !(getState().prompt || getState().owner) || getState().calls.some((/** @type {any} */ c) => c.status === 'open')) return false;
      getState().planmd = { by: a.by, at: stamp() };
      const to = getState().owner && waiters.some((/** @type {any} */ w) => w.who === getState().owner) ? getState().owner : '*';
      tell(`${a.by} asked for plan.md instead of Build the plan: write this map's plan to plan.md at the repo's root (what changes, step by step, from what was decided, and what could break), then stop. Do not build; ${a.by} presses Build the plan when ready.`, to);
      return true;
    },
    // a quick change from a chat's Living Map tools (mcp.js): boxes, lines and questions added or updated by id,
    // the way a plan draws them, without a new session in the map's list
    // Instructions and Memory: only Claude adds them (Apply on its change, or the map tools); people change their
    // words or take them away, a box's ones only within their access
    /** @param {Act<'editmemory'>} a */
    editmemory(a) {
      const m = getState().memory?.find((/** @type {any} */ x) => x.id === a.id), text = String(a.text || '').trim().slice(0, 300), b = m?.box && nodeOf(m.box), sees = seesOf(a.by);
      if (!m || !text || (b && sees !== 'all' && b.area !== sees)) return false;
      m.text = text; m.by = a.by; m.at = Date.now(); return true;
    },
    /** @param {Act<'forget'>} a */
    forget(a) {
      const i = (getState().memory || []).findIndex((/** @type {any} */ x) => x.id === a.id), b = i >= 0 && getState().memory[i].box && nodeOf(getState().memory[i].box), sees = seesOf(a.by);
      if (i < 0 || (b && sees !== 'all' && b.area !== sees)) return false;
      getState().memory.splice(i, 1); return true;
    },
    // A chat answering a request from the map's pane proposes instead of drawing: what was asked there waits for
    // its owner's Apply, its questions for teammates asked with it.
    /** @param {Act<'edit'> & { proposed?: any, refused?: string }} a */
    edit(a) {
      if (![a.nodes, a.propose, a.edges, a.calls, a.memory, a.unlink].some((x) => Array.isArray(x) && x.length) && a.tidy !== true && !a.start) return false;
      const marked = Array.isArray(a.propose) ? a.propose : [], linked = getState().linked || [];
      if (isAnswering(a.session)) {
        // a box named only to join a teammate's area is the question's, and the proposal moves it with the question
        const nodes = [...(a.nodes || []), ...marked].filter((/** @type {any} */ n) => Object.keys(n || {}).some((k) => !['id', 'area', 'by'].includes(k)));
        /** @type {any} */ const asked = { type: 'propose', by: a.by, session: a.session, note: a.note, nodes, edges: a.edges, calls: a.calls, unlink: a.unlink, memory: a.memory, start: a.start, tidy: a.tidy };
        if (!proposeFor(asked)) { a.refused = 'Nothing in this change could be proposed: a request from the map\'s chat is answered with a proposal.'; return false; }
        a.proposed = asked.proposed;
        return true;
      }
      // a tidy lays out the map again only when it reads as one tree from the start box; a system map lays out in layers
      if (a.tidy === true && !getState().drawing) {
        const level = levelAfter(getState(), { nodes: a.nodes || [], edges: a.edges || [], unlink: a.unlink || [] }, (id) => !!nodeOf(id));
        const trouble = notOneTree(level.nodes, level.edges, typeof a.start === 'string' && level.nodes.some((n) => n.id === a.start) ? a.start : getState().start);
        if (trouble.length) { a.refused = `The map was not tidied, and nothing changed: ${treeSaid(trouble)}. Fix which box hangs under which in the same call, or leave out tidy.`; return false; }
      }
      // Claude changes a box a person made or changed, or one nobody recorded making, or takes off one it did not
      // make, only through a proposal a person applies, whichever session the edit names: in the pane of the chat
      // that sent it when that chat is linked, else of the chat linked to the map. A chat cleared since it was linked
      // sends a session the map cannot tie back to its link, so this holds without one. Moving a box into the area
      // of someone this edit asks a question is how they get to see it.
      const asks = (/** @type {any} */ n) => Object.keys(n).every((k) => k === 'id' || k === 'area')
        && (a.calls || []).some((/** @type {any} */ c) => c?.node === n.id && c.for && seesOf(c.for) === n.area);
      const waiting = (/** @type {any} */ n) => a.by === 'Claude' && n && typeof n === 'object' && nodeOf(n.id) && !asks(n) && !!waitsForApply(nodeOf(n.id), n);
      const nodes = Array.isArray(a.nodes) ? a.nodes.filter((n) => !waiting(n)) : a.nodes;
      const held = [...marked, ...(Array.isArray(a.nodes) ? a.nodes.filter(waiting) : [])];
      const to = linked.find((/** @type {any} */ l) => l.session === a.session) || linked[0];
      const offered = held.length > 0 && !!to && proposeFor({ type: 'propose', by: a.by, session: to.session, note: a.note, nodes: held });
      if (offered && !(nodes?.length || a.edges?.length || a.calls?.length || a.memory?.length || a.unlink?.length || a.tidy === true || a.start)) return true;
      if (typeof a.start === 'string' && [...getState().nodes, ...(nodes || [])].some((n) => n?.id === a.start)) getState().start = a.start;
      draw({ nodes, edges: a.edges, calls: a.calls, unlink: a.unlink }, a.by, { kind: 'edit' });
      if (a.tidy === true) relayout();
      for (const m of (a.memory || []).slice(0, 10)) keepMemory(m, a.by);
      getState().log.push({ at: Date.now(), who: a.by, action: 'drew', text: String(a.note || 'a quick change').slice(0, 200) });
      tell(`${a.by} changed the map: ${String(a.note || 'a quick change').slice(0, 200)}`);
      return true;
    },
  };
}

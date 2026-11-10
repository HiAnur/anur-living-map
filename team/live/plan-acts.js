// What a chat draws and builds on the map: its plan, its pull request, Execute and plan.md, quick changes from
// the map's tools, and the memory people may reword or take away. The map passes in its state and the helpers each needs.

/**
 * @param {{ getState: () => any, name: string, nodeOf: (id: any) => any, seesOf: (by: any) => string, draw: Function,
 *   stamp: () => string, waiters: any[], tell: Function, relayout: () => void, keepMemory: Function }} deps
 */
export function planActs({ getState, name, nodeOf, seesOf, draw, stamp, waiters, tell, relayout, keepMemory }) {
  return {
    // an agent draws its plan: boxes, lines and calls are added or updated by id,
    // so Claude Code (or Codex) can put "Billing" on the map from a chat
    /** @param {any} a */
    plan(a) {
      // what a chat draws is that chat's: changes people make to it go back to that chat
      const who = String(a.session || '').slice(0, 80);
      if (who) { for (const it of [...(a.nodes || []), ...(a.calls || [])]) it.session = who; getState().owner = who; }
      // a plan that asks something new waits for answers again before anyone can press Execute
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
    /** @param {any} a */
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
    // Execute: the map's admin says go once nothing on the plan waits on anyone. The chat that drew the plan builds
    // it when it is listening; when that chat has gone quiet, the chat listening on this map now builds it instead,
    // so pressing Execute never lands in an empty inbox
    /** @param {any} a */
    execute(a) {
      if (getState().executed || !(getState().prompt || getState().owner) || getState().calls.some((/** @type {any} */ c) => c.status === 'open')) return false;
      getState().executed = { by: a.by, at: stamp() };
      const pr = getState().prs?.find((/** @type {any} */ p) => p.id === getState().pr), to = getState().owner && waiters.some((/** @type {any} */ w) => w.who === getState().owner) ? getState().owner : '*';
      tell(`${a.by} pressed Execute: every question on the map is answered. Build the plan now from what was decided${pr ? `, on pull request ${pr.id}'s branch` : ''}.`, to);
      return true;
    },
    // Give me plan.md: instead of building, the same chat writes the plan out as plan.md at the repo's root,
    // and the map links to it; Execute stays for when the admin is ready
    /** @param {any} a */
    planmd(a) {
      if (getState().executed || !(getState().prompt || getState().owner) || getState().calls.some((/** @type {any} */ c) => c.status === 'open')) return false;
      getState().planmd = { by: a.by, at: stamp() };
      const to = getState().owner && waiters.some((/** @type {any} */ w) => w.who === getState().owner) ? getState().owner : '*';
      tell(`${a.by} asked for plan.md instead of Execute: write this map's plan to plan.md at the repo's root (what changes, step by step, from what was decided, and what could break), then stop. Do not build; ${a.by} presses Execute when ready.`, to);
      return true;
    },
    // a quick change from a chat's Living Map tools (mcp.js): boxes, lines and questions added or updated by id,
    // the way a plan draws them, without a new session in the map's list
    // Instructions and Memory: only Claude adds them (Apply on its change, or the map tools); people change their
    // words or take them away, a box's ones only within their access
    /** @param {any} a */
    editmemory(a) {
      const m = getState().memory?.find((/** @type {any} */ x) => x.id === a.id), text = String(a.text || '').trim().slice(0, 300), b = m?.box && nodeOf(m.box), sees = seesOf(a.by);
      if (!m || !text || (b && sees !== 'all' && b.area !== sees)) return false;
      m.text = text; m.by = a.by; m.at = Date.now(); return true;
    },
    /** @param {any} a */
    forget(a) {
      const i = (getState().memory || []).findIndex((/** @type {any} */ x) => x.id === a.id), b = i >= 0 && getState().memory[i].box && nodeOf(getState().memory[i].box), sees = seesOf(a.by);
      if (i < 0 || (b && sees !== 'all' && b.area !== sees)) return false;
      getState().memory.splice(i, 1); return true;
    },
    /** @param {any} a */
    edit(a) {
      if (![a.nodes, a.edges, a.calls, a.memory, a.unlink].some((x) => Array.isArray(x) && x.length) && a.tidy !== true && !a.start) return false;
      if (typeof a.start === 'string' && [...getState().nodes, ...(a.nodes || [])].some((n) => n?.id === a.start)) getState().start = a.start;
      draw({ nodes: a.nodes, edges: a.edges, calls: a.calls, unlink: a.unlink }, a.by, { kind: 'edit' });
      if (a.tidy === true) relayout();
      for (const m of (a.memory || []).slice(0, 10)) keepMemory(m, a.by);
      getState().log.push({ at: Date.now(), who: a.by, action: 'drew', text: String(a.note || 'a quick change').slice(0, 200) });
      tell(`${a.by} changed the map: ${String(a.note || 'a quick change').slice(0, 200)}`);
      return true;
    },
  };
}

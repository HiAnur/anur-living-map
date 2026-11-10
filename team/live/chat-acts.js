// What people do with Claude's offers and questions in the map's chats: rename or describe a box Claude
// proposed, ask Claude, apply or drop its change, keep more than one chat, and talk to the Claude Code chat
// linked to the map. The map passes in its state and the helpers each needs.
import fs from 'node:fs';

import { AUTO_PLAN_QUESTION } from './auto-plan.js';

/**
 * @param {{ getState: () => any, project: string, name: string, home: string, nodeOf: (id: any) => any,
 *   seesOf: (by: any) => string, askPrompt: Function, proposal: Function, check: Function, checkAutoPlan: Function,
 *   pendingProposals: (by?: any) => any[], selectedContextMaps: Function, askAgent: Function, agent: AgentWorker,
 *   activeAsks: Set<any>, stamp: () => string, save: () => void, push: () => void, tell: Function,
 *   ownsChat: Function, mineChat: Function, ownerOf: Function, placeProposed: Function, draw: Function,
 *   actions: any, relayout: () => void, keepMemory: Function, chats: AgentConversation, startMirror: () => void,
 *   linkOf: () => any, savePicture: Function, converse: Function, sendMirror: () => void }} deps
 */
export function chatActs({ getState, project, name, home, nodeOf, seesOf, askPrompt, proposal, check, checkAutoPlan, pendingProposals,
  selectedContextMaps, askAgent, agent, activeAsks, stamp, save, push, tell, ownsChat, mineChat, ownerOf, placeProposed, draw, actions,
  relayout, keepMemory, chats, startMirror, linkOf, savePicture, converse, sendMirror }) {
  return {
    /** @param {any} a */
    renamebox(a) {
      const label = String(a.label || '').trim().slice(0, 80);
      if (a.proposed){
        if (!label) return false;
        const p = pendingProposals(a.by).find((p) => p.plan.nodes.some((/** @type {any} */ n) => n.id === a.id));
        if (!p || nodeOf(a.id)) return false;
        const plan = {...p.plan, nodes:p.plan.nodes.map((/** @type {any} */ n) => n.id === a.id ? {...n,label} : {...n})};
        const checked = p.autoPlanAbout ? checkAutoPlan(plan,a.by,p.autoPlanAbout) : check(plan,a.by);
        if (!/** @type {any} */ (checked).plan?.nodes.some((/** @type {any} */ n) => n.id === a.id)) return false;
        p.plan.nodes.find((/** @type {any} */ n) => n.id === a.id).label = label;
        p.ops = checked.ops;
        return true;
      }
      const n = nodeOf(a.id), sees = seesOf(a.by);
      if (!n || !label || (sees !== 'all' && n.area !== sees)) return false;
      n.label = label;
      tell(`${a.by} renamed a box to ${label}`);
      return true;
    },
    /** @param {any} a */
    describebox(a) {
      if (a.proposed){
        if (typeof a.sub !== 'string') return false;
        const p = pendingProposals(a.by).find((p) => p.plan.nodes.some((/** @type {any} */ n) => n.id === a.id));
        if (!p || nodeOf(a.id)) return false;
        const sub = a.sub.trim().slice(0, 240);
        const plan = {...p.plan, nodes:p.plan.nodes.map((/** @type {any} */ n) => n.id === a.id ? {...n,sub} : {...n})};
        const checked = p.autoPlanAbout ? checkAutoPlan(plan,a.by,p.autoPlanAbout) : check(plan,a.by);
        if (!/** @type {any} */ (checked).plan?.nodes.some((/** @type {any} */ n) => n.id === a.id)) return false;
        p.plan.nodes.find((/** @type {any} */ n) => n.id === a.id).sub = sub;
        p.ops = checked.ops;
        return true;
      }
      const n = nodeOf(a.id), sees = seesOf(a.by);
      if (!n || typeof a.sub !== 'string' || (sees !== 'all' && n.area !== sees)) return false;
      n.sub = a.sub.trim().slice(0, 240);
      tell(`${a.by} changed the description of ${n.label}`);
      return true;
    },
    /** @param {any} a */
    ask(a) {
      // every question goes into the asker's one chat with Claude; one about a box carries the box with it
      const boxId = a.about || a.node, n = boxId ? nodeOf(boxId) : null, sees = seesOf(a.by);
      if (a.autoPlan && !n) return false;
      if (boxId && (!n || (sees !== 'all' && n.area !== sees))) return false;
      // a question in a box's own chat stays on that box: Claude reads the main chat as it is now, and the main chat never sees it
      const side = Boolean((a.side || a.autoPlan) && n), key = side ? `@${a.by}>${n.id}` : `@${a.by}`;
      const t = (getState().threads[key] ??= []), answer = typeof a.text === 'string' ? a.text.trim().slice(0, 400) : '';
      if ((a.autoPlan || t.at(-1)?.autoPlanAbout) && t.some((/** @type {any} */ m) => m.thinking)) return false;
      if (!a.autoPlan && !answer) return false;
      const autoPlan = Boolean(a.autoPlan || (side && t.at(-1)?.autoPlanAbout === n.id && !t.at(-1)?.proposal));
      const q = answer || AUTO_PLAN_QUESTION;
      const before = t.filter((/** @type {any} */ m) => !m.staged && !m.thinking).slice(-20);
      t.push({ who: a.by, text: q, at: stamp(), ...(n ? { about: n.id } : {}) });
      getState().log.push({ at: Date.now(), who: a.by, action: 'asked', node: n?.id, text: q });
      // the scripted demo answers from its seed; a project's map or a named one asks Claude
      if (!project && !name) {
        // asking to see a flow opens it; the page does the drawing
        const hasFlow = n && (n.flow || n.inside?.nodes?.some((/** @type {any} */ x) => x.flow));
        const answer = hasFlow && /flow|visuali|diagram|draw|sequence/i.test(a.text)
          ? 'Drew the payment flow on the map: the upgrade, Payment confirmed, and where an annual customer gets billed twice.'
          : getState().answers[n?.id] || getState().answers['*'];
        t.push({ who: 'Claude', text: answer, at: stamp(), staged: true, ...(n ? { about: n.id } : {}) });
        return true;
      }
      // the reply fills in as Claude writes it, pushed to every window a few times a second
      /** @type {any} */ const msg = { who: 'Claude', text: '', at: stamp(), thinking: true, doing: autoPlan ? 'Planning additions' : 'Claude is working', since: Date.now(), ...(autoPlan ? {autoPlanAbout:n.id} : {}), ...(n ? { about: n.id } : {}) };
      t.push(msg);
      fs.mkdirSync(home, { recursive: true });
      let /** @type {any} */ soon = null;
      let /** @type {any} */ stop;
      stop = askAgent({ cwd: project || home, prompt: askPrompt(a.by, n, q, before, side, autoPlan), contextMaps:selectedContextMaps, who: a.by,
        onLoad: (/** @type {any} */ source) => { msg.sources = [...(msg.sources || []).filter((/** @type {any} */ m) => m.id !== source.id), source]; msg.doing = `Reading ${source.title}`; push(); },
        onText: (/** @type {any} */ text, /** @type {any} */ proposing) => { msg.text = String(text).trim(); msg.doing = proposing ? 'Preparing map changes' : autoPlan ? 'Planning additions' : 'Claude is working'; soon ??= setTimeout(() => { soon = null; push(); }, 150); },
        onDone: (/** @type {any} */ text, /** @type {any} */ _access, /** @type {any} */ change) => {
          activeAsks.delete(stop); clearTimeout(soon); delete msg.thinking; delete msg.since; delete msg.doing; msg.text = String(text).trim(); msg.at = stamp();
          if (text === agent.signedOut) msg.signin = true;
          // a new offer replaces Claude's earlier ones in this chat that nobody applied yet, so they never stack up
          const pr = proposal(change, a.by, autoPlan ? n.id : null);
          if (pr?.status === 'pending') for (const x of t) if (x !== msg && x.proposal?.status === 'pending') Object.assign(x.proposal, { status: 'dropped', replaced: true });
          if (pr) msg.proposal = pr;
          save(); push();
        } });
      activeAsks.add(stop);
      return true;
    },
    // Apply on a change Claude proposed in a chat: the map takes it, and the chat that drew those boxes hears it.
    // Your own chat's changes are yours to apply. The chat told is the one that drew the first box the
    // change touches or links to, else the box the question was about.
    // A change the linked Claude chat proposed (a.proposal) is its owner's to apply, and that chat hears it.
    /** @param {any} a */
    apply(a) {
      const fromChat = a.proposal ? (getState().proposals || []).find((/** @type {any} */ x) => x.id === a.proposal) : null;
      const key = String(a.thread || ''), m = fromChat ? null : getState().threads[key]?.[Number(a.index)], pr = fromChat || m?.proposal;
      if (!pr || pr.status !== 'pending' || !(fromChat ? ownsChat(fromChat.session, a.by) : mineChat(key, a.by))) return false;
      if (pr.autoPlanAbout) {
        Object.assign(pr, checkAutoPlan(pr.plan, a.by, pr.autoPlanAbout));
        if (pr.status !== 'pending') return true;
      }
      if (pr.plan.layout?.some((/** @type {any} */ m) => { const n = nodeOf(m.id); return !n || n.x !== m.fromX || n.y !== m.fromY; })) placeProposed(pr.plan);
      for (const m of pr.plan.layout || []) { const n = nodeOf(m.id); if (n) { n.x = m.x; n.y = m.y; } }
      const touched = [...pr.plan.nodes.map((/** @type {any} */ n) => n.id), ...pr.plan.remove, ...pr.plan.edges.flatMap((/** @type {any} */ e) => [e.from, e.to])].find((id) => nodeOf(id));
      const to = fromChat ? fromChat.session : ownerOf(touched || m.about || null);
      if (pr.plan.start) getState().start = pr.plan.start;
      const source = fromChat ? { kind: 'proposal', session: fromChat.session }
        : key === `@${a.by}>${m?.about}` ? { kind: 'side', box: m.about, owner: a.by }
        : { kind: 'proposal' };
      draw(pr.plan, 'Claude', source);
      for (const box of pr.plan.nodes) if (box.boxType === 'action' && box.task) {
        actions.begin(box.id, a.by, box.task, false);
        delete nodeOf(box.id).task;
      }
      if (pr.plan.tidy) relayout();
      for (const m of pr.plan.memory || []) keepMemory(m, a.by);
      pr.status = 'applied'; pr.by = a.by; pr.at = stamp();
      getState().log.push({ at: Date.now(), who: a.by, action: 'applied', text: pr.ops.join('; ') });
      tell(`${a.by} applied Claude's change on the map: ${pr.ops.join('; ')}`, to);
      return true;
    },
    /** @param {any} a */
    drop(a) {
      const fromChat = a.proposal ? (getState().proposals || []).find((/** @type {any} */ x) => x.id === a.proposal) : null;
      const key = String(a.thread || ''), pr = fromChat || getState().threads[key]?.[Number(a.index)]?.proposal;
      if (!pr || pr.status !== 'pending' || !(fromChat ? ownsChat(fromChat.session, a.by) : mineChat(key, a.by))) return false;
      pr.status = 'dropped'; pr.by = a.by; return true;
    },
    // the Claude Code chat that opened this map with /anur-living-map: its owner's Claude pane follows that chat
    /** @param {any} a */
    link(a) {
      const session = String(a.session || ''), file = String(a.file || '');
      if (!chats.isChat(file, session)) return false;
      getState().linked = [{ session, file, owner: a.by, at: Date.now() }, ...(getState().linked || []).filter((/** @type {any} */ l) => l.session !== session)].slice(0, 10);
      delete getState().starting;
      startMirror(); return true;
    },
    // what the owner types in the pane goes to that chat through its listener, and shows in the pane at once;
    // pictures attached to it are saved in the map's folder, and the chat is told where, so Claude can open them
    /** @param {any} a */
    say(a) {
      const l = linkOf(), text = String(a.text || '').trim().slice(0, 2000);
      if (!l || l.owner !== a.by) return false;
      const pics = (Array.isArray(a.images) ? a.images : []).slice(0, 5).map(savePicture).filter(Boolean);
      if (!text && !pics.length) return false;
      // a chat the map started itself hears it straight away, and its transcript shows it in the pane
      if (l.built) { converse(l, `${text}${pics.length ? `\n\n(attached ${pics.map((/** @type {any} */ p) => p.file).join(', ')})` : ''}`); return true; }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      ((getState().said ??= {})[l.session] ??= []).push({ id, text, at: Date.now(), ...(pics.length ? { imgs: pics.map((/** @type {any} */ p) => p.id) } : {}) });
      tell(`${a.by} wrote in the map's chat: "${text}"${pics.length ? ` (attached ${pics.map((/** @type {any} */ p) => p.file).join(', ')})` : ''}`, l.session, id);
      setTimeout(sendMirror); return true;
    },
    // a change the linked chat proposes: blue on the map and a card in the pane until its owner presses Apply
    /** @param {any} a */
    propose(a) {
      const session = String(a.session || ''), l = (getState().linked || []).find((/** @type {any} */ x) => x.session === session);
      if (!l) return false;
      const pr = check(a, l.owner); if (!pr.ops.length) return false;
      getState().proposals = [...(getState().proposals || []), { id: Date.now().toString(36), session, made: Date.now(), note: String(a.note || '').slice(0, 200), ...pr }].slice(-30);
      setTimeout(sendMirror); return true;
    },
    // New chat: the chat you have goes into your history as threads['@Duy#<now>'], and you start an empty one
    /** @param {any} a */
    newchat(a) {
      const key = `@${a.by}`, t = getState().threads[key];
      if (!t?.length || t.some((/** @type {any} */ m) => m.thinking)) return false;
      getState().threads[`${key}#${Date.now().toString(36)}`] = t; getState().threads[key] = [];
      return true;
    },
    // a chat picked from your history becomes the open one, and the one open now goes into the history
    /** @param {any} a */
    openchat(a) {
      const key = `@${a.by}`, from = String(a.chat || ''), old = getState().threads[from], now = getState().threads[key] || [];
      if (!from.startsWith(`${key}#`) || !old || now.some((/** @type {any} */ m) => m.thinking)) return false;
      delete getState().threads[from];
      if (now.length) getState().threads[`${key}#${Date.now().toString(36)}`] = now;
      getState().threads[key] = old;
      return true;
    },
  };
}

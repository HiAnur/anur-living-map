// Answering a question on the map, by hand: the call action. It records who answered and applies what the answer
// changes; a drawing only ever asks (draw-guard.js). The map passes in its state and the helpers it needs.

/**
 * @param {{ getState: () => MapState, nodeOf: (id: any) => any, seesOf: (by: any) => string, stamp: () => string, tell: Function,
 *   ownerOf: Function, allEdges: () => any[] }} deps
 */
export function callActs({ getState, nodeOf, seesOf, stamp, tell, ownerOf, allEdges }) {
  return {
    // what a person's answer does to the map, from the call's own seed. A yes-or-no call takes
    // confirm or dispute; a call with options takes one of them, or the person's own words.
    /** @param {Act<'call'>} a */
    call(a) {
      const c = getState().calls.find((/** @type {any} */ x) => x.id === a.id);
      if (!c || c.status !== 'open') return false;
      // a question on a box outside the one area someone sees is not theirs to answer: the page never shows it to them
      const on = nodeOf(c.node), sees = seesOf(a.by);
      if (on && sees !== 'all' && on.area !== sees) return false;
      let fx;
      if (c.options?.length) {
        const o = c.options.find((/** @type {any} */ x) => x.id === a.option), own = String(a.other || '').trim().slice(0, 400);
        if (!o && !own) return false;
        fx = o || {};
        c.status = 'answered'; c.pickedId = o ? o.id : 'other'; c.picked = o ? o.label : own;
        c.by = a.by; c.at = stamp(); c.said = o ? fx.says || '' : own;
      } else {
        if (a.answer !== 'confirm' && a.answer !== 'dispute') return false;
        fx = c[a.answer] || {};
        c.status = a.answer === 'confirm' ? 'confirmed' : 'disputed';
        c.by = a.by; c.at = stamp(); c.said = fx.says || '';
      }
      const n = fx.node && nodeOf(fx.node);
      if (n) {
        if (fx.state !== undefined) n.state = fx.state;
        if (fx.sub !== undefined) n.sub = fx.sub;
        n.decided = { who: a.by, at: c.at, what: fx.sub || c.picked || c.status, call: c.id };
      }
      if (fx.edge) { const [f, t] = fx.edge.split('>'); const e = allEdges().find((/** @type {any} */ x) => x.from === f && x.to === t); if (e) e.state = fx.edgeState || ''; }
      getState().log.push({ at: Date.now(), who: a.by, action: c.status, call: c.id, node: c.node, text: c.text, said: c.said, picked: c.picked });
      tell(c.status === 'answered'
        ? `${a.by} answered "${c.text}": ${c.pickedId === 'other' ? `in their own words, "${c.picked}"` : `"${c.picked}"${fx.says ? ` — ${fx.says}` : ''}`}`
        : `${a.by} ${c.status} "${c.text}"${fx.says ? ` — ${fx.says}` : ''}${fx.chat ? `\n  Claude: ${fx.chat}` : ''}`, ownerOf(c.node, c));
      return true;
    },
  };
}

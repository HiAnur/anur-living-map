import crypto from 'node:crypto';

import { allBoxesOf, graphsOf } from './map-walk.js';
import { noteBody, noteDocument } from './page-note.js';
import { noteStructure } from './note-structure.js';

/** @param {{getState: () => any}} deps */
export function noteActs({ getState }) {
  return {
    /** @param {Act<'writenote'> & {refused?: string, sectionIds?: Record<string,string>}} a */
    writenote(a) {
      const original = getState(), document = noteDocument(original);
      // A concurrent map or note edit must never be silently replaced by an older document.
      if (JSON.stringify(document) !== a.base) { a.refused = 'The map changed while you were writing. Your draft is kept. Reload the note to see the changes.'; return false; }
      const state = structuredClone(original), title = a.title.trim(), description = a.description;
      if (!title || (title.length > 60 && title !== state.title) || description.length > 12000 || a.sections.length > 5000) return false;
      const existing = new Map(allBoxesOf(state).map((n) => [n.id, n]));
      const originals = new Map(document.sections.map((s) => [s.id, s]));
      const ids = new Set();
      // Existing sections cannot disappear or move as a side effect of editing prose. Map tools own those edits.
      for (const s of a.sections) {
        const old = s && originals.get(s.id);
        if (!s || typeof s.id !== 'string' || ids.has(s.id) || typeof s.label !== 'string' || !s.label.trim() || (s.label.length > 80 && s.label !== old?.label) || typeof s.body !== 'string' || (s.body.length > 12000 && s.body !== old?.body) || typeof s.parent !== 'string' || typeof s.graph !== 'string') return false;
        if (old ? (!a.structure && old.parent !== s.parent) || old.graph !== s.graph : !s.id.startsWith('draft-') || (s.graph && !existing.get(s.graph)?.inside) || (s.parent && !ids.has(s.parent) && !existing.has(s.parent))) return false;
        if (a.structure && s.parent && !ids.has(s.parent)) return false;
        if ((a.structure || !old) && s.parent) {
          const p = originals.get(s.parent) || a.sections.find((p) => p.id === s.parent);
          if (!p || (p.graph !== s.graph && p.id !== s.graph)) return false;
        }
        ids.add(s.id);
      }
      if (!a.structure && [...existing.keys()].some((id) => !ids.has(id))) return false;
      const graphs = new Map(graphsOf(state).map((g) => [g, g.nodes.length]));
      const minted = new Map();
      for (const s of a.sections) {
        const old = existing.get(s.id);
        if (old) {
          if (s.label !== old.label) old.label = s.label.trim();
          if (s.body !== noteBody(old)) { old.desc = s.body; old.sub = s.body.split('\n').find((/** @type {string} */ l) => l.trim())?.slice(0, 240) || ''; }
          continue;
        }
        const graph = s.graph ? existing.get(s.graph)?.inside : state;
        const parentId = minted.get(s.parent) || s.parent, parent = graph.nodes.find((/** @type {any} */ n) => n.id === parentId);
        const id = `note-${crypto.randomUUID()}`, index = graph.nodes.length - (graphs.get(graph) || 0);
        const siblings = (graph.edges || []).filter((/** @type {any} */ e) => e.from === parentId).map((/** @type {any} */ e) => graph.nodes.find((/** @type {any} */ n) => n.id === e.to)).filter(Boolean);
        graph.nodes.push({ id, label: s.label.trim(), desc: s.body, sub: s.body.split('\n').find((/** @type {string} */ l) => l.trim())?.slice(0, 240) || '', by: a.by, source: { kind: 'map' },
          x: parent ? parent.x + 280 : index * 280, y: siblings.length ? Math.max(...siblings.map((/** @type {any} */ n) => n.y)) + 100 : parent ? parent.y : 0 });
        if (parent) (graph.edges ??= []).push({ from: parentId, to: id });
        if (!state.start && graph === state) state.start = id;
        minted.set(s.id, id);
      }
      if (a.structure) {
        const sections = a.sections.map((s) => ({ ...s, id: minted.get(s.id) || s.id, parent: minted.get(s.parent) || s.parent }));
        const error = noteStructure(state, sections, document.sections, a.by);
        if (error) { a.refused = error; return false; }
      }
      a.sectionIds = Object.fromEntries(minted);
      state.title = state.renamed = title;
      state.desc = description;
      Object.assign(original, { nodes: state.nodes, edges: state.edges, title: state.title, renamed: state.renamed, desc: state.desc, start: state.start });
      return true;
    },
  };
}

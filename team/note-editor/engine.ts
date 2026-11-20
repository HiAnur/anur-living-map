import { baseKeymap, chainCommands, createParagraphNear, liftEmptyBlock, setBlockType, splitBlock, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { Slice } from "prosemirror-model";
import { sinkListItem, splitListItem, liftListItem } from "prosemirror-schema-list";
import { EditorState, Plugin, TextSelection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";

import { documentNode, draftId, headingRows, markdownSlice, noteReader, noteSchema, type NoteDocument } from "./model.ts";

type Options = { document: NoteDocument; json?: any; editable: () => boolean; changed: () => void; selected: (level: number, style: number) => void };

export function createRichNote(element: HTMLElement, options: Options) {
  const originalNode = documentNode(options.document);
  let read = noteReader(options.document, originalNode);
  let view: EditorView;
  let silent = false;
  const aliases = new Map<string, string>();
  const current = (state = view.state) => headingRows(state.doc).rows.filter((r) => r.pos <= state.selection.from).at(-1);
  const focusLevel = () => options.selected(Number(current()?.node.attrs.level || 0), view.state.selection.$from.parent.type === noteSchema.nodes.heading ? Number(view.state.selection.$from.parent.attrs.level) : 0);

  function changeLevel(delta: number): Command {
    return (state, dispatch) => {
      const row = current(state); if (!row) return false;
      const rows = headingRows(state.doc).rows, index = rows.findIndex((r) => r.pos === row.pos), level = Number(row.node.attrs.level);
      if (level + delta < 1 || level + delta > 5000) return true;
      if (delta > 0 && (!index || Number(rows[index - 1].node.attrs.level) < level)) return true;
      const tr = state.tr;
      for (let i = index; i < rows.length; i++) {
        const next = rows[i]; if (i > index && next.node.attrs.level <= level) break;
        tr.setNodeMarkup(next.pos, undefined, { ...next.node.attrs, level: Number(next.node.attrs.level) + delta });
      }
      dispatch?.(tr.scrollIntoView()); return true;
    };
  }
  const inline = (pattern: RegExp, mark: string) => new InputRule(pattern, (state, match, start, end) => state.tr.replaceWith(start + match[0].length - match[1].length, end, noteSchema.text(match[2], [noteSchema.marks[mark].create()])));
  const rules = [
    inline(/(?:^|\s)(\*\*([^*]+)\*\*)$/, "strong"),
    inline(/(?:^|\s)(\*([^*]+)\*)$/, "em"),
    inline(/(?:^|\s)(`([^`]+)`)$/, "code"),
    textblockTypeInputRule(/^(#{1,6})\s$/, noteSchema.nodes.heading, (match) => ({ level: match[1].length })),
    textblockTypeInputRule(/^```([\w-]+)?\s$/, noteSchema.nodes.code_block, (match) => ({ params: match[1] || "" })),
    wrappingInputRule(/^\s*([-+*])\s$/, noteSchema.nodes.bullet_list),
    wrappingInputRule(/^\s*(\d+)\.\s$/, noteSchema.nodes.ordered_list, (match) => ({ order: Number(match[1]) })),
    wrappingInputRule(/^>\s$/, noteSchema.nodes.blockquote),
  ];
  const identity = new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((t) => t.docChanged)) return null;
      const seen = new Set<string>(), tr = state.tr;
      state.doc.forEach((node, pos) => {
        if (node.type !== noteSchema.nodes.heading) return;
        let id = aliases.get(node.attrs.id) || node.attrs.id;
        if (!id || seen.has(id)) id = draftId();
        if (id !== node.attrs.id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
        seen.add(id);
      });
      return tr.docChanged ? tr : null;
    },
    props: {
      decorations(state) {
        const selected = current(state), decorations: Decoration[] = [];
        for (const row of headingRows(state.doc).rows) if (row.node.attrs.level > 6 || row.pos === selected?.pos) decorations.push(Decoration.node(row.pos, row.pos + row.node.nodeSize, { class: "note-heading-active" }));
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
  const enter = chainCommands(splitListItem(noteSchema.nodes.list_item), createParagraphNear, liftEmptyBlock, splitBlock);
  const keys = {
    "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo,
    "Mod-b": toggleMark(noteSchema.marks.strong), "Mod-i": toggleMark(noteSchema.marks.em), "Mod-`": toggleMark(noteSchema.marks.code),
    "Mod-Enter": (state: EditorState, dispatch: any) => { dispatch?.(state.tr.replaceSelectionWith(noteSchema.nodes.hard_break.create()).scrollIntoView()); return true; },
    "Alt-ArrowRight": changeLevel(1), "Alt-ArrowLeft": changeLevel(-1),
    Tab: (state: EditorState, dispatch: any) => state.selection.$from.parent.type === noteSchema.nodes.heading ? changeLevel(1)(state, dispatch) : sinkListItem(noteSchema.nodes.list_item)(state, dispatch),
    "Shift-Tab": (state: EditorState, dispatch: any) => state.selection.$from.parent.type === noteSchema.nodes.heading ? changeLevel(-1)(state, dispatch) : liftListItem(noteSchema.nodes.list_item)(state, dispatch),
    Enter: enter, Backspace: chainCommands(undoInputRule, baseKeymap.Backspace),
  };
  const plugins = [inputRules({ rules }), keymap(keys), keymap(baseKeymap), history(), identity];
  let doc = originalNode;
  if (options.json) try { doc = noteSchema.nodeFromJSON(options.json); } catch { /* the saved section draft still opens */ }
  view = new EditorView(element, {
    state: EditorState.create({ doc, plugins }),
    editable: options.editable,
    attributes: { role: "textbox", "aria-label": "Note content", "aria-multiline": "true", spellcheck: "true" },
    dispatchTransaction(transaction) {
      const result = view.state.applyTransaction(transaction); view.updateState(result.state);
      if (!silent && result.transactions.some((tr) => tr.docChanged)) options.changed();
      focusLevel();
    },
    handlePaste(_view, event) {
      const clipboard = event.clipboardData, text = clipboard?.getData("text/plain");
      if (!text || clipboard?.getData("text/html")) return false;
      const parsed = markdownSlice(text);
      view.dispatch(view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView()); return true;
    },
  });
  // Assign identities even to Markdown headings restored from a browser draft or pasted as plain text.
  view.dispatch(view.state.tr.setMeta("addToHistory", false));
  focusLevel();
  return {
    json: () => view.state.doc.toJSON(),
    document: (title: string) => read(view.state.doc, title),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    level: (level: number) => {
      const command = level ? setBlockType(noteSchema.nodes.heading, { ...view.state.selection.$from.parent.attrs, level, id: view.state.selection.$from.parent.type === noteSchema.nodes.heading ? current()?.node.attrs.id || draftId() : draftId(), graph: view.state.selection.$from.parent.type === noteSchema.nodes.heading ? current()?.node.attrs.graph ?? null : null }) : setBlockType(noteSchema.nodes.paragraph);
      command(view.state, view.dispatch); view.focus();
    },
    deeper: () => { changeLevel(1)(view.state, view.dispatch); view.focus(); },
    shallower: () => { changeLevel(-1)(view.state, view.dispatch); view.focus(); },
    reveal: (id: string, focus: boolean) => {
      const row = headingRows(view.state.doc).rows.find((r) => r.node.attrs.id === id); if (!row) return;
      const dom = view.nodeDOM(row.pos) as HTMLElement | null; dom?.scrollIntoView({ block: "center" });
      if (focus) { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(row.pos + 1)))); view.focus(); }
    },
    saved: (next: NoteDocument, sectionIds: Record<string,string> = {}) => {
      // Saved headings receive server IDs without replacing the document or clearing its typing history.
      const rows = headingRows(view.state.doc).rows;
      const tr = view.state.tr.setMeta("addToHistory", false);
      for (const row of rows) if (String(row.node.attrs.id).startsWith("draft-")) {
        const saved = next.sections.find((s) => s.id === sectionIds[row.node.attrs.id]); if (saved) { aliases.set(row.node.attrs.id, saved.id); tr.setNodeMarkup(row.pos, undefined, { ...row.node.attrs, id: saved.id, graph: saved.graph, inside: !!saved.inside }); }
      }
      silent = true; view.dispatch(tr); silent = false; read = noteReader(next, view.state.doc);
    },
  };
}

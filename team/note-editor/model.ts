import { Fragment, Schema, type Node as ProseNode, type NodeSpec } from "prosemirror-model";
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser } from "prosemirror-markdown";

export type Section = { id: string; label: string; body: string; parent: string; graph: string; depth: number; inside?: boolean };
export type NoteDocument = { title: string; description: string; sections: Section[] };

const heading: NodeSpec = {
  attrs: { level: { default: 1 }, id: { default: null }, graph: { default: null }, inside: { default: false } },
  content: "inline*", group: "block", defining: true,
  parseDOM: Array.from({ length: 6 }, (_, i) => ({ tag: `h${i + 1}`, getAttrs: (dom: HTMLElement) => ({ level: Math.max(1, Math.min(5000, Number(dom.dataset.level) || i + 1)) }) })),
  toDOM: (node) => [`h${Math.min(6, node.attrs.level)}`, { "data-note-id": node.attrs.id, "data-level": node.attrs.level, class: `note-heading${node.attrs.level > 6 ? " note-deep" : ""}` }, 0],
};
export const noteSchema = new Schema({ nodes: defaultMarkdownParser.schema.spec.nodes.update("heading", heading), marks: defaultMarkdownParser.schema.spec.marks });
const parser = new MarkdownParser(noteSchema, defaultMarkdownParser.tokenizer, defaultMarkdownParser.tokens);
const draftId = () => `draft-${crypto.randomUUID()}`;

export function bodyNodes(body: string): ProseNode[] {
  const blocks: ProseNode[] = [];
  // Headings already stored in a box's body remain body text. Only the document's own headings create boxes.
  parser.parse(body).forEach((node) => blocks.push(node.type === noteSchema.nodes.heading ? noteSchema.nodes.paragraph.create(null, node.content) : node));
  return blocks;
}

export function documentNode(document: NoteDocument): ProseNode {
  const blocks: ProseNode[] = document.description ? bodyNodes(document.description) : [];
  for (const section of document.sections) {
    blocks.push(noteSchema.nodes.heading.create({ level: section.depth + 1, id: section.id, graph: section.graph, inside: !!section.inside }, section.label ? noteSchema.text(section.label) : null));
    if (section.body) blocks.push(...bodyNodes(section.body));
  }
  if (!blocks.length || blocks.at(-1)?.type !== noteSchema.nodes.paragraph) blocks.push(noteSchema.nodes.paragraph.create());
  return noteSchema.nodes.doc.create(null, blocks);
}

export function headingRows(doc: ProseNode) {
  const rows: { node: ProseNode; pos: number; blocks: ProseNode[] }[] = [];
  const introduction: ProseNode[] = [];
  doc.forEach((node, pos) => {
    if (node.type === noteSchema.nodes.heading) rows.push({ node, pos, blocks: [] });
    else (rows.at(-1)?.blocks || introduction).push(node);
  });
  return { rows, introduction };
}

const serialized = (blocks: ProseNode[]) => defaultMarkdownSerializer.serialize(noteSchema.nodes.doc.create(null, blocks.length ? blocks : noteSchema.nodes.paragraph.create()));
const contentKey = (blocks: ProseNode[]) => JSON.stringify(blocks.map((b) => b.toJSON()));

export function noteReader(initial: NoteDocument, initialNode: ProseNode) {
  const original = new Map(initial.sections.map((s) => [s.id, s]));
  const baseline = headingRows(initialNode);
  const bodies = new Map(baseline.rows.map((r) => [r.node.attrs.id, contentKey(r.blocks)]));
  return (doc: ProseNode, title: string): NoteDocument => {
    const { rows, introduction } = headingRows(doc);
    const sections: Section[] = [], ancestors: { section: Section; level: number }[] = [];
    let previous: Section | undefined;
    for (const { node, blocks } of rows) {
      const level = Number(node.attrs.level), id = String(node.attrs.id || draftId()), label = node.textContent.trim();
      if (!label) throw new Error("Give the empty heading a name before saving.");
      while (ancestors.length && ancestors.at(-1)!.level >= level) ancestors.pop();
      const parent = ancestors.at(-1)?.section;
      let graph = node.attrs.graph;
      if (graph === null) graph = parent?.inside ? parent.id : parent?.graph || "";
      if (node.attrs.graph === null && previous?.graph && (parent?.id === previous.graph || parent?.graph === previous.graph)) graph = previous.graph;
      if (graph && !parent) throw new Error("Keep a heading for the map that contains this section.");
      if (parent && parent.graph !== graph && parent.id !== graph) throw new Error("This heading is inside another map. Move it within that map's headings.");
      const old = original.get(id);
      const body = old && bodies.get(id) === contentKey(blocks) ? old.body : serialized(blocks);
      const section: Section = { id, label, body, graph, parent: parent?.id || "", depth: parent ? parent.depth + 1 : 0, inside: node.attrs.inside };
      sections.push(section); ancestors.push({ section, level }); previous = section;
    }
    const description = contentKey(introduction) === contentKey(baseline.introduction) ? initial.description : serialized(introduction);
    return { title, description, sections };
  };
}

export function markdownSlice(text: string) {
  return parser.parse(text);
}

export function sameBlocks(a: ProseNode, b: ProseNode) {
  return a.content.eq(b.content);
}

export { draftId, Fragment };

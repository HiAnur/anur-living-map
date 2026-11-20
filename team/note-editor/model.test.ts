import { describe, expect, it } from "vitest";

import { documentNode, markdownSlice, noteReader, noteSchema, type NoteDocument } from "./model.ts";

const note = (): NoteDocument => ({ title: "Company", description: "", sections: [
  { id: "company", label: "Company", body: "A **bold** plan.\n\n- First\n- Second", parent: "", graph: "", depth: 0 },
  { id: "team", label: "Team", body: "Two people", parent: "company", graph: "", depth: 1 },
] });

describe("the continuous note document", () => {
  it("renders existing bodies as rich prose and preserves their exact stored Markdown when untouched", () => {
    const initial = note(), doc = documentNode(initial);
    expect(noteReader(initial, doc)(doc, initial.title)).toEqual(initial.sections.length ? { ...initial, sections: initial.sections.map((s) => ({ ...s, inside: false })) } : initial);
    expect(doc.toString()).toContain("strong(\"bold\")");
  });
  it("keeps twelve heading levels without indentation or a six-heading limit", () => {
    const initial = note(); initial.sections = Array.from({ length: 12 }, (_, i) => ({ id: `box-${i}`, label: `Level ${i + 1}`, body: "", parent: i ? `box-${i - 1}` : "", graph: "", depth: i }));
    const doc = documentNode(initial), projected = noteReader(initial, doc)(doc, initial.title);
    expect(projected.sections.map((s) => s.depth)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(projected.sections[11].parent).toBe("box-10");
    expect(doc.child(11).attrs.level).toBe(12);
  });
  it("uses heading levels for parents and leaves bullets and paragraphs in the current box", () => {
    const initial = note(), doc = markdownSlice("# Company\n\nIntro\n\n## Product\n\n- One\n- Two\n\n### Roadmap\n\nSoon\n\n## Team\n\nTwo people");
    const result = noteReader(initial, documentNode(initial))(doc, initial.title);
    expect(result.sections.map((s) => [s.label, s.depth])).toEqual([["Company", 0], ["Product", 1], ["Roadmap", 2], ["Team", 1]]);
    expect(result.sections[1].body).toBe("* One\n* Two");
    expect(result.sections[2].parent).toBe(result.sections[1].id);
    expect(result.sections[3].parent).toBe(result.sections[0].id);
  });
  it("keeps a heading identity when its words or level change", () => {
    const initial = note(), doc = documentNode(initial);
    const blocks = [noteSchema.nodes.heading.create({ level: 1, id: "team", graph: "" }, noteSchema.text("People")), noteSchema.nodes.paragraph.create(null,noteSchema.text("Two people")), noteSchema.nodes.heading.create({ level: 2, id: "company", graph: "" },noteSchema.text("Company"))];
    const edited = noteSchema.nodes.doc.create(null,blocks), projected = noteReader(initial,doc)(edited,initial.title);
    expect(projected.sections.map((s) => [s.id,s.parent])).toEqual([["team",""],["company","team"]]);
  });
  it("refuses unnamed headings without losing the editor document", () => {
    const initial = note(), doc = documentNode(initial), blank = noteSchema.nodes.doc.create(null,noteSchema.nodes.heading.create({level:1,id:"company",graph:""}));
    expect(() => noteReader(initial,doc)(blank,initial.title)).toThrow("empty heading");
  });
});

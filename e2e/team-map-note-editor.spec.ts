import { expect, test } from "@playwright/test";

import { openSample, server, useTeamServer } from "./team-map.harness.ts";
import {
  noteBody,
  noteHeading,
  noteInput,
  pasteNote,
} from "./team-note.harness.ts";

useTeamServer();

test("pasted Markdown creates boxes from headings, with paragraphs and bullets kept as notes", async ({
  page,
}) => {
  const name = await openSample(page);
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteInput(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await pasteNote(
    page,
    "# Company\n\nA clear plan.\n\n## Product\n\n- Build\n- Test\n\n### Roadmap\n\nSoon\n\n## Team\n\nTwo founders",
  );
  await expect(
    page.getByRole("button", { name: "Add subsection", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "+ Add section", exact: true }),
  ).toHaveCount(0);
  await expect(noteInput(page).locator("h1,h2,h3")).toHaveCount(4);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
  const state = await (
    await page.request.get(`${server.origin}/${name}/api/state`)
  ).json();
  const company = state.nodes.find(
      (n: { label: string }) => n.label === "Company",
    ),
    product = state.nodes.find((n: { label: string }) => n.label === "Product"),
    roadmap = state.nodes.find((n: { label: string }) => n.label === "Roadmap"),
    team = state.nodes.find((n: { label: string }) => n.label === "Team");
  expect(state.nodes).toHaveLength(4);
  expect(state.edges).toEqual(
    expect.arrayContaining([
      { from: company.id, to: product.id },
      { from: product.id, to: roadmap.id },
      { from: company.id, to: team.id },
    ]),
  );
  expect(product.desc).toBe("* Build\n* Test");
  await page.reload();
  await expect(noteHeading(page, roadmap.id)).toHaveText("Roadmap");
  await page.screenshot({
    path: test.info().outputPath("continuous-note.png"),
  });
});

test("twelve heading levels survive saving, map view and reload", async ({
  page,
}) => {
  const name = await openSample(page);
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteInput(page).fill("");
  for (let level = 1; level <= 12; level++) {
    await page.keyboard.type(
      `${"#".repeat(Math.min(level, 6))} Depth ${level}`,
    );
    for (let i = 6; i < level; i++) await page.keyboard.press("Alt+ArrowRight");
    await expect(
      noteInput(page).locator(".note-heading").last(),
    ).toHaveAttribute("data-level", String(level));
    if (level < 12) await page.keyboard.press("Enter");
  }
  await expect(page.locator("#note-current-level")).toHaveText("Level 12");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
  const state = await (
    await page.request.get(`${server.origin}/${name}/api/state`)
  ).json();
  for (let level = 2; level <= 12; level++) {
    const parent = state.nodes.find(
        (n: { label: string }) => n.label === `Depth ${level - 1}`,
      ),
      child = state.nodes.find(
        (n: { label: string }) => n.label === `Depth ${level}`,
      );
    expect(state.edges).toContainEqual({ from: parent.id, to: child.id });
  }
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await page.reload();
  const deepest = noteInput(page).locator('[data-level="12"]');
  await expect(deepest).toHaveText("Depth 12");
  const first = await noteInput(page).locator("h1").boundingBox(),
    last = await deepest.boundingBox();
  expect(first!.x).toBe(last!.x);
  await deepest.click();
  await page.getByRole("button", { name: "Shallower", exact: true }).click();
  await expect(deepest).toHaveCount(0);
  await page.getByRole("button", { name: "Deeper", exact: true }).click();
  await expect(noteInput(page).locator('[data-level="12"]')).toHaveText(
    "Depth 12",
  );
});

test("typing undo remains available after Save and heading edits retain their box identity", async ({
  page,
}) => {
  const name = await openSample(page);
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteHeading(page, "pricing").fill("Plans");
  await noteBody(page, "pricing").fill("First draft");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
  await noteBody(page, "pricing").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(noteBody(page, "pricing")).not.toHaveText("First draft");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
  const state = await (
    await page.request.get(`${server.origin}/${name}/api/state`)
  ).json();
  expect(
    state.nodes.find((n: { id: string }) => n.id === "pricing"),
  ).toBeTruthy();
  expect(state.nodes).toHaveLength(4);
});

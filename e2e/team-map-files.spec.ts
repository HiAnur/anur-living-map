import { expect, test } from "@playwright/test";

import {
  SAMPLE,
  box,
  openSample,
  server,
  useTeamServer,
} from "./team-map.harness.ts";
import { noteBody, noteHeading } from "./team-note.harness.ts";

useTeamServer();

test("edits a map as a note, adds a subsection and opens the same boxes again", async ({
  page,
}) => {
  const name = await openSample(page);
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await expect(noteBody(page, "pricing")).toHaveText("Plans and trials");
  const pricing = noteHeading(page, "pricing");
  await pricing.fill("Plans");
  await noteBody(page, "pricing").fill("Monthly and annual");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Keep a fourteen-day trial.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("### Annual plan");
  await expect(noteHeading(page, "trial")).toBeVisible();
  await expect(noteHeading(page, "audience")).toBeVisible();
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect(box(page, "Plans")).toBeVisible();
  const state = await (
    await page.request.get(`${server.origin}/${name}/api/state`)
  ).json();
  expect(
    state.nodes.find((n: { id: string }) => n.id === "pricing"),
  ).toMatchObject({
    label: "Plans",
    desc: "Monthly and annual\n\nKeep a fourteen-day trial.",
  });
  const annual = state.nodes.find(
    (n: { label: string }) => n.label === "Annual plan",
  );
  expect(state.edges).toContainEqual({ from: "pricing", to: annual.id });
  expect(state.edges).toEqual(expect.arrayContaining(SAMPLE.edges));
  await box(page, "Plans").dblclick();
  await page.locator("#newbox textarea").fill("Subscriptions");
  await page.locator("#newbox textarea").press("Enter");
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await expect(pricing).toHaveText("Subscriptions");
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Note", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(pricing).toHaveText("Subscriptions");
});

test("creates nested folders and a note, and moving the file keeps its address", async ({
  page,
}) => {
  await page.goto(server.origin);
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("workspace");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "workspace", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("research");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await page.getByLabel("New file", { exact: true }).click();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Customer interviews");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Customer interviews",
  );
  await page
    .locator("#note-input .note-heading")
    .first()
    .locator("xpath=following-sibling::p[1]")
    .fill("Talk to five founders.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#crumbs .dir")).toHaveText("workspace / research");
  await page.screenshot({
    path: test.info().outputPath("folders-and-note.png"),
  });
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  const address = page.url().split("?")[0];
  await page
    .getByRole("button", {
      name: "File actions for Customer interviews",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Move to folder", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Folder", { exact: true })
    .selectOption("");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move", exact: true })
    .click();
  await page.reload();
  expect(page.url().split("?")[0]).toBe(address);
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await expect(
    page
      .locator("#note-input .note-heading")
      .first()
      .locator("xpath=following-sibling::p[1]"),
  ).toHaveText("Talk to five founders.");
  const library = await (
    await page.request.get(`${server.origin}/api/library`, {
      headers: { "sec-fetch-site": "same-origin" },
    })
  ).json();
  const research = library.folders.find(
    (f: { title: string }) => f.title === "research",
  );
  const workspace = library.folders.find(
    (f: { title: string }) => f.title === "workspace",
  );
  expect(research.parent).toBe(workspace.id);
  expect(
    library.files.find(
      (f: { title: string }) => f.title === "Customer interviews",
    ).parent,
  ).toBe("");
});

test("keeps a stale draft and refuses to overwrite a concurrent map edit", async ({
  page,
}) => {
  const name = await openSample(page);
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteBody(page, "pricing").fill("My draft");
  const response = await page.request.post(`${server.origin}/${name}/api/act`, {
    data: { type: "renamebox", id: "pricing", label: "Plans" },
    headers: { origin: server.origin },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Note", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(noteBody(page, "pricing")).toHaveText("My draft");
  await expect(page.locator("#note-save-state")).toContainText("map changed");
  const state = await (
    await page.request.get(`${server.origin}/${name}/api/state`)
  ).json();
  expect(
    state.nodes.find((n: { id: string }) => n.id === "pricing").label,
  ).toBe("Plans");
  await page.reload();
  await expect(noteBody(page, "pricing")).toHaveText("My draft");
  await page
    .getByRole("button", { name: "Discard draft and reload", exact: true })
    .click();
  await expect(noteHeading(page, "pricing")).toHaveText("Plans");
});

test("folder updates reject cycles, stale writes and requests from another site", async ({
  page,
}) => {
  await page.goto(server.origin);
  const get = async () =>
    (
      await page.request.get(`${server.origin}/api/library`, {
        headers: { "sec-fetch-site": "same-origin" },
      })
    ).json();
  const change = async (data: object, origin = server.origin) =>
    page.request.post(`${server.origin}/api/library`, {
      data,
      headers: { origin },
    });
  const start = await get();
  const first = await change({
    op: "createfolder",
    title: "parent",
    parent: "",
    revision: start.revision,
  });
  const { id } = await first.json();
  expect(first.ok()).toBe(true);
  expect(
    (
      await change({
        op: "createfolder",
        title: "stale",
        revision: start.revision,
      })
    ).status(),
  ).toBe(409);
  let now = await get();
  const child = await (
    await change({
      op: "createfolder",
      title: "child",
      parent: id,
      revision: now.revision,
    })
  ).json();
  now = await get();
  expect(
    (
      await change({
        op: "movefolder",
        id,
        parent: child.id,
        revision: now.revision,
      })
    ).status(),
  ).toBe(400);
  expect(
    (await change({ op: "removefolder", id, revision: now.revision })).status(),
  ).toBe(400);
  expect(
    (
      await change(
        { op: "createfolder", title: "outside", revision: now.revision },
        "https://example.com",
      )
    ).status(),
  ).toBe(403);
  const other = await page.request.get(
    `${server.origin}/api/library?share=${"a".repeat(64)}`,
  );
  expect(other.status()).toBe(403);
});

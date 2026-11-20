import { expect, test } from "@playwright/test";

import { signInAs, useCloudSharingServer } from "./team-map-sharing.harness.ts";
import { box, openSample } from "./team-map.harness.ts";

useCloudSharingServer();

test("email sharing supplies named assignments and each person's To-do", async ({
  page,
  browser,
}) => {
  await signInAs("owner@example.com", "Owner");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) =>
          sessionStorage.setItem("copied-link", text),
      },
    });
  });
  await openSample(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.locator("#share");
  await share.getByRole("button", { name: "Copy link", exact: true }).click();
  await page
    .getByRole("button", { name: "Upload and copy link", exact: true })
    .click();
  await expect(share.getByText("Shared online", { exact: true })).toBeVisible();
  await share.getByLabel("Email address to add").fill("Sam@example.com");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByLabel("Access for sam@example.com")).toHaveValue(
    "edit",
  );
  await share.getByLabel("Email address to add").fill("viewer@example.com");
  await share.getByLabel("New person's access").selectOption("view");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByLabel("Access for viewer@example.com")).toHaveValue(
    "view",
  );
  await share
    .getByRole("button", { name: "Anyone with the link can view", exact: true })
    .click();
  await share
    .getByRole("menuitemradio", { name: "Turn off link", exact: true })
    .click();
  await expect(
    share.getByRole("button", { name: "Link sharing is off", exact: true }),
  ).toBeVisible();
  await share
    .getByRole("button", { name: "Copy online link", exact: true })
    .click();
  const link = (await page.evaluate(() =>
    sessionStorage.getItem("copied-link"),
  ))!;
  await page.screenshot({ path: test.info().outputPath("email-sharing.png") });
  await share.locator("[data-close-share]").click();
  await box(page, "Pricing").click();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const design = page.locator("#design");
  const samChoice = design.getByRole("button", {
    name: "Assign to sam@example.com",
    exact: true,
  });
  await expect(samChoice).toHaveText("S");
  await expect(samChoice).toHaveAttribute("title", "Sam");
  await expect(
    design.getByRole("button", {
      name: "Assign to owner@example.com",
      exact: true,
    }),
  ).toHaveAttribute("title", "Owner");
  await expect(
    design.getByRole("button", { name: "Blue person", exact: true }),
  ).toHaveCount(0);
  await design
    .getByRole("button", { name: "Assign to sam@example.com", exact: true })
    .click();
  await expect(
    box(page, "Pricing").getByRole("img", {
      name: "sam@example.com",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    design.getByRole("button", { name: "Clear person", exact: true }),
  ).toHaveCount(0);
  await samChoice.click();
  await expect(
    box(page, "Pricing").getByRole("img", {
      name: "sam@example.com",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(samChoice).toHaveAttribute("aria-pressed", "false");
  await samChoice.click();
  await expect(samChoice).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: test.info().outputPath("email-person-picker.png"),
  });
  await box(page, "Audience").click();
  await design
    .getByRole("button", { name: "Assign to owner@example.com", exact: true })
    .click();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  const todos = page.getByRole("complementary", { name: "To-do", exact: true });
  await expect(
    todos.getByRole("button", { name: "Audience", exact: true }),
  ).toBeVisible();
  await expect(
    todos.getByRole("button", { name: "Pricing", exact: true }),
  ).toHaveCount(0);
  await todos.locator('[data-todo-check="audience"]').check();
  await expect(
    todos.getByRole("checkbox", {
      name: "Mark Audience not done",
      exact: true,
    }),
  ).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(
    todos.getByRole("checkbox", {
      name: "Mark Audience not done",
      exact: true,
    }),
  ).toBeChecked();
  await todos.locator('[data-todo-check="audience"]').uncheck();
  await expect(
    todos.getByRole("checkbox", { name: "Mark Audience done", exact: true }),
  ).not.toBeChecked();

  const recipient = await browser.newContext();
  const sam = await recipient.newPage();
  await sam.goto(link);
  await expect(sam.locator("[data-gate]")).toContainText(
    "Sign in to open this map",
  );
  await signInAs("sam@example.com", "Sam");
  await sam
    .getByRole("link", { name: "Sign in with Google", exact: true })
    .click();
  await expect(box(sam, "Pricing")).toBeVisible();
  await sam.getByRole("button", { name: "To-do", exact: true }).click();
  const samTodos = sam.getByRole("complementary", {
    name: "To-do",
    exact: true,
  });
  await expect(
    samTodos.getByRole("button", { name: "Pricing", exact: true }),
  ).toBeVisible();
  await expect(
    samTodos.getByRole("button", { name: "Audience", exact: true }),
  ).toHaveCount(0);
  await samTodos.locator('[data-todo-check="pricing"]').check();
  await expect(
    samTodos.getByRole("checkbox", {
      name: "Mark Pricing not done",
      exact: true,
    }),
  ).toBeChecked();
  await sam.screenshot({ path: test.info().outputPath("personal-todos.png") });
  await samTodos.getByRole("button", { name: "Pricing", exact: true }).click();
  await expect(box(sam, "Pricing")).toHaveClass(/sel/);

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await share.getByLabel("Access for sam@example.com").selectOption("view");
  await expect(sam.locator("body")).toHaveClass(/view-only/);
  await sam.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(
    samTodos.getByRole("checkbox", {
      name: "Mark Pricing not done",
      exact: true,
    }),
  ).toBeDisabled();
  await share
    .getByRole("button", { name: "Remove sam@example.com", exact: true })
    .click();
  await expect(share.getByLabel("Access for sam@example.com")).toHaveCount(0);
  await expect(sam.locator("[data-gate]")).toContainText(
    "Ask Owner for access",
  );
  await share.locator("[data-close-share]").click();
  await box(page, "Pricing").click();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect(
    design.getByRole("button", {
      name: "Assign to sam@example.com",
      exact: true,
    }),
  ).toHaveCount(0);
  await recipient.close();
});

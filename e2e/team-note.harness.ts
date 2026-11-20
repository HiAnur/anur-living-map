import type { Page } from "@playwright/test";

export const noteHeading = (page: Page, id: string) =>
  page.locator(`#note-input [data-note-id="${id}"]`);
export const noteBody = (page: Page, id: string) =>
  noteHeading(page, id).locator("xpath=following-sibling::p[1]");
export const noteInput = (page: Page) =>
  page.getByRole("textbox", { name: "Note content", exact: true });

export async function pasteNote(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.querySelector("#note-input .ProseMirror")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

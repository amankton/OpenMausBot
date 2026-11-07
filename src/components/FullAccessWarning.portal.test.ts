// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FullAccessWarning } from "./FullAccessWarning";

it("keeps the normal consent and thread scope above a scrolling settings sheet", async () => {
  const sheet = document.createElement("aside");
  sheet.style.cssText = "overflow:hidden;transform:translateX(0);height:120px";
  document.body.append(sheet);
  const root = createRoot(sheet);
  const confirm = vi.fn(), cancel = vi.fn(), scope = vi.fn();
  try {
    await act(async () => root.render(createElement(FullAccessWarning, { open: true, onConfirm: confirm, onCancel: cancel, allThreads: true, onAllThreadsChange: scope })));
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog).not.toBeNull();
    expect(sheet.contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.activeElement?.textContent).toBe("Cancel");
    const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);
    expect(dialog.textContent).toContain("Includes archived threads");
    await act(async () => checkbox.click());
    expect(scope).toHaveBeenCalledWith(false);
    expect(confirm).not.toHaveBeenCalled();
    const enable = [...dialog.querySelectorAll("button")].find(button => button.textContent === "Enable full access")!;
    await act(async () => enable.click());
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    sheet.remove();
  }
});

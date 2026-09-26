// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DialogFrame } from "@/components/ui/DialogFrame";

afterEach(cleanup);

describe("DialogFrame", () => {
  it("names the dialog by its title and renders body/footer", () => {
    const onClose = vi.fn();
    render(
      <DialogFrame title="Delete branch" onClose={onClose} footer={<button>Delete</button>} footerStart={<span>1 commit</span>}>
        <p>This cannot be undone.</p>
      </DialogFrame>,
    );
    expect(screen.getByRole("dialog", { name: "Delete branch" })).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.getByText("1 commit")).toBeTruthy();
  });

  it("closes on the header close button and on Escape when dismissible", () => {
    const onClose = vi.fn();
    render(
      <DialogFrame title="Rename branch" onClose={onClose}>
        <p>body</p>
      </DialogFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("hides the close button when not dismissible, even with an onClose handler", () => {
    render(
      <DialogFrame title="Working…" onClose={vi.fn()} dismissible={false}>
        <p>please wait</p>
      </DialogFrame>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

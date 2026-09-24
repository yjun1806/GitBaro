// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "@/components/ui/Dialog";

afterEach(cleanup);

function Harness({ dismissible = true, onClose }: { dismissible?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      <button>outside</button>
      {open && (
        <Dialog onClose={close} labelledBy="t" dismissible={dismissible}>
          <h2 id="t">Title</h2>
          <button>first</button>
          <input aria-label="field" />
          <button>last</button>
        </Dialog>
      )}
    </div>
  );
}

function openDialog() {
  const opener = screen.getByText("open");
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Dialog", () => {
  it("exposes dialog semantics named by its heading", () => {
    render(<Harness />);
    openDialog();
    const dialog = screen.getByRole("dialog", { name: "Title" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("moves focus into the dialog and back to the opener on Escape", () => {
    render(<Harness />);
    const opener = openDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Escape from closing while not dismissible", () => {
    const onClose = vi.fn();
    render(<Harness dismissible={false} onClose={onClose} />);
    openDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes on Escape pressed while focus is outside the panel", () => {
    render(<Harness />);
    openDialog();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wraps Tab from the last element to the first and back", () => {
    render(<Harness />);
    openDialog();
    const dialog = screen.getByRole("dialog");
    const first = screen.getByText("first");
    const last = screen.getByText("last");

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes only the innermost of nested dialogs on Escape", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Dialog onClose={outerClose} labelledBy="o">
        <h2 id="o">Outer</h2>
        <Dialog onClose={innerClose} labelledBy="i">
          <h2 id="i">Inner</h2>
          <button>inner button</button>
        </Dialog>
      </Dialog>,
    );
    screen.getByText("inner button").focus();
    fireEvent.keyDown(screen.getByText("inner button"), { key: "Escape" });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click only when asked to", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog onClose={onClose} labelledBy="t">
        <h2 id="t">Title</h2>
      </Dialog>,
    );
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <Dialog onClose={onClose} labelledBy="t" closeOnBackdrop>
        <h2 id="t">Title</h2>
      </Dialog>,
    );
    fireEvent.click(screen.getByText("Title"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

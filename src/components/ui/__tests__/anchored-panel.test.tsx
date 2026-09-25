// @vitest-environment jsdom
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnchoredPanel } from "@/components/ui/AnchoredPanel";

afterEach(cleanup);

function Harness({ dismissible = true, onClose }: { dismissible?: boolean; onClose?: () => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <div>
      <button ref={anchorRef} onClick={() => setOpen(true)}>
        open
      </button>
      <button>outside</button>
      {open && (
        <AnchoredPanel anchorRef={anchorRef} onClose={close} labelledBy="t" dismissible={dismissible}>
          <h2 id="t">Panel</h2>
          <button>first</button>
          <input aria-label="field" />
          <button>last</button>
        </AnchoredPanel>
      )}
    </div>
  );
}

function openPanel() {
  const opener = screen.getByText("open");
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("AnchoredPanel", () => {
  it("exposes dialog semantics named by its heading", () => {
    render(<Harness />);
    openPanel();
    const panel = screen.getByRole("dialog", { name: "Panel" });
    expect(panel.getAttribute("aria-modal")).toBe("true");
  });

  it("positions itself under the anchor as a fixed-position element", () => {
    render(<Harness />);
    const opener = openPanel();
    const panel = screen.getByRole("dialog");
    expect(panel.style.position).toBe("fixed");
    // jsdom has no real layout, so every rect is 0×0 at (0, 0); the left edge
    // is then clamped up to the default 8px margin from the window edge.
    expect(opener.getBoundingClientRect().left).toBe(0);
    expect(panel.style.left).toBe("8px");
  });

  it("caps its height to the room left in the window (maxHeight) once measured", () => {
    render(<Harness />);
    openPanel();
    const panel = screen.getByRole("dialog");
    // jsdom reports a 0-height window, so the clamped room is 0px here — the
    // point of this test is that `maxHeight` gets set at all (wired through
    // from `clampPanelToViewport`), not the specific jsdom value.
    expect(panel.style.maxHeight).not.toBe("");
  });

  it("grows back to its natural height when the window gets taller", () => {
    const NATURAL = 400;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const capped = this.getAttribute("role") === "dialog" && this.style.maxHeight !== "";
      const height = capped ? Math.min(NATURAL, parseFloat(this.style.maxHeight)) : this.getAttribute("role") === "dialog" ? NATURAL : 20;
      return { left: 0, top: 0, right: 100, bottom: height, width: 100, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const innerHeight = vi.spyOn(window, "innerHeight", "get").mockReturnValue(200);
    try {
      render(<Harness />);
      openPanel();
      const panel = screen.getByRole("dialog");
      const small = parseFloat(panel.style.maxHeight);
      expect(small).toBeLessThan(NATURAL);

      innerHeight.mockReturnValue(1000);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(parseFloat(panel.style.maxHeight)).toBe(NATURAL);
    } finally {
      rect.mockRestore();
      innerHeight.mockRestore();
    }
  });

  it("moves focus into the panel and back to the opener on Escape", () => {
    render(<Harness />);
    const opener = openPanel();
    const panel = screen.getByRole("dialog");
    expect(panel.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Escape from closing while not dismissible", () => {
    const onClose = vi.fn();
    render(<Harness dismissible={false} onClose={onClose} />);
    openPanel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("wraps Tab from the last element to the first and back", () => {
    render(<Harness />);
    openPanel();
    const panel = screen.getByRole("dialog");
    const first = screen.getByText("first");
    const last = screen.getByText("last");

    last.focus();
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(panel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on a click outside the panel by default (popover semantics)", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openPanel();
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.click(screen.getByText("Panel"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

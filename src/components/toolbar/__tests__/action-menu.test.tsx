// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useUIStore } from "@/stores/ui";
import { useDiffMaximizeEscape } from "@/components/layout/useDiffMaximize";
import { ActionMenu } from "../ActionButton";

afterEach(cleanup);

function Host({ onClose }: { onClose: () => void }) {
  useDiffMaximizeEscape();
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef}>trigger</button>
      <ActionMenu
        anchorRef={anchorRef}
        onClose={onClose}
        items={[
          { key: "a", label: "Pull", onSelect: vi.fn() },
          { key: "b", label: "Pull with rebase", onSelect: vi.fn() },
        ]}
      />
    </>
  );
}

describe("ActionMenu", () => {
  it("closes on Escape without leaving the maximized diff", () => {
    useUIStore.setState({ isDiffMaximized: true });
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(useUIStore.getState().isDiffMaximized).toBe(true);
  });

  it("moves between items with the arrow keys", () => {
    render(<Host onClose={vi.fn()} />);
    expect(document.activeElement?.textContent).toBe("Pull");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Pull with rebase");
  });
});

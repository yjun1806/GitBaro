// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu } from "@/components/ui/ContextMenu";

afterEach(cleanup);

function renderMenu(onClose = vi.fn(), onDelete = vi.fn()) {
  render(
    <ContextMenu
      position={{ x: 0, y: 0 }}
      onClose={onClose}
      sections={[
        {
          items: [
            { label: "Copy", onClick: vi.fn() },
            { label: "Disabled", onClick: vi.fn(), disabled: true },
          ],
        },
        { items: [{ label: "Delete", onClick: onDelete }] },
      ]}
    />,
  );
  return { onClose, onDelete };
}

describe("ContextMenu keyboard support", () => {
  it("focuses the first item and skips disabled items with the arrow keys", () => {
    renderMenu();
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy" }));

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
  });

  it("runs the focused item on Enter (native button click) and closes", () => {
    const { onClose, onDelete } = renderMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without letting it reach other listeners", () => {
    const other = vi.fn();
    document.addEventListener("keydown", other);
    const { onClose } = renderMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    document.removeEventListener("keydown", other);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });
});

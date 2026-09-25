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

describe("ContextMenu closing", () => {
  it("closes when the page under it scrolls by wheel, but not when the menu itself does", () => {
    const { onClose } = renderMenu();
    fireEvent.wheel(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.wheel(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the window loses focus or resizes", () => {
    const { onClose } = renderMenu();
    fireEvent(window, new Event("blur"));
    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close on a programmatic scroll (a row scrolled into view on right-click)", () => {
    const { onClose } = renderMenu();
    fireEvent.scroll(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("contextMenuPoint", () => {
  it("uses the pointer, or the element's bottom edge when opened from the keyboard", async () => {
    const { contextMenuPoint } = await import("@/components/ui/ContextMenu");
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ left: 10, bottom: 40 }) as DOMRect;
    const fake = (x: number, y: number) =>
      ({ clientX: x, clientY: y, currentTarget: el }) as unknown as React.MouseEvent;
    expect(contextMenuPoint(fake(5, 6))).toEqual({ x: 5, y: 6 });
    expect(contextMenuPoint(fake(0, 0))).toEqual({ x: 26, y: 40 });
  });
});

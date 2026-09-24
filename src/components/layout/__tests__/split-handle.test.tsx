// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SplitHandle } from "../SplitHandle";

// jsdom에는 PointerEvent가 없다. 좌표·버튼은 MouseEvent가 싣고 있으니 그 위에 pointerId만 더한다.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

afterEach(cleanup);

function setup(orientation: "vertical" | "horizontal") {
  const onDragStart = vi.fn();
  const onDrag = vi.fn();
  const onReset = vi.fn();
  render(
    <SplitHandle
      orientation={orientation}
      aria-label="resize"
      onDragStart={onDragStart}
      onDrag={onDrag}
      onReset={onReset}
    />,
  );
  return { handle: screen.getByRole("separator", { name: "resize" }), onDragStart, onDrag, onReset };
}

describe("SplitHandle", () => {
  it("reports the distance moved from where the drag started (left/right)", () => {
    const { handle, onDragStart, onDrag } = setup("vertical");
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 5, pointerId: 1 });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 80, clientY: 50, pointerId: 1 });
    expect(onDrag.mock.calls.map((c) => c[0])).toEqual([30, -20]);
    fireEvent.pointerUp(handle, { clientX: 80, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    expect(onDrag).toHaveBeenCalledTimes(2);
  });

  it("uses the vertical axis for a horizontal handle", () => {
    const { handle, onDrag } = setup("horizontal");
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 999, clientY: 260, pointerId: 1 });
    expect(onDrag).toHaveBeenCalledWith(60);
  });

  it("ignores moves without a press and presses of other buttons", () => {
    const { handle, onDrag, onDragStart } = setup("vertical");
    fireEvent.pointerMove(handle, { clientX: 50 });
    fireEvent.pointerDown(handle, { button: 2, clientX: 10 });
    fireEvent.pointerMove(handle, { clientX: 50 });
    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("resets on double-click", () => {
    const { handle, onReset } = setup("vertical");
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

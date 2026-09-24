// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useUIStore } from "@/stores/ui";
import { isEditableTarget, useDiffMaximizeEscape } from "../useDiffMaximize";

function Host() {
  useDiffMaximizeEscape();
  return <input aria-label="field" />;
}

afterEach(() => {
  cleanup();
  useUIStore.setState({ isDiffMaximized: false });
});

describe("isEditableTarget", () => {
  it("is true inside inputs and editable elements", () => {
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.appendChild(inner);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(inner)).toBe(true);
  });

  it("is false elsewhere", () => {
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("useDiffMaximizeEscape", () => {
  it("restores the layout on Escape", () => {
    render(<Host />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useUIStore.getState().isDiffMaximized).toBe(false);
  });

  it("leaves it alone when Escape is pressed in an input", () => {
    const { getByLabelText } = render(<Host />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    act(() => {
      getByLabelText("field").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useUIStore.getState().isDiffMaximized).toBe(true);
  });
});

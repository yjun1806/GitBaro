import { describe, it, expect } from "vitest";
import { isImeComposing, isSubmitEnter } from "../keyboard";

function reactEvent(key: string, native: { isComposing?: boolean; keyCode?: number }) {
  return { key, nativeEvent: native as KeyboardEvent };
}

describe("isSubmitEnter", () => {
  it("accepts a plain Enter", () => {
    expect(isSubmitEnter(reactEvent("Enter", { isComposing: false, keyCode: 13 }))).toBe(true);
  });

  it("ignores the Enter that confirms a Korean composition", () => {
    expect(isSubmitEnter(reactEvent("Enter", { isComposing: true, keyCode: 13 }))).toBe(false);
    expect(isSubmitEnter(reactEvent("Enter", { isComposing: false, keyCode: 229 }))).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isSubmitEnter(reactEvent("a", { isComposing: false, keyCode: 65 }))).toBe(false);
  });
});

describe("isImeComposing", () => {
  it("reads DOM KeyboardEvents directly", () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});

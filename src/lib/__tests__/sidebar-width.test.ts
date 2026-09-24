import { describe, expect, it } from "vitest";
import { clampSidebarWidth } from "@/lib/sidebar-width";

describe("clampSidebarWidth", () => {
  it("keeps a width that fits the window", () => {
    expect(clampSidebarWidth(500, 1440)).toBe(500);
  });

  it("shrinks a width saved on a wider screen so the content panel stays visible", () => {
    // 1800px saved on a 2560px monitor, restored in a 1280px window.
    expect(clampSidebarWidth(1800, 1280)).toBe(580);
  });

  it("never goes below the minimum width", () => {
    expect(clampSidebarWidth(1800, 800)).toBe(200);
    expect(clampSidebarWidth(50, 1440)).toBe(200);
  });
});

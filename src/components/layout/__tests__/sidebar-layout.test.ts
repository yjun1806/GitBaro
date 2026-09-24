import { describe, expect, it } from "vitest";
import { mainColumnLeft, SIDEBAR_HANDLE_WIDTH } from "@/components/layout/sidebar-layout";
import { RAIL_COLLAPSED_WIDTH } from "@/components/layout/RepoRail";

describe("mainColumnLeft", () => {
  it("follows the user-sized sidebar plus the resize handle when pinned open", () => {
    expect(mainColumnLeft("expanded", 300)).toBe(300 + SIDEBAR_HANDLE_WIDTH);
  });

  it("stays at the narrow rail in collapsed and hover modes, whatever the stored width", () => {
    expect(mainColumnLeft("collapsed", 300)).toBe(RAIL_COLLAPSED_WIDTH);
    expect(mainColumnLeft("hover", 900)).toBe(RAIL_COLLAPSED_WIDTH);
  });
});

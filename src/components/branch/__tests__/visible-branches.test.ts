import { describe, expect, it } from "vitest";
import { nextActiveName } from "../visible-branches";

describe("nextActiveName", () => {
  const visible = ["main", "hotfix", "zeta"];

  it("starts at the first or last row", () => {
    expect(nextActiveName(visible, null, "down")).toBe("main");
    expect(nextActiveName(visible, null, "up")).toBe("zeta");
  });

  it("wraps around at both ends", () => {
    expect(nextActiveName(visible, "zeta", "down")).toBe("main");
    expect(nextActiveName(visible, "main", "up")).toBe("zeta");
  });

  it("restarts when the highlighted branch was hidden", () => {
    expect(nextActiveName(visible, "origin/remote-a", "down")).toBe("main");
  });

  it("returns null for an empty list", () => {
    expect(nextActiveName([], "main", "down")).toBeNull();
  });
});

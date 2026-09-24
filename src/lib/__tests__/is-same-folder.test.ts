import { describe, expect, it } from "vitest";
import { isSameFolder } from "@/lib/utils";

describe("isSameFolder", () => {
  it("ignores trailing slashes", () => {
    expect(isSameFolder("/Users/me/app", "/Users/me/app")).toBe(true);
    expect(isSameFolder("/Users/me/app/", "/Users/me/app")).toBe(true);
    expect(isSameFolder("/", "/")).toBe(true);
  });

  it("treats a parent folder as different", () => {
    expect(isSameFolder("/Users/me/code/new-project", "/Users/me")).toBe(false);
    expect(isSameFolder("/Users/me/app/src", "/Users/me/app")).toBe(false);
  });
});

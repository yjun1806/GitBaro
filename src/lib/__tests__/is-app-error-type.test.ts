import { describe, expect, it } from "vitest";
import { isAppErrorType } from "@/lib/utils";

describe("isAppErrorType", () => {
  it("matches a serialized backend error of the given type", () => {
    const err = { type: "BareRepository", message: "Bare repositories are not supported: /x" };
    expect(isAppErrorType(err, "BareRepository")).toBe(true);
    expect(isAppErrorType(err, "RepoNotFound")).toBe(false);
  });

  it("rejects values that are not backend errors", () => {
    expect(isAppErrorType("BareRepository", "BareRepository")).toBe(false);
    expect(isAppErrorType(null, "BareRepository")).toBe(false);
    expect(isAppErrorType(new Error("BareRepository"), "BareRepository")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import type { Finding, RuleDescriptor } from "@/types";
import { countRuleStatuses, findingScope, parseVNumber } from "../rules";

function rule(overrides: Partial<RuleDescriptor> = {}): RuleDescriptor {
  return {
    ruleId: "v2.testSkipAdded",
    kind: "testSkipAdded",
    vNumber: "V2",
    layer: 1,
    defaultSeverity: "warn",
    status: "implemented",
    enabled: true,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    kind: "testSkipAdded",
    severity: "warn",
    file: "src/a.ts",
    line: 1,
    message: "it.skip added",
    detail: null,
    ruleId: "v2.testSkipAdded",
    ...overrides,
  };
}

describe("parseVNumber", () => {
  it("reads the numeric part of a rule id", () => {
    expect(parseVNumber("v2.testSkipAdded")).toBe(2);
    expect(parseVNumber("v35.agentTrailerMismatch")).toBe(35);
  });

  it("returns null for an id that does not match the scheme", () => {
    expect(parseVNumber("testSkipAdded")).toBeNull();
    expect(parseVNumber("")).toBeNull();
  });
});

describe("findingScope", () => {
  it("is file-scoped whenever a path is present", () => {
    expect(findingScope(finding({ file: "src/a.ts" }))).toBe("file");
  });

  it("is session-scoped for the session-log rules", () => {
    expect(findingScope(finding({ file: "", ruleId: "v21.hookBypassCommand" }))).toBe("session");
    expect(findingScope(finding({ file: "", ruleId: "v19.readLessEdit" }))).toBe("session");
  });

  it("is commit-scoped for the commit hygiene rules", () => {
    expect(findingScope(finding({ file: "", ruleId: "v31.tangledCommit" }))).toBe("commit");
    expect(findingScope(finding({ file: "", ruleId: "v32.revertUnsafe" }))).toBe("commit");
  });
});


describe("countRuleStatuses", () => {
  it("separates active, user-disabled and not-implemented rules", () => {
    expect(
      countRuleStatuses([
        rule({ ruleId: "v2.a", enabled: true }),
        rule({ ruleId: "v3.b", enabled: false }),
        rule({ ruleId: "v7.c", status: "planned", kind: null, enabled: false }),
        rule({ ruleId: "v8.d", status: "planned", kind: null, enabled: true }),
      ]),
    ).toEqual({ active: 1, disabled: 1, planned: 2 });
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { RULE_IMPORTANCE, ruleImportance } from "../rule-weights";

/**
 * The registry is the backend's list, so the sync check reads it straight from
 * the Rust source instead of trusting a copy. If someone adds a rule without a
 * weight it falls to 0 and stops being able to speak in a summary — this test
 * is the only thing that catches that.
 */
function registryRuleIds(): string[] {
  const path = fileURLToPath(
    new URL("../../../../src-tauri/src/verify/registry.rs", import.meta.url),
  );
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("static RULES: &[RuleEntry] = &[");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);

  const slice = source.slice(start, end);
  return Array.from(slice.matchAll(/"(v\d+\.[A-Za-z0-9_]+)"/g)).map((m) => m[1]);
}

describe("RULE_IMPORTANCE registry sync", () => {
  it("covers exactly the registry's rule ids", () => {
    const registry = registryRuleIds();
    expect(registry.length).toBe(45);

    const weighted = Object.keys(RULE_IMPORTANCE).sort();
    expect(weighted).toEqual([...registry].sort());
  });

  it("registers no duplicate ids", () => {
    const registry = registryRuleIds();
    expect(new Set(registry).size).toBe(registry.length);
  });
});

describe("RULE_IMPORTANCE values", () => {
  it("keeps every weight within 0..100", () => {
    for (const [ruleId, weight] of Object.entries(RULE_IMPORTANCE)) {
      expect(weight, ruleId).toBeGreaterThanOrEqual(0);
      expect(weight, ruleId).toBeLessThanOrEqual(100);
    }
  });

  it("ranks defeated verification above every code smell", () => {
    expect(RULE_IMPORTANCE["v20.testFailureThenTestEdited"]).toBe(
      Math.max(...Object.values(RULE_IMPORTANCE)),
    );
    expect(RULE_IMPORTANCE["v21.hookBypassCommand"]).toBeGreaterThan(
      RULE_IMPORTANCE["v5.emptyCatchAdded"],
    );
    expect(RULE_IMPORTANCE["v2.testFileDeleted"]).toBeGreaterThan(
      RULE_IMPORTANCE["v3.noAssertionTest"],
    );
  });

  it("ranks 'nobody read this' at the top of the info band", () => {
    expect(RULE_IMPORTANCE["v19.readLessEdit"]).toBeGreaterThan(
      RULE_IMPORTANCE["v23.subagentEdit"],
    );
    expect(RULE_IMPORTANCE["v19.readLessEdit"]).toBeGreaterThan(
      RULE_IMPORTANCE["v9.blastRadius"],
    );
  });

  it("puts v1.structuralDiff last among rules that can emit findings", () => {
    const emitting = Object.entries(RULE_IMPORTANCE).filter(([, weight]) => weight > 0);
    const lowest = Math.min(...emitting.map(([, weight]) => weight));
    expect(RULE_IMPORTANCE["v1.structuralDiff"]).toBe(lowest);
  });

  it("weighs planned rules at zero", () => {
    for (const ruleId of [
      "v15.mutationScore",
      "v16.claimMismatch",
      "v18.blindReviewMode",
      "v26.promptScopeDrift",
      "v27.staleRulesInjected",
      "v28.hookCollector",
      "v36.subCommitBisect",
    ]) {
      expect(RULE_IMPORTANCE[ruleId], ruleId).toBe(0);
    }
  });
});

describe("ruleImportance", () => {
  it("reads the table", () => {
    expect(ruleImportance("v21.hookBypassCommand")).toBe(95);
  });

  it("weighs an unknown id at zero instead of throwing", () => {
    expect(ruleImportance("v99.neverHeardOfIt")).toBe(0);
  });
});

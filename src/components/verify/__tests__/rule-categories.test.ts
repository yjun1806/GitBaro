import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { RuleDescriptor } from "@/types";
import {
  RULE_CATEGORY_ORDER,
  groupRulesByCategory,
  ruleCategory,
} from "../rule-categories";

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

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(repoRoot + path, "utf8");

/**
 * The Rust registry is the source of truth for which rules exist. Reading it
 * here — rather than trusting a hand-copied list — is what makes these tests
 * fail when a rule is added and nobody categorised or translated it.
 */
function registryRuleIds(): string[] {
  const source = read("src-tauri/src/verify/registry.rs");
  const ids = new Set(
    Array.from(source.matchAll(/"(v\d+\.[a-zA-Z]+)"/g), (m) => m[1]),
  );
  // A deliberate fixture inside the registry's own tests, not a real rule.
  ids.delete("v99.nonexistent");
  return [...ids];
}

function locale(name: "en" | "ko"): Record<string, unknown> {
  return JSON.parse(read(`src/i18n/locales/${name}/translation.json`));
}

function lookup(bundle: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      bundle,
    );
}

describe("ruleCategory", () => {
  it("maps every registry rule to a real category", () => {
    const ids = registryRuleIds();
    expect(ids.length).toBeGreaterThan(30);

    const uncategorised = ids.filter((id) => ruleCategory(id) === "other");
    expect(uncategorised).toEqual([]);
  });

  it("keeps hook bypass and in-code suppression apart", () => {
    // Both are "verification was skipped", but one leaves no trace in the code
    // and is only visible in the session log. Merging them would hide that.
    expect(ruleCategory("v21.hookBypassCommand")).toBe("hookBypass");
    expect(ruleCategory("v5.verificationBypassed")).toBe("suppression");
  });

  it("falls back to other for an unknown v number", () => {
    expect(ruleCategory("v404.somethingNew")).toBe("other");
    expect(ruleCategory("not-a-rule-id")).toBe("other");
  });
});

describe("groupRulesByCategory", () => {
  it("orders groups by the display order, not by rule id", () => {
    const groups = groupRulesByCategory([
      rule({ ruleId: "v11.testEvidenceMissing" }),
      rule({ ruleId: "v21.hookBypassCommand" }),
      rule({ ruleId: "v3.vacuousAssertion" }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["hookBypass", "testQuality", "execution"]);
  });

  it("sorts rules inside a group by id", () => {
    const groups = groupRulesByCategory([
      rule({ ruleId: "v2.testFileDeleted" }),
      rule({ ruleId: "v2.assertionRemoved" }),
    ]);
    expect(groups[0].rules.map((r) => r.ruleId)).toEqual([
      "v2.assertionRemoved",
      "v2.testFileDeleted",
    ]);
  });

  it("drops empty categories", () => {
    const groups = groupRulesByCategory([rule({ ruleId: "v2.testSkipAdded" })]);
    expect(groups).toHaveLength(1);
  });

  it("keeps planned rules, so the list shows what is not covered", () => {
    const groups = groupRulesByCategory([
      rule({ ruleId: "v7.reinventedFunction", kind: null, status: "planned" }),
    ]);
    expect(groups[0].rules[0].status).toBe("planned");
  });

  it("returns nothing for an empty registry", () => {
    expect(groupRulesByCategory([])).toEqual([]);
  });
});

describe("category translations", () => {
  it.each(["en", "ko"] as const)("%s has a title and subtitle for every category", (name) => {
    const bundle = locale(name);
    for (const id of RULE_CATEGORY_ORDER) {
      expect(lookup(bundle, `verify.category.${id}.title`), `${id}.title`).toEqual(
        expect.any(String),
      );
      expect(lookup(bundle, `verify.category.${id}.subtitle`), `${id}.subtitle`).toEqual(
        expect.any(String),
      );
    }
  });

  // RuleSettings falls back to `defaultValue: rule.ruleId`, so a missing
  // translation would print `v2.testSkipAdded` on screen. This keeps that
  // fallback unreachable rather than relying on nobody ever seeing it.
  it.each(["en", "ko"] as const)("%s translates every registry rule", (name) => {
    const bundle = locale(name);
    const missing = registryRuleIds().flatMap((id) =>
      ["title", "description"]
        .filter((field) => typeof lookup(bundle, `verify.rule.${id}.${field}`) !== "string")
        .map((field) => `${id}.${field}`),
    );
    expect(missing).toEqual([]);
  });

  it.each(["en", "ko"] as const)("%s never shows an internal V number to the user", (name) => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") {
        // `v2.testSkipAdded` style ids are fine as JSON *keys*; what must never
        // appear is a V number inside text the user reads.
        if (/\bV\d+/i.test(node)) offenders.push(`${path} = ${node}`);
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) walk(value, `${path}${key}.`);
      }
    };
    walk(locale(name), "");
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import i18n from "@/i18n/config";
import { worktreeBaseSummary, worktreeBaseTitle } from "../worktree-base";
import type { WorktreeBase } from "@/types";

const recorded: WorktreeBase = { name: "develop", source: "recorded", aheadOfBase: 2, behindBase: 1 };
const inferred: WorktreeBase = { name: "develop", source: "inferred", aheadOfBase: 0, behindBase: 0 };

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("worktreeBaseSummary", () => {
  it("reads like the compact label ('based on <base>')", () => {
    expect(worktreeBaseSummary(recorded, i18n.t.bind(i18n))).toBe("based on develop");
  });

  it("adds the estimated marker for an inferred base, same as the visible badge", () => {
    expect(worktreeBaseSummary(inferred, i18n.t.bind(i18n))).toBe("based on develop · estimated");
  });

  it("never includes the ahead/behind counts — those stay in worktreeBaseTitle", () => {
    const summary = worktreeBaseSummary(recorded, i18n.t.bind(i18n));
    expect(summary).not.toMatch(/\d/);
  });
});

describe("worktreeBaseTitle", () => {
  it("states the ahead/behind counts against the base branch", () => {
    expect(worktreeBaseTitle(recorded, i18n.t.bind(i18n))).toBe("2 commits ahead of and 1 behind develop");
  });

  it("appends the reason for an inferred base", () => {
    expect(worktreeBaseTitle(inferred, i18n.t.bind(i18n))).toContain("No creation record");
  });
});

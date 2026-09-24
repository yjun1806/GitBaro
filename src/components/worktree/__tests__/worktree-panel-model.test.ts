import { describe, expect, it } from "vitest";
import type { WorktreeInfo } from "@/types";
import { classifyWorktrees, flattenWorktreeSections } from "../worktree-panel-model";

function worktree(path: string, extra: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path,
    head: "abc",
    branch: path.split("/").pop() ?? null,
    isMain: false,
    isBare: false,
    isLocked: false,
    lockReason: null,
    isDirty: false,
    isPrunable: false,
    base: null,
    ...extra,
  };
}

describe("classifyWorktrees", () => {
  it("splits into main / linked / prunable", () => {
    const worktrees = [
      worktree("/work/GitBaro", { isMain: true, branch: "main" }),
      worktree("/work/GitBaro/.worktrees/audit-bugs", { branch: "fix/audit-bugs" }),
      worktree("/work/GitBaro/.worktrees/gone", { branch: "old/stale", isPrunable: true }),
    ];
    const sections = classifyWorktrees(worktrees);
    expect(sections.main.map((r) => r.worktree.path)).toEqual(["/work/GitBaro"]);
    expect(sections.linked.map((r) => r.worktree.path)).toEqual(["/work/GitBaro/.worktrees/audit-bugs"]);
    expect(sections.prunable.map((r) => r.worktree.path)).toEqual(["/work/GitBaro/.worktrees/gone"]);
  });

  it("excludes bare worktrees", () => {
    const worktrees = [worktree("/work/GitBaro.git", { isBare: true }), worktree("/work/GitBaro", { isMain: true })];
    const sections = classifyWorktrees(worktrees);
    expect(flattenWorktreeSections(sections)).toHaveLength(1);
  });

  it("filters by branch name within each section", () => {
    const worktrees = [
      worktree("/work/a", { branch: "feat/review-stream" }),
      worktree("/work/b", { branch: "fix/audit-bugs" }),
    ];
    const sections = classifyWorktrees(worktrees, "review");
    expect(sections.linked.map((r) => r.worktree.path)).toEqual(["/work/a"]);
  });

  it("falls back to the path when there's no branch (detached HEAD)", () => {
    const worktrees = [worktree("/work/detached", { branch: null })];
    const sections = classifyWorktrees(worktrees, "detached");
    expect(sections.linked).toHaveLength(1);
  });
});

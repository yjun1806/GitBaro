import { describe, expect, it } from "vitest";
import type { BranchInfo, WorktreeInfo } from "@/types";
import { classifyBranches, flattenSections } from "../branch-panel-model";

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    isHead: false,
    isRemote: false,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: 1_700_000_000,
    isFullyMerged: false,
    lastCommitAuthor: null,
    ...extra,
  };
}

function worktree(path: string, branchName: string | null, isMain = false): WorktreeInfo {
  return {
    path,
    head: "abc",
    branch: branchName,
    isMain,
    isBare: false,
    isLocked: false,
    lockReason: null,
    isDirty: false,
    isPrunable: false,
    base: null,
  };
}

const MAIN = "/work/app";
const AUDIT = "/work/app/.claude/worktrees/audit-bugs";
const REVIEW = "/work/app/.claude/worktrees/review-stream";

const branches = [
  branch("main", { isDefault: true, upstream: "origin/main" }),
  branch("fix/audit-bugs", { isHead: true }),
  branch("feat/review-stream"),
  branch("docs/readme", { lastCommitTime: 1_700_000_500 }),
  branch("fix/old", { lastCommitTime: 1_600_000_000 }),
  branch("origin/HEAD", { isRemote: true }),
  branch("origin/main", { isRemote: true }),
  branch("origin/feature/ai-commit", { isRemote: true }),
];
const worktrees = [worktree(MAIN, "main", true), worktree(AUDIT, "fix/audit-bugs"), worktree(REVIEW, "feat/review-stream")];

const names = (rows: { branch: BranchInfo }[]) => rows.map((r) => r.branch.name);

describe("classifyBranches", () => {
  it("splits branches into worktree / local / remote sections", () => {
    const s = classifyBranches(branches, worktrees, AUDIT);
    // 지금 브랜치 → 메인 워크트리 → 나머지 이름순.
    expect(names(s.inWorktree)).toEqual(["fix/audit-bugs", "main", "feat/review-stream"]);
    // 기본 브랜치가 없으면 최근 커밋순.
    expect(names(s.local)).toEqual(["docs/readme", "fix/old"]);
    // 로컬이 추적하는 origin/main과 origin/HEAD는 뺀다.
    expect(names(s.remote)).toEqual(["origin/feature/ai-commit"]);
  });

  it("hides a remote branch whose same-name local exists even when the local does not track it", () => {
    const s = classifyBranches(
      [branch("main", { isHead: true }), branch("feat"), branch("origin/feat", { isRemote: true })],
      [],
      MAIN,
    );
    expect(names(s.remote)).toEqual([]);
    expect(names(s.local)).toEqual(["feat"]);
  });

  it("keeps a remote branch that a differently named local tracks", () => {
    const s = classifyBranches(
      [
        branch("main", { isHead: true }),
        branch("mine", { upstream: "origin/feat" }),
        branch("origin/feat", { isRemote: true }),
      ],
      [],
      MAIN,
    );
    expect(names(s.remote)).toEqual(["origin/feat"]);
  });

  it("goes to the worktree instead of switching for a branch another worktree uses", () => {
    const s = classifyBranches(branches, worktrees, AUDIT);
    const action = (name: string) => flattenSections(s).find((r) => r.branch.name === name)?.action;
    expect(action("fix/audit-bugs")).toBe("current");
    expect(action("feat/review-stream")).toBe("openWorktree");
    // 메인 워크트리가 쓰는 main도 git으로 전환할 수 없으므로 이동이다.
    expect(action("main")).toBe("openWorktree");
    expect(action("docs/readme")).toBe("switch");
    expect(action("origin/feature/ai-commit")).toBe("switch");
    expect(flattenSections(s).find((r) => r.branch.name === "feat/review-stream")?.worktree?.path).toBe(REVIEW);
  });

  it("treats the branch of the worktree that is open as current, even with a trailing slash", () => {
    const onMain = branches.map((b) => ({ ...b, isHead: b.name === "main" }));
    const s = classifyBranches(onMain, worktrees, `${MAIN}/`);
    const main = s.inWorktree.find((r) => r.branch.name === "main");
    expect(main?.action).toBe("current");
    expect(s.inWorktree.find((r) => r.branch.name === "fix/audit-bugs")?.action).toBe("openWorktree");
  });

  it("keeps the current branch in the worktree section when there are no worktrees", () => {
    const s = classifyBranches(branches, [], MAIN);
    expect(names(s.inWorktree)).toEqual(["fix/audit-bugs"]);
    // 기본 브랜치가 로컬 칸 맨 위.
    expect(names(s.local)[0]).toBe("main");
    expect(s.local.every((r) => r.action === "switch")).toBe(true);
  });

  it("filters every section by the search text", () => {
    const s = classifyBranches(branches, worktrees, AUDIT, "audit");
    expect(names(flattenSections(s))).toEqual(["fix/audit-bugs"]);
  });
});

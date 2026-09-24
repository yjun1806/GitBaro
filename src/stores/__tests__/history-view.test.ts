import { beforeEach, describe, expect, it } from "vitest";
import { useRepositoryStore } from "../repository";
import {
  historyTargetOf,
  sameViewTarget,
  useHistoryViewStore,
  viewTargetFor,
} from "../history-view";
import { isStaleView } from "@/components/graph/useHistoryView";
import type { BranchInfo } from "@/types";

const REPO = "/work/app";
const WT = "/work/app-feat";

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    isHead: false,
    isRemote: false,
    isDefault: false,
    upstream: null,
    aheadBehind: null,
    lastCommitTime: null,
    isFullyMerged: false,
    lastCommitAuthor: null,
    ...extra,
  };
}

beforeEach(() => {
  useRepositoryStore.setState({ activeRepoPath: REPO });
  useHistoryViewStore.getState().reset();
});

describe("history view store", () => {
  it("starts on the current checkout", () => {
    expect(viewTargetFor(useHistoryViewStore.getState(), REPO)).toBeNull();
  });

  it("keeps the view for the repository (worktree) it started in only", () => {
    useHistoryViewStore.getState().view(REPO, { kind: "ref", name: "feat/x", isRemote: false });
    const state = useHistoryViewStore.getState();
    expect(viewTargetFor(state, REPO)).toEqual({ kind: "ref", name: "feat/x", isRemote: false });
    expect(viewTargetFor(state, WT)).toBeNull();
    expect(viewTargetFor(state, null)).toBeNull();
  });

  it("resets when another repository or worktree is opened", () => {
    useHistoryViewStore.getState().view(REPO, { kind: "all" });
    useRepositoryStore.setState({ activeRepoPath: WT });
    expect(useHistoryViewStore.getState()).toMatchObject({ repoPath: null, target: null });

    // 같은 경로로 다시 설정하는 것은 저장소를 바꾼 것이 아니다.
    useHistoryViewStore.getState().view(WT, { kind: "all" });
    useRepositoryStore.setState({ activeRepoPath: WT });
    expect(useHistoryViewStore.getState().target).toEqual({ kind: "all" });
  });

  it("goes back to the current checkout with a null target", () => {
    useHistoryViewStore.getState().view(REPO, { kind: "all" });
    useHistoryViewStore.getState().view(REPO, null);
    expect(useHistoryViewStore.getState()).toMatchObject({ repoPath: null, target: null });
  });

  it("maps the view to the backend history target", () => {
    expect(historyTargetOf(null)).toEqual({ kind: "head" });
    expect(historyTargetOf({ kind: "all" })).toEqual({ kind: "all" });
    expect(historyTargetOf({ kind: "ref", name: "origin/x", isRemote: true })).toEqual({
      kind: "ref",
      name: "origin/x",
    });
  });

  it("compares view targets", () => {
    expect(sameViewTarget(null, null)).toBe(true);
    expect(sameViewTarget({ kind: "all" }, null)).toBe(false);
    expect(sameViewTarget({ kind: "all" }, { kind: "all" })).toBe(true);
    expect(
      sameViewTarget({ kind: "ref", name: "a", isRemote: false }, { kind: "ref", name: "b", isRemote: false }),
    ).toBe(false);
  });
});

describe("isStaleView", () => {
  const branches = [branch("main", { isHead: true }), branch("feat/x"), branch("origin/x", { isRemote: true })];

  it("treats viewing the checked-out branch as no view", () => {
    expect(isStaleView({ kind: "ref", name: "main", isRemote: false }, branches)).toBe(true);
  });

  it("drops a branch that no longer exists", () => {
    expect(isStaleView({ kind: "ref", name: "gone", isRemote: false }, branches)).toBe(true);
  });

  it("keeps other local and remote branches, all branches, and waits for the branch list", () => {
    expect(isStaleView({ kind: "ref", name: "feat/x", isRemote: false }, branches)).toBe(false);
    expect(isStaleView({ kind: "ref", name: "origin/x", isRemote: true }, branches)).toBe(false);
    expect(isStaleView({ kind: "all" }, branches)).toBe(false);
    expect(isStaleView({ kind: "ref", name: "gone", isRemote: false }, undefined)).toBe(false);
  });
});

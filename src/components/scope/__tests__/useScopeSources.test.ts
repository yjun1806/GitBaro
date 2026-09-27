// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { RepoInfo } from "@/types";
import type { Scope } from "../scope";

let mockScope: Scope | null = null;
vi.mock("../useScope", () => ({ useScope: () => mockScope }));

let reviewRepos: {
  repoPath: string;
  worktrees: { path: string; branch: string | null; headOid: string | null; isMain: boolean }[];
}[] = [];
vi.mock("@/hooks/useReviewStatus", () => ({
  useReviewStatus: () => ({ repos: reviewRepos, byPath: {}, isLoading: false }),
}));

let syncByPath: Record<string, { unpushed: number; dirtyCount: number }> = {};
let defaultByRepo: Record<string, { name: string | null }> = {};
let workingBranchesByPath: Record<
  string,
  { defaultBranch: string | null; branches: { name: string; unpushed: number }[] }
> = {};
vi.mock("@/api/queries", () => ({
  useRepoSyncStatuses: () => ({ data: syncByPath }),
  useDefaultBranches: () => ({ data: defaultByRepo }),
  useWorkingBranches: (paths: readonly string[]) => paths.map((p) => workingBranchesByPath[p]),
}));

const { useScopeSources } = await import("../useScopeSources");

function repoInfo(path: string, name: string, remotes: string[] = ["origin"]): RepoInfo {
  return { path, name, currentBranch: "main", isDirty: false, remotes: remotes.map((n) => ({ name: n, url: "" })), accountId: null };
}

describe("useScopeSources", () => {
  beforeEach(() => {
    mockScope = null;
    reviewRepos = [];
    syncByPath = {};
    defaultByRepo = {};
    workingBranchesByPath = {};
    useRepositoryStore.setState({ repos: [], activeRepoPath: null, activeRepo: null, activeWorktrees: {} });
    useWorkspaceStore.setState({ workspaces: [] });
  });

  it("returns no sources and null scope when nothing is open", () => {
    const { result } = renderHook(() => useScopeSources());
    expect(result.current.scope).toBeNull();
    expect(result.current.sources).toEqual([]);
  });

  it("builds one lane per worktree, across every repo in the workspace", () => {
    mockScope = { kind: "workspace", workspaceId: "w1" };
    useWorkspaceStore.setState({
      workspaces: [{ id: "w1", name: "w1", accountKey: "acct", repoPaths: ["/r/a", "/r/b"] }],
    });
    useRepositoryStore.setState({ repos: [repoInfo("/r/a", "a"), repoInfo("/r/b", "b")] });
    reviewRepos = [
      {
        repoPath: "/r/a",
        worktrees: [
          { path: "/r/a", branch: "main", headOid: "h1", isMain: true },
          { path: "/r/a-feat", branch: "feat/x", headOid: "h2", isMain: false },
        ],
      },
      { repoPath: "/r/b", worktrees: [{ path: "/r/b", branch: "main", headOid: "h3", isMain: true }] },
    ];
    syncByPath = {
      "/r/a": { unpushed: 0, dirtyCount: 0 },
      "/r/a-feat": { unpushed: 2, dirtyCount: 1 },
      "/r/b": { unpushed: 0, dirtyCount: 0 },
    };
    defaultByRepo = { "/r/a": { name: "main" }, "/r/b": { name: "main" } };

    const { result } = renderHook(() => useScopeSources());
    expect(result.current.sources.map((s) => s.id)).toEqual(["/r/a", "/r/a-feat", "/r/b"]);
    const feat = result.current.sources.find((s) => s.id === "/r/a-feat")!;
    expect(feat).toMatchObject({ repoPath: "/r/a", branch: "feat/x", unpushedCount: 2, wipCount: 1, isMain: false });
    // 워크스페이스 단계: 같은 저장소의 레인은 같은 색조를 쓴다.
    const main = result.current.sources.find((s) => s.id === "/r/a")!;
    expect(feat.color).not.toBe(main.color);
  });

  it("narrows to a single repository's lanes at repo scope", () => {
    mockScope = { kind: "repo", repoPath: "/r/a" };
    useRepositoryStore.setState({ repos: [repoInfo("/r/a", "a")] });
    reviewRepos = [
      {
        repoPath: "/r/a",
        worktrees: [
          { path: "/r/a", branch: "main", headOid: "h1", isMain: true },
          { path: "/r/a-feat", branch: "feat/x", headOid: "h2", isMain: false },
        ],
      },
    ];
    const { result } = renderHook(() => useScopeSources());
    expect(result.current.sources.map((s) => s.id)).toEqual(["/r/a", "/r/a-feat"]);
    expect(result.current.sources.every((s) => s.repoPath === "/r/a")).toBe(true);
  });

  it("picks exactly the checked-out worktree's lane at branch scope", () => {
    mockScope = { kind: "branch", repoPath: "/r/a", branch: "feat/x", worktreePath: "/r/a-feat" };
    useRepositoryStore.setState({ repos: [repoInfo("/r/a", "a")] });
    reviewRepos = [
      {
        repoPath: "/r/a",
        worktrees: [
          { path: "/r/a", branch: "main", headOid: "h1", isMain: true },
          { path: "/r/a-feat", branch: "feat/x", headOid: "h2", isMain: false },
        ],
      },
    ];
    const { result } = renderHook(() => useScopeSources());
    expect(result.current.sources.map((s) => s.id)).toEqual(["/r/a-feat"]);
  });

  it("synthesizes a branch-only lane when the branch is not checked out anywhere", () => {
    mockScope = { kind: "branch", repoPath: "/r/a", branch: "feat/y", worktreePath: null };
    useRepositoryStore.setState({ repos: [repoInfo("/r/a", "a")] });
    reviewRepos = [{ repoPath: "/r/a", worktrees: [{ path: "/r/a", branch: "main", headOid: "h1", isMain: true }] }];
    workingBranchesByPath = {
      "/r/a": { defaultBranch: "main", branches: [{ name: "feat/y", unpushed: 3 }] },
    };

    const { result } = renderHook(() => useScopeSources());
    expect(result.current.sources).toHaveLength(1);
    const [lane] = result.current.sources;
    expect(lane).toMatchObject({
      repoPath: "/r/a",
      worktreePath: null,
      branch: "feat/y",
      unpushedCount: 3,
      wipCount: 0,
      defaultBranch: "main",
    });
    expect(lane.id).toBe("/r/a\u0000feat/y");
  });
});

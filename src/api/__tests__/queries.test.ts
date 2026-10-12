import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateAfterSync } from "@/api/queries";

/**
 * W5 리뷰에서 찾은 버그: 워크스페이스 리뷰 화면의 그래프는 `reviewStatus`(HEAD oid)와
 * `["workspaceHistory", path, headOid]`로 만든다. `invalidateAfterSync`가 이 키들을
 * 빼먹으면, pull·push 뒤에도 `REVIEW_POLL_MS`(20초)까지 옛 HEAD·원격 라벨·병합 기준점을
 * 그대로 보여 준다.
 */
describe("invalidateAfterSync", () => {
  const isStale = (queryClient: QueryClient, queryKey: unknown[]) =>
    queryClient.getQueryState(queryKey as readonly unknown[])?.isInvalidated === true;

  it("invalidates reviewStatus and workspaceHistory along with the other sync-dependent queries", async () => {
    const queryClient = new QueryClient();
    const keysUsed = [
      ["branches", "/repo"],
      ["repoSyncStatus", ["/repo"]],
      ["commitHistory", "/repo"],
      ["status", "/repo"],
      ["mergeState", "/repo"],
      ["remoteTags", "/repo"],
      ["reviewStatus", ["/repo"]],
      ["workspaceHistory", "/repo", "headOid", 50],
      ["worktreeHeadHistory", "/repo-feat", "headOid"],
      ["defaultBranches", ["/repo"]],
      ["unpushedFileTouches", "/repo", "/repo"],
      // 이 무효화가 건드리면 안 되는 무관한 키.
      ["unrelatedQuery", "/repo"],
    ];
    for (const queryKey of keysUsed) {
      queryClient.setQueryData(queryKey, "cached");
    }
    // 메인 작업 트리 `/repo`의 워크트리 `/repo-feat`는 reviewStatus 캐시로 알아낸다.
    queryClient.setQueryData(["reviewStatus", ["/repo"]], [
      { repoPath: "/repo", worktrees: [{ path: "/repo", isMain: true }, { path: "/repo-feat", isMain: false }] },
    ]);

    await invalidateAfterSync(queryClient, ["/repo"]);

    expect(isStale(queryClient, ["reviewStatus", ["/repo"]])).toBe(true);
    expect(isStale(queryClient, ["workspaceHistory", "/repo", "headOid", 50])).toBe(true);
    expect(isStale(queryClient, ["branches", "/repo"])).toBe(true);
    expect(isStale(queryClient, ["worktreeHeadHistory", "/repo-feat", "headOid"])).toBe(true);
    expect(isStale(queryClient, ["defaultBranches", ["/repo"]])).toBe(true);
    expect(isStale(queryClient, ["unpushedFileTouches", "/repo", "/repo"])).toBe(true);
    expect(isStale(queryClient, ["unrelatedQuery", "/repo"])).toBe(false);
  });

  it("invalidates only the synced repositories and never the file diffs", async () => {
    const queryClient = new QueryClient();
    const keys = [
      ["branches", "/a"],
      ["branches", "/b"],
      ["workspaceHistory", "/a", "h", 100],
      ["workspaceHistory", "/b", "h", 100],
      ["commitHistory", "/a", "all"],
      ["commitHistory", "/b"],
      ["remoteTags", "/b", "acc"],
      ["repoSyncStatus", ["/a", "/b"]],
      ["fileDiff", "/a", "f.ts", false],
      ["commitFileDiff", "/a", "oid", "f.ts", false],
      ["rangeFileDiff", "/a", "x", "y", "f.ts", null],
    ];
    for (const queryKey of keys) queryClient.setQueryData(queryKey, "cached");

    await invalidateAfterSync(queryClient, ["/a"]);

    expect(isStale(queryClient, ["branches", "/a"])).toBe(true);
    expect(isStale(queryClient, ["workspaceHistory", "/a", "h", 100])).toBe(true);
    expect(isStale(queryClient, ["commitHistory", "/a", "all"])).toBe(true);
    expect(isStale(queryClient, ["repoSyncStatus", ["/a", "/b"]])).toBe(true);
    expect(isStale(queryClient, ["branches", "/b"])).toBe(false);
    expect(isStale(queryClient, ["workspaceHistory", "/b", "h", 100])).toBe(false);
    expect(isStale(queryClient, ["commitHistory", "/b"])).toBe(false);
    expect(isStale(queryClient, ["remoteTags", "/b", "acc"])).toBe(false);
    expect(isStale(queryClient, ["fileDiff", "/a", "f.ts", false])).toBe(false);
    expect(isStale(queryClient, ["commitFileDiff", "/a", "oid", "f.ts", false])).toBe(false);
    expect(isStale(queryClient, ["rangeFileDiff", "/a", "x", "y", "f.ts", null])).toBe(false);
  });
});

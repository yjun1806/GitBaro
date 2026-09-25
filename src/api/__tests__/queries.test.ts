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
  it("invalidates reviewStatus and workspaceHistory along with the other sync-dependent queries", async () => {
    const queryClient = new QueryClient();
    const keysUsed = [
      ["branches", "/repo"],
      ["repoSyncStatus", ["/repo"]],
      ["commitHistory", "/repo"],
      ["status", "/repo"],
      ["mergeState", "/repo"],
      ["fileDiff", "/repo", "a"],
      ["remoteTags", "/repo"],
      ["reviewStatus", ["/repo"]],
      ["workspaceHistory", "/repo", "headOid", 50],
      ["worktreeHeadHistory", "/repo-feat", "headOid"],
      ["defaultBranches", ["/repo"]],
      // 이 무효화가 건드리면 안 되는 무관한 키.
      ["unrelatedQuery", "/repo"],
    ];
    for (const queryKey of keysUsed) {
      queryClient.setQueryData(queryKey, "cached");
    }

    await invalidateAfterSync(queryClient);

    const isStale = (queryKey: unknown[]) =>
      queryClient.getQueryState(queryKey as readonly unknown[])?.isInvalidated === true;

    expect(isStale(["reviewStatus", ["/repo"]])).toBe(true);
    expect(isStale(["workspaceHistory", "/repo", "headOid", 50])).toBe(true);
    expect(isStale(["branches", "/repo"])).toBe(true);
    expect(isStale(["worktreeHeadHistory", "/repo-feat", "headOid"])).toBe(true);
    expect(isStale(["defaultBranches", ["/repo"]])).toBe(true);
    expect(isStale(["unrelatedQuery", "/repo"])).toBe(false);
  });
});

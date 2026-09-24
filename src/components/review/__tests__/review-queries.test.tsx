// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NewCommitIds, SeenRecordInput, WorkspaceRepoHistory } from "@/types";

/** 응답을 테스트가 직접 풀어 주는 명령 모의. 다시 읽는 동안의 화면을 보려고 쓴다. */
const pending: Array<{ key: string; resolve: (value: unknown) => void }> = [];
function deferred(key: string): Promise<unknown> {
  return new Promise((resolve) => pending.push({ key, resolve }));
}
function resolveLatest(key: string, value: unknown) {
  const i = pending.map((p) => p.key).lastIndexOf(key);
  pending.splice(i, 1)[0].resolve(value);
}

vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWorkspaceHistory: vi.fn((paths: string[]) => deferred(`history:${paths[0]}`)),
  listNewCommitIds: vi.fn((entry: SeenRecordInput) => deferred(`ids:${entry.path}`)),
}));

const { useWorkspaceHistories, useNewCommitIdsMany } = await import("@/api/queries");

function history(path: string, headOid: string): WorkspaceRepoHistory {
  return {
    path,
    branch: "feat/x",
    headOid,
    defaultBranch: "main",
    baseRef: "main",
    baseStatus: "found",
    mergeBaseOid: "base",
    mergeBaseCommit: null,
    commits: [],
    truncated: false,
    error: null,
  };
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  pending.length = 0;
});

describe("useWorkspaceHistories", () => {
  it("keeps showing the repository's last timeline while it refetches for a new HEAD", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(
      ({ head }: { head: string }) => useWorkspaceHistories([{ path: "/a", headOid: head }]),
      { wrapper: wrapperFor(client), initialProps: { head: "h1" } },
    );
    expect(result.current[0]).toBeUndefined();
    resolveLatest("history:/a", [history("/a", "h1")]);
    await waitFor(() => expect(result.current[0]?.headOid).toBe("h1"));

    rerender({ head: "h2" });
    // 새 키를 읽는 동안에도 레인이 사라지지 않는다(useQueries에서는 keepPreviousData가 안 먹는다).
    expect(result.current[0]?.headOid).toBe("h1");
    resolveLatest("history:/a", [history("/a", "h2")]);
    await waitFor(() => expect(result.current[0]?.headOid).toBe("h2"));
  });

  it("refetches on a poll even while HEAD stays the same, to pick up moved refs", async () => {
    // origin/<branch>나 origin/main처럼 이 저장소의 HEAD와 무관한 참조가 외부에서
    // 옮겨가면 headOid는 그대로다. 폴링이 없으면 창 포커스가 돌아오거나 이 저장소에서
    // 커밋할 때까지 참조 라벨과 갈라진 지점이 옛 값으로 남는다.
    vi.useFakeTimers();
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHook(
        () => useWorkspaceHistories([{ path: "/a", headOid: "h1" }]),
        { wrapper: wrapperFor(client) },
      );
      resolveLatest("history:/a", [history("/a", "h1")]);
      await vi.waitFor(() => expect(result.current[0]?.headOid).toBe("h1"));

      await vi.advanceTimersByTimeAsync(20_000);
      // 폴링이 키를 바꾸지 않고 다시 불렀으므로, 두 번째 응답이 대기 중이어야 한다.
      expect(pending.some((p) => p.key === "history:/a")).toBe(true);
      resolveLatest("history:/a", [{ ...history("/a", "h1"), branch: "feat/moved" }]);
      await vi.waitFor(() => expect(result.current[0]?.branch).toBe("feat/moved"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useNewCommitIdsMany", () => {
  const counted = (headOid: string, newCount: number): NewCommitIds => ({
    path: "/a",
    headOid,
    newCount,
    basis: "oid",
    ids: Array.from({ length: newCount }, (_, i) => `c${i}`),
  });

  it("keeps the last count for the same baseline while HEAD moves", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entry: SeenRecordInput = { path: "/a", oid: "seen", seenAt: 1, branch: "feat/x" };
    const { result, rerender } = renderHook(
      ({ head, e }: { head: string; e: SeenRecordInput }) => useNewCommitIdsMany([{ entry: e, headOid: head }]),
      { wrapper: wrapperFor(client), initialProps: { head: "h1", e: entry } },
    );
    resolveLatest("ids:/a", counted("h1", 2));
    await waitFor(() => expect(result.current["/a"]?.newCount).toBe(2));

    rerender({ head: "h2", e: entry });
    expect(result.current["/a"]?.newCount).toBe(2);

    // 기준선이 바뀌면(「확인함」) 옛 수를 다시 보이지 않는다.
    rerender({ head: "h2", e: { ...entry, oid: "h2", seenAt: 2 } });
    expect(result.current["/a"]).toBeUndefined();
  });
});

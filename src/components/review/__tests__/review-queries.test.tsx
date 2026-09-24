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

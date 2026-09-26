// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitStats } from "@/types";

const getCommitStats = vi.fn(async (_path: string, oids: string[]): Promise<CommitStats[]> =>
  oids.map((oid) => ({
    oid,
    merge: oid === "m",
    filesChanged: oid === "m" ? null : 1,
    additions: oid === "m" ? null : 2,
    deletions: oid === "m" ? null : 0,
    error: oid === "bad" ? "not a full commit id" : null,
  })),
);
const getUnpushedFileTouches = vi.fn(async (paths: string[], _branch: string | null) =>
  paths.map((path) => ({ path, error: null, truncated: false, rangeBase: null, head: null, merges: 0, files: [] })),
);
const getDivergencePoint = vi.fn(async (_path: string, _branch: string | null) => ({
  branch: "feat",
  headOid: "h",
  defaultBranch: "main",
  baseRef: "main",
  baseStatus: "found" as const,
  mergeBaseOid: "b",
}));

vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCommitStats: (path: string, oids: string[]) => getCommitStats(path, oids),
  getUnpushedFileTouches: (paths: string[], branch: string | null) => getUnpushedFileTouches(paths, branch),
  getDivergencePoint: (path: string, branch: string | null) => getDivergencePoint(path, branch),
}));

const { useCommitStats, useUnpushedFileTouches, useDivergencePoint } = await import("@/api/queries");

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useCommitStats", () => {
  it("asks for one page of commits in one call and never again for the same commits", async () => {
    const client = newClient();
    const { result, rerender } = renderHook(({ oids }: { oids: string[] }) => useCommitStats("/r", oids), {
      wrapper: wrapperFor(client),
      initialProps: { oids: ["a", "b", "m", "bad"] },
    });
    await waitFor(() => expect(result.current.size).toBe(3));
    expect(getCommitStats).toHaveBeenCalledTimes(1);
    expect(getCommitStats).toHaveBeenCalledWith("/r", ["a", "b", "m", "bad"]);
    expect(result.current.get("m")?.merge).toBe(true);
    expect(result.current.has("bad")).toBe(false);

    // 다음 쪽: 겹치는 커밋은 다시 묻지 않는다.
    rerender({ oids: ["b", "c"] });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(getCommitStats).toHaveBeenCalledTimes(2);
    expect(getCommitStats).toHaveBeenLastCalledWith("/r", ["c"]);
  });

  it("does not ask without a path", () => {
    const { result } = renderHook(() => useCommitStats(null, ["a"]), { wrapper: wrapperFor(newClient()) });
    expect(result.current.size).toBe(0);
    expect(getCommitStats).not.toHaveBeenCalled();
  });
});

describe("branch-scoped queries", () => {
  it("passes the branch to the file touches and keeps it apart from the HEAD result", async () => {
    const client = newClient();
    const { result } = renderHook(
      () =>
        useUnpushedFileTouches([
          { repoPath: "/r", path: "/r" },
          { repoPath: "/r", path: "/r", branch: "feat" },
        ]),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(result.current.every((s) => s.status === "success")).toBe(true));
    expect(getUnpushedFileTouches).toHaveBeenCalledWith(["/r"], null);
    expect(getUnpushedFileTouches).toHaveBeenCalledWith(["/r"], "feat");
    // 저장소·워크트리 앞부분 무효화는 브랜치 결과도 함께 다시 읽는다.
    expect(client.getQueryCache().findAll({ queryKey: ["unpushedFileTouches", "/r", "/r"] })).toHaveLength(2);
  });

  it("passes the branch to the divergence point", async () => {
    const { result } = renderHook(() => useDivergencePoint("/r", "h", "feat"), { wrapper: wrapperFor(newClient()) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(getDivergencePoint).toHaveBeenCalledWith("/r", "feat");
  });
});

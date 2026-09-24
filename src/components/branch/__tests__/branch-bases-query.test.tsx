// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BranchBaseInfo } from "@/types";

const getBranchBases = vi.fn(
  async (_repoPath: string, names: string[]): Promise<BranchBaseInfo[]> =>
    names.map((name) => ({
      name,
      base: { name: "main", source: "reflog", aheadOfBase: 1, behindBase: 0 },
      mergedIntoBase: false,
    })),
);
vi.mock("@/api/commands", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBranchBases: (repoPath: string, names: string[]) => getBranchBases(repoPath, names),
}));

const { useBranchBases } = await import("@/api/queries");

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  getBranchBases.mockClear();
});

describe("useBranchBases", () => {
  it("asks for all visible rows in one branch_bases call", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const names = ["feat/a", "feat/b", "feat/c"];
    const { result } = renderHook(() => useBranchBases("/repo", names), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.size).toBe(3));
    expect(getBranchBases).toHaveBeenCalledTimes(1);
    expect(getBranchBases).toHaveBeenCalledWith("/repo", names);
  });

  it("asks again, still in one call, when the branch list is invalidated", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const names = ["feat/a", "feat/b"];
    const { result } = renderHook(() => useBranchBases("/repo", names), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.size).toBe(2));

    // 전환·커밋·merge·fetch는 모두 "branches"를 무효화한다. 30초 캐시가 남아 있어도 새로 받아야 한다.
    await client.invalidateQueries({ queryKey: ["branches"] });

    expect(getBranchBases).toHaveBeenCalledTimes(2);
    expect(getBranchBases).toHaveBeenLastCalledWith("/repo", names);
  });
});

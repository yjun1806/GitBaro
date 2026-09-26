// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRepoWatcher } from "@/hooks/useRepoWatcher";

type Handler = (event: { payload: { repoPath: string } }) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));

vi.mock("@/api/commands", () => ({
  startRepoWatch: vi.fn(async () => {}),
  stopRepoWatch: vi.fn(async () => {}),
}));

const REPO = "/repos/app";

function renderWatcher(path: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const utils = renderHook(({ p }: { p: string | null }) => useRepoWatcher(p), {
    wrapper,
    initialProps: { p: path },
  });
  return { ...utils, queryClient };
}

describe("useRepoWatcher — fs:git-dir-change invalidation", () => {
  beforeEach(() => {
    handlers.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("invalidates wipFiles for the repo, so the follow panel picks up index/HEAD-only changes", async () => {
    const { queryClient } = renderWatcher(REPO);
    await waitFor(() => expect(handlers.has("fs:git-dir-change")).toBe(true));

    // Seed a query so we can observe it being marked stale/invalidated.
    await queryClient.prefetchQuery({
      queryKey: ["wipFiles", REPO],
      queryFn: async () => [],
    });
    const before = queryClient.getQueryState(["wipFiles", REPO]);
    expect(before?.isInvalidated).toBe(false);

    handlers.get("fs:git-dir-change")?.({ payload: { repoPath: REPO } });

    // The hook debounces git-dir bursts (GIT_DIR_DEBOUNCE_MS = 250ms) before invalidating.
    await waitFor(
      () => expect(queryClient.getQueryState(["wipFiles", REPO])?.isInvalidated).toBe(true),
      { timeout: 2000 },
    );
  });

  it("invalidates wipFiles for a followed worktree other than the watched repo (W7 review)", async () => {
    // The backend always reports the watched repo's own path, even when the
    // change it detected (e.g. a commit's ref update) came from a different
    // linked worktree (git-dir-only changes there, like index, are not even
    // watched) — see fs_events.rs's WatchTargets::classify. The follow panel
    // can be following that other worktree, so its wipFiles query must still
    // refresh.
    const OTHER_WORKTREE = "/repos/app-feat";
    const { queryClient } = renderWatcher(REPO);
    await waitFor(() => expect(handlers.has("fs:git-dir-change")).toBe(true));

    await queryClient.prefetchQuery({ queryKey: ["wipFiles", OTHER_WORKTREE], queryFn: async () => [] });
    const before = queryClient.getQueryState(["wipFiles", OTHER_WORKTREE]);
    expect(before?.isInvalidated).toBe(false);

    handlers.get("fs:git-dir-change")?.({ payload: { repoPath: REPO } });

    await waitFor(
      () => expect(queryClient.getQueryState(["wipFiles", OTHER_WORKTREE])?.isInvalidated).toBe(true),
      { timeout: 2000 },
    );
  });
  it("refreshes the per-file view for every worktree of the changed repository only", async () => {
    // 감시자는 어느 워크트리가 바뀌었는지 모르므로 그 저장소의 워크트리는 모두 다시 읽는다. 다른 저장소는 두고.
    const { queryClient } = renderWatcher(REPO);
    await waitFor(() => expect(handlers.has("fs:git-dir-change")).toBe(true));
    const keys = [
      ["unpushedFileTouches", REPO, REPO],
      ["unpushedFileTouches", REPO, "/repos/app-feat"],
      ["unpushedFileTouches", "/repos/other", "/repos/other"],
    ];
    for (const queryKey of keys) await queryClient.prefetchQuery({ queryKey, queryFn: async () => null });

    handlers.get("fs:git-dir-change")?.({ payload: { repoPath: REPO } });

    await waitFor(() => expect(queryClient.getQueryState(keys[0])?.isInvalidated).toBe(true), { timeout: 2000 });
    expect(keys.map((k) => queryClient.getQueryState(k)?.isInvalidated)).toEqual([true, true, false]);
  });
});

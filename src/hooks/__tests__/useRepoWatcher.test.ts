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
});

// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityEvent } from "@/types";

type Handler = (event: { payload: ActivityEvent }) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));

const { useReviewActivityRefresh } = await import("../useReviewActivityRefresh");

const APP = "/w/app";
const APP_FEAT = "/w/app/.worktrees/feat";
const API = "/w/api";

afterEach(() => {
  cleanup();
  handlers.clear();
});

describe("useReviewActivityRefresh — per-file view", () => {
  it("refreshes only the worktree whose HEAD moved, not the other worktrees or repositories", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    renderHook(
      () =>
        useReviewActivityRefresh([
          { repoPath: APP, worktreePaths: [APP, APP_FEAT] },
          { repoPath: API, worktreePaths: [API] },
        ]),
      { wrapper },
    );
    const keys = [
      ["unpushedFileTouches", APP, APP],
      ["unpushedFileTouches", APP, APP_FEAT],
      ["unpushedFileTouches", API, API],
    ];
    for (const queryKey of keys) await queryClient.prefetchQuery({ queryKey, queryFn: async () => null });
    await waitFor(() => expect(handlers.has("repo:activity")).toBe(true));

    handlers.get("repo:activity")?.({ payload: { path: `${APP_FEAT}/src/a.ts`, at: 1, kind: "git" } });

    const invalidated = keys.map((k) => queryClient.getQueryState(k)?.isInvalidated);
    expect(invalidated).toEqual([false, true, false]);
  });
});

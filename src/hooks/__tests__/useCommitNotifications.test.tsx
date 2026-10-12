// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Handler = (event: { payload: { path: string; at: number; kind: string } }) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => handlers.delete(name);
  }),
}));
vi.mock("@/api/commands", () => ({ getHeadAdvance: vi.fn() }));
vi.mock("@/hooks/useBackgroundReviewStatus", () => ({ useBackgroundReviewStatus: () => ({ data: undefined }) }));
vi.mock("@/lib/notify/deliver", () => ({ deliverNotification: vi.fn() }));

const { useCommitNotifications } = await import("../useCommitNotifications");

const A = "/repos/a";
const A_WT = "/repos/a-feat";
const B = "/repos/b";
const status = (repoPath: string, worktrees: string[] = []) => ({
  repoPath,
  worktrees: [repoPath, ...worktrees].map((path) => ({ path })),
});

describe("useCommitNotifications — repo:activity invalidation", () => {
  let client: QueryClient;
  beforeEach(() => {
    handlers.clear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(cleanup);

  async function setup() {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    renderHook(() => useCommitNotifications(true), { wrapper });
    await waitFor(() => expect(handlers.has("repo:activity")).toBe(true));
    await client.prefetchQuery({ queryKey: ["reviewStatus", [A]], queryFn: async () => [status(A, [A_WT])] });
    await client.prefetchQuery({ queryKey: ["reviewStatus", [B]], queryFn: async () => [status(B)] });
  }
  const invalidated = (key: unknown[]) => client.getQueryState(key)?.isInvalidated;

  it("invalidates only the reviewStatus that lists the repository", async () => {
    await setup();
    handlers.get("repo:activity")?.({ payload: { path: A, at: 1, kind: "git" } });
    await waitFor(() => expect(invalidated(["reviewStatus", [A]])).toBe(true));
    expect(invalidated(["reviewStatus", [B]])).toBe(false);
  });

  it("maps a linked worktree event to its owning repository", async () => {
    await setup();
    handlers.get("repo:activity")?.({ payload: { path: A_WT, at: 1, kind: "git" } });
    await waitFor(() => expect(invalidated(["reviewStatus", [A]])).toBe(true));
    expect(invalidated(["reviewStatus", [B]])).toBe(false);
  });

  it("ignores work-tree activity", async () => {
    await setup();
    handlers.get("repo:activity")?.({ payload: { path: A, at: 1, kind: "workTree" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(invalidated(["reviewStatus", [A]])).toBe(false);
  });
});

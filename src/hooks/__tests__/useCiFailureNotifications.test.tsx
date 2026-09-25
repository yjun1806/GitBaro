// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeRepo } from "@/lib/__tests__/repo-tree-fixtures";

const listWorkflowRuns = vi.hoisted(() => vi.fn((_path: string, _account: string) => new Promise<never>(() => {})));
vi.mock("@/api/commands", () => ({ listWorkflowRuns }));
vi.mock("@/hooks/useBackgroundReviewStatus", () => ({ useBackgroundReviewStatus: () => ({ data: undefined }) }));
vi.mock("@/lib/notify/deliver", () => ({ deliverNotification: vi.fn() }));

const { ciPollInterval, useCiFailureNotifications } = await import("../useCiFailureNotifications");
const { useRepositoryStore } = await import("@/stores/repository");

describe("ciPollInterval", () => {
  it("polls every minute while the window is focused and every five minutes behind other windows", () => {
    expect(ciPollInterval(true)).toBe(60_000);
    expect(ciPollInterval(false)).toBe(300_000);
  });
});

describe("useCiFailureNotifications", () => {
  it("reads at most four repositories' runs at once", async () => {
    const repos = Array.from({ length: 6 }, (_, i) => makeRepo(`app-${i}`, "acme", { accountId: "bot" }));
    useRepositoryStore.setState({ repos, repoPrefs: {} });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    renderHook(() => useCiFailureNotifications(true), { wrapper });
    await waitFor(() => expect(listWorkflowRuns).toHaveBeenCalledTimes(4));
    await new Promise((r) => setTimeout(r, 20));
    expect(listWorkflowRuns).toHaveBeenCalledTimes(4);
  });
});

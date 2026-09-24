// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n/config";
import { useLiveChanges } from "@/hooks/useLiveChanges";
import { useActivityTargetsStore } from "@/stores/activity-targets";
import { useLiveChangesStore } from "@/stores/live-changes";
import { useRepositoryStore } from "@/stores/repository";
import type { RepoInfo, RepoSyncStatus } from "@/types";

type Handler = (event: { payload: { path: string; at: number } }) => void;
const activityHandlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    activityHandlers.set(name, handler);
    return () => activityHandlers.delete(name);
  }),
}));

vi.mock("@/api/commands", () => ({
  setActivityWatch: vi.fn(),
  getRepoSyncStatus: vi.fn(),
}));

import { setActivityWatch, getRepoSyncStatus } from "@/api/commands";

const REPO_A = "/repos/alpha"; // stays under the cap — watched
const REPO_B = "/repos/beta"; // overflows — falls back to polling

function repo(path: string): RepoInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    currentBranch: "main",
    isDirty: false,
    remotes: [],
    accountId: null,
  };
}

/** `getRepoSyncStatus`가 아직 없는 W1-T2의 `dirtyLatestMtime` 필드를 실어 나른다
 * 는 가정을 흉내 낸다 — 훅 쪽의 캐스팅과 똑같은 모양으로 만든다. */
function syncStatusWithMtime(path: string, dirtyLatestMtime: number | null): RepoSyncStatus {
  return {
    path,
    branch: "main",
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    isDirty: dirtyLatestMtime !== null,
    ...({ dirtyLatestMtime } as Record<string, unknown>),
  } as RepoSyncStatus;
}

function renderLiveChanges() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(() => useLiveChanges(), { wrapper });
}

describe("useLiveChanges", () => {
  beforeEach(() => {
    activityHandlers.clear();
    vi.mocked(setActivityWatch).mockReset();
    vi.mocked(getRepoSyncStatus).mockReset();
    useRepositoryStore.setState({ repos: [repo(REPO_A), repo(REPO_B)] });
    useActivityTargetsStore.setState({ extraByKey: {} });
    useLiveChangesStore.setState({ lastChangedAt: {}, watched: [], overflow: [] });
  });

  afterEach(() => {
    // Unmount the previously rendered hook before the next test's beforeEach
    // touches the shared zustand stores — otherwise the still-mounted
    // instance re-runs its effects (e.g. a stale `setActivityWatch` call)
    // against the next test's freshly-reset mocks.
    cleanup();
    useRepositoryStore.setState({ repos: [] });
  });

  it("넘친 경로는 20초 폴링의 dirtyLatestMtime으로 채우고 watched:false로 표시한다", async () => {
    vi.mocked(setActivityWatch).mockResolvedValue({ watched: [REPO_A], overflow: [REPO_B] });
    vi.mocked(getRepoSyncStatus).mockResolvedValue([
      syncStatusWithMtime(REPO_B, 123_456),
    ]);

    renderLiveChanges();

    await waitFor(() => expect(getRepoSyncStatus).toHaveBeenCalled());
    await waitFor(() =>
      expect(useLiveChangesStore.getState().lastChangedAt[REPO_B]).toBe(123_456),
    );

    // 폴링이 실제로 요청한 대상은 넘친 경로여야 한다 — 다른 경로를 요청했다면
    // 이 테스트는 우연히 통과할 뿐 대체 경로를 검증하지 못한다.
    expect(getRepoSyncStatus).toHaveBeenCalledWith([REPO_B]);

    const state = useLiveChangesStore.getState();
    expect(state.isWatched(REPO_A)).toBe(true);
    expect(state.isWatched(REPO_B)).toBe(false);
  });

  it("dirtyLatestMtime이 없으면(null) 아무 값도 기록하지 않는다", async () => {
    vi.mocked(setActivityWatch).mockResolvedValue({ watched: [REPO_A], overflow: [REPO_B] });
    vi.mocked(getRepoSyncStatus).mockResolvedValue([syncStatusWithMtime(REPO_B, null)]);

    renderLiveChanges();

    await waitFor(() => expect(getRepoSyncStatus).toHaveBeenCalled());
    // dirtyLatestMtime이 null인 채로 안정된 뒤에도 기록되지 않았는지 확인한다.
    await new Promise((r) => setTimeout(r, 0));
    expect(useLiveChangesStore.getState().lastChangedAt[REPO_B]).toBeUndefined();
  });

  it("`repo:activity` 이벤트는 실시간 감시 대상 경로의 변경 시각을 기록한다", async () => {
    vi.mocked(setActivityWatch).mockResolvedValue({ watched: [REPO_A], overflow: [] });
    vi.mocked(getRepoSyncStatus).mockResolvedValue([]);

    renderLiveChanges();

    await waitFor(() => expect(activityHandlers.has("repo:activity")).toBe(true));
    activityHandlers.get("repo:activity")!({ payload: { path: REPO_A, at: 999 } });

    expect(useLiveChangesStore.getState().lastChangedAt[REPO_A]).toBe(999);
    expect(useLiveChangesStore.getState().isWatched(REPO_A)).toBe(true);
  });
});

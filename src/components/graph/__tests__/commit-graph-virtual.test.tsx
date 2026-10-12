// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import "@/i18n/config";
import { useRepositoryStore } from "@/stores/repository";
import { useSelectionStore } from "@/stores/selection";
import type { CommitInfo, RepoInfo } from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@/hooks/useOpenWorktree", () => ({ useOpenWorktree: () => vi.fn() }));

// 진짜 가상화기를 쓰되(창 밖 행이 DOM에 없는지 본다) `scrollToIndex` 호출만 기록한다.
const scrollToIndex = vi.hoisted(() => vi.fn());
const wrapped = vi.hoisted(() => new WeakSet<object>());
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (...args: Parameters<typeof actual.useVirtualizer>) => {
      const virtualizer = actual.useVirtualizer(...args);
      // 같은 인스턴스가 렌더마다 돌아오므로, 한 번만 감싼다.
      if (!wrapped.has(virtualizer)) {
        wrapped.add(virtualizer);
        const original = virtualizer.scrollToIndex.bind(virtualizer);
        virtualizer.scrollToIndex = (index, options) => {
          scrollToIndex(index, options);
          original(index, options);
        };
      }
      return virtualizer;
    },
  };
});

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../GraphRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../GraphRow")>();
  return {
    ...actual,
    GraphRow: (props: ComponentProps<typeof actual.GraphRow>) => {
      renders.count += 1;
      return <actual.GraphRow {...props} />;
    },
  };
});

const COUNT = 2000;
const REPO = "/work/app";

function commit(i: number): CommitInfo {
  return {
    id: `c${i}`,
    shortId: `c${i}`,
    message: `commit ${i}`,
    summary: `commit ${i}`,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp: 1_700_000_000 - i,
    parentIds: i + 1 < COUNT ? [`c${i + 1}`] : [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

const history = { pages: [Array.from({ length: COUNT }, (_, i) => commit(i))] };

vi.mock("@/api/queries", () => ({
  useDivergencePoint: () => ({ data: undefined }),
  useCommitHistoryInfinite: () => ({
    data: history,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useBranches: () => ({ data: [] }),
  useStatus: () => ({ data: [] }),
  useWorktrees: () => ({ data: [] }),
  useRemoteTags: () => ({ data: undefined }),
  useCommitAvatars: () => ({ data: undefined }),
  useCommitStats: () => new Map(),
}));

const { CommitGraph } = await import("../CommitGraph");

const repo = { path: REPO, name: "app", remotes: [], accountId: null } as unknown as RepoInfo;
const VIEWPORT = 600;

beforeEach(() => {
  renders.count = 0;
  scrollToIndex.mockClear();
  useSelectionStore.getState().clearAll();
  useRepositoryStore.setState({ repos: [repo], activeRepo: repo, activeRepoPath: REPO });
  // jsdom에는 레이아웃이 없다 — 가상화기가 읽는 스크롤 칸 크기를 흉내 낸다.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: VIEWPORT });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
});

function renderGraph() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CommitGraph wips={[]} />
    </QueryClientProvider>,
  );
}

describe("CommitGraph virtualization", () => {
  it("keeps only a window of the 2,000 commits in the DOM", () => {
    renderGraph();
    const mounted = document.querySelectorAll("[data-commit-id]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(80);
    expect(document.querySelector('[data-commit-id="c0"]')).not.toBeNull();
    expect(document.querySelector('[data-commit-id="c1500"]')).toBeNull();
  });

  it("re-renders O(1) rows when the mouse moves over a row", () => {
    renderGraph();
    act(() => useSelectionStore.getState().selectCommit("c3"));
    renders.count = 0;
    const row = (i: number) => document.querySelector(`[data-commit-id="c${i}"]`) as HTMLElement;
    for (let i = 5; i < 15; i++) {
      fireEvent.mouseEnter(row(i));
      fireEvent.mouseLeave(row(i));
    }
    // 이벤트마다 이름 칩을 옮기는 두 행(떠난 행·닿은 행)과 고른 행만 다시 그린다 — 보이는 40여 행 전부가 아니다.
    expect(renders.count).toBeLessThanOrEqual(10 * 2 * 3);
  });

  it("re-renders only the previously and newly selected rows on selection change", () => {
    renderGraph();
    act(() => useSelectionStore.getState().selectCommit("c2"));
    renders.count = 0;
    act(() => useSelectionStore.getState().selectCommit("c3"));
    expect(renders.count).toBeLessThanOrEqual(4);
  });

  it("dims the other chains with one container rule instead of per-row props", () => {
    renderGraph();
    act(() => useSelectionStore.getState().selectCommit("c3"));
    const rule = document.querySelector(".graph-hl style")?.textContent ?? "";
    expect(rule).toMatch(/:not\(\[data-chain="\d+"\]\)\{stroke-opacity:\.45\}/);
  });

  it("scrolls the keyboard-selected row into view even when it is not mounted (row 1500)", () => {
    const { container } = renderGraph();
    act(() => useSelectionStore.getState().selectCommit("c1499"));
    scrollToIndex.mockClear();
    const nav = container.querySelector('[tabindex="0"]') as HTMLElement;
    fireEvent.keyDown(nav, { key: "ArrowDown" });
    expect(useSelectionStore.getState().selectedCommitId).toBe("c1500");
    expect(scrollToIndex).toHaveBeenCalledWith(1500, { align: "auto" });
  });
});

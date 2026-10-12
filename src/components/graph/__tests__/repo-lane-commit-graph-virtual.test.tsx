// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@/i18n/config";
import { buildRepoLaneRows, type LaneRepo } from "../repo-lanes";
import type { CommitInfo } from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

// 진짜 가상화기를 쓰되(창 밖 행이 DOM에 없는지 본다) `scrollToIndex` 호출만 기록한다.
const scrollToIndex = vi.hoisted(() => vi.fn());
const wrapped = vi.hoisted(() => new WeakSet<object>());
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (...args: Parameters<typeof actual.useVirtualizer>) => {
      const virtualizer = actual.useVirtualizer(...args);
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

// 「변경」 칸 조회가 받은 쌍을 기록한다 — 창 밖 커밋은 여기에 없어야 한다.
const askedPairs = vi.hoisted(() => ({ last: [] as { path: string; oid: string }[] }));
vi.mock("@/api/queries", () => ({
  useCommitStatsAcrossRepos: (pairs: { path: string; oid: string }[]) => {
    askedPairs.last = pairs;
    return new Map();
  },
  commitStatsAcrossReposKey: (path: string, oid: string) => `${path}\u0000${oid}`,
}));

const { RepoLaneCommitGraph } = await import("../CommitGraph");

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
    parentIds: [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

const repos: LaneRepo[] = [
  { path: REPO, commits: Array.from({ length: COUNT }, (_, i) => commit(i)), hasBase: false },
];
const graph = buildRepoLaneRows(repos, []);

beforeEach(() => {
  scrollToIndex.mockClear();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
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

function renderGraph(selectedKey: string | null = null) {
  return render(
    <RepoLaneCommitGraph
      graph={graph}
      lanePaths={[REPO]}
      repoLabel={() => "app"}
      selectedKey={selectedKey}
      baseTime={null}
      baseBranchLabel="main"
      remoteLabel="origin"
      isLoading={false}
      onSelectCommit={() => {}}
      onSelectWip={() => {}}
    />,
  );
}

describe("RepoLaneCommitGraph virtualization", () => {
  it("keeps fewer than 100 of the 2,000 rows in the DOM", () => {
    renderGraph();
    const mounted = document.querySelectorAll("[data-commit-id]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
    expect(document.querySelector('[data-commit-id="c1500"]')).toBeNull();
  });

  it("asks for stats only for commits in the rendered window", () => {
    renderGraph();
    const mounted = document.querySelectorAll("[data-commit-id]").length;
    expect(askedPairs.last.length).toBe(mounted);
    expect(askedPairs.last.length).toBeLessThan(100);
    expect(askedPairs.last.some((p) => p.oid === "c1500")).toBe(false);
  });

  it("scrolls the keyboard-selected row into view even when it is not mounted", () => {
    const rows = graph.rows;
    const key = rows[1499].key;
    const { container } = renderGraph(key);
    scrollToIndex.mockClear();
    const onSelect = fireEvent.keyDown(container.querySelector('[tabindex="0"]') as HTMLElement, { key: "ArrowDown" });
    expect(onSelect).toBe(false);
    expect(scrollToIndex).toHaveBeenCalledWith(1500, { align: "auto" });
  });
});

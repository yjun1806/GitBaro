// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import "@/i18n/config";
import { buildRepoLaneRows, type LaneRepo, type LaneWip } from "../repo-lanes";
import type { CommitInfo } from "@/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
// 저장소별 레인 그래프의 「변경」 칸(3.15)이 쓰는 조회. 이 스위트는 재렌더 횟수만 보므로 늘 빈 맵.
vi.mock("@/api/queries", () => ({
  useCommitStatsAcrossRepos: () => new Map(),
  commitStatsAcrossReposKey: (path: string, oid: string) => `${path}\u0000${oid}`,
}));

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("../GraphRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../GraphRow")>();
  return {
    ...actual,
    GraphRow: (props: ComponentProps<typeof actual.GraphRow>) => {
      renders.set(props.commit.id, (renders.get(props.commit.id) ?? 0) + 1);
      return <actual.GraphRow {...props} />;
    },
  };
});

const { RepoLaneCommitGraph } = await import("../CommitGraph");

const REPO = "/work/app";

function commit(id: string): CommitInfo {
  return {
    id,
    shortId: id,
    message: id,
    summary: id,
    author: { name: "YJ", email: "yj@example.com" },
    committer: { name: "YJ", email: "yj@example.com" },
    timestamp: 1_700_000_000,
    parentIds: [],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
  };
}

Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  renders.clear();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RepoLaneCommitGraph ticking (#4)", () => {
  it("does not re-render commit rows every second even with a live WIP row above them", () => {
    const repos: LaneRepo[] = [{ path: REPO, commits: [commit("c1"), commit("c2")], hasBase: false }];
    const wips: LaneWip[] = [
      { repoPath: REPO, path: REPO, branch: "main", isMain: true, count: 2, changedAt: Date.now() },
    ];
    const graph = buildRepoLaneRows(repos, wips);
    render(
      <RepoLaneCommitGraph
        graph={graph}
        lanePaths={[REPO]}
        repoLabel={() => "app"}
        selectedKey={null}
        baseTime={null}
        baseBranchLabel="main"
        remoteLabel="origin"
        isLoading={false}
        onSelectCommit={() => {}}
        onSelectWip={() => {}}
      />,
    );
    expect(renders.get("c1")).toBe(1);
    expect(renders.get("c2")).toBe(1);

    // WIP 행의 「N초 전 바뀜」 안내가 1초마다 도는 시계(`useNow`)가 커밋 행까지 다시 그리게 하면 안 된다.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(renders.get("c1")).toBe(1);
    expect(renders.get("c2")).toBe(1);
  });
});

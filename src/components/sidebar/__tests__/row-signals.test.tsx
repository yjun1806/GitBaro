// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import type { WorktreeReviewStatus } from "@/hooks/useReviewStatus";
import type { SidebarTreeData } from "../useSidebarTreeData";
import { formatAgo, liveDotLabel, workingBranchReasonText } from "../row-meta";
import { RowSignals, pulseBucket, type RowSignalValues } from "../RowSignals";
import { changedAgoText } from "../SidebarHoverCard";
import { signalValues } from "../RepoCard";

afterEach(cleanup);

const en = i18n.getFixedT("en");
const ko = i18n.getFixedT("ko");

const NOW = 1_000_000;
const quiet: RowSignalValues = { dirty: 0, live: false, watched: true, changedAt: 0, ahead: 0, behind: 0 };

describe("live dot label", () => {
  it("says the files are changing now and how long ago", () => {
    expect(formatAgo(ko, 100_000, 88_000)).toBe("12초");
    expect(liveDotLabel(ko, true, 100_000, 88_000)).toBe("지금 파일이 바뀌는 중 · 12초 전");
    expect(liveDotLabel(en, true, 200_000, 20_000)).toBe("Files changing now · 3m ago");
    expect(liveDotLabel(en, false, 100_000, 88_000)).toMatch(/not watched live/);
  });
});

describe("RowSignals", () => {
  it("renders nothing for a clean folder with nothing to push", () => {
    const { container } = render(<RowSignals values={quiet} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the uncommitted count by the orange dot, then gray ↓N to pull and ↑N to push", () => {
    const { container } = render(<RowSignals values={{ ...quiet, dirty: 3, ahead: 2, behind: 4 }} now={NOW} />);
    const dot = container.querySelector('[data-signal="dirty"]')!;
    expect(dot).toHaveAttribute("aria-label", "3 uncommitted files");
    expect(dot).toHaveTextContent("3");
    expect(dot).not.toHaveAttribute("data-live");
    expect(container.querySelector('[data-signal="behind"]')).toHaveTextContent("↓4");
    const ahead = container.querySelector('[data-signal="ahead"]')!;
    expect(ahead).toHaveTextContent("↑2");
    // 화살표는 강조가 아니라 회색이다.
    expect(ahead.className).toContain("text-(--fg2)");
    const order = [...container.querySelectorAll("[data-signal]")].map((e) => e.getAttribute("data-signal"));
    expect(order).toEqual(["dirty", "behind", "ahead"]);
  });

  it("shows only ↓N when there is just something to pull", () => {
    const { container } = render(<RowSignals values={{ ...quiet, behind: 1 }} now={NOW} />);
    expect(container.querySelectorAll("[data-signal]")).toHaveLength(1);
    expect(container.querySelector('[data-signal="behind"]')).toHaveTextContent("↓1");
  });

  it("rings the dot while files are changing now, and fades it outside live watching", () => {
    const { container, rerender } = render(
      <RowSignals values={{ ...quiet, dirty: 1, live: true, changedAt: NOW - 5_000 }} now={NOW} />,
    );
    const dot = () => container.querySelector('[data-signal="dirty"]')!;
    expect(dot()).toHaveAttribute("data-live", "true");
    expect(dot().getAttribute("aria-label")).toMatch(/Files changing now · 5s ago/);
    expect(dot().className).not.toContain("opacity-40");
    // 파일이 바뀌는 중이어도 커밋 안 한 파일이 없으면 숫자 없이 점만 보인다.
    rerender(<RowSignals values={{ ...quiet, live: true, changedAt: NOW - 5_000 }} now={NOW} />);
    expect(dot()).toHaveTextContent(/^$/);
    rerender(<RowSignals values={{ ...quiet, dirty: 1, live: true, watched: false, changedAt: NOW - 5_000 }} now={NOW} />);
    expect(dot().className).toContain("opacity-40");
  });

  it("remounts the ring only when changedAt moves to a new pulse bucket", () => {
    const { container, rerender } = render(
      <RowSignals values={{ ...quiet, dirty: 1, live: true, changedAt: 10_000 }} now={NOW} />,
    );
    const ring = () => container.querySelector('[data-signal="dirty"] [data-testid="dot-pulse"]');
    const first = ring();
    expect(first).toBeTruthy();
    // 접힌 워크스페이스·저장소 행처럼 여러 저장소가 거의 동시에(같은 초 안에) 바뀌어도 테는 한 번만.
    rerender(<RowSignals values={{ ...quiet, dirty: 2, live: true, changedAt: 10_400 }} now={NOW} />);
    expect(ring()).toBe(first);
    // 다음 초로 넘어가면(1000ms 밖) 새로 마운트해 테가 다시 퍼진다.
    rerender(<RowSignals values={{ ...quiet, dirty: 2, live: true, changedAt: 11_100 }} now={NOW} />);
    expect(ring()).not.toBe(first);
  });
});

describe("pulseBucket", () => {
  it("coalesces changedAt values within the same second into one bucket", () => {
    expect(pulseBucket(10_000)).toBe(pulseBucket(10_400));
    expect(pulseBucket(10_999)).toBe(10);
  });

  it("moves to a new bucket once changedAt crosses a second boundary", () => {
    expect(pulseBucket(10_000)).not.toBe(pulseBucket(11_000));
    expect(pulseBucket(11_100)).toBe(11);
  });
});

describe("hover card change time", () => {
  it("says just now, minutes or hours", () => {
    expect(changedAgoText(ko, NOW, NOW - 30_000)).toBe("방금 바뀜");
    expect(changedAgoText(ko, NOW, NOW - 5 * 60_000)).toBe("5분 전 바뀜");
    expect(changedAgoText(en, NOW * 10, NOW * 10 - 2 * 3_600_000)).toBe("changed 2 hours ago");
  });
});

describe("signalValues", () => {
  const REPO = "/r/app";
  const MAIN = REPO;
  const FEAT = "/r/app/.worktrees/feat";
  const review = (path: string): WorktreeReviewStatus => ({ path, branch: "x", headOid: "a", isMain: path === REPO, repoPath: REPO });

  function data(over: Partial<SidebarTreeData> = {}): SidebarTreeData {
    return {
      tree: [],
      signals: {},
      syncByPath: {},
      reviewByPath: { [MAIN]: review(MAIN), [FEAT]: review(FEAT) },
      reviewRepos: [],
      worktreesByRepo: {},
      lastChangedAt: {},
      watched: [],
      overflow: [],
      now: NOW,
      branchOf: () => null,
      workingBranchRowsOf: () => [],
      ...over,
    };
  }

  it("does not double count ↓·↑ when two worktrees of one repo share an upstream (#4)", () => {
    // main과 그 워크트리 feat가 둘 다 origin/main을 추적하면, 실제로 받을 커밋·올릴 커밋은 5개이지
    // 두 워크트리를 더한 10개가 아니다.
    const d = data({ signals: { [MAIN]: { behind: 5, ahead: 5 }, [FEAT]: { behind: 5, ahead: 5 } } });
    const values = signalValues([MAIN, FEAT], d);
    expect(values.behind).toBe(5);
    expect(values.ahead).toBe(5);
  });

  it("adds ↓·↑ across different repositories (a workspace card's total)", () => {
    const OTHER = "/r/other";
    const d = data({
      reviewByPath: { [MAIN]: review(MAIN), [OTHER]: { path: OTHER, branch: "x", headOid: "a", isMain: true, repoPath: OTHER } },
      signals: { [MAIN]: { behind: 3 }, [OTHER]: { behind: 2 } },
    });
    expect(signalValues([MAIN, OTHER], d).behind).toBe(5);
  });
});

describe("workingBranchReasonText", () => {
  it("names each reason and joins more than one with a middle dot", () => {
    expect(workingBranchReasonText(en, ["unpushed"], null)).toBe("Has commits not on any remote");
    expect(workingBranchReasonText(en, ["unpushed", "recent"], null)).toBe(
      "Has commits not on any remote · Committed recently, not yet merged into the default branch",
    );
  });

  it("names the PR number when it's known, and falls back when it isn't", () => {
    expect(workingBranchReasonText(en, ["openPr"], 58)).toBe("Open PR #58");
    expect(workingBranchReasonText(en, ["openPr"], null)).toBe("Has an open PR");
  });
});

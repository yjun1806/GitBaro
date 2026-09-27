// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/i18n/config";
import { GraphRow, GRAPH_COLUMNS } from "@/components/graph/GraphRow";
import type { GraphRowLayout } from "@/lib/graph-lanes";
import type { CommitInfo, CommitStats } from "@/types";
import type { CiSummary } from "@/components/history/CommitDetail";

afterEach(cleanup);

const LAYOUT: GraphRowLayout = { oid: "c1", lane: 0, chain: 0, edges: [], width: 1 };
const MID_DOT = "·";

function commit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    id: "abc123def456",
    shortId: "abc123d",
    message: "fix login",
    summary: "fix login",
    author: { name: "YJun", email: "yj@example.com" },
    committer: { name: "YJun", email: "yj@example.com" },
    timestamp: 1_700_000_000,
    parentIds: ["parent1"],
    refs: [],
    coAuthors: [],
    isAgentAuthored: false,
    ...overrides,
  };
}

function stats(overrides: Partial<CommitStats> = {}): CommitStats {
  return { oid: "abc123def456", merge: false, filesChanged: 3, additions: 12, deletions: 4, error: null, ...overrides };
}

const baseProps = {
  layout: LAYOUT,
  graphWidth: 24,
  colorOf: () => "hsl(200 50% 45%)",
  remoteTags: null,
  isSelected: false,
  isHighlighted: false,
  wipAbove: false,
  onClick: vi.fn(),
};

describe("GraphRow columns (design-system.md 3.15)", () => {
  it("has no SHA in the row's visible text — only the hover title reaches it (D45)", () => {
    const c = commit();
    render(<GraphRow {...baseProps} commit={c} stats={stats()} />);
    const row = screen.getByRole("button");
    expect(row.textContent).not.toContain(c.shortId);
    expect(row.textContent).not.toContain(c.id);
    expect(row.getAttribute("title")).toBe(`${c.id} ${MID_DOT} fix login`);
  });

  it("splits a leading issue key into its own badge and drops it from the title text", () => {
    const c = commit({ summary: "XMS-371 fix login", message: "XMS-371 fix login" });
    render(<GraphRow {...baseProps} commit={c} stats={stats()} />);
    const row = screen.getByRole("button");
    expect(screen.getByText("XMS-371")).toBeTruthy();
    // 제목 글자 칸에는 이슈 키를 뗀 나머지만 있다(배지와 겹치지 않는다).
    const titleSpans = [...row.querySelectorAll("span")].filter((el) => el.textContent === "fix login");
    expect(titleSpans.length).toBeGreaterThan(0);
    expect(row.textContent).not.toContain("XMS-371 fix login");
  });

  it("does not add an issue-key badge when the title has none, or the key is not at the very start", () => {
    const c = commit({ summary: "fix login (XMS-371)" });
    render(<GraphRow {...baseProps} commit={c} stats={stats()} />);
    expect(screen.queryByText("XMS-371")).toBeNull();
    expect(screen.getByText("fix login (XMS-371)")).toBeTruthy();
  });

  it("renders file count, size bar and +/- lines from the commit's stats", () => {
    const c = commit();
    render(<GraphRow {...baseProps} commit={c} stats={stats({ filesChanged: 3, additions: 12, deletions: 4 })} />);
    expect(screen.getByText("3 files")).toBeTruthy();
    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("−4")).toBeTruthy(); // − (U+2212), not a hyphen
    expect(screen.queryByText("-4")).toBeNull(); // 하이픈이 아니다
  });

  it("shows the merge label instead of file stats for a merge commit", () => {
    const c = commit({ parentIds: ["p1", "p2"] });
    render(<GraphRow {...baseProps} commit={c} stats={stats({ merge: true, filesChanged: null, additions: null, deletions: null })} />);
    expect(screen.getByText("Merge")).toBeTruthy();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("leaves the change cell empty (no flicker, no zero) until stats arrive", () => {
    const c = commit();
    const { container } = render(<GraphRow {...baseProps} commit={c} stats={undefined} />);
    expect(screen.queryByText(/files?$/)).toBeNull();
    expect(screen.queryByText(/^\+/)).toBeNull();
    // 행 높이·칸 수는 그대로다 — 그리드 칸 자체는 계속 5개(빈 칸 포함)다.
    const cols = container.querySelector(".grid");
    expect(cols?.children.length).toBe(5);
  });

  it("shows only the file count when the diff is too large to carry line counts", () => {
    const c = commit();
    render(<GraphRow {...baseProps} commit={c} stats={stats({ filesChanged: 1200, additions: null, deletions: null })} />);
    expect(screen.getByText("1200 files")).toBeTruthy();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("leaves the change cell empty for a commit that changed no files", () => {
    const c = commit();
    render(<GraphRow {...baseProps} commit={c} stats={stats({ filesChanged: 0, additions: 0, deletions: 0 })} />);
    const text = screen.getByRole("button").textContent ?? "";
    expect(text).not.toContain("+0");
    expect(text).not.toContain("−0");
    expect(text).not.toMatch(/0 files?/);
  });

  it("drops the side that is zero: +7 −0 reads +7", () => {
    const c = commit();
    render(<GraphRow {...baseProps} commit={c} stats={stats({ filesChanged: 1, additions: 7, deletions: 0 })} />);
    const text = screen.getByRole("button").textContent ?? "";
    expect(text).toContain("+7");
    expect(text).not.toContain("−0");
  });

  it("shows the CI icon only when a run exists for this commit", () => {
    const c = commit();
    const ci: CiSummary = { state: "failed", names: ["build"] };
    const { rerender } = render(<GraphRow {...baseProps} commit={c} stats={stats()} ci={ci} />);
    expect(screen.getByRole("img", { name: "Failed" })).toBeTruthy();

    rerender(<GraphRow {...baseProps} commit={c} stats={stats()} ci={null} />);
    expect(screen.queryByRole("img", { name: "Failed" })).toBeNull();
  });
});

describe("GRAPH_COLUMNS narrowing (container query, @container/graph)", () => {
  it("keeps four narrowing grid-template-columns declarations for the three breakpoints", () => {
    expect(GRAPH_COLUMNS).toContain("grid-cols-[minmax(0,1fr)_128px_16px_112px_64px]");
    expect(GRAPH_COLUMNS).toContain("@max-[820px]/graph:grid-cols-[minmax(0,1fr)_128px_16px_36px_64px]");
    expect(GRAPH_COLUMNS).toContain("@max-[680px]/graph:grid-cols-[minmax(0,1fr)_64px_16px_36px_64px]");
    expect(GRAPH_COLUMNS).toContain("@max-[560px]/graph:grid-cols-[minmax(0,1fr)_0px_16px_36px_64px]");
    // D47 2단계의 좁은 커밋 목록(240px): 설명·시각 두 칸만 남는다.
    expect(GRAPH_COLUMNS).toContain("@max-[400px]/graph:grid-cols-[minmax(0,1fr)_auto]");
  });

  it("hides only the author's name text at the first stage — the avatar stays", () => {
    const c = commit();
    const { container } = render(<GraphRow {...baseProps} commit={c} stats={stats()} />);
    const nameEl = screen.getByText("YJun");
    expect(nameEl.className).toContain("@max-[820px]/graph:hidden");
    const avatar = container.querySelector('[aria-hidden="true"].rounded-full');
    expect(avatar?.className).not.toContain("hidden");
  });

  it("hides only the file count and size bar at the second stage — the +/- numbers stay", () => {
    const c = commit();
    render(<GraphRow {...baseProps} commit={c} stats={stats({ filesChanged: 3, additions: 12, deletions: 4 })} />);
    const fileCountEl = screen.getByText("3 files");
    expect(fileCountEl.className).toContain("@max-[680px]/graph:hidden");
    const linesEl = screen.getByText("+12").closest("span");
    expect(linesEl?.className ?? "").not.toContain("@max-[680px]/graph:hidden");
  });

  it("hides the whole change cell (bar and lines together) at the third stage", () => {
    const c = commit();
    render(<GraphRow {...baseProps} commit={c} stats={stats({ filesChanged: 3, additions: 12, deletions: 4 })} />);
    const fileCountEl = screen.getByText("3 files");
    const cell = fileCountEl.parentElement;
    expect(cell?.className).toContain("@max-[560px]/graph:hidden");
  });
});

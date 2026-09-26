// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { GraphWipRow, followRowParts } from "@/components/graph/GraphRow";
import type { WipTarget } from "@/components/graph/graph-model";

afterEach(cleanup);

const t = i18n.getFixedT("en");

const target = (overrides: Partial<WipTarget> = {}): WipTarget => ({
  branch: "feat/x",
  shortSha: null,
  worktree: "app-feat",
  ...overrides,
});

const LANE_COLOR = "hsl(200, 50%, 50%)";

describe("GraphWipRow branch/worktree labels", () => {
  it("shows the branch label with a branch icon, filled in the worktree's lane color", () => {
    render(
      <GraphWipRow
        wipLabel="Uncommitted changes"
        target={target()}
        count={2}
        changedAt={null}
        color={LANE_COLOR}
        graphWidth={40}
        selected={false}
        connectDown={false}
        onSelect={vi.fn()}
      />,
    );
    const branchLabel = screen.getByTitle("feat/x branch");
    // Branch icon (lucide "GitBranch"), not the worktree folder icon.
    expect(branchLabel.querySelector("svg.lucide-git-branch")).toBeTruthy();
    expect(branchLabel.querySelector("svg.lucide-folder-git2")).toBeFalsy();
    expect(branchLabel.getAttribute("style")).toContain("--lane-bg");
  });

  it("shows the worktree label with a folder icon and the generic 'Worktree' tooltip, not its own name repeated", () => {
    render(
      <GraphWipRow
        wipLabel="Uncommitted changes"
        target={target()}
        count={2}
        changedAt={null}
        color={LANE_COLOR}
        graphWidth={40}
        selected={false}
        connectDown={false}
        onSelect={vi.fn()}
      />,
    );
    const worktreeLabel = screen.getByTitle("Worktree");
    expect(worktreeLabel.querySelector("svg.lucide-folder-git2")).toBeTruthy();
    expect(worktreeLabel.querySelector("svg.lucide-git-branch")).toBeFalsy();
    expect(worktreeLabel.textContent).toBe("app-feat");
  });

  it("does not color the branch label when the worktree has no branch (detached HEAD)", () => {
    render(
      <GraphWipRow
        wipLabel="Uncommitted changes"
        target={target({ branch: null, shortSha: "abc1234" })}
        count={1}
        changedAt={null}
        color={LANE_COLOR}
        graphWidth={40}
        selected={false}
        connectDown={false}
        onSelect={vi.fn()}
      />,
    );
    const branchLabel = screen.getByTitle("No branch (HEAD abc1234)");
    expect(branchLabel.getAttribute("style")).toBeFalsy();
  });
});

describe("GraphWipRow live motion (agent is writing now)", () => {
  function renderRow(overrides: { live?: boolean; count?: number | null; changedAt?: number | null } = {}) {
    return render(
      <GraphWipRow
        wipLabel="Uncommitted changes"
        target={target()}
        count={overrides.count ?? 2}
        changedAt={overrides.changedAt ?? Date.now()}
        color={LANE_COLOR}
        graphWidth={40}
        selected={false}
        connectDown={false}
        live={overrides.live ?? false}
        onSelect={vi.fn()}
      />,
    );
  }

  it("does not crawl or pulse when not live, even with files present", () => {
    const { container } = renderRow({ live: false, count: 3 });
    expect(container.querySelector('[data-testid="wip-ring"]')?.getAttribute("class")).not.toContain("animate-wip-crawl");
    expect(container.querySelector('[data-testid="wip-halo"]')).toBeNull();
    expect(container.querySelector('[data-testid="wip-pulse-ring"]')).toBeNull();
  });

  it("crawls and shows the halo/pulse only when live AND files remain (not right after a commit)", () => {
    const { container, rerender } = renderRow({ live: true, count: 3, changedAt: 1_000 });
    expect(container.querySelector('[data-testid="wip-ring"]')?.getAttribute("class")).toContain("animate-wip-crawl");
    expect(container.querySelector('[data-testid="wip-halo"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="wip-pulse-ring"]')).toBeTruthy();

    // changedAt is still "recent" (live) right after a commit, but the file count just dropped to 0 —
    // the ring must settle (stop crawling, drop the halo/pulse) instead of continuing to crawl.
    rerender(
      <GraphWipRow
        wipLabel="Uncommitted changes"
        target={target()}
        count={0}
        changedAt={1_000}
        color={LANE_COLOR}
        graphWidth={40}
        selected={false}
        connectDown={false}
        live
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="wip-ring"]')?.getAttribute("class")).not.toContain("animate-wip-crawl");
    expect(container.querySelector('[data-testid="wip-halo"]')).toBeNull();
    expect(container.querySelector('[data-testid="wip-pulse-ring"]')).toBeNull();
  });

  it("always transitions stroke-opacity so the settle (1 → 0.5) is soft, not instant", () => {
    const { container } = renderRow({ live: false, count: 0 });
    const ring = container.querySelector('[data-testid="wip-ring"]');
    expect(ring?.getAttribute("class")).toContain("transition-[stroke-opacity]");
    expect(ring?.getAttribute("stroke-opacity")).toBe("0.5");
  });

  it("remounts the pulse ring (a new DOM node) only when changedAt moves forward", () => {
    const { container, rerender } = renderRow({ live: true, count: 2, changedAt: 1_000 });
    const first = container.querySelector('[data-testid="wip-pulse-ring"]');
    expect(first).toBeTruthy();
    rerender(
      <GraphWipRow
        wipLabel="Uncommitted changes"
        target={target()}
        count={2}
        changedAt={2_000}
        color={LANE_COLOR}
        graphWidth={40}
        selected={false}
        connectDown={false}
        live
        onSelect={vi.fn()}
      />,
    );
    const second = container.querySelector('[data-testid="wip-pulse-ring"]');
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

describe("followRowParts live window (LIVE_EDIT_MS = 60s)", () => {
  it("is live just under 60s after changedAt, and not live at/after 60s", () => {
    const now = 100_000;
    expect(followRowParts(t, now, now - 59_999, 3, false, vi.fn()).live).toBe(true);
    expect(followRowParts(t, now, now - 60_000, 3, false, vi.fn()).live).toBe(false);
    expect(followRowParts(t, now, now - 120_000, 3, false, vi.fn()).live).toBe(false);
  });

  it("is not live when changedAt is unknown, regardless of file count", () => {
    expect(followRowParts(t, 100_000, null, 5, false, vi.fn()).live).toBe(false);
  });

  it("live does not depend on file count (the row combines it with count itself for the ring)", () => {
    const now = 100_000;
    expect(followRowParts(t, now, now - 1_000, 0, false, vi.fn()).live).toBe(true);
  });
});

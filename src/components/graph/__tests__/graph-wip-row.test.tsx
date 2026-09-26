// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/i18n/config";
import { GraphWipRow } from "@/components/graph/GraphRow";
import type { WipTarget } from "@/components/graph/graph-model";

afterEach(cleanup);

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

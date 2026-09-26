// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/i18n/config";
import { RefBadge } from "@/components/history/CommitItem";
import type { RefLabel } from "@/types";

afterEach(cleanup);

const ref = (overrides: Partial<RefLabel>): RefLabel => ({
  name: "feat/x",
  kind: "localBranch",
  isHead: false,
  ...overrides,
});

describe("RefBadge", () => {
  it("keeps a remote branch's outline look even when it inherits a worktree's lane color", () => {
    // branchColorOf lets a remote ref inherit the lane color of the local branch with the same
    // name, so RefBadge must not let that turn it into a filled "worktree" look — it would then be
    // indistinguishable from the checked-out local branch.
    render(<RefBadge label={ref({ name: "origin/feat/x", kind: "remoteBranch" })} laneColor="hsl(200, 50%, 50%)" />);
    const label = screen.getByTitle("origin/feat/x");
    expect(label.className).toContain("bg-transparent");
    expect(label.className).toContain("border-border");
    expect(label.getAttribute("style")).toBeFalsy();
  });

  it("keeps HEAD's bold outline even when the checked-out branch has a lane color", () => {
    render(<RefBadge label={ref({ isHead: true })} laneColor="hsl(200, 50%, 50%)" />);
    const label = screen.getByTitle("feat/x");
    expect(label.className).toContain("border-foreground/50");
    expect(label.className).toContain("font-bold");
    expect(label.getAttribute("style")).toBeFalsy();
  });

  it("fills a plain local branch with its worktree's lane color", () => {
    render(<RefBadge label={ref({})} laneColor="hsl(200, 50%, 50%)" />);
    const label = screen.getByTitle("feat/x");
    expect(label.getAttribute("style")).toContain("--lane-bg");
  });

  it("gives a local-only tag a title that says so, without changing the visible name", () => {
    render(<RefBadge label={ref({ name: "v1", kind: "tag" })} remoteTags={new Set(["v0"])} />);
    const label = screen.getByTitle("v1 (local only)");
    expect(label.textContent).toBe("v1");
  });

  it("does not add the local-only title to a tag that is on the remote", () => {
    render(<RefBadge label={ref({ name: "v1", kind: "tag" })} remoteTags={new Set(["v1"])} />);
    expect(screen.getByTitle("v1")).toBeTruthy();
  });
});

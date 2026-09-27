// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { followRowParts, GraphWipRow } from "../GraphRow";
import { wipTarget } from "../graph-model";

afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage("en");
});

const target = wipTarget({ path: "/w/app", branch: "feat/agent-review-ux", isMain: true });

function renderRow(changedAgoMs: number, following: boolean, compact = false) {
  const now = Date.now();
  const changedAt = now - changedAgoMs;
  const parts = followRowParts(i18n.t, now, changedAt, 15, following, vi.fn());
  render(
    <GraphWipRow
      wipLabel="Uncommitted changes"
      target={target}
      count={15}
      changedAt={changedAt}
      color="hsl(200 50% 45%)"
      graphWidth={24}
      selected={false}
      connectDown={false}
      trailing={parts.trailing}
      action={parts.followButton}
      live={parts.live}
      compact={compact}
      onSelect={vi.fn()}
    />,
  );
}

describe("WIP row (uncommitted changes)", () => {
  it("says when it changed once: the live note while editing, no second time in the time column", () => {
    renderRow(18_000, false);
    const row = screen.getByTestId("wip-row");
    expect(row.textContent).toContain("Changed 18 seconds ago");
    expect(row.textContent).not.toContain("Modified");
  });

  it("shows the time column once the edit is no longer live", () => {
    renderRow(10 * 60_000, false);
    const row = screen.getByTestId("wip-row");
    expect(row.textContent).toMatch(/Modified 10 minutes ago|10 minutes ago/);
    expect(row.textContent).not.toContain("Changed");
  });

  it("has no separate Follow button (the row itself follows); only the stop button while following", () => {
    renderRow(10 * 60_000, false);
    expect(screen.queryByRole("button", { name: /Follow/ })).toBeNull();
    cleanup();
    renderRow(10 * 60_000, true);
    expect(screen.getByRole("button", { name: "Following · stop" })).toBeTruthy();
  });

  it("uses a shorter label instead of an ellipsis in the narrow list", () => {
    renderRow(10 * 60_000, false, true);
    expect(screen.getByTestId("wip-row").textContent).toContain("Uncommitted");
    expect(screen.getByTestId("wip-row").textContent).not.toContain("Uncommitted changes");
    expect(screen.getByTestId("wip-row").textContent).toContain("10m");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import { formatAgo, liveDotLabel } from "../row-meta";
import { RowSignals, type RowSignalValues } from "../RowSignals";
import { changedAgoText } from "../SidebarHoverCard";
import { viewOnlyDefaultBranch } from "../RepoCard";

afterEach(cleanup);

const en = i18n.getFixedT("en");
const ko = i18n.getFixedT("ko");

const NOW = 1_000_000;
const quiet: RowSignalValues = { dirty: 0, live: false, watched: true, changedAt: 0, ahead: 0 };

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

  it("shows at most two signals: an orange dot for uncommitted files and a gray ↑N", () => {
    const { container } = render(<RowSignals values={{ ...quiet, dirty: 3, ahead: 2 }} now={NOW} />);
    const dot = container.querySelector('[data-signal="dirty"]')!;
    expect(dot).toHaveAttribute("aria-label", "3 uncommitted files");
    expect(dot).not.toHaveAttribute("data-live");
    const ahead = container.querySelector('[data-signal="ahead"]')!;
    expect(ahead).toHaveTextContent("↑2");
    // ↑N은 강조가 아니라 회색이다.
    expect(ahead.className).toContain("text-muted-foreground");
    expect(container.querySelectorAll("[data-signal]")).toHaveLength(2);
  });

  it("rings the dot while files are changing now, and fades it outside live watching", () => {
    const { container, rerender } = render(
      <RowSignals values={{ ...quiet, dirty: 1, live: true, changedAt: NOW - 5_000 }} now={NOW} />,
    );
    const dot = () => container.querySelector('[data-signal="dirty"]')!;
    expect(dot()).toHaveAttribute("data-live", "true");
    expect(dot().getAttribute("aria-label")).toMatch(/Files changing now · 5s ago/);
    expect(dot().className).not.toContain("opacity-40");
    rerender(<RowSignals values={{ ...quiet, dirty: 1, live: true, watched: false, changedAt: NOW - 5_000 }} now={NOW} />);
    expect(dot().className).toContain("opacity-40");
  });
});

describe("hover card change time", () => {
  it("says just now, minutes or hours", () => {
    expect(changedAgoText(ko, NOW, NOW - 30_000)).toBe("방금 바뀜");
    expect(changedAgoText(ko, NOW, NOW - 5 * 60_000)).toBe("5분 전 바뀜");
    expect(changedAgoText(en, NOW * 10, NOW * 10 - 2 * 3_600_000)).toBe("changed 2 hours ago");
  });
});

describe("viewOnlyDefaultBranch", () => {
  const b = (name: string, isDefault: boolean, isRemote = false) => ({ name, isDefault, isRemote });

  it("offers the local default branch when no working folder has it checked out", () => {
    expect(viewOnlyDefaultBranch([b("main", true), b("feat/x", false)], ["feat/x"])).toEqual({
      kind: "ref",
      name: "main",
      isRemote: false,
    });
  });

  it("offers nothing when a working folder already has it checked out", () => {
    expect(viewOnlyDefaultBranch([b("main", true)], ["feat/x", "main"])).toBeNull();
  });

  it("falls back to the remote default branch, matching a checkout by its short name", () => {
    const branches = [b("origin/main", true, true)];
    expect(viewOnlyDefaultBranch(branches, ["feat/x"])).toEqual({ kind: "ref", name: "origin/main", isRemote: true });
    expect(viewOnlyDefaultBranch(branches, ["main"])).toBeNull();
  });

  it("offers nothing before the branch list arrives", () => {
    expect(viewOnlyDefaultBranch(undefined, [])).toBeNull();
  });
});

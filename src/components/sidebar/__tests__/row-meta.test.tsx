// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "@/i18n/config";
import { rowMetaItems, syncText } from "../row-meta";
import { RowBadges } from "../RowBadges";
import { BranchLine } from "../BranchLine";
import { guideLineLeft, INDENT_PX } from "../TreeRowFrame";

afterEach(cleanup);

describe("rowMetaItems", () => {
  it("keeps the fixed order uncommitted → new commits → ahead/behind", () => {
    expect(rowMetaItems({ behind: 1, newCommits: 2, dirty: 3, ahead: 4 }).map((i) => i.kind)).toEqual([
      "dirty",
      "newCommits",
      "sync",
    ]);
  });

  it("omits zero values", () => {
    expect(rowMetaItems({})).toEqual([]);
    expect(rowMetaItems({ dirty: 0, newCommits: 0, ahead: 0, behind: 0 })).toEqual([]);
    expect(rowMetaItems({ newCommits: 5 })).toEqual([{ kind: "newCommits", count: 5 }]);
    expect(rowMetaItems({ behind: 2 })).toEqual([{ kind: "sync", ahead: 0, behind: 2 }]);
  });

  it("formats ahead/behind without the zero side", () => {
    expect(syncText(2, 1)).toBe("↑2 ↓1");
    expect(syncText(0, 4)).toBe("↓4");
    expect(syncText(3, 0)).toBe("↑3");
  });
});

describe("RowBadges", () => {
  it("renders the meta items in the fixed order with tooltips, and nothing when all are zero", () => {
    const { container, rerender } = render(<RowBadges dirty={14} newCommits={14} ahead={1} behind={2} />);
    const kinds = [...container.querySelectorAll("[data-meta]")].map((el) => el.getAttribute("data-meta"));
    expect(kinds).toEqual(["dirty", "newCommits", "sync"]);
    const sync = container.querySelector("[data-meta=sync]");
    expect(sync).toHaveTextContent("↑1 ↓2");
    // 보낼·받을 커밋은 한 툴팁에 「/」로 잇는다.
    expect(sync?.getAttribute("title")).toMatch(/.+ \/ .+/);
    for (const el of container.querySelectorAll("[data-meta]")) {
      expect(el.getAttribute("title")).toBeTruthy();
    }

    rerender(<RowBadges />);
    expect(container.querySelector("[data-testid=row-meta]")).toBeNull();
  });
});

describe("BranchLine", () => {
  it("shows the branch in the middle-ellipsis form, keeps the suffix whole, and puts the full text in the tooltip", () => {
    const long = "feature/a-very-long-branch-name-for-the-sidebar";
    render(<BranchLine branch={long} suffix="main에서" title={`${long}\nmain`} />);
    const name = screen.getByText((text) => text.includes("…"));
    expect(name.textContent!.length).toBeLessThan(long.length);
    expect(name.textContent!.startsWith("feature/")).toBe(true);
    expect(screen.getByText(/main에서/)).toBeInTheDocument();
    expect(name.parentElement).toHaveAttribute("title", `${long}\nmain`);
  });

  it("renders nothing without a branch or suffix", () => {
    const { container } = render(<BranchLine branch={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("tree guide lines", () => {
  it("sit under the chevron of the ancestor row, one indent apart", () => {
    // ▾ 칸은 행 왼쪽 여백 6px에서 -3px 당겨진 16px 칸이라 가운데가 11px이다.
    expect(guideLineLeft(0) + 0.5).toBe(11);
    expect(guideLineLeft(2) - guideLineLeft(1)).toBe(INDENT_PX);
  });
});

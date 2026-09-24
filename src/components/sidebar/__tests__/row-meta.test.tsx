// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "@/i18n/config";
import { formatAgo, liveDotLabel, META_ORDER, metaLineParts, metaLineText, syncText } from "../row-meta";
import { RowSubline } from "../RowSubline";
import { guideLineLeft, INDENT_PX } from "../TreeRowFrame";

afterEach(cleanup);

const en = i18n.getFixedT("en");
const ko = i18n.getFixedT("ko");

describe("metaLineParts", () => {
  it("puts words on the numbers, in the fixed order modified → new commits → ahead/behind", () => {
    const parts = metaLineParts({ behind: 1, newCommits: 2, dirty: 3, ahead: 4 }, en);
    expect(parts.map((p) => p.kind)).toEqual(["modified", "newCommits", "sync"]);
    expect(metaLineText(parts)).toBe("3 modified · 2 new commits · ↑4 ↓1");
    expect(metaLineText(metaLineParts({ dirty: 3, newCommits: 2, ahead: 4, behind: 1 }, ko))).toBe(
      "수정 3 · 새 커밋 2 · ↑4 ↓1",
    );
  });

  it("omits zero values and says clean when everything is zero", () => {
    expect(metaLineParts({}, ko)).toEqual([{ kind: "clean", text: "깨끗함" }]);
    expect(metaLineParts({ newCommits: 1 }, en)).toEqual([{ kind: "newCommits", text: "1 new commit" }]);
    expect(metaLineText(metaLineParts({ behind: 2 }, ko))).toBe("↓2");
  });

  it("starts workspace rows with the repository count", () => {
    expect(metaLineText(metaLineParts({ repoCount: 3, dirty: 2, newCommits: 5 }, ko))).toBe(
      "저장소 3 · 수정 2 · 새 커밋 5",
    );
    expect(metaLineText(metaLineParts({ repoCount: 2 }, ko))).toBe("저장소 2 · 깨끗함");
  });

  it("drops items from the end first: the display order ends with ↑↓, then new commits, then modified", () => {
    // 줄은 CSS 말줄임(끝에서부터 자름)이라, 잘리는 순서는 표시 순서를 거꾸로 한 것이다.
    const dropOrder = [...META_ORDER].reverse();
    expect(dropOrder.slice(0, 3)).toEqual(["sync", "newCommits", "modified"]);
    const parts = metaLineParts({ dirty: 1, newCommits: 1, ahead: 1 }, en);
    const positions = parts.map((p) => META_ORDER.indexOf(p.kind));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("formats ahead/behind without the zero side", () => {
    expect(syncText(2, 1)).toBe("↑2 ↓1");
    expect(syncText(0, 4)).toBe("↓4");
    expect(syncText(3, 0)).toBe("↑3");
  });
});

describe("live dot label", () => {
  it("says the files are changing now and how long ago", () => {
    expect(formatAgo(ko, 100_000, 88_000)).toBe("12초");
    expect(liveDotLabel(ko, true, 100_000, 88_000)).toBe("지금 파일이 바뀌는 중 · 12초 전");
    expect(liveDotLabel(en, true, 200_000, 20_000)).toBe("Files changing now · 3m ago");
    expect(liveDotLabel(en, false, 100_000, 88_000)).toMatch(/not watched live/);
  });
});

describe("RowSubline", () => {
  it("renders branch, then the parts in order in one truncating span; only new commits use the brand color", () => {
    const long = "feature/a-very-long-branch-name-for-the-sidebar";
    const parts = metaLineParts({ dirty: 14, newCommits: 3, ahead: 1 }, ko);
    const { container } = render(<RowSubline branch={long} parts={parts} />);
    const name = screen.getByText((text) => text.includes("…"));
    expect(name.textContent!.startsWith("feature/")).toBe(true);
    expect(name.textContent!.length).toBeLessThan(long.length);

    const meta = container.querySelector("[data-testid=row-meta]")!;
    expect(meta.className).toContain("truncate");
    expect([...meta.querySelectorAll("[data-meta]")].map((el) => el.getAttribute("data-meta"))).toEqual([
      "modified",
      "newCommits",
      "sync",
    ]);
    expect(meta.textContent).toBe(" · 수정 14 · 새 커밋 3 · ↑1");
    expect(container.innerHTML.match(/--acc/g)).toHaveLength(1);
    expect(meta.querySelector("[data-meta=newCommits] span:last-child")!.className).toContain("--acc");
  });

  it("renders nothing without a branch or parts", () => {
    const { container } = render(<RowSubline branch={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("tree guide lines", () => {
  it("sit under the chevron of the ancestor row, one indent apart", () => {
    // ▾ 칸은 행 왼쪽 여백 8px에서 -3px 당겨진 16px 칸이라 가운데가 13px이다.
    expect(guideLineLeft(0) + 0.5).toBe(13);
    expect(guideLineLeft(2) - guideLineLeft(1)).toBe(INDENT_PX);
  });
});

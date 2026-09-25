// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileFindRegex } from "../diff-find";
import { clearFindHighlights, documentRanges, paintFindHighlights, rangesIn, textNodesOf } from "../find-highlight";

function html(markup: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = markup;
  return el;
}

const re = (query: string) => compileFindRegex({ query, caseSensitive: false })!;

describe("rangesIn", () => {
  it("finds a match that crosses highlight tags", () => {
    // 라이브러리의 intra-line 강조처럼 한 단어가 여러 span으로 쪼개진 경우.
    const el = html('<span>con</span><span class="chg">st</span><span>ant x</span>');
    const ranges = rangesIn(textNodesOf(el), re("constant"));
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe("constant");
  });

  it("ends a match at the end of a node, not the start of the next", () => {
    const el = html("<span>ab</span><span>cd</span>");
    const [range] = rangesIn(textNodesOf(el), re("ab"));
    expect(range.endContainer).toBe(el.firstChild!.firstChild);
    expect(range.toString()).toBe("ab");
  });
});

describe("documentRanges", () => {
  it("does not join the end of one paragraph to the start of the next", () => {
    const el = html("<p>ends with foo</p><p>bar starts</p>");
    expect(documentRanges(el, re("foobar")).ranges).toHaveLength(0);
    expect(documentRanges(el, re("foo")).ranges).toHaveLength(1);
  });

  it("skips button labels", () => {
    const el = html("<p>moved text</p><button>moved</button>");
    expect(documentRanges(el, re("moved")).ranges).toHaveLength(1);
  });

  it("caps the count", () => {
    const el = html("<p>a a a a</p>");
    expect(documentRanges(el, re("a"), 2)).toMatchObject({ capped: true });
  });
});

describe("paintFindHighlights", () => {
  // jsdom에는 CSS Custom Highlight API가 없다. 이름 → 칠한 Range 목록만 기록한다.
  const registry = new Map<string, Range[]>();
  beforeEach(() => {
    registry.clear();
    vi.stubGlobal(
      "Highlight",
      class {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    vi.stubGlobal("CSS", {
      highlights: {
        set: (name: string, h: { ranges: Range[] }) => registry.set(name, h.ranges),
        delete: (name: string) => registry.delete(name),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps each viewer's highlights when two diff viewers are on screen", () => {
    // 나란히 보기(SideBySideDiff)처럼 뷰어가 둘이면 한쪽이 칠하거나 지워도 다른 쪽이 남아야 한다.
    const left = rangesIn(textNodesOf(html("<p>foo foo</p>")), re("foo"));
    const right = rangesIn(textNodesOf(html("<p>foo</p>")), re("foo"));
    const a = Symbol("left");
    const b = Symbol("right");

    paintFindHighlights(a, left, left[0]);
    paintFindHighlights(b, right, right[0]);
    expect(registry.get("diff-find")).toEqual([left[1]]);
    expect(registry.get("diff-find-current")).toEqual([left[0], right[0]]);

    clearFindHighlights(b);
    expect(registry.get("diff-find")).toEqual([left[1]]);
    expect(registry.get("diff-find-current")).toEqual([left[0]]);

    clearFindHighlights(a);
    expect(registry.has("diff-find")).toBe(false);
    expect(registry.has("diff-find-current")).toBe(false);
  });
});

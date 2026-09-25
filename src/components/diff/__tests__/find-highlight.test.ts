// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { compileFindRegex } from "../diff-find";
import { documentRanges, rangesIn, textNodesOf } from "../find-highlight";

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

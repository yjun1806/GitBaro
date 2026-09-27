// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRevealSelectedWhenNarrow } from "../pane-state";

afterEach(cleanup);

function List({ narrow, selected }: { narrow: boolean; selected: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useRevealSelectedWhenNarrow(narrow, ref, selected);
  return (
    <div ref={ref}>
      <button data-commit-id="c1">one</button>
      <button data-commit-id="c2">two</button>
    </div>
  );
}

describe("useRevealSelectedWhenNarrow (D47 2단계 좁은 목록)", () => {
  it("scrolls the picked row into view once the list turns narrow, without smooth scrolling under reduced motion", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { rerender } = render(<List narrow={false} selected="c2" />);
    await new Promise((r) => requestAnimationFrame(r));
    expect(scroll).not.toHaveBeenCalled();

    rerender(<List narrow selected="c2" />);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    expect(scroll.mock.contexts[0]).toHaveProperty("dataset.commitId", "c2");
  });
});

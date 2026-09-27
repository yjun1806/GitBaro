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
  it("scrolls the picked row into view once, right away, after the width transition ends", () => {
    vi.useFakeTimers();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    try {
      render(<List narrow selected="c2" />);
      vi.advanceTimersByTime(179);
      expect(scroll).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("scrolls without waiting under reduced motion, and not before the list is narrow", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { rerender } = render(<List narrow={false} selected="c2" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(scroll).not.toHaveBeenCalled();

    rerender(<List narrow selected="c2" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    expect(scroll.mock.contexts[0]).toHaveProperty("dataset.commitId", "c2");
  });
});

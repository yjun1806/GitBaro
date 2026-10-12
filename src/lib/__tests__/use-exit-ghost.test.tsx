// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useExitGhost, useExitGhostRef } from "../use-exit-ghost";

function Panel({ open }: { open: boolean }) {
  return <div data-testid="host">{open && <Inner />}</div>;
}
function Inner() {
  const ref = useRef<HTMLDivElement>(null);
  useExitGhost(ref, "exit-pop");
  return (
    <div ref={ref} id="panel" role="menu">
      <button id="item">Item</button>
    </div>
  );
}
function Conditional({ open }: { open: boolean }) {
  const ghostRef = useExitGhostRef("exit-tooltip");
  return <div data-testid="host">{open && <span ref={ghostRef} id="tip">Tip</span>}</div>;
}

function mockMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia;
}

describe("useExitGhost", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // @ts-expect-error restore jsdom default (no matchMedia)
    delete window.matchMedia;
  });

  it("leaves an inert, id-free copy with the exit class when the element unmounts, then removes it", () => {
    mockMotion(false);
    const { getByTestId, rerender } = render(<Panel open />);
    rerender(<Panel open={false} />);
    const ghost = getByTestId("host").querySelector("[data-exit-ghost]") as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.classList.contains("exit-pop")).toBe(true);
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.inert).toBe(true);
    expect(ghost.querySelector("[id]")).toBeNull();
    expect(ghost.id).toBe("");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getByTestId("host").querySelector("[data-exit-ghost]")).toBeNull();
  });

  it("makes no copy when reduced motion is on or there is no media query support", () => {
    mockMotion(true);
    const reduced = render(<Panel open />);
    reduced.rerender(<Panel open={false} />);
    expect(reduced.container.querySelector("[data-exit-ghost]")).toBeNull();
    reduced.unmount();

    // @ts-expect-error no matchMedia, like jsdom
    delete window.matchMedia;
    const bare = render(<Panel open />);
    bare.rerender(<Panel open={false} />);
    expect(bare.container.querySelector("[data-exit-ghost]")).toBeNull();
  });

  it("makes no copy when the whole tree goes away", () => {
    mockMotion(false);
    const { container, unmount } = render(<Panel open />);
    unmount();
    expect(container.querySelector("[data-exit-ghost]")).toBeNull();
  });

  it("works for a conditionally rendered element through the callback ref", async () => {
    mockMotion(false);
    const { getByTestId, rerender } = render(<Conditional open />);
    rerender(<Conditional open={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    const ghost = getByTestId("host").querySelector("[data-exit-ghost]") as HTMLElement;
    expect(ghost.classList.contains("exit-tooltip")).toBe(true);
    expect(ghost.id).toBe("");
  });
});

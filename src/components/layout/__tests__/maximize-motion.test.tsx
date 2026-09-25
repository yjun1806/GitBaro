// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { ListDiffSplit } from "../ListDiffSplit";
import { GraphSplit } from "../GraphSplit";

interface FakeAnimation {
  keyframes: Keyframe[];
  onfinish: (() => void) | null;
  cancel: () => void;
}

let animations: FakeAnimation[] = [];
let reduce = false;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  animations = [];
  reduce = false;
  useUIStore.setState({ isDiffMaximized: false, graphPanelRatio: 0.5 });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("reduced-motion") && reduce,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Element.prototype.animate = vi.fn(function (keyframes: Keyframe[]) {
    const animation: FakeAnimation = { keyframes, onfinish: null, cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
});
afterEach(() => {
  cleanup();
  delete (Element.prototype as Partial<Element>).animate;
});

function Screen() {
  return (
    <GraphSplit top={<div>graph</div>} bottom={<ListDiffSplit variant="cards" list={<div>list</div>} detail={<div>diff</div>} />} />
  );
}

describe("diff maximize motion", () => {
  it("lets the list and graph float out of the layout and fade before hiding", () => {
    render(<Screen />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    const list = screen.getByTestId("list-pane");
    const graph = screen.getByTestId("graph-pane");
    // 떠 있는 동안은 배치에서 빠져 diff가 곧바로 새 크기를 갖는다.
    expect(list.className).toContain("absolute");
    expect(list.classList.contains("hidden")).toBe(false);
    expect(graph.className).toContain("absolute");
    // diff 칸은 옛 자리에서 옮겨 온다(크기는 바꾸지 않는 transform·clip-path).
    const detailMove = animations.find((a) => a.keyframes.some((k) => "clipPath" in k));
    expect(detailMove).toBeDefined();
    expect(detailMove!.keyframes.every((k) => !("width" in k) && !("height" in k))).toBe(true);
    const fades = animations.filter((a) => a.keyframes[0].opacity === 1);
    expect(fades).toHaveLength(2);
    act(() => fades.forEach((a) => a.onfinish?.()));
    expect(list.classList.contains("hidden")).toBe(true);
    expect(graph.classList.contains("hidden")).toBe(true);
  });

  it("fades the panels back in on restore", () => {
    render(<Screen />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    act(() => animations.forEach((a) => a.onfinish?.()));
    animations = [];
    act(() => useUIStore.getState().setDiffMaximized(false));
    expect(screen.getByTestId("list-pane").classList.contains("hidden")).toBe(false);
    expect(animations.filter((a) => a.keyframes[0].opacity === 0)).toHaveLength(2);
  });

  it("does not move at all under reduced motion", () => {
    reduce = true;
    render(<Screen />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    expect(animations).toHaveLength(0);
    expect(screen.getByTestId("list-pane").classList.contains("hidden")).toBe(true);
    expect(screen.getByTestId("graph-pane").classList.contains("hidden")).toBe(true);
  });
});

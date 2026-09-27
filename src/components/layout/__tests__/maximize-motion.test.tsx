// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/config";
import { useUIStore } from "@/stores/ui";
import { ListDiffSplit } from "../ListDiffSplit";
import { PaneStrip } from "../PaneStrip";

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
  useUIStore.setState({ isDiffMaximized: false, diffFileOpen: false });
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
    <PaneStrip
      graph={<div>graph</div>}
      hasSelection
      bottom={<ListDiffSplit variant="cards" list={<div>list</div>} detail={<div>diff</div>} />}
    />
  );
}

describe("diff maximize motion (5.4: one moving edge)", () => {
  it("moves only the diff pane edge; the list just fades where it stands, without sliding", () => {
    render(<Screen />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    const list = screen.getByTestId("list-pane");
    // 떠 있는 동안은 배치에서 빠져 diff가 곧바로 새 크기를 갖는다.
    expect(list.className).toContain("absolute");
    // diff 칸은 옛 자리에서 옮겨 온다(크기는 바꾸지 않는 transform·clip-path), 칸 전환과 같은 180ms.
    const detailMove = animations.find((a) => a.keyframes.some((k) => "clipPath" in k));
    expect(detailMove).toBeDefined();
    // 목록은 투명도만 바뀐다 — transform으로 밀리지 않는다.
    const fades = animations.filter((a) => a.keyframes[0].opacity === 1);
    expect(fades).toHaveLength(1);
    expect(fades[0].keyframes.every((k) => !("transform" in k))).toBe(true);
    act(() => fades.forEach((a) => a.onfinish?.()));
    expect(list.classList.contains("hidden")).toBe(true);
    // 그래프 칸은 폭 전환 없이 곧바로 0이 된다(diff의 FLIP과 두 움직임이 겹치지 않게).
    const graph = screen.getByTestId("graph-pane");
    expect(graph.style.width).toBe("0px");
    expect(graph.className).not.toContain("pane-w");
  });

  it("fades the list back in on restore, opacity only", () => {
    render(<Screen />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    act(() => animations.forEach((a) => a.onfinish?.()));
    animations = [];
    act(() => useUIStore.getState().setDiffMaximized(false));
    expect(screen.getByTestId("list-pane").classList.contains("hidden")).toBe(false);
    const fadeIns = animations.filter((a) => a.keyframes[0].opacity === 0);
    expect(fadeIns).toHaveLength(1);
    expect(fadeIns[0].keyframes.every((k) => !("transform" in k))).toBe(true);
  });

  it("does not move at all under reduced motion", () => {
    reduce = true;
    render(<Screen />);
    act(() => useUIStore.getState().setDiffMaximized(true));
    expect(animations).toHaveLength(0);
    expect(screen.getByTestId("list-pane").classList.contains("hidden")).toBe(true);
  });
});

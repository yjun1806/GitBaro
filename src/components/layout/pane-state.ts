import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { create } from "zustand";
import { useUIStore } from "@/stores/ui";
import { PANE_MS } from "./maximize-motion";

/**
 * 옆으로 쌓는 칸(D47, `PaneStrip`)의 화면 상태. 저장하지 않는다.
 * - `graphExpanded`: 2단계(파일을 연 뒤)에서 「그래프 펼치기」를 눌러 1단계 폭으로 돌아간 상태. 파일을
 *   다시 고르거나(`ListDiffSplit`) 고른 행이 없어지면 풀린다.
 */
interface PaneState {
  graphExpanded: boolean;
  setGraphExpanded: (expanded: boolean) => void;
  /**
   * 지금 열린 diff를 닫는 함수들(나중에 연 것이 맨 뒤). `ListDiffSplit`이 파일을 열었고 닫는 법을 받았을
   * 때 올리고, 닫거나 사라지면 내린다. Esc가 맨 뒤의 것을 부른다(`useDiffEscape`).
   */
  diffClosers: readonly (() => void)[];
  pushDiffCloser: (close: () => void) => void;
  removeDiffCloser: (close: () => void) => void;
}

export const usePaneStore = create<PaneState>()((set) => ({
  graphExpanded: false,
  setGraphExpanded: (expanded) => set({ graphExpanded: expanded }),
  diffClosers: [],
  pushDiffCloser: (close) => set((state) => ({ diffClosers: [...state.diffClosers, close] })),
  removeDiffCloser: (close) => set((state) => ({ diffClosers: state.diffClosers.filter((c) => c !== close) })),
}));

/** 그래프 칸이 2단계의 좁은 커밋 목록인지. `PaneStrip`이 그래프 칸에 내려 준다. */
export const GraphNarrowContext = createContext(false);

export function useGraphNarrow(): boolean {
  return useContext(GraphNarrowContext);
}

/**
 * 커밋을 바꿔 상세를 다시 읽는 동안 쓴다. 바로 앞 상세가 파일을 연 상태(2단계)였으면 그 상태를 이어서
 * 알려, 좁은 커밋 목록에서 다른 커밋을 누를 때 읽는 동안 1단계로 튀었다 돌아오지 않게 한다. 앞 상세의
 * `ListDiffSplit`이 사라지며 끈 값을 같은 차례에 다시 켠다 — 새 상세가 뜨면 그쪽이 다시 알린다.
 */
export function useHoldDiffFileOpen(): void {
  const [wasOpen] = useState(() => useUIStore.getState().diffFileOpen);
  const setDiffFileOpen = useUIStore((s) => s.setDiffFileOpen);
  useEffect(() => {
    if (wasOpen) setDiffFileOpen(true);
  }, [wasOpen, setDiffFileOpen]);
}

/**
 * 좁은 커밋 목록(2단계)으로 들어오면 고른 줄이 보이게 스크롤한다. 폭 전환(`PANE_MS`)이 끝나 칸 폭이
 * 자리 잡은 뒤에 한 번, 부드럽게 굴리지 않고 곧바로 옮긴다 — 폭과 스크롤이 함께 움직이지 않게(5.4).
 * 동작 줄이기에서는 기다리지도 않는다. 화살표로 옮길 때는 목록의 키보드 이동(`useListKeyboardNav`)이
 * 이미 고른 줄을 보이게 한다.
 */
export function useRevealSelectedWhenNarrow(
  narrow: boolean,
  container: RefObject<HTMLElement | null>,
  selectedId: string | null,
): void {
  useEffect(() => {
    if (!narrow || selectedId === null) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => {
      const rows = container.current?.querySelectorAll<HTMLElement>("[data-commit-id]") ?? [];
      const row = [...rows].find((el) => el.dataset.commitId === selectedId);
      if (!row || typeof row.scrollIntoView !== "function") return;
      row.scrollIntoView({ block: "center", behavior: "auto" });
    }, reduce ? 0 : PANE_MS);
    return () => clearTimeout(timer);
  }, [narrow, container, selectedId]);
}

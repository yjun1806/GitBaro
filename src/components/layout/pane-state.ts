import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { create } from "zustand";
import { useUIStore } from "@/stores/ui";

/**
 * 옆으로 쌓는 칸(D47, `PaneStrip`)의 화면 상태. 저장하지 않는다.
 * - `graphExpanded`: 2단계(파일을 연 뒤)에서 「그래프 펼치기」를 눌러 1단계 폭으로 돌아간 상태. 파일을
 *   다시 고르거나(`ListDiffSplit`) 고른 행이 없어지면 풀린다.
 */
interface PaneState {
  graphExpanded: boolean;
  setGraphExpanded: (expanded: boolean) => void;
}

export const usePaneStore = create<PaneState>()((set) => ({
  graphExpanded: false,
  setGraphExpanded: (expanded) => set({ graphExpanded: expanded }),
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
 * 좁은 커밋 목록(2단계)으로 들어오면 고른 줄이 보이게 스크롤한다. 전환이 끝난 뒤 폭이 자리 잡은 다음에
 * 재도록 한 프레임 늦춘다. 동작 줄이기 설정이면 부드럽게 굴리지 않는다. 화살표로 옮길 때는 목록의
 * 키보드 이동(`useListKeyboardNav`)이 이미 고른 줄을 보이게 한다.
 */
export function useRevealSelectedWhenNarrow(
  narrow: boolean,
  container: RefObject<HTMLElement | null>,
  selectedId: string | null,
): void {
  useEffect(() => {
    if (!narrow || selectedId === null) return;
    const frame = requestAnimationFrame(() => {
      const rows = container.current?.querySelectorAll<HTMLElement>("[data-commit-id]") ?? [];
      const row = [...rows].find((el) => el.dataset.commitId === selectedId);
      if (!row || typeof row.scrollIntoView !== "function") return;
      const smooth = typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [narrow, container, selectedId]);
}

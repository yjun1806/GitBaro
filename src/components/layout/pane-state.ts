import { createContext, useContext, useEffect, useState } from "react";
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

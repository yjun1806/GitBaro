import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { DEFAULT_GRAPH_RATIO, graphRatioAfterDrag } from "@/lib/split-size";
import { cn } from "@/lib/utils";
import { SplitHandle } from "./SplitHandle";
import { usePaneExit } from "./maximize-motion";

/** 크게 보기로 숨을 때 그래프가 밀려 나가는 쪽. */
const GRAPH_EXIT = { x: 0, y: -12 };

export interface GraphSplitProps {
  /** 위 칸(그래프 패널). */
  top: ReactNode;
  /** 아래 칸(파일 목록과 diff). */
  bottom: ReactNode;
  /**
   * 위 칸이 탭 머리만 남은 상태. 이때는 높이를 나누지 않고 머리 높이만 쓴다.
   */
  topCollapsed?: boolean;
}

/**
 * 그래프 패널 ↕ 아래 칸. 둘 사이 8px 간격이 손잡이다. 비율은 `ui.graphPanelRatio`에 저장하고,
 * 저장소 화면과 워크스페이스 화면이 같은 값을 쓴다. diff를 크게 보는 중이면 위 칸을 숨긴다.
 */
export function GraphSplit({ top, bottom, topCollapsed = false }: GraphSplitProps) {
  const { t } = useTranslation();
  const ratio = useUIStore((s) => s.graphPanelRatio);
  const setRatio = useUIStore((s) => s.setGraphPanelRatio);
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const startRatio = useRef(ratio);
  // 숨기 직전 잠깐은 배치에서 빠진 채 제자리에 떠서 흐려진다(`usePaneExit`).
  const leaving = usePaneExit(topRef, maximized, GRAPH_EXIT);

  // 위 칸은 늘 같은 자리에 마운트해 둔다. 접거나 숨길 때 다시 마운트되면 그래프 패널이 제 화면
  // 상태(열린 탭 등)를 잃는다. diff를 크게 보는 동안에는 숨기기만 한다.
  const split = !topCollapsed && !maximized;
  const sized = !topCollapsed && (!maximized || leaving);
  return (
    <div ref={containerRef} className={cn("relative flex flex-col flex-1 min-h-0", topCollapsed && !maximized && "gap-(--g)")}>
      <div
        ref={topRef}
        className={cn(
          "flex flex-col shrink-0",
          sized && "min-h-[120px]",
          leaving && "absolute inset-x-0 top-0 pointer-events-none",
          maximized && !leaving && "hidden",
        )}
        style={sized ? { height: `${ratio * 100}%` } : undefined}
        aria-hidden={maximized || undefined}
        data-testid="graph-pane"
      >
        {top}
      </div>
      {split && (
        <SplitHandle
          orientation="horizontal"
          aria-label={t("layout.resizeGraph")}
          onDragStart={() => {
            startRatio.current = ratio;
          }}
          onDrag={(delta) =>
            setRatio(graphRatioAfterDrag(startRatio.current, delta, containerRef.current?.clientHeight ?? 0))
          }
          onReset={() => setRatio(DEFAULT_GRAPH_RATIO)}
        />
      )}
      <div className={cn("flex flex-col flex-1 min-h-0", split && "min-h-[120px]")}>{bottom}</div>
    </div>
  );
}

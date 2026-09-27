import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import {
  GRAPH_LEVEL1_RATIO,
  GRAPH_NARROW_WIDTH,
  MIN_DIFF_PANE_WIDTH,
  MIN_FILE_LIST_SQUEEZED_WIDTH,
} from "@/lib/split-size";
import { canAnimate } from "./maximize-motion";
import { GraphNarrowContext, usePaneStore } from "./pane-state";

export interface PaneStripProps {
  /** 1단계 칸: 그래프 패널. 단계와 상관없이 늘 같은 자리에 마운트돼 있다(화면 상태를 잃지 않는다). */
  graph: ReactNode;
  /**
   * 행을 하나라도 골랐는가(D47 0단계 ↔ 1단계 경계). false면 그래프가 칸 전체를 쓰고 `bottom`은
   * 그리지 않는다. 무엇이 「고름」인지는 부르는 쪽이 정한다(커밋·WIP·스태시·Actions 실행 등).
   */
  hasSelection: boolean;
  /**
   * 2·3단계 칸(파일 목록 + diff, 보통 `ContentArea`가 감싼 `ListDiffSplit`). `hasSelection`일 때만
   * 그린다 — 파일을 열었는지(2단계)·크게 보는 중인지(3단계)는 `ListDiffSplit`이 `ui.diffFileOpen`·
   * `ui.isDiffMaximized`로 알린다(트리를 거슬러 prop을 내려보낼 길이 없어서 store로 잇는다).
   */
  bottom: ReactNode;
}

/** 폭 전환이 도는 동안(240ms) 매 프레임 다시 재지 않게 자식을 목표 폭으로 못박아 두는 시간(ms). */
const FREEZE_MS = 240;

function graphTargetWidth(level: 0 | 1 | 2 | 3, containerWidth: number): number {
  if (level === 0) return containerWidth;
  if (level === 1) return Math.round(containerWidth * GRAPH_LEVEL1_RATIO);
  if (level === 2) return GRAPH_NARROW_WIDTH;
  return 0;
}

/**
 * 그래프 ↔ 파일 목록 ↔ diff를 옆으로 쌓는 칸(D47, 5.4). 네 단계:
 * 0 아무것도 안 고름(그래프 전체) → 1 골랐지만 파일은 아직(그래프 46% + 상세) →
 * 2 파일까지 고름(좁은 커밋 목록 240px + 파일 목록 + diff. 창이 좁으면 파일 목록이 먼저 220px까지
 * 줄고, 그래도 모자라면 이 단계만 가로 스크롤. 좁은 목록에서 다른 커밋을 고르면 2단계 그대로 따라
 * 바뀌고, 목록 머리의 「그래프 펼치기」로 1단계 폭으로 돌아간다 — `usePaneStore.graphExpanded`) →
 * 3 크게 보기(그래프는 밀려 나가고 diff가 칸 전체, 파일 목록만 옆에 남는다). 칸은 `width`만
 * `--motion-pane`(240ms, 동작 줄이기에서 0)로 움직인다. `bottom`은 늘 마운트돼 있지 않다 —
 * 0단계에서 아예 없다가 나타날 때 `animate-content-in`으로 옅게 들어온다(폭을 늘리며 나타나지
 * 않는다 — 시안 `layout-explore.html`의 새로 뜨는 칸과 같다).
 */
export function PaneStrip({ graph, hasSelection, bottom }: PaneStripProps) {
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const fileOpen = useUIStore((s) => s.diffFileOpen);
  const graphExpanded = usePaneStore((s) => s.graphExpanded);
  const setGraphExpanded = usePaneStore((s) => s.setGraphExpanded);
  const level: 0 | 1 | 2 | 3 = !hasSelection ? 0 : maximized ? 3 : fileOpen && !graphExpanded ? 2 : 1;

  // 고른 행이 없어지면(0단계) 「그래프 펼치기」도 푼다 — 다음에 파일을 열면 다시 좁은 목록이 된다.
  useEffect(() => {
    if (!hasSelection && graphExpanded) setGraphExpanded(false);
  }, [hasSelection, graphExpanded, setGraphExpanded]);

  const rowRef = useRef<HTMLDivElement>(null);
  const graphInnerRef = useRef<HTMLDivElement>(null);
  const [sizing, setSizing] = useState(false);
  const [frozenWidth, setFrozenWidth] = useState(0);
  const prevLevel = useRef(level);

  // 그래프 안 커밋 줄의 칸 단계(3.15, `@container/graph`)가 폭이 바뀌는 240ms 동안 매 프레임
  // 다시 재지 않게, 전환이 시작되는 순간 목표 폭을 못박아 절대 배치한다. 240ms 뒤(또는 동작
  // 줄이기·테스트 환경처럼 애니메이션을 못 쓰면 곧바로) 풀어 다시 칸의 실제 폭을 따르게 한다.
  useLayoutEffect(() => {
    if (prevLevel.current === level) return;
    prevLevel.current = level;
    const row = rowRef.current;
    if (!row) return;
    setFrozenWidth(graphTargetWidth(level, row.clientWidth));
    if (!canAnimate(row)) return;
    setSizing(true);
    const timer = setTimeout(() => setSizing(false), FREEZE_MS);
    return () => clearTimeout(timer);
  }, [level]);

  return (
    <div
      ref={rowRef}
      className={cn("flex flex-1 min-h-0 gap-(--g)", level === 2 ? "overflow-x-auto" : "overflow-hidden")}
    >
      <div
        className={cn(
          "relative h-full shrink-0 pane-w",
          level === 2 && "sticky left-0 z-[1] bg-(--canvas)",
        )}
        style={{ width: level === 0 ? "100%" : level === 1 ? `${GRAPH_LEVEL1_RATIO * 100}%` : level === 2 ? GRAPH_NARROW_WIDTH : 0 }}
        data-testid="graph-pane"
        data-pane-level={level}
      >
        <div
          ref={graphInnerRef}
          className={cn("h-full", sizing && "absolute inset-y-0 left-0")}
          style={sizing ? { width: frozenWidth } : { width: "100%" }}
        >
          <GraphNarrowContext.Provider value={level === 2}>{graph}</GraphNarrowContext.Provider>
        </div>
      </div>
      {hasSelection && (
        <div
          className="flex flex-1 min-w-0 min-h-0 animate-content-in"
          // 2단계: 파일 목록(줄어들어 220) + 손잡이 간격 + diff(424)보다 좁아지지 않는다 — 더 좁으면 가로 스크롤.
          style={level === 2 ? { minWidth: MIN_FILE_LIST_SQUEEZED_WIDTH + MIN_DIFF_PANE_WIDTH + 8 } : undefined}
          data-testid="pane-strip-bottom"
        >
          {bottom}
        </div>
      )}
    </div>
  );
}

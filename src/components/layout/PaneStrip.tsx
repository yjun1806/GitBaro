import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import {
  GRAPH_LEVEL1_RATIO,
  GRAPH_NARROW_WIDTH,
  MIN_DIFF_PANE_WIDTH,
  MIN_FILE_LIST_SQUEEZED_WIDTH,
  MIN_PANE_DETAIL_WIDTH,
  MIN_PANE_GRAPH_WIDTH,
} from "@/lib/split-size";
import { canAnimate } from "./maximize-motion";
import { GraphNarrowContext, usePaneStore } from "./pane-state";
import { SplitHandle } from "./SplitHandle";

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

/** 칸 사이 간격이자 손잡이 두께(px, `--g`). */
const GAP = 8;

/** 옆 칸이 지켜야 할 최소 폭: 파일을 열었으면(2단계, 또는 펼친 1단계) 파일 목록 220 + 간격 + diff 424. */
function detailMinWidth(fileOpen: boolean): number {
  return fileOpen ? MIN_FILE_LIST_SQUEEZED_WIDTH + GAP + MIN_DIFF_PANE_WIDTH : MIN_PANE_DETAIL_WIDTH;
}

/**
 * 1단계 그래프 칸의 화면 폭. 저장한 비율을 쓰되 그래프 400px·옆 칸 최소 폭을 지킨다. 창이 좁아 둘 다
 * 못 지키면 옆 칸이 먼저다. 저장값은 건드리지 않는다(창을 다시 넓히면 원래 비율로 돌아온다).
 */
function level1GraphStyle(ratio: number, fileOpen: boolean): CSSProperties {
  const rest = detailMinWidth(fileOpen) + GAP;
  return {
    width: `${Math.round(ratio * 1000) / 10}%`,
    minWidth: `min(${MIN_PANE_GRAPH_WIDTH}px, calc(100% - ${rest}px))`,
    maxWidth: `calc(100% - ${rest}px)`,
  };
}

function graphTargetWidth(
  level: 0 | 1 | 2 | 3,
  containerWidth: number,
  ratio: number,
  narrowWidth: number,
  fileOpen: boolean,
): number {
  if (level === 0) return containerWidth;
  if (level === 1) {
    const max = containerWidth - detailMinWidth(fileOpen) - GAP;
    return Math.max(0, Math.round(Math.min(max, Math.max(Math.min(MIN_PANE_GRAPH_WIDTH, max), containerWidth * ratio))));
  }
  if (level === 2) return narrowWidth;
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
 *
 * 1·2단계에서는 그래프 칸과 옆 칸 사이 간격이 손잡이(`SplitHandle`)다. 1단계는 그래프 비율
 * (`ui.paneGraphRatio`, 기본 46%), 2단계는 좁은 목록 폭(`ui.narrowListWidth`, 180~400px)을 바꿔 저장하고,
 * 두 번 누르면(또는 Enter) 기본값으로 돌아간다. 끄는 동안에는 폭 전환 애니메이션을 끈다.
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

  const { t } = useTranslation();
  const ratio = useUIStore((s) => s.paneGraphRatio);
  const setRatio = useUIStore((s) => s.setPaneGraphRatio);
  const narrowWidth = useUIStore((s) => s.narrowListWidth);
  const setNarrowWidth = useUIStore((s) => s.setNarrowListWidth);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ ratio, narrowWidth, graphPx: 0, rowPx: 0 });

  const rowRef = useRef<HTMLDivElement>(null);
  const graphPaneRef = useRef<HTMLDivElement>(null);
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
    setFrozenWidth(graphTargetWidth(level, row.clientWidth, ratio, narrowWidth, fileOpen));
    if (!canAnimate(row)) return;
    setSizing(true);
    const timer = setTimeout(() => setSizing(false), FREEZE_MS);
    return () => clearTimeout(timer);
    // 단계가 바뀔 때만 잰다 — 손잡이로 끄는 동안에는 칸의 실제 폭을 그대로 따른다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const handleDragStart = () => {
    dragStart.current = {
      ratio,
      narrowWidth,
      graphPx: graphPaneRef.current?.getBoundingClientRect().width ?? 0,
      rowPx: rowRef.current?.clientWidth ?? 0,
    };
    setSizing(false);
    setDragging(true);
  };
  const handleDrag = (delta: number) => {
    const start = dragStart.current;
    if (level === 2) {
      setNarrowWidth(start.narrowWidth + delta);
    } else if (start.rowPx > 0) {
      // 화면에 보이던 폭(최소 폭으로 맞춰졌을 수 있다)에서 출발해 비율로 바꿔 저장한다.
      setRatio((start.graphPx + delta) / start.rowPx);
    }
  };
  const handleReset = () => {
    if (level === 2) setNarrowWidth(GRAPH_NARROW_WIDTH);
    else setRatio(GRAPH_LEVEL1_RATIO);
  };

  const graphStyle: CSSProperties =
    level === 0 ? { width: "100%" } : level === 1 ? level1GraphStyle(ratio, fileOpen) : level === 2 ? { width: narrowWidth } : { width: 0 };
  const resizable = level === 1 || level === 2;

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex flex-1 min-h-0",
        !resizable && "gap-(--g)",
        level === 2 ? "overflow-x-auto" : "overflow-hidden",
      )}
      data-dragging={dragging || undefined}
    >
      <div
        ref={graphPaneRef}
        className={cn(
          "relative h-full shrink-0",
          // 끄는 동안에는 폭 전환 애니메이션을 끈다 — 포인터를 곧바로 따라가야 한다.
          !dragging && "pane-w",
          level === 2 && "sticky left-0 z-[1] bg-(--canvas)",
        )}
        style={graphStyle}
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
      {resizable && (
        <SplitHandle
          orientation="vertical"
          aria-label={t("layout.resizeGraphPane")}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={() => setDragging(false)}
          onReset={handleReset}
        />
      )}
      {hasSelection && (
        <div
          className="flex flex-1 min-w-0 min-h-0 animate-content-in"
          // 2단계: 파일 목록(줄어들어 220) + 손잡이 간격 + diff(424)보다 좁아지지 않는다 — 더 좁으면 가로 스크롤.
          style={level === 2 ? { minWidth: MIN_FILE_LIST_SQUEEZED_WIDTH + MIN_DIFF_PANE_WIDTH + GAP } : undefined}
          data-testid="pane-strip-bottom"
        >
          {bottom}
        </div>
      )}
    </div>
  );
}

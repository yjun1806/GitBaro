import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { GRAPH_FOLDED_WIDTH, GRAPH_LEVEL1_RATIO } from "@/lib/split-size";
import { canAnimate } from "./maximize-motion";

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
  /**
   * 2단계의 접힌 그래프 칸을 누르면 부른다. 파일 하나만 닫고 커밋은 남기는 세밀한 되돌리기는
   * 각 상세 화면(`CommitDetail` 등)이 파일 선택을 안에 갇힌 상태로 들고 있어 밖에서 못 하므로,
   * 이 자리는 늘 0단계(고른 행 자체를 지움)로 되돌린다 — 부르는 쪽이 지금 탭에 맞게 고른 것을 지운다.
   */
  onExpandGraph: () => void;
}

/** 폭 전환이 도는 동안(240ms) 매 프레임 다시 재지 않게 자식을 목표 폭으로 못박아 두는 시간(ms). */
const FREEZE_MS = 240;

function graphTargetWidth(level: 0 | 1 | 2 | 3, containerWidth: number): number {
  if (level === 0) return containerWidth;
  if (level === 1) return Math.round(containerWidth * GRAPH_LEVEL1_RATIO);
  if (level === 2) return GRAPH_FOLDED_WIDTH;
  return 0;
}

/**
 * 그래프 ↔ 파일 목록 ↔ diff를 옆으로 쌓는 칸(D47, 5.4). 네 단계:
 * 0 아무것도 안 고름(그래프 전체) → 1 골랐지만 파일은 아직(그래프 46% + 상세) →
 * 2 파일까지 고름(접힌 그래프 120px + 목록 + diff, 폭이 모자라면 이 단계만 가로 스크롤) →
 * 3 크게 보기(그래프는 밀려 나가고 diff가 칸 전체, 파일 목록만 옆에 남는다). 칸은 `width`만
 * `--motion-pane`(240ms, 동작 줄이기에서 0)로 움직인다. `bottom`은 늘 마운트돼 있지 않다 —
 * 0단계에서 아예 없다가 나타날 때 `animate-content-in`으로 옅게 들어온다(폭을 늘리며 나타나지
 * 않는다 — 시안 `layout-explore.html`의 새로 뜨는 칸과 같다).
 */
export function PaneStrip({ graph, hasSelection, bottom, onExpandGraph }: PaneStripProps) {
  const { t } = useTranslation();
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const fileOpen = useUIStore((s) => s.diffFileOpen);
  const level: 0 | 1 | 2 | 3 = !hasSelection ? 0 : maximized ? 3 : fileOpen ? 2 : 1;

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
        style={{ width: level === 0 ? "100%" : level === 1 ? `${GRAPH_LEVEL1_RATIO * 100}%` : level === 2 ? GRAPH_FOLDED_WIDTH : 0 }}
        data-testid="graph-pane"
        data-pane-level={level}
      >
        <div
          ref={graphInnerRef}
          className={cn("h-full", sizing && "absolute inset-y-0 left-0")}
          style={sizing ? { width: frozenWidth } : { width: "100%" }}
          // 2단계에서는 뒤로 눌러 접기·펼치기를 오갈 수 있는 칸이라 탭 순서에서 잠시 뺀다.
          inert={level === 2 ? true : undefined}
        >
          {graph}
        </div>
        {level === 2 && (
          <button
            type="button"
            onClick={onExpandGraph}
            aria-label={t("layout.expandGraph")}
            title={t("layout.expandGraph")}
            className="absolute inset-0 flex items-center justify-center [writing-mode:vertical-rl] text-[12.5px] font-semibold text-(--fg2) bg-card hover:bg-accent hover:text-foreground transition-colors motion-reduce:transition-none tracking-[0.04em]"
          >
            {t("layout.graphFolded")}
          </button>
        )}
      </div>
      {hasSelection && (
        <div className="flex flex-1 min-w-0 min-h-0 animate-content-in" data-testid="pane-strip-bottom">
          {bottom}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { DEFAULT_FILE_LIST_WIDTH, LEVEL1_DETAIL_MIN_WIDTH, MIN_DIFF_PANE_WIDTH } from "@/lib/split-size";
import { cn } from "@/lib/utils";
import { PANEL_SURFACE } from "@/components/ui/layers";
import { SplitHandle } from "./SplitHandle";
import { useMaximizeFlip, usePaneExit } from "./maximize-motion";
import { usePaneStore } from "./pane-state";
import {
  MaximizedFilesContext,
  MaximizedOriginContext,
  splitFilePath,
  type MaximizedFiles,
  type MaximizedOrigin,
} from "./maximized-files";
import { MaximizedFileList, MaximizedFileListBand } from "./MaximizedFileList";
import { MaximizedOriginHeader } from "./MaximizedOriginHeader";

export interface ListDiffSplitProps {
  /** 왼쪽 칸(파일 목록, 커밋 정보, 스테이징 목록). */
  list: ReactNode;
  /** 오른쪽 칸(diff). */
  detail: ReactNode;
  /**
   * `cards`: 두 칸이 따로 떠 있는 카드이고 사이 8px 간격이 손잡이다.
   * `inline`: 한 카드 안을 1px 선으로 나눈다.
   */
  variant: "cards" | "inline";
  /** 칸마다 덧붙일 것(전환 덮개 등). */
  listOverlay?: ReactNode;
  detailOverlay?: ReactNode;
  /**
   * diff를 크게 보는 동안 diff 왼쪽에 둘 좁은 파일 목록. `list` 칸이 보여 주는 목록의 데이터와 선택을
   * 그대로 넘긴다. 없으면 크게 보기에서 목록 없이 diff만 보인다.
   */
  files?: MaximizedFiles;
  /**
   * 크게 보는 동안 diff 카드 맨 위에 둘 「어디서 왔는지」 머리 줄. 없으면 머리 줄을 그리지 않는다
   * (지금과 같다).
   */
  origin?: MaximizedOrigin;
  /** 바깥 틀에 붙일 것(나란히 보기처럼 위에 뜨는 것). */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
  /**
   * 파일을 안 골랐어도(`files.selectedKey === null`) diff 칸을 접지 않는다(D47/5.4의 1단계를 안 쓴다).
   * PR 상세처럼 파일을 고르기 전 diff 자리에 EmptyState가 아니라 다른 내용(PR 개요)이 늘 있는
   * 화면만 켠다.
   */
  detailAlwaysOpen?: boolean;
}

// `Card`(ui/Card.tsx)와 같은 카드 겉모습(D27). `ListPane`은 `section`/`div`를 골라 쓰고 ref·aria
// 속성을 그대로 넘겨야 해서 `Card` 컴포넌트 대신 그 겉모습의 근원인 `PANEL_SURFACE`를 쓴다.
const CARD = cn("flex flex-col min-h-0 overflow-hidden", PANEL_SURFACE);
/** 카드 모서리(`--radius-panel`). 커지는 움직임의 잘라내기 모서리에 쓴다. */
const CARD_RADIUS = 14;
/** 크게 보기로 숨을 때 목록이 밀려 나가는 쪽. */
const LIST_EXIT = { x: -12, y: 0 };

/**
 * 파일 목록 ↔ diff 두 칸(D47/5.4의 2·3단계). 파일을 아직 안 골랐으면(`files.selectedKey === null`,
 * 1단계) 목록만 칸 전체를 쓰고 diff 칸은 없다 — `files`를 안 주는 화면(올릴 내용 합쳐 보기, 파일별
 * 보기)은 이 신호가 없어 늘 파일을 연 것으로 본다. 여러 화면(변경 목록, 따라가기, 커밋 상세, 스태시
 * 상세, PR 상세)이 같은 폭(`ui.fileListWidth`, 최소 280px)을 함께 쓴다. diff를 크게 보는 중
 * (`ui.isDiffMaximized`, 3단계)이면 목록과 손잡이를 숨기고 diff만 남긴다. `files`가 있으면 diff
 * 왼쪽에 좁은 파일 목록(260px)을 두고, 「목록 접기」(`DiffHeader`)로 36px 띠가 된다(`ui.
 * maximizedFileListOpen`, 크게 보기를 벗어나면 풀린다). 커지고 줄어드는 움직임은 `maximize-motion.ts`.
 * 파일을 열었는지는 `ui.diffFileOpen`으로 알린다 — 그래프 칸(`PaneStrip`)이 접힐지 정할 때 읽는다.
 */
export function ListDiffSplit({
  list,
  detail,
  variant,
  listOverlay,
  detailOverlay,
  files,
  origin,
  children,
  className,
  "data-testid": testId,
  detailAlwaysOpen = false,
}: ListDiffSplitProps) {
  const { t } = useTranslation();
  const width = useUIStore((s) => s.fileListWidth);
  const setWidth = useUIStore((s) => s.setFileListWidth);
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const setMaximized = useUIStore((s) => s.setDiffMaximized);
  const fileListOpen = useUIStore((s) => s.maximizedFileListOpen);
  const setFileListOpen = useUIStore((s) => s.setMaximizedFileListOpen);
  const setDiffFileOpen = useUIStore((s) => s.setDiffFileOpen);
  const startWidth = useRef(width);
  const listRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const cards = variant === "cards";
  // 파일을 골랐는지(2·3단계) 아직인지(1단계). `files`를 안 넘기는 화면(합쳐 보기·파일별 보기)은
  // 이 신호를 아직 안 쓰므로 늘 "골랐다"로 보아 지금 모습(목록 + diff 나란히)을 그대로 지킨다.
  const hasFile = detailAlwaysOpen || (files ? files.selectedKey !== null : true);
  const selectedItem = files ? (files.items.find((f) => f.key === files.selectedKey) ?? null) : null;
  const selectedFileName = selectedItem ? splitFilePath(selectedItem.path).name : undefined;

  // 그래프 칸(`PaneStrip`)에 "파일을 열었다"를 알린다 — 트리를 거슬러 prop을 내려보낼 길이 없다.
  useEffect(() => {
    setDiffFileOpen(hasFile);
    return () => setDiffFileOpen(false);
  }, [hasFile, setDiffFileOpen]);

  // 다른 파일을 고르면 「그래프 펼치기」(1단계 폭)를 풀어 다시 좁은 커밋 목록(2단계)으로 간다.
  const setGraphExpanded = usePaneStore((s) => s.setGraphExpanded);
  const selectedKey = files?.selectedKey ?? null;
  const prevSelectedKey = useRef(selectedKey);
  useEffect(() => {
    if (prevSelectedKey.current === selectedKey) return;
    prevSelectedKey.current = selectedKey;
    if (selectedKey !== null) setGraphExpanded(false);
  }, [selectedKey, setGraphExpanded]);

  // 크게 보기를 벗어나면 파일 목록 접힘을 푼다("원래 크기로 돌아오면 풀린다", 5.4).
  const prevMaximized = useRef(maximized);
  useEffect(() => {
    if (prevMaximized.current && !maximized) setFileListOpen(true);
    prevMaximized.current = maximized;
  }, [maximized, setFileListOpen]);

  useMaximizeFlip(detailRef, cards ? CARD_RADIUS : 0);
  const listLeaving = usePaneExit(listRef, maximized, LIST_EXIT);
  const showFiles = maximized && hasFile && fileListOpen && files !== undefined;
  const showFoldedBand = maximized && hasFile && !fileListOpen && files !== undefined;
  return (
    <div className={cn("relative flex flex-1 min-h-0 min-w-0", !cards && "h-full", className)} data-testid={testId}>
      {children}
      {/* 크게 보는 동안에도 목록과 diff를 다시 마운트하지 않는다(스크롤·보기 방식·입력 중인 상태 유지). 숨기기만 한다.
          숨기 직전 잠깐은 배치에서 빠진 채 제자리에 떠서 흐려진다(`usePaneExit`). */}
      <ListPane
        ref={listRef}
        cards={cards}
        style={hasFile ? { width } : { minWidth: LEVEL1_DETAIL_MIN_WIDTH }}
        className={cn(
          cards ? CARD : "flex flex-col min-h-0",
          listLeaving ? "absolute top-0 bottom-0 left-0 pointer-events-none" : "relative",
          maximized && hasFile && !listLeaving && "hidden",
          // 파일을 아직 안 골랐으면(1단계) 목록이 칸 전체를 쓴다. 골랐으면(2단계) diff가 너무
          // 좁아지지 않게 목록은 전체의 60%를 넘지 않고, 창이 좁으면 diff보다 먼저 220px까지 줄어든다(5.4).
          hasFile ? "shrink min-w-[220px] max-w-[60%]" : "flex-1",
        )}
        aria-hidden={(maximized && hasFile) || undefined}
        data-testid="list-pane"
      >
        {list}
        {listOverlay}
      </ListPane>
      {hasFile && !maximized && (
        <SplitHandle
          orientation="vertical"
          variant={cards ? "gap" : "inline"}
          aria-label={t("layout.resizeFileList")}
          onDragStart={() => {
            startWidth.current = width;
          }}
          onDrag={(delta) => setWidth(startWidth.current + delta)}
          onReset={() => setWidth(DEFAULT_FILE_LIST_WIDTH)}
        />
      )}
      <ListPane
        ref={detailRef}
        cards={cards}
        style={{ minWidth: hasFile ? MIN_DIFF_PANE_WIDTH : 0 }}
        className={cn(
          "relative",
          cards ? CARD : "flex flex-col min-h-0 overflow-hidden",
          hasFile ? "flex-1 min-w-0" : "w-0 flex-none overflow-hidden pointer-events-none",
        )}
        aria-hidden={!hasFile || undefined}
        data-testid="detail-pane"
      >
        {/* 카드가 다 커진 뒤(FLIP 200ms 후반) 얹힌다. 파일 목록(있으면)과 diff 위에 걸쳐 카드 전체 폭이다. */}
        {maximized && hasFile && origin && (
          <MaximizedOriginHeader origin={origin} onRestore={() => setMaximized(false)} fileName={selectedFileName} />
        )}
        {/* 목록을 켜고 끌 때 diff가 다시 마운트되지 않도록 틀은 늘 같다(목록 자리만 비운다). */}
        <div className="flex flex-1 min-h-0 min-w-0">
          {showFiles && <MaximizedFileList {...files} />}
          {showFoldedBand && <MaximizedFileListBand count={files.items.length} onExpand={() => setFileListOpen(true)} />}
          {/* 1↔2단계 경계(파일을 처음 열 때)만 새로 나타나는 칸이라 옅게 들어온다. 이미 연 상태에서
              다른 파일로 옮기는 것은(key가 그대로) 다시 재지 않는다. */}
          <div key={hasFile ? "open" : "closed"} className="flex flex-col flex-1 min-h-0 min-w-0 animate-content-in">
            <MaximizedOriginContext.Provider value={origin !== undefined}>
              <MaximizedFilesContext.Provider value={files !== undefined}>{detail}</MaximizedFilesContext.Provider>
            </MaximizedOriginContext.Provider>
          </div>
        </div>
        {detailOverlay}
      </ListPane>
    </div>
  );
}

/** 칸 하나. 카드면 `section`(떠 있는 패널), 카드 안 칸이면 `div`. */
function ListPane({
  cards,
  children,
  ref,
  ...rest
}: { cards: boolean; children: ReactNode; ref?: React.Ref<HTMLElement> } & React.HTMLAttributes<HTMLElement> & {
    "data-testid"?: string;
  }) {
  return cards ? (
    <section ref={ref} {...rest}>
      {children}
    </section>
  ) : (
    <div ref={ref as React.Ref<HTMLDivElement>} {...rest}>
      {children}
    </div>
  );
}

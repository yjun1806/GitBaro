import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { DEFAULT_FILE_LIST_WIDTH } from "@/lib/split-size";
import { cn } from "@/lib/utils";
import { SplitHandle } from "./SplitHandle";
import { useMaximizeFlip, usePaneExit } from "./maximize-motion";
import { MaximizedFilesContext, type MaximizedFiles } from "./maximized-files";
import { MaximizedFileList } from "./MaximizedFileList";

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
  /** 바깥 틀에 붙일 것(나란히 보기처럼 위에 뜨는 것). */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

const CARD = "flex flex-col min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden";
/** 카드 모서리(`--radius-panel`). 커지는 움직임의 잘라내기 모서리에 쓴다. */
const CARD_RADIUS = 14;
/** 크게 보기로 숨을 때 목록이 밀려 나가는 쪽. */
const LIST_EXIT = { x: -12, y: 0 };

/**
 * 파일 목록 ↔ diff 두 칸. 여러 화면(변경 목록, 따라가기, 커밋 상세, 스태시 상세, PR 상세)이
 * 같은 폭(`ui.fileListWidth`)을 함께 쓴다. diff를 크게 보는 중(`ui.isDiffMaximized`)이면
 * 목록과 손잡이를 숨기고 diff만 남긴다. `files`가 있으면 diff 왼쪽에 좁은 파일 목록을 둔다
 * (`ui.maximizedFileListOpen`으로 접는다). 커지고 줄어드는 움직임은 `maximize-motion.ts`.
 */
export function ListDiffSplit({
  list,
  detail,
  variant,
  listOverlay,
  detailOverlay,
  files,
  children,
  className,
  "data-testid": testId,
}: ListDiffSplitProps) {
  const { t } = useTranslation();
  const width = useUIStore((s) => s.fileListWidth);
  const setWidth = useUIStore((s) => s.setFileListWidth);
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const fileListOpen = useUIStore((s) => s.maximizedFileListOpen);
  const startWidth = useRef(width);
  const listRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);

  const cards = variant === "cards";
  useMaximizeFlip(detailRef, cards ? CARD_RADIUS : 0);
  const listLeaving = usePaneExit(listRef, maximized, LIST_EXIT);
  const showFiles = maximized && fileListOpen && files !== undefined;
  return (
    <div className={cn("relative flex flex-1 min-h-0 min-w-0", !cards && "h-full", className)} data-testid={testId}>
      {children}
      {/* 크게 보는 동안에도 목록과 diff를 다시 마운트하지 않는다(스크롤·보기 방식·입력 중인 상태 유지). 숨기기만 한다.
          숨기 직전 잠깐은 배치에서 빠진 채 제자리에 떠서 흐려진다(`usePaneExit`). */}
      <ListPane
        ref={listRef}
        cards={cards}
        style={{ width }}
        // diff가 너무 좁아지지 않게 목록은 전체의 60%를 넘지 않는다.
        className={cn(
          "shrink-0 max-w-[60%]",
          cards ? CARD : "flex flex-col min-h-0",
          listLeaving ? "absolute top-0 bottom-0 left-0 pointer-events-none" : "relative",
          maximized && !listLeaving && "hidden",
        )}
        aria-hidden={maximized || undefined}
        data-testid="list-pane"
      >
        {list}
        {listOverlay}
      </ListPane>
      {!maximized && (
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
        className={cn("relative flex-1 min-w-0", cards ? CARD : "flex flex-col min-h-0 overflow-hidden")}
        data-testid="detail-pane"
      >
        {/* 목록을 켜고 끌 때 diff가 다시 마운트되지 않도록 틀은 늘 같다(목록 자리만 비운다). */}
        <div className="flex flex-1 min-h-0 min-w-0">
          {showFiles && <MaximizedFileList {...files} />}
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <MaximizedFilesContext.Provider value={files !== undefined}>{detail}</MaximizedFilesContext.Provider>
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

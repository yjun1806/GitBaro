import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui";
import { DEFAULT_FILE_LIST_WIDTH } from "@/lib/split-size";
import { cn } from "@/lib/utils";
import { SplitHandle } from "./SplitHandle";

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
  /** 바깥 틀에 붙일 것(나란히 보기처럼 위에 뜨는 것). */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

const CARD = "relative flex flex-col min-h-0 bg-card rounded-(--radius-panel) shadow-(--shadow) overflow-hidden";

/**
 * 파일 목록 ↔ diff 두 칸. 다섯 화면(변경 목록, 따라가기, 커밋 상세, 파일별 변경, 스태시 상세)이
 * 같은 폭(`ui.fileListWidth`)을 함께 쓴다. diff를 크게 보는 중(`ui.isDiffMaximized`)이면
 * 목록과 손잡이를 숨기고 diff만 남긴다.
 */
export function ListDiffSplit({
  list,
  detail,
  variant,
  listOverlay,
  detailOverlay,
  children,
  className,
  "data-testid": testId,
}: ListDiffSplitProps) {
  const { t } = useTranslation();
  const width = useUIStore((s) => s.fileListWidth);
  const setWidth = useUIStore((s) => s.setFileListWidth);
  const maximized = useUIStore((s) => s.isDiffMaximized);
  const startWidth = useRef(width);

  const cards = variant === "cards";
  return (
    <div className={cn("relative flex flex-1 min-h-0 min-w-0", !cards && "h-full", className)} data-testid={testId}>
      {children}
      {/* 크게 보는 동안에도 목록과 diff를 다시 마운트하지 않는다(스크롤·보기 방식·입력 중인 상태 유지). 숨기기만 한다. */}
      <ListPane
        cards={cards}
        style={{ width }}
        // diff가 너무 좁아지지 않게 목록은 전체의 60%를 넘지 않는다.
        className={cn("shrink-0 max-w-[60%]", cards ? CARD : "relative flex flex-col min-h-0", maximized && "hidden")}
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
      <ListPane cards={cards} className={cn("flex-1 min-w-0", cards ? CARD : "relative flex flex-col min-h-0 overflow-hidden")}>
        {detail}
        {detailOverlay}
      </ListPane>
    </div>
  );
}

/** 칸 하나. 카드면 `section`(떠 있는 패널), 카드 안 칸이면 `div`. */
function ListPane({
  cards,
  children,
  ...rest
}: { cards: boolean; children: ReactNode } & React.HTMLAttributes<HTMLElement> & { "data-testid"?: string }) {
  return cards ? <section {...rest}>{children}</section> : <div {...rest}>{children}</div>;
}

import { cn } from "@/lib/utils";

/**
 * 머리 줄(44px, 층 0) 위 버튼의 하나뿐인 모양. 제목 버튼, 워크트리 칩, git 작업, 터미널, 계정, 설정과
 * 사이드바 머리의 「전체 저장소」 버튼이 모두 이것을 쓴다.
 *
 * - 높이 28px(h-7), 모서리 6px(rounded-md), 좌우 8px, 아이콘 14px, 글자 12.5px medium
 * - 평소에는 바탕 없이 회색 글자(ghost). hover는 옅은 채움, 누르는 동안과 메뉴가 열린 동안은 한 단계 진한 채움
 * - 꺼지면 45% 투명도, hover 없음
 * - 브랜드 색은 `primary` 변형에만 쓴다(툴바에는 지금 진짜 주요 작업이 없어 쓰는 곳이 없다)
 */
export type ToolbarButtonVariant = "ghost" | "primary";

export interface ToolbarButtonOptions {
  variant?: ToolbarButtonVariant;
  /** 메뉴·패널이 열린 상태 */
  open?: boolean;
  disabled?: boolean;
  /** 아이콘만 있는 정사각 버튼(28×28) */
  iconOnly?: boolean;
  /** 오른쪽에 ▾ 버튼이 붙는 분할 버튼의 본 버튼 */
  joinRight?: boolean;
  /** 분할 버튼의 ▾ 쪽 */
  joinLeft?: boolean;
}

export const TOOLBAR_BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 h-7 shrink-0 rounded-md text-[12.5px] font-medium leading-none whitespace-nowrap select-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** 툴바 아이콘 크기(14px) */
export const TOOLBAR_ICON = "w-3.5 h-3.5 shrink-0";

export function toolbarButtonClass({
  variant = "ghost",
  open = false,
  disabled = false,
  iconOnly = false,
  joinRight = false,
  joinLeft = false,
}: ToolbarButtonOptions = {}): string {
  return cn(
    TOOLBAR_BUTTON_BASE,
    iconOnly ? "w-7" : joinLeft ? "w-5" : "px-2",
    joinRight && "rounded-r-none pr-1",
    joinLeft && "rounded-l-none",
    variant === "primary"
      ? cn("bg-primary text-primary-foreground", !disabled && "hover:bg-primary-hover")
      : cn(
          open ? "bg-(--frame-sel) text-foreground" : "text-(--fg2)",
          !disabled && !open && "hover:bg-(--frame-hover) hover:text-foreground active:bg-(--frame-sel)",
        ),
    disabled && "opacity-45 cursor-not-allowed",
  );
}

/**
 * 관련 버튼 묶음을 담는 흰 카드(층 2). 안의 28px 버튼 둘레로 3px 여백을 두어 34px 높이로
 * 44px 머리 줄 가운데에 놓인다. 모서리는 버튼 모서리(6px) + 여백(3px) = 9px로 같은 중심을 가진다.
 * 묶음 사이는 선 대신 틈(6px)으로 나눈다.
 */
const TOOLBAR_GROUP_SURFACE =
  "flex items-center gap-0.5 p-[3px] rounded-[9px] bg-card border border-(--line) shadow-(--shadow-sm)";
export const TOOLBAR_GROUP = `${TOOLBAR_GROUP_SURFACE} shrink-0`;

/** 좁아지면 먼저 줄어드는 묶음(왼쪽 경로 카드). 안의 이름은 말줄임된다. */
export const TOOLBAR_GROUP_SHRINKABLE = `${TOOLBAR_GROUP_SURFACE} min-w-0 shrink`;

/** 툴바 버튼 안 숫자 배지(↑·↓ 수, stash 수). 강조가 아니라 회색이다. */
export const TOOLBAR_BADGE =
  "h-4 min-w-4 px-1 box-border rounded-full bg-(--fg2) text-(--frame) text-[10.5px] font-bold flex items-center justify-center tabular-nums leading-none";

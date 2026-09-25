import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarHoverCard, type HoverSubject } from "./SidebarHoverCard";

/** 카드 안에서 한 단계 들여 쓰는 폭(px). 워크스페이스 카드 안 저장소의 작업 폴더 줄에 쓴다. */
export const INDENT_PX = 8;
/** 행 좌우 안쪽 여백(px). 양쪽이 같다. 선택 막대(3px)는 이 여백 안에 그려진다. */
export const ROW_PAD_X = 8;

/** 사이드바에서 선택된 줄의 왼쪽 막대(브랜드 색). 부모는 `relative`여야 한다. 행 채움 안쪽에 둥근 막대로 그려 둥근 모서리 밖으로 삐져나오지 않게 한다. */
export function SelectionBar() {
  return (
    <span
      aria-hidden="true"
      data-testid="selection-bar"
      className="absolute left-[3px] top-[7px] bottom-[7px] w-[3px] rounded-full bg-(--acc)"
    />
  );
}

interface TreeRowFrameProps {
  /** 화면 읽기 프로그램에 알리는 트리 단계(1부터). */
  level: number;
  /** 들여쓰기 단계(0부터). 한 단계는 `INDENT_PX`. */
  depth?: number;
  /** 행 이름. 트리 항목의 접근 가능한 이름이 된다. */
  label: string;
  /** 접을 수 있는 행이면 지금 펼쳤는지. 접을 수 없으면 undefined. */
  expanded?: boolean;
  /**
   * ▾ 표시 자리. `leading`은 이름 앞(계정 머리글), `trailing`은 행 오른쪽 끝(카드 머리 줄).
   * 카드 안 행은 앞자리를 비워 두지 않아 좁은 사이드바에서 이름 폭을 아낀다.
   */
  chevron?: "leading" | "trailing";
  selected?: boolean;
  onSelect?: () => void;
  onToggle?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** 마우스를 올리거나 초점을 받으면 띄울 자세한 정보 카드의 대상. */
  hover?: HoverSubject;
  /** 저장소·워크트리 경로. 있으면 `data-tree-path`로 심는다. */
  treePath?: string;
  /** 행이 놓인 바탕. 카드 안(`panel`, 기본)과 사이드바 바탕(`frame`, 계정 머리글)은 hover 채움이 다르다. */
  surface?: "panel" | "frame";
  className?: string;
  children: ReactNode;
}

/**
 * 사이드바 한 줄의 공통 틀: 한 줄 28px, 좌우 여백 8px, ▾/▸ 접기 표시, 선택 채움과 막대, 키보드 조작,
 * 자세한 정보 카드(hover card). 행은 평평하게 늘어놓고 `aria-level`로 단계를 알린다(ARIA 트리의 평면 구조).
 */
export function TreeRowFrame({
  level,
  depth = 0,
  label,
  expanded,
  chevron = "trailing",
  selected = false,
  onSelect,
  onToggle,
  onContextMenu,
  hover,
  treePath,
  surface = "panel",
  className,
  children,
}: TreeRowFrameProps) {
  const collapsible = expanded !== undefined;
  const hoverCard = useSidebarHoverCard();

  const handleClick = () => {
    if (onSelect) onSelect();
    else if (collapsible) onToggle?.();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    } else if (collapsible && e.key === "ArrowRight" && !expanded) {
      e.preventDefault();
      onToggle?.();
    } else if (collapsible && e.key === "ArrowLeft" && expanded) {
      e.preventDefault();
      onToggle?.();
    }
  };

  const chevronMark = collapsible && (
    <span
      aria-hidden="true"
      data-testid="row-chevron"
      className="w-4 h-5 -mx-1 shrink-0 flex items-center justify-center"
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onToggle?.();
            }
          : undefined
      }
    >
      <ChevronDown
        className={cn("w-2.5 h-2.5 text-[var(--faint)] transition-transform", !expanded && "-rotate-90")}
        strokeWidth={2.6}
      />
    </span>
  );

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-label={label}
      aria-expanded={expanded}
      aria-selected={selected}
      data-tree-path={treePath}
      // 트리 안에서 Tab이 닿는 줄은 하나뿐이다(roving tabindex). 어느 줄을 0으로 둘지는 `useTreeKeyboard`가 정한다.
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        hoverCard.hide();
        onContextMenu?.(e);
      }}
      onMouseEnter={hover ? (e) => hoverCard.show(hover, e.currentTarget) : undefined}
      onMouseLeave={hover ? hoverCard.hide : undefined}
      onFocus={hover ? (e) => hoverCard.show(hover, e.currentTarget) : undefined}
      onBlur={hover ? hoverCard.hide : undefined}
      style={{ paddingLeft: ROW_PAD_X + depth * INDENT_PX, paddingRight: ROW_PAD_X }}
      className={cn(
        "relative flex items-center gap-[var(--item)] h-[var(--row)] rounded-[var(--radius-item)] cursor-default select-none outline-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
        // 카드(층 2) 안 행: 선택은 회색 채움 + 브랜드 색 왼쪽 막대, hover는 더 옅은 채움.
        surface === "panel"
          ? selected
            ? "bg-(--panel-sel)"
            : "hover:bg-(--panel-hover)"
          : selected
            ? "bg-(--frame-sel)"
            : "hover:bg-(--frame-hover)",
        className,
      )}
    >
      {selected && <SelectionBar />}
      {chevron === "leading" && chevronMark}
      {children}
      {chevron === "trailing" && chevronMark}
    </div>
  );
}

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** 들여쓰기 한 단계의 폭(px). 시안 `gen_d.py`의 `depth*14`. */
export const INDENT_PX = 14;

interface TreeRowFrameProps {
  /** 화면 읽기 프로그램에 알리는 트리 단계(1부터). */
  level: number;
  /** 들여쓰기 단계(0부터). 단계마다 세로 안내선을 하나씩 긋는다. */
  depth: number;
  /** 행 이름. 트리 항목의 접근 가능한 이름이 된다. */
  label: string;
  /** 접을 수 있는 행이면 지금 펼쳤는지. 접을 수 없으면 undefined. */
  expanded?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onToggle?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** 두 줄짜리 워크스페이스 행처럼 36px 높이가 필요한 행 */
  tall?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * 트리 한 줄의 공통 틀: 들여쓰기, 세로 안내선, ▾/▸ 접기 표시, 선택 배경, 키보드 조작.
 * 행은 평평하게 늘어놓고 `aria-level`로 단계를 알린다(ARIA 트리의 평면 구조).
 */
export function TreeRowFrame({
  level,
  depth,
  label,
  expanded,
  selected = false,
  onSelect,
  onToggle,
  onContextMenu,
  tall = false,
  className,
  children,
}: TreeRowFrameProps) {
  const collapsible = expanded !== undefined;

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

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-label={label}
      aria-expanded={expanded}
      aria-selected={selected}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: 6 + depth * INDENT_PX }}
      className={cn(
        "relative flex items-center gap-[var(--item)] pr-2 rounded-[var(--radius-item)] cursor-default select-none outline-none",
        tall ? "min-h-9 py-1" : "min-h-[var(--row)] py-[3px]",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        selected
          ? "bg-card shadow-[var(--shadow-sm)]"
          : "hover:bg-[color-mix(in_srgb,var(--panel)_60%,transparent)]",
        className,
      )}
    >
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-border"
          style={{ left: 2 + (i + 1) * INDENT_PX }}
        />
      ))}
      <span
        aria-hidden="true"
        className="w-4 h-5 -mx-[3px] shrink-0 flex items-center justify-center"
        onClick={
          collapsible && onSelect
            ? (e) => {
                e.stopPropagation();
                onToggle?.();
              }
            : undefined
        }
      >
        {collapsible && (
          <ChevronDown
            className={cn(
              "w-2.5 h-2.5 text-[var(--faint)] transition-transform",
              !expanded && "-rotate-90",
            )}
            strokeWidth={2.6}
          />
        )}
      </span>
      {children}
    </div>
  );
}

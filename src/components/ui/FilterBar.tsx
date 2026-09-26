import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  /** 왼쪽: 필터 칩 → 드롭다운 필터. 걸 것이 없으면 생략한다. */
  left?: ReactNode;
  /** 오른쪽: 보기 전환(`Segmented sm`) → 검색(`SearchInput sm`, 맨 오른쪽). 걸 것이 없으면 생략한다. */
  right?: ReactNode;
  className?: string;
}

/**
 * 탭 바로 아래에 놓는 필터 줄(design-system.md 3.x 필터). 높이 36px, 좌우 8px, 항목 사이 6px,
 * 아래 1px 선. `left`·`right` 모두 없으면(=걸 것이 없으면) 줄 자체를 그리지 않는다 — 새로 고침·
 * GitHub에서 열기 같은 작업 버튼은 이 줄이 아니라 탭 줄 오른쪽에 둔다.
 */
export function FilterBar({ left, right, className }: FilterBarProps) {
  if (!left && !right) return null;
  return (
    <div className={cn("flex items-center gap-1.5 h-9 px-2 shrink-0 border-b border-(--line)", className)}>
      {left}
      <span className="flex-1 min-w-0" />
      {right}
    </div>
  );
}

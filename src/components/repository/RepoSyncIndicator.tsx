import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RepoSyncStatus } from "@/types";

interface RepoSyncIndicatorProps {
  status: RepoSyncStatus | undefined;
  /** "badge" = 화살표+카운트(넓은 영역), "dot" = 색 점만(좁은 레일). */
  variant?: "badge" | "dot";
  className?: string;
}

/**
 * 레포의 push(ahead ↑) / pull(behind ↓) 필요 상태를 표시한다.
 * 색 규칙은 BranchStatusDot과 동일 — ahead=primary, behind=danger.
 * upstream이 없거나 완전히 동기화된 레포는 아무것도 렌더링하지 않는다.
 */
export function RepoSyncIndicator({ status, variant = "badge", className }: RepoSyncIndicatorProps) {
  if (!status || !status.hasUpstream) return null;

  const { ahead, behind } = status;
  if (ahead === 0 && behind === 0) return null;

  if (variant === "dot") {
    const dotColor =
      ahead > 0 && behind > 0 ? "bg-warning" : behind > 0 ? "bg-danger" : "bg-primary";
    const title =
      ahead > 0 && behind > 0
        ? `↑${ahead} ↓${behind}`
        : behind > 0
          ? `↓${behind}`
          : `↑${ahead}`;
    return (
      <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor, className)} title={title} />
    );
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1 shrink-0 text-[11px] font-medium tabular-nums leading-none",
        className,
      )}
    >
      {behind > 0 && (
        <span className="flex items-center gap-px text-danger" title={`↓${behind}`}>
          <ArrowDown className="w-3 h-3" />
          {behind}
        </span>
      )}
      {ahead > 0 && (
        <span className="flex items-center gap-px text-primary" title={`↑${ahead}`}>
          <ArrowUp className="w-3 h-3" />
          {ahead}
        </span>
      )}
    </span>
  );
}

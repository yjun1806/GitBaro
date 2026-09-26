import { cn } from "@/lib/utils";
import { Count, Dot } from "@/components/ui/marks";
import type { RepoSyncStatus } from "@/types";

interface RepoSyncIndicatorProps {
  status: RepoSyncStatus | undefined;
  /** "badge" = 화살표+카운트(넓은 영역), "dot" = 색 점만(좁은 레일). */
  variant?: "badge" | "dot";
  className?: string;
}

/**
 * 레포의 push(ahead ↑) / pull(behind ↓) 필요 상태를 표시한다.
 * upstream이 없거나 완전히 동기화된 레포는 아무것도 렌더링하지 않는다.
 */
export function RepoSyncIndicator({ status, variant = "badge", className }: RepoSyncIndicatorProps) {
  if (!status || !status.hasUpstream) return null;

  const { ahead, behind } = status;
  if (ahead === 0 && behind === 0) return null;

  if (variant === "dot") {
    const title =
      ahead > 0 && behind > 0
        ? `↑${ahead} ↓${behind}`
        : behind > 0
          ? `↓${behind}`
          : `↑${ahead}`;
    return (
      <span className={className} title={title}>
        <Dot on />
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-1.5 shrink-0", className)}>
      {behind > 0 && <Count value={behind} prefix="↓" tone="sync" label={`↓${behind}`} />}
      {ahead > 0 && <Count value={ahead} prefix="↑" tone="sync" label={`↑${ahead}`} />}
    </span>
  );
}

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { worktreeBaseTitle } from "@/lib/worktree-base";
import type { WorktreeBase } from "@/types";

interface WorktreeBaseLabelProps {
  base: WorktreeBase;
  /**
   * `full`: 「dev에서 갈라짐 · ↑3 ↓1」 — 워크트리 목록용.
   * `compact`: 「dev 기반」 — 폭이 좁은 툴바용. 앞뒤 커밋 수는 툴팁으로만 보인다.
   */
  variant?: "full" | "compact";
  className?: string;
}

/**
 * 워크트리 브랜치가 갈라져 나온 브랜치와 그 브랜치 대비 앞뒤 커밋 수.
 * 기록 없이 추정한 값이면 「추정」 표시를 붙인다.
 */
export function WorktreeBaseLabel({ base, variant = "full", className }: WorktreeBaseLabelProps) {
  const { t } = useTranslation();
  const isInferred = base.source === "inferred";
  const showCounts = variant === "full" && (base.aheadOfBase > 0 || base.behindBase > 0);

  return (
    <span
      className={cn("flex items-center gap-1 min-w-0 text-xs text-muted-foreground", className)}
      title={worktreeBaseTitle(base, t)}
    >
      <span className="truncate">
        {variant === "full"
          ? t("worktree.base.from", { base: base.name })
          : t("worktree.base.basedOn", { base: base.name })}
      </span>
      {showCounts && (
        <span className="shrink-0 tabular-nums">
          {"· "}
          {base.aheadOfBase > 0 && (
            <>
              <span className="opacity-70">{"↑"}</span>
              {base.aheadOfBase}
            </>
          )}
          {base.aheadOfBase > 0 && base.behindBase > 0 && " "}
          {base.behindBase > 0 && (
            <>
              <span className="opacity-70">{"↓"}</span>
              {base.behindBase}
            </>
          )}
        </span>
      )}
      {isInferred && (
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground bg-muted px-1 rounded">
          {t("worktree.base.inferred")}
        </span>
      )}
    </span>
  );
}

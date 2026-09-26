import { useTranslation } from "react-i18next";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import { cn } from "@/lib/utils";
import { worktreeBaseTitle } from "@/lib/worktree-base";
import { Count } from "@/components/ui/marks";
import type { WorktreeBase } from "@/types";

interface WorktreeBaseLabelProps {
  base: WorktreeBase;
  /**
   * `full`: 「dev에서 갈라짐 · ↑3 ↓1」 — 워크트리 목록용.
   * `compact`: 「dev 기반」 — 폭이 좁은 툴바용. 앞뒤 커밋 수는 툴팁으로만 보인다.
   */
  variant?: "full" | "compact";
  /**
   * 브랜치 이름이 이보다 길면 가운데를 「…」로 줄인다(끝에서부터 자르는 CSS truncate와 달리
   * 「에서 갈라짐」/「기반」 접미사가 항상 보인다). 없으면 CSS truncate에 맡긴다(기존 동작).
   * 전체 이름은 title 툴팁에 그대로 남는다.
   */
  maxBaseNameLength?: number;
  className?: string;
}

/**
 * 워크트리 브랜치가 갈라져 나온 브랜치와 그 브랜치 대비 앞뒤 커밋 수.
 * 기록 없이 추정한 값이면 「추정」 표시를 붙인다.
 */
export function WorktreeBaseLabel({ base, variant = "full", maxBaseNameLength, className }: WorktreeBaseLabelProps) {
  const { t } = useTranslation();
  const isInferred = base.source === "inferred";
  const showCounts = variant === "full" && (base.aheadOfBase > 0 || base.behindBase > 0);
  const baseName = maxBaseNameLength != null ? middleEllipsis(base.name, maxBaseNameLength) : base.name;

  return (
    <span
      className={cn("flex items-center gap-1 min-w-0 text-[11.5px] text-muted-foreground", className)}
      title={worktreeBaseTitle(base, t)}
    >
      <span className={maxBaseNameLength != null ? "shrink-0" : "truncate"}>
        {variant === "full"
          ? t("worktree.base.from", { base: baseName })
          : t("worktree.base.basedOn", { base: baseName })}
      </span>
      {showCounts && (
        <span className="shrink-0">
          {"· "}
          {base.aheadOfBase > 0 && <Count value={base.aheadOfBase} prefix="↑" tone="sync" />}
          {base.aheadOfBase > 0 && base.behindBase > 0 && " "}
          {base.behindBase > 0 && <Count value={base.behindBase} prefix="↓" tone="sync" />}
        </span>
      )}
      {isInferred && <span className="shrink-0 text-muted-foreground">{t("worktree.base.inferred")}</span>}
    </span>
  );
}

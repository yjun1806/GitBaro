import type { TFunction } from "i18next";
import type { WorktreeBase } from "@/types";

/** 기반 브랜치 대비 앞뒤 커밋 수와, 추정값이면 그 이유를 담은 툴팁 문구. */
export function worktreeBaseTitle(base: WorktreeBase, t: TFunction): string {
  const counts = t("worktree.base.counts", {
    base: base.name,
    ahead: base.aheadOfBase,
    behind: base.behindBase,
  });
  return base.source === "inferred"
    ? `${counts}\n${t("worktree.base.inferredHint")}`
    : counts;
}

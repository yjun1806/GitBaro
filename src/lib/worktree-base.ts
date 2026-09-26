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

/**
 * 「<base> 기반」 라벨과 같은 뜻의 한 줄. 폭이 좁아 그 라벨을 감춘 자리(툴바 브랜치 칸)에서
 * 대신 버튼 툴팁에 넣는다(`worktreeBaseTitle`의 앞뒤 커밋 수 없이, 라벨이 보이던 글만).
 */
export function worktreeBaseSummary(base: WorktreeBase, t: TFunction): string {
  const basedOn = t("worktree.base.basedOn", { base: base.name });
  return base.source === "inferred" ? `${basedOn} · ${t("worktree.base.inferred")}` : basedOn;
}

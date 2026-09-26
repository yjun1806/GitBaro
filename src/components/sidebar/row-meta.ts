import type { TFunction } from "i18next";
import type { WorkingBranchReason } from "@/lib/working-branches";

/** 「N초 전」·「N분 전」에 들어갈 시간 글. */
export function formatAgo(t: TFunction, now: number, at: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 60
    ? t("sidebarTree.live.seconds", { count: seconds })
    : t("sidebarTree.live.minutes", { count: Math.floor(seconds / 60) });
}

/** 행 오른쪽 작업 중 점의 툴팁: 「지금 파일이 바뀌는 중 · 12초 전」. 실시간 감시 밖이면 그 사실을 덧붙인다. */
export function liveDotLabel(t: TFunction, watched: boolean, now: number, at: number): string {
  const ago = formatAgo(t, now, at);
  return watched ? t("sidebarTree.meta.changingNow", { ago }) : t("sidebarTree.meta.changingNotWatched", { ago });
}

/** 작업 중인 브랜치 줄의 자세한 정보 카드에 넣을, 그 줄이 생긴 이유 글(`workingBranchReasons`의 순서대로). */
export function workingBranchReasonText(t: TFunction, reasons: WorkingBranchReason[], prNumber: number | null): string {
  return reasons
    .map((reason) => {
      switch (reason) {
        case "worktree":
          return t("sidebarTree.card.reasonWorktree");
        case "unpushed":
          return t("sidebarTree.card.reasonUnpushed");
        case "openPr":
          return prNumber !== null
            ? t("sidebarTree.card.reasonOpenPr", { number: prNumber })
            : t("sidebarTree.card.reasonOpenPrGeneric");
        case "recent":
          return t("sidebarTree.card.reasonRecent");
      }
    })
    .join(" · ");
}

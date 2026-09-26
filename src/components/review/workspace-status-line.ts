import type { TFunction } from "i18next";

/** 워크스페이스 상태 줄 판단에 쓰는 저장소 하나. */
export interface WorkspaceStatusRepo {
  /** 커밋하지 않은 파일 수(모든 워크트리 합). */
  wipCount: number;
  /** 원격에 없는 커밋 수(모든 워크트리 합). 하나도 못 셌으면 null(0으로 본다). */
  unpushedCount: number | null;
}

/**
 * 워크스페이스 상태 줄의 글: 변경 있는 저장소 수 · 올릴 커밋 있는 저장소 수(숨긴 저장소도 센다).
 * 저장소 이름과 「N개 중 M개 표시」는 툴바 제목(`WorkspaceTitle`)이 이미 말하므로 되풀이하지 않는다.
 * 저장소별 파일·커밋 수는 적지 않는다(그래프의 WIP 행·레인이 말한다) — 여기는 몇 개 저장소가
 * 그런 상태인지만 말한다.
 */
export function workspaceStatusText(repos: readonly WorkspaceStatusRepo[], t: TFunction): string {
  const changed = repos.filter((r) => r.wipCount > 0).length;
  const unpushed = repos.filter((r) => (r.unpushedCount ?? 0) > 0).length;
  const parts = [
    changed > 0 ? t("statusBar.workspace.changed", { count: changed }) : null,
    unpushed > 0 ? t("statusBar.workspace.unpushed", { count: unpushed }) : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : t("statusBar.workspace.allQuiet");
}

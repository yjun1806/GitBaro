import type { TFunction } from "i18next";

/**
 * 워크스페이스 상태 줄의 글: 「워크스페이스 {이름} · 저장소마다 체크아웃한 브랜치 기준」
 * (5.3, 시안 `scope-unify.html`). 저장소별 변경·커밋 수는 그래프의 WIP 행·레인이 말하므로
 * 여기서 되풀이하지 않는다 — 이 줄은 늘 같은 문장이다(체크아웃·보는 중 개념이 없다).
 */
export function workspaceStatusText(name: string, t: TFunction): string {
  return t("statusBar.workspace.summary", { name });
}

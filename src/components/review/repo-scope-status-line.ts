import type { TFunction } from "i18next";

/** 「저장소」 단계 상태 줄 판단에 쓰는 값. */
export interface RepoScopeStatusInput {
  repoName: string;
  /** 기본 폴더(메인 작업 트리)가 체크아웃한 브랜치. 분리된 HEAD면 null. */
  branch: string | null;
  /** 메인 말고 링크된 워크트리 수. */
  linkedWorktreeCount: number;
}

/**
 * 「저장소」 단계 상태 줄의 글: 「{저장소} · 기본 폴더 ⎇ {브랜치} · 레인은 워크트리」(5.3, 시안
 * `scope-unify.html`). 링크된 워크트리가 없으면 마지막 조각이 「링크된 워크트리 없음」으로 바뀐다.
 * 이 단계는 워크트리마다 레인이 나뉘므로(5.1) 체크아웃 칸은 기본 폴더 하나만 말한다.
 */
export function repoScopeStatusText(input: RepoScopeStatusInput, t: TFunction): string {
  const mainCheckout = input.branch
    ? t("statusBar.repoScope.mainCheckout", { branch: input.branch })
    : t("statusLine.mainWorktree");
  const lanesNote =
    input.linkedWorktreeCount > 0
      ? t("statusBar.repoScope.lanesAreWorktrees")
      : t("statusBar.repoScope.noLinkedWorktrees");
  return [input.repoName, mainCheckout, lanesNote].join(" · ");
}

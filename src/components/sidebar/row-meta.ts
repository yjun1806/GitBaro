import type { TFunction } from "i18next";

/**
 * 사이드바 행 둘째 줄의 상태 글(메타 줄).
 * 「⎇ 브랜치 · 수정 N · 새 커밋 N · ↑a ↓b」처럼 숫자에 말을 붙여 쓴다. 색과 숫자만으로 뜻을 전하지 않는다.
 * 순서는 늘 [저장소 수(워크스페이스만)] [수정] [새 커밋] [↑↓]이고 0인 항목은 뺀다. 모두 0이면 「깨끗함」.
 * 폭이 모자라면 끝에서부터 잘린다(↑↓ → 새 커밋 → 수정 순으로 사라지고 「…」가 붙는다).
 */
export type MetaPartKind = "repos" | "modified" | "newCommits" | "sync" | "clean";

export interface MetaPart {
  kind: MetaPartKind;
  text: string;
}

export interface RowMetaInput {
  dirty?: number;
  newCommits?: number;
  ahead?: number;
  behind?: number;
  /** 워크스페이스 행만: 안에 든 저장소 수 */
  repoCount?: number;
}

/** 표시 순서. 폭이 모자라면 이 순서의 끝에서부터 잘린다. */
export const META_ORDER: readonly MetaPartKind[] = ["repos", "modified", "newCommits", "sync"];

/** ↑↓ 글자. 0인 방향은 뺀다(예: 「↑2 ↓1」, 「↓4」). */
export function syncText(ahead: number, behind: number): string {
  return [ahead > 0 ? `↑${ahead}` : null, behind > 0 ? `↓${behind}` : null].filter(Boolean).join(" ");
}

export function metaLineParts(
  { dirty = 0, newCommits = 0, ahead = 0, behind = 0, repoCount }: RowMetaInput,
  t: TFunction,
): MetaPart[] {
  const parts: MetaPart[] = [];
  if (repoCount !== undefined) parts.push({ kind: "repos", text: t("sidebarTree.meta.repos", { count: repoCount }) });
  if (dirty > 0) parts.push({ kind: "modified", text: t("sidebarTree.meta.modified", { count: dirty }) });
  if (newCommits > 0) parts.push({ kind: "newCommits", text: t("sidebarTree.meta.newCommits", { count: newCommits }) });
  if (ahead > 0 || behind > 0) parts.push({ kind: "sync", text: syncText(ahead, behind) });
  // 저장소 수만 있는 워크스페이스도 「깨끗함」을 붙인다(상태가 없다는 것도 알린다).
  if (!parts.some((p) => p.kind !== "repos")) parts.push({ kind: "clean", text: t("sidebarTree.meta.clean") });
  return parts;
}

/** 툴팁·접근성 이름에 쓰는 한 줄 글. */
export function metaLineText(parts: MetaPart[]): string {
  return parts.map((p) => p.text).join(" · ");
}

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

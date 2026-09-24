/**
 * 사이드바 행 오른쪽 표시 칸(메타 칸)의 모델.
 * 순서는 항상 [커밋 안 한 파일] [새 커밋] [↑↓]이고, 값이 0인 항목은 빼고 그린다.
 */
export type RowMetaItem =
  | { kind: "dirty"; count: number }
  | { kind: "newCommits"; count: number }
  | { kind: "sync"; ahead: number; behind: number };

export interface RowMetaInput {
  dirty?: number;
  newCommits?: number;
  ahead?: number;
  behind?: number;
}

export function rowMetaItems({ dirty = 0, newCommits = 0, ahead = 0, behind = 0 }: RowMetaInput): RowMetaItem[] {
  const items: RowMetaItem[] = [];
  if (dirty > 0) items.push({ kind: "dirty", count: dirty });
  if (newCommits > 0) items.push({ kind: "newCommits", count: newCommits });
  if (ahead > 0 || behind > 0) items.push({ kind: "sync", ahead: Math.max(0, ahead), behind: Math.max(0, behind) });
  return items;
}

/** ↑↓ 칸의 글자. 0인 방향은 뺀다(예: 「↑2 ↓1」, 「↓4」). */
export function syncText(ahead: number, behind: number): string {
  return [ahead > 0 ? `↑${ahead}` : null, behind > 0 ? `↓${behind}` : null].filter(Boolean).join(" ");
}

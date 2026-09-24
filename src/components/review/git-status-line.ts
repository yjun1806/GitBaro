import type { TFunction } from "i18next";
import type { GitOperation, StatusEntry } from "@/types";
import type { ViewTarget } from "@/stores/history-view";

/** 상태 줄에 필요한 git 상태. 모르는 값은 null. */
export interface GitStatusInput {
  /** 지금 연 작업 트리. 연결된 워크트리면 그 이름. */
  worktree: { isMain: boolean; name: string };
  /** 체크아웃한 로컬 브랜치. 분리된 HEAD면 null. */
  branch: string | null;
  /** HEAD 커밋 SHA. 분리된 HEAD 표시에 쓴다. */
  headSha: string | null;
  /** 체크아웃한 브랜치의 upstream. 원격 브랜치가 없으면 null. */
  upstream: { name: string; ahead: number; behind: number } | null;
  /** 원격 저장소가 있는지. 없으면 upstream 칸을 그리지 않는다. */
  hasRemote: boolean;
  /** 커밋 안 한 변경(파일 단위, 스테이징 포함). */
  uncommitted: { total: number; staged: number; conflicts: number };
  /** 진행 중인 merge·rebase 등. */
  operation: GitOperation | null;
  /** 체크아웃하지 않고 보는 대상. */
  viewing: ViewTarget | null;
}

/** 줄 전체의 분위기. 특별한 상태가 보통 상태의 색과 글을 대신한다. */
export type GitStatusTone = "normal" | "viewing" | "operation" | "detached";

export interface GitStatusLineModel {
  tone: GitStatusTone;
  /** 특별한 상태의 머리 글(보는 중·진행 중·분리된 HEAD). 보통 상태면 null. */
  headline: string | null;
  /** 작업 트리 칸. */
  worktree: string;
  /** 체크아웃 칸. */
  checkout: string;
  /** upstream 칸. 그리지 않으면 null. */
  upstream: { text: string; ahead: number; behind: number; hasUpstream: boolean } | null;
  /** 커밋 안 한 변경 칸. 변경이 없으면 「커밋 안 한 변경 없음」. */
  uncommitted: string;
  /** 「커밋하기」를 보일지. 보는 중이거나 변경이 없으면 숨긴다. */
  canCommit: boolean;
}

/** 파일 목록 → 커밋 안 한 변경 수. 같은 파일이 스테이징·작업 트리 양쪽에 있어도 한 번만 센다. */
export function countUncommitted(entries: readonly StatusEntry[]): GitStatusInput["uncommitted"] {
  const all = new Set<string>();
  const staged = new Set<string>();
  const conflicts = new Set<string>();
  for (const e of entries) {
    all.add(e.path);
    if (e.staged) staged.add(e.path);
    if (e.status === "conflicted") conflicts.add(e.path);
  }
  return { total: all.size, staged: staged.size, conflicts: conflicts.size };
}

/** 보는 대상의 이름(「모든 브랜치」 포함). */
export function viewTargetLabel(target: ViewTarget, t: TFunction): string {
  return target.kind === "all" ? t("historyView.allBranches") : target.name;
}

/**
 * 상태 줄의 글을 만든다. 왼쪽부터 작업 트리 → 체크아웃 → upstream → 커밋 안 한 변경 순서다.
 * 특별한 상태는 우선순위(보는 중 → 진행 중 → 분리된 HEAD)대로 하나만 머리 글과 색을 차지한다.
 */
export function gitStatusLine(input: GitStatusInput, t: TFunction): GitStatusLineModel {
  const worktree = input.worktree.isMain
    ? t("statusLine.mainWorktree")
    : t("statusLine.linkedWorktree", { name: input.worktree.name });
  const shortSha = input.headSha ? input.headSha.slice(0, 7) : null;
  const checkout = input.branch
    ? t("statusLine.checkout", { branch: input.branch })
    : shortSha
      ? t("statusLine.detached", { sha: shortSha })
      : t("statusLine.detachedUnknown");

  const upstream =
    input.branch && input.hasRemote
      ? input.upstream
        ? {
            text: t("statusLine.upstream", {
              upstream: input.upstream.name,
              ahead: input.upstream.ahead,
              behind: input.upstream.behind,
            }),
            ahead: input.upstream.ahead,
            behind: input.upstream.behind,
            hasUpstream: true,
          }
        : { text: t("statusLine.noUpstream"), ahead: 0, behind: 0, hasUpstream: false }
      : null;

  const { total, staged, conflicts } = input.uncommitted;
  const uncommitted =
    total === 0
      ? t("statusLine.clean")
      : staged > 0
        ? t("statusLine.uncommittedStaged", { count: total, staged })
        : t("statusLine.uncommitted", { count: total });

  let tone: GitStatusTone = "normal";
  let headline: string | null = null;
  if (input.viewing) {
    tone = "viewing";
    headline = t("statusLine.viewing", { target: viewTargetLabel(input.viewing, t) });
  } else if (input.operation) {
    tone = "operation";
    const op = t(`statusLine.op.${input.operation}`);
    headline =
      conflicts > 0
        ? t("statusLine.operationConflicts", { op, count: conflicts })
        : t("statusLine.operation", { op });
  } else if (!input.branch) {
    tone = "detached";
    headline = t("statusLine.detachedHeadline");
  }

  return {
    tone,
    headline,
    worktree,
    checkout,
    // 진행 중인 작업·보는 중에는 push/pull을 권하지 않는다.
    upstream: tone === "normal" ? upstream : null,
    uncommitted,
    canCommit: tone !== "viewing" && total > 0,
  };
}

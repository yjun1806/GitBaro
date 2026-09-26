/**
 * 「범위 하나로 보기」의 단계: 워크스페이스 ⊃ 저장소 ⊃ 브랜치. 화면은 하나이고, 단계는
 * 레인 하나가 무엇이냐(저장소 · 워크트리 · 브랜치)만 정한다(시안 `scope-unify.html`).
 */
export type Scope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "repo"; repoPath: string }
  | {
      kind: "branch";
      repoPath: string;
      branch: string;
      /** 체크아웃된 워크트리 경로. 사이드바 「작업 중인 브랜치」 줄 중 체크아웃하지 않은 것이면 null. */
      worktreePath: string | null;
    };

/** {@link resolveScope}에 주는, 지금 앱 상태에서 뽑아낸 값. */
export interface ScopeAppState {
  /** 메인 칸에 띄운 워크스페이스(`useWorkspaceStore.activeWorkspaceId`). */
  activeWorkspaceId: string | null;
  /** 고른 저장소의 소유 저장소 경로(`findOwnerRepo`로 워크트리를 되짚은 값). 아무것도 안 골랐으면 null. */
  ownerRepoPath: string | null;
  /** 지금 연 워크트리 경로(`useRepositoryStore.activeRepoPath`). 메인 작업 트리를 열었으면 `ownerRepoPath`와 같다. */
  activeWorktreePath: string | null;
  /** 체크아웃한 브랜치. detached HEAD면 null. */
  currentBranch: string | null;
  /** 「저장소」 단계(모든 워크트리를 통틀어 봄)로 보는 중인 저장소 경로. 아니면 null(`useScopeStore`). */
  aggregateRepoPath: string | null;
  /**
   * 체크아웃하지 않고 보는 브랜치 이름(`useHistoryViewStore`의 `ref` 대상). 「모든 브랜치」
   * 보기(`{kind:"all"}`)는 단계가 아니라 저장소·브랜치 단계 안의 이력 탐색이라 여기 들어가지 않는다.
   */
  viewedBranch: string | null;
}

/**
 * 지금 앱 상태에서 범위를 정한다.
 * - 워크스페이스를 띄웠으면 워크스페이스 단계.
 * - 저장소를 골랐고 「저장소」 단계로 보는 중이면(사이드바 저장소 줄) 저장소 단계.
 * - 저장소를 골랐으면 브랜치 단계: 보는 브랜치가 있으면 그 브랜치, 없으면 체크아웃한 브랜치.
 *   detached HEAD라 브랜치를 하나로 못 정하면 저장소 단계로 떨어진다(레인이 하나뿐이라 결과는 같다).
 * - 저장소도 워크스페이스도 안 골랐으면(빈 화면) null.
 */
export function resolveScope(state: ScopeAppState): Scope | null {
  if (state.activeWorkspaceId !== null) {
    return { kind: "workspace", workspaceId: state.activeWorkspaceId };
  }
  if (state.ownerRepoPath === null) return null;
  if (state.aggregateRepoPath === state.ownerRepoPath) {
    return { kind: "repo", repoPath: state.ownerRepoPath };
  }
  const branch = state.viewedBranch ?? state.currentBranch;
  if (branch === null) return { kind: "repo", repoPath: state.ownerRepoPath };
  return {
    kind: "branch",
    repoPath: state.ownerRepoPath,
    branch,
    worktreePath: state.viewedBranch === null ? state.activeWorktreePath : null,
  };
}

/** 두 범위가 같은 곳을 가리키는지. */
export function sameScope(a: Scope | null, b: Scope | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "workspace" && b.kind === "workspace") return a.workspaceId === b.workspaceId;
  if (a.kind === "repo" && b.kind === "repo") return a.repoPath === b.repoPath;
  if (a.kind === "branch" && b.kind === "branch") return a.repoPath === b.repoPath && a.branch === b.branch;
  return false;
}

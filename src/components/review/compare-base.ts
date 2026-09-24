import { useMemo } from "react";
import type { TFunction } from "i18next";
import { create } from "zustand";
import { useRepositoryStore } from "@/stores/repository";
import { normalizePath } from "@/components/graph/graph-model";
import { useHistoryViewStore, viewTargetFor } from "@/stores/history-view";
import type { BranchChanges, ChangesScope } from "@/types";

interface CompareBaseState {
  /** 저장소(워크트리) 경로 → 사용자가 고른 비교 기준 브랜치. 없으면 기본 브랜치. */
  baseByPath: Readonly<Record<string, string>>;
  /** `base`가 null이면 기본 브랜치로 돌아간다. */
  setBase: (path: string, base: string | null) => void;
}

/**
 * 「main 대비 변경」의 비교 기준. 저장소(워크트리)마다 따로 기억하고, 앱을 다시 켜면 기본 브랜치로 돌아간다.
 */
export const useCompareBaseStore = create<CompareBaseState>()((set) => ({
  baseByPath: {},
  setBase: (path, base) =>
    set((state) => {
      const key = normalizePath(path);
      const rest = Object.fromEntries(Object.entries(state.baseByPath).filter(([p]) => p !== key));
      return { baseByPath: base ? { ...rest, [key]: base } : rest };
    }),
}));

/**
 * 경로마다의 비교 범위. 고른 기준 브랜치와, 지금 연 저장소에서 체크아웃하지 않고 보는 브랜치
 * (「모든 브랜치」 보기는 브랜치 하나가 아니라서 빼고 평소처럼 체크아웃을 보여 준다).
 */
export function useChangesScopes(paths: readonly string[]): (ChangesScope | null)[] {
  const baseByPath = useCompareBaseStore((s) => s.baseByPath);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  // 체크아웃한 브랜치를 보게 된 보기는 그래프 쪽(`useHistoryView`)이 곧 지운다.
  const target = useHistoryViewStore((s) => viewTargetFor(s, activeRepoPath));
  const viewed = target?.kind === "ref" ? target.name : null;
  const active = activeRepoPath ? normalizePath(activeRepoPath) : null;
  return useMemo(
    () =>
      paths.map((path) => {
        const key = normalizePath(path);
        const base = baseByPath[key] ?? null;
        const scopeTarget = key === active ? viewed : null;
        return base || scopeTarget ? { base, target: scopeTarget } : null;
      }),
    [paths, baseByPath, active, viewed],
  );
}

/** 커밋 안 한 변경은 같은 파일이 스테이징·작업 트리 두 줄로 나올 수 있어 경로로 센다. */
function uniquePathCount(files: readonly { path: string }[]): number {
  return new Set(files.map((f) => f.path)).size;
}

/** 비교 기준 이름: 고른 기준, 기본 브랜치 대비면 실제로 쓴 참조(`main`, `origin/main`), 모르면 기본 브랜치 이름. */
export function comparisonBaseName(changes: BranchChanges, chosenBase: string | null): string {
  return chosenBase ?? changes.baseRef ?? changes.defaultBranch ?? "main";
}

/**
 * 목록 맨 위의 설명 한 줄. 무엇과 무엇을 비교했는지, 파일이 몇 개고 그중 커밋·커밋 안 한 변경이 몇 개인지.
 * 갈라진 지점을 못 찾았거나 커밋이 없으면 그 사정을 말한다.
 */
export function changesSummary(
  changes: BranchChanges,
  scope: ChangesScope | null,
  t: TFunction,
): string {
  const chosenBase = scope?.base ?? null;
  if (changes.baseStatus === null) return t("filesByRepo.unborn");
  if (changes.baseStatus !== "found") {
    return t("filesByRepo.noBase", { branch: chosenBase ?? changes.defaultBranch ?? "main" });
  }
  const base = comparisonBaseName(changes, chosenBase);
  const branch = changes.branch ?? t("filesByRepo.detached");
  const viewing = Boolean(scope?.target);
  const committed = changes.committed.length;
  const uncommitted = uniquePathCount(changes.uncommitted);
  const count = changes.files.length;
  if (!chosenBase && !viewing && changes.branch !== null && changes.branch === changes.defaultBranch) {
    return t("filesByRepo.summaryOnDefault", { branch, base, count, committed, uncommitted });
  }
  if (viewing) return t("filesByRepo.summaryViewing", { branch, base, count, committed });
  return t("filesByRepo.summary", { branch, base, count, committed, uncommitted });
}

/**
 * 탭 이름에 넣을 기준 이름. 저장소 하나면 그 저장소의 기준, 여럿이면 모두 같을 때만 그 이름.
 * 모르면 null(탭은 「기본 브랜치 대비 변경」).
 */
export function tabBaseName(
  entries: readonly { changes: BranchChanges | undefined; scope: ChangesScope | null }[],
): string | null {
  const names = new Set<string>();
  for (const { changes, scope } of entries) {
    const name = scope?.base ?? changes?.defaultBranch ?? null;
    if (name === null) return null;
    names.add(name);
  }
  return names.size === 1 ? [...names][0] : null;
}

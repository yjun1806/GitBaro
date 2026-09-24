import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useBranches, useCommitHistoryInfinite } from "@/api/queries";
import { normalizePath, wipTarget } from "@/components/graph/graph-model";
import { wipBranchText } from "@/components/graph/GraphRow";

/**
 * 커밋 입력 머리의 「<브랜치>에 커밋 · <워크트리>」에 쓸 글자. 지금 연 워크트리의 브랜치(없으면 HEAD SHA)와
 * 워크트리 폴더 이름(메인 작업 트리면 「메인 작업 트리」). 그래프의 WIP 행과 같은 규칙(`wipTarget`)이다.
 */
export function useCommitTarget(): { branchText: string; worktreeText: string } {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerPath = useRepositoryStore((s) => s.activeRepo?.path ?? null);
  const { data: branches } = useBranches(activeRepoPath);
  const branch = branches?.find((b) => b.isHead && !b.isRemote)?.name ?? null;
  const { data: history } = useCommitHistoryInfinite(activeRepoPath);
  const headOid = history?.pages[0]?.[0]?.id ?? null;
  const isMain =
    activeRepoPath === null || ownerPath === null || normalizePath(ownerPath) === normalizePath(activeRepoPath);
  const target = wipTarget({ path: activeRepoPath ?? "", branch, isMain, headOid });
  return {
    // 브랜치 목록을 받기 전에는 「브랜치 없음」으로 잘못 말하지 않는다.
    branchText: branches === undefined ? "…" : (target.branch ?? wipBranchText(t, target)),
    worktreeText: target.worktree ?? t("graph.wipMainWorktree"),
  };
}

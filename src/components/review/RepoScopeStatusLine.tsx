import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { useOwnerRepoPath } from "@/stores/repository";
import { useActiveRepoName } from "@/hooks/useRepoDisplay";
import { useBranches, useWorktrees } from "@/api/queries";
import { cn } from "@/lib/utils";
import { STATUS_BAR_ROW_CLASS, TONE_CLASS } from "./GitStatusLine";
import { StatusActivity } from "./StatusActivity";
import { repoScopeStatusText } from "./repo-scope-status-line";

/**
 * 「저장소」 단계(사이드바 저장소 줄로 들어옴, 모든 워크트리를 통틀어 봄)의 창 맨 아래 상태 줄.
 * `GitStatusLineView`와 같은 자리·모양이지만 늘 보통 톤이다 — 이 단계에는 체크아웃·보는 중
 * 개념이 없다(그 저장소를 연 것 자체가 기본 폴더를 여는 일이라 분리된 HEAD 걱정도 없다).
 */
export function RepoScopeStatusLine() {
  const { t } = useTranslation();
  const repoPath = useOwnerRepoPath();
  const repoName = useActiveRepoName();
  const { data: branches = [] } = useBranches(repoPath);
  const { data: worktrees = [] } = useWorktrees(repoPath);
  const branch = branches.find((b) => b.isHead && !b.isRemote)?.name ?? null;
  const linkedWorktreeCount = worktrees.filter((w) => !w.isMain).length;

  return (
    <div role="status" data-tone="normal" className={cn(STATUS_BAR_ROW_CLASS, TONE_CLASS.normal)}>
      <Layers className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden="true" />
      <span className="truncate min-w-0">{repoScopeStatusText({ repoName, branch, linkedWorktreeCount }, t)}</span>
      <span className="flex-1" />
      <StatusActivity />
    </div>
  );
}

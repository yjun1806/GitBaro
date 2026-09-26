import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Eye, FolderGit2, GitBranch, Undo2 } from "lucide-react";
import { useOwnerRepoPath, useRepositoryStore } from "@/stores/repository";
import type { ViewTarget } from "@/stores/history-view";
import {
  useBranches,
  useCommitHistoryInfinite,
  useMergeState,
  useStatus,
  useUnpushedCommits,
  useWorktrees,
} from "@/api/queries";
import { useWorktreeContext } from "@/hooks/useWorktreeContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import type { BranchInfo, RemoteOp } from "@/types";
import { useCheckoutBranch } from "@/components/branch/useCheckoutBranch";
import { useHistoryView, useSetHistoryView } from "@/components/graph/useHistoryView";
import { MultiRepoRemoteDialog } from "./MultiRepoRemoteDialog";
import { StatusActivity } from "./StatusActivity";
import { countConflicts, gitStatusLine, type GitStatusLineModel, type GitStatusTone } from "./git-status-line";

/** 보는 원격 브랜치를 추적하는 로컬 브랜치가 있으면 그 이름으로 체크아웃한다. */
export function checkoutNameFor(target: ViewTarget, branches: readonly BranchInfo[]): string | null {
  if (target.kind === "all") return null;
  if (!target.isRemote) return target.name;
  return branches.find((b) => !b.isRemote && b.upstream === target.name)?.name ?? target.name;
}

/** upstream 칸을 누르면 열 확인 창. 받을 것이 있으면 pull, 없으면 push(원격 브랜치가 없으면 -u로 연결). */
export function remoteOpFor(upstream: NonNullable<GitStatusLineModel["upstream"]>): RemoteOp | null {
  if (upstream.behind > 0) return "pull";
  if (upstream.ahead > 0 || !upstream.hasUpstream) return "push";
  return null;
}

export const TONE_CLASS: Record<GitStatusTone, string> = {
  normal: "bg-background text-muted-foreground",
  viewing: "bg-info/10 text-foreground",
  operation: "bg-warning/10 text-foreground",
  detached: "bg-warning/10 text-foreground",
};

/**
 * 창 맨 아래 상태 막대 한 줄의 모양(2.3·2.5): 28px 높이, 카드 없는 경계라 위쪽에 1px `--line`
 * 하나만. 저장소 화면(`GitStatusLineView`)과 워크스페이스 화면(`WorkspaceStatusLine`)이 함께 쓴다.
 */
export const STATUS_BAR_ROW_CLASS =
  "flex items-center gap-2 h-7 pl-3 pr-2 shrink-0 border-t border-(--line) text-[11.5px] min-w-0 overflow-hidden";

function Dot() {
  return (
    <span aria-hidden="true" className="shrink-0 text-muted-foreground">
      ·
    </span>
  );
}

export interface GitStatusLineViewProps {
  model: GitStatusLineModel;
  /** 보는 중일 때 체크아웃할 브랜치. 모든 브랜치를 보면 null. */
  checkoutName: string | null;
  onCheckout: () => void;
  onBack: () => void;
  /** upstream 칸을 누를 때. 누를 것이 없으면 undefined. */
  onRemote?: () => void;
  /** 줄 오른쪽 끝(오프라인 표시·작업 기록 버튼). */
  trailing?: ReactNode;
}

/**
 * 창 맨 아래 상태 막대의 git 상태 줄(28px). 저장소 이름은 툴바가 말하고, 이 줄은 상태를 설명한다:
 * 작업 트리 · 체크아웃 · upstream. 수는 적지 않는다(사이드바·WIP 행·Push 버튼이 말한다). 보는 중·진행 중·분리된 HEAD는 줄의 색과
 * 머리 글을 바꾼다. 보는 중이면 이 줄이 「보는 중」 띠이고, 체크아웃·돌아가기 버튼을 단다.
 * 오른쪽 끝에는 도는 git 명령과 작업 기록 버튼, 오프라인일 때만 그 표시를 둔다(`trailing`).
 */
export function GitStatusLineView({
  model,
  checkoutName,
  onCheckout,
  onBack,
  onRemote,
  trailing,
}: GitStatusLineViewProps) {
  const { t } = useTranslation();
  const viewing = model.tone === "viewing";
  const HeadIcon = viewing ? Eye : AlertTriangle;
  return (
    <div role="status" data-tone={model.tone} className={cn(STATUS_BAR_ROW_CLASS, TONE_CLASS[model.tone])}>
      {model.headline && (
        <>
          <HeadIcon
            aria-hidden="true"
            className={cn("w-3.5 h-3.5 shrink-0", viewing ? "text-info" : "text-warning")}
          />
          <span className="shrink-0 font-semibold truncate max-w-[50%]">{model.headline}</span>
        </>
      )}
      {viewing && (
        <>
          {checkoutName && (
            <Button variant="primary" size="sm" onClick={onCheckout} icon={<GitBranch className="w-3 h-3" />}>
              {t("historyView.checkoutThis")}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onBack} icon={<Undo2 className="w-3 h-3" />}>
            {t("historyView.backToCurrent")}
          </Button>
        </>
      )}
      {model.headline && <Dot />}

      <span className={cn("flex items-center gap-2 min-w-0", viewing && "text-muted-foreground")}>
        <span className="inline-flex items-center gap-1 shrink-0">
          <FolderGit2 className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
          {model.worktree}
        </span>
        <Dot />
        <span className="font-mono truncate min-w-0" title={model.checkout}>
          {model.checkout}
        </span>
        {model.upstream && (
          <>
            <Dot />
            {onRemote ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRemote}
                title={model.upstream.title}
                className="tabular-nums -mx-1.5"
              >
                {model.upstream.text}
              </Button>
            ) : (
              <span className="shrink-0 tabular-nums" title={model.upstream.title}>
                {model.upstream.text}
              </span>
            )}
          </>
        )}
      </span>
      <span className="flex-1" />
      {trailing}
    </div>
  );
}

/** 지금 연 저장소(워크트리)의 git 상태 줄. 창 맨 아래 상태 막대(`StatusBar`)에 둔다. */
export function GitStatusLine() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const hasRemote = useRepositoryStore((s) => (s.activeRepo?.remotes.length ?? 0) > 0);
  const ownerRepoPath = useOwnerRepoPath();
  const { data: branches = [] } = useBranches(activeRepoPath);
  const { data: statusFiles = [] } = useStatus(activeRepoPath);
  const { data: operation = null } = useMergeState(activeRepoPath);
  const { data: worktrees = [] } = useWorktrees(ownerRepoPath);
  const { currentWorktree } = useWorktreeContext(activeRepoPath, worktrees);
  const { data: history } = useCommitHistoryInfinite(activeRepoPath);
  const { data: unpushed } = useUnpushedCommits(activeRepoPath);
  const { target } = useHistoryView();
  const setView = useSetHistoryView();
  const { checkout, element: checkoutDialog } = useCheckoutBranch();
  const [remoteOp, setRemoteOp] = useState<RemoteOp | null>(null);

  const head = branches.find((b) => b.isHead && !b.isRemote) ?? null;
  const worktreeName = currentWorktree?.path.split("/").filter(Boolean).pop() ?? "";
  const model = gitStatusLine(
    {
      worktree: { isMain: !currentWorktree || currentWorktree.isMain, name: worktreeName },
      branch: head?.name ?? null,
      headSha: history?.pages[0]?.[0]?.id ?? currentWorktree?.head ?? null,
      upstream: head?.upstream
        ? {
            name: head.upstream,
            ahead: head.aheadBehind?.ahead ?? 0,
            behind: head.aheadBehind?.behind ?? 0,
          }
        : null,
      unpushed: unpushed?.count ?? head?.aheadBehind?.ahead ?? 0,
      hasRemote,
      conflicts: countConflicts(statusFiles),
      operation,
      viewing: target,
    },
    t,
  );
  const op = model.upstream ? remoteOpFor(model.upstream) : null;
  const checkoutName = target ? checkoutNameFor(target, branches) : null;

  return (
    <>
      <GitStatusLineView
        model={model}
        checkoutName={checkoutName}
        onCheckout={() => checkoutName && checkout(checkoutName)}
        onBack={() => setView(null)}
        onRemote={op && activeRepoPath ? () => setRemoteOp(op) : undefined}
        trailing={<StatusActivity />}
      />
      {remoteOp && activeRepoPath && (
        <MultiRepoRemoteDialog paths={[activeRepoPath]} op={remoteOp} onClose={() => setRemoteOp(null)} />
      )}
      {checkoutDialog}
    </>
  );
}

import type { MouseEvent } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { useWorktrees } from "@/api/queries";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import type { PathSignals, RepoNode } from "@/lib/repo-tree";
import { cn } from "@/lib/utils";
import type { RepoInfo } from "@/types";
import { LiveDot, RowBadges } from "./RowBadges";
import { TreeRowFrame } from "./TreeRowFrame";
import { WorktreeRow } from "./WorktreeRow";
import { isLivePath, repoPaths, repoTotals } from "./tree-model";

/** 행이 「작업 중」인지와, 실시간 감시로 알게 된 것인지. */
export interface LiveState {
  lastChangedAt: Record<string, number>;
  overflow: string[];
  now: number;
}

function liveOf(paths: string[], live: LiveState): { live: boolean; watched: boolean } {
  const livePaths = paths.filter((p) => isLivePath(p, live.lastChangedAt, live.now));
  return {
    live: livePaths.length > 0,
    watched: livePaths.some((p) => !live.overflow.includes(p)),
  };
}

interface RepoRowProps {
  node: RepoNode;
  level: number;
  depth: number;
  /** 저장소의 지금 브랜치(둘째 줄). 모르면 null. */
  branch: string | null;
  signals: Record<string, PathSignals>;
  liveState: LiveState;
  /** 지금 보고 있는 경로(`activeRepoPath`). 저장소나 워크트리 중 하나와 같으면 그 행이 선택된다. */
  activePath: string | null;
  expanded: boolean;
  fetching: boolean;
  onToggle: () => void;
  onSelectRepo: (repo: RepoInfo) => void;
  onSelectWorktree: (repo: RepoInfo, worktreePath: string) => void;
  onContextMenu: (repo: RepoInfo, e: MouseEvent) => void;
}

/**
 * 저장소 행과, 펼쳤을 때 그 아래 워크트리 행들.
 * 오른쪽 표시는 저장소와 워크트리 전체의 합계(커밋하지 않은 파일·새 커밋)와 메인 작업 트리의 ↑↓다.
 */
export function RepoRow({
  node,
  level,
  depth,
  branch,
  signals,
  liveState,
  activePath,
  expanded,
  fetching,
  onToggle,
  onSelectRepo,
  onSelectWorktree,
  onContextMenu,
}: RepoRowProps) {
  const { repo, worktrees } = node;
  const hasWorktrees = worktrees.length > 0;
  const showWorktrees = hasWorktrees && expanded;
  // 워크트리의 기반 브랜치는 펼친 저장소만 읽는다(`useWorktrees`는 저장소마다 한 번 조회).
  const { data: worktreeInfos = [] } = useWorktrees(showWorktrees ? repo.path : null);
  const color = avatarColor(repo.path);
  const totals = repoTotals(node, signals);
  const own = signals[repo.path];
  const { live, watched } = liveOf(repoPaths(node), liveState);
  const selected = activePath === repo.path;

  return (
    <>
      <TreeRowFrame
        level={level}
        depth={depth}
        label={repo.name}
        expanded={hasWorktrees ? expanded : undefined}
        selected={selected}
        onSelect={() => onSelectRepo(repo)}
        onToggle={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(repo, e);
        }}
      >
        <span className="relative flex shrink-0">
          <span
            aria-hidden="true"
            className="w-5 h-5 rounded-[var(--radius-chip)] flex items-center justify-center text-[10px] font-extrabold"
            style={{ backgroundColor: color.background, color: color.foreground }}
          >
            {avatarInitial(repo.name)}
          </span>
          {live && <LiveDot watched={watched} className="absolute -left-0.5 -top-0.5" />}
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-px">
          <span
            className={cn(
              "text-[12.5px] text-foreground truncate",
              selected ? "font-bold" : "font-medium",
            )}
          >
            {repo.name}
          </span>
          {branch && (
            <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground min-w-0">
              <GitBranch className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{branch}</span>
            </span>
          )}
        </span>
        {fetching && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
        <RowBadges
          dirty={totals.dirty}
          newCommits={totals.newCommits}
          ahead={own?.ahead}
          behind={own?.behind}
        />
      </TreeRowFrame>
      {showWorktrees &&
        worktrees.map((wt) => {
          const wtLive = liveOf([wt.path], liveState);
          return (
            <WorktreeRow
              key={wt.key}
              path={wt.path}
              branch={wt.branch}
              base={worktreeInfos.find((w) => w.path === wt.path)?.base ?? null}
              level={level + 1}
              depth={depth + 1}
              signals={signals[wt.path]}
              live={wtLive.live}
              watched={wtLive.watched}
              selected={activePath === wt.path}
              onSelect={() => onSelectWorktree(repo, wt.path)}
            />
          );
        })}
    </>
  );
}

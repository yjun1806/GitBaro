import type { MouseEvent } from "react";
import { Loader2, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import type { PathSignals, RepoNode } from "@/lib/repo-tree";
import { cn } from "@/lib/utils";
import type { RepoInfo } from "@/types";
import { LiveDot } from "./LiveDot";
import { RowSubline } from "./RowSubline";
import { liveDotLabel, metaLineParts, metaLineText } from "./row-meta";
import { LEADING_TILE, ROW_TITLE } from "./row-style";
import { DraggableRow, DropAfterLine } from "./TreeDnd";
import { TreeRowFrame } from "./TreeRowFrame";
import { WorktreeRow } from "./WorktreeRow";
import { isLivePath, isWatchedPath, repoPaths, repoTotals } from "./tree-model";
import { useWorktreeBases } from "./useWorktreeBases";

/** 행이 「작업 중」인지와, 실시간 감시로 알게 된 것인지. */
export interface LiveState {
  lastChangedAt: Record<string, number>;
  /** 백엔드가 실시간 감시 중인 경로. */
  watched: string[];
  overflow: string[];
  now: number;
}

function liveOf(paths: string[], live: LiveState): { live: boolean; watched: boolean; at: number } {
  const livePaths = paths.filter((p) => isLivePath(p, live.lastChangedAt, live.now));
  return {
    live: livePaths.length > 0,
    watched: livePaths.some((p) => isWatchedPath(p, live.watched, live.overflow)),
    at: Math.max(0, ...livePaths.map((p) => live.lastChangedAt[p] ?? 0)),
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
  /**
   * 지금 보고 있는 경로를 가진 저장소(`activeRepo.path`). 이 저장소의 워크트리를 보는 중인데
   * 워크트리 행이 보이지 않으면(접힘) 저장소 행을 선택된 것으로 그린다.
   */
  activeOwnerPath: string | null;
  favorite: boolean;
  expanded: boolean;
  fetching: boolean;
  /** 끌어서 옮길 수 있는지. 검색 중에는 끈다. */
  draggable: boolean;
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
  activeOwnerPath,
  favorite,
  expanded,
  fetching,
  draggable,
  onToggle,
  onSelectRepo,
  onSelectWorktree,
  onContextMenu,
}: RepoRowProps) {
  const { t } = useTranslation();
  const { repo, worktrees } = node;
  const hasWorktrees = worktrees.length > 0;
  const showWorktrees = hasWorktrees && expanded;
  // 워크트리의 기반 브랜치는 펼친 저장소만 읽는다(오래 캐시하는 별도 조회 — `useWorktreeBases`).
  const bases = useWorktreeBases(
    showWorktrees ? repo.path : null,
    worktrees.map((w) => w.path),
  );
  const color = avatarColor(repo.path);
  const totals = repoTotals(node, signals);
  const own = signals[repo.path];
  const { live, watched, at } = liveOf(repoPaths(node), liveState);
  const viewingHiddenWorktree =
    activeOwnerPath === repo.path &&
    activePath !== repo.path &&
    !(showWorktrees && worktrees.some((w) => w.path === activePath));
  const selected = activePath === repo.path || viewingHiddenWorktree;
  // 둘째 줄: 「⎇ 브랜치 · 수정 N · 새 커밋 N · ↑a ↓b」(수정·새 커밋은 워크트리까지 더한 합계, ↑↓는 메인 작업 트리).
  const parts = metaLineParts(
    { dirty: totals.dirty, newCommits: totals.newCommits, ahead: own?.ahead, behind: own?.behind },
    t,
  );
  const tooltip = [repo.name, branch, metaLineText(parts)].filter(Boolean).join("\n");
  const liveDot = live ? <LiveDot watched={watched} label={liveDotLabel(t, watched, liveState.now, at)} /> : null;

  return (
    <>
      <DraggableRow
        id={node.key}
        kind="repo"
        label={repo.name}
        depth={depth}
        path={repo.path}
        branch={branch}
        badges={liveDot}
        groupBelow={showWorktrees}
        disabled={!draggable}
      >
        <TreeRowFrame
          level={level}
          depth={depth}
          treePath={repo.path}
          label={repo.name}
          expanded={hasWorktrees ? expanded : undefined}
          selected={selected}
          onSelect={() => onSelectRepo(repo)}
          onToggle={onToggle}
          tall
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(repo, e);
          }}
        >
          <span className="relative flex shrink-0">
            <span
              aria-hidden="true"
              className={`${LEADING_TILE} text-[10px] font-extrabold`}
              style={{
                backgroundColor: color.background,
                color: color.foreground,
              }}
            >
              {avatarInitial(repo.name)}
            </span>
          </span>
          <span className="flex-1 min-w-0 flex flex-col gap-px" title={tooltip}>
            <span
              className={cn(ROW_TITLE, selected ? "font-bold" : "font-medium")}
            >
              {repo.name}
              {favorite && (
                <Star
                  className="inline-block ml-1 w-2.5 h-2.5 align-[-1px] fill-current text-[var(--faint)]"
                  role="img"
                  aria-label={t("sidebarTree.favorite")}
                />
              )}
            </span>
            <RowSubline branch={branch} parts={parts} />
          </span>
          {fetching && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />}
          {liveDot}
        </TreeRowFrame>
      </DraggableRow>
      {showWorktrees &&
        worktrees.map((wt) => {
          const wtLive = liveOf([wt.path], liveState);
          return (
            <WorktreeRow
              key={wt.key}
              path={wt.path}
              branch={wt.branch}
              base={bases[wt.path] ?? null}
              level={level + 1}
              depth={depth + 1}
              signals={signals[wt.path]}
              live={wtLive.live}
              watched={wtLive.watched}
              changedAt={wtLive.at}
              now={liveState.now}
              selected={activePath === wt.path}
              onSelect={() => onSelectWorktree(repo, wt.path)}
            />
          );
        })}
      {showWorktrees && <DropAfterLine id={node.key} depth={depth} />}
    </>
  );
}

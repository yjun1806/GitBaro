import type { MouseEvent } from "react";
import { GitBranch, GitPullRequest, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepoAvatarColor, useRepoName } from "@/hooks/useRepoDisplay";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import type { RepoNode } from "@/lib/repo-tree";
import { cn } from "@/lib/utils";
import type { ViewTarget } from "@/stores/history-view";
import type { RepoInfo } from "@/types";
import { RowSignals, type RowSignalValues } from "./RowSignals";
import {
  BRANCH_MAX_CHARS,
  ROW_BRANCH,
  ROW_ICON_SLOT,
  ROW_TITLE,
  SIDEBAR_CARD,
} from "./row-style";
import { DraggableRow, DropAfterLine } from "./TreeDnd";
import { TreeRowFrame } from "./TreeRowFrame";
import type { FolderRow } from "./useSidebarRowMenus";
import { isLivePath, isWatchedPath, repoPaths, sumDedupedByRepo, type WorkingBranchRow } from "./tree-model";
import type { SidebarTreeData } from "./useSidebarTreeData";
import { Spinner } from "@/components/ui/Spinner";
import { useSteadyFlag } from "@/hooks/useSteadyValue";
import { RepoTile } from "@/components/ui/marks";

/** 행 선택과 브랜치 보기에 쓰는 지금 상태. */
export interface RepoSelection {
  /** 지금 보고 있는 경로(`activeRepoPath`, 워크트리를 보면 그 경로). */
  activePath: string | null;
  /** 지금 보고 있는 경로를 가진 저장소(`activeRepo.path`). */
  activeOwnerPath: string | null;
  /** 지금 경로에서 체크아웃하지 않고 보는 브랜치. 없으면 null. */
  viewing: ViewTarget | null;
}

export interface RepoActions {
  onSelectRepo: (repo: RepoInfo) => void;
  onSelectWorktree: (repo: RepoInfo, worktreePath: string) => void;
  /** 저장소의 기본 폴더를 열고 그 자리에서 브랜치를 체크아웃하지 않고 본다. */
  onViewBranch: (repo: RepoInfo, target: ViewTarget) => void;
  onContextMenu: (repo: RepoInfo, e: MouseEvent) => void;
  /** 작업 폴더 줄 우클릭(`useSidebarRowMenus`). */
  onFolderContextMenu?: (repo: RepoInfo, folder: FolderRow, e: MouseEvent) => void;
  /** 체크아웃하지 않은 작업 중인 브랜치 줄 우클릭. */
  onViewContextMenu?: (repo: RepoInfo, target: Extract<ViewTarget, { kind: "ref" }>, e: MouseEvent) => void;
}

/**
 * 경로 하나(또는 여럿의 합)의 오른쪽 표시 값.
 *
 * `ahead`·`behind`는 저장소별로 최댓값을 구한 뒤 저장소끼리 더한다(`sumDedupedByRepo`) — 한 저장소의
 * 워크트리 여러 개가 같은 원격 커밋을 가리켜도(예: 서로 다른 브랜치가 같은 upstream을 추적) 두 번
 * 세지 않기 위해서다. `paths`가 여러 저장소에 걸치면(워크스페이스 카드 합계) 저장소별 최댓값을 그대로 더한다.
 */
export function signalValues(paths: string[], data: SidebarTreeData): RowSignalValues {
  const livePaths = paths.filter((p) => isLivePath(p, data.lastChangedAt, data.now));
  const repoOf = (path: string) => data.reviewByPath[path]?.repoPath ?? path;
  return {
    dirty: paths.reduce((acc, p) => acc + (data.signals[p]?.dirtyCount ?? 0), 0),
    live: livePaths.length > 0,
    watched: livePaths.some((p) => isWatchedPath(p, data.watched, data.overflow)),
    changedAt: Math.max(0, ...livePaths.map((p) => data.lastChangedAt[p] ?? 0)),
    ahead: sumDedupedByRepo(paths, repoOf, (p) => data.signals[p]?.ahead ?? 0),
    behind: sumDedupedByRepo(paths, repoOf, (p) => data.signals[p]?.behind ?? 0),
  };
}

export function RepoAvatar({ repo }: { repo: RepoInfo }) {
  const color = useRepoAvatarColor()(repo.path);
  const name = useRepoName()(repo);
  return <RepoTile name={name} color={color} size="md" />;
}

interface FolderRowsProps {
  node: RepoNode;
  level: number;
  depth: number;
  data: SidebarTreeData;
  selection: RepoSelection;
  actions: RepoActions;
}

/** 체크아웃하지 않은 작업 중인 브랜치 줄 하나(`RepoFolderRows` 안에서만 쓴다). */
function WorkingBranchRowView({
  repo,
  row,
  level,
  depth,
  now,
  selected,
  onSelect,
  onContextMenu,
}: {
  repo: RepoInfo;
  row: WorkingBranchRow;
  level: number;
  depth: number;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const { branch, reasons, prNumber } = row;
  const hasPr = reasons.includes("openPr");
  return (
    <TreeRowFrame
      level={level}
      depth={depth}
      label={branch.name}
      selected={selected}
      hover={{
        kind: "branch",
        repoPath: repo.path,
        branch: branch.name,
        reasons,
        prNumber,
        unpushed: branch.unpushed,
        behind: branch.behind,
      }}
      className="animate-reveal"
      onSelect={onSelect}
      onContextMenu={onContextMenu}
    >
      <span className={ROW_ICON_SLOT}>
        {hasPr ? (
          <GitPullRequest className="w-3 h-3" aria-hidden="true" />
        ) : (
          <GitBranch className="w-3 h-3" aria-hidden="true" />
        )}
      </span>
      <span className={cn(ROW_BRANCH, "text-muted-foreground")}>
        {middleEllipsis(branch.name, BRANCH_MAX_CHARS)}
      </span>
      <RowSignals
        values={{ dirty: 0, live: false, watched: false, changedAt: 0, ahead: branch.unpushed, behind: branch.behind }}
        now={now}
      />
    </TreeRowFrame>
  );
}

/**
 * 저장소 카드 안 줄: 기본 폴더, 링크된 워크트리마다 한 줄, 그리고 그 밖의 작업 중인 브랜치 줄
 * (체크아웃하지 않았지만 원격에 없는 커밋이 있거나, 열린 PR이 있거나, 최근에 커밋했고 병합되지 않은 것 —
 * `workingBranchRowsOf`, 5.2). 모두 한 줄 28px이고, 이름은 폴더가 아니라 브랜치다(detached면 짧은 커밋).
 */
export function RepoFolderRows({ node, level, depth, data, selection, actions }: FolderRowsProps) {
  const { t } = useTranslation();
  const { repo, worktrees } = node;
  const folders = [
    { path: repo.path, isPrimary: true },
    ...worktrees.map((w) => ({ path: w.path, isPrimary: false })),
  ];
  const branchLabel = (path: string) => {
    const branch = data.branchOf(path);
    if (branch) return branch;
    const head = data.reviewByPath[path]?.headOid;
    return head ? head.slice(0, 7) : t("sidebarTree.card.detached");
  };
  const viewingHere = selection.activePath === repo.path ? selection.viewing : null;

  return (
    <>
      {folders.map(({ path, isPrimary }) => {
        const label = branchLabel(path);
        const selected = selection.activePath === path && !(isPrimary && viewingHere);
        return (
          <TreeRowFrame
            key={path}
            level={level}
            depth={depth}
            treePath={path}
            label={isPrimary ? `${label} · ${t("sidebarTree.card.primaryFolder")}` : label}
            selected={selected}
            hover={{ kind: "worktree", repoPath: repo.path, path, isPrimary }}
            className="animate-reveal"
            onSelect={() => (isPrimary ? actions.onSelectRepo(repo) : actions.onSelectWorktree(repo, path))}
            onContextMenu={(e) => actions.onFolderContextMenu?.(repo, { path, isPrimary, branch: data.branchOf(path) }, e)}
          >
            <span className={ROW_ICON_SLOT}>
              <GitBranch className="w-3 h-3" aria-hidden="true" />
            </span>
            <span className={cn(ROW_BRANCH, selected ? "text-foreground font-semibold" : "text-(--fg2)")}>
              {middleEllipsis(label, BRANCH_MAX_CHARS)}
            </span>
            <RowSignals values={signalValues([path], data)} now={data.now} />
          </TreeRowFrame>
        );
      })}
      {data.workingBranchRowsOf(repo.path).map((row) => {
        const target: Extract<ViewTarget, { kind: "ref" }> = { kind: "ref", name: row.branch.name, isRemote: false };
        return (
          <WorkingBranchRowView
            key={row.branch.name}
            repo={repo}
            row={row}
            level={level}
            depth={depth}
            now={data.now}
            selected={viewingHere?.kind === "ref" && viewingHere.name === row.branch.name}
            onSelect={() => actions.onViewBranch(repo, target)}
            onContextMenu={(e) => actions.onViewContextMenu?.(repo, target, e)}
          />
        );
      })}
    </>
  );
}

interface RepoCardProps {
  node: RepoNode;
  data: SidebarTreeData;
  selection: RepoSelection;
  actions: RepoActions;
  favorite: boolean;
  expanded: boolean;
  fetching: boolean;
  /** 끌어서 옮길 수 있는지. 검색 중에는 끈다. */
  draggable: boolean;
  onToggle: () => void;
}

/**
 * 계정 바로 아래 저장소 하나 = 흰 카드 하나. 머리 줄(아바타 · 이름 · 즐겨찾기)을 누르면 기본 폴더를 연다.
 * 펼치면 작업 폴더 줄과 그 밖의 작업 중인 브랜치 줄이 이어진다. 접으면 머리 줄에 전체 합계 표시를 둔다.
 */
export function RepoCard({
  node,
  data,
  selection,
  actions,
  favorite,
  expanded,
  fetching,
  draggable,
  onToggle,
}: RepoCardProps) {
  const { repo } = node;
  const repoName = useRepoName();
  const paths = repoPaths(node);
  const headerSelected = !expanded && selection.activeOwnerPath === repo.path;
  return (
    <>
      <div className={cn(SIDEBAR_CARD, "animate-reveal")} role="none" data-repo-card={repo.path}>
        <DraggableRow
          id={node.key}
          kind="repo"
          label={repoName(repo)}
          depth={0}
          path={repo.path}
          branch={data.branchOf(repo.path)}
          groupBelow={expanded}
          disabled={!draggable}
        >
          <RepoHeaderRow
            repo={repo}
            level={2}
            depth={0}
            paths={paths}
            data={data}
            favorite={favorite}
            fetching={fetching}
            expanded={expanded}
            selected={headerSelected}
            onSelect={() => actions.onSelectRepo(repo)}
            onToggle={onToggle}
            onContextMenu={(e) => actions.onContextMenu(repo, e)}
          />
        </DraggableRow>
        {expanded && (
          <RepoFolderRows node={node} level={3} depth={0} data={data} selection={selection} actions={actions} />
        )}
      </div>
      {expanded && <DropAfterLine id={node.key} depth={0} />}
    </>
  );
}

interface RepoHeaderRowProps {
  repo: RepoInfo;
  level: number;
  depth: number;
  /** 저장소의 모든 작업 폴더 경로. 접혔을 때 합계 표시와 자세한 정보 카드에 쓴다. */
  paths: string[];
  data: SidebarTreeData;
  favorite?: boolean;
  fetching?: boolean;
  expanded: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (e: MouseEvent) => void;
}

/** 저장소 머리 줄(카드 맨 위, 또는 워크스페이스 카드 안 저장소 줄). */
export function RepoHeaderRow({
  repo,
  level,
  depth,
  paths,
  data,
  favorite = false,
  fetching = false,
  expanded,
  selected,
  onSelect,
  onToggle,
  onContextMenu,
}: RepoHeaderRowProps) {
  const { t } = useTranslation();
  const name = useRepoName()(repo);
  // 워크스페이스의 저장소를 차례로 fetch할 때 줄마다 깜박이지 않게 고르게 한다.
  const showFetching = useSteadyFlag(fetching);
  return (
    <TreeRowFrame
      level={level}
      depth={depth}
      treePath={repo.path}
      label={name}
      expanded={expanded}
      selected={selected}
      hover={{ kind: "repo", repoPath: repo.path, paths }}
      onSelect={onSelect}
      onToggle={onToggle}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
    >
      <RepoAvatar repo={repo} />
      <span className={cn(ROW_TITLE, "font-semibold")}>
        {name}
        {favorite && (
          <Star
            className="inline-block ml-1 w-2.5 h-2.5 align-[-1px] fill-current text-muted-foreground"
            role="img"
            aria-label={t("sidebarTree.favorite")}
          />
        )}
      </span>
      {showFetching && <Spinner size="sm" className="text-muted-foreground" label={t("sync.fetching")} />}
      {!expanded && <RowSignals values={signalValues(paths, data)} now={data.now} />}
    </TreeRowFrame>
  );
}

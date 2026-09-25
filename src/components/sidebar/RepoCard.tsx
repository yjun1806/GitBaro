import type { MouseEvent } from "react";
import { Eye, GitBranch, Loader2, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getBranches } from "@/api/commands";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { middleEllipsis } from "@/lib/middle-ellipsis";
import type { RepoNode } from "@/lib/repo-tree";
import { cn } from "@/lib/utils";
import type { ViewTarget } from "@/stores/history-view";
import type { RepoInfo } from "@/types";
import { RowSignals, type RowSignalValues } from "./RowSignals";
import {
  BRANCH_MAX_CHARS,
  LEADING_TILE,
  ROW_BRANCH,
  ROW_ICON_SLOT,
  ROW_TITLE,
  SIDEBAR_CARD,
} from "./row-style";
import { DraggableRow, DropAfterLine } from "./TreeDnd";
import { TreeRowFrame } from "./TreeRowFrame";
import type { FolderRow } from "./useSidebarRowMenus";
import { isLivePath, isWatchedPath, repoPaths } from "./tree-model";
import type { SidebarTreeData } from "./useSidebarTreeData";

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
  /** 보기만 하는 기본 브랜치 줄 우클릭. */
  onViewContextMenu?: (repo: RepoInfo, target: Extract<ViewTarget, { kind: "ref" }>, e: MouseEvent) => void;
}

/** 경로 하나(또는 여럿의 합)의 오른쪽 표시 값. */
export function signalValues(paths: string[], data: SidebarTreeData): RowSignalValues {
  const livePaths = paths.filter((p) => isLivePath(p, data.lastChangedAt, data.now));
  return {
    dirty: paths.reduce((acc, p) => acc + (data.signals[p]?.dirtyCount ?? 0), 0),
    live: livePaths.length > 0,
    watched: livePaths.some((p) => isWatchedPath(p, data.watched, data.overflow)),
    changedAt: Math.max(0, ...livePaths.map((p) => data.lastChangedAt[p] ?? 0)),
    ahead: paths.reduce((acc, p) => acc + (data.signals[p]?.ahead ?? 0), 0),
  };
}

/**
 * 체크아웃하지 않고 볼 기본 브랜치. 로컬 기본 브랜치가 있으면 그것을, 없으면 원격 기본 브랜치를 쓴다.
 * 작업 폴더 중 하나가 이미 체크아웃하고 있으면 그 줄이 대신하므로 null.
 */
export function viewOnlyDefaultBranch(
  branches: readonly { name: string; isRemote: boolean; isDefault: boolean }[] | undefined,
  checkedOut: readonly (string | null)[],
): ViewTarget | null {
  const def = branches?.find((b) => b.isDefault && !b.isRemote) ?? branches?.find((b) => b.isDefault && b.isRemote);
  if (!def) return null;
  const shortName = def.isRemote ? def.name.slice(def.name.indexOf("/") + 1) : def.name;
  if (checkedOut.includes(def.name) || checkedOut.includes(shortName)) return null;
  return { kind: "ref", name: def.name, isRemote: def.isRemote };
}

/** 기본 브랜치는 거의 바뀌지 않으므로 오래 둔다. */
const DEFAULT_BRANCH_STALE_MS = 5 * 60_000;

/**
 * 카드의 보기 줄에 쓸 브랜치 목록. 툴바가 쓰는 `["branches", path]` 키는 fetch·체크아웃 때마다 모든
 * 저장소 것이 한꺼번에 무효화되어, 펼친 카드 수만큼 다시 불린다. 그래서 사이드바는 별도 키로 5분 둔다.
 * 어느 폴더가 무엇을 체크아웃했는지는 이 목록이 아니라 동기화 상태(`branchOf`)로 판단한다.
 */
function useSidebarBranches(repoPath: string) {
  return useQuery({
    queryKey: ["sidebarBranches", repoPath],
    queryFn: () => getBranches(repoPath),
    staleTime: DEFAULT_BRANCH_STALE_MS,
    refetchOnWindowFocus: false,
  }).data;
}

export function RepoAvatar({ repo }: { repo: RepoInfo }) {
  const color = avatarColor(repo.path);
  return (
    <span
      aria-hidden="true"
      className={`${LEADING_TILE} text-[9.5px] font-extrabold`}
      style={{ backgroundColor: color.background, color: color.foreground }}
    >
      {avatarInitial(repo.name)}
    </span>
  );
}

interface FolderRowsProps {
  node: RepoNode;
  level: number;
  depth: number;
  data: SidebarTreeData;
  selection: RepoSelection;
  actions: RepoActions;
}

/**
 * 저장소 카드 안 줄: 기본 폴더, 링크된 워크트리마다 한 줄, 그리고 어느 폴더도 체크아웃하지 않은
 * 기본 브랜치(보기만). 모두 한 줄 28px이고, 이름은 폴더가 아니라 브랜치다(detached면 짧은 커밋).
 */
export function RepoFolderRows({ node, level, depth, data, selection, actions }: FolderRowsProps) {
  const { t } = useTranslation();
  const { repo, worktrees } = node;
  const branches = useSidebarBranches(repo.path);
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
  const viewTarget = viewOnlyDefaultBranch(
    branches,
    folders.map((f) => data.branchOf(f.path)),
  );
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
      {viewTarget?.kind === "ref" && (
        <TreeRowFrame
          level={level}
          depth={depth}
          label={t("sidebarTree.card.viewBranchLabel", { branch: viewTarget.name })}
          selected={viewingHere?.kind === "ref" && viewingHere.name === viewTarget.name}
          hover={{ kind: "branch", repoPath: repo.path, branch: viewTarget.name }}
          onSelect={() => actions.onViewBranch(repo, viewTarget)}
          onContextMenu={(e) => actions.onViewContextMenu?.(repo, viewTarget, e)}
        >
          <span className={ROW_ICON_SLOT}>
            <Eye className="w-3 h-3" aria-hidden="true" />
          </span>
          <span className={cn(ROW_BRANCH, "text-muted-foreground")}>
            {middleEllipsis(viewTarget.name, BRANCH_MAX_CHARS)}
          </span>
        </TreeRowFrame>
      )}
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
 * 펼치면 작업 폴더 줄과 보기만 하는 기본 브랜치 줄이 이어진다. 접으면 머리 줄에 전체 합계 표시를 둔다.
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
  const paths = repoPaths(node);
  const headerSelected = !expanded && selection.activeOwnerPath === repo.path;
  return (
    <>
      <div className={SIDEBAR_CARD} role="none" data-repo-card={repo.path}>
        <DraggableRow
          id={node.key}
          kind="repo"
          label={repo.name}
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
  return (
    <TreeRowFrame
      level={level}
      depth={depth}
      treePath={repo.path}
      label={repo.name}
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
        {repo.name}
        {favorite && (
          <Star
            className="inline-block ml-1 w-2.5 h-2.5 align-[-1px] fill-current text-[var(--faint)]"
            role="img"
            aria-label={t("sidebarTree.favorite")}
          />
        )}
      </span>
      {fetching && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />}
      {!expanded && <RowSignals values={signalValues(paths, data)} now={data.now} />}
    </TreeRowFrame>
  );
}

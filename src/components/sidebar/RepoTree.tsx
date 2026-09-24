import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { repoNodeKey, workspaceNodeKey, type AccountNode, type RepoNode } from "@/lib/repo-tree";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useHistoryViewStore, viewTargetFor, type ViewTarget } from "@/stores/history-view";
import { useSetHistoryView } from "@/components/graph/useHistoryView";
import type { RepoInfo } from "@/types";
import { AccountHeader } from "./AccountHeader";
import { AddRepoButton } from "./AddRepoButton";
import { QuietReposRow } from "./QuietReposRow";
import { RepoCard, RepoFolderRows, RepoHeaderRow, signalValues, type RepoActions, type RepoSelection } from "./RepoCard";
import { SIDEBAR_CARD, SIDEBAR_ICON_BUTTON, TILE_ICON } from "./row-style";
import { SidebarHoverCardProvider } from "./SidebarHoverCard";
import { DraggableRow, DropAfterLine, TreeDndProvider } from "./TreeDnd";
import { WorkspaceRow } from "./WorkspaceRow";
import { WorkspaceSuggestion } from "./WorkspaceSuggestion";
import {
  collapsibleKeys,
  expandedWorktreePaths,
  filterTree,
  repoPaths,
  workspaceRepoKey,
} from "./tree-model";
import { useSidebarWatchPaths, type SidebarTreeData } from "./useSidebarTreeData";

interface RepoTreeProps {
  data: SidebarTreeData;
  fetchingPath: string | null;
  /**
   * 저장소를 연다(`useSelectRepo`). `useSelectRepo`는 기억해 둔 워크트리가 있으면 그리로 여므로,
   * 트리는 부르기 전에 열 곳(기본 폴더 또는 고른 워크트리)을 먼저 기억시킨다.
   */
  onSelectRepo: (path: string) => void;
  onRepoContextMenu: (repo: RepoInfo, e: MouseEvent) => void;
}

function workspaceMemberCounts(tree: AccountNode[]): Map<string, number> {
  return new Map(
    tree.flatMap((account) =>
      account.children.flatMap((c) =>
        c.kind === "workspace" ? [[c.workspace.id, c.repos.length] as const] : [],
      ),
    ),
  );
}

function accountRepoCount(account: AccountNode): number {
  return (
    account.children.reduce((n, c) => n + (c.kind === "repo" ? 1 : c.repos.length), 0) +
    account.quietRepos.length
  );
}

/**
 * 사이드바 트리: 검색 칸과 모두 접기, 그리고 계정마다 구역 제목 한 줄 아래 저장소·워크스페이스 카드.
 * 저장소 카드는 머리 줄 + 작업 폴더마다 한 줄(브랜치 이름) + 보기만 하는 기본 브랜치 줄이고,
 * 워크스페이스 카드는 머리 줄 + 저장소마다 한 줄(누르면 그 저장소의 작업 폴더 줄을 카드 안에 편다)이다.
 * 모든 줄은 한 줄이고, 자세한 내용은 마우스를 올리면 뜨는 정보 카드(`SidebarHoverCard`)에 있다.
 * 접힘 상태는 워크스페이스 스토어(`collapsed`)에 저장한다. 검색하는 동안에는 맞는 것을 모두 펼쳐 보여 준다.
 * 저장소·워크스페이스는 머리 줄을 끌어서 순서를 바꾸고 워크스페이스에 넣을 수 있다(`TreeDnd`). 검색 중에는 끈다.
 */
export function RepoTree({ data, fetchingPath, onSelectRepo, onRepoContextMenu }: RepoTreeProps) {
  const { t } = useTranslation();
  const repos = useRepositoryStore((s) => s.repos);
  const activePath = useRepositoryStore((s) => s.activeRepoPath);
  // 워크트리를 보는 중이면 activeRepoPath는 워크트리 경로다. 그 줄이 가려져 있을 때
  // 저장소 머리 줄에 선택 표시를 남기려고 소유 저장소도 읽는다.
  const activeOwnerPath = useRepositoryStore((s) => s.activeRepo?.path ?? null);
  const favoriteRepos = useRepositoryStore((s) => s.favoriteRepos);
  const ownerTypes = useRepositoryStore((s) => s.ownerTypes);
  const collapsed = useWorkspaceStore((s) => s.collapsed);
  const toggleCollapsed = useWorkspaceStore((s) => s.toggleCollapsed);
  const setCollapsed = useWorkspaceStore((s) => s.setCollapsed);
  const viewing = useHistoryViewStore((s) => viewTargetFor(s, activePath));
  const setView = useSetHistoryView();
  const [query, setQuery] = useState("");
  const [openQuiet, setOpenQuiet] = useState<string[]>([]);
  // 워크스페이스 카드 안에서 작업 폴더 줄을 편 저장소(`workspaceRepoKey`). 기본은 접힘이다.
  const [openWsRepos, setOpenWsRepos] = useState<string[]>([]);
  // 다른 저장소의 기본 브랜치를 보려면 먼저 그 저장소를 연다. 저장소를 바꾸면 보기가 풀리므로
  // (`history-view` 스토어) 경로가 바뀐 뒤에 보기를 건다.
  const [pendingView, setPendingView] = useState<{ repoPath: string; target: ViewTarget } | null>(null);

  const { tree, branchOf } = data;
  const searching = query.trim().length > 0;
  const closed = useMemo(() => new Set(collapsed), [collapsed]);
  const isOpen = (key: string) =>
    searching || (key.startsWith("wsrepo:") ? openWsRepos.includes(key) : !closed.has(key));

  const visibleTree = useMemo(() => filterTree(tree, query, branchOf), [tree, query, branchOf]);
  // 검색은 워크스페이스 안 저장소를 맞는 것만 남긴다. 삭제 확인은 실제로 옮겨질 수를 알려야
  // 하므로 거르기 전 트리에서 센다.
  const memberCounts = useMemo(() => workspaceMemberCounts(tree), [tree]);

  // 화면에 워크트리 줄이 보이는 저장소만 감시 대상에 더한다(검색으로 펼친 것, 연 조용한 저장소 포함).
  const watchPaths = useMemo(
    () =>
      expandedWorktreePaths(
        visibleTree,
        (key) => searching || (key.startsWith("wsrepo:") ? openWsRepos.includes(key) : !closed.has(key)),
        openQuiet,
      ),
    [visibleTree, searching, closed, openQuiet, openWsRepos],
  );
  useSidebarWatchPaths(watchPaths);

  // 모두 접기: 계정·워크스페이스·저장소 카드. 워크스페이스 안에서 편 저장소 줄도 함께 닫는다.
  const foldable = useMemo(() => collapsibleKeys(tree), [tree]);
  const allFolded = foldable.length > 0 && foldable.every((k) => closed.has(k));
  const handleToggleAll = () => {
    if (allFolded) setCollapsed(collapsed.filter((k) => !foldable.includes(k)));
    else {
      setCollapsed([...collapsed, ...foldable]);
      setOpenWsRepos([]);
    }
  };

  useEffect(() => {
    if (pendingView && activePath === pendingView.repoPath) {
      setView(pendingView.target);
      setPendingView(null);
    }
  }, [pendingView, activePath, setView]);

  // 트리는 작업 폴더마다 줄이 따로 있어서, 줄이 가리키는 곳을 그대로 연다. 머리 줄과 기본 폴더 줄은
  // 기본 폴더를, 워크트리 줄은 그 워크트리를 연다. 기억(`activeWorktrees`)은 「이 저장소에서 마지막으로 본
  // 작업 폴더」라서 기본 폴더를 열면 비운다. 접힌 줄처럼 작업 폴더 줄이 없는 곳은 이 기억으로 마지막 곳을
  // 다시 연다. 둘 다 `useSelectRepo`를 거쳐 계정 전환과 첫 fetch를 그대로 받는다.
  const selectRepo = (repo: RepoInfo) => {
    useRepositoryStore.getState().rememberWorktree(repo.path, null);
    onSelectRepo(repo.path);
  };
  const actions: RepoActions = {
    onSelectRepo: selectRepo,
    onSelectWorktree: (repo, worktreePath) => {
      useRepositoryStore.getState().rememberWorktree(repo.path, worktreePath);
      onSelectRepo(repo.path);
    },
    onViewBranch: (repo, target) => {
      if (activePath !== repo.path) selectRepo(repo);
      setPendingView({ repoPath: repo.path, target });
    },
    onContextMenu: onRepoContextMenu,
  };
  const selection: RepoSelection = { activePath, activeOwnerPath, viewing };

  const toggleQuiet = (accountKey: string) =>
    setOpenQuiet((prev) => (prev.includes(accountKey) ? prev.filter((k) => k !== accountKey) : [...prev, accountKey]));
  const toggleWsRepo = (key: string) =>
    setOpenWsRepos((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const renderRepoCard = (node: RepoNode) => (
    <RepoCard
      key={node.key}
      node={node}
      data={data}
      selection={selection}
      actions={actions}
      favorite={favoriteRepos.includes(node.repo.path)}
      expanded={isOpen(repoNodeKey(node.repo.path))}
      fetching={fetchingPath === node.repo.path}
      draggable={!searching}
      onToggle={() => toggleCollapsed(repoNodeKey(node.repo.path))}
    />
  );

  /** 워크스페이스 카드 안 저장소 줄. 누르면 저장소를 열고 그 작업 폴더 줄을 카드 안에 편다. */
  const renderWorkspaceRepo = (node: RepoNode) => {
    const key = workspaceRepoKey(node.repo.path);
    const open = isOpen(key);
    return (
      <div key={node.key} role="none" className="flex flex-col">
        <DraggableRow
          id={node.key}
          kind="repo"
          label={node.repo.name}
          depth={1}
          path={node.repo.path}
          branch={branchOf(node.repo.path)}
          groupBelow={open}
          disabled={searching}
        >
          <RepoHeaderRow
            repo={node.repo}
            level={3}
            depth={0}
            paths={repoPaths(node)}
            data={data}
            favorite={favoriteRepos.includes(node.repo.path)}
            fetching={fetchingPath === node.repo.path}
            expanded={open}
            selected={!open && activeOwnerPath === node.repo.path}
            onSelect={() => {
              selectRepo(node.repo);
              if (!open) toggleWsRepo(key);
            }}
            onToggle={() => toggleWsRepo(key)}
            onContextMenu={(e) => onRepoContextMenu(node.repo, e)}
          />
        </DraggableRow>
        {open && (
          <RepoFolderRows node={node} level={4} depth={1} data={data} selection={selection} actions={actions} />
        )}
        {open && <DropAfterLine id={node.key} depth={1} />}
      </div>
    );
  };

  return (
    <SidebarHoverCardProvider data={data}>
      <div className="flex flex-col h-full min-h-0">
        {/* 검색 + 모두 접기 */}
        <div className="flex items-center gap-1 mb-2 shrink-0">
          <label className="flex-1 min-w-0 flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-item)] bg-card border border-(--line2) focus-within:border-ring">
            <Search className="w-3 h-3 shrink-0 text-[var(--faint)]" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("sidebarTree.search")}
              aria-label={t("sidebarTree.search")}
              className="flex-1 min-w-0 bg-transparent outline-none text-xs placeholder:text-[var(--faint)]"
            />
          </label>
          <button
            type="button"
            onClick={handleToggleAll}
            title={allFolded ? t("sidebarTree.expandAll") : t("sidebarTree.collapseAll")}
            aria-label={allFolded ? t("sidebarTree.expandAll") : t("sidebarTree.collapseAll")}
            className={SIDEBAR_ICON_BUTTON}
          >
            {allFolded ? <ChevronsUpDown className={TILE_ICON} /> : <ChevronsDownUp className={TILE_ICON} />}
          </button>
        </div>

        {/* 스크롤 칸은 사이드바 좌우 여백(10px)까지 넓혀 카드 그림자가 가장자리에서 잘리지 않게 한다. */}
        <div className="flex-1 min-h-0 -mx-2.5 px-2.5 pb-2 overflow-y-auto overflow-x-hidden">
          {!searching && <WorkspaceSuggestion />}

          {/* 끌어서 놓기는 검색으로 거르지 않은 전체 트리(`tree`)의 순서로 계산한다. */}
          <TreeDndProvider tree={tree}>
            <div role="tree" aria-label={t("sidebarTree.tree")} className="flex flex-col gap-3">
              {visibleTree.map((account) => {
                const accountOpen = isOpen(account.key);
                const quietOpen = openQuiet.includes(account.accountKey);
                return (
                  <div key={account.key} role="none" className="flex flex-col gap-1.5">
                    <AccountHeader
                      label={account.label}
                      accountKey={account.accountKey}
                      sortMode={account.sortMode}
                      showActions={!account.pending}
                      repoCount={accountRepoCount(account)}
                      ownerType={ownerTypes[account.label]}
                      expanded={accountOpen}
                      onToggle={() => toggleCollapsed(account.key)}
                    />
                    {accountOpen &&
                      account.children.map((child) => {
                        if (child.kind === "repo") return renderRepoCard(child);
                        const wsOpen = isOpen(workspaceNodeKey(child.workspace.id));
                        return (
                          <div key={child.key} role="none" className="flex flex-col">
                            <div role="none" className={SIDEBAR_CARD}>
                              <WorkspaceRow
                                nodeKey={child.key}
                                workspaceId={child.workspace.id}
                                name={child.workspace.name}
                                accountLabel={account.label}
                                repoCount={child.repos.length}
                                memberCount={memberCounts.get(child.workspace.id) ?? child.repos.length}
                                signals={signalValues(child.repos.flatMap(repoPaths), data)}
                                now={data.now}
                                expanded={wsOpen}
                                draggable={!searching}
                                onToggle={() => toggleCollapsed(workspaceNodeKey(child.workspace.id))}
                              />
                              {wsOpen && child.repos.map(renderWorkspaceRepo)}
                            </div>
                            {wsOpen && child.repos.length > 0 && <DropAfterLine id={child.key} depth={0} />}
                          </div>
                        );
                      })}
                    {accountOpen && account.quietRepos.length > 0 && (
                      <>
                        <QuietReposRow
                          names={account.quietRepos.map((r) => r.repo.name)}
                          expanded={quietOpen}
                          onToggle={() => toggleQuiet(account.accountKey)}
                        />
                        {quietOpen && account.quietRepos.map(renderRepoCard)}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </TreeDndProvider>

          {repos.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{t("sidebarTree.empty")}</p>}
          {repos.length > 0 && searching && visibleTree.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground break-words">
              {t("sidebarTree.noMatch", { query: query.trim() })}
            </p>
          )}
        </div>

        <AddRepoButton onAdded={onSelectRepo} />
      </div>
    </SidebarHoverCardProvider>
  );
}

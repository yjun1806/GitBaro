import { useMemo, useState, type MouseEvent } from "react";
import { ChevronsDownUp, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { repoNodeKey, workspaceNodeKey, type AccountNode, type RepoNode } from "@/lib/repo-tree";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import type { RepoInfo } from "@/types";
import { AccountHeader } from "./AccountHeader";
import { LiveNowSection } from "./LiveNowSection";
import { QuietReposRow } from "./QuietReposRow";
import { RepoRow, type LiveState } from "./RepoRow";
import { WorkspaceRow } from "./WorkspaceRow";
import { collapsibleKeys, filterTree, liveEntries, workspaceTotals, type LiveEntry } from "./tree-model";
import type { SidebarTreeData } from "./useSidebarTreeData";

/** 「지금 바뀌는 곳」 칸의 접힘 상태를 저장하는 키(워크스페이스 스토어의 `collapsed`). */
export const LIVE_SECTION_KEY = "live";

interface RepoTreeProps {
  data: SidebarTreeData;
  fetchingPath: string | null;
  /** 저장소를 연다(`useSelectRepo`). 기억해 둔 워크트리가 있으면 그 워크트리로 연다. */
  onSelectRepo: (path: string) => void;
  onRepoContextMenu: (repo: RepoInfo, e: MouseEvent) => void;
  onAddRepo: () => void;
}

function accountRepoCount(account: AccountNode): number {
  return (
    account.children.reduce((n, c) => n + (c.kind === "repo" ? 1 : c.repos.length), 0) +
    account.quietRepos.length
  );
}

/**
 * 사이드바 트리(D2 시안): 검색 칸과 모두 접기, 「지금 바뀌는 곳」, 계정 → 워크스페이스 → 저장소 → 워크트리.
 * 접힘 상태는 워크스페이스 스토어(`collapsed`)에 저장한다. 검색하는 동안에는 맞는 것을 모두 펼쳐 보여 준다.
 */
export function RepoTree({
  data,
  fetchingPath,
  onSelectRepo,
  onRepoContextMenu,
  onAddRepo,
}: RepoTreeProps) {
  const { t } = useTranslation();
  const repos = useRepositoryStore((s) => s.repos);
  const activePath = useRepositoryStore((s) => s.activeRepoPath);
  const ownerTypes = useRepositoryStore((s) => s.ownerTypes);
  const collapsed = useWorkspaceStore((s) => s.collapsed);
  const toggleCollapsed = useWorkspaceStore((s) => s.toggleCollapsed);
  const setCollapsed = useWorkspaceStore((s) => s.setCollapsed);
  const [query, setQuery] = useState("");
  const [openQuiet, setOpenQuiet] = useState<string[]>([]);

  const { tree, signals, lastChangedAt, overflow, now, branchOf, worktreesByRepo } = data;
  const searching = query.trim().length > 0;
  const closed = useMemo(() => new Set(collapsed), [collapsed]);
  const isOpen = (key: string) => searching || !closed.has(key);

  const visibleTree = useMemo(() => filterTree(tree, query, branchOf), [tree, query, branchOf]);
  const live = useMemo(
    () => liveEntries(lastChangedAt, now, repos, worktreesByRepo, branchOf),
    [lastChangedAt, now, repos, worktreesByRepo, branchOf],
  );
  const liveState: LiveState = { lastChangedAt, overflow, now };

  const foldable = useMemo(() => collapsibleKeys(tree), [tree]);
  const allFolded = foldable.length > 0 && foldable.every((k) => closed.has(k));
  const handleToggleAll = () => {
    if (allFolded) setCollapsed(collapsed.filter((k) => !foldable.includes(k)));
    else setCollapsed([...collapsed, ...foldable]);
  };

  // 저장소 행은 메인 작업 트리를, 워크트리 행은 그 워크트리를 연다. 둘 다 `useSelectRepo`를 거쳐
  // 계정 전환과 첫 fetch를 그대로 받는다(열 곳을 먼저 기억시킨 뒤 저장소를 고른다).
  const selectRepo = (repo: RepoInfo) => {
    useRepositoryStore.getState().rememberWorktree(repo.path, null);
    onSelectRepo(repo.path);
  };
  const selectWorktree = (repo: RepoInfo, worktreePath: string) => {
    useRepositoryStore.getState().rememberWorktree(repo.path, worktreePath);
    onSelectRepo(repo.path);
  };
  const selectLive = (entry: LiveEntry) =>
    entry.isWorktree ? selectWorktree(entry.repo, entry.path) : selectRepo(entry.repo);

  const toggleQuiet = (accountKey: string) =>
    setOpenQuiet((prev) =>
      prev.includes(accountKey) ? prev.filter((k) => k !== accountKey) : [...prev, accountKey],
    );

  const renderRepo = (node: RepoNode, level: number, depth: number) => (
    <RepoRow
      key={node.key}
      node={node}
      level={level}
      depth={depth}
      branch={branchOf(node.repo.path)}
      signals={signals}
      liveState={liveState}
      activePath={activePath}
      expanded={isOpen(repoNodeKey(node.repo.path))}
      fetching={fetchingPath === node.repo.path}
      onToggle={() => toggleCollapsed(repoNodeKey(node.repo.path))}
      onSelectRepo={selectRepo}
      onSelectWorktree={selectWorktree}
      onContextMenu={onRepoContextMenu}
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 검색 + 모두 접기 */}
      <div className="flex gap-1.5 mb-2 shrink-0">
        <label className="flex-1 min-w-0 flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-item)] bg-card shadow-[var(--shadow-sm)]">
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
          className="w-7 h-7 shrink-0 rounded-[var(--radius-item)] bg-card shadow-[var(--shadow-sm)] flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {allFolded ? (
            <ChevronsUpDown className="w-[13px] h-[13px]" />
          ) : (
            <ChevronsDownUp className="w-[13px] h-[13px]" />
          )}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mx-1 px-1">
        <LiveNowSection
          entries={live}
          overflow={overflow}
          now={now}
          activePath={activePath}
          expanded={!closed.has(LIVE_SECTION_KEY)}
          onToggle={() => toggleCollapsed(LIVE_SECTION_KEY)}
          onSelect={selectLive}
        />

        <div role="tree" aria-label={t("sidebarTree.tree")} className="flex flex-col">
          {visibleTree.map((account) => {
            const accountOpen = isOpen(account.key);
            const quietOpen = openQuiet.includes(account.accountKey);
            return (
              <div key={account.key} role="none" className="flex flex-col">
                <AccountHeader
                  label={account.label}
                  repoCount={accountRepoCount(account)}
                  ownerType={ownerTypes[account.label]}
                  expanded={accountOpen}
                  onToggle={() => toggleCollapsed(account.key)}
                />
                {accountOpen &&
                  account.children.map((child) => {
                    if (child.kind === "repo") return renderRepo(child, 2, 0);
                    const wsOpen = isOpen(workspaceNodeKey(child.workspace.id));
                    return (
                      <div key={child.key} role="none" className="flex flex-col">
                        <WorkspaceRow
                          name={child.workspace.name}
                          repoCount={child.repos.length}
                          totals={workspaceTotals(child, signals)}
                          expanded={wsOpen}
                          onToggle={() => toggleCollapsed(workspaceNodeKey(child.workspace.id))}
                        />
                        {wsOpen && child.repos.map((r) => renderRepo(r, 3, 1))}
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
                    {quietOpen && account.quietRepos.map((r) => renderRepo(r, 3, 1))}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {repos.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">{t("sidebarTree.empty")}</p>
        )}
        {repos.length > 0 && searching && visibleTree.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground break-words">
            {t("sidebarTree.noMatch", { query: query.trim() })}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onAddRepo}
        className="mt-1 shrink-0 flex items-center gap-2 h-[30px] px-2.5 rounded-[var(--radius-item)] text-xs text-muted-foreground hover:bg-[color-mix(in_srgb,var(--panel)_60%,transparent)] hover:text-foreground"
      >
        <Plus className="w-[13px] h-[13px]" aria-hidden="true" />
        {t("sidebarTree.addRepo")}
      </button>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FolderOpen, GitFork, GitBranch, Circle, EllipsisVertical, Globe, Star, Trash2, HardDrive, Plus, Lock, CloudOff, Archive, Building2, User, ShieldAlert, ShieldX, RefreshCw, Search } from "lucide-react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { useRepositoryStore, useRepoViewPath } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { addLocalRepository, cloneRepository, getRepoVisibility, getOwnerType, validateToken } from "@/api/commands";
import { CloneDialog } from "@/components/repository/CloneDialog";
import { AccountSelectDialog } from "@/components/account/AccountSelectDialog";
import { cn, getErrorMessage, isAppErrorType, isSameFolder } from "@/lib/utils";
import { extractOwnerFromRemoteUrl, groupReposByOwner, type GroupedRepos } from "@/lib/group-repos";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useToastStore } from "@/stores/toast";
import { useRepoSettingsStore } from "@/stores/repo-settings";
import { useRepoAvatarColor, useRepoName } from "@/hooks/useRepoDisplay";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { RepoSyncIndicator } from "@/components/repository/RepoSyncIndicator";
import { useRepoSyncStatuses } from "@/api/queries";
import type { GitHubAccount, RepoInfo } from "@/types";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/TextInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Count, RepoTile } from "@/components/ui/marks";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";

/* ─── RepoContextMenu ─── */

function RepoContextMenu({
  anchorRef,
  accounts,
  currentAccountId,
  isFavorite,
  hasRemote,
  onSelect,
  onToggleFavorite,
  onOpenAutoSync,
  onRemoveRepo,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  accounts: GitHubAccount[];
  currentAccountId: string | null;
  isFavorite: boolean;
  hasRemote: boolean;
  onSelect: (accountId: string | null) => void;
  onToggleFavorite: () => void;
  onOpenAutoSync: () => void;
  onRemoveRepo: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const sections: ContextMenuSection[] = [
    {
      items: [
        ...accounts.map((account) => ({
          label: account.username,
          icon: <AccountAvatar account={account} size="xs" />,
          checked: account.id === currentAccountId,
          onClick: () => onSelect(account.id),
        })),
        ...(currentAccountId
          ? [{ label: t("repo.unlinkAccount"), icon: <CloudOff className="w-3.5 h-3.5" />, onClick: () => onSelect(null) }]
          : []),
      ],
    },
    {
      items: [
        {
          label: isFavorite ? t("repo.unfavorite") : t("repo.favorite"),
          icon: <Star className={cn("w-3.5 h-3.5", isFavorite ? "fill-warning text-warning" : "text-muted-foreground")} />,
          onClick: onToggleFavorite,
        },
        {
          label: t("autoSync.menuItem"),
          icon: <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />,
          disabled: !hasRemote,
          onClick: onOpenAutoSync,
        },
        {
          label: t("repo.removeFromList"),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          variant: "danger" as const,
          onClick: onRemoveRepo,
        },
      ],
    },
  ];

  return (
    <ContextMenu anchored={{ anchorRef, align: "end" }} onClose={onClose} sections={sections} ariaLabel={t("repo.linkAccount")} />
  );
}

/* ─── RepoListView ─── */

export interface RepoListViewProps {
  onSelectRepo: (path: string) => void;
}

export function RepoListView({ onSelectRepo }: RepoListViewProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const repos = useRepositoryStore((s) => s.repos);
  const repoViewPath = useRepoViewPath();
  const repoPaths = useMemo(
    () => repos.map((r) => repoViewPath(r.path)),
    [repos, repoViewPath],
  );
  const { data: syncMap } = useRepoSyncStatuses(repoPaths);
  const addRepo = useRepositoryStore((s) => s.addRepo);
  const removeRepo = useRepositoryStore((s) => s.removeRepo);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const updateRepoAccount = useRepositoryStore((s) => s.updateRepoAccount);
  const repoVisibility = useRepositoryStore((s) => s.repoVisibility);
  const ownerTypes = useRepositoryStore((s) => s.ownerTypes);
  const accounts = useAccountStore((s) => s.accounts);
  const openRepoSettings = useRepoSettingsStore((s) => s.open);
  const repoName = useRepoName();
  const avatarColorOf = useRepoAvatarColor();
  const [accountPickerRepo, setAccountPickerRepo] = useState<string | null>(null);
  const accountPickerTriggerRef = useRef<HTMLDivElement>(null);

  const repoPermissions = useRepositoryStore((s) => s.repoPermissions);
  const setRepoPermission = useRepositoryStore((s) => s.setRepoPermission);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const addToast = useToastStore((s) => s.addToast);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showAccountSelectDialog, setShowAccountSelectDialog] = useState(false);
  const [pendingLocalRepo, setPendingLocalRepo] = useState<{ path: string; repoInfo: RepoInfo } | null>(null);
  const [validatingRepo, setValidatingRepo] = useState<string | null>(null);
  const collapsedGroups = useRepositoryStore((s) => s.collapsedGroups);
  const toggleGroupCollapsed = useRepositoryStore((s) => s.toggleGroupCollapsed);
  const favoriteRepos = useRepositoryStore((s) => s.favoriteRepos);
  const toggleFavorite = useRepositoryStore((s) => s.toggleFavorite);

  const handleClone = useCallback(async (params: { url: string; localPath: string; accountId: string | null }) => {
    const repoInfo = await cloneRepository(params.url, params.localPath, params.accountId ?? undefined);
    const repoWithAccount = params.accountId ? { ...repoInfo, accountId: params.accountId } : repoInfo;
    addRepo(repoWithAccount);
    onSelectRepo(repoInfo.path);
    setShowCloneDialog(false);
    addToast(t("clone.success"), "success");
  }, [addRepo, onSelectRepo, addToast, t]);

  const handleAddLocal = useCallback(async () => {
    setAddMenuOpen(false);
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const dirPath = typeof selected === "string" ? selected : selected;
      const repoInfo = await addLocalRepository(dirPath);
      // The folder may sit inside a repository further up (even one in the
      // home folder). Adding that repository must be the user's choice.
      if (!isSameFolder(dirPath, repoInfo.path)) {
        const confirmed = await ask(
          t("repo.addEnclosingConfirm", { picked: dirPath, root: repoInfo.path }),
          { title: t("repo.addEnclosingTitle"), kind: "warning" },
        );
        if (!confirmed) return;
      }

      if (accounts.length >= 2) {
        setPendingLocalRepo({ path: dirPath, repoInfo });
        setShowAccountSelectDialog(true);
      } else {
        const accountId = accounts.length === 1 ? accounts[0].id : null;
        addRepo({ ...repoInfo, accountId });
        onSelectRepo(repoInfo.path);
      }
    } catch (err) {
      addToast(
        isAppErrorType(err, "BareRepository")
          ? t("repo.bareNotSupported")
          : t("repo.failedToAdd", { error: getErrorMessage(err) }),
        "error",
      );
    }
  }, [accounts, addRepo, onSelectRepo, addToast, t]);

  const handleAccountSelectForRepo = useCallback((accountId: string | null) => {
    // 다이얼로그 정리를 먼저 한다. 저장소 추가가 실패하더라도 다이얼로그가
    // 열린 채로 남지 않도록 — 닫기가 추가 성공에 의존하면 안 된다.
    setShowAccountSelectDialog(false);
    setPendingLocalRepo(null);
    if (pendingLocalRepo) {
      addRepo({ ...pendingLocalRepo.repoInfo, accountId });
      onSelectRepo(pendingLocalRepo.repoInfo.path);
    }
  }, [pendingLocalRepo, addRepo, onSelectRepo]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 아래 owner 타입 조회 effect가 groups에 의존하므로, 렌더마다 새 배열이 되면 매 렌더 조회가 다시 나간다.
  const groups = useMemo((): GroupedRepos[] => {
    const needle = filter.toLowerCase();
    const filtered = repos.filter(
      (r) => r.name.toLowerCase().includes(needle) || repoName(r).toLowerCase().includes(needle),
    );
    const favRepos = filtered.filter((r) => favoriteRepos.includes(r.path));
    const nonFavFiltered = filtered.filter((r) => !favoriteRepos.includes(r.path));
    const ownerGroups = groupReposByOwner(nonFavFiltered, accounts);
    return favRepos.length > 0
      ? [{ label: t("repo.favorites"), repos: favRepos }, ...ownerGroups]
      : ownerGroups;
  }, [repos, filter, favoriteRepos, accounts, t, repoName]);

  // Flat list of visible repos for keyboard navigation
  const flatItems = useMemo(() => {
    const result: RepoInfo[] = [];
    for (const group of groups) {
      if (!collapsedGroups.includes(group.label)) {
        for (const repo of group.repos) {
          result.push(repo);
        }
      }
    }
    return result;
  }, [groups, collapsedGroups]);

  const selectedRepoIdx = flatItems.findIndex((r) => r.path === activeRepo?.path);

  const { activeIndex, containerProps, itemRef } = useListKeyboardNav({
    items: flatItems,
    onSelect: (repo) => onSelectRepo(repo.path),
    selectedIndex: selectedRepoIdx,
  });

  useEffect(() => {
    const state = useRepositoryStore.getState();
    for (const repo of repos) {
      const hasRemote = repo.remotes.length > 0;
      if (hasRemote && repo.accountId && !state.repoVisibility[repo.path]) {
        getRepoVisibility(repo.path, repo.accountId)
          .then((v) => {
            useRepositoryStore.getState().setRepoVisibility(repo.path, v);
          })
          .catch(() => {
            // visibility fetch is non-critical
          });
      }
    }
  }, [repos]);

  useEffect(() => {
    const state = useRepositoryStore.getState();
    const anyAccountId = accounts[0]?.id;
    if (!anyAccountId) return;

    for (const group of groups) {
      if (group.label === "Local" || state.ownerTypes[group.label]) continue;
      getOwnerType(group.label, anyAccountId)
        .then((res) => {
          useRepositoryStore.getState().setOwnerType(group.label, res.ownerType);
        })
        .catch(() => {
          // ownerType fetch is non-critical
        });
    }
  }, [groups, accounts]);

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Filter + Add */}
      <div className="flex items-center gap-2 p-2 min-w-0">
        <SearchInput
          ref={inputRef}
          size="md"
          surface="frame"
          wrapperClassName="flex-1 min-w-0"
          placeholder={t("common.filter")}
          aria-label={t("common.filter")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onClear={() => setFilter("")}
        />
        <div className="relative shrink-0">
          <Button
            ref={addTriggerRef}
            iconOnly
            size="md"
            variant="ghost"
            onClick={() => setAddMenuOpen((v) => !v)}
            aria-label={t("repo.addRepository")}
            title={t("repo.addRepository")}
          >
            <Plus className="w-4 h-4" />
          </Button>
          {addMenuOpen && (
            <ContextMenu
              anchored={{ anchorRef: addTriggerRef, align: "end" }}
              onClose={() => setAddMenuOpen(false)}
              sections={[
                {
                  items: [
                    { label: t("repo.addLocal"), icon: <FolderOpen className="w-4 h-4 text-muted-foreground" />, onClick: handleAddLocal },
                    { label: t("repo.cloneRepo"), icon: <GitFork className="w-4 h-4 text-muted-foreground" />, onClick: () => setShowCloneDialog(true) },
                    // "Create new repository" (git init) is hidden until it is implemented.
                  ],
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* Grouped repo list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1" {...containerProps}>
        {groups.length === 0 ? (
          <EmptyState
            icon={Search}
            title={repos.length === 0 ? t("repo.noRepos") : t("repo.noMatches")}
          />
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.label} className={cn(groupIndex > 0 && "mt-3")}>
              {/* Group header */}
              <button
                onClick={() => toggleGroupCollapsed(group.label)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded-(--radius-item) transition-colors motion-reduce:transition-none"
              >
                <ChevronDown className={cn(
                  "w-3 h-3 text-muted-foreground shrink-0 transition-transform motion-reduce:transition-none",
                  collapsedGroups.includes(group.label) && "-rotate-90",
                )} />
                {(() => {
                  if (group.label === t("repo.favorites")) {
                    return <Star className="w-3.5 h-3.5 text-warning fill-warning shrink-0" />;
                  }
                  if (group.label === "Local") {
                    return <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                  }
                  const ot = ownerTypes[group.label];
                  if (ot === "Organization") {
                    return <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                  }
                  if (ot === "User") {
                    return <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                  }
                  return <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
                })()}
                <span className="text-[11.5px] font-semibold text-muted-foreground flex-1 truncate text-left">
                  {group.label}
                </span>
                <Count value={group.repos.length} tone="muted" />
              </button>
              {/* Repo items — indented under group header (no left rule; indent only, D33) */}
              {!collapsedGroups.includes(group.label) && (
                <div className="flex flex-col gap-0.5 pl-3">
                  {group.repos.map((repo) => {
                    const navIdx = flatItems.indexOf(repo);
                    const isActive = repo.path === activeRepo?.path;
                    const linkedAccount = repo.accountId
                      ? accounts.find((a) => a.id === repo.accountId)
                      : null;
                    const isPickerOpen = accountPickerRepo === repo.path;
                    const hasRemote = repo.remotes.length > 0;
                    // 신선한 dirty 값(전체 레포 배치 조회) 우선, 없으면 스토어 값
                    const isDirty = syncMap?.[repoViewPath(repo.path)]?.isDirty ?? repo.isDirty;
                    const visibility = repoVisibility[repo.path];
                    const permission = repoPermissions[repo.path];
                    const isValidating = validatingRepo === repo.path;
                    const isFavGroup = group.label === t("repo.favorites");
                    const repoOwner = isFavGroup
                      ? (() => {
                          const origin = repo.remotes.find((r) => r.name === "origin");
                          return origin ? extractOwnerFromRemoteUrl(origin.url) : null;
                        })()
                      : null;
                    const displayName = repoName(repo) !== repo.name
                      ? repoName(repo)
                      : repoOwner
                        ? `${repoOwner}/${repo.name}`
                        : repo.name;
                    return (
                      <div key={repo.path} className="relative">
                        <button
                          ref={navIdx >= 0 ? itemRef(navIdx) : undefined}
                          onClick={() => onSelectRepo(repo.path)}
                          // 우클릭은 ⋮ 버튼과 같은 메뉴(계정 연결·즐겨찾기·자동 동기화·목록에서 제거)를 연다.
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setAccountPickerRepo(repo.path);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-2.5 min-h-11 text-left transition-colors motion-reduce:transition-none min-w-0 rounded-(--radius-item)",
                            isActive
                              ? "bg-(--acc-sel) font-semibold"
                              : !isActive && activeIndex === navIdx && navIdx >= 0
                                ? "bg-accent ring-1 ring-inset ring-primary/30"
                                : "hover:bg-accent",
                          )}
                        >
                          <RepoTile name={displayName} color={avatarColorOf(repo.path)} size="xl" />
                          <div className="flex-1 min-w-0">
                            <p className="flex items-center gap-1 text-[12.5px] font-medium truncate leading-tight">
                              {/* 표시 이름이 있으면 그것만, 없으면 owner/폴더 이름 */}
                              <span className="truncate">{displayName}</span>
                              {/* 로컬 전용 vs 공개/비공개/포크 — 뜻이 있는 아이콘이라 title(풍선말 +
                                  접근성 이름)을 붙인다. aria-hidden만 두고 title 없이 보이지 않는다. */}
                              {!hasRemote ? (
                                <span title={t("repo.localOnly")} className="shrink-0 flex items-center">
                                  <HardDrive className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                                </span>
                              ) : (
                                <>
                                  {visibility?.isPrivate && (
                                    <span title={t("repo.privateRepo")} className="shrink-0 flex items-center">
                                      <Lock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                                    </span>
                                  )}
                                  {visibility?.isFork && (
                                    <span title={t("repo.forkRepo")} className="shrink-0 flex items-center">
                                      <GitFork className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                                    </span>
                                  )}
                                  {visibility && !visibility.isPrivate && !visibility.isFork && (
                                    <span title={t("repo.publicRepo")} className="shrink-0 flex items-center">
                                      <Globe className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                                    </span>
                                  )}
                                </>
                              )}
                            </p>
                            {repo.currentBranch && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <GitBranch className="w-3 h-3 shrink-0 text-muted-foreground" />
                                <span className="text-[11.5px] text-muted-foreground truncate leading-tight">
                                  {repo.currentBranch}
                                </span>
                              </div>
                            )}
                            {/* Permission warning */}
                            {isValidating && (
                              <div role="status" className="flex items-center gap-1 mt-0.5 text-[11.5px] text-muted-foreground">
                                <Spinner size="sm" />
                                {t("common.loading")}
                              </div>
                            )}
                            {!isValidating && permission && !permission.valid && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <ShieldX className="w-3 h-3 shrink-0 text-danger" />
                                <span className="text-[11.5px] font-medium text-danger">
                                  {t("repo.accountNoAccess")}
                                </span>
                              </div>
                            )}
                            {!isValidating && permission && permission.valid && permission.canPush === false && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <ShieldAlert className="w-3 h-3 shrink-0 text-warning" />
                                <span className="text-[11.5px] font-medium text-warning">
                                  {t("repo.accountReadOnly")}
                                </span>
                              </div>
                            )}
                          </div>
                          {/* State indicators + actions */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <RepoSyncIndicator status={syncMap?.[repoViewPath(repo.path)]} variant="badge" />
                            {isDirty && <Circle className="w-2 h-2 fill-current text-warning shrink-0" />}
                            {visibility?.isArchived && <Archive className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                            {hasRemote && !repo.accountId && <CloudOff className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                            {/* Account avatar (passive) */}
                            {linkedAccount && (
                              <div className="shrink-0 flex items-center" title={linkedAccount.username}>
                                <AccountAvatar account={linkedAccount} size="xs" />
                              </div>
                            )}
                            {/* Context menu trigger */}
                            <div
                              ref={isPickerOpen ? accountPickerTriggerRef : undefined}
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                setAccountPickerRepo(isPickerOpen ? null : repo.path);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  setAccountPickerRepo(isPickerOpen ? null : repo.path);
                                }
                              }}
                              className="shrink-0 w-5 h-5 flex items-center justify-center rounded-(--radius-chip) cursor-pointer transition-colors motion-reduce:transition-none text-muted-foreground hover:text-foreground hover:bg-accent"
                            >
                              <EllipsisVertical className="w-3.5 h-3.5" />
                            </div>
                          </div>
                        </button>
                        {/* Context menu dropdown */}
                        {isPickerOpen && (
                          <RepoContextMenu
                            anchorRef={accountPickerTriggerRef}
                            accounts={accounts}
                            currentAccountId={repo.accountId}
                            isFavorite={favoriteRepos.includes(repo.path)}
                            hasRemote={repo.remotes.length > 0}
                            onToggleFavorite={() => toggleFavorite(repo.path)}
                            onOpenAutoSync={() => openRepoSettings(repo.path, "sync")}
                            onSelect={async (accountId: string | null) => {
                              updateRepoAccount(repo.path, accountId);
                              setAccountPickerRepo(null);
                              if (accountId) {
                                setValidatingRepo(repo.path);
                                try {
                                  const result = await validateToken(accountId, repo.path);
                                  setRepoPermission(repo.path, { valid: result.valid, canPush: result.canPush, reason: result.reason });
                                } catch {
                                  // validation failure is non-critical
                                } finally {
                                  setValidatingRepo(null);
                                }
                              } else {
                                setRepoPermission(repo.path, null);
                              }
                            }}
                            onRemoveRepo={() => {
                              setAccountPickerRepo(null);
                              removeRepo(repo.path);
                            }}
                            onClose={() => setAccountPickerRepo(null)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {showCloneDialog && (
        <CloneDialog
          accounts={accounts}
          selectedAccountId={activeAccountId}
          onAccountChange={setActiveAccount}
          onClone={handleClone}
          onClose={() => setShowCloneDialog(false)}
        />
      )}
      {showAccountSelectDialog && (
        <AccountSelectDialog
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSelect={handleAccountSelectForRepo}
          onClose={() => handleAccountSelectForRepo(null)}
        />
      )}
    </div>
  );
}

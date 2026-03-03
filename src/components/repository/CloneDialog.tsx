import { useState, useEffect, useCallback, useRef } from "react";
import { X, FolderOpen, Search, Download, Lock, GitFork, Loader2, ChevronDown, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import type { GitHubAccount } from "@/types";
import { searchGithubRepos, type GitHubRepoSearchResult } from "@/api/commands";
import { cn, getErrorMessage } from "@/lib/utils";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { useActivityStore } from "@/stores/activity";

type CloneTab = "github" | "url";

interface CloneDialogProps {
  accounts: GitHubAccount[];
  selectedAccountId: string | null;
  onAccountChange: (accountId: string) => void;
  onClone: (params: { url: string; localPath: string; accountId: string | null }) => Promise<void>;
  onClose: () => void;
}

export function CloneDialog({
  accounts,
  selectedAccountId,
  onAccountChange,
  onClone,
  onClose,
}: CloneDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CloneTab>(accounts.length > 0 ? "github" : "url");
  const [repoSearch, setRepoSearch] = useState("");
  const [url, setUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeOperations = useActivityStore((s) => s.activeOperations);
  const activeClone = Object.values(activeOperations).find((op) => op.operation === "clone");

  // GitHub tab state
  const [searchResults, setSearchResults] = useState<GitHubRepoSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoSearchResult | null>(null);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountPickerRef = useRef<HTMLDivElement>(null);

  // Close account picker on outside click
  useEffect(() => {
    if (!accountPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (accountPickerRef.current && !accountPickerRef.current.contains(e.target as Node)) {
        setAccountPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [accountPickerOpen]);

  // Debounced GitHub repo search
  useEffect(() => {
    if (!selectedAccountId || tab !== "github") return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchGithubRepos(selectedAccountId, repoSearch);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedAccountId, repoSearch, tab]);

  const handleBrowse = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const dir = typeof selected === "string" ? selected : selected;

    if (tab === "github" && selectedRepo) {
      const repoName = selectedRepo.fullName.split("/").pop() ?? "";
      setLocalPath(`${dir}/${repoName}`);
    } else if (tab === "url" && url) {
      const match = url.match(/\/([^/]+?)(?:\.git)?$/);
      const repoName = match?.[1] ?? "";
      setLocalPath(repoName ? `${dir}/${repoName}` : dir);
    } else {
      setLocalPath(dir);
    }
  }, [tab, selectedRepo, url]);

  const handleSelectRepo = useCallback((repo: GitHubRepoSearchResult) => {
    setSelectedRepo(repo);
    setError(null);
    const repoName = repo.fullName.split("/").pop() ?? "";
    setLocalPath((prev) => {
      if (!prev) return "";
      const lastSlash = prev.lastIndexOf("/");
      const base = lastSlash >= 0 ? prev.substring(0, lastSlash) : prev;
      return `${base}/${repoName}`;
    });
  }, []);

  const handleClone = async () => {
    const cloneUrl = tab === "url" ? url.trim() : selectedRepo?.cloneUrl ?? "";
    if (!cloneUrl || !localPath.trim()) return;

    setError(null);
    setIsCloning(true);
    try {
      await onClone({ url: cloneUrl, localPath: localPath.trim(), accountId: selectedAccountId });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsCloning(false);
    }
  };

  const canClone =
    !isCloning &&
    localPath.trim().length > 0 &&
    (tab === "url" ? url.trim().length > 0 : selectedRepo !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("repo.clone")}
          </h2>
          <button
            onClick={onClose}
            disabled={isCloning}
            className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <TabGroup className="px-6">
          <Tab
            active={tab === "github"}
            onClick={() => { setTab("github"); setError(null); }}
            disabled={isCloning}
          >
            GitHub.com
          </Tab>
          <Tab
            active={tab === "url"}
            onClick={() => { setTab("url"); setError(null); }}
            disabled={isCloning}
          >
            URL
          </Tab>
        </TabGroup>

        <div className="px-6 py-5 flex flex-col gap-4">
          {tab === "github" && (
            <>
              {/* Account selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("clone.account")}
                </label>
                <div ref={accountPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => !isCloning && setAccountPickerOpen(!accountPickerOpen)}
                    disabled={isCloning}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-sm",
                      "border border-border rounded-lg bg-card text-foreground",
                      "outline-none transition-colors",
                      accountPickerOpen && "ring-2 ring-ring",
                      isCloning && "opacity-50 cursor-not-allowed",
                      !isCloning && !accountPickerOpen && "hover:border-muted-foreground/40",
                    )}
                  >
                    {selectedAccount ? (
                      <>
                        <AccountAvatar account={selectedAccount} size="xs" />
                        <span className="truncate text-left flex-1">{selectedAccount.username}</span>
                      </>
                    ) : (
                      <span className="truncate text-left flex-1 text-muted-foreground">
                        {t("clone.selectAccount")}
                      </span>
                    )}
                    <ChevronDown className={cn(
                      "w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform",
                      accountPickerOpen && "rotate-180",
                    )} />
                  </button>
                  {accountPickerOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
                      {accounts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            onAccountChange(a.id);
                            setSelectedRepo(null);
                            setSearchResults([]);
                            setAccountPickerOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors",
                            a.id === selectedAccountId
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-accent",
                          )}
                        >
                          <AccountAvatar account={a} size="xs" />
                          <span className="truncate flex-1">{a.username}</span>
                          {a.id === selectedAccountId && (
                            <Check className="w-3.5 h-3.5 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Repo search */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("clone.repository")}
                </label>
                <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg">
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder={t("clone.searchRepos")}
                    disabled={!selectedAccountId || isCloning}
                    className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
                  />
                  {isSearching && (
                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
                  )}
                </div>

                {/* Search results list */}
                {selectedAccountId && (
                  <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
                    {isSearching && searchResults.length === 0 ? (
                      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                        {t("clone.searching")}
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                        {selectedAccountId ? t("clone.noResults") : t("clone.selectRepo")}
                      </div>
                    ) : (
                      searchResults.map((repo) => (
                        <button
                          key={repo.fullName}
                          onClick={() => handleSelectRepo(repo)}
                          disabled={isCloning}
                          className={cn(
                            "w-full flex items-start gap-2 px-3 py-2.5 text-left transition-colors border-b border-border last:border-b-0",
                            selectedRepo?.fullName === repo.fullName
                              ? "bg-primary/10"
                              : "hover:bg-accent",
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium truncate">
                                {repo.fullName}
                              </span>
                              {repo.isPrivate && (
                                <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
                              )}
                              {repo.isFork && (
                                <GitFork className="w-3 h-3 text-muted-foreground shrink-0" />
                              )}
                            </div>
                            {repo.description && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {repo.description}
                              </p>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "url" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("clone.repositoryUrl")}
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                disabled={isCloning}
                placeholder="https://github.com/owner/repo.git"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
          )}

          {/* Local path */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("clone.localPath")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                disabled={isCloning}
                placeholder="/Users/..."
                className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <button
                onClick={handleBrowse}
                disabled={isCloning}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50"
              >
                <FolderOpen className="w-4 h-4" />
                {t("common.browse")}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="px-3 py-2 text-sm text-danger bg-danger/10 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={isCloning}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleClone}
            disabled={!canClone}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors",
              !canClone && "opacity-50 cursor-not-allowed",
            )}
          >
            {isCloning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isCloning ? t("clone.cloning") : t("clone.clone")}
          </button>
          {activeClone?.progress && (
            <p className="text-xs text-muted-foreground truncate">
              {activeClone.progress.message}
              {activeClone.progress.percent != null && ` (${activeClone.progress.percent}%)`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

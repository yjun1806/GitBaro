import { useState, useEffect, useCallback, useRef } from "react";
import { FolderOpen, Download, Lock, GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import type { GitHubAccount } from "@/types";
import { searchGithubRepos, type GitHubRepoSearchResult } from "@/api/commands";
import { cn, getErrorMessage } from "@/lib/utils";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { useActivityStore } from "@/stores/activity";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
import { SearchInput, TextInput } from "@/components/ui/TextInput";
import { Spinner } from "@/components/ui/Spinner";

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <DialogFrame
      title={t("repo.clone")}
      onClose={onClose}
      dismissible={!isCloning}
      size="lg"
      footerStart={
        activeClone?.progress && (
          <p className="text-[11.5px] text-muted-foreground truncate">
            {activeClone.progress.message}
            {activeClone.progress.percent != null && ` (${activeClone.progress.percent}%)`}
          </p>
        )
      }
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={isCloning}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleClone}
            disabled={!canClone}
            busy={isCloning}
            icon={<Download className="w-3.5 h-3.5" />}
          >
            {isCloning ? t("clone.cloning") : t("clone.clone")}
          </Button>
        </>
      }
    >
      {/* Tabs */}
      <TabGroup className="-mt-1 mb-4">
        <Tab active={tab === "github"} onClick={() => { setTab("github"); setError(null); }} disabled={isCloning}>
          GitHub.com
        </Tab>
        <Tab active={tab === "url"} onClick={() => { setTab("url"); setError(null); }} disabled={isCloning}>
          URL
        </Tab>
      </TabGroup>

      <div className="flex flex-col gap-4">
        {tab === "github" && (
          <>
            {/* Account selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] font-semibold text-(--fg2)">{t("clone.account")}</label>
              <Select
                value={selectedAccountId ?? ""}
                onChange={(id) => {
                  onAccountChange(id);
                  setSelectedRepo(null);
                  setSearchResults([]);
                }}
                disabled={isCloning}
                placeholder={t("clone.selectAccount")}
                options={accounts.map((a) => ({ value: a.id, label: a.username }))}
              />
            </div>

            {/* Repo search */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.5px] font-semibold text-(--fg2)">{t("clone.repository")}</label>
              <SearchInput
                size="md"
                surface="frame"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder={t("clone.searchRepos")}
                disabled={!selectedAccountId || isCloning}
              />
              {isSearching && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <Spinner size="sm" />
                  {t("common.loading")}
                </span>
              )}

              {/* Search results list */}
              {selectedAccountId && (
                <div className="max-h-48 overflow-y-auto border border-border rounded-(--radius-item)">
                  {isSearching && searchResults.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-[12.5px] text-muted-foreground">
                      {t("clone.searching")}
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-[12.5px] text-muted-foreground">
                      {selectedAccountId ? t("clone.noResults") : t("clone.selectRepo")}
                    </div>
                  ) : (
                    searchResults.map((repo) => (
                      <button
                        key={repo.fullName}
                        onClick={() => handleSelectRepo(repo)}
                        disabled={isCloning}
                        className={cn(
                          "w-full flex items-start gap-2 px-3 py-2.5 text-left transition-colors motion-reduce:transition-none border-b border-border last:border-b-0",
                          selectedRepo?.fullName === repo.fullName ? "bg-(--acc-sel)" : "hover:bg-accent",
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-medium truncate">{repo.fullName}</span>
                            {repo.isPrivate && <Lock className="w-3 h-3 text-muted-foreground shrink-0" />}
                            {repo.isFork && <GitFork className="w-3 h-3 text-muted-foreground shrink-0" />}
                          </div>
                          {repo.description && (
                            <p className="text-[11.5px] text-muted-foreground truncate mt-0.5">{repo.description}</p>
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
            <label className="text-[11.5px] font-semibold text-(--fg2)">{t("clone.repositoryUrl")}</label>
            <TextInput
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              disabled={isCloning}
              placeholder="https://github.com/owner/repo.git"
            />
          </div>
        )}

        {/* Local path */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11.5px] font-semibold text-(--fg2)">{t("clone.localPath")}</label>
          <div className="flex gap-2">
            <TextInput
              className="flex-1"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              disabled={isCloning}
              placeholder="/Users/..."
            />
            <Button size="md" onClick={handleBrowse} disabled={isCloning} icon={<FolderOpen className="w-3.5 h-3.5" />}>
              {t("common.browse")}
            </Button>
          </div>
        </div>

        {/* Error message */}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </DialogFrame>
  );
}

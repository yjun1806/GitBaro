import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  GitFork,
  Globe,
  HardDrive,
  Loader2,
  Lock,
  FileText,
  Clock,
  Play,
} from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useRepositoryStore } from "@/stores/repository";
import { useAccountStore } from "@/stores/account";
import { useStatus, useSettings, useStashList } from "@/api/queries";
import { gitFetch } from "@/api/commands";
import { RepoHeaderContextMenu } from "@/components/repository/RepoHeaderContextMenu";
import { RepoListView } from "@/components/repository/RepoListView";
import { ChangesView } from "@/components/commit/ChangesView";
import { HistoryView } from "@/components/history/HistoryView";
import { StashView } from "@/components/stash/StashView";
import { ActionsView } from "@/components/actions/ActionsView";
import { useQueryClient } from "@tanstack/react-query";
import { TabGroup, Tab } from "@/components/ui/Tabs";

/* ─── Module-level fetch tracker (resets on app restart) ─── */
const fetchedRepos = new Set<string>();

/* ─── Sidebar ─── */

export function Sidebar() {
  const { t } = useTranslation();
  const repoListOpen = useUIStore((s) => s.repoListOpen);
  const setRepoListOpen = useUIStore((s) => s.setRepoListOpen);
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeRepo = useRepositoryStore((s) => s.activeRepo);
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const repoVisibility = useRepositoryStore((s) => s.repoVisibility);
  const setActiveRepo = useRepositoryStore((s) => s.setActiveRepo);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const removeRepo = useRepositoryStore((s) => s.removeRepo);
  const { data: statusEntries = [] } = useStatus(activeRepoPath);
  const changesCount = statusEntries.length;
  const { data: stashes = [] } = useStashList(activeRepoPath);
  const stashCount = stashes.length;
  const queryClient = useQueryClient();
  const [isFetching, setIsFetching] = useState(false);
  const [repoMenuPos, setRepoMenuPos] = useState<{ x: number; y: number } | null>(null);
  const { data: settingsData = null } = useSettings();

  const hasRemote = activeRepo ? activeRepo.remotes.length > 0 : false;
  const activeVisibility = activeRepoPath ? repoVisibility[activeRepoPath] : undefined;
  const RepoHeaderIcon = !activeRepo
    ? GitFork
    : !hasRemote
      ? HardDrive
      : activeVisibility?.isPrivate
        ? Lock
        : activeVisibility?.isFork
          ? GitFork
          : Globe;

  const handleSelectRepo = (path: string) => {
    setActiveRepo(path);
    const latestRepos = useRepositoryStore.getState().repos;
    const repo = latestRepos.find((r) => r.path === path);
    if (repo?.accountId) {
      setActiveAccount(repo.accountId);
    }
    setRepoListOpen(false);

    const repoHasRemote = repo?.remotes && repo.remotes.length > 0;
    if (repo?.accountId && repoHasRemote && !fetchedRepos.has(path)) {
      setIsFetching(true);
      gitFetch(path, repo.accountId)
        .then(() => {
          fetchedRepos.add(path);
          queryClient.invalidateQueries({ queryKey: ["branches"] });
          queryClient.invalidateQueries({ queryKey: ["commitHistory"] });
          queryClient.invalidateQueries({ queryKey: ["status"] });
        })
        .catch(() => {
          // fetch 실패는 무시 (네트워크 문제 등)
        })
        .finally(() => {
          setIsFetching(false);
        });
    }
  };

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden bg-surface">
      {/* Repo header — toggles repo list */}
      <button
        onClick={() => setRepoListOpen(!repoListOpen)}
        onContextMenu={(e) => {
          if (activeRepo) {
            e.preventDefault();
            setRepoMenuPos({ x: e.clientX, y: e.clientY });
          }
        }}
        className="flex items-center gap-2 px-4 h-[52px] shrink-0 border-b border-border hover:bg-accent transition-colors text-left"
      >
        <RepoHeaderIcon className="w-4 h-4 shrink-0 opacity-50" />
        <div className="flex-1 min-w-0" data-tauri-drag-region>
          <p className="text-xs text-muted-foreground leading-tight">{t("repo.currentRepo")}</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">
              {activeRepo?.name ?? t("repo.selectRepo")}
            </p>
            {isFetching && (
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
            )}
          </div>
        </div>
        {repoListOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {repoMenuPos && activeRepo && (
        <RepoHeaderContextMenu
          repo={activeRepo}
          settings={settingsData}
          position={repoMenuPos}
          onRemove={() => {
            removeRepo(activeRepo.path);
            setRepoMenuPos(null);
          }}
          onClose={() => setRepoMenuPos(null)}
        />
      )}

      {repoListOpen ? (
        /* ─── Repo list view ─── */
        <RepoListView onSelectRepo={handleSelectRepo} />
      ) : (
        /* ─── Changes / History view ─── */
        <>
          {/* Tab bar */}
          <TabGroup>
            <Tab
              active={activeTab === "changes"}
              onClick={() => setActiveTab("changes")}
              icon={<FileText className="w-3.5 h-3.5" />}
              count={changesCount > 0 ? changesCount : undefined}
            >
              {t("changes.title")}
            </Tab>
            <Tab
              active={activeTab === "history"}
              onClick={() => setActiveTab("history")}
              icon={<Clock className="w-3.5 h-3.5" />}
            >
              {t("history.title")}
            </Tab>
            <Tab
              active={activeTab === "stash"}
              onClick={() => setActiveTab("stash")}
              icon={<Archive className="w-3.5 h-3.5" />}
              count={stashCount > 0 ? stashCount : undefined}
            >
              {t("stash.title")}
            </Tab>
            <Tab
              active={activeTab === "actions"}
              onClick={() => setActiveTab("actions")}
              icon={<Play className="w-3.5 h-3.5" />}
            >
              {t("actions.title")}
            </Tab>
          </TabGroup>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === "changes" ? (
              <ChangesView />
            ) : activeTab === "history" ? (
              <HistoryView />
            ) : activeTab === "stash" ? (
              <StashView />
            ) : (
              <ActionsView />
            )}
          </div>
        </>
      )}
    </div>
  );
}

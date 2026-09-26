import { useTranslation } from "react-i18next";
import { Code2, Copy, FolderOpen, Globe, Terminal } from "lucide-react";
import { useDefaultBranches, useWorktrees } from "@/api/queries";
import { useAccountStore } from "@/stores/account";
import { useMenuActions } from "@/hooks/useMenuActions";
import { gitHubRepoUrl } from "@/lib/utils";
import type { RepoInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/marks";

function CopyButton({ text, label }: { text: string; label: string }) {
  const actions = useMenuActions();
  return (
    <Button iconOnly size="sm" variant="ghost" onClick={() => actions.copy(text)} aria-label={label} title={label}>
      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
    </Button>
  );
}

const VALUE = "text-[12.5px] text-foreground";

/** 「정보」 칸(읽기 전용): 폴더 위치, 원격, 기본 브랜치, 워크트리 수, 계정과 여는 버튼. */
export function InfoSection({ repo }: { repo: RepoInfo }) {
  const { t } = useTranslation();
  const actions = useMenuActions();
  const accounts = useAccountStore((s) => s.accounts);
  const { data: worktrees } = useWorktrees(repo.path);
  const { data: defaults } = useDefaultBranches([repo.path]);
  const defaultBranch = defaults?.[repo.path]?.name ?? null;
  const linkedCount = worktrees?.filter((w) => !w.isBare && !w.isMain).length ?? null;
  const account = accounts.find((a) => a.id === repo.accountId);
  const githubUrl = gitHubRepoUrl(repo.remotes);

  return (
    <>
      <SettingsSection>
        <SettingsRow label={t("repoSettings.info.folder")} stacked>
          <div className="flex items-center gap-1.5 min-w-0">
            <Code className="flex-1 min-w-0 truncate" title={repo.path}>
              {repo.path}
            </Code>
            <CopyButton text={repo.path} label={t("settingsPanel.copyPath")} />
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              onClick={() => actions.reveal(repo.path)}
              aria-label={t("settingsPanel.revealInFinder")}
              title={t("settingsPanel.revealInFinder")}
            >
              <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label={t("repoSettings.info.remotes")} stacked={repo.remotes.length > 0}>
          {repo.remotes.length === 0 ? (
            <span className="text-[12.5px] text-muted-foreground">{t("repoSettings.info.noRemotes")}</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {repo.remotes.map((remote) => (
                <li key={remote.name} className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 text-[11.5px] font-semibold text-foreground">{remote.name}</span>
                  <Code className="flex-1 min-w-0 truncate" title={remote.url}>
                    {remote.url}
                  </Code>
                  <CopyButton text={remote.url} label={t("repoSettings.info.copyUrl")} />
                </li>
              ))}
            </ul>
          )}
        </SettingsRow>
        <SettingsRow label={t("repoSettings.info.defaultBranch")}>
          <span className={`${VALUE} font-mono`}>{defaultBranch ?? "—"}</span>
        </SettingsRow>
        <SettingsRow label={t("repoSettings.info.worktrees")}>
          <span className={VALUE}>
            {linkedCount === null ? "—" : t("repoSettings.info.worktreeCount", { count: linkedCount })}
          </span>
        </SettingsRow>
        <SettingsRow label={t("repoSettings.info.account")}>
          <span className={VALUE}>{account?.username ?? t("repoSettings.account.noAccount")}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("repoSettings.info.open")}>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          <Button size="md" onClick={() => actions.openFolderInEditor(repo.path)} icon={<Code2 className="w-3.5 h-3.5" aria-hidden="true" />}>
            {t("repoSettings.info.openEditor")}
          </Button>
          <Button size="md" onClick={() => actions.openTerminal(repo.path)} icon={<Terminal className="w-3.5 h-3.5" aria-hidden="true" />}>
            {t("repoSettings.info.openTerminal")}
          </Button>
          <Button size="md" onClick={() => actions.reveal(repo.path)} icon={<FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />}>
            {t("settingsPanel.revealInFinder")}
          </Button>
          <Button
            size="md"
            disabled={!githubUrl}
            onClick={() => githubUrl && actions.openInBrowser(githubUrl)}
            icon={<Globe className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            {t("repo.contextMenu.viewOnGitHub")}
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}

import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useWorkspaceStore } from "@/stores/workspace";
import { useToastStore } from "@/stores/toast";
import { useRepoWorkspace } from "@/components/repository/useRepoWorkspace";
import type { RepoInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Switch } from "../ui/Switch";
import { SettingsSelect } from "../ui/controls";

/**
 * 「목록」 칸: 즐겨찾기와 워크스페이스 소속. 사이드바 우클릭 메뉴와 같은 동작이다.
 * 워크스페이스는 한 계정 안에만 있어 같은 계정의 워크스페이스만 고를 수 있다.
 */
export function ListSection({ repo }: { repo: RepoInfo }) {
  const { t } = useTranslation();
  const favorite = useRepositoryStore((s) => s.favoriteRepos.includes(repo.path));
  const toggleFavorite = useRepositoryStore((s) => s.toggleFavorite);
  const addRepoToWorkspace = useWorkspaceStore((s) => s.addRepoToWorkspace);
  const removeRepoFromWorkspace = useWorkspaceStore((s) => s.removeRepoFromWorkspace);
  const addToast = useToastStore((s) => s.addToast);
  const { account, current, moveTargets } = useRepoWorkspace(repo);
  const choices = [...(current ? [current] : []), ...moveTargets];
  const accountKnown = account !== undefined && !account.pending;

  const handleWorkspace = (id: string) => {
    if (!id) {
      removeRepoFromWorkspace(repo.path);
      return;
    }
    const result = addRepoToWorkspace(id, repo.path);
    if (!result.ok) addToast(t("repoSettings.list.moveFailed"), "error");
  };

  return (
    <SettingsSection>
      <SettingsRow label={t("repoSettings.list.favorite")} description={t("repoSettings.list.favoriteDescription")}>
        <Switch checked={favorite} onChange={() => toggleFavorite(repo.path)} />
      </SettingsRow>
      <SettingsRow
        label={t("repoSettings.list.workspace")}
        description={
          accountKnown
            ? t("repoSettings.list.workspaceDescription", { account: account.label })
            : t("repoSettings.list.workspaceNoAccount")
        }
      >
        <SettingsSelect
          value={current?.id ?? ""}
          disabled={!accountKnown && !current}
          onChange={handleWorkspace}
          options={[
            { value: "", label: t("repoSettings.list.noWorkspace") },
            ...choices.map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

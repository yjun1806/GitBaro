import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { usePreferencesStore } from "@/stores/preferences";
import { canAutoSync } from "@/lib/auto-sync";
import type { RepoInfo } from "@/types";
import { AutoSyncFields } from "../AutoSyncFields";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Switch } from "../ui/Switch";

/**
 * 「원격 동기화」 칸: 이 저장소의 자동 최신화(끔·확인만·안전할 때 받기)와 주기.
 * 따로 정하지 않으면 앱 설정의 기본값을 따른다. 바꾸는 즉시 적용한다.
 */
export function SyncSection({ repo }: { repo: RepoInfo }) {
  const { t } = useTranslation();
  const fallback = usePreferencesStore((s) => s.defaultAutoSync);
  const own = useRepositoryStore((s) => s.autoSyncByRepo[repo.path]);
  const setAutoSync = useRepositoryStore((s) => s.setAutoSync);
  const resetAutoSync = useRepositoryStore((s) => s.resetAutoSync);
  const current = own ?? fallback;
  const followsDefault = own === undefined;
  const runnable = canAutoSync(repo);

  return (
    <SettingsSection
      description={runnable ? t("repoSettings.sync.description") : t("repoSettings.sync.notRunnable")}
    >
      <SettingsRow label={t("repoSettings.sync.followDefault")} description={t("repoSettings.sync.followDefaultDescription")}>
        <Switch
          checked={followsDefault}
          onChange={(checked) => (checked ? resetAutoSync(repo.path) : setAutoSync(repo.path, fallback))}
        />
      </SettingsRow>
      <AutoSyncFields value={current} disabled={followsDefault} onChange={(next) => setAutoSync(repo.path, next)} />
    </SettingsSection>
  );
}

import { useTranslation } from "react-i18next";
import { useRepositoryStore } from "@/stores/repository";
import { useNotifyStore } from "@/stores/notify";
import { repoNotifyChoice, withNotifyChoice, type NotifyChoice } from "@/lib/notify/repo-override";
import type { RepoNotifyKind } from "@/lib/repo-prefs";
import type { RepoInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Segmented } from "../ui/Segmented";

const KINDS: { kind: RepoNotifyKind; labelKey: string }[] = [
  { kind: "newCommits", labelKey: "notify.settings.newCommits" },
  { kind: "ciFailures", labelKey: "notify.settings.ciFailures" },
];

/** 「알림」 칸: 이 저장소만 새 커밋·CI 실패 알림을 켜거나 끈다. 「앱 설정」이면 앱 전체 설정을 따른다. */
export function NotifySection({ repo }: { repo: RepoInfo }) {
  const { t } = useTranslation();
  const prefs = useRepositoryStore((s) => s.repoPrefs);
  const updateRepoPrefs = useRepositoryStore((s) => s.updateRepoPrefs);
  const appSettings = useNotifyStore((s) => s.settings);

  const handleChange = (kind: RepoNotifyKind, choice: NotifyChoice) =>
    updateRepoPrefs(repo.path, { notify: withNotifyChoice(prefs[repo.path]?.notify, kind, choice) });

  return (
    <SettingsSection description={t("repoSettings.notify.description")}>
      {KINDS.map(({ kind, labelKey }) => (
        <SettingsRow
          key={kind}
          label={t(labelKey)}
          description={t(appSettings[kind] ? "repoSettings.notify.appOn" : "repoSettings.notify.appOff")}
        >
          <Segmented<NotifyChoice>
            value={repoNotifyChoice(prefs, repo.path, kind)}
            onChange={(choice) => handleChange(kind, choice)}
            options={[
              { value: "on", label: t("repoSettings.notify.on") },
              { value: "inherit", label: t("repoSettings.notify.inherit") },
              { value: "off", label: t("repoSettings.notify.off") },
            ]}
          />
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

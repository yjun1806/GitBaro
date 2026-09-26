import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { Trash2 } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoName } from "@/hooks/useRepoDisplay";
import type { RepoInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { Button } from "@/components/ui/Button";

/**
 * 「목록에서 제거」 칸. 사이드바 메뉴와 같은 확인을 거쳐 GitBaro 목록에서만 뺀다.
 * 폴더·파일·원격은 건드리지 않는다.
 */
export function DangerSection({ repo, onRemoved }: { repo: RepoInfo; onRemoved: () => void }) {
  const { t } = useTranslation();
  const removeRepo = useRepositoryStore((s) => s.removeRepo);
  const name = useRepoName()(repo);

  const handleRemove = async () => {
    const confirmed = await ask(t("repo.contextMenu.removeConfirmDetail", { name }), {
      title: t("repo.contextMenu.removeConfirmTitle"),
      kind: "warning",
    });
    if (!confirmed) return;
    onRemoved();
    removeRepo(repo.path);
  };

  return (
    <SettingsSection>
      <SettingsRow label={t("repo.contextMenu.remove")} description={t("repoSettings.danger.removeDescription")}>
        <Button variant="secondary" tone="danger" size="md" onClick={() => void handleRemove()} icon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}>
          {t("repoSettings.danger.removeButton")}
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

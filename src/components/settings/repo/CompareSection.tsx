import { useTranslation } from "react-i18next";
import { useBranches, useDefaultBranches } from "@/api/queries";
import { useRepositoryStore } from "@/stores/repository";
import { baseCandidates } from "@/components/review/BasePicker";
import type { RepoInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { SettingsSelect } from "../ui/controls";

/**
 * 「비교 기준」 칸: 「{base} 대비 변경」 탭이 처음 비교할 브랜치. 기본 폴더와 그 워크트리 모두에 쓴다.
 * 탭에서 기준을 바꾸면 그 화면에서만 바뀌고, 앱을 다시 켜면 이 값으로 돌아온다.
 */
export function CompareSection({ repo }: { repo: RepoInfo }) {
  const { t } = useTranslation();
  const compareBase = useRepositoryStore((s) => s.repoPrefs[repo.path]?.compareBase ?? "");
  const updateRepoPrefs = useRepositoryStore((s) => s.updateRepoPrefs);
  const { data: branches = [] } = useBranches(repo.path);
  const { data: defaults } = useDefaultBranches([repo.path]);
  const defaultBranch = defaults?.[repo.path]?.name ?? "main";
  const { local, remote } = baseCandidates(branches, null);
  const known = new Set(branches.map((b) => b.name));

  return (
    <SettingsSection description={t("repoSettings.compare.description")}>
      <SettingsRow label={t("repoSettings.compare.label")} description={t("repoSettings.compare.hint")}>
        <SettingsSelect
          value={compareBase}
          onChange={(value) => updateRepoPrefs(repo.path, { compareBase: value || undefined })}
          options={[
            { value: "", label: t("filesByRepo.baseDefault", { branch: defaultBranch }) },
            // 목록에 없는 기준(지워진 브랜치 등)도 고른 값으로 보이게 둔다.
            ...(compareBase && !known.has(compareBase) ? [{ value: compareBase, label: compareBase }] : []),
          ]}
        >
          {local.length > 0 && (
            <optgroup label={t("branchPanel.local")}>
              {local.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
          {remote.length > 0 && (
            <optgroup label={t("branchPanel.remote")}>
              {remote.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
        </SettingsSelect>
      </SettingsRow>
    </SettingsSection>
  );
}

import { useTranslation } from "react-i18next";
import { validateToken } from "@/api/commands";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore, type RepoPermission } from "@/stores/repository";
import type { RepoInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { SettingsSelect } from "../ui/controls";

function permissionKey(permission: RepoPermission | undefined): string | null {
  if (!permission) return null;
  if (!permission.valid) return "repoSettings.account.invalid";
  if (permission.canPush === true) return "repoSettings.account.canPush";
  if (permission.canPush === false) return "repoSettings.account.readOnly";
  return null;
}

/**
 * 「GitHub 계정」 칸: 이 저장소의 fetch·push·PR·CI 조회에 쓸 계정. 저장소 목록의 계정 고르기와 같은
 * 동작이다(저장소에 계정을 적고, 그 계정의 권한을 확인한다).
 */
export function AccountSection({ repo }: { repo: RepoInfo }) {
  const { t } = useTranslation();
  const accounts = useAccountStore((s) => s.accounts);
  const permission = useRepositoryStore((s) => s.repoPermissions[repo.path]);
  const updateRepoAccount = useRepositoryStore((s) => s.updateRepoAccount);
  const setRepoPermission = useRepositoryStore((s) => s.setRepoPermission);

  const handleChange = async (value: string) => {
    const accountId = value || null;
    updateRepoAccount(repo.path, accountId);
    setRepoPermission(repo.path, null);
    if (!accountId) return;
    try {
      const result = await validateToken(accountId, repo.path);
      setRepoPermission(repo.path, { valid: result.valid, canPush: result.canPush, reason: result.reason });
    } catch {
      // 확인하지 못해도 계정은 그대로 쓴다.
    }
  };

  const status = permissionKey(permission);
  const known = repo.accountId === null || accounts.some((a) => a.id === repo.accountId);

  return (
    <SettingsSection description={t("repoSettings.account.description")}>
      <SettingsRow
        label={t("repoSettings.account.label")}
        description={status ? t(status) : repo.accountId ? null : t("repoSettings.account.none")}
      >
        <SettingsSelect
          value={repo.accountId ?? ""}
          onChange={(value) => void handleChange(value)}
          options={[
            { value: "", label: t("repoSettings.account.noAccount") },
            ...(!known && repo.accountId ? [{ value: repo.accountId, label: repo.accountId }] : []),
            ...accounts.map((a) => ({ value: a.id, label: a.username })),
          ]}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

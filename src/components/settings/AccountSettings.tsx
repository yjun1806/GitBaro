import { useState, useId } from "react";
import { LogIn, LogOut, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GhAccountStatus, GitHubAccount } from "@/types";
import { AccountAvatar } from "@/components/account/AccountAvatar";
import { Dialog } from "@/components/ui/Dialog";
import { FLOATING_SURFACE } from "@/components/ui/layers";
import { useGhStatus } from "@/api/queries";
import { cn, getErrorMessage } from "@/lib/utils";
import { SettingsSection } from "./ui/SettingsSection";
import { SETTINGS_BUTTON, SETTINGS_BUTTON_DANGER } from "./ui/styles";
import { BusyIcon } from "@/components/ui/Spinner";

interface AccountSettingsProps {
  accounts: GitHubAccount[];
  onRemove: (accountId: string) => void;
  onAddAccount: () => void;
  /** 로그인이 만료된 계정으로 다시 로그인한다. 인자는 GitHub에서 승인할 계정 이름. */
  onSignInAgain: (username: string) => void;
  onSyncAccounts: () => Promise<void>;
}

/**
 * 설정의 「계정」 칸: 로그인한 GitHub 계정 목록과 각 계정의 gh 로그인 상태, 추가,
 * gh에서 다시 불러오기, 만료된 계정 다시 로그인, 로그아웃(확인 창).
 */
export function AccountSettings({
  accounts,
  onRemove,
  onAddAccount,
  onSignInAgain,
  onSyncAccounts,
}: AccountSettingsProps) {
  const { t } = useTranslation();
  const logoutTitleId = useId();
  const [confirmLogoutId, setConfirmLogoutId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const ghStatus = useGhStatus();

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await Promise.all([onSyncAccounts(), ghStatus.refetch()]);
    } finally {
      setIsSyncing(false);
    }
  };

  const confirmAccount = accounts.find((a) => a.id === confirmLogoutId);
  const statusOf = (username: string) => ghStatus.data?.accounts.find((a) => a.username === username);

  const handleLogout = (accountId: string) => {
    onRemove(accountId);
    setConfirmLogoutId(null);
  };

  return (
    <>
      <SettingsSection
        description={t("settingsPanel.accounts.description")}
        action={
          <div className="flex gap-1.5">
            <button type="button" onClick={handleSync} disabled={isSyncing} aria-busy={isSyncing} className={SETTINGS_BUTTON}>
              <BusyIcon busy={isSyncing} icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />} />
              {t("ghSync.syncButton")}
            </button>
            <button type="button" onClick={onAddAccount} className={SETTINGS_BUTTON}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              {t("account.add")}
            </button>
          </div>
        }
      >
        {ghStatus.isError && (
          <p role="alert" className="px-4 pt-3 text-[12px] text-danger">
            {t("settingsPanel.accounts.statusFailed", { error: getErrorMessage(ghStatus.error) })}
          </p>
        )}
        {accounts.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">{t("settingsPanel.accounts.empty")}</p>
        ) : (
          accounts.map((account) => {
            const status = statusOf(account.username);
            // gh 상태 조회는 성공했는데 이 계정이 목록에 없으면(터미널에서
            // `gh auth logout -u X` 등) gh 자체에서 로그아웃된 것 — invalid와 마찬가지로
            // 다시 로그인해야 풀린다.
            const missingFromGh = ghStatus.isSuccess && !status;
            return (
              <div key={account.id} className="flex items-center gap-3 px-4 py-2.5 min-h-[52px]">
                <AccountAvatar account={account} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">{account.username}</p>
                  {account.email && <p className="text-[12px] text-muted-foreground truncate">{account.email}</p>}
                  {status && <AuthStatusLine status={status} />}
                  {missingFromGh && <NotSignedInLine />}
                </div>
                {(status?.state === "invalid" || missingFromGh) && (
                  <button type="button" onClick={() => onSignInAgain(account.username)} className={SETTINGS_BUTTON}>
                    <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                    {t("settingsPanel.accounts.signInAgain")}
                  </button>
                )}
                <button type="button" onClick={() => setConfirmLogoutId(account.id)} className={SETTINGS_BUTTON_DANGER}>
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  {t("account.logout")}
                </button>
              </div>
            );
          })
        )}
      </SettingsSection>

      {/* 로그아웃 확인 창 */}
      {confirmAccount && (
        <Dialog
          onClose={() => setConfirmLogoutId(null)}
          labelledBy={logoutTitleId}
          overlayClassName="z-[60] bg-(--overlay)"
          className={cn(FLOATING_SURFACE, "rounded-(--radius-panel) w-full max-w-sm p-6 flex flex-col items-center gap-4")}
        >
          <AccountAvatar account={confirmAccount} size="lg" />
          <div className="text-center">
            <p id={logoutTitleId} className="text-sm font-semibold text-foreground">
              {t("account.logoutConfirm", { username: confirmAccount.username })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{confirmAccount.email}</p>
          </div>
          <div className="flex gap-3 w-full mt-2">
            <button
              type="button"
              onClick={() => setConfirmLogoutId(null)}
              className="flex-1 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-accent transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => handleLogout(confirmAccount.id)}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors"
            >
              {t("account.logout")}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** gh 상태 목록에 이 계정이 아예 없을 때 한 줄. gh 밖(터미널 등)에서 로그아웃된 경우다. */
function NotSignedInLine() {
  const { t } = useTranslation();
  return (
    <p className="text-[12px] text-muted-foreground">
      <span className="text-danger">{t("settingsPanel.accounts.notSignedIn")}</span>
      {" · "}
      {t("settingsPanel.accounts.notSignedInHint")}
    </p>
  );
}

/** gh가 토큰을 온라인으로 확인한 결과 한 줄. 토큰 값은 받지도 보이지도 않는다. */
function AuthStatusLine({ status }: { status: GhAccountStatus }) {
  const { t } = useTranslation();
  if (status.state === "invalid") {
    return (
      <p className="text-[12px] text-muted-foreground">
        <span className="text-danger">{t("settingsPanel.accounts.invalid")}</span>
        {" · "}
        {t("settingsPanel.accounts.invalidHint")}
      </p>
    );
  }
  if (status.state === "unreachable") {
    return <p className="text-[12px] text-muted-foreground">{t("settingsPanel.accounts.unreachable")}</p>;
  }
  return (
    <p className="text-[12px] text-muted-foreground truncate">
      <span className="text-success">{t("settingsPanel.accounts.signedIn")}</span>
      {status.scopes.length > 0 && (
        <> · {t("settingsPanel.accounts.scopes", { scopes: status.scopes.join(", ") })}</>
      )}
    </p>
  );
}

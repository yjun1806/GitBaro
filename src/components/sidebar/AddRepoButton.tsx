import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountSelectDialog } from "@/components/account/AccountSelectDialog";
import { AddRepoDialog } from "@/components/repository/AddRepoDialog";
import { CloneDialog } from "@/components/repository/CloneDialog";
import { useAddRepository, type CloneParams } from "@/hooks/useAddRepository";
import { useAccountStore } from "@/stores/account";

interface AddRepoButtonProps {
  /** 더한 저장소를 연다(`useSelectRepo`). */
  onAdded: (path: string) => void;
}

type Step = "closed" | "choose" | "clone";

/**
 * 트리 아래 「+ 저장소 추가」. 누르면 복제와 로컬 폴더 추가 중 하나를 고르는 대화 상자를 띄우고,
 * 고른 흐름(`CloneDialog`, 폴더 고르기 + 필요하면 계정 고르기)을 바로 이어 간다.
 */
export function AddRepoButton({ onAdded }: AddRepoButtonProps) {
  const { t } = useTranslation();
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const setActiveAccount = useAccountStore((s) => s.setActiveAccount);
  const [step, setStep] = useState<Step>("closed");
  const { addLocal, clone, pendingLocalRepo, resolvePendingAccount } = useAddRepository(onAdded);

  const handleClone = async (params: CloneParams) => {
    await clone(params);
    setStep("closed");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setStep("choose")}
        className="mt-1 shrink-0 flex items-center gap-2 h-[30px] px-2.5 rounded-[var(--radius-item)] text-xs text-muted-foreground hover:bg-[color-mix(in_srgb,var(--panel)_60%,transparent)] hover:text-foreground"
      >
        <Plus className="w-[13px] h-[13px]" aria-hidden="true" />
        {t("sidebarTree.addRepo")}
      </button>
      {step === "choose" && (
        <AddRepoDialog
          onClone={() => setStep("clone")}
          onAddExisting={() => {
            setStep("closed");
            void addLocal();
          }}
          onClose={() => setStep("closed")}
        />
      )}
      {step === "clone" && (
        <CloneDialog
          accounts={accounts}
          selectedAccountId={activeAccountId}
          onAccountChange={setActiveAccount}
          onClone={handleClone}
          onClose={() => setStep("closed")}
        />
      )}
      {pendingLocalRepo && (
        <AccountSelectDialog
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSelect={resolvePendingAccount}
          onClose={() => resolvePendingAccount(null)}
        />
      )}
    </>
  );
}

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCommitVerification } from "@/api/queries";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";
import { VerificationPanel } from "./VerificationPanel";

export interface CommitVerificationProps {
  repoPath: string | null;
  oid: string | null;
  onNavigate?: (file: string, line: number | null) => void;
  className?: string;
}

/**
 * Per-commit report: static diff rules plus commit hygiene (V31·V32·V35).
 * V32 walks later history, so a commit's report can change as history grows.
 */
export function CommitVerification({ repoPath, oid, onNavigate, className }: CommitVerificationProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data, isLoading, error, refetch } = useCommitVerification(repoPath, oid);

  useEffect(() => {
    if (error) addToast(t("verify.error.scanFailed", { error: getErrorMessage(error) }), "error");
  }, [error, addToast, t]);

  return (
    <VerificationPanel
      report={data}
      isLoading={isLoading}
      error={error}
      onRescan={() => void refetch()}
      deepScan={repoPath && oid ? { repoPath, oid, staged: false } : null}
      onNavigate={onNavigate}
      className={className}
    />
  );
}

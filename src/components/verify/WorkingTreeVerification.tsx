import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useVerificationReport } from "@/api/queries";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";
import { VerificationPanel } from "./VerificationPanel";

export interface WorkingTreeVerificationProps {
  repoPath: string | null;
  /** Scan the staged diff (`true`) or the working tree (`false`). */
  staged: boolean;
  /** The commit message being typed, for V6 scope drift. */
  draftMessage?: string | null;
  onNavigate?: (file: string, line: number | null) => void;
  className?: string;
}

/**
 * Working-tree report, refreshed by the FS watcher through the
 * `["verifyWorkingTree"]` query key.
 */
export function WorkingTreeVerification({
  repoPath,
  staged,
  draftMessage = null,
  onNavigate,
  className,
}: WorkingTreeVerificationProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data, isLoading, error, refetch } = useVerificationReport(repoPath, staged, draftMessage);

  useEffect(() => {
    if (error) addToast(t("verify.error.scanFailed", { error: getErrorMessage(error) }), "error");
  }, [error, addToast, t]);

  return (
    <VerificationPanel
      report={data}
      isLoading={isLoading}
      error={error}
      onRescan={() => void refetch()}
      deepScan={repoPath ? { repoPath, oid: null, staged } : null}
      onNavigate={onNavigate}
      className={className}
    />
  );
}

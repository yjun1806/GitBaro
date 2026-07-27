import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, ScanSearch } from "lucide-react";
import { useSymbolIndexStatus, useSyntaxVerification } from "@/api/queries";
import { useToastStore } from "@/stores/toast";
import { getErrorMessage } from "@/lib/utils";
import { FindingItem } from "./FindingItem";
import { UncheckedSummary } from "./UncheckedSummary";

/** Which revision a deep scan should read. `oid === null` means the working tree. */
export interface DeepScanTarget {
  repoPath: string;
  oid: string | null;
  staged: boolean;
}

export interface DeepScanSectionProps {
  target: DeepScanTarget;
  onNavigate?: (file: string, line: number | null) => void;
}

/**
 * V1·V7·V8·V9·V17 in one tree-sitter pass, run **only when asked** (§4.2).
 *
 * Scanning on commit selection would fire a full parse for every commit an
 * arrow-key skims past, so this copies the pattern `TestEvidenceBadge` already
 * established: a button, and nothing happens until it is pressed. There is no
 * cancel affordance — this command cannot be cancelled, and offering one would
 * be a lie about what the button does.
 *
 * The result is a **complete report of its own**, with its own `checked` /
 * `unchecked` accounting filled in once by the backend. It is therefore
 * rendered as its own block and its counts are never folded into the base
 * report's — adding them would double-count and quietly inflate "checked".
 */
export function DeepScanSection({ target, onNavigate }: DeepScanSectionProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { repoPath, oid, staged } = target;

  const scan = useSyntaxVerification(repoPath, oid, staged);
  const { data: index } = useSymbolIndexStatus(repoPath);
  const indexReady = index?.state === "ready";
  const { error } = scan;

  useEffect(() => {
    if (error) addToast(t("verify.error.scanFailed", { error: getErrorMessage(error) }), "error");
  }, [error, addToast, t]);

  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex flex-col gap-1 px-3 py-2">
        <button
          type="button"
          onClick={() => void scan.refetch()}
          disabled={scan.isFetching}
          className="flex w-fit items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {scan.isFetching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ScanSearch className="w-3.5 h-3.5" />
          )}
          {t(scan.isFetching ? "verify.syntax.running" : "verify.syntax.run")}
        </button>

        {/* The scan still runs without an index — V1 and V17 do not need one, and
            V7·V8·V9 come back honestly marked `unchecked` rather than absent. */}
        {!indexReady && (
          <p className="text-[11px] text-muted-foreground">{t("verify.syntax.needsIndex")}</p>
        )}
      </div>

      {scan.data && (
        <div className="border-t border-border">
          <UncheckedSummary
            checked={scan.data.checked}
            unchecked={scan.data.unchecked}
            limits={scan.data.limits}
            className="border-b border-border px-3 py-1.5"
          />
          {scan.data.findings.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {scan.data.checked.length === 0
                ? t("verify.scope.nothingRan")
                : t("verify.scope.noFindings")}
            </p>
          ) : (
            <ul className="max-h-48 overflow-y-auto">
              {scan.data.findings.map((finding, index) => (
                <FindingItem
                  key={`${finding.ruleId}:${finding.file}:${finding.line}:${index}`}
                  finding={finding}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

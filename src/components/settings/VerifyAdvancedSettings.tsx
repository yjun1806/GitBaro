import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { HookPreview, SymbolIndexStatus, VerifyIndexProgressEvent } from "@/types";
import { useHookMutations, useHookStatus } from "@/api/queries";
import { useSymbolIndex } from "@/hooks/useSymbolIndex";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { HookInstallDialog } from "./HookInstallDialog";

const STATUS_KEY = "verify.settings.symbolIndex.status";

/** Files the index deliberately did not read — outside the language scope or over budget. */
function skippedFiles(status: SymbolIndexStatus): number {
  const byLanguage = status.skippedByLanguage.reduce((sum, [, count]) => sum + count, 0);
  return byLanguage + status.skippedByBudget;
}

interface AdvancedRowProps {
  title: string;
  status: string;
  note: string;
  children: React.ReactNode;
}

function AdvancedRow({ title, status, note, children }: AdvancedRowProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  isPending,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isPending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground transition-colors",
        "hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </button>
  );
}

function indexStatusLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: SymbolIndexStatus | undefined,
  progress: VerifyIndexProgressEvent | null,
): string {
  if (progress) return t(`${STATUS_KEY}.building`, { count: progress.filesDone });
  switch (status?.state) {
    case "building":
      return t(`${STATUS_KEY}.building`, { count: status.filesIndexed });
    case "ready":
      return t(`${STATUS_KEY}.ready`, { count: status.symbols });
    case "cancelled":
      return t(`${STATUS_KEY}.cancelled`);
    case "failed":
      return t(`${STATUS_KEY}.failed`);
    default:
      return t(`${STATUS_KEY}.idle`);
  }
}

/**
 * Settings → Verification → Advanced: the symbol index and the Claude Code hook.
 *
 * Both live here and nowhere else, for the same reason: each one costs the user
 * something real (minutes of CPU, or a write to a file they own), so each is
 * started by a click on this screen. Neither is advertised, banner-ed or
 * nudged anywhere else in the app.
 */
export function VerifyAdvancedSettings() {
  const { t } = useTranslation();
  const activeRepoPath = useRepositoryStore((s) => s.activeRepoPath);
  const addToast = useToastStore((s) => s.addToast);

  const index = useSymbolIndex(activeRepoPath);
  const { data: hookStatus } = useHookStatus();
  const { preview, install, uninstall } = useHookMutations();
  const [hookPreview, setHookPreview] = useState<HookPreview | null>(null);

  const skipped = index.status ? skippedFiles(index.status) : 0;

  const handlePreview = () => {
    preview.mutate(undefined, {
      onSuccess: setHookPreview,
      onError: (error) =>
        addToast(
          t("verify.settings.hooks.failed", { error: getErrorMessage(error) }),
          "error",
        ),
    });
  };

  const handleInstall = () => {
    install.mutate(undefined, {
      onSuccess: () => {
        setHookPreview(null);
        addToast(t("verify.settings.hooks.installed"), "success");
      },
      onError: (error) =>
        addToast(
          t("verify.settings.hooks.failed", { error: getErrorMessage(error) }),
          "error",
        ),
    });
  };

  const handleUninstall = () => {
    uninstall.mutate(undefined, {
      onSuccess: () => addToast(t("verify.settings.hooks.removed"), "success"),
      onError: (error) =>
        addToast(
          t("verify.settings.hooks.failed", { error: getErrorMessage(error) }),
          "error",
        ),
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t("verify.settings.advanced.title")}
      </h3>

      <div className="overflow-hidden rounded-lg border border-border">
        <AdvancedRow
          title={t("verify.settings.symbolIndex.title")}
          status={indexStatusLabel(t, index.status, index.progress)}
          note={t("verify.settings.symbolIndex.note")}
        >
          {/* 인덱싱은 몇 분이 걸릴 수 있다. 진행 중인 파일 수를 그대로 보여주는 것이
              "앱이 멈췄나"를 막는 유일한 장치다. */}
          {index.progress && index.progress.filesTotal > 0 && (
            <p className="font-mono text-xs text-muted-foreground/70">
              {index.progress.filesDone} / {index.progress.filesTotal}
            </p>
          )}

          {/* 준비됨이 "전부 봤다"로 읽히면 안 된다 — 읽지 않은 파일 수를 함께 말한다. */}
          {index.status?.state === "ready" && skipped > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("verify.settings.symbolIndex.skipped", { count: skipped })}
            </p>
          )}

          <div className="flex gap-2">
            {index.isBuilding ? (
              <ActionButton
                label={t("verify.settings.symbolIndex.cancel")}
                onClick={index.cancel}
                disabled={index.isPending}
                isPending={index.isPending}
              />
            ) : (
              <ActionButton
                label={t("verify.settings.symbolIndex.build")}
                onClick={index.build}
                disabled={activeRepoPath === null || index.isPending}
                isPending={index.isPending}
              />
            )}
          </div>
        </AdvancedRow>

        <AdvancedRow
          title={t("verify.settings.hooks.title")}
          status={t(
            hookStatus?.installed
              ? "verify.settings.hooks.status.installed"
              : "verify.settings.hooks.status.absent",
          )}
          note={t("verify.settings.hooks.note")}
        >
          {hookStatus?.needsUpgrade && (
            <p className="text-xs text-warning">
              {t("verify.settings.hooks.needsUpgrade")}
            </p>
          )}

          <div className="flex gap-2">
            {/* 미리보기를 건너뛰고 설치하는 경로는 존재하지 않는다. */}
            <ActionButton
              label={t("verify.settings.hooks.preview")}
              onClick={handlePreview}
              disabled={preview.isPending}
              isPending={preview.isPending}
            />
            {hookStatus?.installed && (
              <ActionButton
                label={t("verify.settings.hooks.uninstall")}
                onClick={handleUninstall}
                disabled={uninstall.isPending}
                isPending={uninstall.isPending}
              />
            )}
          </div>
        </AdvancedRow>
      </div>

      {hookPreview && (
        <HookInstallDialog
          preview={hookPreview}
          isInstalling={install.isPending}
          onConfirm={handleInstall}
          onClose={() => setHookPreview(null)}
        />
      )}
    </section>
  );
}

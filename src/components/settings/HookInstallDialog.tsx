import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import type { HookPreview } from "@/types";

interface HookInstallDialogProps {
  preview: HookPreview;
  isInstalling: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-48 overflow-auto rounded bg-muted px-3 py-2 font-mono text-xs text-foreground whitespace-pre">
        {body}
      </pre>
    </div>
  );
}

/**
 * The consent step for `install_verify_hooks`.
 *
 * This dialog is the **only** path to installing, and it exists because the
 * command edits `~/.claude/settings.json` — a file another program owns and the
 * user maintains. So it shows the three things a person needs to decide with:
 * the exact JSON that gets merged, the exact script body that gets written, and
 * the full list of fields the log will hold. Nothing is summarised away.
 */
export function HookInstallDialog({
  preview,
  isInstalling,
  onConfirm,
  onClose,
}: HookInstallDialogProps) {
  const { t } = useTranslation();
  const settingsUnusable = preview.settingsState !== "ok";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">
            {t("verify.settings.hooks.dialog.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground">
            {t("verify.settings.hooks.note")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("verify.settings.hooks.dialog.backup", { path: preview.settingsPath })}
          </p>

          {settingsUnusable && (
            <p className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              {t(`verify.settings.hooks.settingsState.${preview.settingsState}`, {
                path: preview.settingsPath,
              })}
            </p>
          )}

          <Block
            label={t("verify.settings.hooks.dialog.settingsFragment")}
            body={preview.settingsFragment}
          />
          <Block
            label={`${t("verify.settings.hooks.dialog.script")} — ${preview.scriptPath}`}
            body={preview.scriptBody}
          />

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("verify.settings.hooks.dialog.fields")}
            </p>
            <ul className="list-disc pl-5 text-xs text-foreground">
              {preview.recordedFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
            <p className="font-mono text-xs text-muted-foreground/70">{preview.logDir}</p>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isInstalling || settingsUnusable}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isInstalling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("verify.settings.hooks.install")}
          </button>
        </div>
      </div>
    </div>
  );
}

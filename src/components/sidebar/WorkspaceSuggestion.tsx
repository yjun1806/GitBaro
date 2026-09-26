import { useMemo } from "react";
import { FolderPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { suggestWorkspace } from "@/lib/suggest-workspace";
import { useAccountStore } from "@/stores/account";
import { useRepositoryStore } from "@/stores/repository";
import { useToastStore } from "@/stores/toast";
import { useWorkspaceStore } from "@/stores/workspace";
import { PANEL_SURFACE } from "@/components/ui/layers";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * 워크스페이스 제안 배너(README: 이름 앞부분이 같은 저장소를 보면 한 번 제안한다).
 *
 * 한 번에 제안 하나만 보인다. 만들든 닫든 그 제안의 키를 `dismissedSuggestions`에 남기므로
 * 같은 제안은 다시 나오지 않는다. 만든 워크스페이스를 나중에 지워도 다시 제안하지 않는다.
 */
export function WorkspaceSuggestion() {
  const { t } = useTranslation();
  const repos = useRepositoryStore((s) => s.repos);
  const accounts = useAccountStore((s) => s.accounts);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const dismissed = useWorkspaceStore((s) => s.dismissedSuggestions);
  const dismissSuggestion = useWorkspaceStore((s) => s.dismissSuggestion);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const addToast = useToastStore((s) => s.addToast);

  const suggestion = useMemo(
    () => suggestWorkspace(repos, { accounts, workspaces, dismissed })[0] ?? null,
    [repos, accounts, workspaces, dismissed],
  );
  if (!suggestion) return null;

  const { key, name, accountKey, repoPaths } = suggestion;

  const handleAccept = () => {
    const result = createWorkspace(name, accountKey, repoPaths);
    if (!result.ok) {
      addToast(t(`workspace.error.${result.reason}`), "error");
      return;
    }
    dismissSuggestion(key);
    addToast(t("workspace.suggestion.created", { name }), "success");
  };

  return (
    <section
      aria-label={t("workspace.suggestion.title", { name, count: repoPaths.length })}
      className={cn("mb-2 p-2.5 flex flex-col gap-1.5", PANEL_SURFACE)}
    >
      <div className="flex items-start gap-1.5">
        <FolderPlus className="w-3.5 h-3.5 mt-px shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="flex-1 min-w-0 text-[12.5px] font-semibold text-foreground break-words">
          {t("workspace.suggestion.title", { name, count: repoPaths.length })}
        </p>
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          onClick={() => dismissSuggestion(key)}
          aria-label={t("workspace.suggestion.dismissLabel")}
          className="-m-0.5"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
      <p className="text-[11.5px] leading-[16px] text-muted-foreground break-words">
        {t("workspace.suggestion.body", { name })}
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={handleAccept}>
          {t("workspace.suggestion.accept")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissSuggestion(key)}>
          {t("workspace.suggestion.dismiss")}
        </Button>
      </div>
    </section>
  );
}

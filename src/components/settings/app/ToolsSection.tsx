import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2 } from "lucide-react";
import { detectInstalledAiClis, detectInstalledEditors, detectInstalledTerminals } from "@/api/commands";
import type { AppSettings } from "@/types";
import { cn } from "@/lib/utils";
import { SettingsSection } from "../ui/SettingsSection";
import { AiCliIcon, AppIcon } from "./app-icons";

interface ToolChoice {
  id: string;
  name: string;
  icon: ReactNode;
}

/** 찾은 앱 목록. 아직 찾는 중이면 null. */
function useDetected<T>(detect: () => Promise<T[]>): T[] | null {
  const [items, setItems] = useState<T[] | null>(null);
  useEffect(() => {
    let alive = true;
    detect()
      .then((found) => alive && setItems(found))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [detect]);
  return items;
}

interface ToolListProps {
  title: string;
  description: string;
  choices: ToolChoice[] | null;
  selected: string;
  loadingLabel: string;
  emptyLabel: string;
  onSelect: (id: string) => void;
}

/** 설치된 앱 중 하나를 고르는 카드. 한 줄에 하나, 고른 줄에 체크 표시. */
function ToolList({ title, description, choices, selected, loadingLabel, emptyLabel, onSelect }: ToolListProps) {
  return (
    <SettingsSection title={title} description={description}>
      {choices === null ? (
        <p className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {loadingLabel}
        </p>
      ) : choices.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div role="radiogroup" aria-label={title} className="flex flex-col divide-y divide-(--line)">
          {choices.map((choice) => {
            const checked = choice.id === selected;
            return (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => onSelect(choice.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 min-h-[44px] text-left text-[13px] outline-none",
                  "transition-colors motion-reduce:transition-none hover:bg-(--panel-hover) focus-visible:bg-(--panel-hover)",
                  checked ? "text-foreground font-semibold" : "text-(--fg2)",
                )}
              >
                {choice.icon}
                <span className="flex-1 truncate">{choice.name}</span>
                {checked && <Check className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}

interface ToolsSectionProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}

/** 「편집기·터미널」 칸: 설치된 편집기·터미널·AI CLI 중 기본으로 쓸 것을 고른다. */
export function ToolsSection({ settings, onUpdateSettings }: ToolsSectionProps) {
  const { t } = useTranslation();
  const editors = useDetected(detectInstalledEditors);
  const terminals = useDetected(detectInstalledTerminals);
  const aiClis = useDetected(detectInstalledAiClis);

  return (
    <>
      <ToolList
        title={t("settings.editor")}
        description={t("settings.editorDescription")}
        choices={editors?.map((e) => ({ id: e.id, name: e.name, icon: <AppIcon icon={e.icon} name={e.name} /> })) ?? null}
        selected={settings.defaultEditor}
        loadingLabel={t("settings.detecting")}
        emptyLabel={t("settings.noEditors")}
        onSelect={(id) => onUpdateSettings({ defaultEditor: id })}
      />
      <ToolList
        title={t("settings.terminal")}
        description={t("settings.terminalDescription")}
        choices={terminals?.map((e) => ({ id: e.id, name: e.name, icon: <AppIcon icon={e.icon} name={e.name} /> })) ?? null}
        selected={settings.defaultShell}
        loadingLabel={t("settings.detectingTerminals")}
        emptyLabel={t("settings.noTerminals")}
        onSelect={(id) => onUpdateSettings({ defaultShell: id })}
      />
      <ToolList
        title={t("settings.ai")}
        description={t("settings.aiDescription")}
        choices={
          aiClis
            ?.filter((c) => c.installed)
            .map((c) => ({ id: c.id, name: c.name, icon: <AiCliIcon cliId={c.id} /> })) ?? null
        }
        selected={settings.defaultAiCli}
        loadingLabel={t("settings.detectingAiClis")}
        emptyLabel={t("settings.noAiClis")}
        onSelect={(id) => onUpdateSettings({ defaultAiCli: id })}
      />
    </>
  );
}

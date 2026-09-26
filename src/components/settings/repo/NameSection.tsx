import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, RotateCcw } from "lucide-react";
import { useRepositoryStore } from "@/stores/repository";
import { AVATAR_HUES, avatarColor, avatarColorFromHue, type AvatarColor } from "@/lib/avatar-color";
import { ALIAS_MAX_LENGTH } from "@/lib/repo-prefs";
import { cn } from "@/lib/utils";
import type { RepoInfo } from "@/types";
import { SettingsSection } from "../ui/SettingsSection";
import { SettingsRow } from "../ui/SettingsRow";
import { SettingsTextInput } from "../ui/controls";
import { Button } from "@/components/ui/Button";

/**
 * 「이름」 칸: 앱에서만 쓰는 표시 이름과 아바타 색. 폴더·원격·GitHub의 이름은 바꾸지 않는다.
 * 표시 이름은 입력칸을 떠나거나 Enter를 누를 때, 그리고 칸을 벗어날 때 저장한다.
 */
export function NameSection({ repo }: { repo: RepoInfo }) {
  const { t } = useTranslation();
  const prefs = useRepositoryStore((s) => s.repoPrefs[repo.path]);
  const updateRepoPrefs = useRepositoryStore((s) => s.updateRepoPrefs);
  const [draft, setDraftState] = useState(prefs?.alias ?? "");
  const draftRef = useRef(draft);
  const setDraft = (value: string) => {
    draftRef.current = value;
    setDraftState(value);
  };

  const save = (value: string) => updateRepoPrefs(repo.path, { alias: value.trim() || undefined });

  // 창을 닫거나 다른 칸으로 옮겨도 쓰던 이름을 잃지 않는다.
  useEffect(
    () => () => {
      const saved = useRepositoryStore.getState().repoPrefs[repo.path]?.alias ?? "";
      if (draftRef.current.trim() !== saved) updateRepoPrefs(repo.path, { alias: draftRef.current.trim() || undefined });
    },
    [repo.path, updateRepoPrefs],
  );

  const displayName = draft.trim() || repo.name;
  const hue = prefs?.hue;

  return (
    <SettingsSection description={t("repoSettings.name.description")}>
      <SettingsRow
        stacked
        label={t("repoSettings.name.alias")}
        description={t("repoSettings.name.folderName", { name: repo.name })}
      >
        <div className="flex items-center gap-2">
          <SettingsTextInput
            value={draft}
            maxLength={ALIAS_MAX_LENGTH}
            placeholder={repo.name}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => save(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save(draft);
            }}
          />
          {prefs?.alias && (
            <Button
              size="md"
              onClick={() => {
                setDraft("");
                save("");
              }}
              icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
            >
              {t("repoSettings.name.useFolderName")}
            </Button>
          )}
        </div>
      </SettingsRow>

      <SettingsRow stacked label={t("repoSettings.name.color")} description={t("repoSettings.name.colorDescription")}>
        <div role="radiogroup" aria-label={t("repoSettings.name.color")} className="flex flex-wrap items-center gap-1.5">
          <ColorSwatch
            label={t("repoSettings.name.colorAuto")}
            name={displayName}
            color={avatarColor(repo.path)}
            selected={hue === undefined}
            onSelect={() => updateRepoPrefs(repo.path, { hue: undefined })}
          />
          <span aria-hidden="true" className="w-px h-5 mx-1 bg-(--line2)" />
          {AVATAR_HUES.map((h, i) => (
            <ColorSwatch
              key={h}
              label={t("repoSettings.name.colorOption", { number: i + 1 })}
              name={displayName}
              color={avatarColorFromHue(h)}
              selected={hue === h}
              onSelect={() => updateRepoPrefs(repo.path, { hue: h })}
            />
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

function ColorSwatch({
  label,
  name,
  color,
  selected,
  onSelect,
}: {
  label: string;
  name: string;
  color: AvatarColor;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        "relative flex items-center justify-center w-7 h-7 rounded-(--radius-item) text-[12px] font-extrabold outline-none",
        "transition-shadow motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2",
        selected && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-(--panel)",
      )}
      style={{ backgroundColor: color.background, color: color.foreground }}
    >
      {selected ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <span aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>}
    </button>
  );
}

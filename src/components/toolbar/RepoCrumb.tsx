import { ChevronRight, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { avatarInitial } from "@/lib/avatar-color";
import { cn } from "@/lib/utils";
import { useRepositoryStore } from "@/stores/repository";
import { useRepoSettingsStore } from "@/stores/repo-settings";
import { useRepoAvatarColor, useRepoName } from "@/hooks/useRepoDisplay";
import { Tooltip } from "@/components/ui/Tooltip";
import { toolbarButtonClass } from "./toolbar-button";

/**
 * 머리 줄 경로의 첫 칸: 지금 연 저장소(아바타 + 표시 이름). 누르면 저장소 설정 창을 연다.
 * 폴더(워크트리)와 브랜치는 뒤따르는 칸이 각자의 패널을 연다.
 */
export function RepoCrumb() {
  const { t } = useTranslation();
  // 워크트리를 보는 중에도 activeRepo는 소유 저장소다.
  const repo = useRepositoryStore((s) => s.activeRepo);
  const openRepoSettings = useRepoSettingsStore((s) => s.open);
  const repoName = useRepoName();
  const avatarColorOf = useRepoAvatarColor();
  if (!repo) return null;
  const name = repoName(repo);
  const avatar = avatarColorOf(repo.path);
  const label = t("repoSettings.open");
  return (
    <Tooltip label={label} side="bottom" offset={10} delayMs={400} className="min-w-0 shrink-0 flex">
      <button
        type="button"
        onClick={() => openRepoSettings(repo.path)}
        aria-label={`${name} · ${label}`}
        data-testid="repo-crumb"
        className={cn(toolbarButtonClass(), "group gap-1.5 pl-1 pr-1.5 min-w-0")}
      >
        <span
          aria-hidden="true"
          className="w-5 h-5 rounded-[5px] shrink-0 flex items-center justify-center text-[10.5px] font-extrabold"
          style={{ backgroundColor: avatar.background, color: avatar.foreground }}
        >
          {avatarInitial(name)}
        </span>
        <span className="text-[13px] font-bold text-(--fg) truncate max-w-[160px]">{name}</span>
        <Settings2
          aria-hidden="true"
          className="w-3 h-3 shrink-0 text-(--faint) opacity-70 group-hover:opacity-100 transition-opacity motion-reduce:transition-none"
        />
      </button>
    </Tooltip>
  );
}

/** 경로 칸 사이의 구분 표시(›). 저장소 › 폴더 › 브랜치 순서를 보인다. */
export function CrumbSeparator() {
  return <ChevronRight aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-(--faint)" />;
}
